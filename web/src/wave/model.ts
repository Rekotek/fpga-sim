// In-memory waveform model (spec section 9.6): a signal list and sorted changes.
// Both sources are reduced to it: a core record (TRACE messages) and a VCD file.
//
// Time is stored as a number of picoseconds (Float64Array): it is exact up to 2^53 ps, which is 2.5 hours of
// simulation time. This way drawing and time search work without bigint (decision 83).
import type { Trace } from "../sim/protocol";
import { wordsToBigInt } from "./format";

export interface WaveSignal {
  name: string; // signal path or pin:N
  width: number;
  words: number; // 32-bit words per value
  times: Float64Array; // times[0] is the span start, then change times in ascending order
  values: Uint32Array; // `words` words per times entry, least significant word first
}

export interface WaveModel {
  source: "record" | "vcd";
  fromPs: number;
  toPs: number;
  signals: WaveSignal[];
}

export interface TraceInfo {
  index: number;
  name: string;
  width: number;
}

export const wordsFor = (width: number): number => Math.max(1, Math.ceil(width / 32));

// The number of signal changes, not counting the value at the span start.
export const signalChanges = (signal: WaveSignal): number => signal.times.length - 1;

export const modelChanges = (model: WaveModel): number =>
  model.signals.reduce((sum, signal) => sum + signalChanges(signal), 0);

export const valueAt = (signal: WaveSignal, index: number): bigint =>
  wordsToBigInt(signal.values, index * signal.words, signal.words);

// Index of the last entry with a time not later than t; 0 if t is before the span start.
export function indexAt(signal: WaveSignal, t: number): number {
  const times = signal.times;
  let low = 0;
  let high = times.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if ((times[middle] ?? 0) <= t) low = middle;
    else high = middle - 1;
  }
  return low;
}

// Accumulator of one signal: arrays grow as the source is read.
export class SignalBuilder {
  private readonly times: number[] = [];
  private readonly values: number[] = [];
  readonly words: number;

  constructor(
    readonly name: string,
    readonly width: number,
  ) {
    this.words = wordsFor(width);
  }

  get length(): number {
    return this.times.length;
  }

  add(time: number, words: ArrayLike<number>): void {
    this.times.push(time);
    for (let k = 0; k < this.words; k += 1) this.values.push((words[k] ?? 0) >>> 0);
  }

  // Whether the value equals the last recorded one.
  sameAsLast(words: ArrayLike<number>): boolean {
    const at = this.values.length - this.words;
    if (at < 0) return false;
    for (let k = 0; k < this.words; k += 1) if (this.values[at + k] !== (words[k] ?? 0) >>> 0) return false;
    return true;
  }

  build(name = this.name): WaveSignal {
    return {
      name,
      width: this.width,
      words: this.words,
      times: Float64Array.from(this.times),
      values: Uint32Array.from(this.values),
    };
  }
}

// A core record: the recordFetch response (info field) and TRACE messages in order. Each message
// starts with the values of all signals at its start (decision 25): in the first it is the span start,
// in the following ones they repeat what is known and are skipped.
export function modelFromTraces(info: readonly TraceInfo[], traces: readonly Trace[]): WaveModel {
  const builders = info.map((item) => new SignalBuilder(item.name, item.width));
  traces.forEach((trace, n) => {
    trace.changes.forEach((change, i) => {
      if (n > 0 && i < builders.length) return;
      builders[change.index]?.add(Number(change.timePs), change.words);
    });
  });
  const fromPs = Number(traces[0]?.fromPs ?? 0n);
  const toPs = Number(traces[traces.length - 1]?.toPs ?? 0n);
  for (const builder of builders) if (builder.length === 0) builder.add(fromPs, [0]);
  return { source: "record", fromPs, toPs, signals: builders.map((b) => b.build()) };
}
