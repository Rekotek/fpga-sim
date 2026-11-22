// Acceptance of accounts on the production URLs (stage 6 of docs/tz-accounts.md): login of the e2e account,
// the project goes to the server, appears on a second device, an edit arrives, deletion removes the project.
// The login and password of the account are in FPGASIM_USER_LOGIN and FPGASIM_USER_PASSWORD.
import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { USER, createFromExample, openAs, replaceEditorText, sim, simWith } from "../tests/stand";

const SERVER = (process.env.FPGASIM_SERVER ?? process.env.FPGASIM_BUILD_URL ?? "").replace(/\/+$/, "");
const NAME = "blink3";

test.skip(!USER.login || !USER.password, "нужна запись приёмочных тестов: FPGASIM_USER_LOGIN и FPGASIM_USER_PASSWORD");

async function token(request: APIRequestContext): Promise<string> {
  const response = await request.post(`${SERVER}/v1/auth/login`, { data: USER });
  expect(response.status()).toBe(200);
  return ((await response.json()) as { token: string }).token;
}

async function serverProjects(request: APIRequestContext, session: string) {
  const response = await request.get(`${SERVER}/v1/projects`, { headers: { Authorization: `Bearer ${session}` } });
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { projects: { id: string; name: string; deleted: boolean }[] };
  return body.projects.filter((p) => !p.deleted);
}

// Projects of the account left over from an interrupted run go to the trash.
async function cleanUp(request: APIRequestContext, session: string): Promise<void> {
  for (const project of await serverProjects(request, session)) {
    await request.delete(`${SERVER}/v1/projects/${project.id}`, { headers: { Authorization: `Bearer ${session}` } });
  }
}

async function device(browser: Browser, baseURL: string | undefined): Promise<[BrowserContext, Page]> {
  const context = await browser.newContext(baseURL === undefined ? {} : { baseURL });
  const page = await context.newPage();
  await openAs(page, USER);
  return [context, page];
}

const syncNow = (page: Page) => sim(page, (api) => api.syncNow());
const syncState = (page: Page) => sim(page, async (api) => (await api.sync())?.state ?? null);
const fileText = (page: Page, path: string) => simWith(page, path, (api, p) => api.file(p));
const projectNames = (page: Page) => sim(page, (api) => api.projects().map((p) => p.name));

test("учётная запись: вход, проект на сервере, второе устройство, правка, удаление", async ({
  browser,
  baseURL,
  request,
}) => {
  const session = await token(request);
  await cleanUp(request, session);

  const [contextA, a] = await device(browser, baseURL);
  expect(await sim(a, (api) => api.account())).toMatchObject({ kind: "session", login: USER.login });
  await createFromExample(a, NAME);
  await syncNow(a);
  await expect.poll(() => syncState(a), { timeout: 30_000 }).toBe("synced");
  expect((await serverProjects(request, session)).map((p) => p.name)).toEqual([NAME]);

  // A second device of the same account gets the project with the same files.
  const [contextB, b] = await device(browser, baseURL);
  await expect.poll(() => projectNames(b), { timeout: 30_000 }).toEqual([NAME]);
  await b.getByTestId("project-row").filter({ hasText: NAME }).getByTestId("project-open").click();
  await expect(b.getByTestId("project-name")).toHaveText(NAME);
  await expect.poll(() => syncState(b), { timeout: 30_000 }).toBe("synced");
  expect(await sim(b, (api) => api.files())).toEqual(await sim(a, (api) => api.files()));

  // An edit on the first device reaches the second.
  const text = `// приёмка ${new Date().toISOString()}\n`;
  await a
    .locator('[data-testid="file"]')
    .filter({ has: a.locator('[data-testid="file-path"]', { hasText: /^top\.cst( •)?$/ }) })
    .click();
  await replaceEditorText(a, text);
  await a.keyboard.press("ControlOrMeta+s");
  await expect.poll(() => fileText(a, "top.cst")).toBe(text);
  await syncNow(a);
  await syncNow(b);
  expect(await fileText(b, "top.cst")).toBe(text);

  // Deletion on the first device removes the project from the second and from the server.
  await b.getByTestId("back").click();
  await a.getByTestId("back").click();
  await a.getByTestId("project-delete").click();
  await a.getByTestId("project-delete-confirm").click();
  await syncNow(a);
  await syncNow(b);
  await expect.poll(() => projectNames(b), { timeout: 30_000 }).toEqual([]);
  expect(await serverProjects(request, session)).toEqual([]);
  await contextA.close();
  await contextB.close();
});

test("учётная запись: операции администратора записи приёмочных тестов недоступны", async ({ request }) => {
  const session = await token(request);
  const response = await request.get(`${SERVER}/v1/admin/users`, { headers: { Authorization: `Bearer ${session}` } });
  expect(response.status()).toBe(403);
});
