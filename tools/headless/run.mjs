#!/usr/bin/env node
// Examples without a browser (spec section 11.1): each example is built through the build server,
// the built core is loaded in Node and runs expect.json (section 11.2).
//
//   node tools/headless/run.mjs --server http://localhost:8080 [--key KEY] [example folder ...]
//
// The address and the key come from the parameters or from the variables FPGASIM_SERVER and FPGASIM_KEY
// (tools/dev/server.sh with ... sets them). Without a folder list it runs all examples
// from examples/, lessons from examples/lessons/ and projects from server/tests/projects/ that have an expect.json.
// Each example is built and run in the visibility modes all and ports.
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PROTOCOL, loadCore, makeConfigure } from "./core.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const MODES = ["all", "ports"];

function parseArgs(argv) {
  const args = {
    server: process.env.FPGASIM_SERVER ?? "http://localhost:8080",
    key: process.env.FPGASIM_KEY ?? "",
    dirs: [],
  };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--server") args.server = argv[++i];
    else if (argv[i] === "--key") args.key = argv[++i];
    else args.dirs.push(resolve(argv[i]));
  }
  return args;
}

async function walk(dir, base = dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(path, base)));
    else out.push(relative(base, path).split("\\").join("/"));
  }
  return out.sort();
}

async function defaultDirs() {
  const dirs = [];
  for (const base of ["examples", "examples/lessons", "server/tests/projects"]) {
    for (const entry of await readdir(join(ROOT, base), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const files = await readdir(join(ROOT, base, entry.name));
      if (files.includes("expect.json")) dirs.push(join(ROOT, base, entry.name));
    }
  }
  return dirs.sort();
}

async function loadProject(dir) {
  const files = [];
  let config = null;
  for (const path of await walk(dir)) {
    if (path === "expect.json") continue;
    const content = await readFile(join(dir, path), "utf8");
    if (path === "fpgasim.json") config = JSON.parse(content);
    else files.push({ path, content });
  }
  return { files, config };
}

// A request with one retry on a network failure: after a long run the server has time to close
// the idle connection, and the first request on it fails.
async function request(url, init) {
  try {
    return await fetch(url, init);
  } catch {
    return fetch(url, init);
  }
}

async function build(args, project, visibility) {
  const headers = { Authorization: `Bearer ${args.key}`, "Content-Type": "application/json" };
  const response = await request(`${args.server}/v1/build`, {
    method: "POST",
    headers,
    body: JSON.stringify({ ...project, options: { visibility } }),
  });
  if (!response.ok) throw new Error(`сервер ответил ${response.status}: ${await response.text()}`);
  const body = await response.json();
  const artifacts = {};
  if (body.artifacts) {
    for (const [kind, path] of Object.entries(body.artifacts)) {
      const file = await request(`${args.server}${path}`, { headers });
      if (!file.ok) throw new Error(`файл сборки ${path}: ${file.status}`);
      artifacts[kind] = new Uint8Array(await file.arrayBuffer());
    }
  }
  return { body, artifacts };
}

// Run the expect.json scenario on the loaded core. Returns the result by nets and the notices.
function simulate(core, board, resolved, expect, config) {
  core.command({ t: "hello", protocol: PROTOCOL });
  const ready = core.last("ready");
  const configure = makeConfigure(board, resolved, ready.partTypes, config);
  core.command(configure);
  const signals = core.command({ t: "signals" }).signals;

  let now = 0n;
  const stepTo = (target) => {
    if (target <= now) return;
    core.stepPs(target - now);
    now = target;
  };
  const started = performance.now();
  for (const action of expect.actions ?? []) {
    stepTo(BigInt(action.atPs));
    core.command({ t: "part", part: action.part, cmd: action.cmd, ...(action.args ? { args: action.args } : {}) });
  }
  stepTo(BigInt(expect.run.ps));
  const realMs = performance.now() - started;

  const totals = configure.nets.map(() => ({ toggles: 0, highPs: 0, level: 0 }));
  let spanPs = 0n;
  for (const frame of core.frames) {
    spanPs += frame.spanPs;
    frame.nets.forEach((net, i) => {
      totals[i].toggles += net.toggles;
      totals[i].highPs += net.duty * Number(frame.spanPs);
      totals[i].level = net.level;
    });
  }
  const nets = {};
  configure.nets.forEach((net, i) => {
    const t = totals[i];
    nets[String(net.pin)] = { toggles: t.toggles, level: t.level, duty: spanPs ? t.highPs / Number(spanPs) : t.level };
  });
  const state = core.last("state");
  // Result by parts: PART_DATA bytes (channel 0), the last state from the frame and the events.
  const parts = {};
  configure.parts.forEach((part, i) => {
    parts[part.id] = {
      type: part.type,
      data: core.partData.get(i) ?? [],
      state: [...(core.partStates.get(i) ?? [])],
      events: core.messages.filter((m) => m.t === "partEvent" && m.part === part.id),
    };
  });
  return {
    nets,
    parts,
    signals,
    ports: ready.ports,
    notices: core.messages.filter((m) => m.t === "notice").map((m) => m.code),
    timePs: state.time,
    cycle: state.cycle,
    realMs,
  };
}

// Value from the event data: a number means exact, { min, max } means bounds.
function matches(want, got) {
  if (want !== null && typeof want === "object") {
    return typeof got === "number" && got >= (want.min ?? got) && got <= (want.max ?? got);
  }
  return want === got;
}

const hex = (n) => n.toString(16).padStart(2, "0");

// Expectations for parts (spec section 11.2): terminal text and bytes, colors and WS2812 error counter,
// events. The same check is in tools/native/run_examples.py and in e2e/tests/stage7.spec.ts.
function compareParts(expect, parts) {
  const problems = [];
  for (const [id, want] of Object.entries(expect)) {
    const got = parts[id];
    if (!got) {
      problems.push(`деталь ${id}: её нет в configure`);
      continue;
    }
    const text = String.fromCharCode(...got.data);
    if ("text" in want && text !== want.text)
      problems.push(`деталь ${id}: терминал получил ${JSON.stringify(text)}, ожидалось ${JSON.stringify(want.text)}`);
    if ("bytes" in want && JSON.stringify(got.data) !== JSON.stringify(want.bytes))
      problems.push(`деталь ${id}: получено байтов ${got.data.length}, ожидалось ${want.bytes.length} других`);
    if ("colors" in want || "errors" in want) {
      if (got.type !== "ws2812" || got.state.length < 8) {
        problems.push(`деталь ${id}: состояния WS2812 нет`);
        continue;
      }
      const colors = [];
      for (let i = 8; i + 2 < got.state.length; i += 3)
        colors.push(`#${hex(got.state[i])}${hex(got.state[i + 1])}${hex(got.state[i + 2])}`);
      const errors = new DataView(Uint8Array.from(got.state).buffer).getUint32(4, true);
      if ("colors" in want && JSON.stringify(colors) !== JSON.stringify(want.colors))
        problems.push(`деталь ${id}: цвета ${colors.join(" ")}, ожидались ${want.colors.join(" ")}`);
      if ("errors" in want && errors !== want.errors)
        problems.push(`деталь ${id}: ошибок длительности ${errors}, ожидалось ${want.errors}`);
    }
    const wanted = (want.events ?? []).map((e) => (typeof e === "string" ? { event: e } : e));
    const gotNames = [...new Set(got.events.map((e) => e.event))].sort();
    const wantNames = [...new Set(wanted.map((e) => e.event))].sort();
    if (JSON.stringify(gotNames) !== JSON.stringify(wantNames)) {
      problems.push(`деталь ${id}: события ${JSON.stringify(gotNames)}, ожидались ${JSON.stringify(wantNames)}`);
      continue;
    }
    for (const item of wanted) {
      const fields = Object.entries(item.data ?? {});
      const found = got.events.some((e) => e.event === item.event && fields.every(([k, v]) => matches(v, e.data[k])));
      if (!found) problems.push(`деталь ${id}: нет события ${item.event} с данными ${JSON.stringify(item.data)}`);
    }
  }
  return problems;
}

function compare(expect, built, result) {
  const problems = [];
  const codes = new Set(built.diagnostics.map((d) => d.code));
  for (const code of expect.build?.codes ?? []) {
    if (!codes.has(code)) problems.push(`сборка: нет сообщения ${code}`);
  }
  if (!result) return problems;
  for (const [pin, want] of Object.entries(expect.nets ?? {})) {
    const got = result.nets[pin];
    if (!got) {
      problems.push(`вывод ${pin}: сети нет в configure`);
      continue;
    }
    if ("toggles" in want && got.toggles !== want.toggles)
      problems.push(`вывод ${pin}: переключений ${got.toggles}, ожидалось ${want.toggles}`);
    if ("togglesMin" in want && got.toggles < want.togglesMin)
      problems.push(`вывод ${pin}: переключений ${got.toggles}, ожидалось не меньше ${want.togglesMin}`);
    if ("level" in want && got.level !== want.level)
      problems.push(`вывод ${pin}: уровень ${got.level}, ожидался ${want.level}`);
    if ("dutyMin" in want && got.duty < want.dutyMin)
      problems.push(`вывод ${pin}: доля в единице ${got.duty} меньше ${want.dutyMin}`);
    if ("dutyMax" in want && got.duty > want.dutyMax)
      problems.push(`вывод ${pin}: доля в единице ${got.duty} больше ${want.dutyMax}`);
  }
  problems.push(...compareParts(expect.parts ?? {}, result.parts));
  const wantNotices = [...new Set(expect.notices ?? [])].sort();
  const gotNotices = [...new Set(result.notices)].sort();
  if (JSON.stringify(wantNotices) !== JSON.stringify(gotNotices))
    problems.push(`замечания ${JSON.stringify(gotNotices)}, ожидались ${JSON.stringify(wantNotices)}`);
  if (!gotNotices.includes("MODEL_FINISH") && result.timePs !== expect.run.ps)
    problems.push(`время симуляции ${result.timePs} пс, ожидалось ${expect.run.ps}`);
  return problems;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.key) throw new Error("нужен ключ: --key или переменная FPGASIM_KEY");
  const dirs = args.dirs.length ? args.dirs : await defaultDirs();
  const boards = new Map();
  let runs = 0;
  let failed = 0;
  for (const dir of dirs) {
    const name = relative(ROOT, dir);
    const expect = JSON.parse(await readFile(join(dir, "expect.json"), "utf8"));
    const project = await loadProject(dir);
    for (const mode of MODES) {
      runs += 1;
      const label = `${name} [${mode}]`;
      try {
        const { body, artifacts } = await build(args, project, mode);
        const wantStatus = expect.build?.status ?? "ok";
        let problems = [];
        let result = null;
        if (body.status !== wantStatus) {
          const errors = body.diagnostics.filter((d) => d.severity === "error").map((d) => `${d.code}: ${d.original}`);
          problems.push(`сборка: состояние ${body.status}, ожидалось ${wantStatus}; ${errors.join("; ")}`);
        } else if (body.status === "ok") {
          const boardId = body.resolved.board;
          if (!boards.has(boardId))
            boards.set(boardId, JSON.parse(await readFile(join(ROOT, "boards", `${boardId}.json`), "utf8")));
          const core = await loadCore(artifacts.js, artifacts.wasm);
          result = simulate(core, boards.get(boardId), body.resolved, expect, project.config);
          // In mode ports the signal list holds only ports; in mode all it holds internal ones too (spec section 4.5).
          const kinds = [...new Set(result.signals.map((s) => s.kind))];
          if (mode === "ports" && JSON.stringify(kinds) !== '["port"]')
            problems.push(`режим ports: в списке сигналов есть не только порты: ${kinds.join(", ")}`);
          if (
            JSON.stringify(result.ports.map((p) => p.name).sort()) !==
            JSON.stringify(body.resolved.ports.map((p) => p.name).sort())
          )
            problems.push("порты ядра и порты из ответа сервера расходятся");
        }
        problems = problems.concat(compare(expect, body, result));
        if (problems.length) {
          failed += 1;
          console.log(`СБОЙ  ${label}`);
          for (const p of problems) console.log(`      ${p}`);
        } else {
          const speed = result?.cycle ? `, ${(result.cycle / result.realMs / 1000).toFixed(1)} млн тактов/с` : "";
          const how = body.cached ? "из кеша" : `сборка ${body.durationMs} мс`;
          console.log(`ок    ${label}: ${how}${result ? `, прогон ${result.realMs.toFixed(0)} мс${speed}` : ""}`);
        }
      } catch (e) {
        failed += 1;
        console.log(`СБОЙ  ${label}\n      ${e.message}`);
      }
    }
  }
  console.log(`примеры: прогонов ${runs}, сбоев ${failed}`);
  process.exit(failed || runs === 0 ? 1 : 0);
}

await main();
