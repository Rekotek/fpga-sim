// Interface actions: key, projects, files, build and run (spec sections 9.2 and 9.5).
// Objects outside React live here: the store, the editor, the server client and the current simulation.
import { BuildClient, ServerError, login, serverHealthy } from "../build/client";
import { forgetKey, forgetSession, loadKey, loadSession, saveKey, saveSession, takeKeyFromUrl } from "../build/key";
import { BoardScene } from "../board/scene";
import type { BuildResponse, Diagnostic, ProjectFile, Resolved } from "../build/types";
import { EditorHost, type EditorMark } from "../editor/host";
import { ProjectSync } from "../project/sync";
import { onBeforeLanguageChange, t, tOr } from "../i18n";
import { DEFAULT_BOARD, boardById, listExamples, partDescription, type Board } from "../project/assets";
import {
  CONFIG_FILE,
  bindPins,
  bindResolved,
  bindingSource,
  bitName,
  breadboardParts,
  configBoard,
  cstFileName,
  filesBoard,
  freeCell,
  parseConfig,
  printConfig,
  projectParts,
  toCst,
  withDefaults,
  type Binding,
  type BindingSource,
  type BoardPartChange,
  type BreadboardPart,
  type ProjectConfig,
} from "../project/config";
import {
  downloadName,
  folderPathWanted,
  importFiles,
  readArchive,
  writeArchive,
  MAX_FILES,
  type Imported,
  type Skipped,
} from "../project/files";
import {
  diskHas,
  folderAccess,
  pickFolder,
  readDiskFile,
  removeDiskFile,
  scanFolder,
  writeDiskFile,
} from "../project/folder";
import { ProjectStore, unsentWork, type ProjectRecord } from "../project/store";
import { makeConfigure, settingsOnly } from "../sim/configure";
import { CoreError, Simulation, type PartEvent } from "../sim/host";
import type {
  Command,
  Configure,
  CoreMessage,
  NoticeMessage,
  Pull,
  RecordStateMessage,
  ReplyMessage,
  SignalInfo,
  Speed,
  StateMessage,
} from "../sim/messages";
import {
  MAX_RECORD_SIGNALS,
  WATCH_RADIX,
  changeRecord,
  changeWatch,
  recordSettings,
  watchItems,
  type RecordSettings,
} from "../wave/config";
import { wordsToBigInt, type Radix } from "../wave/format";
import { modelChanges, modelFromTraces, type WaveModel } from "../wave/model";
import { clearWaves, setWaveModel, waves } from "../wave/session";
import { pinOfName } from "../wave/tree";
import { parseVcd, writeVcd } from "../wave/vcd";
import { diagnosticExplain, diagnosticLevel, diagnosticText } from "./diagnostics";
import { dropLayout, loadLayout, saveLayout, type Layout } from "./layout";
import { filePathProblem, type StepCommand } from "./speed";
import { NO_BUILD, NO_SIM, NO_TESTBENCH, useApp, type DialogState, type FolderAccess, type FolderState } from "./state";

const DRAFT_DELAY_MS = 300; // spec section 9.2
const MAX_NOTICES = 200;
const CHECK_IDLE_MS = 2000; // spec section 9.5, item 5
// Core messages without a command number that the interface accepts silently.
const KNOWN_MESSAGES = new Set(["ready"]);
const EVENT_NOTICE_MS = 250; // the part event line updates no more often than this

interface SessionFile {
  content: string; // saved content
  draft: string | null; // unsaved edit
  base: string | null; // content at project creation; null — the file was added later (decision 98)
}

let store: ProjectStore | null = null;
let client: BuildClient | null = null;
let simulation: Simulation | null = null;
let openSeq = 0; // number of the last project open: an earlier one is dropped
let buildSeq = 0; // number of the last build: the reply to an earlier one is dropped
let checkSeq = 0; // number of the last check: the reply to an earlier one is dropped
let checkTimer: ReturnType<typeof setTimeout> | null = null;
let scene: BoardScene | null = null; // board drawing of the open project
let lastConfigure: Configure | null = null; // the configure in effect in the core
let configQueue: Promise<void> = Promise.resolve(); // core setting changes go one at a time
let storeQueue: Promise<unknown> = Promise.resolve(); // project file writes go one at a time

// Saving edits and writing fpgasim.json from a dialog do not interleave: otherwise a write started
// earlier could finish later and put the old text back into the store.
function serial<T>(work: () => Promise<T>): Promise<T> {
  const next = storeQueue.then(work, work);
  storeQueue = next.catch(() => undefined);
  return next;
}
// The session file set. Any change of the set queues a comparison with the last build.
class SessionFiles extends Map<string, SessionFile> {
  override set(path: string, file: SessionFile): this {
    super.set(path, file);
    scheduleStale();
    return this;
  }
  override delete(path: string): boolean {
    scheduleStale();
    return super.delete(path);
  }
  override clear(): void {
    super.clear();
    scheduleStale();
  }
}
const sessionFiles = new SessionFiles();

// The fingerprint of what goes into a build: project files with an unsaved edit and the design settings
// (the design field). Pin binding and parts take effect without a build and are not in the fingerprint.
let builtPrint: string | null = null; // fingerprint of the build the core was loaded from
let stalePending = false;

function sourcePrint(): string {
  const parts: string[] = [];
  for (const [path, file] of [...sessionFiles].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const text = file.draft ?? file.content;
    if (path !== CONFIG_FILE) parts.push(path, text);
    else {
      // A settings file without a design field equals no file: the build does not depend on it.
      const design = parseConfig(text)?.design;
      if (design !== undefined) parts.push(path, JSON.stringify(design));
    }
  }
  return parts.join("\u0000");
}

function refreshStale(): void {
  stalePending = false;
  const stale = builtPrint !== null && builtPrint !== sourcePrint();
  if (useApp.getState().stale !== stale) useApp.setState({ stale });
}

function scheduleStale(): void {
  if (stalePending) return;
  stalePending = true;
  queueMicrotask(refreshStale);
}
const draftTimers = new Map<string, ReturnType<typeof setTimeout>>();

const set = useApp.setState;
const get = useApp.getState;

export const editor = new EditorHost({
  onChange: (path, text) => {
    changeFile(path, text);
  },
  onSave: () => {
    void save();
  },
  onBuild: () => {
    void build();
  },
});

export function currentSimulation(): Simulation | null {
  return simulation;
}

export function currentScene(): BoardScene | null {
  return scene;
}

async function db(): Promise<ProjectStore> {
  store ??= await ProjectStore.open();
  return store;
}

// ---- Project sync with the server (accounts spec sections 4.3–4.5, docs/tz-accounts.md) ----

let sync: ProjectSync | null = null;
let syncClient: BuildClient | null = null; // the sign-in client the exchange runs under
let syncPoll: ReturnType<typeof setInterval> | null = null;
let releaseProject: (() => void) | null = null; // lock "project is open in this tab"
let lockedProject: string | null = null;
// The counter of content replacements by the server that the workspace saw for a file (FileRecord.remoteSeq).
// Every save names it: text started before a replacement gives a mismatch and does not overwrite another's edit.
const seenSeq = new Map<string, number>();
const SYNC_POLL_MS = 30_000;
const projectLock = (id: string): string => `fpgasim-project-${id}`;
const hasLocks = (): boolean => "locks" in navigator;

// Sync runs on a session sign-in; on an access-key sign-in and without sign-in there is none.
async function startSync(account: string): Promise<void> {
  // The exchange goes to the server with the client of its own sign-in, not the current one: a request that outlived a sign-out
  // does not go out under the label of the next account.
  const server = client;
  if (!server) return;
  if (sync?.account === account && syncClient === server) return;
  stopSync();
  const database = await db();
  if (client !== server) return; // the sign-in changed while the store was opening
  syncClient = server;
  const engine = new ProjectSync(
    database,
    {
      projects: () => server.projects(),
      sync: (id, body) => server.syncProject(id, body),
      remove: (id) => server.removeProject(id),
    },
    account,
    {
      files: (id, paths) => {
        if (get().project?.id === id) void serial(() => applyRemote(id, paths));
      },
      project: (id) => {
        void syncChanged(engine, id);
      },
      gone: (id, copy) => {
        void projectGone(id, copy);
      },
      list: () => {
        void refreshProjects();
      },
      unauthorized: () => {
        if (sync === engine) credentialRejected();
      },
      // Editor edits that wait for a write reach the store before the reply is parsed.
      before: async (id) => {
        if (get().project?.id === id) await flushDrafts();
      },
      // A project open in another tab is synced by that tab.
      busy: async (id) => {
        if (!hasLocks() || lockedProject === id) return false;
        const held = (await navigator.locks.query()).held ?? [];
        return held.some((lock) => lock.name === projectLock(id));
      },
      exclusive: <T>(work: () => Promise<T>): Promise<T> =>
        hasLocks() ? navigator.locks.request("fpgasim-sync", work) : work(),
    },
  );
  sync = engine;
  database.onChange = (id) => {
    sync?.schedule(id);
  };
  void engine.syncAll();
}

function stopSync(): void {
  sync?.stop();
  sync = null;
  syncClient = null;
  if (store) store.onChange = null;
  set({ sync: {} });
}

// The project sync state changed; the name and board may have come from the server.
async function syncChanged(engine: ProjectSync, id: string): Promise<void> {
  if (sync !== engine) return;
  const states = { ...get().sync };
  const status = engine.status(id);
  if (status) states[id] = status;
  else Reflect.deleteProperty(states, id);
  set({ sync: states });
  const fresh = await (await db()).getProject(id);
  if (!fresh) return;
  const open = get().project;
  if (open?.id === id && (open.name !== fresh.name || open.board !== fresh.board)) set({ project: fresh });
  const listed = get().projects.find((p) => p.id === id);
  if (listed && (listed.name !== fresh.name || listed.board !== fresh.board)) await refreshProjects();
}

// The server changed files of the open project in the store: the workspace takes them the same way as new
// content from disk for a project in a folder. An unsaved editor edit stays.
async function applyRemote(id: string, paths: string[] | null): Promise<void> {
  if (get().project?.id !== id) return;
  const database = await db();
  const records = new Map((await database.listFiles(id)).map((f) => [f.path, f]));
  if (get().project?.id !== id) return;
  let changed = false;
  // paths = null — compare all workspace files with the store.
  for (const path of paths ?? new Set([...records.keys(), ...sessionFiles.keys()])) {
    const record = records.get(path);
    const file = sessionFiles.get(path);
    if (!record) {
      if (!file) continue;
      if (file.draft !== null) {
        // The file was deleted on the server, and the editor has an edit that was not in the store: the record
        // is created again, so the edit survives closing the page.
        await database.reviveFile(id, path, file.content, file.draft);
        continue;
      }
      clearTimeout(draftTimers.get(path));
      draftTimers.delete(path);
      sessionFiles.delete(path);
      seenSeq.delete(path);
      editor.close(path);
      changed = true;
    } else if (file) {
      if (file.content === record.content) continue;
      file.content = record.content;
      if (file.draft === record.content) file.draft = null;
      // Without an edit the editor shows the new text, and the workspace "saw" this replacement. With an edit
      // the counter stays the same: saving the edit gives a mismatch (section 4.1).
      if (file.draft === null) {
        editor.replace(path, record.content);
        seenSeq.set(path, record.remoteSeq ?? 0);
      }
      changed = true;
    } else {
      sessionFiles.set(path, { content: record.content, draft: record.draft ?? null, base: record.base ?? null });
      seenSeq.set(path, record.remoteSeq ?? 0);
      changed = true;
    }
  }
  if (!changed) return;
  const files = sortedEntries();
  const active = get().activePath;
  set({ files, activePath: active !== null && sessionFiles.has(active) ? active : null });
  const next = files[0];
  if (get().activePath === null && next) selectFile(next.path);
  void applyConfig();
  scheduleCheck();
}

// The project was deleted on another device (section 4.4, item 6). copy is the identifier under which
// a project with unsaved work was saved as a new one.
async function projectGone(id: string, copy: string | null): Promise<void> {
  dropLayout(id);
  const open = get().project;
  if (open?.id === id) {
    const database = await db();
    for (const timer of draftTimers.values()) clearTimeout(timer);
    draftTimers.clear();
    const unsaved = [...sessionFiles].some(([, file]) => file.draft !== null);
    let target = copy;
    if (target === null && unsaved) {
      // The copy was erased, and the editor has an edit that was not in the store: the project is created
      // again from the workspace files.
      const files = [...sessionFiles].map(([path, file]) => ({ path, content: file.content }));
      target = (await database.createProject(open.name, open.board, files, undefined, ownerLogin())).id;
    }
    if (target !== null) {
      // Saves and editor edits that did not reach the store under the old identifier
      // are written under the new one.
      const stored = new Map((await database.listFiles(target)).map((f) => [f.path, f]));
      for (const [path, file] of sessionFiles) {
        const record = stored.get(path);
        if (record && record.content !== file.content) await database.saveFile(target, path, file.content);
        if (file.draft !== null) await database.putDraft(target, path, file.draft);
      }
      await openProject(target);
      set({ syncNotice: "copied" });
    } else {
      await closeProject();
      set({ syncNotice: "deleted" });
    }
  }
  await refreshProjects();
}

export function dropBusyProject(): void {
  set({ busyProject: null });
}

export function dropSyncNotice(): void {
  set({ syncNotice: null });
}

// A browser project on a session sign-in is open in one tab only (section 4.3): the tab keeps
// files in memory and does not see changes that another tab got from the server.
function holdProject(id: string): Promise<boolean> {
  if (!hasLocks()) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    void navigator.locks.request(projectLock(id), { ifAvailable: true }, (lock) => {
      if (!lock) {
        resolve(false);
        return undefined;
      }
      return new Promise<void>((release) => {
        releaseProject = release;
        lockedProject = id;
        resolve(true);
      });
    });
  });
}

function dropProjectHold(): void {
  releaseProject?.();
  releaseProject = null;
  lockedProject = null;
  if (syncPoll !== null) clearInterval(syncPoll);
  syncPoll = null;
}

// While the project is open and the tab is visible, server changes are requested every 30 s.
function watchProject(id: string): void {
  sync?.schedule(id, 0);
  syncPoll = setInterval(() => {
    if (document.visibilityState === "visible") void sync?.syncProject(id);
  }, SYNC_POLL_MS);
}

// The sync state of the open project for window.__fpgasim (section 5.7).
export async function syncReport(): Promise<{
  state: string;
  error: string | null;
  rev: number;
  pending: string[];
  conflicts: string[];
} | null> {
  const open = get().project;
  if (!open || !sync) return null;
  const database = await db();
  const project = await database.getProject(open.id);
  if (!project?.sync) return null;
  const files = await database.listFiles(open.id);
  const deletes = project.sync.deletes;
  const status = sync.status(open.id);
  return {
    state: status?.state ?? "pending",
    error: status?.error ?? null,
    rev: project.sync.rev,
    pending: [
      ...files.filter((f) => f.dirty && !f.conflict).map((f) => f.path),
      ...deletes.filter((d) => !d.conflict).map((d) => d.path),
    ].sort(),
    conflicts: [
      ...files.filter((f) => f.conflict).map((f) => f.path),
      ...deletes.filter((d) => d.conflict).map((d) => d.path),
    ].sort(),
  };
}

// Sync of the list and the open project now; it finishes after the reply is parsed.
export async function syncNow(): Promise<void> {
  await flushDrafts();
  await sync?.syncAll();
  const open = get().project;
  if (open) await sync?.syncProject(open.id);
  await serial(() => Promise.resolve());
}

// ---- Mismatch, sign-out with unsent work, viewing others' work (accounts spec sections 5.3–5.6, docs/tz-accounts.md) ----

// Mismatches of the open project whose dialog has already opened: the dialog opens by itself only on
// the first appearance of a mismatch. The queue holds the files whose dialog waits for the current one to close.
const conflictSeen = new Set<string>();
let conflictQueue: string[] = [];
let conflictProject: string | null = null;
let conflictRead: Promise<void> = Promise.resolve();

// Paths of open project files with a mismatch: files with the conflict field and files deleted
// in the browser that have a new version on the server.
async function conflictsOf(id: string): Promise<string[]> {
  const database = await db();
  const project = await database.getProject(id);
  if (!project?.sync) return [];
  const files = await database.listFiles(id);
  return [
    ...files.filter((f) => f.conflict !== undefined).map((f) => f.path),
    ...project.sync.deletes.filter((d) => d.conflict !== undefined).map((d) => d.path),
  ].sort();
}

// Comparison of the open project's mismatches with the store: marks in the file list and the dialog queue.
export function refreshConflicts(): Promise<void> {
  conflictRead = conflictRead.then(readConflicts, readConflicts);
  return conflictRead;
}

async function readConflicts(): Promise<void> {
  const id = get().project?.id ?? null;
  if (id !== conflictProject) {
    conflictSeen.clear();
    conflictQueue = [];
    conflictProject = id;
    if (get().conflictOpen !== null) set({ conflictOpen: null });
  }
  const paths = id === null ? [] : await conflictsOf(id);
  if ((get().project?.id ?? null) !== id) return;
  for (const path of [...conflictSeen]) if (!paths.includes(path)) conflictSeen.delete(path);
  const fresh = paths.filter((path) => !conflictSeen.has(path));
  for (const path of fresh) conflictSeen.add(path);
  conflictQueue = [...conflictQueue.filter((path) => paths.includes(path)), ...fresh];
  const shown = get().conflictOpen;
  const next = shown !== null && paths.includes(shown) ? shown : (conflictQueue.shift() ?? null);
  if (next !== null) conflictQueue = conflictQueue.filter((path) => path !== next);
  const before = get().conflictPaths;
  if (before.join("\u0000") !== paths.join("\u0000") || shown !== next)
    set({ conflictPaths: paths, conflictOpen: next });
}

// The sync state, the open project or the file list changed: mismatches are read again.
useApp.subscribe((state, prev) => {
  if (state.project?.id !== prev.project?.id || state.sync !== prev.sync || state.files !== prev.files) {
    void refreshConflicts();
  }
});

// A click on the "Conflict" indicator in the status bar: the dialogs of all mismatches, one by one.
export function showConflicts(): void {
  const [first, ...rest] = get().conflictPaths;
  conflictQueue = rest;
  set({ conflictOpen: first ?? null });
}

// "Later": the dialog closes, the mismatch stays; the dialog of the next file opens.
export function postponeConflict(): void {
  set({ conflictOpen: conflictQueue.shift() ?? null });
}

// Two versions of a file with a mismatch; null — the file has no mismatch. My version is what is seen
// in the editor (with an unsaved edit); null — the file is deleted.
export async function conflictVersions(path: string): Promise<{ mine: string | null; server: string | null } | null> {
  const open = get().project;
  if (!open) return null;
  const database = await db();
  const record = (await database.listFiles(open.id)).find((f) => f.path === path);
  if (record?.conflict) {
    const file = sessionFiles.get(path);
    return { mine: file ? currentText(file) : (record.draft ?? record.content), server: record.conflict.content };
  }
  const entry = (await database.getProject(open.id))?.sync?.deletes.find((d) => d.path === path);
  return entry?.conflict ? { mine: null, server: entry.conflict.content } : null;
}

// "Keep mine": the file goes to the server over the server version. The unsaved edit is saved
// first: what goes to the server is what the user saw in the dialog.
export async function keepMine(path: string): Promise<void> {
  const project = get().project;
  if (!project) return;
  const file = sessionFiles.get(path);
  if (file?.draft != null) {
    await serial(async () => {
      clearTimeout(draftTimers.get(path));
      draftTimers.delete(path);
      const text = file.draft;
      if (text === null) return;
      file.content = text;
      file.draft = null;
      markDirty(path, false);
      await writeOut(project, path, text);
    });
  }
  await (await db()).resolveConflict(project.id, path, "mine");
  await refreshConflicts();
  await sync?.syncProject(project.id);
}

// "Take from server": the server version replaces the browser content and the unsaved edit; a file
// deleted in the browser comes back, a file deleted on the server leaves the project.
export async function takeServer(path: string): Promise<void> {
  const project = get().project;
  if (!project) return;
  clearTimeout(draftTimers.get(path));
  draftTimers.delete(path);
  await serial(async () => {
    await (await db()).resolveConflict(project.id, path, "server");
    await reloadFiles(project.id, [path]);
  });
  await refreshConflicts();
}

// Files of the open project are taken from the store again together with the unsaved edit: unlike
// applyRemote, the editor edit does not stay.
async function reloadFiles(id: string, paths: string[]): Promise<void> {
  const records = new Map((await (await db()).listFiles(id)).map((f) => [f.path, f]));
  if (get().project?.id !== id) return;
  for (const path of paths) {
    const record = records.get(path);
    if (!record) {
      sessionFiles.delete(path);
      seenSeq.delete(path);
      editor.close(path);
      continue;
    }
    const file = sessionFiles.get(path);
    if (file) {
      file.content = record.content;
      file.draft = record.draft ?? null;
    } else sessionFiles.set(path, { content: record.content, draft: null, base: record.base ?? null });
    editor.replace(path, record.draft ?? record.content);
    seenSeq.set(path, record.remoteSeq ?? 0);
  }
  const files = sortedEntries();
  const active = get().activePath;
  set({ files, activePath: active !== null && sessionFiles.has(active) ? active : null });
  const next = files[0];
  if (get().activePath === null && next) selectFile(next.path);
  void applyConfig();
  scheduleCheck();
}

// File name of a version for "Download both": top.v → top.mine.v and top.server.v.
export function conflictFileName(path: string, side: "mine" | "server"): string {
  const name = path.split("/").pop() ?? path;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? `${name.slice(0, dot)}.${side}${name.slice(dot)}` : `${name}.${side}`;
}

// "Download both": two versions of the file to disk; a deleted version is not downloaded. The dialog stays.
export async function downloadConflict(path: string): Promise<void> {
  const versions = await conflictVersions(path);
  if (!versions) return;
  for (const side of ["mine", "server"] as const) {
    const text = versions[side];
    if (text !== null) saveBytes(conflictFileName(path, side), new TextEncoder().encode(text), "text/plain");
  }
}

// Projects of the signed-in account with unsent work (section 4.1).
async function unsentProjects(): Promise<ProjectRecord[]> {
  const access = get().access;
  if (access.kind !== "session") return [];
  const database = await db();
  const left: ProjectRecord[] = [];
  for (const project of await database.syncedProjects(access.user.login)) {
    if (project.sync?.trashed) continue;
    if (unsentWork(project, await database.listFiles(project.id))) left.push(project);
  }
  return left;
}

const SIGN_OUT_TRY_MS = 5_000; // "Sign out": how long to wait for sending before the dialog shows
const SIGN_OUT_SEND_MS = 20_000; // "Send and sign out": how long to wait for sending

// Sending the unsent work in all projects of the account; no longer than ms: the network may not answer at all.
async function sendUnsent(ms: number): Promise<void> {
  const engine = sync;
  if (!engine) return;
  const work = (async () => {
    await engine.syncAll();
    for (const project of await unsentProjects()) await engine.syncProject(project.id);
  })();
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    work,
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, ms);
    }),
  ]);
  clearTimeout(timer);
}

// "Sign out" (section 5.3). Unsent work goes to the server first (usually an edit of the last
// seconds); what could not be sent is named by the "Not everything is saved on the server" dialog.
export async function requestSignOut(): Promise<void> {
  await flushDrafts();
  if ((await unsentProjects()).length > 0) await sendUnsent(SIGN_OUT_TRY_MS);
  if ((await unsentProjects()).length === 0) await signOut();
  else set({ exitAsk: { busy: false, problem: null } });
}

// "Send and sign out": sign-out happens only when everything is sent; otherwise the dialog names the reason.
export async function sendAndSignOut(): Promise<void> {
  set({ exitAsk: { busy: true, problem: null } });
  const engine = sync;
  await sendUnsent(SIGN_OUT_SEND_MS);
  const left = await unsentProjects();
  if (get().exitAsk === null) return; // the user closed the dialog while sending ran
  if (left.length === 0) {
    set({ exitAsk: null });
    await signOut();
    return;
  }
  const states = get().sync;
  const offline =
    !engine || left.some((p) => ["offline", "pending", "syncing"].includes(states[p.id]?.state ?? "offline"));
  const problem = offline ? t("exit.unreachable") : t("exit.left", { names: left.map((p) => p.name).join(", ") });
  set({ exitAsk: { busy: false, problem } });
}

export function staySignedIn(): void {
  set({ exitAsk: null });
}

// A user's project list on the "Users" page (section 5.6).
export async function showUserProjects(name: string): Promise<void> {
  set({ userProjects: { login: name, projects: null, error: null } });
  const server = client;
  try {
    if (!server) throw new ServerError(0, "NETWORK", "no session");
    const projects = await server.userProjects(name);
    if (get().userProjects?.login === name) set({ userProjects: { login: name, projects, error: null } });
  } catch (e) {
    const error = failure(e);
    if (get().userProjects?.login === name) set({ userProjects: { login: name, projects: null, error } });
  }
}

export function closeUserProjects(): void {
  set({ userProjects: null });
}

// "Open to view": the user's project is loaded as a temporary copy of the administrator
// and opened; the earlier copy of the same project is replaced. Returns the refusal text or null.
export async function viewUserProject(id: string): Promise<string | null> {
  const server = client;
  const access = get().access;
  if (!server || access.kind !== "session") return t("account.unreachable");
  try {
    const remote = await server.adminProject(id);
    const source = { login: remote.login, id: remote.id, name: remote.name, board: remote.board };
    const copy = await (await db()).createView(source, remote.files, access.user.login);
    set({ userProjects: null, screen: "projects", users: null, usersError: null });
    await refreshProjects();
    await openProject(copy.id);
    return null;
  } catch (e) {
    return failure(e);
  }
}

// "Restore from trash": the project is back in the user's list. Returns the refusal text or null.
export async function restoreUserProject(id: string): Promise<string | null> {
  const server = client;
  const name = get().userProjects?.login;
  if (!server || name === undefined) return t("account.unreachable");
  try {
    await server.restoreProject(id);
  } catch (e) {
    return failure(e);
  }
  await showUserProjects(name);
  return null;
}

// "Make my copy": the temporary copy becomes the administrator's project with a new
// identifier and goes to the server.
export async function claimViewProject(id: string): Promise<void> {
  const next = await (await db()).claimView(id);
  if (next === null) return;
  dropLayout(id);
  if (get().project?.id === id) await openProject(next);
  await refreshProjects();
}

// ---- Sign-in: key or session (accounts spec section 5.1, docs/tz-accounts.md) ----

// Sign-in data of the last check: for "Retry", when the server did not answer.
type Credential = { kind: "key"; token: string; linked: boolean } | { kind: "session"; token: string };
let lastCredential: Credential | null = null;

// Check of saved sign-in data through /v1/info.
async function checkCredential(credential: Credential): Promise<void> {
  lastCredential = credential;
  set({ authStatus: "checking", authProblem: null, authText: null });
  const candidate = new BuildClient(credential.token);
  try {
    const info = await candidate.info();
    client = candidate;
    if (info.auth === "session" && info.user) {
      saveSession(credential.token, info.user.login);
      set({ access: { kind: "session", user: info.user }, pendingLogin: null });
      await startSync(info.user.login);
    } else {
      saveKey(credential.token);
      set({ access: { kind: "key", owner: info.owner }, pendingLogin: null });
      stopSync();
    }
    set({ authStatus: "ok", owner: info.owner, serverOk: true });
  } catch (e) {
    client = null;
    if (e instanceof ServerError && e.status === 401) {
      lastCredential = null;
      if (credential.kind === "key") forgetKey();
      else forgetSession();
      // A key from the link that the server did not accept is named in the sign-in form (section 5.1).
      const problem = credential.kind === "key" && credential.linked ? "keyRejected" : null;
      set({ authStatus: "missing", authProblem: problem, access: { kind: "none" }, owner: null, pendingLogin: null });
    } else {
      // The server did not answer: the sign-in data is not rejected, the saved data stays, the check can be repeated.
      set({ authStatus: "unreachable", authProblem: "unreachable", owner: null, serverOk: false });
    }
  }
  await refreshProjects();
}

export async function retryAuth(): Promise<void> {
  if (lastCredential !== null) await checkCredential(lastCredential);
}

// Sign-in by login and password. The session label replaces the saved key; "nobody's" browser projects
// pass to the signed-in account (section 4.2). Returns true on success.
export async function signIn(name: string, password: string): Promise<boolean> {
  set({ authProblem: null, authText: null });
  try {
    const response = await login(name, password);
    const before = get().access;
    const previous = before.kind === "session" ? before.user.login : get().pendingLogin;
    saveSession(response.token, response.user.login);
    client = new BuildClient(response.token);
    lastCredential = { kind: "session", token: response.token };
    const adopted = await (await db()).adoptProjects(response.user.login);
    set({
      authStatus: "ok",
      access: { kind: "session", user: response.user },
      owner: response.user.login,
      pendingLogin: null,
      serverOk: true,
      sessionExpired: false,
      adopted,
      screen: "projects",
      users: null,
    });
    // Sign-in of another account while a project is open: the project closes, its copy stays with the previous
    // account (section 5.2).
    const open = get().project;
    if (open && open.kind === "browser" && previous !== null && previous !== response.user.login) await closeProject();
    await refreshProjects();
    await startSync(response.user.login);
    return true;
  } catch (e) {
    if (e instanceof ServerError && e.status === 401) set({ authProblem: "badCredentials" });
    else if (e instanceof ServerError && e.code === "LOGIN_LOCKED") set({ authProblem: "locked" });
    else if (e instanceof ServerError && e.status !== 0 && e.status < 500) {
      set({ authProblem: "failed", authText: e.message });
    } else set({ authProblem: "unreachable", serverOk: false });
    set({ authStatus: "missing" });
    return false;
  }
}

// "Sign out": erases what is saved — the session label or the key. Local project copies stay
// with the account and are hidden until its next sign-in (section 4.2).
export async function signOut(): Promise<void> {
  const server = client;
  const access = get().access;
  stopSync();
  client = null;
  lastCredential = null;
  forgetSession();
  forgetKey();
  if (get().project) await closeProject();
  set({
    authStatus: "missing",
    authProblem: null,
    authText: null,
    access: { kind: "none" },
    owner: null,
    pendingLogin: null,
    sessionExpired: false,
    adopted: 0,
    screen: "projects",
    users: null,
    userProjects: null,
    exitAsk: null,
  });
  await refreshProjects();
  // The session is closed on the server too; a network failure does not hold up sign-out.
  if (server && access.kind === "session") await server.logout().catch(() => undefined);
}

// The server answered 401 to a request: the key or the session no longer works. With an open project
// work in the browser continues, and a "Session ended" strip appears above the workspace (section 5.2).
function credentialRejected(): void {
  const access = get().access;
  // Sync stops until the next sign-in: edits stay in the browser.
  stopSync();
  client = null;
  lastCredential = null;
  if (access.kind === "session") forgetSession();
  else forgetKey();
  const expired = get().project !== null && access.kind === "session";
  set({
    authStatus: "missing",
    authProblem: null,
    sessionExpired: expired,
    owner: null,
    screen: "projects",
    users: null,
    // The account stays known while its project is open: a sign-in of the same account continues the work.
    ...(expired ? {} : { access: { kind: "none" } as const }),
  });
}

export function dropAdopted(): void {
  set({ adopted: 0 });
}

// The login of the account whose browser projects are visible; null — "nobody's" projects are visible (access-key sign-in).
// undefined — no sign-in, browser projects are not visible.
function visibleAccount(): string | null | undefined {
  const { access, pendingLogin, authStatus } = get();
  if (access.kind === "session") return access.user.login;
  if (access.kind === "key") return null;
  // The server did not answer: projects of the saved sign-in data are visible.
  if (authStatus === "unreachable" && lastCredential) return lastCredential.kind === "key" ? null : pendingLogin;
  return undefined;
}

// Project visibility under the current sign-in (section 4.2): projects in a folder are always visible.
function visible(project: ProjectRecord): boolean {
  if (project.kind === "folder") return true;
  const account = visibleAccount();
  if (account === undefined) return false;
  return (project.account ?? null) === account;
}

// The owner login for a new browser project; without a session the project is "nobody's".
function ownerLogin(): string | undefined {
  const { access, authStatus, pendingLogin } = get();
  if (access.kind === "session") return access.user.login;
  // The server did not answer at startup: the project belongs to the account of the saved session.
  if (authStatus === "unreachable" && lastCredential?.kind === "session") return pendingLogin ?? undefined;
  return undefined;
}

export function currentAccount(): {
  kind: "none" | "key" | "session";
  login: string | null;
  name: string | null;
  role: string | null;
  expired: boolean;
} {
  const { access, sessionExpired } = get();
  if (access.kind === "session") {
    const { login: name, name: shown, role } = access.user;
    return { kind: sessionExpired ? "none" : "session", login: name, name: shown, role, expired: sessionExpired };
  }
  if (access.kind === "key") return { kind: "key", login: null, name: access.owner, role: null, expired: false };
  return { kind: "none", login: null, name: null, role: null, expired: sessionExpired };
}

// ---- Password change and users (sections 5.3 and 5.6) ----

// A server refusal for display in a dialog: the server text, or a general text on a network failure.
function failure(e: unknown): string {
  if (e instanceof ServerError && e.status === 401) credentialRejected();
  if (e instanceof ServerError && e.status > 0 && e.status < 500) return e.message;
  return t("account.unreachable");
}

// Changing your own password. Returns null on success or the refusal text.
export async function changeOwnPassword(current: string, next: string): Promise<string | null> {
  const server = client;
  if (!server) return t("account.unreachable");
  try {
    await server.changePassword(current, next);
    return null;
  } catch (e) {
    // A wrong current password gives 401 with the code BAD_CREDENTIALS: the session stays valid.
    if (e instanceof ServerError && e.code === "BAD_CREDENTIALS") return t("password.wrongCurrent");
    return failure(e);
  }
}

export async function showUsers(): Promise<void> {
  set({ screen: "users" });
  await loadUsers();
}

export function showProjects(): void {
  set({ screen: "projects", users: null, usersError: null, busyProject: null, userProjects: null });
  void sync?.syncAll();
}

export async function loadUsers(): Promise<string | null> {
  const server = client;
  if (!server) return t("account.unreachable");
  try {
    set({ users: await server.users(), usersError: null });
    return null;
  } catch (e) {
    const text = failure(e);
    set({ usersError: text });
    return text;
  }
}

// An action on an account from the "Users" page: after it the list is read again.
// Returns the action result or the refusal text.
async function adminAction<T>(work: (server: BuildClient) => Promise<T>): Promise<{ ok: T } | { error: string }> {
  const server = client;
  if (!server) return { error: t("account.unreachable") };
  try {
    const ok = await work(server);
    await loadUsers();
    return { ok };
  } catch (e) {
    return { error: failure(e) };
  }
}

export const addUser = (user: { login: string; name: string; role: string }) =>
  adminAction((server) => server.addUser(user));
export const updateUser = (name: string, change: { name?: string; role?: string; enabled?: boolean }) =>
  adminAction((server) => server.updateUser(name, change));
export const resetUserPassword = (name: string) => adminAction((server) => server.resetPassword(name));
export const deleteUser = (name: string) => adminAction((server) => server.deleteUser(name));

// ---- Application start ----

const projectFromUrl = (): string | null => /^#p=(.+)$/.exec(location.hash)?.[1] ?? null;

// Order (section 5.1): the key from the link; otherwise the saved session label; otherwise the saved key;
// otherwise the sign-in form.
export async function init(): Promise<void> {
  const linked = takeKeyFromUrl();
  if (linked) saveKey(linked); // the key from the link erases the saved session label
  const session = linked ? null : loadSession();
  const key = linked ?? loadKey();
  void serverHealthy().then((ok) => {
    set({ serverOk: ok });
  });
  const open = projectFromUrl();
  // The server did not answer at startup: the sign-in repeats by itself when the network returns and every 30 s, otherwise
  // the exchange would not start without the "Retry" button.
  window.addEventListener("online", () => {
    if (get().authStatus === "unreachable") void retryAuth();
    else void sync?.syncAll();
  });
  setInterval(() => {
    if (get().authStatus === "unreachable" && document.visibilityState === "visible") void retryAuth();
  }, SYNC_POLL_MS);
  if (session) {
    set({ pendingLogin: session.login });
    await checkCredential({ kind: "session", token: session.token });
  } else if (key) await checkCredential({ kind: "key", token: key, linked: linked !== null });
  else {
    set({ authStatus: "missing" });
    await refreshProjects();
  }
  // The project from the address opens if it is visible under this sign-in.
  if (open && get().projects.some((p) => p.id === open)) await openProject(open);
  else if (open) history.replaceState(null, "", location.pathname + location.search);
}

// ---- Projects ----

export async function refreshProjects(): Promise<void> {
  // A project deleted by the user waits for a server request and does not show in the list.
  set({ projects: (await (await db()).listProjects()).filter((p) => visible(p) && !p.sync?.trashed) });
}

// Report on moving files: what was not taken into the project and why, or a refusal of everything.
function report(imported: Imported | null, error: string | null): void {
  set({ transfer: { skipped: imported?.skipped ?? [], error } });
}

export function dropTransfer(): void {
  set({ transfer: null });
}

// A non-default board is written to fpgasim.json: the server takes the board from this file.
export async function createEmptyProject(board: string = DEFAULT_BOARD): Promise<void> {
  const files: ProjectFile[] = [{ path: "top.v", content: "" }];
  if (board !== DEFAULT_BOARD) files.push({ path: CONFIG_FILE, content: printConfig({ format: 1, board }) });
  const project = await (await db()).createProject(t("projects.newName"), board, files, undefined, ownerLogin());
  await openProject(project.id);
}

export async function createFromExample(name: string): Promise<void> {
  const example = listExamples().find((e) => e.name === name);
  if (!example) return;
  const project = await (
    await db()
  ).createProject(name, filesBoard(example.files), example.files, undefined, ownerLogin());
  await openProject(project.id);
}

export async function deleteProject(id: string): Promise<void> {
  await (await db()).deleteProject(id);
  dropLayout(id);
  await refreshProjects();
}

// ask — opening on a user click: the browser may ask for folder permission at once.
export async function openProject(id: string, ask = false): Promise<void> {
  const seq = ++openSeq;
  await flushDrafts();
  const database = await db();
  const stored = await database.getProject(id);
  const files = stored ? await database.listFiles(id) : [];
  // Another project was opened during the read: this open is stale.
  if (seq !== openSeq) return;
  if (!stored) {
    history.replaceState(null, "", location.pathname + location.search);
    return;
  }
  let project = stored;
  dropProjectHold();
  if (project.sync && !(await holdProject(id))) {
    // The project is open in another tab (section 4.3).
    if (seq !== openSeq) return;
    if (get().project) await closeProject();
    set({ busyProject: project.name });
    history.replaceState(null, "", location.pathname + location.search);
    return;
  }
  if (seq !== openSeq) {
    dropProjectHold();
    return;
  }
  buildSeq += 1; // the build reply of the previous project is dropped
  cancelCheck();
  stopSimulation();
  clearWaves();
  dropTestbench();
  editor.clear();
  sessionFiles.clear();
  seenSeq.clear();
  stopFolder();
  for (const file of files) {
    sessionFiles.set(file.path, { content: file.content, draft: file.draft ?? null, base: file.base ?? null });
    // An edit started before the server replaced the content remembers the counter it was started at.
    const seen = file.draft !== undefined ? (file.draftSeq ?? file.remoteSeq) : file.remoteSeq;
    seenSeq.set(file.path, seen ?? 0);
  }
  // The design file opens first. A testbench is recognized here by the file name (tb_*, *_tb): the file
  // roles will be named by the server later, and the interface does not parse Verilog.
  const verilog = files.filter((f) => /\.(v|sv)$/i.test(f.path));
  const first = verilog.find((f) => !/(^|\/)(tb_[^/]*|[^/]*_tb)\.\w+$/i.test(f.path)) ?? verilog[0] ?? files[0];
  const config = readConfig();
  // The board is set by fpgasim.json; the project record keeps a copy of it for the list.
  if (config && configBoard(config) !== project.board) {
    project = { ...project, board: configBoard(config) };
    void storeBoard(project);
  }
  const board = boardById(project.board);
  scene = board ? new BoardScene(board) : null;
  if (board) scene?.setParts(projectParts(board, config));
  set({
    config,
    resolved: null,
    builds: 0,
    dialog: null,
    project,
    files: files.map((f) => ({ path: f.path, dirty: f.draft !== undefined })),
    activePath: null,
    build: NO_BUILD,
    diagnostics: [],
    notices: [],
    busyProject: null,
    syncNotice: null,
    speed: initialSpeed(),
    checks: 0,
    layout: loadLayout(id),
    folder:
      project.kind === "folder"
        ? { access: "checking", autoBuild: project.autoBuild ?? true, error: null, syncs: 0, changes: 0 }
        : null,
  });
  history.replaceState(null, "", `${location.pathname}${location.search}#p=${id}`);
  if (first) selectFile(first.path);
  // A project in a folder: files are taken from disk if the browser gives access; otherwise the workspace
  // shows the "Reopen folder" button (spec section 9.2).
  if (project.folder) await connectFolder(project, ask, seq);
  else void loadFileRoles();
  if (project.sync) {
    watchProject(id);
    // The exchange could change files in the store between reading them and showing the project: compare.
    await serial(() => applyRemote(id, null));
  }
}

// The initial speed multiplier from fpgasim.json (the sim.speed field, spec section 2.2); without it, 1.
function initialSpeed(): Speed {
  // The file does not parse: the build will report it.
  const speed = (readConfig()?.sim as { speed?: unknown } | undefined)?.speed;
  if (speed === "max" || (typeof speed === "number" && Number.isFinite(speed) && speed > 0)) return speed;
  return 1;
}

export async function renameProject(name: string): Promise<void> {
  const project = get().project;
  const next = name.trim();
  if (!project || next === "" || next === project.name) return;
  await (await db()).renameProject(project.id, next);
  set({ project: { ...project, name: next } });
}

export function setLayout(layout: Layout): void {
  const project = get().project;
  set({ layout });
  if (project) saveLayout(project.id, layout);
}

export async function closeProject(): Promise<void> {
  openSeq += 1;
  stopFolder();
  await flushDrafts();
  dropProjectHold();
  seenSeq.clear();
  buildSeq += 1;
  cancelCheck();
  stopSimulation();
  clearWaves();
  dropTestbench();
  editor.clear();
  sessionFiles.clear();
  scene = null;
  set({
    project: null,
    files: [],
    activePath: null,
    build: NO_BUILD,
    diagnostics: [],
    notices: [],
    resolved: null,
    dialog: null,
    folder: null,
    transfer: null,
  });
  // The session ended while the project was open: the projects screen shows the ordinary sign-in form.
  if (get().sessionExpired) set({ sessionExpired: false, access: { kind: "none" } });
  history.replaceState(null, "", location.pathname + location.search);
  await refreshProjects();
  void sync?.syncAll();
}

// ---- Files ----

const currentText = (file: SessionFile): string => file.draft ?? file.content;

export function selectFile(path: string): void {
  const file = sessionFiles.get(path);
  if (!file) return;
  editor.open(path, currentText(file));
  set({ activePath: path });
}

function markDirty(path: string, dirty: boolean): void {
  const files = get().files;
  if (files.some((f) => f.path === path && f.dirty !== dirty)) {
    set({ files: files.map((f) => (f.path === path ? { ...f, dirty } : f)) });
  }
}

async function writeDraft(path: string): Promise<void> {
  draftTimers.delete(path);
  const project = get().project;
  const file = sessionFiles.get(path);
  if (project && file) await (await db()).putDraft(project.id, path, currentText(file), seenSeq.get(path) ?? 0);
}

// Editor edit: 300 ms after typing it is written to the store as unsaved.
function changeFile(path: string, text: string): void {
  const file = sessionFiles.get(path);
  if (!file) return;
  file.draft = text === file.content ? null : text;
  markDirty(path, file.draft !== null);
  scheduleStale();
  clearTimeout(draftTimers.get(path));
  draftTimers.set(
    path,
    setTimeout(() => {
      void writeDraft(path);
    }, DRAFT_DELAY_MS),
  );
  scheduleCheck();
}

// A language change reloads the page: edits waiting for a write are written at once, and writes already started
// (a save, fpgasim.json from a dialog) reach the store (decision 168).
onBeforeLanguageChange(async () => {
  await flushDrafts();
  await serial(() => Promise.resolve());
});

async function flushDrafts(): Promise<void> {
  const waiting = [...draftTimers.entries()];
  for (const [path, timer] of waiting) {
    clearTimeout(timer);
    await writeDraft(path);
  }
}

// Save all edits: an edit becomes the file content.
export function saveAll(): Promise<void> {
  return serial(saveAllNow);
}

async function saveAllNow(): Promise<void> {
  const project = get().project;
  // A folder without access: edits stay unsaved until "Reopen folder".
  if (!project || folderBlocked()) return;
  // Files with a deferred edit write: if the edit was canceled, it must still be erased in the store.
  const pending = new Set(draftTimers.keys());
  for (const timer of draftTimers.values()) clearTimeout(timer);
  draftTimers.clear();
  const database = await db();
  const configSaved = sessionFiles.get(CONFIG_FILE)?.draft != null;
  let failed = false; // the write to the folder failed: the other edits are only written to the store
  for (const [path, file] of [...sessionFiles]) {
    if (file.draft === null || failed) {
      if (pending.has(path)) await database.putDraft(project.id, path, currentText(file), seenSeq.get(path) ?? 0);
      continue;
    }
    // The mark is cleared before the write: typing during the write sets it again.
    const text = file.draft;
    const before = file.content;
    file.content = text;
    file.draft = null;
    markDirty(path, false);
    try {
      await writeOut(project, path, text);
    } catch {
      // The folder is unavailable: the edit stays unsaved (it is already written in the store).
      file.content = before;
      file.draft ??= text;
      markDirty(path, true);
      await database.putDraft(project.id, path, file.draft, seenSeq.get(path) ?? 0);
      failed = true;
    }
  }
  if (failed) return;
  // A saved fpgasim.json edit takes effect at once: the board drawing and the core get the new settings.
  if (configSaved) await applyConfig();
}

// Save by user command: a check follows (spec section 9.5, item 5).
export async function save(): Promise<void> {
  await saveAll();
  await check();
}

const sortedEntries = (): { path: string; dirty: boolean }[] =>
  [...sessionFiles.entries()]
    .map(([path, file]) => ({ path, dirty: file.draft !== null }))
    .sort((a, b) => a.path.localeCompare(b.path));

export type FileProblem = "empty" | "bad" | "exists" | "folder";

// The name of a new file. A project in a folder does not take every file from disk (decision 96): a file of another kind
// would vanish from the project on the next scan. A file that lies in the folder outside the project (not text,
// a build output) is not overwritten.
async function newPathProblem(project: ProjectRecord, name: string): Promise<FileProblem | null> {
  const problem = filePathProblem(name, [...sessionFiles.keys()]);
  if (problem || !project.folder) return problem;
  if (!folderPathWanted(name)) return "folder";
  try {
    return (await diskHas(project.folder, name)) ? "exists" : null;
  } catch (e) {
    folderLost(e);
    return "exists";
  }
}

// Create, rename and delete a project file. They return the reason for a refusal or null.
// A failed write to the folder is shown by the workspace (folderLost); the name field then has no refusal.
export async function createFile(path: string): Promise<FileProblem | null> {
  const project = get().project;
  const name = path.trim();
  if (!project) return null;
  const problem = await newPathProblem(project, name);
  if (problem) return problem;
  try {
    await writeOut(project, name, "");
  } catch {
    return null;
  }
  sessionFiles.set(name, { content: "", draft: null, base: null });
  set({ files: sortedEntries() });
  selectFile(name);
  void applyConfig();
  return null;
}

export async function renameFile(from: string, to: string): Promise<FileProblem | null> {
  const project = get().project;
  const name = to.trim();
  const file = sessionFiles.get(from);
  if (!project || !file || name === from) return null;
  const problem = await newPathProblem(project, name);
  if (problem) return problem;
  // A deferred edit write would go under the old path: it runs now.
  if (draftTimers.has(from)) {
    clearTimeout(draftTimers.get(from));
    await writeDraft(from);
  }
  if (project.folder) {
    try {
      await writeOut(project, name, file.content, false);
      await removeOut(project, from);
    } catch {
      // The folder is unavailable; after "Reopen folder" the project takes what is on disk.
      return null;
    }
  }
  await (await db()).renameFile(project.id, from, name);
  seenSeq.delete(from);
  seenSeq.delete(name);
  sessionFiles.delete(from);
  sessionFiles.set(name, { ...file, base: null });
  const wasActive = get().activePath === from;
  editor.close(from);
  set({ files: sortedEntries(), activePath: wasActive ? null : get().activePath });
  if (wasActive) selectFile(name);
  void applyConfig();
  scheduleCheck();
  return null;
}

export async function deleteFile(path: string): Promise<void> {
  const project = get().project;
  if (!project || !sessionFiles.has(path)) return;
  clearTimeout(draftTimers.get(path));
  draftTimers.delete(path);
  try {
    await removeOut(project, path);
  } catch {
    return;
  }
  await (await db()).deleteFile(project.id, path);
  seenSeq.delete(path);
  sessionFiles.delete(path);
  const wasActive = get().activePath === path;
  editor.close(path);
  const files = sortedEntries();
  set({ files, activePath: wasActive ? null : get().activePath });
  const next = files[0];
  if (wasActive && next) selectFile(next.path);
  void applyConfig();
  scheduleCheck();
}

// ---- Build and check ----

function localFailure(diagnostics: Diagnostic[]): BuildResponse {
  return { status: "failed", durationMs: 0, diagnostics, resolved: {} };
}

// A server request: project files and fpgasim.json as a separate config field (decision 35).
// A build takes the saved content, a check takes the editor text together with the unsaved edit.
type Request =
  | { files: ProjectFile[]; config: unknown; failure?: undefined }
  | { failure: Diagnostic; files?: undefined; config?: undefined };

function makeRequest(text: (file: SessionFile) => string): Request {
  const files: ProjectFile[] = [];
  let config: unknown = null;
  for (const [path, file] of sessionFiles) {
    if (path !== CONFIG_FILE) {
      files.push({ path, content: text(file) });
      continue;
    }
    try {
      config = JSON.parse(text(file)) as unknown;
    } catch (e) {
      // fpgasim.json could not be parsed: there is nothing to send to the server.
      const original = e instanceof Error ? e.message : String(e);
      return { failure: { source: "project", severity: "error", code: "CONFIG_INVALID", file: path, original } };
    }
  }
  return { files, config };
}

async function requestBuild(server: BuildClient): Promise<BuildResponse> {
  const request = makeRequest((file) => file.content);
  return request.failure ? localFailure([request.failure]) : server.build(request.files, request.config);
}

// Editor marks by display level (spec section 7.6): error is red, "important" is yellow,
// "notice" is gray, hidden ones are not shown. Hover text: the short text and the explanation.
function toMarks(diagnostics: Diagnostic[]): EditorMark[] {
  return diagnostics.flatMap((d) => {
    const level = diagnosticLevel(d);
    if (level === "hidden" || !d.file || !d.line) return [];
    const explain = diagnosticExplain(d);
    return [
      {
        path: d.file,
        line: d.line,
        column: d.column ?? null,
        severity: level === "error" ? "error" : level === "important" ? "warning" : "info",
        message: explain ? `${diagnosticText(d)}\n\n${explain}` : diagnosticText(d),
      },
    ];
  });
}

// File roles from the server reply (spec section 2.5): testbenches and the top module file. The interface
// does not parse Verilog; if the server did not get to them (a settings error), the earlier ones stay.
function fileRoles(resolved: Resolved): { testbenches: string[] | null; topFile: string | null } {
  const now = get();
  return {
    testbenches: resolved.testbenches ?? now.testbenches,
    topFile: resolved.testbenches ? (resolved.topFile ?? null) : now.topFile,
  };
}

// File roles for the file list and the "Testbench" tab before any check or build has happened:
// the same /v1/check request, but messages, editor marks and the check counter are not touched.
export async function loadFileRoles(): Promise<void> {
  const server = client;
  const seq = openSeq;
  if (!server || !get().project) return;
  const request = makeRequest(currentText);
  if (request.failure) return;
  try {
    const response = await server.check(request.files, request.config);
    if (seq === openSeq && get().testbenches === null) set(fileRoles(response.resolved));
  } catch {
    // The server did not answer: roles appear after the first check or build.
  }
}

// A new edit: the reply of a check already in progress is stale — its line numbers belong to the earlier text.
function scheduleCheck(): void {
  checkSeq += 1;
  if (checkTimer !== null) clearTimeout(checkTimer);
  checkTimer = setTimeout(() => {
    void check();
  }, CHECK_IDLE_MS);
}

// Cancel a deferred check; the reply of a check already in progress will be dropped.
function cancelCheck(): void {
  if (checkTimer !== null) clearTimeout(checkTimer);
  checkTimer = null;
  checkSeq += 1;
}

// Check without a build (POST /v1/check): on save and after 2 s of idle on edit.
// Editor marks and the "Messages" tab update, the simulation is not touched.
export async function check(): Promise<void> {
  cancelCheck();
  const server = client;
  if (!server || !get().project) return;
  if (get().build.status === "building") {
    // The build will give the messages now; an edit made during it is checked afterwards.
    scheduleCheck();
    return;
  }
  const seq = checkSeq;
  const request = makeRequest(currentText);
  let diagnostics: Diagnostic[];
  let resolved: Resolved = {};
  try {
    if (request.failure) diagnostics = [request.failure];
    else {
      const response = await server.check(request.files, request.config);
      diagnostics = response.diagnostics;
      resolved = response.resolved;
    }
  } catch {
    // A check is a hint while editing: a server refusal (busy, request limit) is not shown.
    return;
  }
  if (seq !== checkSeq) return;
  set({ diagnostics, checks: get().checks + 1, ...fileRoles(resolved) });
  editor.setMarks(toMarks(diagnostics));
}

export function gotoDiagnostic(diagnostic: Diagnostic): void {
  if (!diagnostic.file || !sessionFiles.has(diagnostic.file)) return;
  selectFile(diagnostic.file);
  editor.goto(diagnostic.line ?? 1, diagnostic.column ?? null);
}

// saveDrafts = false — rebuild on a folder change: unsaved browser edits are not written
// to disk, the build takes the saved content (decision 97).
// thenRun — after a successful build start the simulation (the "Run" button on an unbuilt project).
export async function build(saveDrafts = true, thenRun = false): Promise<void> {
  const server = client;
  if (!server || !get().project || get().build.status === "building") return;
  const seq = ++buildSeq;
  cancelCheck();
  set({ build: { ...NO_BUILD, status: "building", startedAt: performance.now() }, builds: get().builds + 1 });
  const wasRunning = thenRun || get().sim.run === "running";
  try {
    // A build takes the saved content, so it saves the edits first (decision 46).
    if (saveDrafts) await saveAll();
    const print = sourcePrint();
    const response = await requestBuild(server);
    if (seq !== buildSeq) return;
    const summary = {
      ...NO_BUILD,
      buildId: response.buildId ?? null,
      cached: response.cached ?? false,
      durationMs: response.durationMs,
    };
    set({ diagnostics: response.diagnostics, ...fileRoles(response.resolved) });
    editor.setMarks(toMarks(response.diagnostics));
    if (response.status !== "ok" || !response.artifacts) {
      // The earlier simulation stays; the "Messages" tab opens, the editor moves
      // to the first error (section 9.5, item 2).
      set({ build: { ...summary, status: "failed" }, bottomTab: "messages" });
      const first = response.diagnostics.find((d) => d.severity === "error" && d.file);
      if (first) gotoDiagnostic(first);
      return;
    }
    const [mjs, wasm] = await Promise.all([
      server.artifact(response.artifacts.js),
      server.artifact(response.artifacts.wasm),
    ]);
    if (seq !== buildSeq) return;
    await startSimulation(response, mjs, wasm, wasRunning);
    builtPrint = print;
    refreshStale();
    set({ build: { ...summary, status: "ok" } });
  } catch (e) {
    if (seq !== buildSeq) return;
    if (e instanceof ServerError && e.status === 401) credentialRejected();
    const code = e instanceof ServerError || e instanceof CoreError ? e.code : "UNKNOWN";
    const text = e instanceof Error ? e.message : String(e);
    set({ build: { ...NO_BUILD, status: "error", errorCode: code, errorText: text } });
  }
}

// ---- Simulation ----

function stopSimulation(): void {
  simulation?.terminate();
  simulation = null;
  pendingEvents.clear();
  scene?.reset();
  lastConfigure = null;
  builtPrint = null;
  scheduleStale();
  sentWatch = "";
  fetchedRecord = null;
  set({
    sim: NO_SIM,
    nets: [],
    clocked: false,
    stepping: false,
    partTypes: [],
    signals: [],
    record: null,
    recordError: null,
  });
}

function onCoreMessage(message: CoreMessage): void {
  if (message.t === "state") {
    const state = message as unknown as StateMessage;
    // The state message also arrives at the end of a step; the multiplier in it is the one in effect in the core.
    set({
      sim: { loaded: true, run: state.run, time: state.time, cycle: state.cycle, speed: state.speed },
      speed: state.speed,
      stepping: false,
    });
    // The simulation stopped (pause, end of a step): a running recording shows up to this moment.
    if (state.run !== "running") refreshWave();
  } else if (message.t === "recordState") {
    onRecordState(message as unknown as RecordStateMessage);
  } else if (message.t === "notice") {
    set({ notices: [...get().notices, message as unknown as NoticeMessage].slice(-MAX_NOTICES) });
  } else if (message.t === "partEvent") {
    onPartEvent(message as unknown as PartEvent);
  } else if (message.t === "error") {
    // A core failure without a command number (spec section 4.3) shows next to the simulator notices.
    const failure: NoticeMessage = {
      t: "notice",
      code: typeof message.code === "string" ? message.code : "ERROR",
      text: typeof message.text === "string" ? message.text : "",
      time: (simulation?.live.timePs ?? 0n).toString(),
    };
    set({ notices: [...get().notices, failure].slice(-MAX_NOTICES) });
  } else if (!KNOWN_MESSAGES.has(message.t)) {
    // A message of an unknown type is skipped with a log entry (spec section 4.7).
    console.warn("fpgasim: unknown core message", message.t);
  }
}

// A part event (spec section 6) shows among the simulator notices as one line per part
// and event kind: a repeat updates the line. WS2812 with a duration error sends an event on every
// latch, so the lines update no more than once per 250 ms.
const pendingEvents = new Map<string, PartEvent>();
let eventTimer: ReturnType<typeof setTimeout> | null = null;

function eventText(event: PartEvent): string {
  const board = projectBoard();
  const label = (board ? projectParts(board, get().config) : []).find((p) => p.id === event.part)?.label ?? event.part;
  const data = event.data;
  const round = (value: unknown): unknown => (typeof value === "number" ? Math.round(value) : value);
  if (event.event === "timingError") {
    const high = typeof data.highNs === "number";
    return t(high ? "event.timingError.high" : "event.timingError.period", {
      label,
      bit: data.bit,
      ns: round(high ? data.highNs : data.periodNs),
      count: data.count,
      total: data.total,
    });
  }
  return tOr(`event.${event.event}`, "event.unknown", { ...data, label, event: event.event });
}

// The line text is composed here, not on every event: the last one reaches the display.
function flushEvents(): void {
  eventTimer = null;
  let notices = get().notices;
  for (const event of pendingEvents.values()) {
    const notice: NoticeMessage = {
      t: "notice",
      code: event.event,
      text: eventText(event),
      part: event.part,
      time: event.time,
    };
    const at = notices.findIndex((n) => n.code === notice.code && n.part === notice.part);
    notices = at < 0 ? [...notices, notice] : notices.map((n, i) => (i === at ? notice : n));
  }
  pendingEvents.clear();
  set({ notices: notices.slice(-MAX_NOTICES) });
}

function onPartEvent(event: PartEvent): void {
  pendingEvents.set(`${event.part}:${event.event}`, event);
  eventTimer ??= setTimeout(flushEvents, EVENT_NOTICE_MS);
}

// A new build: the previous Worker ends, a new one is created, the steps of spec section 4.7 run.
async function startSimulation(
  response: BuildResponse,
  mjs: ArrayBuffer,
  wasm: ArrayBuffer,
  run: boolean,
): Promise<void> {
  const board = boardById(response.resolved.board ?? "");
  if (!board) throw new CoreError("BOARD_UNKNOWN", response.resolved.board ?? "");
  // The chosen multiplier moves to the new core: after configure it counts with multiplier 1.
  const speed = get().speed;
  stopSimulation();
  const next = new Simulation({
    onMessage: onCoreMessage,
    // The core erases the recording on reset and configure and does not report it (decision 25).
    onRestart: () => {
      if (simulation !== next) return;
      fetchedRecord = null;
      set({ record: null, recordError: null });
    },
    onFailure: (error) => {
      if (simulation !== next) return;
      stopSimulation();
      set({ build: { ...NO_BUILD, status: "error", errorCode: error.code, errorText: error.message } });
    },
  });
  simulation = next;
  pendingEvents.clear();
  set({ notices: [], resolved: response.resolved });
  try {
    await next.start(mjs, wasm, (ready) => {
      const message = currentConfigure(board, ready.partTypes);
      lastConfigure = message;
      return message;
    });
  } catch (e) {
    if (simulation === next) stopSimulation();
    throw e;
  }
  const signals = (await next.command({ t: "signals" })).signals as SignalInfo[];
  set({ partTypes: next.ready?.partTypes ?? [], signals });
  showNets(next);
  if (speed !== 1) await next.command({ t: "speed", speed });
  if (run) await next.command({ t: "run" });
  // Settings changed while the core was starting reach it now.
  configQueue = configQueue.then(reconfigure).catch(coreNotice);
}

// A command to the core from the interface and from window.__fpgasim.
export function command(message: Command): Promise<ReplyMessage> {
  if (!simulation) return Promise.reject(new CoreError("NO_CORE", ""));
  return simulation.command(message);
}

// Control buttons: a core refusal (for example BAD_STATE after finished) is visible in its state, not here.
const quiet = (message: Command): void => {
  command(message).catch(() => undefined);
};

export const run = (): void => {
  quiet({ t: "run" });
};
// The "Run" button: if the project is not built or changed after the build, build first, then run.
export const runOrBuild = (): void => {
  if (get().sim.loaded && !get().stale) run();
  else void build(true, true);
};
export const pause = (): void => {
  quiet({ t: "pause" });
};
// Reset: the core creates the model again and resets the parts, so the board drawing forgets button presses.
export const resetSimulation = (): void => {
  scene?.reset();
  quiet({ t: "reset" });
};

// A part command from the board drawing. On pause the core sends no frame for it, and a button press would not be
// visible until the next step; a zero-length step gives a frame with the new levels, and time does not advance.
export function partCommand(part: string, cmd: string, args?: Record<string, unknown>): void {
  const target = simulation;
  if (!target) return;
  target
    .command({ t: "part", part, cmd, ...(args ? { args } : {}) })
    .then(() => {
      if (simulation === target && get().sim.run === "paused" && !get().stepping) {
        return target.command({ t: "step", unit: "time", ps: "0" });
      }
      return undefined;
    })
    .catch(() => undefined);
}

// Speed multiplier: remembered and, if the core is loaded, changed on the fly.
export function setSpeed(speed: Speed): void {
  set({ speed });
  if (simulation) quiet({ t: "speed", speed });
}

// A step on pause. The core answers ok at once, and at the end of the step sends state and a frame (spec section 4.3).
export function step(message: StepCommand): void {
  const sim = get().sim;
  if (!simulation || sim.run !== "paused" || get().stepping) return;
  set({ stepping: true });
  command({ t: "step", ...message }).catch(() => {
    set({ stepping: false });
  });
}

// ---- Project settings, pin binding and parts (spec sections 2.2, 9.3 and 9.5) ----

function readConfig(): ProjectConfig | null {
  return parseConfig(sessionFiles.get(CONFIG_FILE)?.content);
}

function projectBoard(): Board | undefined {
  return boardById(get().project?.board ?? "");
}

// The pin binding source by the project files and fpgasim.json — the same rule as on the server.
export function fileSource(): BindingSource {
  return bindingSource(get().config, [...sessionFiles.keys()]);
}

// The source in effect. While the core is loaded, it is the one the build configured it with
// (resolved.constraints): a .cst file created or deleted after that takes effect
// with the next build. Before the first build, it follows the project files.
export function currentSource(): BindingSource {
  const resolved = get().resolved;
  if (!resolved?.ports) return fileSource();
  return typeof resolved.constraints === "string" ? { kind: "cst", file: resolved.constraints } : { kind: "pins" };
}

// The pin binding in effect now. From the pins field the interface computes it by the ports of the last
// build; from a .cst file it takes the ready one from the server reply. Before the first build there are no ports.
export function currentBinding(): Binding | null {
  const { resolved, config } = get();
  const board = projectBoard();
  if (!board || !resolved?.ports) return null;
  return currentSource().kind === "pins"
    ? bindPins(board, resolved.ports, config?.pins)
    : bindResolved(board, resolved);
}

function currentConfigure(board: Board, partTypes: readonly string[]): Configure {
  const binding = currentBinding() ?? { pins: [], clock: null };
  return makeConfigure(board, binding, projectParts(board, get().config), partTypes);
}

// Port names of the nets and the net list for the "Nets" tab — after every configure.
function showNets(target: Simulation): void {
  const ports = get().resolved?.ports ?? [];
  for (const net of target.live.nets) net.name = net.port === null ? null : bitName(ports, net.port, net.bit ?? 0);
  set({
    nets: target.live.nets.map((n) => ({ pin: n.pin, port: n.name })),
    clocked: lastConfigure?.clock != null,
  });
  // After configure the core's watch list is empty (the watch field of the message): it is set again.
  sentWatch = "";
  syncWatch();
}

// Settings from the file go to the state and the board drawing; the core is not touched.
// The file does not parse — the drawing stays as it was: dialogs and the build will report the error.
// The board copy in the project record. A temporary copy of another's project is not edited in the database.
async function storeBoard(project: ProjectRecord): Promise<void> {
  if (project.viewOf) return;
  await (await db()).setBoard(project.id, project.board);
  await refreshProjects();
}

function showConfig(): void {
  const config = readConfig();
  set({ config });
  // The board field was changed by editing fpgasim.json: the drawing is built again for the new board.
  const open = get().project;
  if (open && config && configBoard(config) !== open.board) {
    const project = { ...open, board: configBoard(config) };
    set({ project });
    const next = boardById(project.board);
    scene = next ? new BoardScene(next) : null;
    void storeBoard(project);
  }
  const board = projectBoard();
  if (board && config) scene?.setParts(projectParts(board, config));
  syncWatch();
}

function coreNotice(e: unknown): void {
  const failure: NoticeMessage = {
    t: "notice",
    code: e instanceof CoreError ? e.code : "ERROR",
    text: e instanceof Error ? e.message : String(e),
    time: (simulation?.live.timePs ?? 0n).toString(),
  };
  set({ notices: [...get().notices, failure].slice(-MAX_NOTICES), bottomTab: "messages" });
}

// A change of pin binding, parts or part settings without a build (spec section 9.5, item 4): if only
// the part settings changed — partSettings on the fly, otherwise configure (the simulation starts again).
async function reconfigure(): Promise<void> {
  const target = simulation;
  const board = projectBoard();
  const before = lastConfigure;
  // fpgasim.json does not parse: the core stays with the earlier setup (spec section 9.5, item 2).
  if (!target?.ready || !board || !before || !get().sim.loaded || get().config === null) return;
  try {
    const message = currentConfigure(board, target.ready.partTypes);
    if (JSON.stringify(message) === JSON.stringify(before)) return;
    const changed = settingsOnly(before, message);
    if (changed) {
      for (const id of changed) {
        // The core applies partSettings over the earlier part settings, so all settings go
        // with defaults: otherwise a setting removed from the file would stay as before.
        const part = message.parts.find((p) => p.id === id);
        const settings = withDefaults(partDescription(part?.type ?? ""), part?.settings);
        await target.command({ t: "partSettings", part: id, settings });
      }
      lastConfigure = message;
      // On pause there is no frame after a command: a zero-length step shows the new levels. While it
      // runs, "Run" and "Step" are disabled, as in any step; the end of the step is the state message.
      if (get().sim.run === "paused" && !get().stepping) {
        set({ stepping: true });
        await target.command({ t: "step", unit: "time", ps: "0" }).catch((e: unknown) => {
          set({ stepping: false });
          throw e;
        });
      }
      return;
    }
    const wasRunning = get().sim.run === "running";
    const speed = get().speed;
    scene?.reset();
    // The notices of the earlier simulation are erased; the notices of the new configure come after the reply.
    pendingEvents.clear();
    set({ notices: [] });
    await target.configure(message);
    if (simulation !== target) return;
    lastConfigure = message;
    showNets(target);
    if (speed !== 1) await target.command({ t: "speed", speed });
    if (wasRunning) await target.command({ t: "run" });
  } catch (e) {
    // The core refused (CONFIG_INVALID, SETTINGS_INVALID): the earlier setup stays in force.
    if (simulation === target) coreNotice(e);
  }
}

function applyConfig(): Promise<void> {
  showConfig();
  // A failure of one reconfiguration must not stop the next ones.
  configQueue = configQueue.then(reconfigure).catch(coreNotice);
  return configQueue;
}

// An fpgasim.json edit from a dialog: the file is rewritten whole, unknown fields are kept.
// Returns false if the current file does not parse: then it can be edited only in the editor.
// The edit function may return false: then the file is not touched (it explains the refusal itself).
export function updateConfig(change: (config: ProjectConfig) => boolean | undefined): Promise<boolean> {
  return serial(() => updateConfigNow(change));
}

async function updateConfigNow(change: (config: ProjectConfig) => boolean | undefined): Promise<boolean> {
  const project = get().project;
  const existing = sessionFiles.get(CONFIG_FILE);
  const config = parseConfig(existing ? currentText(existing) : undefined);
  if (!project || !config) return false;
  if (change(config) === false) return true;
  const text = printConfig(config);
  clearTimeout(draftTimers.get(CONFIG_FILE));
  draftTimers.delete(CONFIG_FILE);
  // The text in memory changes before the write: the next edit from the queue already reads it.
  const before = existing ? { ...existing } : null;
  if (existing) {
    existing.content = text;
    existing.draft = null;
  } else {
    sessionFiles.set(CONFIG_FILE, { content: text, draft: null, base: null });
  }
  // A project in a folder: fpgasim.json is written to the same folder (spec section 9.2). A failed write
  // is shown by the workspace; the file in memory returns to the earlier text.
  try {
    await writeOut(project, CONFIG_FILE, text);
  } catch {
    if (existing && before) Object.assign(existing, before);
    else sessionFiles.delete(CONFIG_FILE);
    return true;
  }
  editor.replace(CONFIG_FILE, text);
  set({ files: sortedEntries() });
  await applyConfig();
  void check();
  return true;
}

// An unsaved fpgasim.json edit is saved: dialogs show the saved file, and write
// it whole, so an edit from the editor would otherwise vanish without a message.
async function saveConfigDraft(): Promise<void> {
  const project = get().project;
  const file = sessionFiles.get(CONFIG_FILE);
  if (!project || !file || file.draft === null) return;
  clearTimeout(draftTimers.get(CONFIG_FILE));
  draftTimers.delete(CONFIG_FILE);
  const text = file.draft;
  const before = file.content;
  file.content = text;
  file.draft = null;
  markDirty(CONFIG_FILE, false);
  try {
    await writeOut(project, CONFIG_FILE, text);
  } catch {
    file.content = before;
    file.draft ??= text;
    markDirty(CONFIG_FILE, true);
    return;
  }
  await applyConfig();
}

// The dialog opens after the unsaved fpgasim.json edit is saved.
export function openDialog(dialog: DialogState): void {
  if (dialog === null || sessionFiles.get(CONFIG_FILE)?.draft == null) {
    set({ dialog });
    return;
  }
  void serial(saveConfigDraft).then(() => {
    set({ dialog });
  });
}

// Breadboard parts as written in the file: a record of a wrong shape stays in place
// on a rewrite — the server will report it, and the dialog must not silently erase another's edit.
function rawParts(config: ProjectConfig): unknown[] {
  return Array.isArray(config.parts) ? [...(config.parts as unknown[])] : [];
}

const partId = (raw: unknown): unknown =>
  typeof raw === "object" && raw !== null ? (raw as { id?: unknown }).id : null;

// Pin binding of a port bit in a dialog. Refusal: the pin is taken by another port, a .cst file is in effect,
// fpgasim.json does not parse.
export async function bindPort(
  name: string,
  pin: number | null,
  pull: Pull,
): Promise<"twice" | "cst" | "config" | null> {
  const board = projectBoard();
  const ports = get().resolved?.ports;
  if (currentSource().kind !== "pins" || !board || !ports) return "cst";
  const found = { taken: false };
  const done = await updateConfig((config) => {
    // Occupancy is checked against the text that is written (with the unsaved editor edit).
    const rows = bindPins(board, ports, config.pins).rows;
    found.taken = pin !== null && rows.some((row) => row.name !== name && row.pin === pin);
    if (found.taken) return false;
    const pins = new Map(Object.entries(config.pins ?? {}));
    if (pin === null) pins.delete(name);
    else pins.set(name, pull === "none" ? { pin } : { pin, pull });
    config.pins = Object.fromEntries(pins);
    return undefined;
  });
  if (found.taken) return "twice";
  return done ? null : "config";
}

// The command "Export binding as .cst" (spec section 2.2): the file is created from the pins field, the field
// is cleared. Returns the file name or null if there is nothing to export.
export async function exportCst(): Promise<string | null> {
  const project = get().project;
  const binding = currentBinding();
  const resolved = get().resolved;
  const board = projectBoard();
  if (!project || !board || !binding || !resolved || currentSource().kind !== "pins" || binding.pins.length === 0)
    return null;
  // The settings file does not parse: the pins field cannot be cleared, so the .cst file is not created.
  const existing = sessionFiles.get(CONFIG_FILE);
  if (!parseConfig(existing ? currentText(existing) : undefined)) return null;
  const path = cstFileName(resolved.top, [...sessionFiles.keys()]);
  const text = toCst(board, binding.rows);
  await writeOut(project, path, text);
  sessionFiles.set(path, { content: text, draft: null, base: null });
  // The core is configured with this same binding: in the build reply it is now listed under the file.
  set({ resolved: { ...resolved, constraints: path, pins: binding.pins, clock: binding.clock } });
  const done = await updateConfig((config) => {
    delete config.pins;
    // The file is named explicitly if the field is already set or the project has another .cst: otherwise
    // the next build would not know which file is in effect (CST_AMBIGUOUS).
    const others = [...sessionFiles.keys()].some((name) => name.endsWith(".cst") && name !== path);
    if (config.design?.constraints !== undefined || others) config.design = { ...config.design, constraints: path };
    return undefined;
  });
  set({ files: sortedEntries() });
  return done ? path : null;
}

// The "Edit .cst" button: the binding file opens in the editor.
export function editCst(): void {
  // The file the core was configured with may have been renamed or deleted: then, the project's file.
  const first = (source: BindingSource): string | undefined =>
    source.kind === "cst" ? source.file : source.kind === "ambiguous" ? source.files[0] : undefined;
  const path = [first(currentSource()), first(fileSource())].find((p) => p !== undefined && sessionFiles.has(p));
  set({ dialog: null });
  if (path !== undefined) selectFile(path);
}

// A breadboard part: add and edit. The interface chooses the cell for a new part.
export function savePart(part: BreadboardPart, replaces: string | null): Promise<boolean> {
  return updateConfig((config) => {
    const parts = rawParts(config);
    const at = replaces === null ? -1 : parts.findIndex((p) => partId(p) === replaces);
    if (at >= 0) parts[at] = { ...(parts[at] as BreadboardPart), ...part };
    else parts.push({ ...part, position: freeCell(breadboardParts(config)) });
    config.parts = parts as BreadboardPart[];
    return undefined;
  });
}

export function removePart(id: string): Promise<boolean> {
  return updateConfig((config) => {
    config.parts = rawParts(config).filter((p) => partId(p) !== id) as BreadboardPart[];
    return undefined;
  });
}

// A change of an onboard part (the boardParts field): only the differences from the board file go into the file.
export function saveBoardPart(id: string, change: BoardPartChange): Promise<boolean> {
  return updateConfig((config) => {
    const all = new Map(Object.entries(config.boardParts ?? {}));
    const entry: BoardPartChange = {};
    if (change.enabled === false) entry.enabled = false;
    if (change.settings && Object.keys(change.settings).length > 0) entry.settings = change.settings;
    if (Object.keys(entry).length > 0) all.set(id, entry);
    else all.delete(id);
    if (all.size > 0) config.boardParts = Object.fromEntries(all);
    else delete config.boardParts;
    return undefined;
  });
}

// Dragging from a breadboard part to a comb pin (spec section 9.4).
export function bindPartPin(id: string, role: string, pin: number): void {
  void updateConfig((config) => {
    config.parts = rawParts(config).map((raw) => {
      if (partId(raw) !== id) return raw;
      const part = raw as BreadboardPart;
      return { ...part, pins: { ...part.pins, [role]: pin } };
    }) as BreadboardPart[];
    return undefined;
  });
}

// The top module choice on TOP_AMBIGUOUS (spec section 2.5): a write to design.top and a new build.
export async function chooseTop(name: string): Promise<void> {
  const done = await updateConfig((config) => {
    config.design = { ...config.design, top: name };
    return undefined;
  });
  if (done) await build();
}

// The "Show internal signals" button of the "Signals" tab (spec section 7.3, decision 108):
// a write of design.visibility = "all" and a new build.
export async function showInternalSignals(): Promise<void> {
  const done = await updateConfig((config) => {
    config.design = { ...config.design, visibility: "all" };
    return undefined;
  });
  if (done) await build();
}

// The saved content of a project file, for window.__fpgasim.
export function fileContent(path: string): string | null {
  return sessionFiles.get(path)?.content ?? null;
}

// ---- Signals, watch and recording (spec sections 4.2, 5.5 and 9.6) ----

// The watch list in effect in the core: sig numbers separated by commas; null — unknown.
let sentWatch: string | null = "";
let fetchedRecord: number | null = null; // the finished recording whose data is already fetched
let waveBusy = false; // the recording data is requested
let waveStale = false; // the recording changed during the request

const signalByPath = (path: string): SignalInfo | undefined => get().signals.find((s) => s.path === path);

// On pause the core sends no frame after a command: a zero-length step gives a frame with the new values.
function frameOnPause(target: Simulation): Promise<unknown> | undefined {
  if (simulation !== target || get().sim.run !== "paused" || get().stepping) return undefined;
  return target.command({ t: "step", unit: "time", ps: "0" });
}

// The watch list from fpgasim.json goes to the core (the watch command). Board pins pin:N do not go into it:
// their levels are in every frame. A signal with such a path may be absent in the core (another build).
function syncWatch(): void {
  const target = simulation;
  if (!target?.ready || !lastConfigure) return;
  const sigs = watchItems(get().config).flatMap((item) => {
    const signal = signalByPath(item.signal);
    return signal && signal.kind !== "memory" ? [signal.sig] : [];
  });
  const key = sigs.join(",");
  if (key === sentWatch) return;
  sentWatch = key;
  target.command({ t: "watch", signals: sigs }).then(
    // A step refusal is not shown: the simulation may have run before the reply to watch arrived
    // (build and configure on the fly), and then the frame comes without the step.
    () => frameOnPause(target)?.catch(() => undefined),
    (e: unknown) => {
      if (simulation !== target) return;
      // The core did not accept the list: the next watch edit sends it again.
      if (sentWatch === key) sentWatch = null;
      coreNotice(e);
    },
  );
}

export function addWatch(signal: string): Promise<boolean> {
  return updateConfig((config) => {
    changeWatch(config, (items) =>
      items.some((i) => i.signal === signal) ? items : [...items, { signal, radix: WATCH_RADIX }],
    );
    return undefined;
  });
}

export function removeWatch(signal: string): Promise<boolean> {
  return updateConfig((config) => {
    changeWatch(config, (items) => items.filter((i) => i.signal !== signal));
    return undefined;
  });
}

export function setWatchRadix(signal: string, radix: Radix): Promise<boolean> {
  return updateConfig((config) => {
    changeWatch(config, (items) => items.map((i) => (i.signal === signal ? { ...i, radix } : i)));
    return undefined;
  });
}

export function setRecordSettings(patch: Partial<RecordSettings>): Promise<boolean> {
  return updateConfig((config) => {
    changeRecord(config, patch);
    return undefined;
  });
}

// An edit of the recording settings by their value at the moment of the file write, not at the moment of the click: two edits
// in a row do not erase each other. The function returns null if there is nothing to change.
function editRecord(change: (settings: RecordSettings) => Partial<RecordSettings> | null): Promise<boolean> {
  return updateConfig((config) => {
    const patch = change(recordSettings(config));
    if (patch === null) return false;
    changeRecord(config, patch);
    return undefined;
  });
}

// "To recording": a signal is added to the recording list; no more than 64 signals (spec section 2.4).
export function addRecordSignal(name: string): Promise<boolean> {
  return editRecord(({ signals }) =>
    signals.includes(name) || signals.length >= MAX_RECORD_SIGNALS ? null : { signals: [...signals, name] },
  );
}

// Row removal: the start condition on this signal is cleared together with it.
export function removeRecordSignal(name: string): Promise<boolean> {
  return editRecord((settings) => ({
    signals: settings.signals.filter((s) => s !== name),
    trigger: settings.trigger?.signal === name ? null : settings.trigger,
  }));
}

// Move a row by delta places (−1 is up).
export function moveRecordSignal(name: string, delta: number): Promise<boolean> {
  return editRecord((settings) => {
    const signals = [...settings.signals];
    const from = signals.indexOf(name);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= signals.length) return null;
    signals.splice(to, 0, ...signals.splice(from, 1));
    return { signals };
  });
}

// A name from the recording list becomes a reference in the recordStart command: a sig number or the string pin:N.
function recordRef(name: string): number | string | null {
  const pin = pinOfName(name);
  // A board pin is recorded only if its net is in the active configure.
  if (pin !== null) return get().nets.some((n) => n.pin === pin) ? name : null;
  const signal = signalByPath(name);
  return signal && signal.kind !== "memory" ? signal.sig : null;
}

// "Record": a new recording replaces the earlier one (decision 25). Names that are not in the loaded
// core do not go into the recording; a core refusal (RECORD_INVALID) shows in the panel.
export async function startRecord(): Promise<void> {
  const target = simulation;
  const settings = recordSettings(get().config);
  if (!target || !get().sim.loaded) return;
  const refs = settings.signals.map(recordRef).filter((ref) => ref !== null);
  if (refs.length === 0) {
    set({ recordError: t("waves.error.empty") });
    return;
  }
  const trigger = settings.trigger ? recordRef(settings.trigger.signal) : null;
  // The start condition signal is absent in this build: a recording without the condition would not be the one requested.
  if (settings.trigger && trigger === null) {
    set({ recordError: t("waves.error.trigger", { signal: settings.trigger.signal }) });
    return;
  }
  try {
    await target.command({
      t: "recordStart",
      signals: refs,
      mode: settings.mode,
      depth: settings.depth,
      windowPs: String(settings.windowPs),
      trigger: trigger === null || !settings.trigger ? null : { signal: trigger, edge: settings.trigger.edge },
    });
    if (simulation !== target) return;
    // The earlier waveform is removed: the view window follows the new recording.
    waves.fit = true;
    waves.cursorA = null;
    waves.cursorB = null;
    setWaveModel(null, null);
    fetchedRecord = null;
    set({ recordError: null, vcdWave: null });
  } catch (e) {
    if (simulation === target) set({ recordError: e instanceof Error ? e.message : String(e) });
  }
}

export function stopRecord(): void {
  quiet({ t: "recordStop" });
}

// While a recording runs, the waveform updates after recordState if the changes are no more than
// this number: otherwise sending the recording every second would slow the simulation (decision 85).
const LIVE_WAVE_CHANGES = 100_000;

function onRecordState(message: RecordStateMessage): void {
  const before = get().record;
  set({
    record: {
      id: message.record,
      state: message.state,
      changes: message.changes,
      fromPs: message.fromPs,
      toPs: message.toPs,
    },
  });
  if (message.state === "armed") return;
  const finished = message.state === "done" || message.state === "stopped";
  const started = before?.id !== message.record || before.state === "armed";
  if (finished || started || message.changes <= LIVE_WAVE_CHANGES) refreshWave();
}

// Request of the recording data and a new waveform model. Requests do not overlap: if the recording
// changed during the request, it is repeated.
function refreshWave(): void {
  const target = simulation;
  const record = get().record;
  // The panel shows a testbench file: the recording data is requested when the panel returns to it.
  if (get().vcdWave !== null) return;
  if (!target || !record || record.state === "armed") return;
  // A finished recording does not change: its data is requested once.
  const final = record.state === "done" || record.state === "stopped";
  if (final && fetchedRecord === record.id) return;
  if (waveBusy) {
    waveStale = true;
    return;
  }
  waveBusy = true;
  waveStale = false;
  target
    .fetchRecord(record.id)
    .then((data) => {
      const now = get().record;
      if (simulation !== target || now?.id !== record.id) return;
      // During the request the panel was taken by the testbench waveform.
      if (get().vcdWave !== null) return;
      const model = modelFromTraces(data.info, data.traces);
      setWaveModel(model, record.id);
      if (final) fetchedRecord = record.id;
      // While a recording runs, recordState arrives no more than once a second of real time, and after
      // a step on pause it does not arrive at all: the change count and the span come from the received data.
      if (now.state === "recording") {
        set({
          record: {
            ...now,
            changes: modelChanges(model),
            fromPs: String(model.fromPs),
            toPs: String(model.toPs),
          },
        });
      }
    })
    // There is no recording any more (reset, new recording): the waveform stays as it was.
    .catch(() => undefined)
    .finally(() => {
      waveBusy = false;
      if (waveStale) refreshWave();
    });
}

// The VCD text from the waveform model (spec section 9.6); null if there is nothing to show.
export function exportVcd(): string | null {
  return waves.model ? writeVcd(waves.model) : null;
}

export function downloadVcd(): void {
  const text = exportVcd();
  if (text === null) return;
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${get().project?.name ?? "record"}.vcd`;
  link.click();
  URL.revokeObjectURL(url);
}

// Watch list rows with values from the last frame: a design signal from the watch block,
// a board pin from the net level. value is null if there is no value (the signal is absent in this build).
export interface WatchRow {
  signal: string;
  radix: Radix;
  width: number;
  value: bigint | null;
}

export function watchRows(): WatchRow[] {
  const live = simulation?.live;
  return watchItems(get().config).map((item) => {
    const pin = pinOfName(item.signal);
    if (pin !== null) {
      const net = live?.byPin.get(pin);
      return { ...item, width: 1, value: net ? BigInt(net.level) : null };
    }
    const signal = signalByPath(item.signal);
    const seen = signal ? live?.watch.get(signal.sig) : undefined;
    return { ...item, width: signal?.width ?? 1, value: seen ? wordsToBigInt(seen.words) : null };
  });
}

// ---- Testbench (spec sections 8.3 and 9.3) ----

// Waveform rows from a testbench file are no more than this number: the other signals of the file do not go into the panel.
export const MAX_VCD_ROWS = 100;

let testbenchSeq = 0; // number of the last run: the reply to an earlier one is dropped
let testbenchWave: { vcd: string; model: WaveModel } | null = null; // the parsed file of the last run

function dropTestbench(): void {
  testbenchSeq += 1;
  testbenchWave = null;
  set({ testbenches: null, topFile: null, testbench: NO_TESTBENCH, vcdWave: null });
}

// The file that "Run" will run: the chosen one, or, if it is not in the list, the first in the list.
export function currentTestbench(): string | null {
  const { testbenches, testbench } = get();
  const list = testbenches ?? [];
  return testbench.file !== null && list.includes(testbench.file) ? testbench.file : (list[0] ?? null);
}

export function selectTestbench(file: string): void {
  set({ testbench: { ...get().testbench, file } });
}

// "Run": the saved project files go to the server, Icarus Verilog runs the testbench.
// The simulation in the browser is not touched.
export async function runTestbench(): Promise<void> {
  const server = client;
  const file = currentTestbench();
  if (!server || !get().project || file === null || get().testbench.status === "running") return;
  const seq = ++testbenchSeq;
  set({ testbench: { ...NO_TESTBENCH, file, ran: file, status: "running" } });
  try {
    // A run takes the saved content, like a build (decision 46).
    await saveAll();
    const request = makeRequest((entry) => entry.content);
    if (seq !== testbenchSeq) return;
    if (request.failure) {
      set({ testbench: { ...NO_TESTBENCH, file, ran: file, status: "failed", diagnostics: [request.failure] } });
      return;
    }
    const response = await server.testbench(request.files, request.config, file);
    if (seq !== testbenchSeq) return;
    set({
      testbench: {
        file,
        ran: file,
        status: response.status,
        exitCode: response.exitCode,
        durationMs: response.durationMs,
        stdout: response.stdout,
        truncated: response.truncated,
        diagnostics: response.diagnostics,
        vcd: response.vcd,
        errorText: null,
      },
    });
  } catch (e) {
    if (seq !== testbenchSeq) return;
    if (e instanceof ServerError && e.status === 401) credentialRejected();
    const code = e instanceof ServerError ? e.code : "UNKNOWN";
    const text = tOr(`error.${code}`, "error.UNKNOWN", { code, text: e instanceof Error ? e.message : String(e) });
    set({ testbench: { ...NO_TESTBENCH, file, ran: file, status: "error", errorText: text } });
  }
}

// "Show waveform": the VCD file of the last run is converted to a waveform model
// and takes the panel (spec section 9.6). Panel rows are the signals of the file itself.
export async function showTestbenchWave(): Promise<void> {
  const server = client;
  const { vcd, ran } = get().testbench;
  if (!server || vcd === null || ran === null) return;
  const seq = testbenchSeq;
  try {
    if (testbenchWave?.vcd !== vcd) {
      const text = new TextDecoder().decode(await server.artifact(vcd));
      testbenchWave = { vcd, model: parseVcd(text) };
    }
  } catch (e) {
    if (seq !== testbenchSeq) return;
    if (e instanceof ServerError && e.status === 401) credentialRejected();
    // The file is kept on the server for an hour (spec section 8.3): after that a new run is needed.
    const gone = e instanceof ServerError && e.status === 404;
    const code = e instanceof ServerError ? e.code : "UNKNOWN";
    const text = tOr(`error.${code}`, "error.UNKNOWN", { code, text: e instanceof Error ? e.message : String(e) });
    set({ testbench: { ...get().testbench, errorText: gone ? t("testbench.wave.gone") : text } });
    return;
  }
  if (seq !== testbenchSeq) return;
  const model = testbenchWave.model;
  const names = [...new Set(model.signals.map((signal) => signal.name))];
  waves.fit = true;
  waves.cursorA = null;
  waves.cursorB = null;
  setWaveModel(model, null);
  set({
    vcdWave: { file: ran, rows: names.slice(0, MAX_VCD_ROWS), hidden: Math.max(0, names.length - MAX_VCD_ROWS) },
    bottomTab: "waves",
  });
}

// Return of the waveform panel to the core recording: its data is requested again.
export function closeTestbenchWave(): void {
  if (get().vcdWave === null) return;
  set({ vcdWave: null });
  waves.fit = true;
  waves.cursorA = null;
  waves.cursorB = null;
  setWaveModel(null, null);
  fetchedRecord = null;
  refreshWave();
}

// Testbench waveform rows live until the file closes: they are not written to fpgasim.json.
export function removeVcdRow(name: string): void {
  const shown = get().vcdWave;
  if (shown) set({ vcdWave: { ...shown, rows: shown.rows.filter((row) => row !== name) } });
}

export function moveVcdRow(name: string, delta: number): void {
  const shown = get().vcdWave;
  if (!shown) return;
  const rows = [...shown.rows];
  const from = rows.indexOf(name);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= rows.length) return;
  rows.splice(to, 0, ...rows.splice(from, 1));
  set({ vcdWave: { ...shown, rows } });
}

// ---- Folder on disk, archives and export (spec section 9.2) ----

const POLL_MS = 1000; // polling of file modification times
const REBUILD_DELAY_MS = 500; // rebuild after the last change

let pollTimer: ReturnType<typeof setInterval> | null = null;
let rebuildTimer: ReturnType<typeof setTimeout> | null = null;
let syncing = false; // a folder scan is queued or running
// File marks on disk from the last scan or our own write: modification time and size.
const diskStamps = new Map<string, { modified: number; size: number }>();
let diskQueue: Promise<unknown> = Promise.resolve(); // folder scans and disk writes go one at a time
// Files whose write to disk has started: their new text is already in memory, and the old one is still on disk.
// The scan skips them, otherwise it would put the old text back into the editor.
const pendingWrites = new Map<string, number>();

function withDisk<T>(work: () => Promise<T>): Promise<T> {
  const next = diskQueue.then(work, work);
  diskQueue = next.catch(() => undefined);
  return next;
}

const folderBlocked = (): boolean => {
  const folder = get().folder;
  return folder !== null && folder.access !== "granted";
};

function setFolder(patch: Partial<FolderState>): void {
  const folder = get().folder;
  if (folder) set({ folder: { ...folder, ...patch } });
}

// Folder access is lost (the folder was deleted, permission revoked): polling stops,
// the workspace shows the "Reopen folder" button.
function folderLost(e: unknown): void {
  stopPolling();
  setFolder({ access: "lost", error: e instanceof Error ? e.message : String(e) });
}

// A project file write: to the folder (if the project is in a folder), then to the browser store.
// store = false — disk only (the caller writes the store).
async function writeOut(project: ProjectRecord, path: string, text: string, store = true): Promise<void> {
  const folder = project.folder;
  if (folder) {
    pendingWrites.set(path, (pendingWrites.get(path) ?? 0) + 1);
    try {
      await withDisk(async () => {
        try {
          diskStamps.set(path, await writeDiskFile(folder, path, text));
        } catch (e) {
          folderLost(e);
          throw e;
        }
      });
    } finally {
      const left = (pendingWrites.get(path) ?? 1) - 1;
      if (left > 0) pendingWrites.set(path, left);
      else pendingWrites.delete(path);
    }
  }
  if (store) seenSeq.set(path, await (await db()).saveFile(project.id, path, text, seenSeq.get(path) ?? 0));
}

async function removeOut(project: ProjectRecord, path: string): Promise<void> {
  const folder = project.folder;
  if (!folder) return;
  await withDisk(async () => {
    try {
      await removeDiskFile(folder, path);
      diskStamps.delete(path);
    } catch (e) {
      folderLost(e);
      throw e;
    }
  });
}

function stopPolling(): void {
  if (pollTimer !== null) clearInterval(pollTimer);
  pollTimer = null;
  if (rebuildTimer !== null) clearTimeout(rebuildTimer);
  rebuildTimer = null;
}

function stopFolder(): void {
  stopPolling();
  diskStamps.clear();
}

// Folder access and the first scan: files from disk replace the copy in the browser store.
async function connectFolder(project: ProjectRecord, ask: boolean, seq: number): Promise<void> {
  const dir = project.folder;
  if (!dir) return;
  let access: FolderAccess;
  try {
    const state = await folderAccess(dir, ask);
    access = state === "granted" ? "granted" : state === "denied" ? "denied" : "prompt";
  } catch (e) {
    if (seq === openSeq) folderLost(e);
    return;
  }
  if (seq !== openSeq) return;
  setFolder({ access, error: null });
  if (access !== "granted") return;
  diskStamps.clear();
  await queueSync(true);
  if (seq !== openSeq || folderBlocked()) return;
  stopPolling();
  pollTimer = setInterval(() => {
    if (!syncing) void queueSync(false);
  }, POLL_MS);
  void loadFileRoles();
}

// The "Reopen folder" button: the browser asks for permission (a user click is needed).
export async function reconnectFolder(): Promise<void> {
  const project = get().project;
  if (!project?.folder) return;
  stopPolling();
  await connectFolder(project, true, openSeq);
}

export async function setAutoBuild(on: boolean): Promise<void> {
  const project = get().project;
  if (!project) return;
  setFolder({ autoBuild: on });
  if (!on && rebuildTimer !== null) {
    clearTimeout(rebuildTimer);
    rebuildTimer = null;
  }
  await (await db()).setAutoBuild(project.id, on);
}

function queueSync(initial: boolean): Promise<void> {
  syncing = true;
  return withDisk(() => syncFolder(initial)).finally(() => {
    syncing = false;
  });
}

// A folder scan: new, changed and deleted files on disk. A file is read only if its
// modification time or size differs from the recorded one. initial is the first scan after opening:
// a file that is not on disk is deleted from the project, even if it has no mark.
async function syncFolder(initial: boolean): Promise<void> {
  const project = get().project;
  const dir = project?.folder;
  const seq = openSeq;
  if (!project || !dir || folderBlocked()) return;
  const changed: string[] = [];
  try {
    const disk = await scanFolder(dir);
    if (seq !== openSeq) return;
    const database = await db();
    const seen = new Set<string>();
    for (const entry of disk) {
      if (filePathProblem(entry.path, []) !== null) continue;
      seen.add(entry.path);
      const stamp = diskStamps.get(entry.path);
      if (stamp?.modified === entry.modified && stamp.size === entry.size) continue;
      if (pendingWrites.has(entry.path)) continue;
      const text = await readDiskFile(entry.file);
      if (seq !== openSeq) return;
      if (pendingWrites.has(entry.path)) continue;
      diskStamps.set(entry.path, { modified: entry.modified, size: entry.size });
      const file = sessionFiles.get(entry.path);
      // Not text or over the limit: such a file is not taken into the project (decision 96).
      if (text === null || file?.content === text) continue;
      if (!file && sessionFiles.size >= MAX_FILES) continue;
      await database.diskContent(project.id, entry.path, text);
      if (seq !== openSeq) return;
      if (file) {
        file.content = text;
        if (file.draft === text) file.draft = null;
        // An unsaved edit stays in the editor; without one the editor shows the new text.
        if (file.draft === null) editor.replace(entry.path, text);
      } else {
        sessionFiles.set(entry.path, { content: text, draft: null, base: null });
      }
      changed.push(entry.path);
    }
    for (const path of [...sessionFiles.keys()]) {
      if (seen.has(path) || (!initial && !diskStamps.has(path)) || pendingWrites.has(path)) continue;
      diskStamps.delete(path);
      // A file with an unsaved edit stays in the project: saving will write it to the folder again.
      if (sessionFiles.get(path)?.draft != null) continue;
      clearTimeout(draftTimers.get(path));
      draftTimers.delete(path);
      sessionFiles.delete(path);
      await database.deleteFile(project.id, path);
      if (seq !== openSeq) return;
      editor.close(path);
      changed.push(path);
    }
  } catch (e) {
    if (seq === openSeq) folderLost(e);
    return;
  }
  setFolder({ syncs: (get().folder?.syncs ?? 0) + 1 });
  if (changed.length === 0) return;
  const files = sortedEntries();
  const active = get().activePath;
  set({ files, activePath: active !== null && sessionFiles.has(active) ? active : null });
  const next = files[0];
  if (get().activePath === null && next) selectFile(next.path);
  setFolder({ changes: (get().folder?.changes ?? 0) + 1 });
  void applyConfig();
  if (!initial) folderChanged();
}

// Files in the folder changed: a rebuild 500 ms after the last change if the
// "Rebuild on change" switch is on; otherwise a check without a build.
function folderChanged(): void {
  if (!get().folder?.autoBuild || !client) {
    scheduleCheck();
    return;
  }
  if (rebuildTimer !== null) clearTimeout(rebuildTimer);
  const fire = (): void => {
    // The running build took the earlier files: the new one starts after it.
    if (get().build.status === "building") rebuildTimer = setTimeout(fire, REBUILD_DELAY_MS);
    else {
      rebuildTimer = null;
      void build(false);
    }
  };
  rebuildTimer = setTimeout(fire, REBUILD_DELAY_MS);
}

// "Open folder": choose a folder, then a project with its files. A folder that is already in the list
// opens as the earlier project.
export async function openFolder(): Promise<void> {
  let dir: FileSystemDirectoryHandle | null;
  try {
    dir = await pickFolder();
  } catch (e) {
    report(null, e instanceof Error ? e.message : String(e));
    return;
  }
  if (!dir) return;
  const database = await db();
  const known = await database.findFolder(dir);
  if (known) {
    set({ transfer: null });
    await openProject(known.id, true);
    return;
  }
  let imported: Imported;
  try {
    const entries: { path: string; bytes: Uint8Array }[] = [];
    for (const entry of await scanFolder(dir)) {
      entries.push({ path: entry.path, bytes: new Uint8Array(await (await entry.file.getFile()).arrayBuffer()) });
    }
    imported = importFiles(entries);
  } catch (e) {
    report(null, e instanceof Error ? e.message : String(e));
    return;
  }
  const project = await database.createProject(dir.name, filesBoard(imported.files), imported.files, dir);
  report(imported, null);
  await openProject(project.id, true);
}

const archiveName = (file: File): string => file.name.replace(/\.zip$/i, "") || t("projects.newName");

// "Upload archive": a new project from the files of a .zip archive.
export async function importArchive(file: File): Promise<void> {
  let imported: Imported;
  try {
    imported = readArchive(new Uint8Array(await file.arrayBuffer()), file.name);
  } catch {
    report(null, t("transfer.badArchive", { file: file.name }));
    return;
  }
  if (imported.files.length === 0) {
    report(imported, t("transfer.emptyArchive", { file: file.name }));
    return;
  }
  const project = await (
    await db()
  ).createProject(archiveName(file), filesBoard(imported.files), imported.files, undefined, ownerLogin());
  report(imported, null);
  await openProject(project.id);
}

const filePath = (file: File): string => file.webkitRelativePath || file.name;

// Files from the user's disk. A dropped folder arrives as an unreadable file: it goes
// to the report with the reason "unreadable".
async function readFiles(files: readonly File[]): Promise<Imported> {
  const entries: { path: string; bytes: Uint8Array }[] = [];
  const unreadable: Skipped[] = [];
  for (const file of files) {
    try {
      entries.push({ path: filePath(file), bytes: new Uint8Array(await file.arrayBuffer()) });
    } catch {
      unreadable.push({ path: filePath(file), reason: "read" });
    }
  }
  const imported = importFiles(entries);
  return { files: imported.files, skipped: [...imported.skipped, ...unreadable] };
}

// Files dropped on the projects screen: a .zip archive is a project from the archive, otherwise a project from these files.
export async function importDropped(files: readonly File[]): Promise<void> {
  const [only] = files;
  if (files.length === 1 && only && /\.zip$/i.test(only.name)) {
    await importArchive(only);
    return;
  }
  const imported = await readFiles(files);
  if (imported.files.length === 0) {
    report(imported, t("transfer.nothing"));
    return;
  }
  const project = await (
    await db()
  ).createProject(t("projects.newName"), filesBoard(imported.files), imported.files, undefined, ownerLogin());
  report(imported, null);
  await openProject(project.id);
}

// Upload files to an open project. A file with the same path is replaced together with its edit.
export async function uploadFiles(files: readonly File[]): Promise<void> {
  const project = get().project;
  if (!project || folderBlocked()) return;
  const read = await readFiles(files);
  const imported: Imported = { files: [], skipped: read.skipped };
  for (const file of read.files) {
    const problem = sessionFiles.has(file.path) ? null : await newPathProblem(project, file.path);
    if (problem === null) imported.files.push(file);
    else imported.skipped.push({ path: file.path, reason: problem === "folder" ? "folder" : "name" });
  }
  const fresh = imported.files.filter((f) => !sessionFiles.has(f.path));
  const room = MAX_FILES - sessionFiles.size;
  const extra: Skipped[] = fresh.slice(Math.max(room, 0)).map((f) => ({ path: f.path, reason: "count" }));
  const taken = imported.files.filter((f) => !extra.some((x) => x.path === f.path));
  try {
    for (const { path, content } of taken) {
      try {
        await writeOut(project, path, content);
      } catch {
        return;
      }
      clearTimeout(draftTimers.get(path));
      draftTimers.delete(path);
      const old = sessionFiles.get(path);
      sessionFiles.set(path, { content, draft: null, base: old?.base ?? null });
      editor.replace(path, content);
    }
  } finally {
    set({ files: sortedEntries() });
  }
  report({ files: taken, skipped: [...imported.skipped, ...extra] }, null);
  const [first] = taken;
  if (first) selectFile(first.path);
  void applyConfig();
  scheduleCheck();
}

// Saved project files in path order.
export function projectFiles(): ProjectFile[] {
  return [...sessionFiles.entries()]
    .map(([path, file]) => ({ path, content: file.content }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

// Changed files: the text (with an unsaved edit) differs from the original, or the file was added
// after project creation. Export saves the edits first, so the same text is exported.
export function changedFiles(): ProjectFile[] {
  return [...sessionFiles.entries()]
    .filter(([, file]) => file.base === null || file.base !== currentText(file))
    .map(([path, file]) => ({ path, content: currentText(file) }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

function saveBytes(name: string, bytes: Uint8Array, type: string): void {
  const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}

// Export: as an archive, an open file, or only the changed files. Before export the edits
// are saved: what is exported is what the editor shows. Returns false if there is nothing to export.
export async function downloadProject(what: "archive" | "file" | "changed"): Promise<boolean> {
  const project = get().project;
  if (!project) return false;
  await saveAll();
  if (what === "file") {
    const path = get().activePath;
    const file = path === null ? undefined : sessionFiles.get(path);
    if (path === null || !file) return false;
    saveBytes(path.split("/").pop() ?? path, new TextEncoder().encode(file.content), "text/plain");
    return true;
  }
  const files = what === "archive" ? projectFiles() : changedFiles();
  if (files.length === 0) return false;
  saveBytes(
    downloadName(project.name, what === "archive" ? ".zip" : "-changed.zip"),
    writeArchive(files),
    "application/zip",
  );
  return true;
}
