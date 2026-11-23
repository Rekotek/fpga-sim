// The Markdown subset of the assistant's answers (decision 175).
import { expect, test } from "vitest";
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { blocks, inline } from "./Markdown";

const html = (text: string): string => renderToStaticMarkup(createElement(Fragment, null, ...inline(text)));

test("блоки ответа помощника", () => {
  const text =
    "## Причина\nLED горит при `0`.\nВторая строка.\n\n- раз\n- два\n1. один\n\n```verilog\nassign a = ~b;\n```\nконец";
  expect(blocks(text)).toEqual([
    { kind: "heading", text: "Причина" },
    { kind: "text", lines: ["LED горит при `0`.", "Вторая строка."] },
    { kind: "list", ordered: false, start: 1, items: ["раз", "два"] },
    { kind: "list", ordered: true, start: 1, items: ["один"] },
    { kind: "code", text: "assign a = ~b;" },
    { kind: "text", lines: ["конец"] },
  ]);
});

test("незакрытый блок кода идёт до конца", () => {
  expect(blocks("```\nx\ny")).toEqual([{ kind: "code", text: "x\ny" }]);
});

test("код внутри жирного разбирается", () => {
  expect(html("**Pin 73 (`ped_r`):** да")).toBe(
    '<strong>Pin 73 (<code class="rounded-sm bg-muted px-1 font-mono text-[0.92em]">ped_r</code>):</strong> да',
  );
});

test("нумерованный список после разрыва продолжает нумерацию", () => {
  const text = "1. первый\n\nПояснение.\n\n2. второй\n\n3. третий";
  expect(blocks(text)).toEqual([
    { kind: "list", ordered: true, start: 1, items: ["первый"] },
    { kind: "text", lines: ["Пояснение."] },
    { kind: "list", ordered: true, start: 2, items: ["второй", "третий"] },
  ]);
});
