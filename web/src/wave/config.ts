// Watch and record in fpgasim.json (spec sections 2.2 and 2.4): reading the watch and record fields
// with defaults and editing those fields. Entries of a wrong shape are skipped on read (decision 73).
import type { ProjectConfig } from "../project/config";
import { isRadix, type Radix } from "./format";

export interface WatchItem {
  signal: string;
  radix: Radix;
}

export type RecordMode = "ring" | "window";
export type RecordEdge = "rise" | "fall" | "change";

export interface RecordTrigger {
  signal: string;
  edge: RecordEdge;
}

export interface RecordSettings {
  signals: string[];
  mode: RecordMode;
  depth: number;
  windowPs: number;
  trigger: RecordTrigger | null;
}

export const WATCH_RADIX: Radix = "dec"; // radix of a watch when the radix field is not set
export const MAX_RECORD_SIGNALS = 64;
export const MAX_DEPTH = 2_000_000;
export const DEFAULT_RECORD: RecordSettings = {
  signals: [],
  mode: "ring",
  depth: 200_000,
  windowPs: 100_000_000_000,
  trigger: null,
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isName = (value: unknown): value is string => typeof value === "string" && value !== "";

export function watchItems(config: ProjectConfig | null): WatchItem[] {
  const list: unknown = config?.watch;
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const items: WatchItem[] = [];
  for (const raw of list as unknown[]) {
    if (!isObject(raw) || !isName(raw.signal) || seen.has(raw.signal)) continue;
    seen.add(raw.signal);
    items.push({ signal: raw.signal, radix: isRadix(raw.radix) ? raw.radix : WATCH_RADIX });
  }
  return items;
}

export function recordSettings(config: ProjectConfig | null): RecordSettings {
  const raw: unknown = config?.record;
  if (!isObject(raw)) return DEFAULT_RECORD;
  const signals = Array.isArray(raw.signals) ? [...new Set((raw.signals as unknown[]).filter(isName))] : [];
  const depth = raw.depth;
  const windowPs = raw.windowPs;
  const trigger = raw.trigger;
  const edge = isObject(trigger) ? trigger.edge : undefined;
  return {
    signals: signals.slice(0, MAX_RECORD_SIGNALS),
    mode: raw.mode === "window" ? "window" : "ring",
    depth:
      typeof depth === "number" && Number.isInteger(depth) && depth >= 1 && depth <= MAX_DEPTH
        ? depth
        : DEFAULT_RECORD.depth,
    windowPs:
      typeof windowPs === "number" && Number.isInteger(windowPs) && windowPs >= 1 ? windowPs : DEFAULT_RECORD.windowPs,
    trigger:
      isObject(trigger) && isName(trigger.signal) && (edge === "rise" || edge === "fall" || edge === "change")
        ? { signal: trigger.signal, edge }
        : null,
  };
}

// Editing the watch list: entries of a wrong shape from the file are not erased; the server reports them.
export function changeWatch(config: ProjectConfig, change: (items: WatchItem[]) => WatchItem[]): void {
  const raw: unknown[] = Array.isArray(config.watch) ? (config.watch as unknown[]) : [];
  const bad = raw.filter((item) => !isObject(item) || !isName(item.signal));
  const next = change(watchItems(config)).map((item) =>
    item.radix === WATCH_RADIX ? { signal: item.signal } : { signal: item.signal, radix: item.radix },
  );
  config.watch = [...next, ...bad];
}

// Editing record settings: fields the interface does not know are kept.
export function changeRecord(config: ProjectConfig, patch: Partial<RecordSettings>): void {
  const raw = isObject(config.record) ? config.record : {};
  config.record = { ...raw, ...recordSettings(config), ...patch };
}

// The start condition for a multi-bit signal is only change (spec section 2.4).
export const triggerEdges = (width: number): RecordEdge[] => (width > 1 ? ["change"] : ["rise", "fall", "change"]);
