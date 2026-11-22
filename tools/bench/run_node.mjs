// Benchmark: WebAssembly measurement in Node.
// Usage: node tools/bench/run_node.mjs [bench/out directory] [machine label]
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import os from "node:os";
import { HALF_STEPS, RUNS, summarize } from "./common.mjs";
import { powerSpan, powerState } from "./power.mjs";

const outRoot = resolve(process.argv[2] ?? "bench/out");
const host = process.argv[3] ?? "mac";
const manifest = JSON.parse(readFileSync(resolve(outRoot, "wasm/manifest.json"), "utf8"));
const only = process.env.BENCH_ONLY;

const powerStart = powerState();
const results = [];
for (const v of manifest) {
  if (only && !v.name.includes(only)) continue;
  const url = pathToFileURL(resolve(outRoot, "wasm", v.name, "bench.mjs")).href;
  const mod = await (await import(url)).default();
  const runs = [];
  for (let i = 0; i < RUNS + 1; i++) runs.push(JSON.parse(mod.UTF8ToString(mod._bench_run(HALF_STEPS))));
  const entry = {
    env: `node-${host}`,
    mode: v.mode,
    opt: v.opt,
    lto: v.lto,
    wasmBytes: v.wasmBytes,
    ...summarize(runs),
  };
  results.push(entry);
  console.log(`node ${v.name}: медиана ${entry.median.toFixed(1)} млн тактов/с`);
}
const doc = {
  host,
  arch: process.arch,
  cpu: os.cpus()[0]?.model,
  cpus: os.cpus().length,
  versions: { node: process.version, v8: process.versions.v8 },
  power: powerSpan(powerStart, powerState()),
  halfSteps: HALF_STEPS,
  results,
};
if (!only) writeFileSync(resolve(outRoot, `speed-node-${host}.json`), JSON.stringify(doc, null, 2) + "\n");
