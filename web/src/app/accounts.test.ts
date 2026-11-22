// Sign-in and the "Users" page (docs/tz-accounts.md): storage of sign-in data, the prohibitions
// of section 3.4, sign-in time, colors only from the theme.
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, test } from "vitest";
import type { Account } from "../build/types";
import { forgetKey, forgetSession, loadKey, loadSession, saveKey, saveSession } from "../build/key";
import { forbidReason, formatWhen, purgeDays } from "./accounts";

const account = (login: string, role: "admin" | "user", enabled = true): Account => ({
  login,
  name: login,
  role,
  enabled,
  created: 0,
  lastLogin: null,
  lastBuild: null,
  projects: 0,
});

describe("данные входа в localStorage", () => {
  beforeEach(() => {
    const items = new Map<string, string>();
    const storage: Storage = {
      getItem: (k: string) => items.get(k) ?? null,
      setItem: (k: string, v: string) => {
        items.set(k, v);
      },
      removeItem: (k: string) => {
        items.delete(k);
      },
      clear: () => {
        items.clear();
      },
      key: () => null,
      get length() {
        return items.size;
      },
    };
    globalThis.localStorage = storage;
  });

  test("хранится одно из двух: ключ стирает метку сеанса, сеанс стирает ключ", () => {
    saveSession("token", "misha");
    expect(loadSession()).toEqual({ token: "token", login: "misha" });
    saveKey("key");
    expect(loadSession()).toBeNull();
    expect(loadKey()).toBe("key");
    saveSession("token2", "misha");
    expect(loadKey()).toBeNull();
    forgetSession();
    forgetKey();
    expect(loadSession()).toBeNull();
    expect(loadKey()).toBeNull();
  });
});

describe("запреты раздела 3.4", () => {
  test("свою запись нельзя отключить, удалить или понизить", () => {
    const users = [account("a", "admin"), account("b", "admin")];
    expect(forbidReason(users[0] as Account, "a", users)).toMatch(/Свою запись/);
    expect(forbidReason(users[1] as Account, "a", users)).toBeNull();
  });

  test("последнего включённого администратора нельзя отключить, удалить или понизить", () => {
    const users = [account("a", "admin"), account("b", "admin", false), account("c", "user")];
    expect(forbidReason(users[0] as Account, "x", users)).toMatch(/Последнего/);
    expect(forbidReason(users[1] as Account, "x", users)).toBeNull();
    expect(forbidReason(users[2] as Account, "x", users)).toBeNull();
  });
});

test("время входа: сегодня, вчера, дата, прочерк", () => {
  const now = new Date(2026, 10, 20, 12, 0).getTime();
  expect(formatWhen(null, now)).toBe("—");
  expect(formatWhen(new Date(2026, 10, 20, 9, 5).getTime(), now)).toBe("сегодня 09:05");
  expect(formatWhen(new Date(2026, 10, 19, 18, 40).getTime(), now)).toBe("вчера 18:40");
  expect(formatWhen(new Date(2026, 10, 10, 18, 40).getTime(), now)).toMatch(/10\.11\.2026/);
});

test("срок до стирания проекта из корзины: 30 суток от удаления, не меньше нуля", () => {
  const day = 24 * 60 * 60 * 1000;
  const deleted = new Date(2026, 10, 1, 12, 0).getTime();
  expect(purgeDays(deleted, deleted)).toBe(30);
  expect(purgeDays(deleted, deleted + day / 2)).toBe(30);
  expect(purgeDays(deleted, deleted + 29.5 * day)).toBe(1);
  expect(purgeDays(deleted, deleted + 31 * day)).toBe(0);
});

// Colors are only theme variables (CLAUDE.md, section "Стиль"): a color literal breaks the dark theme.
test("форма входа, меню учётной записи, страница «Пользователи» и признаки синхронизации без литералов цвета", () => {
  const literal =
    /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab)\(|\b(?:text|bg|border)-(?:red|green|blue|yellow|gray|slate|zinc|neutral|white|black)\b/;
  const files = ["LoginForm.tsx", "AccountMenu.tsx", "UsersScreen.tsx", "SessionBanner.tsx", "accounts.ts"];
  for (const file of [...files, "SyncUi.tsx", "UserProjects.tsx", "ProjectsScreen.tsx"]) {
    const source = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
    expect(literal.exec(source)?.[0], file).toBeUndefined();
  }
});
