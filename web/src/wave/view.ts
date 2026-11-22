// Waveform view window and Canvas drawing (spec section 9.6): one-bit signals as
// a line, buses as hexagons with a value, frequent toggling as a filled span.
import { formatValue, type Radix } from "./format";
import { indexAt, valueAt, type WaveModel, type WaveSignal } from "./model";

export interface WaveView {
  fromPs: number;
  toPs: number;
}

export const ROW_HEIGHT = 26;
export const AXIS_HEIGHT = 22;
const MIN_SPAN_PS = 100;

// Bounds the window does not leave: the model span with 5% margins.
function limits(model: WaveModel): WaveView {
  const span = Math.max(model.toPs - model.fromPs, MIN_SPAN_PS);
  return { fromPs: model.fromPs - span * 0.05, toPs: model.toPs + span * 0.05 };
}

export function fitView(model: WaveModel): WaveView {
  return limits(model);
}

function clampView(view: WaveView, model: WaveModel): WaveView {
  const bounds = limits(model);
  const span = Math.min(Math.max(view.toPs - view.fromPs, MIN_SPAN_PS), bounds.toPs - bounds.fromPs);
  const fromPs = Math.min(Math.max(view.fromPs, bounds.fromPs), bounds.toPs - span);
  return { fromPs, toPs: fromPs + span };
}

// Zoom: factor < 1 zooms in. The moment anchorPs stays at its place on the screen.
export function zoomView(view: WaveView, factor: number, anchorPs: number, model: WaveModel): WaveView {
  const fromPs = anchorPs - (anchorPs - view.fromPs) * factor;
  const toPs = anchorPs + (view.toPs - anchorPs) * factor;
  return clampView({ fromPs, toPs }, model);
}

export function panView(view: WaveView, deltaPs: number, model: WaveModel): WaveView {
  return clampView({ fromPs: view.fromPs + deltaPs, toPs: view.toPs + deltaPs }, model);
}

export const timeAtX = (view: WaveView, x: number, width: number): number =>
  view.fromPs + ((view.toPs - view.fromPs) * x) / Math.max(1, width);

export const xAtTime = (view: WaveView, t: number, width: number): number =>
  ((t - view.fromPs) * width) / (view.toPs - view.fromPs);

// Axis tick step: 1, 2 or 5 per power of ten, not more often than one division per minPx pixels.
export function tickStep(view: WaveView, width: number, minPx = 90): number {
  const raw = ((view.toPs - view.fromPs) * minPx) / Math.max(1, width);
  const power = 10 ** Math.floor(Math.log10(Math.max(raw, 1)));
  for (const k of [1, 2, 5]) if (k * power >= raw) return k * power;
  return 10 * power;
}

// A row span to draw: a constant value, or frequent toggling (dense).
export interface Segment {
  x0: number;
  x1: number;
  index: number; // signal entry index; for a dense span, the first of the merged ones
  dense: boolean;
}

// Splits the visible part of a signal into spans. Changes less than a pixel apart merge
// into a filled span: the number of spans does not exceed twice the width in pixels.
export function segments(signal: WaveSignal, view: WaveView, toPs: number, width: number): Segment[] {
  const out: Segment[] = [];
  const count = signal.times.length;
  const end = Math.min(view.toPs, toPs);
  let t = Math.max(view.fromPs, signal.times[0] ?? 0);
  let i = indexAt(signal, t);
  while (t < end) {
    const next = signal.times[i + 1] ?? Infinity;
    const stop = Math.min(next, end);
    const x0 = xAtTime(view, t, width);
    const x1 = xAtTime(view, stop, width);
    if (x1 - x0 >= 1 || next >= end) {
      out.push({ x0, x1, index: i, dense: false });
      i += 1;
      t = stop;
      continue;
    }
    // All changes within the nearest two pixels make one filled span.
    const last = Math.min(indexAt(signal, Math.min(timeAtX(view, x0 + 2, width), end)), count - 1);
    const until = signal.times[last] ?? stop;
    out.push({ x0, x1: xAtTime(view, until, width), index: i, dense: true });
    i = last;
    t = until;
  }
  return out;
}

export interface WaveColors {
  line: string;
  bus: string;
  dense: string;
  text: string;
  grid: string;
  axis: string;
  cursorA: string;
  cursorB: string;
}

export interface WaveRow {
  signal: WaveSignal | null; // null: the signal is not in the record
  radix: Radix;
}

export interface DrawOptions {
  model: WaveModel | null;
  rows: readonly WaveRow[];
  view: WaveView;
  width: number;
  height: number;
  cursorA: number | null;
  cursorB: number | null;
  colors: WaveColors;
  formatTime: (ps: number) => string;
}

function drawBit(ctx: CanvasRenderingContext2D, signal: WaveSignal, parts: Segment[], top: number): void {
  const high = top + 5;
  const low = top + ROW_HEIGHT - 5;
  ctx.beginPath();
  let previous: number | null = null;
  for (const part of parts) {
    if (part.dense) {
      ctx.rect(part.x0, high, Math.max(1, part.x1 - part.x0), low - high);
      previous = null;
      continue;
    }
    const y = (signal.values[part.index * signal.words] ?? 0) & 1 ? high : low;
    if (previous !== null && previous !== y) {
      ctx.moveTo(part.x0, previous);
      ctx.lineTo(part.x0, y);
    }
    ctx.moveTo(part.x0, y);
    ctx.lineTo(part.x1, y);
    previous = y;
  }
  ctx.stroke();
}

function drawBus(
  ctx: CanvasRenderingContext2D,
  signal: WaveSignal,
  parts: Segment[],
  top: number,
  radix: Radix,
  colors: WaveColors,
): void {
  const high = top + 5;
  const low = top + ROW_HEIGHT - 5;
  const middle = (high + low) / 2;
  ctx.beginPath();
  for (const part of parts) {
    if (part.dense) {
      ctx.rect(part.x0, high, Math.max(1, part.x1 - part.x0), low - high);
      continue;
    }
    // Hexagon: beveled edges at the value joints.
    const slant = Math.min(3, (part.x1 - part.x0) / 2);
    ctx.moveTo(part.x0, middle);
    ctx.lineTo(part.x0 + slant, high);
    ctx.lineTo(part.x1 - slant, high);
    ctx.lineTo(part.x1, middle);
    ctx.lineTo(part.x1 - slant, low);
    ctx.lineTo(part.x0 + slant, low);
    ctx.closePath();
  }
  ctx.stroke();
  ctx.fillStyle = colors.text;
  for (const part of parts) {
    const room = part.x1 - part.x0 - 8;
    if (part.dense || room < 8) continue;
    let text = formatValue(valueAt(signal, part.index), signal.width, radix);
    if (ctx.measureText(text).width > room) {
      // The value does not fit: the start is shown with an ellipsis if there is room for at least one character.
      const fit = Math.floor(room / Math.max(1, ctx.measureText("0").width)) - 1;
      if (fit < 1) continue;
      text = `${text.slice(0, fit)}…`;
    }
    ctx.fillText(text, Math.max(part.x0, 0) + 4, middle);
  }
}

export function drawWave(ctx: CanvasRenderingContext2D, options: DrawOptions): void {
  const { model, rows, view, width, height, colors } = options;
  ctx.clearRect(0, 0, width, height);
  ctx.font = "12px ui-monospace, monospace";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 1;
  if (!model) return;

  // Time axis and grid.
  const step = tickStep(view, width);
  ctx.strokeStyle = colors.grid;
  ctx.fillStyle = colors.axis;
  ctx.beginPath();
  for (let tick = Math.ceil(view.fromPs / step) * step; tick <= view.toPs; tick += step) {
    const x = Math.round(xAtTime(view, tick, width)) + 0.5;
    ctx.moveTo(x, AXIS_HEIGHT - 5);
    ctx.lineTo(x, height);
    ctx.fillText(options.formatTime(tick), x + 3, AXIS_HEIGHT / 2);
  }
  ctx.stroke();

  rows.forEach((row, n) => {
    const signal = row.signal;
    if (!signal) return;
    const top = AXIS_HEIGHT + n * ROW_HEIGHT;
    const parts = segments(signal, view, model.toPs, width);
    ctx.strokeStyle = signal.width === 1 ? colors.line : colors.bus;
    ctx.fillStyle = colors.dense;
    if (signal.width === 1) drawBit(ctx, signal, parts, top);
    else drawBus(ctx, signal, parts, top, row.radix, colors);
    // Filled spans of frequent toggling.
    ctx.fillStyle = colors.dense;
    for (const part of parts) {
      if (part.dense) ctx.fillRect(part.x0, top + 5, Math.max(1, part.x1 - part.x0), ROW_HEIGHT - 10);
    }
  });

  const cursor = (at: number | null, color: string, dash: number[]): void => {
    if (at === null || at < view.fromPs || at > view.toPs) return;
    const x = Math.round(xAtTime(view, at, width)) + 0.5;
    ctx.strokeStyle = color;
    ctx.setLineDash(dash);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
    ctx.setLineDash([]);
  };
  cursor(options.cursorA, colors.cursorA, []);
  cursor(options.cursorB, colors.cursorB, [4, 3]);
}
