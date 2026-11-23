// Message table, layout, multipliers and steps, file names, board drawing, widgets, examples.
import { describe, expect, test } from "vitest";
import { boardContacts, boardExtent, fitBoard, pinState } from "../board/layout";
import { commonPrefix } from "../board/scene";
import { ButtonWidget } from "../parts/button";
import { ledBrightness, ledLevel, smoothBrightness } from "../parts/led";
import { boardById, diagnosticCodes, diagnosticEntry, listExamples, partDescription } from "../project/assets";
import type { LiveNet } from "../sim/host";
import { assistantLayout, DEFAULT_LAYOUT, parseLayout, resizeLayout, toggleArea } from "./layout";
import { SPEEDS, filePathProblem, parseSpeed, speedLabel, stepCommand } from "./speed";

// Codes of the table in spec section 7.6 that have a short text (levels "important" and "notice").
const TABLE_7_6 = [
  "BLKSEQ",
  "COMBDLY",
  "LATCH",
  "WIDTHTRUNC",
  "WIDTH",
  "WIDTHEXPAND",
  "IMPLICIT",
  "UNDRIVEN",
  "UNUSEDSIGNAL",
  "UNUSED",
  "UNUSEDPARAM",
  "MULTIDRIVEN",
  "CASEINCOMPLETE",
  "CASEOVERLAP",
  "PINMISSING",
  "PINCONNECTEMPTY",
  "UNOPTFLAT",
  "SYNCASYNCNET",
  "SELRANGE",
  "CMPCONST",
  "UNSIGNED",
  "STMTDLY",
  "ASSIGNDLY",
  "INITIALDLY",
  "MULTITOP",
  "PROCASSWIRE",
  "CST_IO_TYPE",
  "DEVICE_NOT_MODELED",
];
const HIDDEN_7_6 = [
  "DECLFILENAME",
  "EOFNEWLINE",
  "GENUNNAMED",
  "VARHIDDEN",
  "TIMESCALEMOD",
  "UNUSEDGENVAR",
  "PINNOCONNECT",
  "IMPORTSTAR",
  "PROCASSINIT",
];

describe("таблица сообщений spec/diagnostics.json", () => {
  test.each(TABLE_7_6)("код %s из раздела 7.6 имеет краткий текст и пояснение", (code) => {
    const entry = diagnosticEntry(code);
    expect(entry?.level === "important" || entry?.level === "note").toBe(true);
    const text = entry?.text?.ru ?? "";
    const explain = entry?.explain?.ru ?? "";
    expect(text.length).toBeGreaterThan(10);
    // The explanation is two or three sentences, not a repeat of the short text.
    expect(explain.length).toBeGreaterThan(60);
    expect(explain).not.toBe(text);
  });

  test.each(HIDDEN_7_6)("код %s из раздела 7.6 скрыт", (code) => {
    expect(diagnosticEntry(code)?.level).toBe("hidden");
  });

  test("пояснение есть у каждого кода, который показывается", () => {
    const missing = diagnosticCodes().filter((code) => {
      const entry = diagnosticEntry(code);
      return entry?.level !== "hidden" && !entry?.explain?.ru;
    });
    expect(missing).toEqual([]);
  });
});

describe("раскладка рабочего места", () => {
  test("сохранённое значение разбирается, неверное заменяется значениями по умолчанию", () => {
    expect(parseLayout(null)).toEqual(DEFAULT_LAYOUT);
    expect(parseLayout("не JSON")).toEqual(DEFAULT_LAYOUT);
    expect(parseLayout('{"files":200,"board":"x","collapsed":{"board":true}}')).toEqual({
      ...DEFAULT_LAYOUT,
      files: 200,
      collapsed: { files: false, editor: false, board: true },
    });
  });

  test("размер области ограничен, область сворачивается и разворачивается", () => {
    expect(resizeLayout(DEFAULT_LAYOUT, "files", 5).files).toBe(110);
    expect(resizeLayout(DEFAULT_LAYOUT, "bottom", 333.4).bottom).toBe(333);
    // The window sets the upper limit: the editor keeps some space.
    const narrow = { width: 1000, height: 700 };
    expect(resizeLayout(DEFAULT_LAYOUT, "board", 1100, narrow).board).toBe(1000 - DEFAULT_LAYOUT.files - 240);
    expect(resizeLayout(DEFAULT_LAYOUT, "bottom", 700, narrow).bottom).toBe(460);
    const collapsed = toggleArea(DEFAULT_LAYOUT, "editor");
    expect(collapsed.collapsed.editor).toBe(true);
    expect(toggleArea(collapsed, "editor")).toEqual(DEFAULT_LAYOUT);
    expect(parseLayout(JSON.stringify(collapsed))).toEqual(collapsed);
  });

  test("вкладка «Помощник» поднимает низкую нижнюю панель", () => {
    expect(assistantLayout(DEFAULT_LAYOUT, { width: 1400, height: 840 }).bottom).toBe(378);
    expect(assistantLayout(DEFAULT_LAYOUT, { width: 1400, height: 720 }).bottom).toBe(324);
    // The panel only grows: a higher panel stays, and so does the panel of a low window.
    const high = { ...DEFAULT_LAYOUT, bottom: 500 };
    expect(assistantLayout(high, { width: 1400, height: 840 })).toBe(high);
    expect(assistantLayout(DEFAULT_LAYOUT, { width: 1400, height: 400 })).toBe(DEFAULT_LAYOUT);
  });
});

describe("множители скорости и шаги", () => {
  test("список множителей — из раздела 5.3 ТЗ", () => {
    expect(SPEEDS).toEqual(["max", 1, 0.5, 0.1, 0.01, 1e-3, 1e-4, 1e-5, 1e-6]);
    expect(speedLabel(0.1)).toBe("0,1×");
    expect(speedLabel(1e-6)).toBe("0,000001×");
  });

  test("произвольный множитель: положительное число с точкой или запятой", () => {
    expect(parseSpeed("0,25")).toBe(0.25);
    expect(parseSpeed(" 3.5 ")).toBe(3.5);
    expect(parseSpeed("0")).toBeNull();
    expect(parseSpeed("-1")).toBeNull();
    expect(parseSpeed("быстро")).toBeNull();
  });

  test("команда step по выбору в меню", () => {
    expect(stepCommand("cycle1", "")).toEqual({ unit: "cycle", count: 1 });
    expect(stepCommand("cycle100", "")).toEqual({ unit: "cycle", count: 100 });
    expect(stepCommand("change", "")).toEqual({ unit: "change" });
    expect(stepCommand("time", "1,5")).toEqual({ unit: "time", ps: "1500000000" });
    expect(stepCommand("time", "0")).toBeNull();
    expect(stepCommand("time", "")).toBeNull();
  });
});

describe("имя файла проекта", () => {
  test("допустимые и недопустимые имена", () => {
    expect(filePathProblem("uart_tx.v", [])).toBeNull();
    expect(filePathProblem("rtl/top.sv", [])).toBeNull();
    expect(filePathProblem("", [])).toBe("empty");
    expect(filePathProblem("../top.v", [])).toBe("bad");
    expect(filePathProblem("/top.v", [])).toBe("bad");
    expect(filePathProblem("мой файл.v", [])).toBe("bad");
    expect(filePathProblem("top.v", ["top.v"])).toBe("exists");
  });
});

const net = (fields: Partial<LiveNet>): LiveNet => ({
  pin: 15,
  port: "led",
  bit: 0,
  name: "led[0]",
  level: 0,
  flags: 1,
  toggles: 0,
  duty: 0,
  rate: 0,
  ...fields,
});

describe("светодиод", () => {
  test("яркость — доля времени в активном уровне", () => {
    expect(ledBrightness(1, net({ duty: 0.25 }))).toBe(0.25);
    expect(ledBrightness(0, net({ duty: 0.25 }))).toBe(0.75);
  });

  test("сетью никто не управляет — светодиод не горит", () => {
    expect(ledBrightness(0, net({ flags: 0, duty: 0 }))).toBe(0);
    expect(ledBrightness(0, net({ flags: 8, duty: 0 }))).toBe(0);
    expect(ledBrightness(0, undefined)).toBe(0);
  });

  test("на паузе светодиод показывает мгновенный уровень вывода", () => {
    // A frame after a long step: the pin was high almost all the time, and went low at the end.
    const afterStep = net({ level: 0, duty: 0.999 });
    expect(ledLevel(0, afterStep)).toBe(1);
    expect(ledLevel(1, afterStep)).toBe(0);
    expect(ledLevel(0, net({ level: 0, flags: 0 }))).toBe(0);
  });

  test("показ сглаживается с постоянной времени 30 мс", () => {
    expect(smoothBrightness(0, 1, 30)).toBeCloseTo(1 - Math.exp(-1), 6);
    expect(smoothBrightness(0, 1, 300)).toBeGreaterThan(0.9999);
    expect(smoothBrightness(0.4, 1, 0)).toBe(0.4);
  });
});

describe("кнопка", () => {
  const key = (type: string, k: string, repeat = false) => ({ type, key: k, repeat }) as KeyboardEvent;
  const make = () => {
    const widget = new ButtonWidget();
    widget.layout({ settings: { key: "1" } });
    const sent: string[] = [];
    return { widget, sent, send: (cmd: string) => void sent.push(cmd) };
  };

  test("клавиша нажимает и отпускает; повтор клавиши и чужая клавиша пропускаются", () => {
    const { widget, sent, send } = make();
    widget.onKey(key("keydown", "1"), send);
    widget.onKey(key("keydown", "1", true), send);
    widget.onKey(key("keydown", "2"), send);
    widget.onKey(key("keyup", "1"), send);
    expect(sent).toEqual(["press", "release"]);
  });

  test("мышь нажимает и отпускает", () => {
    const { widget, sent, send } = make();
    widget.onPointer({ kind: "down", shift: false }, send);
    widget.onPointer({ kind: "up", shift: false }, send);
    expect(sent).toEqual(["press", "release"]);
  });

  test("щелчок с Shift фиксирует нажатие, следующий щелчок отпускает", () => {
    const { widget, sent, send } = make();
    widget.onPointer({ kind: "down", shift: true }, send);
    widget.onPointer({ kind: "up", shift: true }, send);
    expect(sent).toEqual(["press"]);
    widget.onPointer({ kind: "down", shift: false }, send);
    widget.onPointer({ kind: "up", shift: false }, send);
    expect(sent).toEqual(["press", "release"]);
  });

  test("отпускание с зажатым Shift узнаётся по месту клавиши", () => {
    const { widget, sent, send } = make();
    widget.onKey(key("keydown", "1"), send);
    widget.onKey({ type: "keyup", key: "!", code: "Digit1", repeat: false } as KeyboardEvent, send);
    expect(sent).toEqual(["press", "release"]);
  });

  test("потеря фокуса окна отпускает клавишу и мышь, фиксация остаётся", () => {
    const { widget, sent, send } = make();
    widget.onKey(key("keydown", "1"), send);
    widget.drop(send);
    expect(sent).toEqual(["press", "release"]);
    widget.onPointer({ kind: "down", shift: true }, send);
    widget.drop(send);
    expect(sent).toEqual(["press", "release", "press"]);
  });

  test("после сброса симуляции виджет не считает кнопку нажатой", () => {
    const { widget, sent, send } = make();
    widget.onPointer({ kind: "down", shift: true }, send);
    widget.reset();
    // The core released the button itself: the next click presses again, rather than "releases".
    widget.onPointer({ kind: "down", shift: false }, send);
    expect(sent).toEqual(["press", "press"]);
  });

  test("мышь и клавиша вместе: отпускание идёт, когда отпущены обе", () => {
    const { widget, sent, send } = make();
    widget.onKey(key("keydown", "1"), send);
    widget.onPointer({ kind: "down", shift: false }, send);
    widget.onKey(key("keyup", "1"), send);
    expect(sent).toEqual(["press"]);
    widget.onPointer({ kind: "up", shift: false }, send);
    expect(sent).toEqual(["press", "release"]);
  });
});

describe("чертёж платы Tang Nano 20K", () => {
  const board = boardById("tang-nano-20k");
  if (!board) throw new Error("нет файла платы");

  test("контакты гребёнок стоят по шагу из geometry, выводы не повторяются", () => {
    const contacts = boardContacts(board);
    expect(contacts).toHaveLength(40);
    const first = contacts[0];
    const last = contacts[19];
    expect(first).toMatchObject({ side: "left", pin: 73, x: 1.3, y: 2.9 });
    expect(last?.power).toBe("GND");
    expect(last?.y).toBeCloseTo(2.9 + 19 * 2.54, 6);
    const pins = contacts.flatMap((c) => (c.pin === null ? [] : [c.pin]));
    expect(new Set(pins).size).toBe(pins.length);
    // Every comb pin is described in the board pin table.
    expect(pins.filter((pin) => !board.pins[String(pin)])).toEqual([]);
  });

  test("детали платы лежат внутри контура", () => {
    for (const part of board.parts) {
      expect(part.geometry.x).toBeGreaterThan(0);
      expect(part.geometry.x).toBeLessThan(board.geometry.width);
      expect(part.geometry.y).toBeGreaterThan(0);
      expect(part.geometry.y).toBeLessThan(board.geometry.height);
    }
  });

  test("чертёж вписывается в область целиком", () => {
    const extent = boardExtent(board);
    const fit = fitBoard(extent, 440, 500);
    expect(fit.dx + extent.x * fit.scale).toBeGreaterThanOrEqual(0);
    expect(fit.dx + (extent.x + extent.w) * fit.scale).toBeLessThanOrEqual(440.001);
    expect(fit.dy + (extent.y + extent.h) * fit.scale).toBeLessThanOrEqual(500.001);
  });

  test("состояние вывода: запретный важнее занятого, занятый важнее состояния из файла", () => {
    expect(pinState(board, 73, false)).toBe("free");
    expect(pinState(board, 73, true)).toBe("busy");
    expect(pinState(board, 59, true)).toBe("forbidden");
    expect(pinState(board, 4, false)).toBe("clock");
    expect(pinState(board, 999, false)).toBe("unknown");
  });

  test("общее начало подписей в ряду деталей", () => {
    expect(commonPrefix(["LED0", "LED1", "LED5"])).toBe(3);
    expect(commonPrefix(["S1", "S2"])).toBe(1);
    expect(commonPrefix(["A", "A"])).toBe(0);
    expect(commonPrefix(["UART", "WS2812"])).toBe(0);
  });

  test("у типов встроенных деталей есть описания", () => {
    for (const part of board.parts) expect(partDescription(part.type)?.type).toBe(part.type);
  });
});

describe("примеры этапа 5", () => {
  test("pwm_fade и shift_chain входят в список примеров", () => {
    const names = listExamples().map((e) => e.name);
    expect(names).toContain("pwm_fade");
    expect(names).toContain("shift_chain");
  });
});
