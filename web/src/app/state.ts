// Interface state (Zustand, spec section 9.1). Only what changes rarely and needs a
// React redraw lives here; core frames do not get here.
import type { SyncStatus } from "../project/sync";
import { create } from "zustand";
import type { AdminProject } from "../build/client";
import type { Account, Diagnostic, Resolved } from "../build/types";
import type { ProjectConfig } from "../project/config";
import type { Skipped } from "../project/files";
import type { ProjectRecord } from "../project/store";
import type { NoticeMessage, RecordRunState, RunState, SignalInfo, Speed } from "../sim/messages";
import { DEFAULT_LAYOUT, type Layout } from "./layout";

// Sign-in (accounts spec section 5.1, docs/tz-accounts.md): missing — no key and no session, the sign-in form shows;
// checking — the sign-in data is being checked; ok — the server accepted it; unreachable — the server did not answer.
export type AuthStatus = "missing" | "checking" | "ok" | "unreachable";

// A sign-in refusal that the sign-in form shows.
export type AuthProblem = "badCredentials" | "locked" | "keyRejected" | "unreachable" | "failed" | null;

// The sign-in in effect: by access key (owner is the key owner's name) or by account session.
export type Access = { kind: "none" } | { kind: "key"; owner: string } | { kind: "session"; user: Account };

// A screen without an open project: "Projects" or "Users" (section 5.6).
export type Screen = "projects" | "users";

export interface BuildState {
  status: "none" | "building" | "ok" | "failed" | "error";
  startedAt: number | null; // performance.now() at the build start
  buildId: string | null;
  cached: boolean;
  durationMs: number | null;
  errorCode: string | null; // a server refusal or a core load failure when status = "error"
  errorText: string | null;
}

export interface SimState {
  loaded: boolean; // the core is loaded and configured
  run: RunState;
  time: string; // ps, a string: the value from the last state
  cycle: number;
  speed: Speed;
}

export interface NetRow {
  pin: number;
  port: string | null; // port bit name as in the design; null for a net without a port
}

export interface FileEntry {
  path: string;
  dirty: boolean;
}

// The open workspace dialog (spec section 9.3). Part: part is the name of the part being edited,
// without it a new part is added to the breadboard.
export type DialogState = { kind: "binding" } | { kind: "settings" } | { kind: "part"; part: string | null } | null;

// Bottom panel tab: messages, nets, signals, waveforms, testbench or the terminal
// of the UART part with this name.
export type BottomTab = "messages" | "nets" | "signals" | "waves" | "testbench" | `terminal:${string}`;

// The last testbench run (spec section 8.3). status: running — the request is in progress; ok, failed, timeout —
// the server's answer; error — the server did not answer or refused.
export interface TestbenchState {
  file: string | null; // the chosen file; null — the first in the list
  status: "none" | "running" | "ok" | "failed" | "timeout" | "error";
  ran: string | null; // the file the result belongs to
  exitCode: number | null;
  durationMs: number | null;
  stdout: string;
  truncated: boolean;
  diagnostics: Diagnostic[];
  vcd: string | null; // waveform file path on the server
  errorText: string | null; // a server refusal or a waveform display failure
}

export const NO_TESTBENCH: TestbenchState = {
  file: null,
  status: "none",
  ran: null,
  exitCode: null,
  durationMs: null,
  stdout: "",
  truncated: false,
  diagnostics: [],
  vcd: null,
  errorText: null,
};

// Access to the folder of a project in a folder (spec section 9.2): checking — the browser has not answered yet; granted — access exists;
// prompt and denied — the browser waits for the user's permission; lost — the folder cannot be read (deleted,
// permission revoked).
export type FolderAccess = "checking" | "granted" | "prompt" | "denied" | "lost";

export interface FolderState {
  access: FolderAccess;
  autoBuild: boolean; // "Rebuild on change"
  error: string | null; // failure text when access = lost
  syncs: number; // number of folder scans since the project opened
  changes: number; // number of scans that found changes
}

// Report on the last file transfer into the project: what was not taken and why; error — a refusal of everything.
export interface TransferReport {
  skipped: Skipped[];
  error: string | null;
}

// The core recording by the last recordState message (spec section 4.3).
export interface RecordInfo {
  id: number;
  state: RecordRunState;
  changes: number;
  fromPs: string;
  toPs: string;
}

export interface AppState {
  authStatus: AuthStatus;
  authProblem: AuthProblem;
  authText: string | null; // server text when authProblem = failed
  access: Access;
  // The login of the saved session until the server confirms it (the server did not answer): it
  // shows the account's projects. null — no session.
  pendingLogin: string | null;
  sessionExpired: boolean; // the session ended while a project is open: a strip above the workspace (section 5.2)
  adopted: number; // number of "nobody's" projects taken by the last sign-in (section 4.2)
  sync: Record<string, SyncStatus>; // project sync state by identifier (section 4.5)
  busyProject: string | null; // name of the project open in another tab (section 4.3)
  // The project was deleted on another device (section 4.4, item 6): the copy was erased or saved as a new project.
  syncNotice: "deleted" | "copied" | null;
  // Mismatches of the open project (section 5.5): paths of files with a mismatch, including those deleted
  // in the browser, and the path of the file whose dialog is open.
  conflictPaths: string[];
  conflictOpen: string | null;
  // The "Not everything is saved on the server" dialog on sign-out (section 5.3): busy — sending is in progress;
  // problem — the refusal text of the last attempt. null — the dialog is closed.
  exitAsk: { busy: boolean; problem: string | null } | null;
  // A user's project list on the "Users" page (section 5.6). projects: null — the list
  // is loading. null — the list is closed.
  userProjects: { login: string; projects: AdminProject[] | null; error: string | null } | null;
  screen: Screen;
  users: Account[] | null; // rows of the "Users" page; null — the list was not received
  usersError: string | null; // refusal of the last read of the user list
  owner: string | null;
  serverOk: boolean | null;
  projects: ProjectRecord[];
  project: ProjectRecord | null;
  files: FileEntry[];
  activePath: string | null;
  build: BuildState;
  stale: boolean; // design files or design settings changed after the build the simulation runs on
  diagnostics: Diagnostic[];
  notices: NoticeMessage[];
  sim: SimState;
  nets: NetRow[]; // nets of the active configure in message order
  speed: Speed; // the chosen speed multiplier; the core confirms it in state
  clocked: boolean; // the built design has a clock: stepping by clock cycles is possible
  stepping: boolean; // a step has started and not finished
  checks: number; // number of finished /v1/check checks since the project opened
  layout: Layout;
  bottomTab: BottomTab; // bottom panel tab
  fileDrop: boolean; // files from disk are being dragged over the workspace (decision 166)
  config: ProjectConfig | null; // the saved fpgasim.json; null — the file does not parse
  resolved: Resolved | null; // the resolved field of the build the core was loaded from
  partTypes: string[]; // part types of the loaded core (ready.partTypes)
  builds: number; // number of /v1/build requests since the project opened
  dialog: DialogState;
  signals: SignalInfo[]; // signals of the loaded core (the signals reply)
  record: RecordInfo | null; // the recording that exists in the core
  recordError: string | null; // refusal of the last "Record"
  testbenches: string[] | null; // testbench files by the last server reply; null — there was no reply
  topFile: string | null; // file with the top module by the last server reply
  testbench: TestbenchState;
  // The waveform panel shows a testbench VCD file: the panel rows in order, and the testbench file.
  // null — the panel shows the core recording, rows come from record.signals.
  vcdWave: { file: string; rows: string[]; hidden: number } | null;
  folder: FolderState | null; // null — the project is in the browser
  transfer: TransferReport | null;
}

export const NO_BUILD: BuildState = {
  status: "none",
  startedAt: null,
  buildId: null,
  cached: false,
  durationMs: null,
  errorCode: null,
  errorText: null,
};

export const NO_SIM: SimState = { loaded: false, run: "idle", time: "0", cycle: 0, speed: 1 };

export const useApp = create<AppState>(() => ({
  authStatus: "checking",
  authProblem: null,
  authText: null,
  access: { kind: "none" },
  pendingLogin: null,
  sessionExpired: false,
  adopted: 0,
  sync: {},
  busyProject: null,
  syncNotice: null,
  conflictPaths: [],
  conflictOpen: null,
  exitAsk: null,
  userProjects: null,
  screen: "projects",
  users: null,
  usersError: null,
  owner: null,
  serverOk: null,
  projects: [],
  project: null,
  files: [],
  activePath: null,
  build: NO_BUILD,
  stale: false,
  diagnostics: [],
  notices: [],
  sim: NO_SIM,
  nets: [],
  speed: 1,
  clocked: false,
  stepping: false,
  checks: 0,
  layout: DEFAULT_LAYOUT,
  bottomTab: "messages",
  fileDrop: false,
  config: { format: 1 },
  resolved: null,
  partTypes: [],
  builds: 0,
  dialog: null,
  signals: [],
  record: null,
  recordError: null,
  testbenches: null,
  topFile: null,
  testbench: NO_TESTBENCH,
  vcdWave: null,
  folder: null,
  transfer: null,
}));
