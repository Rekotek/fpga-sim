// Waveform of the current project outside React state: the model, the view window and cursors.
// The panel reads the object on every screen frame and redraws the Canvas when version grows.
import type { Radix } from "./format";
import type { WaveModel } from "./model";
import { fitView, type WaveView } from "./view";

export const WAVE_RADIX: Radix = "hex"; // default radix of a waveform row

export interface WaveSession {
  model: WaveModel | null;
  record: number | null; // core record number the model came from
  view: WaveView;
  fit: boolean; // the window follows the model span until it is moved by hand
  cursorA: number | null; // ps
  cursorB: number | null;
  radix: Map<string, Radix>;
  version: number;
}

export const waves: WaveSession = {
  model: null,
  record: null,
  view: { fromPs: 0, toPs: 1000 },
  fit: true,
  cursorA: null,
  cursorB: null,
  radix: new Map(),
  version: 0,
};

export function touchWaves(): void {
  waves.version += 1;
}

export function setWaveModel(model: WaveModel | null, record: number | null): void {
  waves.model = model;
  waves.record = record;
  if (model && waves.fit) waves.view = fitView(model);
  touchWaves();
}

export function clearWaves(): void {
  waves.model = null;
  waves.record = null;
  waves.fit = true;
  waves.cursorA = null;
  waves.cursorB = null;
  waves.radix.clear();
  touchWaves();
}

export function showAll(): void {
  waves.fit = true;
  if (waves.model) waves.view = fitView(waves.model);
  touchWaves();
}

export function setView(view: WaveView): void {
  waves.view = view;
  waves.fit = false;
  touchWaves();
}
