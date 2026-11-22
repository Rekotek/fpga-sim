// Protocol control messages (spec sections 4.2–4.4) to the extent the interface needs.
// Schemas are in spec/protocol/.

export type Speed = number | "max";
export type RunState = "idle" | "running" | "paused" | "finished";
export type Pull = "up" | "down" | "none";

export interface ConfigureNet {
  pin: number;
  port?: string;
  bit?: number;
  pull: Pull;
}

export interface ConfigurePart {
  id: string;
  type: string;
  pins: Record<string, number>;
  settings: Record<string, unknown>;
}

// Declared via type: so the message fits the Command shape too.
export type Configure = {
  t: "configure";
  board: string;
  clock: { port: string; hz: number } | null;
  nets: ConfigureNet[];
  parts: ConfigurePart[];
  watch: number[];
};

// A command to the core: the type and fields of section 4.2. The host adds the id number.
export type Command = { t: string } & Record<string, unknown>;

export interface ReadyMessage {
  t: "ready";
  protocol: number;
  runtime: string;
  engine: { name: string; version: string };
  top: string;
  ports: { name: string; dir: "in" | "out" | "inout"; width: number }[];
  partTypes: string[];
}

// A row of the signals response (spec section 4.5).
export interface SignalInfo {
  sig: number;
  path: string;
  width: number;
  kind: "port" | "wire" | "reg" | "memory" | "param";
  depth?: number;
}

export type RecordRunState = "armed" | "recording" | "done" | "stopped";

export interface RecordStateMessage {
  t: "recordState";
  record: number;
  state: RecordRunState;
  changes: number;
  fromPs: string;
  toPs: string;
}

export interface StateMessage {
  t: "state";
  run: RunState;
  time: string;
  cycle: number;
  speed: Speed;
}

export interface NoticeMessage {
  t: "notice";
  code: string;
  text: string;
  net?: string;
  part?: string;
  time: string;
}

export interface ReplyMessage {
  t: "ok" | "error";
  id?: number;
  code?: string;
  text?: string;
  [field: string]: unknown;
}

// A core message after JSON.parse: every one has the t field.
export type CoreMessage = { t: string } & Record<string, unknown>;

// Between the page and the Worker, besides protocol messages (a JSON string and an ArrayBuffer, section 4.1),
// transport service objects travel: core loading and its result (section 4.7, item 1).
export interface LoadRequest {
  load: { mjs: ArrayBuffer; wasm: ArrayBuffer };
}

export type TransportMessage = { transport: "ready" } | { transport: "failed"; text: string };
