// Build server responses (spec section 8.3, decision 35).
import type { Pull } from "../sim/messages";

export interface Diagnostic {
  source: "verilator" | "iverilog" | "cst" | "project" | "toolchain";
  severity: "error" | "warning";
  code: string;
  file?: string | null;
  line?: number | null;
  column?: number | null;
  original: string;
  args?: Record<string, unknown>;
}

export interface ResolvedPort {
  name: string;
  dir: "in" | "out" | "inout";
  width: number;
  msb: number;
  lsb: number;
}

export interface ResolvedPin {
  port: string;
  bit: number; // offset from the least significant bit
  pin: number;
  pull: Pull;
}

// After a failed build it is filled as far as possible: all fields are optional.
export interface Resolved {
  board?: string;
  top?: string;
  topFile?: string; // file with the top module
  files?: string[];
  testbenches?: string[];
  constraints?: string | null;
  visibility?: "all" | "ports";
  ports?: ResolvedPort[];
  clock?: { port: string; pin: number; hz: number } | null;
  pins?: ResolvedPin[];
  unbound?: { port: string; bit: number }[];
}

export interface BuildResponse {
  status: "ok" | "failed";
  buildId?: string | null;
  cached?: boolean;
  durationMs: number;
  diagnostics: Diagnostic[];
  resolved: Resolved;
  artifacts?: { wasm: string; js: string };
}

export interface CheckResponse {
  status: "ok" | "failed";
  diagnostics: Diagnostic[];
  resolved: Resolved;
}

// Response of the testbench operation (spec section 8.3). exitCode is null if the run did not start
// or the testbench was stopped on timeout; vcd is the waveform file path or null.
export interface TestbenchResponse {
  status: "ok" | "failed" | "timeout";
  exitCode: number | null;
  durationMs: number;
  stdout: string;
  truncated: boolean;
  diagnostics: Diagnostic[];
  vcd: string | null;
}

export interface InfoResponse {
  toolchain: string;
  runtime: string;
  verilator: string;
  emscripten: string;
  protocol: number;
  limits: Record<string, number>;
  owner: string;
  auth?: "session" | "key"; // accounts spec section 3.1 (docs/tz-accounts.md); no field means a server from before accounts
  user?: Account | null;
  assistant?: { enabled: boolean; model: string | null }; // decision 175; no field means an older server
}

// The assistant (decision 175): a conversation in the Messages API format, passed through the server unchanged.
export type AssistantBlock = { type: string; [key: string]: unknown };
export interface AssistantMessage {
  role: "user" | "assistant";
  content: string | AssistantBlock[];
}
export interface AssistantReply {
  content: AssistantBlock[];
  stop_reason: string;
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number };
}

// Kind of an account in server responses (accounts spec section 3 (docs/tz-accounts.md)).
export interface Account {
  login: string;
  name: string;
  role: "admin" | "user";
  enabled: boolean;
  created: number;
  lastLogin: number | null;
  lastBuild: number | null;
  projects: number;
}

export interface ProjectFile {
  path: string;
  content: string;
}
