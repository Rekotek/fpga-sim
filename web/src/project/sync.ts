// Sync of browser projects with the server (accounts spec sections 4.3–4.5 (docs/tz-accounts.md)).
// Here is the exchange order: what to send, how to parse a response and a failure, when to retry. Storage fields
// and parsing a response in one transaction are in store.ts; display and calls from the workspace are in app/actions.ts.
import { ServerError } from "../build/client";
import {
  unsavedWork,
  unsentWork,
  type FileRecord,
  type ProjectRecord,
  type ProjectStore,
  type SyncReply,
} from "./store";

// A project in the server list (section 3.2).
export interface RemoteProject {
  id: string;
  name: string;
  board: string;
  rev: number;
  modified: number;
  deleted: boolean;
}

export interface SyncChange {
  path: string;
  content: string | null; // null: the file is deleted
  baseRev: number;
}

export interface SyncRequest {
  since: number;
  generation: string | null;
  meta?: { name: string; board: string };
  changes: SyncChange[];
}

// The sync response (section 3.3): ordinary, "project deleted" or "database generation differs".
export type SyncAnswer =
  | ({ deleted: false; stale?: undefined } & SyncReply)
  | { deleted: true; stale?: undefined; rev: number; generation: string }
  | { stale: true; generation: string };

export interface SyncApi {
  projects(): Promise<{ generation: string; projects: RemoteProject[] }>;
  sync(id: string, body: SyncRequest): Promise<SyncAnswer>;
  remove(id: string): Promise<void>;
}

// Project sync state (section 4.5).
export type SyncState = "synced" | "pending" | "syncing" | "offline" | "conflict" | "error";

export interface SyncStatus {
  state: SyncState;
  error: string | null; // server rejection text for the error state
}

export interface SyncHooks {
  // The server changed the content of these project files in storage.
  files(id: string, paths: string[]): void;
  // The sync state, name or board of the project changed.
  project(id: string): void;
  // There is no local copy under this identifier any more; replacedBy is the new identifier of the project
  // that was saved as new (section 4.4, item 6).
  gone(id: string, replacedBy: string | null): void;
  // The set of projects in storage changed.
  list(): void;
  // The server answered 401: the session ended.
  unauthorized(): void;
  // Before parsing a response: the workspace writes to storage the open project's editor edits
  // that still wait to be written. Without this, parsing does not see the edit and may erase its file or project.
  before?(id: string): Promise<void>;
  // The project is open in another tab: that tab syncs it (section 4.3).
  busy?(id: string): Promise<boolean>;
  // One tab syncs at a time.
  exclusive?<T>(work: () => Promise<T>): Promise<T>;
}

const MAX_CHANGES = 1000; // server limit per request
const MAX_ROUNDS = 4; // requests in a row for one project: after that, the next run
const RETRY_MS = [5_000, 15_000, 60_000]; // retry after a connection failure; then every 60 s

const sendable = (file: FileRecord): boolean => file.dirty === true && file.conflict === undefined;

const hasConflict = (project: ProjectRecord, files: readonly FileRecord[]): boolean =>
  files.some((f) => f.conflict !== undefined) || (project.sync?.deletes.some((d) => d.conflict !== undefined) ?? false);

// There is something to send right now: files and deletions without a conflict, the name or the board.
const hasSendable = (project: ProjectRecord, files: readonly FileRecord[]): boolean =>
  (project.sync?.meta ?? false) ||
  files.some(sendable) ||
  (project.sync?.deletes.some((d) => d.conflict === undefined) ?? false);

export class ProjectSync {
  private readonly statuses = new Map<string, SyncStatus>();
  private readonly trouble = new Map<string, SyncStatus>(); // failure of the last request of the project
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly attempts = new Map<string, number>();
  private readonly chains = new Map<string, Promise<void>>();
  // Projects the server rejected (413, 400): a retry only after the project changes.
  private readonly blocked = new Set<string>();
  private listing: Promise<void> | null = null;
  private stopped = false;

  constructor(
    private readonly store: ProjectStore,
    private readonly api: SyncApi,
    readonly account: string,
    private readonly hooks: SyncHooks,
    // The timer is called through a function, not an object method: the browser does not allow calling setTimeout with a foreign this.
    private readonly setTimer: (work: () => void, ms: number) => ReturnType<typeof setTimeout> = (work, ms) =>
      setTimeout(work, ms),
  ) {}

  // Stop: sign-out or a sign-in change. A running request is parsed, there are no new ones.
  stop(): void {
    this.stopped = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  // The stop may have happened while a request was in flight: the flag is read again after every wait.
  private live(): boolean {
    return !this.stopped;
  }

  status(id: string): SyncStatus | null {
    return this.statuses.get(id) ?? null;
  }

  // Sync of a project delay ms after the last change (section 4.3).
  schedule(id: string, delay = 2000): void {
    if (!this.live()) return;
    this.blocked.delete(id);
    const current = this.statuses.get(id);
    if (!current || current.state === "synced") this.setStatus(id, { state: "pending", error: null });
    clearTimeout(this.timers.get(id));
    this.timers.set(
      id,
      this.setTimer(() => {
        this.timers.delete(id);
        void this.syncProject(id);
      }, delay),
    );
  }

  // The server project list and all account projects that have something to exchange.
  async syncAll(): Promise<void> {
    if (!this.live()) return;
    this.listing ??= this.listNow().finally(() => {
      this.listing = null;
    });
    await this.listing;
  }

  // Sync of one project; requests of one project go in turn.
  syncProject(id: string): Promise<void> {
    const previous = this.chains.get(id) ?? Promise.resolve();
    const next = previous.then(() => this.guarded(id));
    this.chains.set(id, next);
    void next.finally(() => {
      if (this.chains.get(id) === next) this.chains.delete(id);
    });
    return next;
  }

  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    return this.hooks.exclusive ? this.hooks.exclusive(work) : work();
  }

  private setStatus(id: string, status: SyncStatus | null): void {
    const before = this.statuses.get(id);
    if (status === null) this.statuses.delete(id);
    else this.statuses.set(id, status);
    if (before?.state !== status?.state || before?.error !== status?.error) {
      if (this.live()) this.hooks.project(id);
    }
  }

  // The state by storage and by the outcome of the last request; a conflict outranks the rest.
  private async refresh(id: string): Promise<void> {
    const project = await this.store.getProject(id);
    if (!project?.sync || project.sync.trashed || project.account !== this.account) {
      this.setStatus(id, null);
      return;
    }
    const files = await this.store.listFiles(id);
    const trouble = this.trouble.get(id);
    if (hasConflict(project, files)) this.setStatus(id, { state: "conflict", error: null });
    else if (trouble) this.setStatus(id, trouble);
    else if (unsentWork(project, files)) this.setStatus(id, { state: "pending", error: null });
    else this.setStatus(id, { state: "synced", error: null });
  }

  private async listNow(): Promise<void> {
    let answer: { generation: string; projects: RemoteProject[] };
    try {
      answer = await this.api.projects();
    } catch (e) {
      if (e instanceof ServerError && e.status === 401) this.hooks.unauthorized();
      // The list is not received: projects with unsent work will repeat their requests themselves.
      for (const project of await this.store.syncedProjects(this.account)) this.schedule(project.id, RETRY_MS[0]);
      return;
    }
    if (!this.live()) return;
    const local = new Map((await this.store.syncedProjects(this.account)).map((p) => [p.id, p]));
    const remote = new Map(answer.projects.map((p) => [p.id, p]));
    const todo: string[] = [];
    let added = false;
    for (const project of answer.projects) {
      if (local.has(project.id) || project.deleted) continue;
      await this.store.addRemote(project, this.account, answer.generation);
      todo.push(project.id);
      added = true;
    }
    if (added) this.hooks.list();
    for (const [id, project] of local) {
      const sync = project.sync;
      if (!sync) continue;
      if (sync.generation !== "" && sync.generation !== answer.generation && !sync.trashed) {
        // The server database was restored from a backup (section 4.4, item 7).
        await this.store.resetSync(id, answer.generation);
        todo.push(id);
        continue;
      }
      const there = remote.get(id);
      const differs = !there || there.deleted || there.rev !== sync.rev || sync.trashed === true;
      if (differs || unsentWork(project, await this.store.listFiles(id))) todo.push(id);
      else if (!this.statuses.has(id)) await this.refresh(id);
    }
    for (const id of todo) await this.syncProject(id);
  }

  private async guarded(id: string): Promise<void> {
    if (!this.live() || this.blocked.has(id)) return;
    try {
      await this.exclusive(() => this.run(id));
      this.trouble.delete(id);
      this.attempts.delete(id);
    } catch (e) {
      if (e instanceof ServerError && e.status === 401) {
        // The session ended: edits stay in the browser until the next sign-in (section 5.2).
        this.trouble.set(id, { state: "offline", error: null });
        if (this.live()) this.hooks.unauthorized();
      } else if (e instanceof ServerError && e.status !== 0 && e.status < 500 && e.status !== 429) {
        // The server rejected (413, 400): a retry after the next change of the project.
        this.trouble.set(id, { state: "error", error: e.message });
        this.blocked.add(id);
      } else {
        // No network, 5xx or too frequent requests: a retry in 5, 15, 60 s, then every 60 s.
        const attempt = this.attempts.get(id) ?? 0;
        this.attempts.set(id, attempt + 1);
        this.trouble.set(id, { state: "offline", error: null });
        const delay = RETRY_MS[Math.min(attempt, RETRY_MS.length - 1)] ?? 60_000;
        if (this.live()) {
          clearTimeout(this.timers.get(id));
          this.timers.set(
            id,
            this.setTimer(() => {
              this.timers.delete(id);
              void this.syncProject(id);
            }, delay),
          );
        }
      }
    }
    await this.refresh(id);
  }

  private async run(id: string): Promise<void> {
    for (let round = 0; round < MAX_ROUNDS; round += 1) {
      // The exchange might have been stopped while the run waited for the queue or an answer: a stopped exchange sends no
      // requests and writes nothing to storage.
      if (!this.live()) return;
      const project = await this.store.getProject(id);
      if (!project?.sync || project.account !== this.account) return;
      if (await this.hooks.busy?.(id)) return;
      const sync = project.sync;
      if (sync.trashed) {
        await this.removeOnServer(id);
        return;
      }
      const files = await this.store.listFiles(id);
      const sent = new Map<string, string | null>();
      const changes: SyncChange[] = [];
      for (const file of files) {
        if (!sendable(file) || changes.length >= MAX_CHANGES) continue;
        changes.push({ path: file.path, content: file.content, baseRev: file.serverRev ?? 0 });
        sent.set(file.path, file.content);
      }
      for (const entry of sync.deletes) {
        if (entry.conflict || sent.has(entry.path) || changes.length >= MAX_CHANGES) continue;
        changes.push({ path: entry.path, content: null, baseRev: entry.baseRev });
        sent.set(entry.path, null);
      }
      const meta = sync.meta ? { name: project.name, board: project.board } : null;
      const body: SyncRequest = { since: sync.rev, generation: sync.generation || null, changes };
      if (meta) body.meta = meta;
      this.setStatus(id, { state: "syncing", error: null });
      await this.store.markSent(id, sent);
      if (!this.live()) return;
      let answer: SyncAnswer;
      try {
        answer = await this.api.sync(id, body);
      } catch (e) {
        if (!this.live()) return;
        if (e instanceof ServerError && e.status === 404 && round === 0) {
          // The server does not know the project: it is sent again in full (section 4.4, failures).
          await this.store.resetSync(id, sync.generation);
          continue;
        }
        throw e;
      }
      // Another tab opened the project during the request: the answer is not parsed, that tab runs the exchange.
      if (!this.live() || (await this.hooks.busy?.(id))) return;
      if (answer.stale) {
        await this.store.resetSync(id, answer.generation);
        continue;
      }
      await this.hooks.before?.(id);
      if (answer.deleted) {
        await this.deletedOnServer(id);
        return;
      }
      const outcome = await this.store.applySync(id, { files: sent, meta }, answer);
      if (!outcome) return;
      if (!this.live()) return;
      if (outcome.changed.length > 0) this.hooks.files(id, outcome.changed);
      if (outcome.renamed) this.hooks.project(id);
      const after = await this.store.getProject(id);
      if (!after || !hasSendable(after, await this.store.listFiles(id))) return;
    }
  }

  // The project was deleted by the user: a DELETE request, then the record is erased.
  private async removeOnServer(id: string): Promise<void> {
    try {
      await this.api.remove(id);
    } catch (e) {
      if (!(e instanceof ServerError && e.status === 404)) throw e;
    }
    if (!this.live()) return;
    await this.store.removeLocal(id);
    if (this.live()) this.hooks.list();
  }

  // The project was deleted on another device (section 4.4, item 6).
  private async deletedOnServer(id: string): Promise<void> {
    const project = await this.store.getProject(id);
    if (!project) return;
    if (unsavedWork(project, await this.store.listFiles(id))) {
      const copy = await this.store.reidProject(id);
      if (!this.live()) return;
      this.hooks.gone(id, copy);
      this.hooks.list();
      if (copy !== null) this.schedule(copy, 0);
    } else {
      await this.store.removeLocal(id);
      if (!this.live()) return;
      this.hooks.gone(id, null);
      this.hooks.list();
    }
  }
}
