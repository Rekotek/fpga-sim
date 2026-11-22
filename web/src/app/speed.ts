// Speed multipliers (spec section 5.3) and steps (spec section 9.3): values and labels for the top bar.
import { numberLocale } from "../i18n";
import type { Speed } from "../sim/messages";

export const SPEEDS: readonly Speed[] = ["max", 1, 0.5, 0.1, 0.01, 1e-3, 1e-4, 1e-5, 1e-6];

const plain = new Intl.NumberFormat(numberLocale(), { maximumSignificantDigits: 6, maximumFractionDigits: 9 });

// Multiplier label: 1×, 0.1×, 0.000001× (a decimal comma in Russian). For max the label comes from the dictionary.
export function speedLabel(speed: number): string {
  return `${plain.format(speed)}×`;
}

// Value for <select>: numbers are written so that 1e-6 and 0.000001 match.
export const speedValue = (speed: Speed): string => (speed === "max" ? "max" : String(speed));

// A custom multiplier from the input: a positive number, with a comma or a point.
export function parseSpeed(text: string): number | null {
  const value = Number(text.trim().replace(",", "."));
  return Number.isFinite(value) && value > 0 ? value : null;
}

export type StepChoice = "cycle1" | "cycle10" | "cycle100" | "change" | "time";
export const STEP_CHOICES: readonly StepChoice[] = ["cycle1", "cycle10", "cycle100", "change", "time"];

export type StepCommand = { unit: "cycle"; count: number } | { unit: "change" } | { unit: "time"; ps: string };

// The step command for the chosen step kind; the step time is set in milliseconds of simulation time.
export function stepCommand(choice: StepChoice, timeMs: string): StepCommand | null {
  if (choice === "change") return { unit: "change" };
  if (choice === "time") {
    const ms = Number(timeMs.trim().replace(",", "."));
    if (!Number.isFinite(ms) || ms <= 0) return null;
    return { unit: "time", ps: BigInt(Math.round(ms * 1e9)).toString() };
  }
  return { unit: "cycle", count: choice === "cycle1" ? 1 : choice === "cycle10" ? 10 : 100 };
}

// Project file name: Latin letters, digits, dot, hyphen, underscore; folders through "/".
export function filePathProblem(path: string, existing: readonly string[]): "empty" | "bad" | "exists" | null {
  if (path === "") return "empty";
  if (!/^[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+)*$/.test(path) || path.split("/").some((part) => /^\.+$/.test(part)))
    return "bad";
  return existing.includes(path) ? "exists" : null;
}
