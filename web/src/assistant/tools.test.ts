// The assistant's browser tools (decision 175): what each tool returns from the project state.
import { describe, expect, test } from "vitest";
import { MAX_CHANGES, MAX_RESULT_CHARS, runTool, type ToolSource } from "./tools";

function source(changes: Partial<ToolSource> = {}): ToolSource {
  return {
    files: () => [
      { path: "top.v", content: "module top; endmodule\n" },
      { path: "top.cst", content: 'IO_LOC "led[0]" 15;\n' },
    ],
    topFile: () => "top.v",
    testbenches: () => [],
    build: () => ({ status: "ok", errorCode: null }),
    messages: () => [{ code: "WIDTH", level: "warning", file: "top.v", line: 3, text: "ширина", explain: "" }],
    notices: () => [{ code: "INPUT_FLOATING", text: "вход висит", net: "pin:88", time: "1000" }],
    board: () => "tang-nano-20k",
    parts: () => [
      {
        id: "led0",
        type: "led",
        label: "LED0",
        origin: "board",
        enabled: true,
        pins: { in: 15 },
        settings: { activeLevel: 0 },
      },
      { id: "led1", type: "led", label: "LED1", origin: "board", enabled: false, pins: { in: 16 }, settings: {} },
    ],
    binding: () => ({
      source: "cst",
      file: "top.cst",
      rows: [{ name: "led[0]", dir: "output", pin: 15, pull: null }],
      pins: [15],
      problems: [],
    }),
    pins: () => [
      { pin: 15, state: "busy", level: 0 },
      { pin: 16, state: "free", level: null },
    ],
    run: () => ({ run: "running", loaded: true, time: "1000000" }),
    wave: () => null,
    waveChanges: () => [],
    signals: () => [{ path: "pin:15" }, { path: "top.q" }],
    ...changes,
  };
}

const parse = (name: string, input: Record<string, unknown> = {}, s = source()): unknown =>
  JSON.parse(runTool(name, input, s).text);

describe("инструменты помощника", () => {
  test("list_files: пути, размеры, верхний файл", () => {
    expect(parse("list_files")).toEqual({
      files: [
        { path: "top.v", bytes: 22 },
        { path: "top.cst", bytes: 20 },
      ],
      top: "top.v",
      testbenches: [],
    });
  });

  test("read_file: текст файла и ошибка для неизвестного", () => {
    expect(parse("read_file", { path: "top.v" })).toEqual({ path: "top.v", content: "module top; endmodule\n" });
    const missing = runTool("read_file", { path: "nope.v" }, source());
    expect(missing.error).toBe(true);
  });

  test("get_messages: сборка, сообщения и замечания симулятора", () => {
    const result = parse("get_messages") as { build: unknown; messages: unknown[]; notices: unknown[] };
    expect(result.build).toEqual({ status: "ok", errorCode: null });
    expect(result.messages).toHaveLength(1);
    expect(result.notices).toEqual([{ code: "INPUT_FLOATING", text: "вход висит", net: "pin:88", time: "1000" }]);
  });

  test("get_board: только включённые детали и занятые выводы", () => {
    const result = parse("get_board") as {
      board: string;
      parts: { id: string }[];
      pins: unknown[];
      simulation: unknown;
    };
    expect(result.board).toBe("tang-nano-20k");
    expect(result.parts.map((p) => p.id)).toEqual(["led0"]);
    expect(result.pins).toEqual([{ pin: 15, state: "busy", level: 0 }]);
    expect(result.simulation).toEqual({ run: "running", loaded: true, time_ps: "1000000" });
    expect(runTool("get_board", {}, source({ board: () => null })).error).toBe(true);
  });

  test("get_waveform: без записи и с записью", () => {
    expect(parse("get_waveform")).toEqual({ recorded: false, available: ["pin:15", "top.q"] });
    const recorded = source({
      wave: () => ({ fromPs: "0", toPs: "2000", signals: [{ name: "pin:15" }] }),
      waveChanges: (name, from, count) => [{ t: String(from), v: `${name}:${String(count)}` }],
    });
    expect(parse("get_waveform", {}, recorded)).toEqual({
      recorded: true,
      from_ps: "0",
      to_ps: "2000",
      signals: ["pin:15"],
      available: ["pin:15", "top.q"],
    });
    expect(parse("get_waveform", { signals: ["pin:15", "top.q"], max_changes: 3 }, recorded)).toEqual({
      "pin:15": [{ t: "0", v: "pin:15:3" }],
      "top.q": "not recorded",
    });
    const changes = (max_changes: unknown): unknown =>
      (parse("get_waveform", { signals: ["pin:15"], max_changes }, recorded) as Record<string, unknown>)["pin:15"];
    expect(changes(1e9)).toEqual([{ t: "0", v: `pin:15:${String(MAX_CHANGES)}` }]);
    expect(changes(2.7)).toEqual([{ t: "0", v: "pin:15:2" }]);
    expect(changes(-1)).toEqual([{ t: "0", v: "pin:15:50" }]);
    expect(changes("9")).toEqual([{ t: "0", v: "pin:15:50" }]);
  });

  test("длинный результат обрезается с пометкой", () => {
    const big = "x".repeat(MAX_RESULT_CHARS + 500);
    const result = runTool("read_file", { path: "big.v" }, source({ files: () => [{ path: "big.v", content: big }] }));
    expect(result.text.length).toBeLessThan(MAX_RESULT_CHARS + 100);
    expect(result.text).toMatch(/\[cut: \d+ more characters\]$/);
  });

  test("неизвестный инструмент — ошибка", () => {
    expect(runTool("format_disk", {}, source()).error).toBe(true);
  });
});
