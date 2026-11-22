// Acceptance criteria of stage 2 of docs/tz-accounts.md: login, account menu, the "Users" page,
// visibility of projects by account. The state is read through window.__fpgasim and data-testid.
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { ADMIN, KEY, SERVER, USER, createFromExample, openAs, openWithKey, signIn, signOut, sim } from "./stand";

test.skip(!ADMIN.password || !USER.password, "стенд не завёл учётные записи (e2e/run.sh)");

const stored = (page: Page, name: string) => page.evaluate((key) => localStorage.getItem(key), name);
const account = (page: Page) => sim(page, (api) => api.account());
const users = (page: Page) => sim(page, (api) => api.users());

let counter = 0;
// A login that is not yet on the bench: the tests create accounts themselves and do not disturb each other.
function freshLogin(prefix: string): string {
  counter += 1;
  return `${prefix}${String(Date.now() % 1_000_000)}${String(counter)}`;
}

// Login through the server, without the interface: response code and session label.
async function serverLogin(request: APIRequestContext, login: string, password: string) {
  const response = await request.post(`${SERVER}/v1/auth/login`, { data: { login, password } });
  const body = response.ok() ? ((await response.json()) as { token: string }) : null;
  return { status: response.status(), token: body?.token ?? null };
}

// A user account created by the bench administrator through the server; returns the password.
async function createUser(request: APIRequestContext, login: string): Promise<string> {
  const { token } = await serverLogin(request, ADMIN.login, ADMIN.password);
  const response = await request.post(`${SERVER}/v1/admin/users`, {
    headers: { Authorization: `Bearer ${token ?? ""}` },
    data: { login, name: login, role: "user" },
  });
  expect(response.status()).toBe(200);
  return ((await response.json()) as { password: string }).password;
}

// The "Users" page from the account menu.
async function openUsers(page: Page): Promise<void> {
  await page.getByTestId("account-menu").click();
  await page.getByTestId("account-users").click();
  await expect(page.getByTestId("users-page")).toBeVisible();
  await expect.poll(async () => (await users(page)).length).toBeGreaterThan(0);
}

async function rowMenu(page: Page, login: string, action: string): Promise<void> {
  await page.locator(`[data-testid="user-row"][data-login="${login}"]`).getByTestId("user-menu").click();
  await page.getByTestId(action).click();
}

const projectNames = (page: Page) => page.getByTestId("project-open").allTextContents();

test("без сеанса и ключа виден вход; вход сохраняется после перезагрузки; «Выйти» стирает метку", async ({ page }) => {
  await page.goto("/?debug=1");
  await expect(page.getByTestId("login-form")).toBeVisible();
  await expect(page.getByTestId("login-name")).toHaveAttribute("autocomplete", "username");
  await expect(page.getByTestId("login-password")).toHaveAttribute("autocomplete", "current-password");
  expect(await account(page)).toMatchObject({ kind: "none" });

  await signIn(page, USER.login, USER.password);
  expect(await account(page)).toMatchObject({ kind: "session", login: USER.login, role: "user" });
  expect(await stored(page, "fpgasim.session")).toBeTruthy();

  await page.reload();
  await expect(page.getByTestId("example-menu")).toBeVisible();
  await expect(page.getByTestId("login-form")).toHaveCount(0);
  expect(await account(page)).toMatchObject({ kind: "session", login: USER.login });

  await signOut(page);
  expect(await account(page)).toMatchObject({ kind: "none" });
  expect(await stored(page, "fpgasim.session")).toBeNull();
  await page.reload();
  await expect(page.getByTestId("login-form")).toBeVisible();
});

test("неверный пароль показывает текст отказа; метки в localStorage нет", async ({ page }) => {
  await page.goto("/?debug=1");
  await page.getByTestId("login-name").fill(USER.login);
  await page.getByTestId("login-password").fill("wrong-password");
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("login-problem")).toHaveText("Неверный логин или пароль");
  await expect(page.getByTestId("example-menu")).toHaveCount(0);
  expect(await stored(page, "fpgasim.session")).toBeNull();
  expect(await account(page)).toMatchObject({ kind: "none" });
});

test("ссылка #key=… открывает приложение без формы входа; в меню ключа только «Выйти»", async ({ page }) => {
  await openWithKey(page);
  await expect(page.getByTestId("login-form")).toHaveCount(0);
  expect(await account(page)).toMatchObject({ kind: "key", login: null });
  await page.getByTestId("account-menu").click();
  await expect(page.getByTestId("account-logout")).toBeVisible();
  await expect(page.getByTestId("account-password")).toHaveCount(0);
  await expect(page.getByTestId("account-users")).toHaveCount(0);
});

test("администратор создаёт пользователя; показанным паролем проходит вход во втором контексте", async ({
  page,
  browser,
  baseURL,
}) => {
  await openAs(page, ADMIN);
  await openUsers(page);
  const login = freshLogin("new");
  await page.getByTestId("user-add").click();
  await page.getByTestId("user-add-login").fill(login);
  await page.getByTestId("user-add-name").fill("Новый ученик");
  await page.getByTestId("user-add-submit").click();
  await expect(page.getByTestId("user-shown-dialog")).toContainText("Пароль показан один раз");
  await expect(page.getByTestId("shown-login")).toHaveText(login);
  const password = (await page.getByTestId("shown-password").textContent()) ?? "";
  expect(password).toMatch(/^[a-z2-9]{5}-[a-z2-9]{5}$/);
  await page.getByTestId("shown-close").click();
  await expect
    .poll(async () => (await users(page)).find((u) => u.login === login))
    .toMatchObject({ name: "Новый ученик", role: "user", enabled: true, lastLogin: null });

  const second = await browser.newContext({ baseURL: baseURL ?? "" });
  try {
    const other = await second.newPage();
    await openAs(other, { login, password });
    expect(await account(other)).toMatchObject({ kind: "session", login, name: "Новый ученик", role: "user" });
  } finally {
    await second.close();
  }
  // The login time of the new user shows in the table after the list is read again.
  await page.getByTestId("users-back").click();
  await openUsers(page);
  expect((await users(page)).find((u) => u.login === login)?.lastLogin).not.toBeNull();
});

test("«Новый пароль»: старый пароль не действует, открытый сеанс пользователя видит полосу «Сеанс закончился»", async ({
  page,
  browser,
  baseURL,
  request,
}) => {
  const login = freshLogin("reset");
  const old = await createUser(request, login);

  const second = await browser.newContext({ baseURL: baseURL ?? "" });
  try {
    const student = await second.newPage();
    await openAs(student, { login, password: old });
    await createFromExample(student, "blink3");

    await openAs(page, ADMIN);
    await openUsers(page);
    await rowMenu(page, login, "user-reset");
    await page.getByTestId("user-reset-confirm").click();
    const fresh = (await page.getByTestId("shown-password").textContent()) ?? "";
    expect(fresh).not.toBe(old);
    await page.getByTestId("shown-close").click();
    expect((await serverLogin(request, login, old)).status).toBe(401);

    // The user's open project: the build gets 401, the project stays open, the bar shows.
    await student.getByTestId("build").click();
    await expect(student.getByTestId("session-banner")).toContainText("Сеанс закончился");
    expect(await account(student)).toMatchObject({ expired: true, login });
    expect(await sim(student, (api) => api.project()?.name)).toBe("blink3");
    expect(await stored(student, "fpgasim.session")).toBeNull();

    // Login of the same account with the new password: the bar goes away, the project stays open.
    await student.getByTestId("session-login").click();
    await student.getByTestId("login-name").fill(login);
    await student.getByTestId("login-password").fill(fresh);
    await student.getByTestId("login-submit").click();
    await expect(student.getByTestId("session-banner")).toHaveCount(0);
    expect(await account(student)).toMatchObject({ kind: "session", login, expired: false });
    expect(await sim(student, (api) => api.project()?.name)).toBe("blink3");
  } finally {
    await second.close();
  }
});

test("«Отключить»: вход пользователя отвергается; «Удалить» требует ввода логина; свои запреты выключены", async ({
  page,
  request,
}) => {
  const login = freshLogin("off");
  const password = await createUser(request, login);
  await openAs(page, ADMIN);
  await openUsers(page);

  // You cannot disable or delete your own account: the menu items are off.
  await page.locator(`[data-testid="user-row"][data-login="${ADMIN.login}"]`).getByTestId("user-menu").click();
  await expect(page.getByTestId("user-disable")).toHaveAttribute("data-disabled", "");
  await expect(page.getByTestId("user-delete")).toHaveAttribute("data-disabled", "");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);

  await rowMenu(page, login, "user-disable");
  await expect.poll(async () => (await users(page)).find((u) => u.login === login)?.enabled).toBe(false);
  expect((await serverLogin(request, login, password)).status).toBe(401);

  await rowMenu(page, login, "user-delete");
  const confirm = page.getByTestId("user-delete-confirm");
  await expect(page.getByTestId("user-delete-text")).toContainText("Проектов: 0");
  await expect(confirm).toBeDisabled();
  await page.getByTestId("user-delete-input").fill("not-this-login");
  await expect(confirm).toBeDisabled();
  await page.getByTestId("user-delete-input").fill(login);
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(page.getByTestId("user-delete-dialog")).toHaveCount(0);
  await expect.poll(async () => (await users(page)).some((u) => u.login === login)).toBe(false);
});

test("пользователь без роли администратора пункта «Пользователи» не видит", async ({ page }) => {
  await openAs(page, USER);
  await page.getByTestId("account-menu").click();
  await expect(page.getByTestId("account-password")).toBeVisible();
  await expect(page.getByTestId("account-logout")).toBeVisible();
  await expect(page.getByTestId("account-users")).toHaveCount(0);
});

test("проект записи a не виден под записью b в том же браузере и снова виден под a", async ({ page, request }) => {
  const a = { login: freshLogin("a"), password: "" };
  const b = { login: freshLogin("b"), password: "" };
  a.password = await createUser(request, a.login);
  b.password = await createUser(request, b.login);

  await openAs(page, a);
  await createFromExample(page, "blink3");
  await page.getByTestId("back").click();
  await expect.poll(() => projectNames(page)).toEqual(["blink3"]);
  await signOut(page);

  await signIn(page, b.login, b.password);
  await expect(page.getByTestId("project-list")).toHaveCount(0);
  await signOut(page);

  await signIn(page, a.login, a.password);
  await expect.poll(() => projectNames(page)).toEqual(["blink3"]);
});

test("проект, созданный при входе по ключу, после входа записи виден под ней", async ({ page, request }) => {
  const a = { login: freshLogin("k"), password: "" };
  a.password = await createUser(request, a.login);

  await openWithKey(page);
  await createFromExample(page, "blink3");
  await page.getByTestId("back").click();
  await signOut(page);
  expect(await stored(page, "fpgasim.key")).toBeNull();

  await signIn(page, a.login, a.password);
  await expect.poll(() => projectNames(page)).toEqual(["blink3"]);
  await expect(page.getByTestId("adopted-notice")).toHaveAttribute("data-count", "1");
  // After this the key sees only unowned projects: the accepted project went to the account.
  await page.goto("about:blank");
  await page.goto(`/?debug=1#key=${encodeURIComponent(KEY)}`);
  await expect(page.getByTestId("example-menu")).toBeVisible();
  await expect(page.getByTestId("project-list")).toHaveCount(0);
});

test("ключ из ссылки стирает метку сеанса; вход по логину стирает ключ", async ({ page }) => {
  await openAs(page, USER);
  expect(await stored(page, "fpgasim.session")).toBeTruthy();

  await page.goto("about:blank");
  await page.goto(`/?debug=1#key=${encodeURIComponent(KEY)}`);
  await expect(page.getByTestId("example-menu")).toBeVisible();
  expect(await stored(page, "fpgasim.session")).toBeNull();
  expect(await stored(page, "fpgasim.key")).toBe(KEY);
  expect(await account(page)).toMatchObject({ kind: "key" });

  // The key is saved while the login form is on screen (for example, another tab wrote it):
  // login by name erases it.
  await signOut(page);
  await page.evaluate((key) => {
    localStorage.setItem("fpgasim.key", key);
  }, KEY);
  await signIn(page, USER.login, USER.password);
  expect(await stored(page, "fpgasim.key")).toBeNull();
  expect(await stored(page, "fpgasim.session")).toBeTruthy();
});

test("смена своего пароля: новый пароль действует, старый — нет", async ({ page, request }) => {
  const login = freshLogin("pw");
  const old = await createUser(request, login);
  await openAs(page, { login, password: old });

  await page.getByTestId("account-menu").click();
  await page.getByTestId("account-password").click();
  await page.getByTestId("password-current").fill(old);
  await page.getByTestId("password-new").fill("new-password-1");
  await page.getByTestId("password-repeat").fill("new-password-2");
  await page.getByTestId("password-submit").click();
  await expect(page.getByTestId("password-problem")).toHaveText("Новые пароли не совпадают");

  await page.getByTestId("password-repeat").fill("new-password-1");
  await page.getByTestId("password-submit").click();
  await expect(page.getByTestId("password-done")).toBeVisible();
  // A session that changed the password stays.
  expect(await account(page)).toMatchObject({ kind: "session", login });

  expect((await serverLogin(request, login, old)).status).toBe(401);
  expect((await serverLogin(request, login, "new-password-1")).status).toBe(200);
});

// The colors of the login form and the "Users" page come from the theme: background and text equal the variables
// --background and --foreground of the chosen theme and change with it. Color literals in the sources
// are checked by the unit test web/src/app/accounts.test.ts.
test("светлая и тёмная тема: форма входа и страница «Пользователи» берут цвета из темы", async ({ page }) => {
  const colors = (testid: string) =>
    page.evaluate((id) => {
      const probe = document.createElement("div");
      document.body.append(probe);
      const resolve = (name: string) => {
        probe.style.color = `var(${name})`;
        return getComputedStyle(probe).color;
      };
      const element = document.querySelector(`[data-testid="${id}"]`);
      const style = element ? getComputedStyle(element) : null;
      const result = {
        background: style?.backgroundColor ?? null,
        color: style?.color ?? null,
        themeBackground: resolve("--background"),
        themeForeground: resolve("--foreground"),
      };
      probe.remove();
      return result;
    }, testid);

  const seen: Record<string, string | null> = {};
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/?debug=1");
    await expect(page.getByTestId("login-form")).toBeVisible();
    expect(await sim(page, (api) => api.theme().dark)).toBe(scheme === "dark");
    const form = await colors("login-form");
    expect(form.background).toBe(form.themeBackground);
    expect(form.color).toBe(form.themeForeground);
    seen[`form-${scheme}`] = form.background;

    await signIn(page, ADMIN.login, ADMIN.password);
    await openUsers(page);
    const table = await colors("user-list");
    expect(table.color).toBe(table.themeForeground);
    seen[`users-${scheme}`] = table.themeForeground;
    await page.getByTestId("users-back").click();
    await signOut(page);
  }
  expect(seen["form-light"]).not.toBe(seen["form-dark"]);
  expect(seen["users-light"]).not.toBe(seen["users-dark"]);
});
