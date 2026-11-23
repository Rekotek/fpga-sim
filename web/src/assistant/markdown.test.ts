// The Markdown subset of the assistant's answers (decision 175).
import { expect, test } from "vitest";
import { blocks } from "./Markdown";

test("блоки ответа помощника", () => {
  const text =
    "## Причина\nLED горит при `0`.\nВторая строка.\n\n- раз\n- два\n1. один\n\n```verilog\nassign a = ~b;\n```\nконец";
  expect(blocks(text)).toEqual([
    { kind: "heading", text: "Причина" },
    { kind: "text", lines: ["LED горит при `0`.", "Вторая строка."] },
    { kind: "list", ordered: false, items: ["раз", "два"] },
    { kind: "list", ordered: true, items: ["один"] },
    { kind: "code", text: "assign a = ~b;" },
    { kind: "text", lines: ["конец"] },
  ]);
});

test("незакрытый блок кода идёт до конца", () => {
  expect(blocks("```\nx\ny")).toEqual([{ kind: "code", text: "x\ny" }]);
});
