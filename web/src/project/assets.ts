// Repository data included in static files (spec section 10.1): board files, the message table, examples.
import tangNano20k from "../../../boards/tang-nano-20k.json";
import tangNano9k from "../../../boards/tang-nano-9k.json";
import diagnosticsTable from "../../../spec/diagnostics.json";
import type { ProjectFile } from "../build/types";

export interface BoardPart {
  id: string;
  type: string;
  label: string;
  pins: Record<string, number>;
  settings?: Record<string, unknown>;
  geometry: { x: number; y: number };
}

// Text by language, like $defs/text in spec/part.schema.json: ru is required (decision 168).
export type LocalizedText = Record<string, string>;

export interface BoardPin {
  name: string;
  status: string; // clock, onboard, free, header, forbidden (spec section 3.1)
  standard?: string; // pin standard, if it differs from the board standard
  note?: LocalizedText;
}

export interface BoardHeader {
  id: string;
  contacts: { pin?: number; power?: string }[];
}

export interface BoardDevice {
  id: string;
  label: LocalizedText;
  pins: number[];
  since: number | null; // version in which the model appears; null means there will be no model
}

export interface BoardGeometry {
  width: number; // mm
  height: number;
  usb: { x: number; y: number };
  chip: { x: number; y: number; size: number };
  headerPitch: number;
  headerLeftX: number;
  headerRightX: number;
  headerFirstY: number;
}

// Fields of the board file that the interface reads (format: spec section 3).
export interface Board {
  id: string;
  name: string;
  fpga?: { ideName?: string };
  io: { standard: string };
  clocks: { id: string; pin: number; hz: number; label?: string }[];
  pins: Record<string, BoardPin>;
  headers: BoardHeader[];
  parts: BoardPart[];
  devices: BoardDevice[];
  geometry: BoardGeometry;
}

// The order is the order in the board choice list; the first board applies when the board field is not set.
const boards = new Map<string, Board>([
  [tangNano20k.id, tangNano20k],
  [tangNano9k.id, tangNano9k],
]);
export const DEFAULT_BOARD = tangNano20k.id;

export function listBoards(): Board[] {
  return [...boards.values()];
}

export function boardById(id: string): Board | undefined {
  return boards.get(id);
}

export type DiagnosticLevel = "important" | "note" | "hidden";

export interface DiagnosticEntry {
  level: DiagnosticLevel;
  text?: Record<string, string>;
  explain?: Record<string, string>;
}

const codes = diagnosticsTable.codes as Record<string, DiagnosticEntry | undefined>;

export function diagnosticCodes(): string[] {
  return Object.keys(codes);
}

export function diagnosticEntry(code: string): DiagnosticEntry | undefined {
  return codes[code];
}

// Part descriptions parts/<type>/part.json (spec section 5.7, schema spec/part.schema.json).
export interface SettingField {
  type: "integer" | "number" | "string" | "boolean";
  enum?: (number | string)[];
  minimum?: number;
  maximum?: number;
  maxLength?: number;
  default: number | string | boolean;
  label: Record<string, string>;
}

export interface PartDescription {
  type: string;
  name: Record<string, string>;
  pins: { role: string; dir: string; label: Record<string, string> }[];
  settings: Record<string, SettingField | undefined>;
}

// The shape of descriptions is set here and not derived from JSON: the enum field has different shapes in different settings.
const partSources: Record<string, unknown> = import.meta.glob("../../../parts/*/part.json", {
  import: "default",
  eager: true,
});
const partDescriptions = new Map((Object.values(partSources) as PartDescription[]).map((d) => [d.type, d]));

export function partDescription(type: string): PartDescription | undefined {
  return partDescriptions.get(type);
}

export function partTypes(): string[] {
  return [...partDescriptions.keys()].sort();
}

// Examples: examples/<name>/<files> and the author's lessons examples/lessons/<name>/<files> (spec section 2.7).
// The expect.json file holds test expectations; it does not go into the project.
const exampleSources = import.meta.glob<string>("../../../examples/*/**", {
  query: "?raw",
  import: "default",
  eager: true,
});

export interface Example {
  name: string;
  lesson: boolean;
  files: ProjectFile[];
}

// Lessons first by number order, then the repository examples.
export function listExamples(): Example[] {
  const byName = new Map<string, Example>();
  for (const [key, content] of Object.entries(exampleSources)) {
    const match = /\/examples\/(lessons\/)?([^/]+)\/(.+)$/.exec(key);
    if (!match?.[2] || !match[3] || match[3] === "expect.json") continue;
    const example = byName.get(match[2]) ?? { name: match[2], lesson: match[1] !== undefined, files: [] };
    example.files.push({ path: match[3], content });
    byName.set(match[2], example);
  }
  return [...byName.values()]
    .map((e) => ({ ...e, files: e.files.sort((x, y) => x.path.localeCompare(y.path)) }))
    .sort((x, y) => Number(y.lesson) - Number(x.lesson) || x.name.localeCompare(y.name));
}
