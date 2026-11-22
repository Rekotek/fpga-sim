// Shared steps of the end-to-end tests. The state is read through window.__fpgasim (spec section 9.7).
import { expect, type Locator, type Page } from "@playwright/test";
import type { DebugApi } from "../../web/src/debug/api";

export const KEY = process.env.FPGASIM_KEY ?? "";
// Build server address of the bench and the accounts that tools/dev/server.sh creates (accounts spec section 6,
// docs/tz-accounts.md).
export const SERVER = process.env.FPGASIM_SERVER ?? "";
export const ADMIN = {
  login: process.env.FPGASIM_ADMIN_LOGIN ?? "",
  password: process.env.FPGASIM_ADMIN_PASSWORD ?? "",
};
export const USER = { login: process.env.FPGASIM_USER_LOGIN ?? "", password: process.env.FPGASIM_USER_PASSWORD ?? "" };

declare global {
  interface Window {
    __fpgasim?: DebugApi;
  }
}

// Call a window.__fpgasim method on the page.
export function sim<T>(page: Page, read: (api: DebugApi) => T | Promise<T>): Promise<T> {
  return page.evaluate<T>(`(${read.toString()})(window.__fpgasim)`);
}

// The same with one argument: the function runs on the page and does not see the test variables.
export function simWith<A, T>(page: Page, arg: A, read: (api: DebugApi, arg: A) => T | Promise<T>): Promise<T> {
  return page.evaluate<T>(`(${read.toString()})(window.__fpgasim, ${JSON.stringify(arg)})`);
}

// A page with the key from a link like .../#key=... (spec section 8.6).
export async function openWithKey(page: Page): Promise<void> {
  await page.goto(`/?debug=1#key=${encodeURIComponent(KEY)}`);
  await expect(page.getByTestId("example-menu")).toBeVisible();
}

// Login by name and password through the login form (accounts spec section 5.1, docs/tz-accounts.md).
export async function signIn(page: Page, login: string, password: string): Promise<void> {
  await page.getByTestId("login-name").fill(login);
  await page.getByTestId("login-password").fill(password);
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("example-menu")).toBeVisible();
}

// A page without a key and a session, and the account login.
export async function openAs(page: Page, user: { login: string; password: string }): Promise<void> {
  await page.goto("/?debug=1");
  await signIn(page, user.login, user.password);
}

// "Sign out" from the account menu.
export async function signOut(page: Page): Promise<void> {
  await page.getByTestId("account-menu").click();
  await page.getByTestId("account-logout").click();
  await expect(page.getByTestId("login-form")).toBeVisible();
}

export async function createFromExample(page: Page, name: string): Promise<void> {
  await pickExample(page, name);
  await expect(page.getByTestId("project-name")).toHaveText(name);
}

// "From example": a menu with the list of lessons and examples; choosing an item creates a project at once.
export async function pickExample(page: Page, name: string): Promise<void> {
  await page.getByTestId("example-menu").click();
  await page.locator(`[data-testid="example-item"][data-example="${name}"]`).click();
}

// Choice list (Radix Select): the list button is target, an item is role=option with data-value.
// The button keeps the chosen value in the data-value attribute.
export async function choose(target: Locator, value: string): Promise<void> {
  await target.click();
  await target.page().locator(`[role="option"][data-value="${value}"]`).click();
}

// Project menu in the top bar: rename, settings, export.
export async function openProjectMenu(page: Page): Promise<void> {
  await page.getByTestId("project-menu").click();
}

export async function openSettings(page: Page): Promise<void> {
  await openProjectMenu(page);
  await page.getByTestId("settings-open").click();
}

// An action on the open file from the menu of its row in the "Files" area.
export async function fileAction(page: Page, action: "rename" | "delete"): Promise<void> {
  await page.locator('li:has([data-testid="file"][aria-current="true"])').getByTestId("file-menu").click();
  await page.getByTestId(`file-${action}`).click();
}

// Replaces the whole text of the open file, as keyboard input would.
export async function replaceEditorText(page: Page, text: string): Promise<void> {
  await page.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText(text);
}

export async function build(page: Page): Promise<string> {
  await page.getByTestId("build").click();
  const status = () => sim(page, (api) => api.state().build.status);
  await expect.poll(status, { timeout: 60_000 }).toMatch(/^(ok|failed|error)$/);
  return status();
}
