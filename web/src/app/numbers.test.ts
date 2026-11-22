// Only format.ts formats numbers for display, by interface language: a hand-made decimal comma
// showed "0,3 s" in the English Testbench tab.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const APP = new URL("./", import.meta.url);
const MANUAL = /toFixed\(|replace\(\s*["']\.["']\s*,\s*["'],["']\s*\)/;

describe("запись чисел", () => {
  it("компоненты не форматируют числа вручную", () => {
    const bad = readdirSync(APP)
      .filter((name) => name.endsWith(".tsx"))
      .filter((name) => MANUAL.test(readFileSync(new URL(name, APP), "utf8")));
    expect(bad).toEqual([]);
  });
});
