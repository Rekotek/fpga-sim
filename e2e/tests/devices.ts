// Steps of end-to-end tests with two devices of one account (stages 4 and 5 of docs/tz-accounts.md):
// bench accounts, projects on the server bypassing the interface, file edits. A device is a browser context.
import { expect, type APIRequestContext, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { ADMIN, SERVER, createFromExample, openAs, replaceEditorText, sim, simWith } from "./stand";

export interface Login {
  login: string;
  password: string;
}

let counter = 0;

// A new account on the bench: the tests do not see each other's projects. The login is a prefix, the full time
// in base36 and a counter joined by "-": without a separator `…12345`+`1` and `…1234`+`51` collided.
// The counter tells the calls of one run apart (workers: 1), the time tells the runs on one bench database apart.
export async function freshUser(request: APIRequestContext, prefix: string): Promise<Login> {
  counter += 1;
  const login = `${prefix}${Date.now().toString(36)}-${String(counter)}`;
  const token = await serverToken(request, ADMIN);
  const created = await request.post(`${SERVER}/v1/admin/users`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { login, name: login, role: "user" },
  });
  expect(created.status()).toBe(200);
  return { login, password: ((await created.json()) as { password: string }).password };
}

// Session label of the account, bypassing the interface.
export async function serverToken(request: APIRequestContext, user: Login): Promise<string> {
  const response = await request.post(`${SERVER}/v1/auth/login`, { data: user });
  return ((await response.json()) as { token: string }).token;
}

export async function serverProjects(request: APIRequestContext, token: string) {
  const response = await request.get(`${SERVER}/v1/projects`, { headers: { Authorization: `Bearer ${token}` } });
  return ((await response.json()) as { projects: { id: string; name: string; deleted: boolean }[] }).projects;
}

// Project file on the server: a sync request with no changes and since 0 returns all files.
export async function serverFile(request: APIRequestContext, token: string, id: string, path: string) {
  const response = await request.post(`${SERVER}/v1/projects/${id}/sync`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { since: 0, generation: null, changes: [] },
  });
  const body = (await response.json()) as { remote: { path: string; content: string | null }[] };
  return body.remote.find((f) => f.path === path)?.content;
}

export async function device(
  browser: Browser,
  baseURL: string | undefined,
  user: Login,
): Promise<[BrowserContext, Page]> {
  const context = await browser.newContext(baseURL === undefined ? {} : { baseURL });
  const page = await context.newPage();
  await openAs(page, user);
  return [context, page];
}

export const syncNow = (page: Page) => sim(page, (api) => api.syncNow());
export const syncState = (page: Page) => sim(page, async (api) => (await api.sync())?.state ?? null);
export const fileText = (page: Page, path: string) => simWith(page, path, (api, p) => api.file(p));
export const projectNames = (page: Page) => sim(page, (api) => api.projects().map((p) => p.name));

export async function openProject(page: Page, name: string): Promise<void> {
  await page.getByTestId("project-row").filter({ hasText: name }).getByTestId("project-open").click();
  await expect(page.getByTestId("project-name")).toHaveText(name);
}

export async function selectFile(page: Page, path: string): Promise<void> {
  // File name in the list row: a mark of an unsaved edit may follow it.
  const name = new RegExp(`^${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( •)?$`);
  await page
    .locator('[data-testid="file"]')
    .filter({ has: page.locator('[data-testid="file-path"]', { hasText: name }) })
    .click();
  await expect(page.locator('[data-testid="file"][aria-current="true"]')).toContainText(path);
}

// Edit of the open file without saving and with saving.
export async function edit(page: Page, path: string, text: string): Promise<void> {
  await selectFile(page, path);
  await replaceEditorText(page, text);
}

export async function editAndSave(page: Page, path: string, text: string): Promise<void> {
  await edit(page, path, text);
  await page.keyboard.press("ControlOrMeta+s");
  await expect.poll(() => fileText(page, path)).toBe(text);
}

// The blink3 project is created on the first device and opened on the second.
export async function sharedProject(browser: Browser, baseURL: string | undefined, user: Login) {
  const [contextA, a] = await device(browser, baseURL, user);
  await createFromExample(a, "blink3");
  await syncNow(a);
  await expect.poll(() => syncState(a)).toBe("synced");
  const [contextB, b] = await device(browser, baseURL, user);
  await expect.poll(() => projectNames(b)).toEqual(["blink3"]);
  await openProject(b, "blink3");
  await expect.poll(() => syncState(b)).toBe("synced");
  return { a, b, contextA, contextB };
}
