// The page side of the core host: creates the Worker, runs the section 4.7 exchange and keeps the frame result.
// Frames do not go into React state (spec section 9.1): the last frame and the accumulated counters sit
// in the plain live object, read by drawing and window.__fpgasim.
import type {
  Command,
  Configure,
  CoreMessage,
  LoadRequest,
  ReadyMessage,
  ReplyMessage,
  TransportMessage,
} from "./messages";
import {
  KIND_FRAME,
  KIND_PART_DATA,
  KIND_TRACE,
  PROTOCOL,
  decodeMessage,
  type Frame,
  type FrameWatch,
  type PartData,
  type Trace,
} from "./protocol";
import { refusalArgs, type RefusalArgs } from "../i18n/refusal";
import type { TraceInfo } from "../wave/model";
import { Terminal } from "./terminal";

const CHANNEL_BYTES = 0; // PART_DATA: bytes the UART part received from the FPGA (spec section 4.6)

export interface LiveNet {
  pin: number;
  port: string | null;
  bit: number | null;
  name: string | null; // design port bit name; the interface sets it after configure
  level: number;
  flags: number;
  toggles: number; // since the simulation start
  duty: number; // share of time at one in the last batch
  rate: number; // toggles per second of simulation time in the last batch
}

export interface PartEvent {
  part: string;
  event: string;
  data: Record<string, unknown>;
  time: string; // ps
}

const MAX_EVENTS = 500; // total
const MAX_PART_EVENTS = 100; // per part: the event stream of one part does not displace events of others

export interface Live {
  nets: LiveNet[];
  byPin: Map<number, LiveNet>;
  parts: Map<string, Uint8Array>; // last part state from the frame
  watch: Map<number, FrameWatch>; // watched signals of the last frame by sig number
  terminals: Map<string, Terminal>; // terminal log by UART part names
  events: PartEvent[]; // latest part events (partEvent) since the simulation start
  running: boolean; // running state by the last state message
  ratio: number;
  cycle: bigint;
  timePs: bigint;
  frames: number;
}

// A command failure: the error code from section 4.3 or a transport failure.
export class CoreError extends Error {
  constructor(
    readonly code: string,
    text: string,
    readonly args: RefusalArgs | null = null, // the cause for the interface string (decision 183)
  ) {
    super(text);
  }
}

export interface SimulationEvents {
  onMessage(message: CoreMessage): void; // state, notice, partEvent and other messages without id
  onFailure(error: CoreError): void; // Worker failure after start
  onRestart?(): void; // the core answered ok to reset or configure: the simulation restarted
}

// Record data: the info field of the recordFetch response and TRACE messages up to recordEnd.
export interface RecordData {
  info: TraceInfo[];
  traces: Trace[];
}

interface Pending {
  resolve(reply: ReplyMessage): void;
  reject(error: CoreError): void;
  resets: boolean;
}

export class Simulation {
  readonly live: Live = {
    nets: [],
    byPin: new Map(),
    parts: new Map(),
    watch: new Map(),
    terminals: new Map(),
    events: [],
    running: false,
    ratio: 0,
    cycle: 0n,
    timePs: 0n,
    frames: 0,
  };
  ready: ReadyMessage | null = null;
  private worker: Worker | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private partIds: string[] = [];
  private rejectLoad: ((error: CoreError) => void) | null = null;
  private fetching: { traces: Trace[]; done(): void } | null = null;
  private fetchQueue: Promise<unknown> = Promise.resolve();

  constructor(private readonly events: SimulationEvents) {}

  // Items 1–3 of section 4.7: core loading, hello → ready, configure. Building configure
  // is left to the caller: it needs partTypes from ready.
  async start(mjs: ArrayBuffer, wasm: ArrayBuffer, configure: (ready: ReadyMessage) => Configure): Promise<void> {
    const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    this.worker = worker;
    await new Promise<void>((resolve, reject) => {
      this.rejectLoad = reject;
      worker.onmessage = (event: MessageEvent<TransportMessage>) => {
        if (event.data.transport === "ready") resolve();
        else reject(new CoreError("LOAD_FAILED", event.data.text));
      };
      worker.onerror = (event) => {
        reject(new CoreError("LOAD_FAILED", event.message));
      };
      const request: LoadRequest = { load: { mjs, wasm } };
      worker.postMessage(request, [mjs, wasm]);
    });
    this.rejectLoad = null;
    worker.onmessage = (event: MessageEvent<string | ArrayBuffer>) => {
      try {
        this.receive(event.data);
      } catch (e) {
        // The core message is not parsed: computing cannot go on.
        this.fail(new CoreError("BAD_CORE_MESSAGE", String(e)));
      }
    };
    worker.onerror = (event) => {
      this.fail(new CoreError("WORKER_FAILED", event.message));
    };
    await this.command({ t: "hello", protocol: PROTOCOL });
    const ready = this.ready;
    if (ready?.protocol !== PROTOCOL) throw new CoreError("PROTOCOL_MISMATCH", "");
    await this.configure(configure(ready));
  }

  // The configure command: nets and parts are replaced, the simulation starts over (spec section 4.2).
  // The page net list changes after the core answers: until then frames follow the previous list,
  // and on rejection the core keeps the previous setup.
  async configure(message: Configure): Promise<ReplyMessage> {
    const reply = await this.command(message);
    this.partIds = message.parts.map((p) => p.id);
    this.live.nets = message.nets.map((n) => ({
      pin: n.pin,
      port: n.port ?? null,
      bit: n.bit ?? null,
      name: null,
      level: 0,
      flags: 0,
      toggles: 0,
      duty: 0,
      rate: 0,
    }));
    this.live.byPin = new Map(this.live.nets.map((n) => [n.pin, n]));
    this.live.parts.clear();
    // The log of a part that stays in configure is kept as the same object: the tab holds it.
    const uarts = new Set(message.parts.filter((p) => p.type === "uart").map((p) => p.id));
    for (const id of this.live.terminals.keys()) if (!uarts.has(id)) this.live.terminals.delete(id);
    for (const id of uarts) if (!this.live.terminals.has(id)) this.live.terminals.set(id, new Terminal());
    return reply;
  }

  // A command with a number; an ok answer is a value, an error answer is a CoreError exception.
  command(message: Command): Promise<ReplyMessage> {
    const worker = this.worker;
    if (!worker) return Promise.reject(new CoreError("NO_CORE", ""));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, resets: message.t === "reset" || message.t === "configure" });
      worker.postMessage(JSON.stringify({ ...message, id }));
    });
  }

  // Record data (spec section 4.2, recordFetch): after ok come TRACE messages and recordEnd.
  // Requests go one at a time: TRACE messages carry no request number.
  fetchRecord(record: number): Promise<RecordData> {
    const next = this.fetchQueue.then(async () => {
      const traces: Trace[] = [];
      const ended = new Promise<void>((resolve) => {
        this.fetching = { traces, done: resolve };
      });
      try {
        const reply = await this.command({ t: "recordFetch", record });
        await ended;
        return { info: reply.info as TraceInfo[], traces };
      } finally {
        this.fetching = null;
      }
    });
    this.fetchQueue = next.catch(() => undefined);
    return next;
  }

  terminate(): void {
    this.worker?.terminate();
    this.worker = null;
    this.rejectLoad?.(new CoreError("NO_CORE", ""));
    this.rejectLoad = null;
    this.fail(new CoreError("NO_CORE", ""), false);
  }

  private fail(error: CoreError, notify = true): void {
    for (const waiting of this.pending.values()) waiting.reject(error);
    this.pending.clear();
    this.fetching?.done();
    if (notify) this.events.onFailure(error);
  }

  private receive(data: string | ArrayBuffer): void {
    if (typeof data !== "string") {
      const message = decodeMessage(new Uint8Array(data));
      if (message?.kind === KIND_FRAME) this.applyFrame(message.frame, message.header.timePs);
      else if (message?.kind === KIND_PART_DATA) this.applyPartData(message.partData);
      else if (message?.kind === KIND_TRACE) this.fetching?.traces.push(message.trace);
      return;
    }
    const message = JSON.parse(data) as CoreMessage;
    if (message.t === "ready") this.ready = message as unknown as ReadyMessage;
    if (message.t === "state") this.live.running = message.run === "running";
    if (message.t === "recordEnd") {
      this.fetching?.done();
      return;
    }
    if (message.t === "partEvent") {
      const event = message as unknown as PartEvent;
      const own = this.live.events.filter((e) => e.part === event.part).length;
      if (own >= MAX_PART_EVENTS) {
        this.live.events.splice(
          this.live.events.findIndex((e) => e.part === event.part),
          1,
        );
      }
      this.live.events.push(event);
      if (this.live.events.length > MAX_EVENTS) this.live.events.splice(0, this.live.events.length - MAX_EVENTS);
    }
    if ((message.t === "ok" || message.t === "error") && typeof message.id === "number") {
      const reply = message as ReplyMessage;
      const waiting = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (reply.t === "ok") {
        // A frame after ok to reset and configure already belongs to the simulation from the start.
        if (waiting?.resets) {
          this.resetCounters();
          this.events.onRestart?.();
        }
        waiting?.resolve(reply);
      } else {
        waiting?.reject(new CoreError(reply.code ?? "ERROR", reply.text ?? "", refusalArgs(reply.args)));
      }
      return;
    }
    this.events.onMessage(message);
  }

  private resetCounters(): void {
    for (const net of this.live.nets) net.toggles = 0;
    this.live.parts.clear();
    // The simulation restarted: the terminal log starts over with it.
    for (const terminal of this.live.terminals.values()) terminal.clear();
    this.live.events = [];
    this.live.frames = 0;
  }

  private applyPartData(data: PartData): void {
    const id = this.partIds[data.part];
    if (id === undefined || data.channel !== CHANNEL_BYTES) return;
    this.live.terminals.get(id)?.append(data.bytes);
  }

  // Only the last frame is drawn, but toggles are counted from all of them (section 4.7).
  private applyFrame(frame: Frame, timePs: bigint): void {
    const live = this.live;
    frame.nets.forEach((net, i) => {
      const target = live.nets[i];
      if (!target) return;
      target.level = net.level;
      target.flags = net.flags;
      target.toggles += net.toggles;
      target.duty = net.duty;
      target.rate = frame.spanPs > 0n ? (net.toggles * 1e12) / Number(frame.spanPs) : 0;
    });
    for (const part of frame.parts) {
      const id = this.partIds[part.index];
      if (id !== undefined) live.parts.set(id, part.state);
    }
    // A frame carries the whole watch list: previous values are replaced entirely.
    live.watch.clear();
    for (const item of frame.watch) live.watch.set(item.sig, item);
    live.ratio = frame.ratio;
    live.cycle = frame.cycle;
    live.timePs = timePs;
    live.frames += 1;
  }
}
