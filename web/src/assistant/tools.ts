// The assistant's tools (decision 175): the model asks, the browser reads the live project state and answers.
// The tool definitions the model sees live on the server (server/fpgasim_server/assistant.py); the names and
// inputs here match them.
export const MAX_RESULT_CHARS = 60_000;
const DEFAULT_CHANGES = 50;
// The upper bound of max_changes, the same as "maximum" in the server tool definition: the model may ask for any
// number, and the core would read the whole recording before the result is cut.
export const MAX_CHANGES = 500;

// Plain readers of the project state: the tests give a fixture, the interface gives liveSource().
export interface ToolSource {
  files(): { path: string; content: string }[];
  topFile(): string | null;
  testbenches(): string[] | null;
  build(): unknown;
  messages(): unknown[];
  notices(): { code: string; text: string; net?: string | undefined; part?: string | undefined; time: string }[];
  board(): string | null;
  parts(): {
    id: string;
    type: string;
    label: string;
    origin: string;
    enabled: boolean;
    pins: Record<string, number>;
    settings: Record<string, unknown>;
  }[];
  binding(): {
    source: string;
    file: string | null;
    rows: { name: string; dir: string; pin: number | null; pull: string | null }[];
    pins: unknown;
    problems: unknown[];
  };
  pins(): { pin: number; state: string; level: number | null }[];
  run(): { run: string; loaded: boolean; time: string };
  wave(): { fromPs: string; toPs: string; signals: { name: string }[] } | null;
  waveChanges(name: string, from: number, count: number): { t: string; v: string }[];
  signals(): { path: string }[];
}

export interface ToolResult {
  text: string;
  error: boolean;
}

function result(value: unknown, error = false): ToolResult {
  let text = JSON.stringify(value);
  if (text.length > MAX_RESULT_CHARS) {
    text = `${text.slice(0, MAX_RESULT_CHARS)}\n[cut: ${String(text.length - MAX_RESULT_CHARS)} more characters]`;
  }
  return { text, error };
}

const failure = (text: string): ToolResult => result({ error: text }, true);

function waveform(input: Record<string, unknown>, source: ToolSource): ToolResult {
  const available = source.signals().map((s) => s.path);
  const wave = source.wave();
  const names = wave?.signals.map((s) => s.name) ?? [];
  const wanted = Array.isArray(input.signals) ? input.signals.filter((s): s is string => typeof s === "string") : [];
  if (wanted.length === 0) {
    if (!wave || names.length === 0) return result({ recorded: false, available });
    return result({ recorded: true, from_ps: wave.fromPs, to_ps: wave.toPs, signals: names, available });
  }
  const asked = typeof input.max_changes === "number" ? Math.floor(input.max_changes) : 0;
  const max = asked > 0 ? Math.min(asked, MAX_CHANGES) : DEFAULT_CHANGES;
  return result(
    Object.fromEntries(wanted.map((n) => [n, names.includes(n) ? source.waveChanges(n, 0, max) : "not recorded"])),
  );
}

export function runTool(name: string, input: Record<string, unknown>, source: ToolSource): ToolResult {
  switch (name) {
    case "list_files":
      return result({
        files: source.files().map((f) => ({ path: f.path, bytes: f.content.length })),
        top: source.topFile(),
        testbenches: source.testbenches(),
      });
    case "read_file": {
      const file = source.files().find((f) => f.path === input.path);
      return file ? result({ path: file.path, content: file.content }) : failure("no such file");
    }
    case "get_messages":
      return result({ build: source.build(), messages: source.messages(), notices: source.notices() });
    case "get_board": {
      const board = source.board();
      if (board === null) return failure("no project open");
      const binding = source.binding();
      const bound = new Set(binding.rows.map((r) => r.pin));
      const run = source.run();
      return result({
        board,
        simulation: { run: run.run, loaded: run.loaded, time_ps: run.time },
        parts: source
          .parts()
          .filter((p) => p.enabled)
          .map((p) => ({
            id: p.id,
            type: p.type,
            label: p.label,
            origin: p.origin,
            pins: p.pins,
            settings: p.settings,
          })),
        binding,
        pins: source.pins().filter((p) => bound.has(p.pin)),
      });
    }
    case "get_waveform":
      return waveform(input, source);
    default:
      return failure(`unknown tool ${name}`);
  }
}
