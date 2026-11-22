// The shape of the window.__fpgasim object (spec section 9.7). A separate file without code: end-to-end tests read it too.
import type { Diagnostic } from "../build/types";
import type { Command, ReplyMessage } from "../sim/messages";

export interface DebugApi {
  // Simulation state, time, clock cycle, speed ratio; next to them the result of the last build.
  state(): {
    run: string;
    loaded: boolean;
    time: string; // ps
    cycle: number;
    speed: number | "max";
    ratio: number;
    stepping: boolean; // a step started and has not finished
    stale: boolean; // files or design settings changed after the build the simulation runs on
    checks: number; // number of finished /v1/check checks since the project was opened
    builds: number; // number of /v1/build requests since the project was opened
    build: {
      status: string;
      buildId: string | null;
      cached: boolean;
      durationMs: number | null;
      errorCode: string | null;
    };
  };
  // Level, toggles since the start, last share at one; null if there is no net with such a pin.
  net(pin: number): { level: number; toggles: number; duty: number; flags: number } | null;
  // Part state: bytes from the frame (the format is set by the part, spec section 6) and widget numbers.
  // LED: brightness is the brightness by the last frame (the share of time at the active level per batch
  // or per step), shown is the smoothed on-screen brightness; on pause the screen shows the instantaneous level.
  // Button: pressed, latched. The point is the part center in the board drawing area, in pixels.
  part(id: string): {
    state: number[];
    brightness?: number;
    shown?: number;
    pressed?: boolean;
    latched?: boolean;
    on?: boolean; // switch
    level?: number; // probe: pin level, −1 without a net
    colors?: string[]; // WS2812: LED colors after the last latch, "#rrggbb"
    errors?: number; // WS2812: duration error counter
    received?: number; // UART: bytes received from the FPGA
    sent?: number; // UART: bytes sent to the FPGA
    queued?: number; // UART: bytes in the transmit queue
    terminal?: number[]; // UART: terminal log bytes since the simulation start
    point: { x: number; y: number };
  } | null;
  // Part events (partEvent) since the simulation start, at most the last 500 across all parts.
  partEvents(id: string): { event: string; data: Record<string, unknown>; time: string }[];
  // Bottom panel tab: "messages", "nets", "signals", "waves", "testbench" or "terminal:<part name>".
  bottomTab(): string;
  // Header pins on the board drawing: state (free, used, forbidden…) and level.
  // point is the pad center in the drawing area, in pixels.
  pins(): { pin: number; state: string; level: number | null; point: { x: number; y: number } }[];
  // Drawing parts: built-in (origin "board") and on the breadboard ("breadboard").
  parts(): { id: string; type: string; pins: Record<string, number>; origin: string; enabled: boolean }[];
  // The binding in effect: the source ("pins", "cst", "ambiguous"), the .cst file, the dialog table rows
  // and warnings (PIN_FORBIDDEN, CLOCK_EXTRA …). Before the first build rows is empty.
  binding(): {
    source: string;
    file: string | null;
    rows: { name: string; dir: string; pin: number | null; pull: string }[];
    pins: { port: string; bit: number; pin: number; pull: string }[];
    problems: { code: string; name: string; pin: number | null }[];
  };
  // File roles by the last server response: the file with the top module and testbenches; null means there was no response.
  fileRoles(): { top: string | null; testbenches: string[] | null };
  // Saved content of a project file; null if there is no file.
  file(path: string): string | null;
  // Messages shown in the "Messages" tab: the display level, a short text and an explanation.
  messages(): {
    code: string;
    level: string;
    file: string | null;
    line: number | null;
    text: string;
    explain: string | null;
  }[];
  // Workspace layout: area sizes in pixels and collapsed areas.
  layout(): { files: number; board: number; bottom: number; collapsed: Record<string, boolean> };
  diagnostics(): Diagnostic[];
  // Signals of the loaded core (the signals response, spec section 4.5).
  signals(): { sig: number; path: string; width: number; kind: string }[];
  // Watch list: the value from the last frame as a decimal string (null means no value)
  // and the text in the chosen radix, as in a table cell.
  watch(): { signal: string; radix: string; value: string | null; text: string | null }[];
  // Core record by the last recordState; null if there is no record. error is the "Record" rejection.
  record(): {
    id: number | null;
    state: string;
    changes: number;
    fromPs: string;
    toPs: string;
    error: string | null;
  } | null;
  // Waveform in memory: the source, the span, the change count (without values at the span start)
  // and signals; initial and last are the values at the span start and end as decimal strings.
  wave(): {
    source: string;
    fromPs: string;
    toPs: string;
    changes: number;
    signals: { name: string; width: number; changes: number; initial: string; last: string }[];
  } | null;
  // Waveform signal changes in order: time in ps and the value as decimal strings.
  // from is the index of the first change (from zero), count is how many to return (1000 by default).
  waveChanges(name: string, from?: number, count?: number): { t: string; v: string }[];
  // Waveform view window, cursors (ps) and panel rows in order. vcd is the testbench file
  // whose waveform the panel shows; null means the panel shows the core record.
  waveView(): {
    fromPs: number;
    toPs: number;
    cursorA: number | null;
    cursorB: number | null;
    rows: string[];
    vcd: string | null;
  };
  // Testbench: files by the server response (null means there was no response), the selected file and the last run.
  // status: "none", "running", "ok", "failed", "timeout", "error"; vcd is the waveform file path.
  testbench(): {
    files: string[] | null;
    file: string | null;
    status: string;
    exitCode: number | null;
    durationMs: number | null;
    stdout: string;
    truncated: boolean;
    diagnostics: Diagnostic[];
    vcd: string | null;
    error: string | null;
  };
  // Interface language chosen at page load (decision 168).
  language(): "ru" | "en";
  // Language change as in the switch: saving the choice and edits, reloading the page.
  setLanguage(lang: "ru" | "en"): Promise<void>;
  // Interface theme: the choice ("light", "dark", "system") and whether the dark look is in effect.
  theme(): { choice: string; dark: boolean };
  // Quick help: whether it is open and the number of its sections.
  help(): { open: boolean; sections: number; shots: number };
  // The "From example" list in order: the author's lessons (lesson: true), then the repository examples.
  examples(): { name: string; lesson: boolean }[];
  // Saved files of the open project in path order and the paths of changed files (decision 98).
  files(): { path: string; content: string }[];
  // Files are dragged from disk over the workspace: the "Release to upload files to the project" hint is shown (decision 166).
  fileDrop(): boolean;
  changedFiles(): string[];
  // The open project: kind and name. Folder: access ("granted", "prompt", "denied", "lost"),
  // the rebuild switch, the number of walks and of walks with changes; null means a project in the browser.
  // view is the owner login of a temporary copy of another user's project (accounts spec section 5.6 (docs/tz-accounts.md)); other
  // projects have no such field.
  project(): { name: string; kind: string; view?: string } | null;
  // Board identifier of the open project (the board field of fpgasim.json).
  board(): string | null;
  // Sign-in (accounts spec section 5.7 (docs/tz-accounts.md)): kind ("none", "key", "session"), login, name, role.
  // For a key, name is the key owner's name. expired means the session ended while a project was open (section 5.2).
  account(): { kind: string; login: string | null; name: string | null; role: string | null; expired: boolean };
  // Sync of the open project (accounts spec section 5.7): the state of section 4.5, the server
  // rejection text, the revision, the paths of unsent files and files with a conflict. null means the project
  // is not synced (sign-in by key, project in a folder) or not open.
  sync(): Promise<{ state: string; error: string | null; rev: number; pending: string[]; conflicts: string[] } | null>;
  // Sync of the project list and the open project now; it finishes after the response is parsed.
  syncNow(): Promise<void>;
  // The project list on the projects screen: identifier, name, kind and sync state.
  // view is the owner login for a view copy (the "Viewing" group), otherwise null.
  projects(): { id: string; name: string; kind: string; sync: string | null; view: string | null }[];
  // The message of section 4.4, item 6: "deleted" means the open project was deleted on another device and erased;
  // "copied" means saved as a new project; null means no message.
  syncNotice(): string | null;
  // Conflicts of the open project (section 5.5): paths marked in the file list and the path of the file
  // whose dialog is open (null means the dialog is closed).
  conflicts(): { paths: string[]; open: string | null };
  // The "Not everything is saved on the server" dialog (section 5.3): whether it is open, whether sending is in progress, the rejection text.
  exitDialog(): { busy: boolean; problem: string | null } | null;
  // The user's project list on the "Users" page (section 5.6); null means the list is closed.
  userProjects(): {
    login: string;
    projects: { id: string; name: string; trashed: boolean; purged: boolean; deletedAt: number | null }[] | null;
  } | null;
  // The name of a project that did not open because it is open in another tab (section 4.3).
  busyProject(): string | null;
  // Rows of the "Users" page table; empty if the page is not open.
  users(): {
    login: string;
    name: string;
    role: string;
    enabled: boolean;
    lastLogin: number | null;
    lastBuild: number | null;
    projects: number;
  }[];
  folder(): { access: string; autoBuild: boolean; syncs: number; changes: number; error: string | null } | null;
  // A report of the last file transfer: files not taken, with the reason, and a whole-transfer rejection.
  transfer(): { skipped: { path: string; reason: string }[]; error: string | null } | null;
  // The VCD text that the "Export VCD" button writes; null if there is no waveform.
  vcd(): string | null;
  command(message: Command): Promise<ReplyMessage>;
  // The open file, the cursor position (from one) and message markers in that file.
  editor(): {
    path: string | null;
    line: number;
    column: number;
    marks: { line: number; severity: string }[];
    dirty: string[];
  };
}
