// Dictionary, build message display, configure assembly, examples.
import { existsSync } from "node:fs";
import { describe, expect, test } from "vitest";
import type { Diagnostic, ResolvedPin } from "../build/types";
import { fill, t, tOr } from "../i18n";
import { boardById, listExamples } from "../project/assets";
import { projectParts } from "../project/config";
import { makeConfigure } from "../sim/configure";
import { diagnosticLevel, diagnosticText, visibleDiagnostics } from "./diagnostics";
import { simSeconds } from "./format";
import { HELP_SECTIONS } from "./HelpDialog";
import shotSizes from "./helpShots.json";

const diagnostic = (fields: Partial<Diagnostic>): Diagnostic => ({
  source: "verilator",
  severity: "warning",
  code: "X",
  original: "original text",
  ...fields,
});

describe("справка", () => {
  test("у каждого снимка есть файлы обеих тем, размер и подпись", () => {
    const shots = HELP_SECTIONS.flatMap(([, , list]) => list);
    expect([...shots].sort()).toEqual(Object.keys(shotSizes).sort());
    for (const shot of shots) {
      for (const theme of ["light", "dark"]) {
        expect(existsSync(new URL(`../../public/help/${shot}-${theme}.png`, import.meta.url)), `${shot}-${theme}`).toBe(
          true,
        );
      }
      expect(t(`help.shot.${shot}`)).not.toBe(`help.shot.${shot}`);
    }
  });
});

describe("словарь", () => {
  test("подстановка аргументов", () => {
    expect(t("key.ok", { owner: "taras" })).toBe("Ключ: taras");
    expect(fill("{a} и {b}", { a: 1, b: ["x", "y"] })).toBe("1 и x, y");
  });

  test("имя без значения остаётся как есть", () => {
    expect(fill("вывод {pin}", {})).toBe("вывод {pin}");
  });

  test("неизвестный ключ заменяется запасным", () => {
    expect(tOr("error.BUSY", "error.UNKNOWN")).toBe(t("error.BUSY"));
    expect(tOr("error.NO_SUCH", "error.UNKNOWN", { code: "C", text: "T" })).toBe("C: T");
  });
});

describe("сообщения сборки", () => {
  test("текст берётся из таблицы с подстановкой из args", () => {
    expect(diagnosticText(diagnostic({ code: "CST_NO_PIN", args: { pin: 99 } }))).toBe("У платы нет вывода `99`");
  });

  test("неизвестный код показывается исходным текстом как заметка", () => {
    const d = diagnostic({ code: "NO_SUCH_CODE" });
    expect(diagnosticText(d)).toBe("original text");
    expect(diagnosticLevel(d)).toBe("note");
  });

  test("ошибка показывается всегда, скрытые предупреждения убираются, ошибки идут первыми", () => {
    const list = [
      diagnostic({ code: "DECLFILENAME" }),
      diagnostic({ code: "BLKSEQ" }),
      diagnostic({ code: "DECLFILENAME", severity: "error" }),
    ];
    expect(visibleDiagnostics(list).map((d) => [d.code, diagnosticLevel(d)])).toEqual([
      ["DECLFILENAME", "error"],
      ["BLKSEQ", "important"],
    ]);
  });
});

describe("configure", () => {
  const board = boardById("tang-nano-20k");
  // The binding in the form the server returns it (resolved.pins and resolved.clock).
  const pins: ResolvedPin[] = [
    { port: "clk", bit: 0, pin: 4, pull: "none" },
    { port: "led", bit: 0, pin: 15, pull: "none" },
  ];
  const resolved = { clock: { port: "clk", pin: 4, hz: 27_000_000 }, pins };

  test("сети портов идут первыми, выводы деталей добавляются без повторов", () => {
    if (!board) throw new Error("нет файла платы");
    const message = makeConfigure(board, resolved, projectParts(board, null), ["led", "button"]);
    expect(message.clock).toEqual({ port: "clk", hz: 27_000_000 });
    expect(message.nets.slice(0, 2)).toEqual([
      { pin: 4, port: "clk", bit: 0, pull: "none" },
      { pin: 15, port: "led", bit: 0, pull: "none" },
    ]);
    const pins = message.nets.map((n) => n.pin);
    expect(new Set(pins).size).toBe(pins.length);
    expect(pins).toContain(88); // button S1
    expect(message.parts.map((p) => p.type).sort()).toEqual([
      "button",
      "button",
      "led",
      "led",
      "led",
      "led",
      "led",
      "led",
    ]);
  });

  test("детали, типов которых нет в ядре, не идут; схема без такта даёт clock: null", () => {
    if (!board) throw new Error("нет файла платы");
    const message = makeConfigure(board, { pins: [], clock: null }, projectParts(board, null), ["led"]);
    expect(message.clock).toBeNull();
    expect(message.parts.every((p) => p.type === "led")).toBe(true);
    expect(message.nets.map((n) => n.pin)).not.toContain(88);
  });
});

test("пример blink3 входит в статику без expect.json", () => {
  const blink = listExamples().find((e) => e.name === "blink3");
  expect(blink?.files.map((f) => f.path)).toEqual(["tb_top.v", "top.cst", "top.v"]);
  expect(blink?.files[2]?.content).toContain("module top");
});

test("время симуляции показывается в секундах с тремя знаками", () => {
  expect(simSeconds("2104000000000")).toBe("2,104");
  expect(simSeconds(0n)).toBe("0,000");
});
