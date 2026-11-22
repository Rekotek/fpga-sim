// Core host for Node (spec section 11.1, "examples without a browser"): loads sim.mjs and sim.wasm,
// exchanges protocol messages across the fs_* boundary (section 4.8), parses FRAME (section 4.6).
// The host talks to the core only with protocol messages, as the interface does.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const PROTOCOL = 1;
const HEADER_BYTES = 24;
const MAGIC = 0x5346;
const KIND_FRAME = 1;
const KIND_PART_DATA = 3;

export function decodeHeader(bytes) {
  if (bytes.length < HEADER_BYTES) return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (v.getUint16(0, true) !== MAGIC) return null;
  return {
    protocol: v.getUint8(2),
    kind: v.getUint8(3),
    seq: v.getUint32(4, true),
    timePs: v.getBigUint64(8, true),
    length: v.getUint32(16, true),
  };
}

export function decodeFrame(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = HEADER_BYTES;
  const frame = {
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
    const words = [];
    const count = v.getUint16(at + 6, true);
    for (let k = 0; k < count; k += 1) words.push(v.getUint32(at + 8 + 4 * k, true));
    frame.watch.push({ sig: v.getUint32(at, true), width: v.getUint16(at + 4, true), words });
    at += 8 + 4 * count;
  }
  for (let i = 0; i < partCount; i += 1) {
    const length = v.getUint16(at + 2, true);
    frame.parts.push({ part: v.getUint16(at, true), state: bytes.slice(at + 4, at + 4 + length) });
    at += 4 + ((length + 3) & ~3);
  }
  return frame;
}

// Loads the core from the bytes of the two build files. The ES module is imported from a temporary folder.
export async function loadCore(mjsBytes, wasmBytes) {
  const dir = await mkdtemp(join(tmpdir(), "fpgasim-core-"));
  try {
    await writeFile(join(dir, "sim.mjs"), mjsBytes);
    const { default: createModule } = await import(pathToFileURL(join(dir, "sim.mjs")).href);
    const core = new Core();
    core.module = await createModule({
      // The host gets the sim.wasm bytes itself (in the browser: through fetch with the key, spec section 8.3).
      instantiateWasm: (imports, done) => {
        WebAssembly.instantiate(wasmBytes, imports).then((result) => done(result.instance));
        return {};
      },
      onJson: (text) => core.onJson(JSON.parse(text)),
      onBinary: (bytes) => core.onBinary(bytes),
    });
    core.module._fs_init();
    return core;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export class Core {
  module = null;
  nextId = 1;
  messages = []; // all control messages of the core, in order
  frames = [];
  binaries = []; // binary messages of the other kinds
  partData = new Map(); // part number -> PART_DATA bytes of channel 0
  partStates = new Map(); // part number -> last state from the frame
  replies = new Map();

  onJson(msg) {
    this.messages.push(msg);
    if ((msg.t === "ok" || msg.t === "error") && msg.id !== undefined) this.replies.set(msg.id, msg);
  }

  onBinary(bytes) {
    const header = decodeHeader(bytes);
    if (header?.kind === KIND_FRAME) {
      const frame = decodeFrame(bytes);
      this.frames.push(frame);
      for (const part of frame.parts) this.partStates.set(part.part, part.state);
    } else if (header?.kind === KIND_PART_DATA) {
      // PART_DATA content: part number, channel, length, bytes (spec section 4.6).
      const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const part = v.getUint16(HEADER_BYTES, true);
      const channel = v.getUint16(HEADER_BYTES + 2, true);
      const length = v.getUint32(HEADER_BYTES + 4, true);
      if (channel === 0) {
        const list = this.partData.get(part) ?? [];
        list.push(...bytes.subarray(HEADER_BYTES + 8, HEADER_BYTES + 8 + length));
        this.partData.set(part, list);
      }
    } else {
      this.binaries.push(bytes);
    }
  }

  // A command with a number; the core replies before fs_json returns. A rejected command is an exception.
  command(msg) {
    const id = this.nextId++;
    const text = new TextEncoder().encode(JSON.stringify({ ...msg, id }));
    const m = this.module;
    const ptr = m._fs_alloc(text.length);
    m.HEAPU8.set(text, ptr);
    m._fs_json(ptr, text.length);
    m._fs_free(ptr);
    const reply = this.replies.get(id);
    this.replies.delete(id);
    if (!reply) throw new Error(`ядро не ответило на команду ${msg.t}`);
    if (reply.t === "error") throw new Error(`команда ${msg.t}: ${reply.code}: ${reply.text}`);
    return reply;
  }

  tick() {
    this.module._fs_tick(performance.now());
  }

  last(type) {
    return this.messages.findLast((m) => m.t === type);
  }

  // Step by the given simulation time: the core counts it in portions and sends one frame at the end.
  stepPs(ps) {
    const before = this.frames.length;
    this.command({ t: "step", unit: "time", ps: String(ps) });
    while (this.frames.length === before) this.tick();
  }
}

// The configure message (spec section 4.4) from the server reply, the board file and fpgasim.json: the
// interface composes it the same way (web/src/sim/configure.ts). Built-in parts go with the changes from
// boardParts (disabled ones are skipped), followed by the breadboard parts from parts.
// Parts whose type the core does not have do not go into configure.
export function makeConfigure(board, resolved, partTypes, config = null) {
  const nets = resolved.pins.map((p) => ({ pin: p.pin, port: p.port, bit: p.bit, pull: p.pull }));
  const pins = new Set(nets.map((n) => n.pin));
  const changes = config?.boardParts ?? {};
  const parts = [];
  for (const p of board.parts) {
    const change = changes[p.id] ?? {};
    if (change.enabled === false) continue;
    parts.push({ id: p.id, type: p.type, pins: p.pins, settings: { ...p.settings, ...change.settings } });
  }
  for (const p of config?.parts ?? []) {
    parts.push({ id: p.id, type: p.type, pins: p.pins, settings: p.settings ?? {} });
  }
  const known = parts.filter((p) => partTypes.includes(p.type));
  for (const part of known) {
    for (const pin of Object.values(part.pins)) {
      if (!pins.has(pin)) {
        nets.push({ pin, pull: "none" });
        pins.add(pin);
      }
    }
  }
  const clock = resolved.clock ? { port: resolved.clock.port, hz: resolved.clock.hz } : null;
  return { t: "configure", board: board.id, clock, nets, parts: known, watch: [] };
}
