// Interface strings (spec section 9.1): the ru.json and en.json dictionaries and the t(key, args) function.
// The language is chosen at page load (language.ts, decision 168); if the key is missing in the language dictionary,
// the string comes from ru.json.
import en from "./en.json";
import { currentLanguage, isLocalizedText, localized } from "./language";
import ru from "./ru.json";

export {
  currentLanguage,
  localized,
  numberLocale,
  onBeforeLanguageChange,
  setLanguage,
  type Language,
} from "./language";

export type TextKey = keyof typeof ru;
export type TextArgs = Record<string, unknown>;

const dictionaries: Record<string, Record<string, string | undefined>> = { ru, en };

function lookup(key: string): string | undefined {
  return dictionaries[currentLanguage()]?.[key] ?? (ru as Record<string, string | undefined>)[key];
}

function show(value: unknown): string {
  if (typeof value === "string") return value;
  if (isLocalizedText(value)) return localized(value);
  if (Array.isArray(value)) return value.map(show).join(", ");
  return JSON.stringify(value);
}

// Substitution of {name} from args. A name missing from args stays as is.
export function fill(template: string, args: TextArgs = {}): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in args ? show(args[name]) : whole));
}

export function t(key: TextKey, args?: TextArgs): string {
  return fill(lookup(key) ?? key, args);
}

// A string with a key known only at run time (a server error code, a state);
// if the dictionary has no such string, a fallback key.
export function tOr(key: string, fallback: TextKey, args?: TextArgs): string {
  return fill(lookup(key) ?? lookup(fallback) ?? fallback, args);
}
