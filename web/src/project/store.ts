// Project storage (spec section 9.2): the IndexedDB database fpgasim, the projects and files stores.
// An unsaved editor edit sits next to the file content in the draft field (decision 46).
import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { ProjectFile } from "../build/types";

export interface ProjectRecord {
  id: string;
  name: string;
  board: string;
  kind: "browser" | "folder";
  modified: number; // ms since the epoch
  folder?: FileSystemDirectoryHandle; // handle of the folder of a project in a folder (spec section 9.2)
  autoBuild?: boolean; // "Rebuild on change"; without the field it is on (decision 97)
  // Owner login (accounts spec section 4.1 (docs/tz-accounts.md)). Without the field the project is unowned: created before sign-in
  // or on sign-in by key. A project in a folder has no field: such projects are visible at any sign-in.
  account?: string;
  // Sync state with the server (accounts spec section 4.1). The field exists on a project
  // in the browser with an owner; an unowned project, a project in a folder and a view copy have none.
  sync?: SyncInfo;
  // A temporary copy of another user's project for the administrator (section 5.6): it does not go to the server.
  viewOf?: { login: string; id: string };
}

export interface SyncConflict {
  rev: number; // server version revision
  content: string | null; // null: the file is deleted on the server
}

export interface PendingDelete {
  path: string;
  baseRev: number; // file revision the browser received from the server last
  conflict?: SyncConflict; // the file was changed on the server
  sent?: string; // file content from a send that got no answer (the file's sent field)
  asked?: boolean; // the request with this deletion is sent, the answer is not parsed yet
}

export interface SyncInfo {
  rev: number; // the since value of the next request
  generation: string; // server database generation from the last answer; "" means no answer yet
  meta: boolean; // the project is not on the server, or the name or board changed and was not sent
  deletes: PendingDelete[]; // files deleted in the browser that the server does not know about yet
  trashed?: boolean; // the user deleted the project, the DELETE request has not gone through yet
  asked?: boolean; // a sync request for this project was sent: the server may know the project without an answer
}

export interface FileRecord {
  project: string;
  path: string;
  content: string; // saved content
  draft?: string; // editor edit not saved yet
  base?: string; // content when the project was created; without the field the file was added later (decision 98)
  modified: number;
  // Sync fields (accounts spec section 4.1 (docs/tz-accounts.md)).
  serverRev?: number; // revision of the server version the content derives from; without the field the server does not know the file
  dirty?: boolean; // the content differs from what was sent to the server
  sent?: string; // content of the earliest send that has no answer yet
  conflict?: SyncConflict; // server version on a conflict
  // A file created under a path whose deletion was sent but the answer is not parsed: the "file deleted" version
  // on the server is our own send, not someone else's edit.
  sentDeleted?: boolean;
  // A counter of content replacements by a server version and the revision before the last replacement. When saving, the workspace
  // names the counter it saw: saving text begun before a replacement
  // goes to the server with the old revision and gives a conflict instead of overwriting someone else's edit.
  remoteSeq?: number;
  prevRev?: number;
  draftSeq?: number; // the remoteSeq value when the unsaved edit began
}

// A file change from a server response (section 3.3).
export interface RemoteFile {
  path: string;
  rev: number;
  content: string | null;
}

export interface SyncReply {
  rev: number;
  generation: string;
  name: string;
  board: string;
  modified: number;
  applied: { path: string; rev: number }[];
  conflicts: RemoteFile[];
  remote: RemoteFile[];
}

// What the request sent: content by path (null means deletion) and a flag that the name and board were sent.
export interface SyncSent {
  files: Map<string, string | null>;
  meta: { name: string; board: string } | null;
}

// The result of parsing a response: paths whose content the server changed in storage.
export interface SyncOutcome {
  changed: string[];
  renamed: boolean; // the project name or board came from the server
}

const synced = (project: ProjectRecord | undefined): project is ProjectRecord & { sync: SyncInfo } =>
  project?.sync !== undefined;

const newSync = (): SyncInfo => ({ rev: 0, generation: "", meta: true, deletes: [] });

// The server limit on a project name: the server will not accept a longer name, and the project would never go out.
export const MAX_PROJECT_NAME = 128;
const clampName = (name: string): string => Array.from(name).slice(0, MAX_PROJECT_NAME).join("");

// Unsent work of a file (section 4.1).
const fileUnsent = (file: FileRecord): boolean => file.dirty === true || file.conflict !== undefined;

interface Schema extends DBSchema {
  projects: { key: string; value: ProjectRecord };
  files: { key: [string, string]; value: FileRecord; indexes: { project: string } };
}

export class ProjectStore {
  private constructor(private readonly db: IDBPDatabase<Schema>) {}

  static async open(name = "fpgasim"): Promise<ProjectStore> {
    const db = await openDB<Schema>(name, 1, {
      upgrade(database) {
        database.createObjectStore("projects", { keyPath: "id" });
        database.createObjectStore("files", { keyPath: ["project", "path"] }).createIndex("project", "project");
      },
    });
    return new ProjectStore(db);
  }

  close(): void {
    this.db.close();
  }

  // Recently changed projects come first.
  async listProjects(): Promise<ProjectRecord[]> {
    return (await this.db.getAll("projects")).sort((a, b) => b.modified - a.modified);
  }

  async getProject(id: string): Promise<ProjectRecord | undefined> {
    return this.db.get("projects", id);
  }

  // A new project. File content is remembered as the original: changed files are counted from it.
  // folder is the folder handle for a project in a folder; account is the login of the project owner in the browser.
  async createProject(
    name: string,
    board: string,
    files: ProjectFile[],
    folder?: FileSystemDirectoryHandle,
    account?: string,
  ): Promise<ProjectRecord> {
    const now = Date.now();
    const project: ProjectRecord = folder
      ? { id: crypto.randomUUID(), name, board, kind: "folder", modified: now, folder }
      : { id: crypto.randomUUID(), name: clampName(name), board, kind: "browser", modified: now };
    if (!folder && account !== undefined) {
      project.account = account;
      project.sync = newSync();
    }
    const tx = this.db.transaction(["projects", "files"], "readwrite");
    await tx.objectStore("projects").put(project);
    for (const { path, content } of files) {
      const file: FileRecord = { project: project.id, path, content, base: content, modified: now };
      if (project.sync) file.dirty = true;
      await tx.objectStore("files").put(file);
    }
    await tx.done;
    this.changed(project);
    return project;
  }

  // A change that must go to the server: sync learns about it from here.
  onChange: ((id: string) => void) | null = null;

  private changed(project: ProjectRecord | undefined): void {
    if (project?.sync) this.onChange?.(project.id);
  }

  // Sign-in by login takes the unowned projects in the browser (accounts spec section 4.2): they get
  // the login of the signed-in account. Returns the number of projects taken.
  async adoptProjects(account: string): Promise<number> {
    const tx = this.db.transaction(["projects", "files"], "readwrite");
    const adopted: ProjectRecord[] = [];
    for (const project of await tx.objectStore("projects").getAll()) {
      if (project.kind !== "browser" || project.account !== undefined) continue;
      // A view copy does not go to the server (section 5.6).
      const next: ProjectRecord = project.viewOf
        ? { ...project, account }
        : { ...project, name: clampName(project.name), account, sync: newSync() };
      await tx.objectStore("projects").put(next);
      if (next.sync) {
        for (const file of await tx.objectStore("files").index("project").getAll(project.id)) {
          await tx.objectStore("files").put({ ...file, dirty: true });
        }
      }
      adopted.push(next);
    }
    await tx.done;
    for (const project of adopted) this.changed(project);
    return adopted.length;
  }

  // Project deletion. A project the server knows stays as a record with the trashed flag until the
  // DELETE request goes through (section 4.1); its files are erased at once.
  async deleteProject(id: string): Promise<void> {
    const tx = this.db.transaction(["projects", "files"], "readwrite");
    const project = await tx.objectStore("projects").get(id);
    const known = synced(project) && (project.sync.rev > 0 || project.sync.generation !== "" || project.sync.asked);
    if (synced(project) && known) {
      await tx.objectStore("projects").put({ ...project, sync: { ...project.sync, trashed: true, deletes: [] } });
    } else await tx.objectStore("projects").delete(id);
    for (const key of await tx.objectStore("files").index("project").getAllKeys(id)) {
      await tx.objectStore("files").delete(key);
    }
    await tx.done;
    this.changed(project);
  }

  // The local copy is erased without a request to the server: the project was deleted on another device
  // or the DELETE request went through.
  async removeLocal(id: string): Promise<void> {
    const tx = this.db.transaction(["projects", "files"], "readwrite");
    await tx.objectStore("projects").delete(id);
    for (const key of await tx.objectStore("files").index("project").getAllKeys(id)) {
      await tx.objectStore("files").delete(key);
    }
    await tx.done;
  }

  // A project in a folder with the same handle: a folder opened a second time is not created again.
  async findFolder(folder: FileSystemDirectoryHandle): Promise<ProjectRecord | undefined> {
    for (const project of await this.db.getAll("projects")) {
      if (project.folder && (await project.folder.isSameEntry(folder))) return project;
    }
    return undefined;
  }

  async setAutoBuild(id: string, autoBuild: boolean): Promise<void> {
    const tx = this.db.transaction("projects", "readwrite");
    const record = await tx.store.get(id);
    if (record) await tx.store.put({ ...record, autoBuild });
    await tx.done;
  }

  // The board in the project record is a copy of the board field of fpgasim.json for the project list.
  async setBoard(id: string, board: string): Promise<void> {
    const tx = this.db.transaction("projects", "readwrite");
    const record = await tx.store.get(id);
    if (record) {
      const next: ProjectRecord = { ...record, board };
      if (record.sync) next.sync = { ...record.sync, meta: true };
      await tx.store.put(next);
    }
    await tx.done;
    this.changed(record);
  }

  async renameProject(id: string, name: string): Promise<void> {
    const tx = this.db.transaction("projects", "readwrite");
    const record = await tx.store.get(id);
    if (record) {
      const next: ProjectRecord = { ...record, name, modified: Date.now() };
      if (record.sync) {
        next.name = clampName(name);
        next.sync = { ...record.sync, meta: true };
      }
      await tx.store.put(next);
    }
    await tx.done;
    this.changed(record);
  }

  // File deletion together with its unsaved edit. Deleting a file the server knows
  // is remembered in sync.deletes.
  async deleteFile(project: string, path: string): Promise<void> {
    const now = Date.now();
    const tx = this.db.transaction(["projects", "files"], "readwrite");
    const file = await tx.objectStore("files").get([project, path]);
    await tx.objectStore("files").delete([project, path]);
    const record = await tx.objectStore("projects").get(project);
    if (record) {
      const next: ProjectRecord = { ...record, modified: now };
      if (record.sync && file) next.sync = { ...record.sync, deletes: withDelete(record.sync.deletes, file) };
      await tx.objectStore("projects").put(next);
    }
    await tx.done;
    this.changed(record);
  }

  // File rename: the content and the unsaved edit move to the new path.
  async renameFile(project: string, from: string, to: string): Promise<void> {
    const now = Date.now();
    let changedProject: ProjectRecord | undefined;
    const tx = this.db.transaction(["projects", "files"], "readwrite");
    const file = await tx.objectStore("files").get([project, from]);
    if (file) {
      await tx.objectStore("files").delete([project, from]);
      // A file under the new path counts as added: it has no original content.
      const moved: FileRecord = { project, path: to, content: file.content, modified: now };
      if (file.draft !== undefined) moved.draft = file.draft;
      const record = await tx.objectStore("projects").get(project);
      if (record) {
        const next: ProjectRecord = { ...record, modified: now };
        if (record.sync) {
          // For the server a rename is deleting the old path and creating a new one (section 3.3).
          const deletes = withDelete(record.sync.deletes, file);
          moved.dirty = true;
          next.sync = { ...record.sync, deletes: takeDelete(deletes, moved) };
        }
        await tx.objectStore("projects").put(next);
      }
      await tx.objectStore("files").put(moved);
      changedProject = record;
    }
    await tx.done;
    this.changed(changedProject);
  }

  async listFiles(project: string): Promise<FileRecord[]> {
    return (await this.db.getAllFromIndex("files", "project", project)).sort((a, b) => a.path.localeCompare(b.path));
  }

  // Saving an editor edit. An edit equal to the saved content is erased.
  // seen is the counter of content replacements by the server that the workspace saw (the remoteSeq field).
  async putDraft(project: string, path: string, text: string, seen?: number): Promise<void> {
    const tx = this.db.transaction("files", "readwrite");
    const file = await tx.store.get([project, path]);
    if (file) {
      if (text === file.content) {
        delete file.draft;
        delete file.draftSeq;
      } else {
        if (file.draft === undefined || file.draftSeq === undefined) {
          const seq = seen ?? file.remoteSeq;
          if (seq !== undefined) file.draftSeq = seq;
        }
        file.draft = text;
      }
      await tx.store.put(file);
    }
    await tx.done;
  }

  // Saving a file: the text becomes the content, the edit is erased, the project time is updated.
  // The original content of the file stays. seen is as in putDraft (0 means there were no replacements); without it
  // there is no check. Returns the remoteSeq counter of the file after the write.
  async saveFile(project: string, path: string, text: string, seen?: number): Promise<number> {
    return this.putContent(project, path, text, false, seen);
  }

  // New file content from disk (a project in a folder): an unsaved edit stays if it
  // differs from the new content.
  async diskContent(project: string, path: string, text: string): Promise<void> {
    await this.putContent(project, path, text, true);
  }

  private async putContent(
    project: string,
    path: string,
    text: string,
    keepDraft: boolean,
    seen?: number,
  ): Promise<number> {
    const now = Date.now();
    const tx = this.db.transaction(["projects", "files"], "readwrite");
    const old = await tx.objectStore("files").get([project, path]);
    const record = await tx.objectStore("projects").get(project);
    if (!record) {
      // There is no project under this identifier any more (erased or given a new identifier): a file
      // without a project is not created.
      await tx.done;
      return old?.remoteSeq ?? 0;
    }
    const file: FileRecord = { project, path, content: text, modified: now };
    if (old?.base !== undefined) file.base = old.base;
    if (keepDraft && old?.draft !== undefined && old.draft !== text) file.draft = old.draft;
    let next: ProjectRecord = { ...record, modified: now };
    if (record.sync) {
      if (old) {
        copySync(old, file);
        // The text began before the content was replaced by a server version: it derives from the previous revision.
        const stale = seen !== undefined && seen !== (old.remoteSeq ?? 0);
        if (stale) {
          if (old.prevRev === undefined) delete file.serverRev;
          else file.serverRev = old.prevRev;
        }
        if (stale || text !== old.content) file.dirty = true;
      } else {
        file.dirty = true;
        next = { ...next, sync: { ...record.sync, deletes: takeDelete(record.sync.deletes, file) } };
      }
    }
    await tx.objectStore("files").put(file);
    await tx.objectStore("projects").put(next);
    await tx.done;
    this.changed(record);
    return file.remoteSeq ?? 0;
  }

  // ---- Sync (accounts spec sections 4.1–4.4 (docs/tz-accounts.md)) ----

  // Account projects that sync, including those deleted by the user (trashed).
  async syncedProjects(account: string): Promise<ProjectRecord[]> {
    return (await this.db.getAll("projects")).filter((p) => p.account === account && p.sync !== undefined);
  }

  // A server project that is not in the browser: an empty record, files come with the first sync request.
  async addRemote(
    remote: { id: string; name: string; board: string; modified: number },
    account: string,
    generation: string,
  ): Promise<void> {
    const tx = this.db.transaction("projects", "readwrite");
    if (!(await tx.store.get(remote.id))) {
      await tx.store.put({
        id: remote.id,
        name: remote.name,
        board: remote.board,
        kind: "browser",
        modified: remote.modified,
        account,
        sync: { rev: 0, generation, meta: false, deletes: [] },
      });
    }
    await tx.done;
  }

  // The request is sent: the file remembers the content of the earliest send without an answer. By it
  // a conflict with our own past send (the answer was lost) differs from someone else's edit.
  async markSent(project: string, files: Map<string, string | null>): Promise<void> {
    const tx = this.db.transaction(["projects", "files"], "readwrite");
    const record = await tx.objectStore("projects").get(project);
    if (!synced(record)) {
      await tx.done;
      return;
    }
    for (const [path, content] of files) {
      if (content === null) continue;
      const file = await tx.objectStore("files").get([project, path]);
      if (file?.sent === undefined && file?.content === content) {
        await tx.objectStore("files").put({ ...file, sent: content });
      }
    }
    // The project and deletions that the server may learn about even without a parsed answer.
    const deletes = record.sync.deletes.map((d) => (files.get(d.path) === null ? { ...d, asked: true } : d));
    await tx.objectStore("projects").put({ ...record, sync: { ...record.sync, asked: true, deletes } });
    await tx.done;
  }

  // An editor edit for a file whose record was erased (the file was deleted on the server, and the edit has not
  // reached storage yet): the record is created again, the edit survives page close.
  async reviveFile(project: string, path: string, content: string, draft: string): Promise<void> {
    const tx = this.db.transaction(["projects", "files"], "readwrite");
    const record = await tx.objectStore("projects").get(project);
    if (record && !(await tx.objectStore("files").get([project, path]))) {
      const file: FileRecord = { project, path, content, draft, modified: Date.now() };
      if (record.sync) file.dirty = true;
      await tx.objectStore("files").put(file);
    }
    await tx.done;
    this.changed(record);
  }

  // Parsing a sync response (section 4.4) in one transaction. null means the project is no longer in the browser.
  async applySync(id: string, sent: SyncSent, reply: SyncReply): Promise<SyncOutcome | null> {
    const now = Date.now();
    const tx = this.db.transaction(["projects", "files"], "readwrite");
    const files = tx.objectStore("files");
    const project = await tx.objectStore("projects").get(id);
    if (!synced(project) || project.sync.trashed) {
      await tx.done;
      return null;
    }
    const first = project.sync.rev === 0; // first receipt of the project: the content becomes the original
    let deletes = [...project.sync.deletes];
    const changed: string[] = [];
    const conflictAt = (path: string, conflict: SyncConflict): boolean => {
      const entry = deletes.find((d) => d.path === path);
      if (!entry) return false;
      deletes = deletes.map((d) => (d.path === path ? { ...d, conflict } : d));
      return true;
    };

    // Item 1: accepted changes.
    for (const { path, rev } of reply.applied) {
      const was = sent.files.get(path);
      const file = await files.get([id, path]);
      if (was === null) {
        // The deletion is accepted. A file created again under this path goes over the deleted one.
        deletes = deletes.filter((d) => d.path !== path);
        if (file) {
          const kept = withRev(file, rev);
          delete kept.sentDeleted;
          await files.put(kept);
        }
        continue;
      }
      if (!file) {
        // The file was deleted while the request was in flight: the server already knows it, the deletion goes in the next request.
        if (rev > 0) deletes = [...deletes.filter((d) => d.path !== path), { path, baseRev: rev }];
        continue;
      }
      const next = withRev(file, rev);
      delete next.sent;
      delete next.sentDeleted;
      if (next.content === was) delete next.dirty;
      await files.put(next);
    }

    // Item 3: conflicts.
    for (const { path, rev, content } of reply.conflicts) {
      const file = await files.get([id, path]);
      const pending = deletes.find((d) => d.path === path);
      if (!file && pending?.sent !== undefined && content === pending.sent) {
        // The server version is a past send from this same browser: the deletion goes over it.
        deletes = deletes.map((d) => (d.path === path ? { path, baseRev: rev } : d));
        continue;
      }
      if (!file) {
        if (!conflictAt(path, { rev, content }) && content !== null) {
          // There is no file and no deletion record: the server version is taken as a new file.
          await files.put({ project: id, path, content, modified: now, serverRev: rev, remoteSeq: 1 });
          changed.push(path);
        }
        continue;
      }
      const ownSend = file.sent !== undefined && content === file.sent;
      const ownDelete = file.sentDeleted === true && content === null;
      if (ownSend || ownDelete) {
        // The server version is a past send from this same browser, whose answer was lost.
        const next = withRev(file, rev);
        delete next.sent;
        delete next.sentDeleted;
        if (next.content === content) delete next.dirty;
        await files.put(next);
        continue;
      }
      const next: FileRecord = { ...file, conflict: { rev, content } };
      delete next.sent;
      await files.put(next);
    }

    // Item 2: server changes.
    for (const { path, rev, content } of reply.remote) {
      const file = await files.get([id, path]);
      if (deletes.some((d) => d.path === path)) {
        // The file is deleted in the browser, the request about it has not gone out yet.
        const entry = deletes.find((d) => d.path === path);
        if (content === null) deletes = deletes.filter((d) => d.path !== path);
        else if (entry?.sent !== undefined && content === entry.sent) {
          // The server version is a past send from this same browser: the deletion goes over it.
          deletes = deletes.map((d) => (d.path === path ? { path, baseRev: rev } : d));
        } else conflictAt(path, { rev, content });
        if (!file) continue;
      }
      if (!file) {
        if (content === null) continue;
        const added: FileRecord = { project: id, path, content, modified: now, serverRev: rev, remoteSeq: 1 };
        if (first) added.base = content;
        await files.put(added);
        changed.push(path);
        continue;
      }
      if (
        fileUnsent(file) &&
        ((file.sent !== undefined && content === file.sent) || (file.sentDeleted && content === null))
      ) {
        // The server version is a past send from this same browser: the file goes over it.
        const own = withRev(file, rev);
        delete own.sent;
        delete own.sentDeleted;
        await files.put(own);
        continue;
      }
      if (fileUnsent(file)) {
        // The file changed while the request was in flight, or it already holds a conflict.
        if (content === file.content) {
          const next = withRev(file, rev);
          delete next.dirty;
          delete next.conflict;
          delete next.sent;
          await files.put(next);
        } else await files.put({ ...file, conflict: { rev, content } });
        continue;
      }
      if (content === null) {
        // Deleting a file with an unsaved editor edit does not erase the edit: a conflict.
        if (file.draft !== undefined) await files.put({ ...file, conflict: { rev, content } });
        else {
          await files.delete([id, path]);
          changed.push(path);
        }
        continue;
      }
      const next: FileRecord = {
        ...file,
        content,
        modified: now,
        serverRev: rev,
        remoteSeq: (file.remoteSeq ?? 0) + 1,
      };
      if (file.serverRev === undefined) delete next.prevRev;
      else next.prevRev = file.serverRev;
      if (next.draft === content) {
        delete next.draft;
        delete next.draftSeq;
      } else if (next.draft !== undefined) next.draftSeq ??= file.remoteSeq ?? 0;
      await files.put(next);
      changed.push(path);
    }

    // Items 4 and 5: name, board, revision, generation.
    const sync: SyncInfo = { ...project.sync, rev: reply.rev, generation: reply.generation, deletes };
    const next: ProjectRecord = { ...project, sync };
    let renamed = false;
    const sentMeta = sent.meta;
    // The name and board were sent and have not changed since: the send took place.
    if (sentMeta !== null && project.name === sentMeta.name && project.board === sentMeta.board) sync.meta = false;
    else if (!project.sync.meta && (project.name !== reply.name || project.board !== reply.board)) {
      next.name = reply.name;
      next.board = reply.board;
      renamed = true;
    }
    await tx.objectStore("projects").put(next);
    await tx.done;
    return { changed, renamed };
  }

  // Project revisions are invalid (section 4.4, item 7): the server database was restored from a backup
  // or the server does not know the project. All files are sent again without revisions.
  async resetSync(id: string, generation: string): Promise<void> {
    const tx = this.db.transaction(["projects", "files"], "readwrite");
    const project = await tx.objectStore("projects").get(id);
    if (synced(project)) {
      // Unsent deletions stay: without a revision the server accepts them or returns a conflict.
      const deletes = project.sync.deletes.map((d) => ({ path: d.path, baseRev: 0 }));
      const sync: SyncInfo = { rev: 0, generation, meta: true, deletes };
      if (project.sync.trashed) sync.trashed = true;
      if (project.sync.asked) sync.asked = true;
      await tx.objectStore("projects").put({ ...project, sync });
      for (const file of await tx.objectStore("files").index("project").getAll(id)) {
        await tx.objectStore("files").put(unsynced(file));
      }
    }
    await tx.done;
  }

  // The project was deleted on another device, and the browser has unsaved work (section 4.4,
  // item 6): the project gets a new identifier and goes to the server as new. Editor edits
  // stay. Returns the new identifier; null means there is no project.
  async reidProject(id: string): Promise<string | null> {
    const tx = this.db.transaction(["projects", "files"], "readwrite");
    const project = await tx.objectStore("projects").get(id);
    if (!project) {
      await tx.done;
      return null;
    }
    const copy: ProjectRecord = { ...project, id: crypto.randomUUID(), modified: Date.now(), sync: newSync() };
    await tx.objectStore("projects").delete(id);
    await tx.objectStore("projects").put(copy);
    for (const file of await tx.objectStore("files").index("project").getAll(id)) {
      await tx.objectStore("files").delete([id, file.path]);
      await tx.objectStore("files").put({ ...unsynced(file), project: copy.id });
    }
    await tx.done;
    return copy.id;
  }

  // Choosing a version on a conflict (section 5.5). mine: the browser version goes to the server over
  // the server version; server: the server version replaces the browser content and the unsaved edit.
  async resolveConflict(id: string, path: string, choice: "mine" | "server"): Promise<void> {
    const now = Date.now();
    const tx = this.db.transaction(["projects", "files"], "readwrite");
    const files = tx.objectStore("files");
    const project = await tx.objectStore("projects").get(id);
    const file = await files.get([id, path]);
    if (!synced(project)) {
      await tx.done;
      return;
    }
    let deletes = project.sync.deletes;
    const entry = deletes.find((d) => d.path === path);
    if (file?.conflict) {
      const { rev, content } = file.conflict;
      if (choice === "mine") {
        const next = withRev(file, rev);
        delete next.conflict;
        next.dirty = true;
        await files.put(next);
      } else if (content === null) await files.delete([id, path]);
      else {
        const next: FileRecord = { ...withRev(file, rev), content, modified: now };
        next.remoteSeq = (file.remoteSeq ?? 0) + 1;
        delete next.conflict;
        delete next.dirty;
        delete next.draft;
        delete next.draftSeq;
        delete next.sent;
        delete next.prevRev;
        await files.put(next);
      }
    } else if (entry?.conflict) {
      const { rev, content } = entry.conflict;
      if (choice === "mine") deletes = deletes.map((d) => (d.path === path ? { path, baseRev: rev } : d));
      else {
        deletes = deletes.filter((d) => d.path !== path);
        if (content !== null) {
          await files.put({ project: id, path, content, modified: now, serverRev: rev, remoteSeq: 1 });
        }
      }
    }
    await tx.objectStore("projects").put({ ...project, modified: now, sync: { ...project.sync, deletes } });
    await tx.done;
    this.changed(project);
  }

  // ---- Viewing users' projects by an administrator (accounts spec section 5.6 (docs/tz-accounts.md)) ----

  // A temporary copy of another user's project: it belongs to the administrator (account) and does not go to the server (no sync).
  // The previous copy of the same project is replaced. Returns the new copy.
  async createView(
    source: { login: string; id: string; name: string; board: string },
    files: ProjectFile[],
    account: string,
  ): Promise<ProjectRecord> {
    const now = Date.now();
    const tx = this.db.transaction(["projects", "files"], "readwrite");
    for (const old of await tx.objectStore("projects").getAll()) {
      if (old.viewOf?.id !== source.id || old.account !== account) continue;
      await tx.objectStore("projects").delete(old.id);
      for (const key of await tx.objectStore("files").index("project").getAllKeys(old.id)) {
        await tx.objectStore("files").delete(key);
      }
    }
    const project: ProjectRecord = {
      id: crypto.randomUUID(),
      name: source.name,
      board: source.board,
      kind: "browser",
      modified: now,
      account,
      viewOf: { login: source.login, id: source.id },
    };
    await tx.objectStore("projects").put(project);
    for (const { path, content } of files) {
      await tx.objectStore("files").put({ project: project.id, path, content, base: content, modified: now });
    }
    await tx.done;
    return project;
  }

  // "Make my own copy": the temporary copy becomes an ordinary account project with a new
  // identifier and goes to the server. Unsaved edits stay. Returns the new
  // identifier; null means there is no copy.
  async claimView(id: string): Promise<string | null> {
    const tx = this.db.transaction(["projects", "files"], "readwrite");
    const project = await tx.objectStore("projects").get(id);
    if (!project?.viewOf || project.account === undefined) {
      await tx.done;
      return null;
    }
    const copy: ProjectRecord = { ...project, id: crypto.randomUUID(), modified: Date.now(), sync: newSync() };
    delete copy.viewOf;
    await tx.objectStore("projects").delete(id);
    await tx.objectStore("projects").put(copy);
    for (const file of await tx.objectStore("files").index("project").getAll(id)) {
      await tx.objectStore("files").delete([id, file.path]);
      await tx.objectStore("files").put({ ...unsynced(file), project: copy.id });
    }
    await tx.done;
    this.changed(copy);
    return copy.id;
  }
}

// A file with a new server revision: the browser content now derives from it.
function withRev(file: FileRecord, rev: number): FileRecord {
  const next: FileRecord = { ...file };
  if (rev > 0) next.serverRev = rev;
  else delete next.serverRev;
  return next;
}

// Sync fields move to the new file content.
function copySync(from: FileRecord, to: FileRecord): void {
  if (from.serverRev !== undefined) to.serverRev = from.serverRev;
  if (from.dirty) to.dirty = true;
  if (from.sent !== undefined) to.sent = from.sent;
  if (from.conflict !== undefined) to.conflict = from.conflict;
  if (from.sentDeleted) to.sentDeleted = true;
  if (from.remoteSeq !== undefined) to.remoteSeq = from.remoteSeq;
  if (from.prevRev !== undefined) to.prevRev = from.prevRev;
  if (to.draft !== undefined && from.draftSeq !== undefined) to.draftSeq = from.draftSeq;
}

// A file without server revisions: it goes to the server as new.
function unsynced(file: FileRecord): FileRecord {
  const next: FileRecord = { ...file, dirty: true };
  delete next.serverRev;
  delete next.sent;
  delete next.sentDeleted;
  delete next.conflict;
  delete next.prevRev;
  return next;
}

// Deleting a file the server knows goes into the list; the earlier record about the same path is replaced.
function withDelete(deletes: PendingDelete[], file: FileRecord): PendingDelete[] {
  const rest = deletes.filter((d) => d.path !== file.path);
  // The server knows the file by revision or may know it by a send without an answer.
  if (file.serverRev === undefined && file.sent === undefined && !file.sentDeleted) return rest;
  const entry: PendingDelete = { path: file.path, baseRev: file.serverRev ?? 0 };
  if (file.sent !== undefined) entry.sent = file.sent;
  if (file.sentDeleted) entry.asked = true;
  return [...rest, entry];
}

// A file created under a path whose deletion is not sent yet or was sent without an answer: for the server
// this is an edit of the former file.
function takeDelete(deletes: PendingDelete[], file: FileRecord): PendingDelete[] {
  const entry = deletes.find((d) => d.path === file.path);
  if (!entry) return deletes;
  const rev = entry.conflict?.rev ?? entry.baseRev;
  if (rev > 0) file.serverRev = rev;
  if (entry.asked) file.sentDeleted = true;
  if (entry.sent !== undefined) file.sent = entry.sent;
  return deletes.filter((d) => d.path !== file.path);
}

// Unsent work of a project (section 4.1): the server waits for it.
export function unsentWork(project: ProjectRecord, files: readonly FileRecord[]): boolean {
  const sync = project.sync;
  if (!sync) return false;
  return sync.meta || sync.deletes.length > 0 || files.some(fileUnsent);
}

// Unsaved work of a project: unsent work or an editor edit.
export function unsavedWork(project: ProjectRecord, files: readonly FileRecord[]): boolean {
  return unsentWork(project, files) || files.some((f) => f.draft !== undefined);
}
