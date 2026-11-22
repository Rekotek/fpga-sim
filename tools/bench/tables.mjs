// Benchmark: tables for docs/stage0-report.md from bench/results.json.
//   node tools/bench/tables.mjs
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const d = JSON.parse(readFileSync(resolve(root, "bench/results.json"), "utf8"));
const ru = (x, digits = 1) => x.toFixed(digits).replace(".", ",");
const ENV_NAMES = {
  "native-vps": "Обычный код, VPS",
  "native-mac": "Обычный код, Mac (контейнер linux/arm64)",
  "node-mac": "WebAssembly, Node на Mac",
  "chrome-mac": "WebAssembly, Chrome на Mac",
};
const MODES = ["all", "ports"];
const OPTS = ["O1", "O2", "O3"];
const find = (list, env, mode, opt, lto = false) =>
  list.find((r) => r.env === env && r.mode === mode && r.opt === opt && !!r.lto === lto);

function speedTable(list, envs) {
  const head = MODES.flatMap((m) => OPTS.map((o) => `${m}, -${o}`));
  const lines = [`| Среда | ${head.join(" | ")} |`, `|---|${head.map(() => "---:").join("|")}|`];
  for (const env of envs) {
    const cells = MODES.flatMap((m) =>
      OPTS.map((o) => {
        const e = find(list, env, m, o);
        return e ? ru(e.median) : "—";
      }),
    );
    lines.push(`| ${ENV_NAMES[env]} | ${cells.join(" | ")} |`);
  }
  return lines.join("\n");
}

console.log("### Скорость, млн тактов в секунду (медиана пяти прогонов)\n");
console.log(speedTable(d.speed, Object.keys(ENV_NAMES)));

console.log("\n### Отношение к реальному времени в Chrome (27 млн тактов в секунду = 1×)\n");
{
  const head = MODES.flatMap((m) => OPTS.map((o) => `${m}, -${o}`));
  const cells = MODES.flatMap((m) => OPTS.map((o) => `${ru(find(d.speed, "chrome-mac", m, o).ratio, 2)}×`));
  console.log(`| ${head.join(" | ")} |\n|${head.map(() => "---:").join("|")}|\n| ${cells.join(" | ")} |`);
}

console.log("\n### Оптимизация при компоновке (LTO), млн тактов в секунду\n");
console.log(
  "| Среда | all, -O2 | all, -O2 LTO | all, -O3 LTO | ports, -O2 | ports, -O2 LTO | ports, -O3 LTO |\n|---|---:|---:|---:|---:|---:|---:|",
);
for (const env of ["node-mac", "chrome-mac"]) {
  const c = MODES.flatMap((m) => [
    find(d.speed, env, m, "O2"),
    find(d.speed, env, m, "O2", true),
    find(d.speed, env, m, "O3", true),
  ]);
  console.log(`| ${ENV_NAMES[env]} | ${c.map((e) => ru(e.median)).join(" | ")} |`);
}

console.log("\n### Размер sim.wasm стенда, КБ\n");
{
  const names = [
    ["all", "O1"],
    ["all", "O2"],
    ["all", "O3"],
    ["ports", "O1"],
    ["ports", "O2"],
    ["ports", "O3"],
  ];
  console.log(
    `| ${names.map(([m, o]) => `${m}, -${o}`).join(" | ")} | all, -O2 LTO | all, -O3 LTO |\n|${"---:|".repeat(8)}`,
  );
  const cells = names.map(([m, o]) => find(d.speed, "chrome-mac", m, o).wasmBytes);
  cells.push(
    find(d.speed, "chrome-mac", "all", "O2", true).wasmBytes,
    find(d.speed, "chrome-mac", "all", "O3", true).wasmBytes,
  );
  console.log(`| ${cells.map((b) => Math.round(b / 1024)).join(" | ")} |`);
}

for (const [tag, list] of Object.entries(d.comparison)) {
  console.log(`\n### Для сравнения: ${tag}, млн тактов в секунду\n`);
  console.log(speedTable(list, ["native-mac", "node-mac", "chrome-mac"]));
}

const LABELS = {
  source: "Служебные файлы компилируются каждый раз",
  lib: "Готовая библиотека",
  "lib-pch": "Библиотека и готовый заголовок",
  "lib-j2": "Библиотека, два процесса компиляции",
  "lib-pch-j2": "Библиотека, заголовок, два процесса",
  "lib-unity": "Библиотека, одна единица трансляции",
  "lib-pch-unity": "Библиотека, заголовок, одна единица",
  "lib-lto-j2": "Библиотека, LTO, два процесса",
};
const sec = (ms) => ru(ms / 1000, 2);
console.log(`\n### Время сборки blink3 на VPS, секунды (медиана ${d.buildTime.variants[0].runs} прогонов)\n`);
console.log(
  "| Вариант | Режим | Уровень | Verilator | Прослойка | Компиляция | Компоновка | Итого | С контейнером | Худший |\n|---|---|---|---:|---:|---:|---:|---:|---:|---:|",
);
for (const label of Object.keys(LABELS)) {
  for (const v of d.buildTime.variants.filter((x) => x.label === label)) {
    const m = v.medianMs;
    console.log(
      `| ${LABELS[label]} | ${v.mode} | -${v.opt} | ${sec(m.verilator)} | ${sec(m.shim)} | ${sec(m.compile)} | ${sec(m.link)} | ${sec(m.total)} | ${sec(m.wallWithContainer)} | ${sec(v.maxWallMs)} |`,
    );
  }
}
console.log(`\nПустой контейнер (старт и остановка): ${sec(d.buildTime.emptyContainerMs)} с.`);
console.log(`\nВывод: ${JSON.stringify(d.verdict)}`);
