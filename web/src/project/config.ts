// Project settings fpgasim.json (spec section 2) on the interface side: reading and writing the file,
// the binding source, the binding from the pins field, export to .cst, breadboard parts and changes
// of built-in parts. Port names and widths come from the server (resolved.ports):
// the interface does not parse the design text.
import type { Resolved, ResolvedPin, ResolvedPort } from "../build/types";
import type { Pull } from "../sim/messages";
import { DEFAULT_BOARD, type Board, type PartDescription, type SettingField } from "./assets";

export interface PinBinding {
  pin: number;
  pull?: Pull;
}

export interface BreadboardPart {
  id: string;
  type: string;
  pins: Record<string, number>;
  settings?: Record<string, unknown>;
  position?: { x: number; y: number };
}

export interface BoardPartChange {
  enabled?: boolean;
  settings?: Record<string, unknown>;
}

export interface DesignConfig {
  files?: string[] | null;
  top?: string | null;
  parameters?: Record<string, number | string>;
  defines?: Record<string, string | true>;
  constraints?: string | null | false;
  visibility?: "all" | "ports";
  [field: string]: unknown;
}

// Fields the interface reads; the rest are kept as is on rewrite (spec section 2.2).
export interface ProjectConfig {
  format: number;
  design?: DesignConfig;
  pins?: Record<string, PinBinding>;
  boardParts?: Record<string, BoardPartChange>;
  parts?: BreadboardPart[];
  [field: string]: unknown;
}

export const CONFIG_FILE = "fpgasim.json";

// Parsing the file text. No file means default settings; text that does not parse gives null.
export function parseConfig(text: string | undefined): ProjectConfig | null {
  if (text === undefined) return { format: 1 };
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
    return value as ProjectConfig;
  } catch {
    return null;
  }
}

// The project board is the board field of fpgasim.json; without the field the default board applies
// (spec section 2.2). The server has the same rule.
export function configBoard(config: ProjectConfig): string {
  return typeof config.board === "string" ? config.board : DEFAULT_BOARD;
}

// The board for the files of a new project. A settings file that does not parse sets no board.
export function filesBoard(files: readonly { path: string; content: string }[]): string {
  const config = parseConfig(files.find((f) => f.path === "fpgasim.json")?.content);
  return config ? configBoard(config) : DEFAULT_BOARD;
}

export function printConfig(config: ProjectConfig): string {
  return `${JSON.stringify(config, null, 2)}\n`;
}

// ---- Binding source (spec sections 2.2 and 2.5) ----

export type BindingSource = { kind: "pins" } | { kind: "cst"; file: string } | { kind: "ambiguous"; files: string[] };

// The same rule as on the server: design.constraints, otherwise the only .cst of the project.
export function bindingSource(config: ProjectConfig | null, paths: readonly string[]): BindingSource {
  const constraints = config?.design?.constraints;
  if (constraints === false) return { kind: "pins" };
  if (typeof constraints === "string") return { kind: "cst", file: constraints };
  const files = paths.filter((path) => path.endsWith(".cst")).sort();
  const [first] = files;
  if (first === undefined) return { kind: "pins" };
  return files.length === 1 ? { kind: "cst", file: first } : { kind: "ambiguous", files };
}

// ---- Binding ----

// A port bit name as declared in the design: bit is the offset from the least significant bit (decision 35).
export function bitName(ports: readonly ResolvedPort[], port: string, bit: number): string {
  const found = ports.find((p) => p.name === port);
  if (!found || found.width === 1) return port;
  return `${port}[${String(found.msb >= found.lsb ? found.lsb + bit : found.lsb - bit)}]`;
}

export interface BindRow {
  name: string; // clk, led[0]
  port: string;
  bit: number; // offset from the least significant bit
  index: number; // bit index as declared in the design
  dir: "in" | "out" | "inout";
  pin: number | null;
  pull: Pull;
}

export type BindCode = "PINS_NO_PORT" | "PINS_NO_PIN" | "PINS_PIN_TWICE" | "PIN_FORBIDDEN" | "CLOCK_EXTRA";

export interface BindProblem {
  code: BindCode;
  severity: "error" | "warning";
  name: string;
  pin: number | null;
}

export interface Binding {
  rows: BindRow[]; // all port bits in design order
  pins: ResolvedPin[]; // bound ones, in server response order
  clock: { port: string; pin: number; hz: number } | null;
  problems: BindProblem[];
}

function portRows(ports: readonly ResolvedPort[]): BindRow[] {
  return ports.flatMap((port) =>
    Array.from({ length: port.width }, (_, bit) => ({
      name: bitName(ports, port.name, bit),
      port: port.name,
      bit,
      index: port.msb >= port.lsb ? port.lsb + bit : port.lsb - bit,
      dir: port.dir,
      pin: null,
      pull: "none",
    })),
  );
}

function finish(board: Board, ports: readonly ResolvedPort[], rows: BindRow[], problems: BindProblem[]): Binding {
  const pins = rows.flatMap((row) =>
    row.pin === null ? [] : [{ port: row.port, bit: row.bit, pin: row.pin, pull: row.pull }],
  );
  // Clock: a one-bit input on the board clock pin; in version 1 there is one clock (spec section 2.5).
  let clock: Binding["clock"] = null;
  for (const row of rows) {
    const source = board.clocks.find((c) => c.pin === row.pin);
    const port = ports.find((p) => p.name === row.port);
    if (!source || row.pin === null || port?.dir !== "in" || port.width !== 1) continue;
    if (clock === null) clock = { port: row.port, pin: row.pin, hz: source.hz };
    else problems.push({ code: "CLOCK_EXTRA", severity: "warning", name: row.name, pin: row.pin });
  }
  return { rows, pins, clock, problems };
}

// A table row by a name from the pins field, as on the server (resolve.py, bind): a whole port name
// or a name with a bit index; a multi-bit port without an index and a bit out of bounds are not found.
function findRow(ports: readonly ResolvedPort[], rows: BindRow[], name: string): BindRow | undefined {
  let port = ports.find((p) => p.name === name);
  let index: number | null = null;
  const match = /^(.+)\[(\d+)\]$/.exec(name);
  if (!port && match?.[1] !== undefined) {
    port = ports.find((p) => p.name === match[1]);
    index = Number(match[2]);
  }
  if (!port) return undefined;
  if (index === null) {
    if (port.width > 1) return undefined;
    index = port.lsb;
  }
  const found = port;
  return rows.find((r) => r.port === found.name && r.index === index);
}

// The binding from the pins field: the same rules and codes as on the server (decision 35). An erroneous entry
// does not go into the binding: the build would not pass with it, and the server names it in messages.
export function bindPins(
  board: Board,
  ports: readonly ResolvedPort[],
  field: Record<string, PinBinding> | undefined,
): Binding {
  const rows = portRows(ports);
  const problems: BindProblem[] = [];
  const taken = new Set<number>();
  for (const [name, raw] of Object.entries(field ?? {})) {
    // An entry of a wrong shape (the file was edited by hand) is skipped: the server will report it.
    const entry = raw as PinBinding | null;
    if (typeof entry?.pin !== "number") continue;
    const info = board.pins[String(entry.pin)];
    if (!info) {
      problems.push({ code: "PINS_NO_PIN", severity: "error", name, pin: entry.pin });
      continue;
    }
    if (taken.has(entry.pin)) {
      problems.push({ code: "PINS_PIN_TWICE", severity: "error", name, pin: entry.pin });
      continue;
    }
    taken.add(entry.pin);
    if (info.status === "forbidden")
      problems.push({ code: "PIN_FORBIDDEN", severity: "warning", name, pin: entry.pin });
    const row = findRow(ports, rows, name);
    if (!row) {
      problems.push({ code: "PINS_NO_PORT", severity: "error", name, pin: entry.pin });
      continue;
    }
    row.pin = entry.pin;
    row.pull = entry.pull === "up" || entry.pull === "down" ? entry.pull : "none";
  }
  return finish(board, ports, rows, problems);
}

// The binding from a .cst file: the server parsed it, the interface takes resolved.pins of the last build.
export function bindResolved(board: Board, resolved: Resolved): Binding {
  const ports = resolved.ports ?? [];
  const rows = portRows(ports);
  const problems: BindProblem[] = [];
  for (const pin of resolved.pins ?? []) {
    const row = rows.find((r) => r.port === pin.port && r.bit === pin.bit);
    if (!row) continue;
    row.pin = pin.pin;
    row.pull = pin.pull;
    if (board.pins[String(pin.pin)]?.status === "forbidden")
      problems.push({ code: "PIN_FORBIDDEN", severity: "warning", name: row.name, pin: pin.pin });
  }
  return finish(board, ports, rows, problems);
}

// Export to .cst (spec section 2.6): an IO_LOC and IO_PORT pair per port bit, ordered by port name
// and bit index. IO_TYPE is the pin standard from the board file, without it the board standard.
export function toCst(board: Board, rows: readonly BindRow[]): string {
  const bound = rows
    .filter((row) => row.pin !== null)
    .sort((a, b) => (a.port === b.port ? a.index - b.index : a.port < b.port ? -1 : 1));
  return bound
    .map(
      (row) =>
        `IO_LOC "${row.name}" ${String(row.pin)};\n` +
        `IO_PORT "${row.name}" IO_TYPE=${board.pins[String(row.pin)]?.standard ?? board.io.standard} ` +
        `PULL_MODE=${row.pull.toUpperCase()};\n`,
    )
    .join("");
}

// The file name for export: <top module>.cst, and if taken, with a number.
export function cstFileName(top: string | undefined, paths: readonly string[]): string {
  const base = top && /^[A-Za-z0-9_]+$/.test(top) ? top : "pins";
  let name = `${base}.cst`;
  for (let n = 2; paths.includes(name); n += 1) name = `${base}_${String(n)}.cst`;
  return name;
}

// ---- Parts ----

export interface PartItem {
  id: string;
  type: string;
  label: string;
  pins: Record<string, number>;
  settings: Record<string, unknown>; // without defaults from the part description
  origin: "board" | "breadboard";
  enabled: boolean;
  position: { x: number; y: number } | null; // breadboard cell
}

export const BREADBOARD_COLUMNS = 2;

// The first free cell of the breadboard field, by rows left to right.
export function freeCell(parts: readonly BreadboardPart[]): { x: number; y: number } {
  const taken = new Set(parts.map((p) => (p.position ? `${String(p.position.x)}:${String(p.position.y)}` : "")));
  for (let i = 0; ; i += 1) {
    const cell = { x: i % BREADBOARD_COLUMNS, y: Math.floor(i / BREADBOARD_COLUMNS) };
    if (!taken.has(`${String(cell.x)}:${String(cell.y)}`)) return cell;
  }
}

// A cell within the field: a field with a million rows from a hand-edited file is not drawn.
const MAX_CELL = { x: 7, y: 63 };

function validCell(cell: unknown): cell is { x: number; y: number } {
  const c = cell as { x?: unknown; y?: unknown } | null | undefined;
  const inside = (v: unknown, max: number): boolean =>
    typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max;
  return inside(c?.x, MAX_CELL.x) && inside(c?.y, MAX_CELL.y);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// Breadboard parts from the file. An entry of a wrong shape (the file was hand-edited and left unfinished) is skipped:
// the server will report it with the CONFIG_INVALID message.
export function breadboardParts(config: ProjectConfig | null): BreadboardPart[] {
  const list: unknown[] = Array.isArray(config?.parts) ? config.parts : [];
  return list.flatMap((raw) => {
    if (!isRecord(raw) || typeof raw.id !== "string" || typeof raw.type !== "string" || !isRecord(raw.pins)) return [];
    if (!Object.values(raw.pins).every((pin) => typeof pin === "number")) return [];
    const { settings, ...rest } = raw as unknown as BreadboardPart & { settings?: unknown };
    return [isRecord(settings) ? { ...rest, settings } : rest];
  });
}

// Built-in board parts with changes from boardParts, followed by breadboard parts. A breadboard part
// without a cell or in an occupied cell gets the first free one.
export function projectParts(board: Board, config: ProjectConfig | null): PartItem[] {
  const items: PartItem[] = board.parts.map((part) => {
    const entry: unknown = isRecord(config?.boardParts) ? config.boardParts[part.id] : undefined;
    const change: BoardPartChange | undefined = isRecord(entry) ? entry : undefined;
    return {
      id: part.id,
      type: part.type,
      label: part.label,
      pins: part.pins,
      settings: { ...part.settings, ...(isRecord(change?.settings) ? change.settings : {}) },
      origin: "board",
      enabled: change?.enabled !== false,
      position: null,
    };
  });
  const placed: BreadboardPart[] = [];
  const ids = new Set(items.map((item) => item.id));
  for (const part of breadboardParts(config)) {
    // A part with a name that is already taken does not go to the core: names in configure are unique.
    if (ids.has(part.id)) continue;
    ids.add(part.id);
    const wanted = validCell(part.position) ? part.position : undefined;
    const clash = wanted && placed.some((p) => p.position?.x === wanted.x && p.position.y === wanted.y);
    const position = wanted && !clash ? wanted : freeCell(placed);
    placed.push({ ...part, position });
    items.push({
      id: part.id,
      type: part.type,
      label: part.id,
      pins: part.pins,
      settings: part.settings ?? {},
      origin: "breadboard",
      enabled: true,
      position,
    });
  }
  return items;
}

export function withDefaults(
  desc: PartDescription | undefined,
  settings: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  for (const [name, field] of Object.entries(desc?.settings ?? {})) {
    if (field) merged[name] = field.default;
  }
  return { ...merged, ...settings };
}

// The name of a new part: the type and the first free number (led1, led2 …).
export function nextPartId(type: string, taken: readonly string[]): string {
  for (let n = 1; ; n += 1) {
    const id = `${type}${String(n)}`;
    if (!taken.includes(id)) return id;
  }
}

export type IdProblem = "empty" | "bad" | "exists";

export function partIdProblem(id: string, taken: readonly string[]): IdProblem | null {
  if (id === "") return "empty";
  if (!/^[A-Za-z0-9_]+$/.test(id)) return "bad";
  return taken.includes(id) ? "exists" : null;
}

export type SettingProblem = "type" | "enum" | "minimum" | "maximum" | "maxLength";

// Checking a setting value by the part description: the same as the core will check (SETTINGS_INVALID).
export function settingProblem(field: SettingField, value: unknown): SettingProblem | null {
  if (field.type === "boolean") return typeof value === "boolean" ? null : "type";
  if (field.type === "string") {
    if (typeof value !== "string") return "type";
    if (field.enum && !field.enum.includes(value)) return "enum";
    return field.maxLength !== undefined && value.length > field.maxLength ? "maxLength" : null;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) return "type";
  if (field.type === "integer" && !Number.isInteger(value)) return "type";
  if (field.enum && !field.enum.includes(value)) return "enum";
  if (field.minimum !== undefined && value < field.minimum) return "minimum";
  return field.maximum !== undefined && value > field.maximum ? "maximum" : null;
}

// A setting value from a form field: the text of an input or the chosen list item. A number in an
// input is written with a dot or a comma; empty and unreadable text give NaN (the check fails).
export function settingFromText(field: SettingField, text: string): unknown {
  if (field.type === "string") return text;
  if (field.type === "boolean") return text === "true";
  const clean = text.trim().replace(",", ".");
  return /^-?(\d+\.?\d*|\.\d+)$/.test(clean) ? Number(clean) : Number.NaN;
}

// A setting value in the form: a numeric input keeps text in the form state, otherwise
// unfinished input ("0.") would turn into a different number.
export function settingValue(field: SettingField, held: unknown): unknown {
  return field.type !== "string" && typeof held === "string" ? settingFromText(field, held) : held;
}

// ---- Project settings dialog: "name = value" pairs by lines ----

// Top module parameters: a number stays a number, the rest is a string; a number in quotes is a string.
export function parsePairs(
  text: string,
  kind: "parameters" | "defines",
): Record<string, number | string | true> | null {
  const out: Record<string, number | string | true> = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "") continue;
    const match = /^([A-Za-z_][A-Za-z0-9_$]*)\s*(?:=\s*(.*))?$/.exec(line);
    if (!match?.[1]) return null;
    const value = match[2]?.trim() ?? "";
    const quoted = /^"(.*)"$/.exec(value);
    if (kind === "defines") out[match[1]] = value === "" ? true : value;
    else if (value === "") return null;
    else if (quoted?.[1] !== undefined) out[match[1]] = quoted[1];
    else out[match[1]] = /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : value;
  }
  return out;
}

export function printPairs(
  pairs: Record<string, number | string | true> | undefined,
  kind: "parameters" | "defines",
): string {
  return Object.entries(pairs ?? {})
    .map(([name, value]) => {
      if (value === true) return name;
      // A string that looks like a number is written in quotes: otherwise on write it would become a number,
      // and the server passes number and string parameters differently. A macro is always a string.
      const numeric = kind === "parameters" && typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value);
      return `${name} = ${numeric ? `"${value}"` : String(value)}`;
    })
    .join("\n");
}
