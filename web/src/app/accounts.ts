// Account display on the "Users" page (accounts spec section 5.6, docs/tz-accounts.md): sign-in and build
// times, and the prohibitions of section 3.4. No React: unit tests check these functions.
import type { Account } from "../build/types";
import { numberLocale, t } from "../i18n";
import { formatDate } from "./format";

const DAY_MS = 24 * 60 * 60 * 1000;
const clock = new Intl.DateTimeFormat(numberLocale(), { hour: "2-digit", minute: "2-digit" });

// Sign-in and build time: "today 18:40", "yesterday 18:40", otherwise the date; "—" if it never happened.
export function formatWhen(ms: number | null, now: number = Date.now()): string {
  if (ms === null) return t("users.never");
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const start = midnight.getTime();
  if (ms >= start) return t("users.today", { time: clock.format(ms) });
  if (ms >= start - DAY_MS) return t("users.yesterday", { time: clock.format(ms) });
  return formatDate(ms);
}

// Why the action "disable, delete, demote" is prohibited (section 3.4); null means allowed.
export function forbidReason(user: Account, me: string, users: readonly Account[]): string | null {
  if (user.login === me) return t("users.forbidSelf");
  const admins = users.filter((u) => u.role === "admin" && u.enabled);
  if (user.role === "admin" && user.enabled && admins.length <= 1) return t("users.forbidLast");
  return null;
}

// Retention period of the trash on the server (section 2.6): after it the project files are erased.
export const TRASH_DAYS = 30;

// Whole and partial days until the project is erased from the trash; 0 means the period is over and erasure waits
// for the daily cleanup.
export function purgeDays(deletedAt: number, now: number = Date.now()): number {
  return Math.max(0, Math.ceil((deletedAt + TRASH_DAYS * DAY_MS - now) / DAY_MS));
}
