// Waveform model, VCD, radixes, the signal tree, the view window, record settings.
import { describe, expect, it } from "vitest";
import icarusBlink3 from "./testdata/icarus_blink3.vcd?raw";
import type { ProjectConfig } from "../project/config";
import type { SignalInfo } from "../sim/messages";
import type { Trace } from "../sim/protocol";
import { changeRecord, changeWatch, recordSettings, triggerEdges, watchItems } from "./config";
import { formatValue, wordsToBigInt } from "./format";
import { indexAt, modelChanges, modelFromTraces, signalChanges, valueAt, type WaveModel } from "./model";
import { treeRows } from "./tree";
import { parseVcd, vcdPath, writeVcd } from "./vcd";
import { fitView, panView, segments, tickStep, timeAtX, xAtTime, zoomView } from "./view";

const INFO = [
  { index: 0, name: "top.cnt", width: 40 },
  { index: 1, name: "pin:15", width: 1 },
];

// Two TRACE messages: the second starts with the values of all signals at its start.
const TRACES: Trace[] = [
  {
    record: 3,
    fromPs: 1000n,
    toPs: 3000n,
    changes: [
      { timePs: 1000n, index: 0, words: [5, 0] },
      { timePs: 1000n, index: 1, words: [1] },
      { timePs: 1000n, index: 0, words: [6, 0] },
      { timePs: 2000n, index: 0, words: [0xffffffff, 0xff] },
      { timePs: 2500n, index: 1, words: [0] },
    ],
  },
  {
    record: 3,
    fromPs: 3000n,
    toPs: 5000n,
    changes: [
      { timePs: 3000n, index: 0, words: [0xffffffff, 0xff] },
      { timePs: 3000n, index: 1, words: [0] },
      { timePs: 4000n, index: 1, words: [1] },
    ],
  },
];

const model = (): WaveModel => modelFromTraces(INFO, TRACES);

describe("модель из сообщений TRACE", () => {
  it("значения на начало участка не считаются изменениями; начало следующих сообщений пропускается", () => {
    const m = model();
    expect([m.fromPs, m.toPs]).toEqual([1000, 5000]);
    const [cnt, pin] = m.signals;
    if (!cnt || !pin) throw new Error("нет сигналов");
    expect([...cnt.times]).toEqual([1000, 1000, 2000]);
    expect([valueAt(cnt, 0), valueAt(cnt, 1), valueAt(cnt, 2)]).toEqual([5n, 6n, 0xffffffffffn]);
    expect([...pin.times]).toEqual([1000, 2500, 4000]);
    expect([signalChanges(cnt), signalChanges(pin), modelChanges(m)]).toEqual([2, 2, 4]);
  });

  it("поиск записи по времени", () => {
    const pin = model().signals[1];
    if (!pin) throw new Error("нет сигнала");
    expect([0, 1000, 2499, 2500, 3999, 4000, 9000].map((t) => indexAt(pin, t))).toEqual([0, 0, 0, 1, 1, 2, 2]);
  });

  it("запись без сообщений даёт пустую модель", () => {
    const m = modelFromTraces(INFO, []);
    expect(modelChanges(m)).toBe(0);
    expect(m.signals.map((s) => s.times.length)).toEqual([1, 1]);
  });
});

describe("VCD", () => {
  it("выгрузка: шаг 1 пс, области по точкам, вывод платы в области pins", () => {
    const text = writeVcd(model());
    expect(text).toBe(
      [
        "$version FPGA SIM $end",
        "$timescale 1ps $end",
        "$scope module top $end",
        "$var wire 40 ! cnt [39:0] $end",
        "$upscope $end",
        "$scope module pins $end",
        '$var wire 1 " pin15 $end',
        "$upscope $end",
        "$enddefinitions $end",
        "#1000",
        "$dumpvars",
        "b101 !",
        '1"',
        "$end",
        "b110 !",
        "#2000",
        "b1111111111111111111111111111111111111111 !",
        "#2500",
        '0"',
        "#4000",
        '1"',
        "#5000",
        "",
      ].join("\n"),
    );
  });

  it("разбор собственной выгрузки возвращает те же изменения", () => {
    const source = model();
    const parsed = parseVcd(writeVcd(source));
    expect(parsed.source).toBe("vcd");
    expect([parsed.fromPs, parsed.toPs]).toEqual([1000, 5000]);
    expect(parsed.signals.map((s) => s.name)).toEqual(["top.cnt", "pins.pin15"]);
    expect(modelChanges(parsed)).toBe(modelChanges(source));
    parsed.signals.forEach((signal, i) => {
      const want = source.signals[i];
      expect([...signal.times]).toEqual([...(want?.times ?? [])]);
      expect([...signal.values]).toEqual([...(want?.values ?? [])]);
      expect(signal.width).toBe(want?.width);
    });
  });

  // The file was made by Icarus Verilog 12 in the build image on the testbench examples/blink3/tb_top.v.
  it("разбор настоящего файла Icarus: тестбенч blink3", () => {
    const parsed = parseVcd(icarusBlink3);
    expect([parsed.source, parsed.fromPs, parsed.toPs]).toEqual(["vcd", 0, 296304]);
    const names = parsed.signals.map((s) => s.name);
    expect(names).toEqual([
      "tb_top.led",
      "tb_top.CLK_HZ",
      "tb_top.clk",
      "tb_top.dut.clk",
      "tb_top.checks",
      "tb_top.errors",
      "tb_top.dut.led",
      "tb_top.dut.CLK_HZ",
      "tb_top.dut.cnt_a",
      "tb_top.dut.cnt_b",
      "tb_top.dut.cnt_c",
      "tb_top.dut.q",
      "tb_top.check.name",
      "tb_top.check.ok",
    ]);
    const signal = (name: string) => {
      const found = parsed.signals.find((s) => s.name === name);
      if (!found) throw new Error(name);
      return found;
    };
    // Clock 27 MHz: half period 18 519 ps, 16 toggles per file.
    const clk = signal("tb_top.clk");
    expect([clk.width, signalChanges(clk), clk.times[1], clk.times[2]]).toEqual([1, 16, 18519, 37038]);
    expect(signal("tb_top.dut.clk").times).toEqual(clk.times);
    // The parameter is written by a $dumpall block before the first time mark: it has no changes.
    const hz = signal("tb_top.CLK_HZ");
    expect([hz.width, signalChanges(hz), valueAt(hz, 0)]).toEqual([32, 0, 27_000_000n]);
    // LEDs: 111111 → 111000 at the counter boundary → 111100.
    const led = signal("tb_top.led");
    expect([...led.times]).toEqual([0, 92595, 129633]);
    expect([valueAt(led, 0), valueAt(led, 1), valueAt(led, 2)]).toEqual([0b111111n, 0b111000n, 0b111100n]);
    const cnt = signal("tb_top.dut.cnt_a");
    expect([cnt.width, valueAt(cnt, 2)]).toEqual([25, 13_499_998n]);
    expect(valueAt(cnt, indexAt(cnt, 100_000))).toBe(0n);
    // X bits (values before the first assignment) read as 0; a register wider than 32 bits is intact.
    const name = signal("tb_top.check.name");
    expect([name.width, name.words, valueAt(name, 0)]).toEqual([256, 8, 0n]);
    expect(valueAt(name, 1) & 0xffn).toBe(BigInt("n".charCodeAt(0)));
    // 61 value lines after the $dumpvars block; 16 clock toggles are written with one code for two signals.
    expect(modelChanges(parsed)).toBe(61 + 16);
  });

  it("разбор файла Icarus: шаг времени, вложенные области, X и Z, общий код, вещественные", () => {
    const parsed = parseVcd(`
      $date today $end
      $version Icarus Verilog $end
      $timescale 1ns $end
      $scope module tb $end
      $var wire 1 ! clk $end
      $var reg 4 " q [3:0] $end
      $var real 64 # r $end
      $scope module dut $end
      $var wire 1 ! clk $end
      $var wire 8 $ late [7:0] $end
      $upscope $end
      $upscope $end
      $enddefinitions $end
      $comment text with #5 and b1 $end
      #0
      $dumpvars
      0!
      bx "
      r1.5 #
      $end
      #5
      1!
      b1z1 "
      #10
      0!
      b101 "
      b11 $
      #15
    `);
    expect(parsed.signals.map((s) => s.name)).toEqual(["tb.clk", "tb.dut.clk", "tb.q", "tb.dut.late"]);
    const [clk, alias, q, late] = parsed.signals;
    if (!clk || !alias || !q || !late) throw new Error("нет сигналов");
    expect([...clk.times]).toEqual([0, 5000, 10000]);
    expect([...alias.times]).toEqual([...clk.times]);
    // X and Z read as 0; repeating the value 101 is not a change.
    expect([...q.times].map((t, i) => [t, valueAt(q, i)])).toEqual([
      [0, 0n],
      [5000, 5n],
    ]);
    // A signal without a value at the file start starts at zero.
    expect([...late.times].map((t, i) => [t, valueAt(late, i)])).toEqual([
      [0, 0n],
      [10000, 3n],
    ]);
    expect([parsed.fromPs, parsed.toPs]).toEqual([0, 15000]);
  });

  it("имена переменных", () => {
    expect(vcdPath("top.u_good.q")).toEqual(["top", "u_good", "q"]);
    expect(vcdPath("pin:73")).toEqual(["pins", "pin73"]);
    expect(vcdPath("alone")).toEqual(["top", "alone"]);
  });
});

describe("системы счисления", () => {
  it("слова в число", () => {
    expect(wordsToBigInt([1, 2])).toBe(0x200000001n);
    expect(wordsToBigInt([0xffffffff])).toBe(0xffffffffn);
    expect(wordsToBigInt([7, 8, 9], 1, 1)).toBe(8n);
  });

  it("запись значения", () => {
    expect(formatValue(1000n, 25, "dec")).toBe("1000");
    expect(formatValue(1000n, 25, "hex")).toBe("00003E8");
    expect(formatValue(5n, 4, "bin")).toBe("0101");
    expect(formatValue(0xfn, 4, "sdec")).toBe("-1");
    expect(formatValue(7n, 4, "sdec")).toBe("7");
    expect(formatValue(1n, 1, "hex")).toBe("1");
  });
});

describe("дерево сигналов", () => {
  const signals: SignalInfo[] = [
    { sig: 0, path: "top.clk", width: 1, kind: "port" },
    { sig: 1, path: "top.cnt_a", width: 25, kind: "reg" },
    { sig: 2, path: "top.u_good.q", width: 3, kind: "reg" },
    { sig: 3, path: "top.u_rx.mem", width: 8, kind: "memory", depth: 16 },
  ];
  const pins = [
    { pin: 4, port: "clk" },
    { pin: 73, port: null },
  ];
  const keys = (search: string, closed: string[] = []): string[] =>
    treeRows(signals, pins, search, new Set(closed), "Выводы").map((r) => `${"  ".repeat(r.depth)}${r.label}`);

  it("группы по точкам пути и выводы платы", () => {
    expect(keys("")).toEqual([
      "top",
      "  clk",
      "  cnt_a",
      "  u_good",
      "    q",
      "  u_rx",
      "    mem",
      "Выводы",
      "  pin:4",
      "  pin:73",
    ]);
  });

  it("свёрнутая группа скрывает свои строки", () => {
    expect(keys("", ["top.u_good", "pin:"])).toEqual([
      "top",
      "  clk",
      "  cnt_a",
      "  u_good",
      "  u_rx",
      "    mem",
      "Выводы",
    ]);
  });

  it("поиск оставляет подходящие сигналы и раскрывает группы", () => {
    expect(keys("Q", ["top"])).toEqual(["top", "  u_good", "    q"]);
    expect(keys("clk")).toEqual(["top", "  clk", "Выводы", "  pin:4"]);
    expect(keys("нет")).toEqual([]);
  });
});

describe("окно просмотра", () => {
  const m = model();

  it("показать всё: участок модели с полями", () => {
    expect(fitView(m)).toEqual({ fromPs: 800, toPs: 5200 });
  });

  it("масштаб сохраняет место момента под указателем и не выходит за границы", () => {
    const view = fitView(m);
    const zoomed = zoomView(view, 0.5, 3000, m);
    expect(zoomed).toEqual({ fromPs: 1900, toPs: 4100 });
    expect(xAtTime(zoomed, 3000, 1000)).toBeCloseTo(xAtTime(view, 3000, 1000));
    expect(zoomView(view, 100, 3000, m)).toEqual(view);
    const deep = zoomView(view, 1e-9, 3000, m);
    expect(deep.toPs - deep.fromPs).toBe(100);
  });

  it("сдвиг останавливается на границе", () => {
    const view = zoomView(fitView(m), 0.5, 3000, m);
    expect(panView(view, 100, m)).toEqual({ fromPs: 2000, toPs: 4200 });
    expect(panView(view, 1e9, m)).toEqual({ fromPs: 3000, toPs: 5200 });
    expect(panView(view, -1e9, m)).toEqual({ fromPs: 800, toPs: 3000 });
  });

  it("пересчёт времени и координаты", () => {
    const view = { fromPs: 1000, toPs: 2000 };
    expect(timeAtX(view, 250, 500)).toBe(1500);
    expect(xAtTime(view, 1500, 500)).toBe(250);
  });

  it("шаг делений оси — 1, 2 или 5 на степень десяти", () => {
    expect(tickStep({ fromPs: 0, toPs: 1000 }, 900)).toBe(100);
    expect(tickStep({ fromPs: 0, toPs: 1500 }, 900)).toBe(200);
    expect(tickStep({ fromPs: 0, toPs: 4000 }, 900)).toBe(500);
  });

  it("редкие изменения дают участок на каждое значение", () => {
    const pin = m.signals[1];
    if (!pin) throw new Error("нет сигнала");
    const parts = segments(pin, { fromPs: 1000, toPs: 5000 }, m.toPs, 400);
    expect(parts.map((p) => [p.x0, p.x1, p.index, p.dense])).toEqual([
      [0, 150, 0, false],
      [150, 300, 1, false],
      [300, 400, 2, false],
    ]);
  });

  it("частые изменения сливаются в закрашенные участки, число участков ограничено шириной", () => {
    const traces: Trace[] = [
      {
        record: 0,
        fromPs: 0n,
        toPs: 1_000_000n,
        changes: [
          { timePs: 0n, index: 0, words: [0] },
          ...Array.from({ length: 100_000 }, (_, i) => ({ timePs: BigInt(10 * (i + 1)), index: 0, words: [i & 1] })),
        ],
      },
    ];
    const fast = modelFromTraces([{ index: 0, name: "clk", width: 1 }], traces);
    const signal = fast.signals[0];
    if (!signal) throw new Error("нет сигнала");
    const parts = segments(signal, { fromPs: 0, toPs: 1_000_000 }, fast.toPs, 500);
    expect(parts.length).toBeLessThanOrEqual(1000);
    expect(parts.filter((p) => p.dense).length).toBeGreaterThan(200);
    // Spans go left to right without gaps.
    parts.forEach((part, i) => {
      if (i > 0) expect(part.x0).toBeCloseTo(parts[i - 1]?.x1 ?? 0, 6);
    });
    expect(parts[parts.length - 1]?.x1).toBeCloseTo(500, 6);
    // Zoomed in, the same changes are visible one by one.
    const near = segments(signal, { fromPs: 0, toPs: 100 }, fast.toPs, 500);
    expect(near.every((p) => !p.dense)).toBe(true);
    expect(near.length).toBe(10);
  });
});

describe("наблюдение и запись в fpgasim.json", () => {
  it("умолчания и записи неверного вида", () => {
    const config: ProjectConfig = {
      format: 1,
      watch: [{ signal: "top.q", radix: "hex" }, { signal: "top.q" }, { radix: "bin" }, "x", { signal: "pin:15" }],
      record: {
        signals: ["top.q", 5, "top.q", ""],
        mode: "window",
        depth: 0,
        trigger: { signal: "top.q", edge: "up" },
      },
    };
    expect(watchItems(config)).toEqual([
      { signal: "top.q", radix: "hex" },
      { signal: "pin:15", radix: "dec" },
    ]);
    expect(recordSettings(config)).toEqual({
      signals: ["top.q"],
      mode: "window",
      depth: 200_000,
      windowPs: 100_000_000_000,
      trigger: null,
    });
    expect(recordSettings({ format: 1 }).mode).toBe("ring");
    expect(watchItems(null)).toEqual([]);
  });

  it("правка сохраняет чужие записи и поля", () => {
    const config: ProjectConfig = {
      format: 1,
      watch: [{ signal: "top.q", radix: "hex" }, { radix: "bin" }],
      record: { signals: ["top.q"], note: "своё" },
    };
    changeWatch(config, (items) => [...items, { signal: "top.cnt_a", radix: "dec" }]);
    expect(config.watch).toEqual([{ signal: "top.q", radix: "hex" }, { signal: "top.cnt_a" }, { radix: "bin" }]);
    changeRecord(config, { mode: "window", trigger: { signal: "pin:15", edge: "rise" } });
    expect(config.record).toEqual({
      signals: ["top.q"],
      note: "своё",
      mode: "window",
      depth: 200_000,
      windowPs: 100_000_000_000,
      trigger: { signal: "pin:15", edge: "rise" },
    });
  });

  it("условие запуска многоразрядного сигнала — только change", () => {
    expect(triggerEdges(1)).toEqual(["rise", "fall", "change"]);
    expect(triggerEdges(8)).toEqual(["change"]);
  });
});
