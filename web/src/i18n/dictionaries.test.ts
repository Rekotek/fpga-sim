// Completeness of English text (decision 168): interface dictionaries, part descriptions, the
// diagnostics table and board files. Text by language is an object with the ru field.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import en from "./en.json";
import ru from "./ru.json";

const ROOT = new URL("../../../", import.meta.url);
const CYRILLIC = /[А-Яа-яЁё]/;

const placeholders = (text: string): string[] => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? "").sort();
const backticks = (text: string): number => text.split("`").length - 1;

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(new URL(path, ROOT), "utf8"));
}

// All "text by language" objects in a document, with the path to them.
function localizedTexts(node: unknown, path: string, out: [string, Record<string, unknown>][]): void {
  if (Array.isArray(node)) {
    node.forEach((item, i) => {
      localizedTexts(item, `${path}[${String(i)}]`, out);
    });
  } else if (typeof node === "object" && node !== null) {
    const record = node as Record<string, unknown>;
    if (typeof record.ru === "string") out.push([path, record]);
    else
      for (const [key, value] of Object.entries(record)) {
        localizedTexts(value, `${path}.${key}`, out);
      }
  }
}

function problemsOf(file: string): string[] {
  const found: [string, Record<string, unknown>][] = [];
  localizedTexts(readJson(file), file, found);
  expect(found.length).toBeGreaterThan(0);
  return found.flatMap(([path, text]) => {
    const ruText = text.ru as string;
    const enText = text.en;
    if (typeof enText !== "string" || enText === "") return [`${path}: нет en`];
    if (CYRILLIC.test(enText)) return [`${path}: кириллица в en`];
    if (placeholders(ruText).join() !== placeholders(enText).join()) return [`${path}: подстановки`];
    if (backticks(ruText) !== backticks(enText)) return [`${path}: обратные кавычки`];
    return [];
  });
}

describe("словари интерфейса", () => {
  const ruDict: Record<string, string> = ru;
  const enDict: Record<string, string> = en;

  it("ключи en.json совпадают с ключами ru.json", () => {
    expect(Object.keys(enDict).sort()).toEqual(Object.keys(ruDict).sort());
  });

  it("подстановки и разметка кода совпадают, в английском нет кириллицы", () => {
    const bad = Object.keys(ruDict).filter((key) => {
      const ruText = ruDict[key] ?? "";
      const enText = enDict[key] ?? "";
      return (
        placeholders(ruText).join() !== placeholders(enText).join() ||
        backticks(ruText) !== backticks(enText) ||
        CYRILLIC.test(enText)
      );
    });
    expect(bad).toEqual([]);
  });
});

describe("английский текст в данных", () => {
  it("описания деталей", () => {
    const parts = readdirSync(new URL("parts/", ROOT), { withFileTypes: true }).filter((d) => d.isDirectory());
    expect(parts.flatMap((d) => problemsOf(`parts/${d.name}/part.json`))).toEqual([]);
  });

  it("таблица диагностик", () => {
    expect(problemsOf("spec/diagnostics.json")).toEqual([]);
  });

  it("пометки выводов и устройства плат", () => {
    for (const file of readdirSync(new URL("boards/", ROOT)).filter((f) => f.endsWith(".json"))) {
      const board = readJson(`boards/${file}`) as {
        pins: Record<string, { note?: unknown }>;
        devices: { label: unknown }[];
      };
      for (const [pin, info] of Object.entries(board.pins))
        if (info.note !== undefined) expect(typeof info.note, `${file} вывод ${pin}`).toBe("object");
      for (const device of board.devices) expect(typeof device.label, file).toBe("object");
      expect(problemsOf(`boards/${file}`)).toEqual([]);
    }
  });
});
