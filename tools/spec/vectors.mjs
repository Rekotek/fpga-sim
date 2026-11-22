// Reference binary protocol messages: spec/protocol/vectors/ (spec section 4.6).
// The encoding here is written independently of the core: the C++ core and the TypeScript interface check against it.
//
//   node tools/spec/vectors.mjs --write    create the .bin files from vectors.json
//
// The check "files match the description" is done by check.mjs.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "spec", "protocol", "vectors");
const KINDS = { FRAME: 1, TRACE: 2, PART_DATA: 3 };

// Write with little-endian byte order and 4-byte alignment.
class Writer {
  bytes = [];
  u8(v) {
    this.bytes.push(v & 0xff);
  }
  u16(v) {
    this.u8(v);
    this.u8(v >> 8);
  }
  u32(v) {
    this.u16(v & 0xffff);
    this.u16(Math.floor(v / 65536));
  }
  u64(v) {
    const big = BigInt(v);
    this.u32(Number(big & 0xffffffffn));
    this.u32(Number(big >> 32n));
  }
  f32(v) {
    const view = new DataView(new ArrayBuffer(4));
    view.setFloat32(0, v, true);
    this.u32(view.getUint32(0, true));
  }
  pad4() {
    while (this.bytes.length % 4 !== 0) this.bytes.push(0);
  }
}

function payload(vector) {
  const w = new Writer();
  if (vector.kind === "FRAME") {
    const f = vector.frame;
    w.u64(f.spanPs);
    w.u64(f.cycle);
    w.u32(f.realUs);
    w.f32(f.ratio);
    w.u16(f.nets.length);
    w.u16(f.watch.length);
    w.u16(f.parts.length);
    w.u16(0);
    for (const net of f.nets) {
      w.u8(net.level);
      w.u8(net.flags);
      w.u16(0);
      w.u32(net.toggles);
      w.f32(net.duty);
    }
    for (const item of f.watch) {
      w.u32(item.sig);
      w.u16(item.width);
      w.u16(item.words.length);
      for (const word of item.words) w.u32(word);
    }
    for (const part of f.parts) {
      w.u16(part.index);
      w.u16(part.state.length);
      for (const byte of part.state) w.u8(byte);
      w.pad4();
    }
  } else if (vector.kind === "TRACE") {
    const t = vector.trace;
    w.u32(t.record);
    w.u32(t.changes.length);
    w.u64(t.fromPs);
    w.u64(t.toPs);
    for (const change of t.changes) {
      w.u64(change.timePs);
      w.u16(change.index);
      w.u16(change.words.length);
      for (const word of change.words) w.u32(word);
    }
  } else if (vector.kind === "PART_DATA") {
    const d = vector.partData;
    w.u16(d.part);
    w.u16(d.channel);
    w.u32(d.bytes.length);
    for (const byte of d.bytes) w.u8(byte);
    w.pad4();
  } else {
    throw new Error(`неизвестный вид сообщения: ${vector.kind}`);
  }
  return w.bytes;
}

// Full message: 24-byte header and content.
export function encodeVector(vector) {
  const body = payload(vector);
  const w = new Writer();
  w.u16(0x5346);
  w.u8(1);
  w.u8(KINDS[vector.kind]);
  w.u32(vector.seq);
  w.u64(vector.timePs);
  w.u32(body.length);
  w.u32(0);
  return Buffer.from([...w.bytes, ...body]);
}

export function loadVectors() {
  return JSON.parse(readFileSync(join(DIR, "vectors.json"), "utf8")).vectors;
}

export const vectorPath = (vector) => join(DIR, vector.file);

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv[2] !== "--write") {
    console.error("использование: node tools/spec/vectors.mjs --write");
    process.exit(2);
  }
  for (const vector of loadVectors()) {
    const bytes = encodeVector(vector);
    writeFileSync(vectorPath(vector), bytes);
    console.log(`${vector.file}: ${bytes.length} байт`);
  }
}
