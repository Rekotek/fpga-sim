// Interface theme: light, dark or as in the system. The choice is stored in the browser, not in the project.
// The dark class on the root element switches the variables in styles.css. Canvas drawing (board,
// waveforms) reads colors through themeColor and redraws on the revision counter.
import { create } from "zustand";

export type ThemeChoice = "light" | "dark" | "system";

const KEY = "fpgasim.theme";
const CHOICES: readonly ThemeChoice[] = ["light", "dark", "system"];

function stored(): ThemeChoice {
  try {
    const value = localStorage.getItem(KEY);
    return CHOICES.find((c) => c === value) ?? "system";
  } catch {
    // Storage is closed (private mode): the theme comes from the system.
    return "system";
  }
}

const systemDark = (): boolean =>
  typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;

const isDark = (choice: ThemeChoice): boolean => (choice === "system" ? systemDark() : choice === "dark");

// revision grows on every change of look: Canvas uses it to learn that the colors must be read again.
export const useTheme = create<{ choice: ThemeChoice; dark: boolean; revision: number }>(() => ({
  choice: "system",
  dark: false,
  revision: 0,
}));

const colors = new Map<string, string>();

function apply(choice: ThemeChoice): void {
  const dark = isDark(choice);
  document.documentElement.classList.toggle("dark", dark);
  colors.clear();
  useTheme.setState((s) => ({ choice, dark, revision: s.revision + 1 }));
}

export function setTheme(choice: ThemeChoice): void {
  try {
    localStorage.setItem(KEY, choice);
  } catch {
    // The choice holds until the page closes.
  }
  apply(choice);
}

// Called before the first render: the page opens in the right theme at once.
export function installTheme(): void {
  apply(stored());
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (useTheme.getState().choice === "system") apply("system");
  });
}

// The value of a theme variable from styles.css, for example themeColor("--wave-line").
export function themeColor(name: string): string {
  let value = colors.get(name);
  if (value === undefined) {
    value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    colors.set(name, value);
  }
  return value;
}
