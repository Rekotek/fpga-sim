// Number formatting for display by interface language: Russian uses a decimal comma and a space between digit groups.
import { numberLocale, t } from "../i18n";

const LOCALE = numberLocale();
const seconds3 = new Intl.NumberFormat(LOCALE, { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const fixed2 = new Intl.NumberFormat(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fixed1 = new Intl.NumberFormat(LOCALE, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const integer = new Intl.NumberFormat(LOCALE);
const dateTime = new Intl.DateTimeFormat(LOCALE, { dateStyle: "short", timeStyle: "short" });

// Simulation time in seconds with three decimals; picoseconds arrive as a string or bigint.
export function simSeconds(ps: bigint | string): string {
  return seconds3.format(Number(BigInt(ps) / 1_000_000_000n) / 1000);
}

export const formatInteger = (value: number | bigint): string => integer.format(value);
export const formatRatio = (value: number): string => fixed2.format(value);
export const formatSeconds = (ms: number): string => fixed1.format(ms / 1000);
// Frequency: hertz, kilohertz, megahertz with three significant digits.
const significant3 = new Intl.NumberFormat(LOCALE, { maximumSignificantDigits: 3 });
export function formatHz(hz: number): string {
  if (hz >= 1e6) return t("unit.mhz", { value: significant3.format(hz / 1e6) });
  if (hz >= 1e3) return t("unit.khz", { value: significant3.format(hz / 1e3) });
  return t("unit.hz", { value: significant3.format(hz) });
}

export const formatDate = (ms: number): string => dateTime.format(ms);

// Time in picoseconds with a fitting unit: ps, ns, µs, ms or s; at most six fraction digits.
const fraction6 = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 6 });
export function formatPs(value: number): string {
  const ps = value + 0; // negative zero is written as zero
  const size = Math.abs(ps);
  if (size < 1e3) return t("unit.ps", { value: fraction6.format(ps) });
  if (size < 1e6) return t("unit.ns", { value: fraction6.format(ps / 1e3) });
  if (size < 1e9) return t("unit.us", { value: fraction6.format(ps / 1e6) });
  if (size < 1e12) return t("unit.ms", { value: fraction6.format(ps / 1e9) });
  return t("unit.s", { value: fraction6.format(ps / 1e12) });
}
