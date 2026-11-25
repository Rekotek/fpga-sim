// Refusals of the server and the core in the interface language (decision 183): the text by args.reason,
// by the code without args, and the completeness of the dictionaries for every reason in the sources.
import { readdirSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { ServerError } from "../build/client";
import { CoreError } from "../sim/host";
import en from "./en.json";
import { setLanguageForTests } from "./language";
import { failureText, noticeText, refusalArgs, refusalText } from "./refusal";
import ru from "./ru.json";

const ROOT = new URL("../../../", import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, ROOT), "utf8");
const sources = (dir: string, ext: string): string =>
  readdirSync(new URL(dir, ROOT))
    .filter((name) => name.endsWith(ext))
    .map((name) => read(`${dir}${name}`))
    .join("\n");

// Reasons in the server sources: reason="x", self_reason="x", last_reason="x", {"reason": "x"}.
function serverReasons(): string[] {
  const text = sources("server/fpgasim_server/", ".py");
  return [...text.matchAll(/reason="([A-Za-z]+)"|"reason": "([A-Za-z]+)"/g)].map((m) => m[1] ?? m[2] ?? "");
}

// Reasons in the core: {"reason", "x"}. A reason with a capital letter is the end of a value check:
// the core puts "setting" or "arg" before it (registry.cpp, prefixed).
function coreReasons(): string[] {
  const text = sources("core/src/runtime/", ".cpp");
  return [...text.matchAll(/\{"reason", "([A-Za-z]+)"\}/g)].flatMap((m) => {
    const reason = m[1] ?? "";
    return /^[A-Z]/.test(reason) ? [`setting${reason}`, `arg${reason}`] : [reason];
  });
}

// Notice codes of the core: notice("X", …) and emit(n, "X", …).
function noticeCodes(): string[] {
  const text = sources("core/src/runtime/", ".cpp");
  return [...text.matchAll(/(?:notice|emit)\((?:\d+, )?"([A-Z_]+)"/g)].map((m) => m[1] ?? "");
}

describe("строки отказов в словарях", () => {
  const dictionaries = { ru: ru as Record<string, string>, en: en as Record<string, string> };

  it("каждая причина сервера и ядра есть в обоих словарях", () => {
    const reasons = [...new Set([...serverReasons(), ...coreReasons()])];
    expect(reasons.length).toBeGreaterThan(50);
    for (const [lang, dict] of Object.entries(dictionaries)) {
      const missing = reasons.filter((r) => dict[`refusal.${r}`] === undefined);
      expect(missing, lang).toEqual([]);
    }
  });

  it("каждое уведомление ядра есть в обоих словарях", () => {
    const codes = [...new Set(noticeCodes())];
    expect(codes).toEqual(expect.arrayContaining(["INPUT_FLOATING", "NET_CONFLICT", "MODEL_FINISH", "SLOW"]));
    for (const [lang, dict] of Object.entries(dictionaries)) {
      expect(
        codes.filter((c) => dict[`notice.${c}`] === undefined),
        lang,
      ).toEqual([]);
    }
  });

  it("у каждого кода ошибки ядра из ТЗ есть строка", () => {
    const table = read("docs/tz-v1.md").split("`error` codes:")[1] ?? "";
    const codes = [...(table.split("Order details.")[0] ?? "").matchAll(/^\| `([A-Z_]+)` \|/gm)].map((m) => m[1] ?? "");
    expect(codes.length).toBeGreaterThan(10);
    for (const dict of Object.values(dictionaries)) {
      expect(codes.filter((c) => dict[`error.${c}`] === undefined)).toEqual([]);
    }
  });
});

describe("текст отказа", () => {
  afterEach(() => {
    setLanguageForTests("ru");
  });

  it("по причине — на языке интерфейса, с подстановкой значений", () => {
    setLanguageForTests("en");
    const args = refusalArgs({ reason: "settingMaximum", part: "led0", setting: "level", limit: 3 });
    expect(refusalText("SETTINGS_INVALID", args, "деталь led0: …")).toBe(
      "Part led0: setting “level” is greater than 3",
    );
    setLanguageForTests("ru");
    expect(refusalText("SETTINGS_INVALID", args, "деталь led0: …")).toBe("Деталь led0: настройка «level» больше 3");
  });

  it("без args или с незнакомой причиной — по коду; незнакомый код — код и исходный текст", () => {
    setLanguageForTests("en");
    expect(refusalText("BAD_STATE", null, "шаг допустим только на паузе")).toBe("the command is not available now");
    expect(refusalText("BAD_STATE", refusalArgs({ reason: "fromTheFuture" }), "…")).toBe(
      "the command is not available now",
    );
    expect(refusalText("TEAPOT", null, "чайник")).toBe("TEAPOT: чайник");
  });

  it("args без reason не принимаются", () => {
    expect(refusalArgs({ part: "led0" })).toBeNull();
    expect(refusalArgs(null)).toBeNull();
    expect(refusalArgs(["reason"])).toBeNull();
  });

  it("ошибки сервера и ядра показываются по args, прочие — своим текстом", () => {
    setLanguageForTests("en");
    const server = new ServerError(413, "PROJECT_TOO_LARGE", "Файл a.v больше 512 КБ", {
      reason: "fileTooLarge",
      path: "a.v",
      kilobytes: 512,
    });
    expect(failureText(server)).toBe("File a.v is larger than 512 KB");
    expect(failureText(new ServerError(503, "BUSY", "Сервер занят"))).toBe("the server is busy, try again later");
    const core = new CoreError("RECORD_INVALID", "записи нужно больше 64 МБ", {
      reason: "recordMemory",
      megabytes: 64,
    });
    expect(failureText(core)).toBe(
      "The recording needs more than 64 MB of memory: reduce the depth or the number of signals",
    );
    expect(failureText(new Error("folder access denied"))).toBe("folder access denied");
  });

  it("уведомление ядра — по коду, незнакомое — текстом ядра", () => {
    setLanguageForTests("en");
    expect(noticeText("NET_CONFLICT", "сетью управляют два источника")).toBe(
      "two sources drive the net with different levels",
    );
    expect(noticeText("CONFIG_INVALID", "Part x: …")).toBe("Part x: …");
  });
});
