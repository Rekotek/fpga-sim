// VCD file (spec section 9.6): export of the waveform model and parsing a file into the same model.
// The export time step is 1 ps. Parsing targets Icarus Verilog files (testbench)
// and the program's own export.
import { SignalBuilder, valueAt, wordsFor, type WaveModel, type WaveSignal } from "./model";

// Signal name in VCD: scopes by the dots of the path. A board pin pin:N is written as pins.pinN:
// third-party programs read a colon in a VCD variable name differently (decision 84).
export function vcdPath(name: string): string[] {
  const pin = /^pin:(\d+)$/.exec(name);
  if (pin) return ["pins", `pin${pin[1] ?? ""}`];
  const parts = name.split(".").map((part) => part.replace(/[^\x21-\x7e]|[[\]]/g, "_"));
  return parts.length > 1 ? parts : ["top", ...parts];
}

// Variable code: printable ASCII characters from "!" to "~", least significant digit first.
function idCode(index: number): string {
  let code = "";
  let rest = index;
  do {
    code += String.fromCharCode(33 + (rest % 94));
    rest = Math.floor(rest / 94);
  } while (rest > 0);
  return code;
}

function valueLine(signal: WaveSignal, index: number, code: string): string {
  if (signal.width === 1) return `${String((signal.values[index * signal.words] ?? 0) & 1)}${code}\n`;
  return `b${valueAt(signal, index).toString(2)} ${code}\n`;
}

interface Scope {
  vars: string[];
  scopes: Map<string, Scope>;
}

function printScope(scope: Scope, out: string[]): void {
  out.push(...scope.vars);
  for (const [name, inner] of scope.scopes) {
    out.push(`$scope module ${name} $end\n`);
    printScope(inner, out);
    out.push("$upscope $end\n");
  }
}

export function writeVcd(model: WaveModel): string {
  const out: string[] = ["$version FPGA SIM $end\n", "$timescale 1ps $end\n"];
  const root: Scope = { vars: [], scopes: new Map() };
  const codes = model.signals.map((_, i) => idCode(i));
  model.signals.forEach((signal, i) => {
    const path = vcdPath(signal.name);
    let scope = root;
    for (const part of path.slice(0, -1)) {
      let inner = scope.scopes.get(part);
      if (!inner) {
        inner = { vars: [], scopes: new Map() };
        scope.scopes.set(part, inner);
      }
      scope = inner;
    }
    const range = signal.width > 1 ? ` [${String(signal.width - 1)}:0]` : "";
    const name = path[path.length - 1] ?? "";
    scope.vars.push(`$var wire ${String(signal.width)} ${codes[i] ?? ""} ${name}${range} $end\n`);
  });
  printScope(root, out);
  out.push("$enddefinitions $end\n", `#${String(model.fromPs)}\n`, "$dumpvars\n");
  model.signals.forEach((signal, i) => out.push(valueLine(signal, 0, codes[i] ?? "")));
  out.push("$end\n");

  // Changes of all signals in ascending time order; at equal time, in list order.
  const next = model.signals.map(() => 1);
  let now = model.fromPs;
  for (;;) {
    let best = -1;
    let bestTime = Infinity;
    for (let i = 0; i < model.signals.length; i += 1) {
      const time = model.signals[i]?.times[next[i] ?? 0];
      if (time !== undefined && time < bestTime) {
        best = i;
        bestTime = time;
      }
    }
    const signal = model.signals[best];
    if (!signal) break;
    if (bestTime !== now) {
      now = bestTime;
      out.push(`#${String(now)}\n`);
    }
    out.push(valueLine(signal, next[best] ?? 0, codes[best] ?? ""));
    next[best] = (next[best] ?? 0) + 1;
  }
  if (model.toPs !== now) out.push(`#${String(model.toPs)}\n`);
  return out.join("");
}

const UNIT_PS: Record<string, number> = { s: 1e12, ms: 1e9, us: 1e6, ns: 1e3, ps: 1, fs: 1e-3 };
const SKIPPED_TYPES = new Set(["real", "realtime", "event", "string"]);

interface Target {
  names: string[];
  builder: SignalBuilder;
}

// Value words from a VCD bit string. The simulator has no X and Z states (spec section 9.3):
// such bits read as 0.
function bitsToWords(bits: string, words: number): number[] {
  const out = new Array<number>(words).fill(0);
  for (let i = 0; i < bits.length; i += 1) {
    const bit = bits.length - 1 - i; // bit index from the least significant
    if (bits[i] === "1" && bit < words * 32) out[bit >> 5] = ((out[bit >> 5] ?? 0) | (1 << (bit & 31))) >>> 0;
  }
  return out;
}

// Parsing VCD text. The signal value at the file start is from the $dumpvars block or the first by time;
// a signal without a value starts at zero. Repeating the previous value is not counted as a change.
export function parseVcd(text: string): WaveModel {
  // Words are read one by one: a testbench file can be up to 20 MB, and a list of all words would take
  // several times more memory than the text itself.
  const word = /\S+/g;
  const next = (): string | null => word.exec(text)?.[0] ?? null;
  const targets = new Map<string, Target>();
  const order: Target[] = [];
  const scopes: string[] = [];
  let scale = 1;
  let time = 0;
  let fromPs: number | null = null;

  const untilEnd = (): string[] => {
    const body: string[] = [];
    for (let token = next(); token !== null && token !== "$end"; token = next()) body.push(token);
    return body;
  };
  const change = (code: string, bits: string): void => {
    const target = targets.get(code);
    if (!target) return;
    const start = fromPs ?? time;
    fromPs = start;
    const words = bitsToWords(bits, target.builder.words);
    // The first value of a signal is later than the file start: before it the signal counts as zero.
    if (target.builder.length === 0) target.builder.add(start, time > start ? [0] : words);
    if (!target.builder.sameAsLast(words)) target.builder.add(time, words);
  };

  for (let token = next(); token !== null; token = next()) {
    const first = token[0] ?? "";
    if (token === "$scope") {
      scopes.push(untilEnd()[1] ?? "");
    } else if (token === "$upscope") {
      scopes.pop();
      untilEnd();
    } else if (token === "$var") {
      const [type = "", size = "1", code = "", ref = ""] = untilEnd();
      if (SKIPPED_TYPES.has(type)) continue;
      const name = [...scopes, ref.replace(/\[[^\]]*\]$/, "")].join(".");
      const known = targets.get(code);
      // One code for several variables: it is one net under different names.
      if (known) known.names.push(name);
      else {
        const target = { names: [name], builder: new SignalBuilder(name, Math.max(1, Number(size) || 1)) };
        targets.set(code, target);
        order.push(target);
      }
    } else if (token === "$timescale") {
      const match = /^(\d+)\s*([munpf]?s)$/.exec(untilEnd().join(""));
      if (match) scale = Number(match[1]) * (UNIT_PS[match[2] ?? "ps"] ?? 1);
    } else if (token === "$comment" || token === "$date" || token === "$version" || token === "$enddefinitions") {
      untilEnd();
    } else if (first === "$") {
      // $dumpvars, $dumpall, $dumpon, $dumpoff and the closing $end: values inside are read as ordinary.
    } else if (first === "#") {
      time = Math.round(Number(token.slice(1)) * scale);
      fromPs ??= time;
    } else if (first === "b" || first === "B") {
      change(next() ?? "", token.slice(1));
    } else if (first === "r" || first === "R" || first === "s" || first === "S") {
      next(); // real and string values are not shown
    } else if ("01xXzZ".includes(first)) {
      change(token.slice(1), first);
    }
  }

  const start = fromPs ?? 0;
  const signals: WaveSignal[] = [];
  for (const target of order) {
    if (target.builder.length === 0)
      target.builder.add(start, new Array<number>(wordsFor(target.builder.width)).fill(0));
    const built = target.builder.build();
    for (const name of target.names) signals.push({ ...built, name });
  }
  return { source: "vcd", fromPs: start, toPs: Math.max(start, time), signals };
}
