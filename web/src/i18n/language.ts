// Interface language (decision 168). Chosen once at page load: the lang address parameter,
// the saved choice, the browser language list; without ru and en in the list, Russian. A language change
// writes the choice and reloads: canvas labels and strings built in advance do not update on their own.

export type Language = "ru" | "en";

export const LANGUAGES: readonly Language[] = ["ru", "en"];
export const LANGUAGE_STORAGE_KEY = "fpgasim.language";
const PARAM = "lang";

function known(value: string | null | undefined): Language | null {
  return LANGUAGES.find((lang) => lang === value) ?? null;
}

export function pickLanguage(search: string, stored: string | null, browser: readonly string[]): Language {
  const fromUrl = known(new URLSearchParams(search).get(PARAM));
  if (fromUrl) return fromUrl;
  const saved = known(stored);
  if (saved) return saved;
  for (const tag of browser) {
    const lang = known(tag.toLowerCase().split("-")[0]);
    if (lang) return lang;
  }
  return "ru";
}

// The page environment may be missing (Vitest, Node) or forbid storage: then defaults.
function safely<T>(read: () => T, fallback: T): T {
  try {
    return read();
  } catch {
    return fallback;
  }
}

function detect(): Language {
  const search = safely(() => location.search, "");
  const stored = safely(() => localStorage.getItem(LANGUAGE_STORAGE_KEY), null);
  const browser = safely((): readonly string[] => navigator.languages, []);
  const lang = pickLanguage(search, stored, browser);
  if (known(new URLSearchParams(search).get(PARAM))) {
    safely(() => {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
    }, undefined);
  }
  safely(() => (document.documentElement.lang = lang), undefined);
  return lang;
}

let current: Language = detect();

export function currentLanguage(): Language {
  return current;
}

export function numberLocale(): "ru-RU" | "en-US" {
  return current === "en" ? "en-US" : "ru-RU";
}

// For unit tests only: the language without a reload.
export function setLanguageForTests(lang: Language): void {
  current = lang;
}

// Text by language ({ru, en}, spec section 15.2): the current language, otherwise Russian. A string is returned as is.
export function localized(text: Readonly<Record<string, string>> | string | undefined): string {
  if (text === undefined) return "";
  if (typeof text === "string") return text;
  return text[current] ?? text.ru ?? "";
}

export function isLocalizedText(value: unknown): value is Record<string, string> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { ru?: unknown }).ru === "string"
  );
}

const beforeChange: (() => Promise<void>)[] = [];

// Actions before a reload on language change: save unsaved editor edits.
export function onBeforeLanguageChange(fn: () => Promise<void>): void {
  beforeChange.push(fn);
}

export async function setLanguage(lang: Language): Promise<void> {
  safely(() => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
  }, undefined);
  for (const fn of beforeChange) await fn();
  const url = new URL(location.href);
  url.searchParams.delete(PARAM);
  history.replaceState(history.state, "", url);
  location.reload();
}
