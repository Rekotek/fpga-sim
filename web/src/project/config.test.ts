// Project settings on the interface side: the binding source, the binding from the pins field,
// export to .cst, breadboard parts and changes of built-in parts, the part settings form.
import { describe, expect, test } from "vitest";
import type { ResolvedPort } from "../build/types";
import { makeConfigure, settingsOnly } from "../sim/configure";
import { boardById, partDescription } from "./assets";
import {
  bindPins,
  bindResolved,
  bindingSource,
  configBoard,
  cstFileName,
  filesBoard,
  freeCell,
  nextPartId,
  parseConfig,
  parsePairs,
  partIdProblem,
  printConfig,
  printPairs,
  projectParts,
  settingFromText,
  settingProblem,
  settingValue,
  toCst,
  withDefaults,
} from "./config";

const found = boardById("tang-nano-20k");
if (!found) throw new Error("нет файла платы");
const board = found;

const ports: ResolvedPort[] = [
  { name: "clk", dir: "in", width: 1, msb: 0, lsb: 0 },
  { name: "btn", dir: "in", width: 1, msb: 0, lsb: 0 },
  { name: "led", dir: "out", width: 3, msb: 2, lsb: 0 },
];

describe("файл fpgasim.json", () => {
  test("файла нет — настройки по умолчанию; не объект или не JSON — null", () => {
    expect(parseConfig(undefined)).toEqual({ format: 1 });
    expect(parseConfig("{")).toBeNull();
    expect(parseConfig("[1]")).toBeNull();
  });

  test("неизвестные поля сохраняются при перезаписи", () => {
    const config = parseConfig('{"format":1,"mine":{"a":1},"pins":{}}');
    expect(config).not.toBeNull();
    if (!config) return;
    config.pins = { clk: { pin: 4 } };
    expect(JSON.parse(printConfig(config))).toEqual({ format: 1, mine: { a: 1 }, pins: { clk: { pin: 4 } } });
  });
});

describe("источник привязки", () => {
  test("единственный .cst действует сам, без него — поле pins", () => {
    expect(bindingSource({ format: 1 }, ["top.v", "top.cst"])).toEqual({ kind: "cst", file: "top.cst" });
    expect(bindingSource({ format: 1 }, ["top.v"])).toEqual({ kind: "pins" });
  });

  test("design.constraints: false отключает файл, путь выбирает его, несколько файлов — спор", () => {
    const paths = ["a.cst", "b.cst"];
    expect(bindingSource({ format: 1, design: { constraints: false } }, paths)).toEqual({ kind: "pins" });
    expect(bindingSource({ format: 1, design: { constraints: "b.cst" } }, paths)).toEqual({
      kind: "cst",
      file: "b.cst",
    });
    expect(bindingSource({ format: 1 }, paths)).toEqual({ kind: "ambiguous", files: paths });
  });
});

describe("привязка из поля pins", () => {
  test("строки идут в порядке портов, такт — вход на тактовом выводе", () => {
    const binding = bindPins(board, ports, {
      "led[1]": { pin: 16 },
      clk: { pin: 4 },
      btn: { pin: 88, pull: "down" },
    });
    expect(binding.rows.map((r) => [r.name, r.pin, r.pull])).toEqual([
      ["clk", 4, "none"],
      ["btn", 88, "down"],
      ["led[0]", null, "none"],
      ["led[1]", 16, "none"],
      ["led[2]", null, "none"],
    ]);
    expect(binding.pins).toEqual([
      { port: "clk", bit: 0, pin: 4, pull: "none" },
      { port: "btn", bit: 0, pin: 88, pull: "down" },
      { port: "led", bit: 1, pin: 16, pull: "none" },
    ]);
    expect(binding.clock).toEqual({ port: "clk", pin: 4, hz: 27_000_000 });
    expect(binding.problems).toEqual([]);
  });

  test("два порта на одном выводе: второй не привязывается, код PINS_PIN_TWICE", () => {
    const binding = bindPins(board, ports, { "led[0]": { pin: 73 }, "led[1]": { pin: 73 } });
    expect(binding.pins).toEqual([{ port: "led", bit: 0, pin: 73, pull: "none" }]);
    expect(binding.problems).toEqual([{ code: "PINS_PIN_TWICE", severity: "error", name: "led[1]", pin: 73 }]);
  });

  test("выводы 59–62 запретные: привязка остаётся, есть предупреждение PIN_FORBIDDEN", () => {
    for (const pin of [59, 60, 61, 62]) {
      const binding = bindPins(board, ports, { "led[0]": { pin } });
      expect(binding.pins).toHaveLength(1);
      expect(binding.problems).toEqual([{ code: "PIN_FORBIDDEN", severity: "warning", name: "led[0]", pin }]);
    }
  });

  test("нет вывода у платы, нет порта у схемы", () => {
    const binding = bindPins(board, ports, { clk: { pin: 999 }, nope: { pin: 74 }, "led[7]": { pin: 75 } });
    expect(binding.pins).toEqual([]);
    expect(binding.problems.map((p) => p.code)).toEqual(["PINS_NO_PIN", "PINS_NO_PORT", "PINS_NO_PORT"]);
  });

  test("имя бита разбирается как у сервера: clk[0] у одноразрядного порта, led[01]", () => {
    const binding = bindPins(board, ports, { "clk[0]": { pin: 4 }, "led[01]": { pin: 16 }, led: { pin: 17 } });
    expect(binding.pins).toEqual([
      { port: "clk", bit: 0, pin: 4, pull: "none" },
      { port: "led", bit: 1, pin: 16, pull: "none" },
    ]);
    expect(binding.clock?.port).toBe("clk");
    // A multi-bit port without a bit index is not bound.
    expect(binding.problems).toEqual([{ code: "PINS_NO_PORT", severity: "error", name: "led", pin: 17 }]);
  });

  test("запись неверного вида в pins пропускается без сбоя", () => {
    const field = { clk: null, btn: { pin: "88" }, "led[0]": { pin: 15 } } as unknown as Record<
      string,
      { pin: number }
    >;
    expect(bindPins(board, ports, field).pins).toEqual([{ port: "led", bit: 0, pin: 15, pull: "none" }]);
  });

  test("порт с убывающими номерами разрядов: имя бита — как в схеме", () => {
    const reversed: ResolvedPort[] = [{ name: "d", dir: "out", width: 2, msb: 0, lsb: 1 }];
    const binding = bindPins(board, reversed, { "d[0]": { pin: 73 } });
    expect(binding.rows.map((r) => [r.name, r.bit, r.pin])).toEqual([
      ["d[1]", 0, null],
      ["d[0]", 1, 73],
    ]);
  });
});

describe("выгрузка в .cst", () => {
  const field = { "led[1]": { pin: 16 }, clk: { pin: 4 }, btn: { pin: 88, pull: "down" as const } };

  test("пара IO_LOC и IO_PORT на бит, порядок по имени порта и номеру бита", () => {
    expect(toCst(board, bindPins(board, ports, field).rows)).toBe(
      [
        'IO_LOC "btn" 88;',
        'IO_PORT "btn" IO_TYPE=LVCMOS33 PULL_MODE=DOWN;',
        'IO_LOC "clk" 4;',
        'IO_PORT "clk" IO_TYPE=LVCMOS33 PULL_MODE=NONE;',
        'IO_LOC "led[1]" 16;',
        'IO_PORT "led[1]" IO_TYPE=LVCMOS33 PULL_MODE=NONE;',
        "",
      ].join("\n"),
    );
  });

  test("IO_TYPE — стандарт вывода из файла платы: банк 1,8 В у Tang Nano 9K", () => {
    const nano9k = boardById("tang-nano-9k");
    if (!nano9k) throw new Error("нет файла платы 9K");
    const pins = { clk: { pin: 52 }, btn: { pin: 3, pull: "up" as const }, "led[0]": { pin: 10 } };
    expect(toCst(nano9k, bindPins(nano9k, ports, pins).rows)).toBe(
      [
        'IO_LOC "btn" 3;',
        'IO_PORT "btn" IO_TYPE=LVCMOS18 PULL_MODE=UP;',
        'IO_LOC "clk" 52;',
        'IO_PORT "clk" IO_TYPE=LVCMOS33 PULL_MODE=NONE;',
        'IO_LOC "led[0]" 10;',
        'IO_PORT "led[0]" IO_TYPE=LVCMOS18 PULL_MODE=NONE;',
        "",
      ].join("\n"),
    );
  });

  test("плата проекта — поле board файла fpgasim.json, без поля — плата по умолчанию", () => {
    expect(filesBoard([{ path: "fpgasim.json", content: '{"format":1,"board":"tang-nano-9k"}' }])).toBe("tang-nano-9k");
    expect(filesBoard([{ path: "top.v", content: "" }])).toBe("tang-nano-20k");
    expect(filesBoard([{ path: "fpgasim.json", content: "{" }])).toBe("tang-nano-20k");
    expect(configBoard({ format: 1, board: 9 })).toBe("tang-nano-20k");
  });

  test("привязка, прочитанная из ответа сервера, совпадает с привязкой из pins", () => {
    const local = bindPins(board, ports, field);
    const fromServer = bindResolved(board, { ports, pins: local.pins, clock: local.clock });
    expect(fromServer.pins).toEqual(local.pins);
    expect(fromServer.clock).toEqual(local.clock);
  });

  test("имя файла: верхний модуль, при занятом имени — с номером", () => {
    expect(cstFileName("top", ["top.v"])).toBe("top.cst");
    expect(cstFileName("top", ["top.cst"])).toBe("top_2.cst");
    expect(cstFileName(undefined, [])).toBe("pins.cst");
  });
});

describe("детали", () => {
  const config = {
    format: 1,
    boardParts: { s1: { settings: { bounceMs: 5 } }, led5: { enabled: false } },
    parts: [
      { id: "led_ext1", type: "led", pins: { in: 73 }, settings: { color: "green" }, position: { x: 1, y: 0 } },
      { id: "sw1", type: "switch", pins: { out: 74 } },
      { id: "s1", type: "button", pins: { out: 75 } },
    ],
  };

  test("встроенные детали получают изменения, детали макетки — клетки; занятое имя не идёт", () => {
    const items = projectParts(board, config);
    expect(items.find((p) => p.id === "s1")).toMatchObject({
      origin: "board",
      settings: { activeLevel: 1, key: "1", bounceMs: 5 },
    });
    expect(items.find((p) => p.id === "led5")?.enabled).toBe(false);
    expect(items.filter((p) => p.origin === "breadboard").map((p) => [p.id, p.position])).toEqual([
      ["led_ext1", { x: 1, y: 0 }],
      ["sw1", { x: 0, y: 0 }],
    ]);
  });

  test("configure: выключенная деталь не идёт, детали макетки идут после встроенных со своими сетями", () => {
    const binding = bindPins(board, ports, { "led[0]": { pin: 73 } });
    const message = makeConfigure(board, binding, projectParts(board, config), ["led", "button", "switch"]);
    const ids = message.parts.map((p) => p.id);
    expect(ids).not.toContain("led5");
    expect(ids.slice(-2)).toEqual(["led_ext1", "sw1"]);
    expect(message.parts.find((p) => p.id === "s1")?.settings).toMatchObject({ bounceMs: 5 });
    expect(message.nets.filter((n) => n.pin === 73)).toEqual([{ pin: 73, port: "led", bit: 0, pull: "none" }]);
    expect(message.nets.map((n) => n.pin)).toContain(74);
    expect(message.nets.map((n) => n.pin)).not.toContain(20); // the pin of the disabled LED5
  });

  test("смена одних настроек детали не требует configure; смена вывода требует", () => {
    const binding = bindPins(board, ports, {});
    const types = ["led", "button", "switch"];
    const before = makeConfigure(board, binding, projectParts(board, config), types);
    const bounce = { ...config, boardParts: { ...config.boardParts, s1: { settings: { bounceMs: 9 } } } };
    expect(settingsOnly(before, makeConfigure(board, binding, projectParts(board, bounce), types))).toEqual(["s1"]);
    const moved = { ...config, parts: [{ id: "led_ext1", type: "led", pins: { in: 86 } }] };
    expect(settingsOnly(before, makeConfigure(board, binding, projectParts(board, moved), types))).toBeNull();
  });

  test("деталь неверного вида из файла пропускается; клетка вне поля заменяется свободной", () => {
    const broken = {
      format: 1,
      boardParts: { s1: null, led0: { settings: 5 } },
      parts: [
        null,
        { id: "a", type: "led" },
        { id: "b", type: "led", pins: { in: "73" } },
        { id: "far", type: "led", pins: { in: 73 }, position: { x: 0, y: 100000000 }, settings: 7 },
      ],
    } as unknown as Parameters<typeof projectParts>[1];
    const items = projectParts(board, broken);
    expect(items.filter((p) => p.origin === "breadboard")).toEqual([
      {
        id: "far",
        type: "led",
        label: "far",
        pins: { in: 73 },
        settings: {},
        origin: "breadboard",
        enabled: true,
        position: { x: 0, y: 0 },
      },
    ]);
    expect(items.find((p) => p.id === "s1")?.enabled).toBe(true);
  });

  test("свободная клетка и имя новой детали", () => {
    expect(freeCell([])).toEqual({ x: 0, y: 0 });
    expect(freeCell([{ id: "a", type: "led", pins: {}, position: { x: 0, y: 0 } }])).toEqual({ x: 1, y: 0 });
    expect(nextPartId("led", ["led0", "led1"])).toBe("led2");
    expect(partIdProblem("", [])).toBe("empty");
    expect(partIdProblem("a-b", [])).toBe("bad");
    expect(partIdProblem("s1", ["s1"])).toBe("exists");
    expect(partIdProblem("led_ext1", ["s1"])).toBeNull();
  });
});

describe("форма настроек по описанию детали", () => {
  const button = partDescription("button");
  const led = partDescription("led");

  test("умолчания берутся из описания", () => {
    expect(withDefaults(button, { bounceMs: 5 })).toEqual({ activeLevel: 1, key: "", bounceMs: 5, idle: "release" });
  });

  test("значение проверяется по типу, списку и границам", () => {
    const bounce = button?.settings.bounceMs;
    const level = button?.settings.activeLevel;
    const key = button?.settings.key;
    const color = led?.settings.color;
    if (!bounce || !level || !key || !color) throw new Error("нет описания настройки");
    expect(settingProblem(bounce, 5)).toBeNull();
    expect(settingProblem(bounce, 2.5)).toBeNull();
    expect(settingProblem(bounce, 21)).toBe("maximum");
    expect(settingProblem(bounce, -1)).toBe("minimum");
    expect(settingProblem(bounce, settingFromText(bounce, ""))).toBe("type");
    // A number is entered by characters: unfinished input does not turn into another number.
    expect(settingValue(bounce, "0.")).toBe(0);
    expect(settingValue(bounce, "0.5")).toBe(0.5);
    expect(settingProblem(bounce, settingValue(bounce, "-"))).toBe("type");
    expect(settingProblem(bounce, settingValue(bounce, "5x"))).toBe("type");
    expect(settingValue(key, "1")).toBe("1");
    expect(settingFromText(bounce, "2,5")).toBe(2.5);
    expect(settingProblem(level, 2)).toBe("enum");
    expect(settingProblem(level, settingFromText(level, "0"))).toBeNull();
    expect(settingProblem(key, "ab")).toBe("maxLength");
    expect(settingProblem(color, "pink")).toBe("enum");
    expect(settingProblem(color, "green")).toBeNull();
  });
});

describe("параметры и макросы в диалоге настроек", () => {
  test("параметры: число остаётся числом, строка — строкой", () => {
    expect(parsePairs("WIDTH = 8\nNAME=abc\n\n", "parameters")).toEqual({ WIDTH: 8, NAME: "abc" });
    expect(parsePairs("WIDTH", "parameters")).toBeNull();
    // A string parameter of digits stays a string after display in the dialog and on write.
    expect(printPairs({ WIDTH: 8, CODE: "8" }, "parameters")).toBe('WIDTH = 8\nCODE = "8"');
    expect(parsePairs(printPairs({ WIDTH: 8, CODE: "8" }, "parameters"), "parameters")).toEqual({
      WIDTH: 8,
      CODE: "8",
    });
    expect(parsePairs("8 = 1", "parameters")).toBeNull();
  });

  test("макросы: имя без значения — true", () => {
    expect(parsePairs("FAST\nDEPTH = 16", "defines")).toEqual({ FAST: true, DEPTH: "16" });
    expect(printPairs({ FAST: true, DEPTH: "16" }, "defines")).toBe("FAST\nDEPTH = 16");
  });
});
