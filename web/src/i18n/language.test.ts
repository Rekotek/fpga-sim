import { afterEach, describe, expect, it } from "vitest";
import { fill } from "./index";
import { localized, pickLanguage, setLanguageForTests } from "./language";

describe("pickLanguage", () => {
  it("параметр адреса главнее сохранённого выбора и браузера", () => {
    expect(pickLanguage("?lang=en", "ru", ["ru"])).toBe("en");
    expect(pickLanguage("?key=abc&lang=ru", "en", ["en"])).toBe("ru");
  });

  it("сохранённый выбор главнее браузера", () => {
    expect(pickLanguage("", "en", ["ru"])).toBe("en");
  });

  it("первый из ru и en по списку браузера", () => {
    expect(pickLanguage("", null, ["lv", "en", "ru"])).toBe("en");
    expect(pickLanguage("", null, ["uk", "ru", "en"])).toBe("ru");
    expect(pickLanguage("", null, ["en-GB"])).toBe("en");
    expect(pickLanguage("", null, ["ru-RU"])).toBe("ru");
  });

  it("без ru и en в списке браузера — русский", () => {
    expect(pickLanguage("", null, ["lv"])).toBe("ru");
    expect(pickLanguage("", null, [])).toBe("ru");
  });

  it("неизвестные значения не учитываются", () => {
    expect(pickLanguage("?lang=de", null, ["ru-RU"])).toBe("ru");
    expect(pickLanguage("", "xx", ["en-US"])).toBe("en");
  });
});

describe("localized", () => {
  afterEach(() => {
    setLanguageForTests("ru");
  });

  it("берёт текст текущего языка", () => {
    setLanguageForTests("en");
    expect(localized({ ru: "Вход", en: "Input" })).toBe("Input");
  });

  it("без текста на текущем языке — русский", () => {
    setLanguageForTests("en");
    expect(localized({ ru: "Вход" })).toBe("Вход");
  });

  it("строка — как есть, пусто — пустая строка", () => {
    expect(localized("LED0")).toBe("LED0");
    expect(localized(undefined)).toBe("");
  });

  it("fill подставляет текст по языкам, а не JSON", () => {
    setLanguageForTests("en");
    expect(fill("device {d}", { d: { ru: "ТФ-карта", en: "TF card" } })).toBe("device TF card");
  });
});
