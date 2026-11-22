// Binary protocol messages (spec section 4.6): header, FRAME, TRACE, PART_DATA.
// Encoding and parsing are checked against the reference files spec/protocol/vectors/ (protocol.test.ts).

export const PROTOCOL = 1;
export const HEADER_BYTES = 24;
const MAGIC = 0x5346;

export const KIND_FRAME = 1;
export const KIND_TRACE = 2;
export const KIND_PART_DATA = 3;

// Net flags in FRAME.
export const NET_DRIVEN_BY_FPGA = 1;
export const NET_DRIVEN_BY_PART = 2;
export const NET_CONFLICT = 4;
export const NET_FLOATING = 8;

export interface Header {
  protocol: number;
  kind: number;
  seq: number;
  timePs: bigint;
  length: number;
}

export interface FrameNet {
  level: number;
  flags: number;
  toggles: number; // toggles per batch
  duty: number; // share of time at one per batch
}

export interface FrameWatch {
  sig: number;
  width: number;
  words: number[]; // least significant word first
}

export interface FramePart {
  index: number; // part index in configure order
  state: Uint8Array;
}

export interface Frame {
  spanPs: bigint; // simulation time per batch
  cycle: bigint;
  realUs: number;
  ratio: number;
  nets: FrameNet[];
  watch: FrameWatch[];
  parts: FramePart[];
}

export interface TraceChange {
  timePs: bigint;
  index: number; // signal index in the info list
  words: number[];
}

export interface Trace {
  record: number;
  fromPs: bigint;
  toPs: bigint;
  changes: TraceChange[];
}

export interface PartData {
  part: number;
  channel: number;
  bytes: Uint8Array;
}

export type Message =
  | { kind: typeof KIND_FRAME; header: Header; frame: Frame }
  | { kind: typeof KIND_TRACE; header: Header; trace: Trace }
  | { kind: typeof KIND_PART_DATA; header: Header; partData: PartData };

const view = (bytes: Uint8Array): DataView => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const pad4 = (n: number): number => (n + 3) & ~3;

// The header; null if this is not a protocol message or it is truncated.
export function decodeHeader(bytes: Uint8Array): Header | null {
  if (bytes.length < HEADER_BYTES) return null;
  const v = view(bytes);
  if (v.getUint16(0, true) !== MAGIC) return null;
  const header = {
    protocol: v.getUint8(2),
    kind: v.getUint8(3),
    seq: v.getUint32(4, true),
    timePs: v.getBigUint64(8, true),
    length: v.getUint32(16, true),
  };
  return bytes.length >= HEADER_BYTES + header.length ? header : null;
}

export function decodeFrame(bytes: Uint8Array): Frame {
  const v = view(bytes);
  let at = HEADER_BYTES;
  const frame: Frame = {
    spanPs: v.getBigUint64(at, true),
    cycle: v.getBigUint64(at + 8, true),
    realUs: v.getUint32(at + 16, true),
    ratio: v.getFloat32(at + 20, true),
    nets: [],
    watch: [],
    parts: [],
  };
  const netCount = v.getUint16(at + 24, true);
  const watchCount = v.getUint16(at + 26, true);
  const partCount = v.getUint16(at + 28, true);
  at += 32;
  for (let i = 0; i < netCount; i += 1, at += 12) {
    frame.nets.push({
      level: v.getUint8(at),
      flags: v.getUint8(at + 1),
      toggles: v.getUint32(at + 4, true),
      duty: v.getFloat32(at + 8, true),
    });
  }
  for (let i = 0; i < watchCount; i += 1) {
    const count = v.getUint16(at + 6, true);
    const words: number[] = [];
    for (let k = 0; k < count; k += 1) words.push(v.getUint32(at + 8 + 4 * k, true));
    frame.watch.push({ sig: v.getUint32(at, true), width: v.getUint16(at + 4, true), words });
    at += 8 + 4 * count;
  }
  for (let i = 0; i < partCount; i += 1) {
    const length = v.getUint16(at + 2, true);
    frame.parts.push({ index: v.getUint16(at, true), state: bytes.slice(at + 4, at + 4 + length) });
    at += 4 + pad4(length);
  }
  return frame;
}

export function decodeTrace(bytes: Uint8Array): Trace {
  const v = view(bytes);
  let at = HEADER_BYTES;
  const trace: Trace = {
    record: v.getUint32(at, true),
    fromPs: v.getBigUint64(at + 8, true),
    toPs: v.getBigUint64(at + 16, true),
    changes: [],
  };
  const count = v.getUint32(at + 4, true);
  at += 24;
  for (let i = 0; i < count; i += 1) {
    const wordCount = v.getUint16(at + 10, true);
    const words: number[] = [];
    for (let k = 0; k < wordCount; k += 1) words.push(v.getUint32(at + 12 + 4 * k, true));
    trace.changes.push({ timePs: v.getBigUint64(at, true), index: v.getUint16(at + 8, true), words });
    at += 12 + 4 * wordCount;
  }
  return trace;
}

export function decodePartData(bytes: Uint8Array): PartData {
  const v = view(bytes);
  const at = HEADER_BYTES;
  const length = v.getUint32(at + 4, true);
  return {
    part: v.getUint16(at, true),
    channel: v.getUint16(at + 2, true),
    bytes: bytes.slice(at + 8, at + 8 + length),
  };
}

// Parsing a message of any kind; null for foreign bytes and an unknown kind (section 4.7: skipped).
export function decodeMessage(bytes: Uint8Array): Message | null {
  const header = decodeHeader(bytes);
  if (!header) return null;
  if (header.kind === KIND_FRAME) return { kind: KIND_FRAME, header, frame: decodeFrame(bytes) };
  if (header.kind === KIND_TRACE) return { kind: KIND_TRACE, header, trace: decodeTrace(bytes) };
  if (header.kind === KIND_PART_DATA) return { kind: KIND_PART_DATA, header, partData: decodePartData(bytes) };
  return null;
}

// A big-endian write into a growing buffer.
class Writer {
  private buffer = new Uint8Array(256);
  private data = new DataView(this.buffer.buffer);
  length = 0;

  private reserve(n: number): number {
    const at = this.length;
    if (at + n > this.buffer.length) {
      const next = new Uint8Array(Math.max(this.buffer.length * 2, at + n));
      next.set(this.buffer);
      this.buffer = next;
      this.data = new DataView(next.buffer);
    }
    this.length = at + n;
    return at;
  }
  u8(v: number): void {
    this.data.setUint8(this.reserve(1), v);
  }
  u16(v: number): void {
    this.data.setUint16(this.reserve(2), v, true);
  }
  u32(v: number): void {
    this.data.setUint32(this.reserve(4), v, true);
  }
  u64(v: bigint): void {
    this.data.setBigUint64(this.reserve(8), v, true);
  }
  f32(v: number): void {
    this.data.setFloat32(this.reserve(4), v, true);
  }
  raw(bytes: Uint8Array): void {
    this.buffer.set(bytes, this.reserve(bytes.length));
  }
  pad4(): void {
    this.reserve(pad4(this.length) - this.length);
  }
  bytes(): Uint8Array {
    return this.buffer.slice(0, this.length);
  }
}

function withHeader(kind: number, seq: number, timePs: bigint, body: Writer): Uint8Array {
  const w = new Writer();
  w.u16(MAGIC);
  w.u8(PROTOCOL);
  w.u8(kind);
  w.u32(seq);
  w.u64(timePs);
  w.u32(body.length);
  w.u32(0);
  w.raw(body.bytes());
  return w.bytes();
}

export function encodeFrame(seq: number, timePs: bigint, frame: Frame): Uint8Array {
  const w = new Writer();
  w.u64(frame.spanPs);
  w.u64(frame.cycle);
  w.u32(frame.realUs);
  w.f32(frame.ratio);
  w.u16(frame.nets.length);
  w.u16(frame.watch.length);
  w.u16(frame.parts.length);
  w.u16(0);
  for (const net of frame.nets) {
    w.u8(net.level);
    w.u8(net.flags);
    w.u16(0);
    w.u32(net.toggles);
    w.f32(net.duty);
  }
  for (const item of frame.watch) {
    w.u32(item.sig);
    w.u16(item.width);
    w.u16(item.words.length);
    for (const word of item.words) w.u32(word);
  }
  for (const part of frame.parts) {
    w.u16(part.index);
    w.u16(part.state.length);
    w.raw(part.state);
    w.pad4();
  }
  return withHeader(KIND_FRAME, seq, timePs, w);
}

export function encodeTrace(seq: number, timePs: bigint, trace: Trace): Uint8Array {
  const w = new Writer();
  w.u32(trace.record);
  w.u32(trace.changes.length);
  w.u64(trace.fromPs);
  w.u64(trace.toPs);
  for (const change of trace.changes) {
    w.u64(change.timePs);
    w.u16(change.index);
    w.u16(change.words.length);
    for (const word of change.words) w.u32(word);
  }
  return withHeader(KIND_TRACE, seq, timePs, w);
}

export function encodePartData(seq: number, timePs: bigint, data: PartData): Uint8Array {
  const w = new Writer();
  w.u16(data.part);
  w.u16(data.channel);
  w.u32(data.bytes.length);
  w.raw(data.bytes);
  w.pad4();
  return withHeader(KIND_PART_DATA, seq, timePs, w);
}
