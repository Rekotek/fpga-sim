// Benchmark: merge the measurements into bench/results.json and check completeness.
//   node tools/bench/merge.mjs            build bench/results.json from bench/out
//   node tools/bench/merge.mjs --verify   check the finished bench/results.json
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { EXPECT_LED, HALF_STEPS } from "./common.mjs";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const RESULTS = resolve(root, "bench/results.json");
const MODES = ["all", "ports"];
const OPTS = ["O1", "O2", "O3"];
const ENVS = ["native-vps", "native-mac", "node-mac", "chrome-mac"];
const REALTIME_MCPS = 27; // board clock 27 MHz
const STOP_MCPS = 8.1; // 0.3x: stop threshold

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const round1 = (x) => Math.round(x * 10) / 10;

function versionsEnv() {
  const out = {};
  for (const line of readFileSync(resolve(root, "server/docker/versions.env"), "utf8").split("\n")) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function speedEntries(doc) {
  return doc.results.map(({ signals, ...r }) => ({ ...r, ratio: Math.round((r.median / REALTIME_MCPS) * 100) / 100 }));
}

function loadSpeed(dir) {
  const files = ["vps/speed-native-vps.json", "speed-native-mac.json", "speed-node-mac.json", "speed-chrome-mac.json"];
  const docs = files
    .map((f) => resolve(dir, f))
    .filter(existsSync)
    .map(readJson);
  return { docs, entries: docs.flatMap(speedEntries) };
}

function loadBuildTime(dir) {
  const path = resolve(dir, "vps/buildtime.jsonl");
  if (!existsSync(path)) return null;
  const rows = readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
  const empty = rows.filter((r) => r.label === "empty").map((r) => r.wallMs);
  const groups = new Map();
  for (const r of rows.filter((x) => x.build)) {
    const key = `${r.label}|${r.build.mode}|${r.build.opt}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const variants = [...groups.values()].map((rs) => {
    const b = rs[0].build;
    const med = (f) => round1(median(rs.map(f)));
    return {
      label: rs[0].label,
      mode: b.mode,
      opt: b.opt,
      rt: b.rt,
      pch: b.pch,
      jobs: b.jobs,
      lto: b.lto,
      unity: b.unity,
      runs: rs.length,
      medianMs: {
        verilator: med((r) => r.build.verilatorMs),
        shim: med((r) => r.build.shimMs),
        compile: med((r) => r.build.compileMs),
        link: med((r) => r.build.linkMs),
        total: med((r) => r.build.totalMs),
        wallWithContainer: med((r) => r.wallMs),
      },
      maxWallMs: Math.max(...rs.map((r) => r.wallMs)),
      wasmBytes: b.outputBytes,
      modelFiles: b.modelFiles,
      runtimeFiles: b.runtimeFiles,
    };
  });
  return {
    emptyContainerMs: median(empty),
    limits: "--cpus 2 --memory 2g, --read-only, --network none (раздел 8.1 ТЗ)",
    variants,
  };
}

function verify(doc) {
  const problems = [];
  for (const env of ENVS)
    for (const mode of MODES)
      for (const opt of OPTS) {
        const e = doc.speed.find((r) => r.env === env && r.mode === mode && r.opt === opt && !r.lto);
        if (!e) problems.push(`нет замера скорости: ${env} ${mode} ${opt}`);
        else if (!e.ok || JSON.stringify(e.toggles) !== JSON.stringify(EXPECT_LED))
          problems.push(`неверные переключения: ${env} ${mode} ${opt}`);
      }
  for (const label of ["source", "lib", "lib-pch"])
    for (const mode of MODES)
      for (const opt of OPTS) {
        if (!doc.buildTime?.variants.find((v) => v.label === label && v.mode === mode && v.opt === opt)) {
          problems.push(`нет замера времени сборки: ${label} ${mode} ${opt}`);
        }
      }
  if (!doc.assumptions?.ok) problems.push("проверка предположений не прошла");
  if (!doc.verdict) problems.push("нет вывода по правилу");
  return problems;
}

if (process.argv.includes("--verify")) {
  const problems = verify(readJson(RESULTS));
  if (problems.length) {
    console.error(problems.join("\n"));
    process.exit(1);
  }
  console.log("bench/results.json: все сочетания на месте, проверочные числа 4, 8 и 16 во всех прогонах");
  process.exit(0);
}

const env = versionsEnv();
const tag = `vl${env.VERILATOR_VERSION}-em${env.EMSCRIPTEN_VERSION}`;
const dir = resolve(root, "bench/out", tag);
const chosen = readJson(resolve(root, "tools/bench/chosen.json"));
const { docs, entries } = loadSpeed(dir);
const buildTime = loadBuildTime(dir);
const assumptions = existsSync(resolve(dir, "assumptions.json")) ? readJson(resolve(dir, "assumptions.json")) : null;
const vpsMeta = existsSync(resolve(dir, "vps/meta.json"))
  ? { ...readJson(resolve(dir, "vps/meta.json")), ...readJson(resolve(dir, "vps/meta-after.json")) }
  : null;

// Other Verilator releases measured for comparison.
const comparison = {};
for (const other of readdirSync(resolve(root, "bench/out")).filter((d) => d.startsWith("vl") && d !== tag)) {
  const s = loadSpeed(resolve(root, "bench/out", other));
  if (s.entries.length) comparison[other] = s.entries.map(({ mcps, toggles, ok, wasmBytes, best, ...r }) => r);
}

const chrome = entries.find((r) => r.env === "chrome-mac" && r.mode === chosen.mode && r.opt === chosen.opt && !r.lto);
const build = buildTime?.variants.find(
  (v) => v.label === chosen.buildVariant && v.mode === chosen.mode && v.opt === chosen.opt,
);
const speedRule = !chrome
  ? null
  : chrome.median >= REALTIME_MCPS
    ? "продолжать"
    : chrome.median >= STOP_MCPS
      ? "продолжать, расхождение записать в решения"
      : "остановиться и сообщить автору";
const coldMs = build?.maxWallMs ?? null;
const buildRule =
  coldMs == null
    ? null
    : coldMs <= 15000
      ? "принято"
      : coldMs <= 30000
        ? "принято с записью в решениях"
        : "остановиться и сообщить автору";

const versions = { verilator: env.VERILATOR_VERSION, emscripten: env.EMSCRIPTEN_VERSION, ubuntu: env.UBUNTU_VERSION };
for (const d of docs)
  Object.assign(versions, Object.fromEntries(Object.entries(d.versions).map(([k, v]) => [`${k}@${d.host}`, v])));

const macDoc = docs.find((d) => d.host === "mac" && d.versions.v8);
const nativePower = existsSync(resolve(dir, "power-native-mac.json"))
  ? readJson(resolve(dir, "power-native-mac.json"))
  : null;
if (nativePower) nativePower.stable = JSON.stringify(nativePower.start) === JSON.stringify(nativePower.end);
const macInfo = macDoc
  ? {
      cpu: macDoc.cpu,
      cpus: macDoc.cpus,
      arch: macDoc.arch,
      os: "macOS",
      // Power mode during each measurement: on battery with Mac low-power mode it runs slower.
      power: {
        native: nativePower,
        node: macDoc.power ?? null,
        chrome: docs.find((x) => x.host === "mac" && x.versions.chrome)?.power ?? null,
      },
    }
  : null;

const doc = {
  format: 1,
  stage: 0,
  date: new Date().toISOString().slice(0, 10),
  design: "examples/blink3",
  simulatedSeconds: 2.1,
  halfStepsPerRun: HALF_STEPS,
  expectedToggles: { pin15: 4, pin16: 8, pin17: 16 },
  units: "mcps — миллионы тактов в секунду; ratio — отношение к 27 МГц",
  versions,
  machines: {
    mac: macInfo,
    vps: vpsMeta,
  },
  chosen,
  verdict: {
    chromeMcps: chrome?.median ?? null,
    chromeRatio: chrome?.ratio ?? null,
    speedRule,
    coldBuildMs: coldMs,
    coldBuildNote: "худший из прогонов выбранного варианта, вместе со стартом контейнера",
    buildRule,
  },
  speed: entries,
  buildTime,
  assumptions,
  comparison,
};
const problems = verify(doc);
writeFileSync(RESULTS, JSON.stringify(doc, null, 2) + "\n");
console.log(
  `записан bench/results.json: скорость ${entries.length} записей, время сборки ${buildTime?.variants.length ?? 0} вариантов`,
);
console.log(`вывод: Chrome ${chrome?.median} млн тактов/с — ${speedRule}; холодная сборка ${coldMs} мс — ${buildRule}`);
if (problems.length) {
  console.error("НЕПОЛНО:\n" + problems.join("\n"));
  process.exit(1);
}
