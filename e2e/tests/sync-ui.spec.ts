// Acceptance criteria of stage 5 of docs/tz-accounts.md: sync indicators, conflict dialog,
// exit dialog, messages about a remote project, viewing user work by the administrator.
// The state is read through window.__fpgasim and data-testid, not by pixels.
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import {
  device,
  editAndSave,
  fileText,
  freshUser,
  openProject,
  projectNames,
  selectFile,
  serverFile,
  serverProjects,
  serverToken,
  sharedProject,
  syncNow,
  syncState,
  type Login,
} from "./devices";
import { ADMIN, SERVER, USER, build, createFromExample, fileAction, sim, simWith } from "./stand";

test.skip(!ADMIN.password || !USER.password, "стенд не завёл учётные записи (e2e/run.sh)");

const listBadge = (page: Page, name: string) =>
  page.getByTestId("project-row").filter({ hasText: name }).getByTestId("project-sync");
const conflicts = (page: Page) => sim(page, (api) => api.conflicts());

// The lock "one tab syncs" (section 4.3 of the accounts spec) held by the test: while it is held, the change
// waits for sending, and the indicator stays at "Uploading".
async function holdSyncLock(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((held) => {
        void navigator.locks.request(
          "fpgasim-sync",
          () =>
            new Promise<void>((release) => {
              (window as unknown as Record<string, unknown>).__releaseSync = release;
              held();
            }),
        );
      }),
  );
}

async function releaseSyncLock(page: Page): Promise<void> {
  await page.evaluate(() => {
    ((window as unknown as Record<string, unknown>).__releaseSync as () => void)();
  });
}

test("признак в списке проектов и в строке состояния проходит pending, synced, offline", async ({
  browser,
  baseURL,
  request,
}) => {
  const user = await freshUser(request, "u");
  const [context, page] = await device(browser, baseURL, user);
  await createFromExample(page, "blink3");
  await syncNow(page);
  const status = page.getByTestId("sync-status");
  await expect(status).toHaveAttribute("data-state", "synced");
  await expect(status).toHaveText("Сохранён на сервере");

  // pending: the change waits for sending.
  await holdSyncLock(page);
  await editAndSave(page, "top.v", "// ждёт отправки\n");
  await expect(status).toHaveAttribute("data-state", "pending");
  await expect(status).toHaveText("Отправляется");
  await page.getByTestId("back").click();
  await expect(listBadge(page, "blink3")).toHaveAttribute("data-state", "pending");
  await expect(listBadge(page, "blink3")).toHaveAttribute("aria-label", "Отправляется");
  expect(await sim(page, (api) => api.projects().map((p) => p.sync))).toEqual(["pending"]);

  // synced: the lock was released, the change went out.
  await releaseSyncLock(page);
  await expect(listBadge(page, "blink3")).toHaveAttribute("data-state", "synced", { timeout: 15_000 });
  await expect(listBadge(page, "blink3")).toHaveAttribute("aria-label", "Сохранён на сервере");
  await openProject(page, "blink3");
  await expect(status).toHaveAttribute("data-state", "synced");

  // offline: the network is gone.
  await context.setOffline(true);
  await editAndSave(page, "top.v", "// без сети\n");
  await expect(status).toHaveAttribute("data-state", "offline", { timeout: 15_000 });
  await expect(status).toHaveText("Нет связи: сохранён в браузере");
  await page.getByTestId("back").click();
  await expect(listBadge(page, "blink3")).toHaveAttribute("data-state", "offline");
  await expect(listBadge(page, "blink3")).toHaveAttribute("aria-label", "Нет связи: сохранён в браузере");
  await context.setOffline(false);
  await expect(listBadge(page, "blink3")).toHaveAttribute("data-state", "synced", { timeout: 30_000 });
  const token = await serverToken(request, user);
  const [project] = await serverProjects(request, token);
  expect(await serverFile(request, token, project?.id ?? "", "top.v")).toBe("// без сети\n");
  await context.close();
});

test("щелчок по признаку «Нет связи» повторяет запрос сразу", async ({ browser, baseURL, request }) => {
  const user = await freshUser(request, "u");
  const [context, page] = await device(browser, baseURL, user);
  await createFromExample(page, "blink3");
  await syncNow(page);
  // The server does not answer sync: the browser network is up, so there will be no online event.
  const sent: number[] = [];
  await page.route(/\/v1\/projects\/[^/]+\/sync$/, (route) => {
    sent.push(Date.now());
    void route.abort();
  });
  await editAndSave(page, "top.v", "// повтор\n");
  const status = page.getByTestId("sync-status");
  await expect(status).toHaveAttribute("data-state", "offline", { timeout: 15_000 });
  // Timed retries run after 5, then after 15 s. After the second failure the next retry is after
  // 15 s: before that the state synced comes only from a click.
  await expect.poll(() => sent.length, { timeout: 15_000 }).toBeGreaterThanOrEqual(2);
  await expect(status).toHaveAttribute("data-state", "offline");
  await page.unroute(/\/v1\/projects\/[^/]+\/sync$/);
  await status.click();
  await expect(status).toHaveAttribute("data-state", "synced", { timeout: 8_000 });
  await context.close();
});

test("диалог расхождения открывается сам; «Позже» оставляет расхождение и отметку файла; файлы идут по очереди", async ({
  browser,
  baseURL,
  request,
}) => {
  const user = await freshUser(request, "u");
  const { a, b, contextA, contextB } = await sharedProject(browser, baseURL, user);
  await editAndSave(a, "top.v", "// A top\n");
  await editAndSave(a, "top.cst", "// A cst\n");
  await syncNow(a);
  await editAndSave(b, "top.v", "// B top\n");
  await editAndSave(b, "top.cst", "// B cst\n");
  await syncNow(b);

  const dialog = b.getByTestId("conflict-dialog");
  await expect(dialog).toBeVisible();
  expect(await conflicts(b)).toEqual({ paths: ["top.cst", "top.v"], open: "top.cst" });
  await expect(dialog).toContainText("Файл top.cst изменён на другом устройстве");
  await expect(b.getByTestId("conflict-mine-text")).toHaveValue("// B cst\n");
  await expect(b.getByTestId("conflict-server-text")).toHaveValue("// A cst\n");

  // "Later": the next file in the queue, then the dialog is closed.
  await b.getByTestId("conflict-later").click();
  await expect.poll(async () => (await conflicts(b)).open).toBe("top.v");
  await expect(b.getByTestId("conflict-mine-text")).toHaveValue("// B top\n");
  await b.getByTestId("conflict-later").click();
  await expect(dialog).toBeHidden();
  expect((await conflicts(b)).open).toBeNull();

  // The conflict remains: the state, the marks in the file list, the browser text is unchanged.
  expect(await syncState(b)).toBe("conflict");
  for (const path of ["top.v", "top.cst"]) {
    const name = new RegExp(`^${path.replace(".", "\\.")}( •)?$`);
    const row = b
      .locator('[data-testid="file"]')
      .filter({ has: b.locator('[data-testid="file-path"]', { hasText: name }) });
    await expect(row.getByTestId("file-mark-conflict")).toBeVisible();
    // A narrow "Files" area: the label shrinks, not the name (decision 157); the label is pressed to the right.
    const fit = await row.evaluate((button) => {
      const pathBox = button.querySelector('[data-testid="file-path"]') as HTMLElement;
      const last = button.lastElementChild as HTMLElement;
      const end = button.getBoundingClientRect().right - parseFloat(getComputedStyle(button).paddingRight);
      return {
        nameFits: pathBox.scrollWidth <= Math.ceil(pathBox.getBoundingClientRect().width),
        markAtEnd: Math.abs(last.getBoundingClientRect().right - end) < 1,
      };
    });
    expect(fit).toEqual({ nameFits: true, markAtEnd: true });
  }
  await expect(b.getByTestId("file-mark-conflict")).toHaveCount(2);
  expect(await fileText(b, "top.v")).toBe("// B top\n");
  await expect(b.getByTestId("sync-status")).toHaveText("Расхождение");

  // A repeated sync does not open the dialog itself: the conflict is already shown.
  await syncNow(b);
  await expect(dialog).toBeHidden();

  // A click on the "Conflict" indicator opens the dialog again.
  await b.getByTestId("sync-status").click();
  await expect(dialog).toBeVisible();
  expect((await conflicts(b)).open).toBe("top.cst");
  await contextA.close();
  await contextB.close();
});

test("«Оставить мою»: сервер получает мою версию, второй контекст видит её", async ({ browser, baseURL, request }) => {
  const user = await freshUser(request, "u");
  const { a, b, contextA, contextB } = await sharedProject(browser, baseURL, user);
  await editAndSave(a, "top.v", "// A\n");
  await syncNow(a);
  await editAndSave(b, "top.v", "// B\n");
  await syncNow(b);
  await expect(b.getByTestId("conflict-dialog")).toBeVisible();
  await b.getByTestId("conflict-mine").click();
  await expect(b.getByTestId("conflict-dialog")).toBeHidden();
  await expect.poll(() => syncState(b), { timeout: 15_000 }).toBe("synced");
  await expect(b.getByTestId("file-mark-conflict")).toHaveCount(0);
  const token = await serverToken(request, user);
  const [project] = await serverProjects(request, token);
  expect(await serverFile(request, token, project?.id ?? "", "top.v")).toBe("// B\n");
  await syncNow(a);
  expect(await fileText(a, "top.v")).toBe("// B\n");
  expect(await syncState(a)).toBe("synced");
  await contextA.close();
  await contextB.close();
});

test("«Взять с сервера»: file(path) равен версии сервера, правка редактора заменена", async ({
  browser,
  baseURL,
  request,
}) => {
  const user = await freshUser(request, "u");
  const { a, b, contextA, contextB } = await sharedProject(browser, baseURL, user);
  await editAndSave(a, "top.v", "// A\n");
  await syncNow(a);
  await editAndSave(b, "top.v", "// B\n");
  await syncNow(b);
  await expect(b.getByTestId("conflict-dialog")).toBeVisible();
  await b.getByTestId("conflict-server").click();
  await expect(b.getByTestId("conflict-dialog")).toBeHidden();
  await expect.poll(() => fileText(b, "top.v")).toBe("// A\n");
  await expect.poll(() => syncState(b), { timeout: 15_000 }).toBe("synced");
  // The editor shows the server version, there is no edit.
  await selectFile(b, "top.v");
  await expect(b.locator(".cm-content")).toContainText("// A");
  await expect(b.locator(".cm-content")).not.toContainText("// B");
  expect(await sim(b, (api) => api.editor().dirty)).toEqual([]);
  await contextA.close();
  await contextB.close();
});

test("расхождение у файла, удалённого в браузере: «Файл удалён»; «Взять с сервера» возвращает файл", async ({
  browser,
  baseURL,
  request,
}) => {
  const user = await freshUser(request, "u");
  const { a, b, contextA, contextB } = await sharedProject(browser, baseURL, user);
  await editAndSave(a, "top.cst", "// A cst\n");
  await syncNow(a);
  await selectFile(b, "top.cst");
  await fileAction(b, "delete");
  await b.getByTestId("file-delete-confirm").click();
  await expect.poll(() => fileText(b, "top.cst")).toBeNull();
  await syncNow(b);
  await expect(b.getByTestId("conflict-dialog")).toBeVisible();
  expect(await conflicts(b)).toEqual({ paths: ["top.cst"], open: "top.cst" });
  await expect(b.getByTestId("conflict-mine-text")).toHaveAttribute("data-deleted", "true");
  await expect(b.getByTestId("conflict-mine-text")).toHaveText("Файл удалён");
  await expect(b.getByTestId("conflict-server-text")).toHaveValue("// A cst\n");
  await b.getByTestId("conflict-server").click();
  await expect.poll(() => fileText(b, "top.cst")).toBe("// A cst\n");
  await expect(b.locator('[data-testid="file-path"]').filter({ hasText: "top.cst" })).toBeVisible();
  await expect.poll(() => syncState(b), { timeout: 15_000 }).toBe("synced");
  await contextA.close();
  await contextB.close();
});

test("«Скачать обе»: два файла на диск, диалог остаётся", async ({ browser, baseURL, request }) => {
  const user = await freshUser(request, "u");
  const { a, b, contextA, contextB } = await sharedProject(browser, baseURL, user);
  await editAndSave(a, "top.v", "// A\n");
  await syncNow(a);
  await editAndSave(b, "top.v", "// B\n");
  await syncNow(b);
  await expect(b.getByTestId("conflict-dialog")).toBeVisible();
  const names: string[] = [];
  b.on("download", (download) => names.push(download.suggestedFilename()));
  await b.getByTestId("conflict-download").click();
  await expect.poll(() => [...names].sort()).toEqual(["top.mine.v", "top.server.v"]);
  await expect(b.getByTestId("conflict-dialog")).toBeVisible();
  await contextA.close();
  await contextB.close();
});

test("«Выйти» с неотправленной правкой показывает диалог; «Отправить и выйти» отправляет и выходит", async ({
  browser,
  baseURL,
  request,
}) => {
  const user = await freshUser(request, "u");
  const [context, page] = await device(browser, baseURL, user);
  await createFromExample(page, "blink3");
  await syncNow(page);
  await expect.poll(() => syncState(page)).toBe("synced");
  await context.setOffline(true);
  await editAndSave(page, "top.v", "// перед выходом\n");
  await page.getByTestId("back").click();

  await page.getByTestId("account-menu").click();
  await page.getByTestId("account-logout").click();
  const dialog = page.getByTestId("exit-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Не всё сохранено на сервер");
  expect(await sim(page, (api) => api.exitDialog())).toEqual({ busy: false, problem: null });

  // The server is unavailable: refusal, no exit.
  await page.getByTestId("exit-send").click();
  await expect(page.getByTestId("exit-problem")).toHaveText("Сервер не отвечает: правки не отправлены. Выход отменён.");
  expect(await sim(page, (api) => api.account().kind)).toBe("session");

  // "Stay" closes the dialog.
  await page.getByTestId("exit-stay").click();
  await expect(dialog).toBeHidden();
  expect(await sim(page, (api) => api.account().kind)).toBe("session");

  // The connection is back, but sending has not passed yet: the dialog opens again and sends.
  await page.route(/\/v1\/projects/, (route) => route.abort());
  await context.setOffline(false);
  await page.getByTestId("account-menu").click();
  await page.getByTestId("account-logout").click();
  await expect(dialog).toBeVisible();
  await page.unroute(/\/v1\/projects/);
  await page.getByTestId("exit-send").click();
  await expect(page.getByTestId("login-form")).toBeVisible({ timeout: 30_000 });
  expect(await sim(page, (api) => api.account().kind)).toBe("none");
  expect(await page.evaluate(() => localStorage.getItem("fpgasim.session"))).toBeNull();
  const token = await serverToken(request, user);
  const [project] = await serverProjects(request, token);
  expect(await serverFile(request, token, project?.id ?? "", "top.v")).toBe("// перед выходом\n");
  await context.close();
});

test("сообщения раздела 4.4: проект удалён на другом устройстве — стёрт или сохранён как новый", async ({
  browser,
  baseURL,
  request,
}) => {
  const user = await freshUser(request, "u");
  const { a, b, contextA, contextB } = await sharedProject(browser, baseURL, user);
  // Without unsaved work: the open project closes with a message.
  await a.getByTestId("back").click();
  await a.getByTestId("project-delete").click();
  await a.getByTestId("project-delete-confirm").click();
  await syncNow(a);
  await syncNow(b);
  await expect(b.getByTestId("sync-notice")).toHaveAttribute("data-kind", "deleted");
  expect(await sim(b, (api) => api.project())).toBeNull();
  expect(await sim(b, (api) => api.syncNotice())).toBe("deleted");
  await expect(b.getByTestId("sync-notice")).toContainText("удалён на другом устройстве");
  await contextA.close();
  await contextB.close();

  // With an unsaved edit: the project stays under a new identifier, the workspace reports it.
  const second = await sharedProject(browser, baseURL, user);
  await second.b.getByTestId("project-name").waitFor();
  await selectFile(second.b, "top.v");
  await second.b.locator(".cm-content").click();
  await second.b.keyboard.insertText("// не потерять\n");
  await second.a.getByTestId("back").click();
  await second.a.getByTestId("project-delete").click();
  await second.a.getByTestId("project-delete-confirm").click();
  await syncNow(second.a);
  await syncNow(second.b);
  await expect(second.b.getByTestId("sync-notice")).toHaveAttribute("data-kind", "copied");
  expect(await sim(second.b, (api) => api.syncNotice())).toBe("copied");
  await expect(second.b.getByTestId("project-name")).toHaveText("blink3");
  await second.contextA.close();
  await second.contextB.close();
});

// ---- Viewing user work (accounts spec section 5.6) ----

async function adminToken(request: APIRequestContext): Promise<string> {
  return serverToken(request, ADMIN);
}

async function openUserProjects(page: Page, login: string): Promise<void> {
  await page.getByTestId("account-menu").click();
  await page.getByTestId("account-users").click();
  await page.locator(`[data-testid="user-row"][data-login="${login}"]`).getByTestId("user-menu").click();
  await page.getByTestId("user-projects").click();
  await expect(page.getByTestId("user-projects-dialog")).toBeVisible();
  await expect.poll(() => sim(page, (api) => api.userProjects()?.projects !== null)).toBe(true);
}

// A user project on the server: created and sent by his browser.
async function userProject(browserPage: Page): Promise<void> {
  await createFromExample(browserPage, "blink3");
  await syncNow(browserPage);
  await expect.poll(() => syncState(browserPage)).toBe("synced");
}

test("администратор открывает проект пользователя для просмотра: view, сборка, правка не меняет проект пользователя", async ({
  browser,
  baseURL,
  request,
}) => {
  const user: Login = await freshUser(request, "v");
  const [userContext, student] = await device(browser, baseURL, user);
  await userProject(student);
  const userTok = await serverToken(request, user);
  const [project] = await serverProjects(request, userTok);
  const id = project?.id ?? "";
  const original = await serverFile(request, userTok, id, "top.v");

  const [adminContext, admin] = await device(browser, baseURL, ADMIN);
  const syncs: string[] = [];
  admin.on("request", (r) => {
    if (/\/v1\/projects\/[^/]+\/sync$/.test(new URL(r.url()).pathname)) syncs.push(r.url());
  });
  const viewIds = () => sim(admin, (api) => api.projects().filter((p) => p.view !== null));
  await openUserProjects(admin, user.login);
  const row = admin.locator(`[data-testid="user-project-row"][data-id="${id}"]`);
  await expect(row).toHaveAttribute("data-trashed", "false");
  await row.getByTestId("user-project-view").click();
  await expect(admin.getByTestId("project-name")).toHaveText("blink3");
  expect(await sim(admin, (api) => api.project())).toEqual({ name: "blink3", kind: "browser", view: user.login });
  await expect(admin.getByTestId("view-banner")).toContainText(user.login);
  expect(await sim(admin, (api) => api.sync())).toBeNull();
  await expect(admin.getByTestId("sync-status")).toHaveCount(0);
  expect(await build(admin)).toBe("ok");

  // An edit of the copy stays in the administrator browser: there are no sync requests of the copy or of the user project.
  await editAndSave(admin, "top.v", "// правка администратора\n");
  await syncNow(admin);
  const copyId = (await viewIds())[0]?.id ?? "";
  expect(copyId).not.toBe("");
  expect(syncs.filter((url) => url.includes(id) || url.includes(copyId))).toEqual([]);
  expect(await serverFile(request, userTok, id, "top.v")).toBe(original);
  const adminTok = await adminToken(request);
  expect((await serverProjects(request, adminTok)).some((p) => p.id === id)).toBe(false);

  // The "Viewing" group with the owner login; opening again replaces the copy.
  await admin.getByTestId("back").click();
  const views = admin.getByTestId("view-row");
  await expect(views).toHaveCount(1);
  await expect(views.getByTestId("view-owner")).toHaveText(user.login);
  const first = await views.getAttribute("data-id");
  await openUserProjects(admin, user.login);
  await admin.locator(`[data-testid="user-project-row"][data-id="${id}"]`).getByTestId("user-project-view").click();
  await expect(admin.getByTestId("project-name")).toHaveText("blink3");
  expect(await fileText(admin, "top.v")).toBe(original);
  await admin.getByTestId("back").click();
  await expect(views).toHaveCount(1);
  expect(await views.getAttribute("data-id")).not.toBe(first);
  expect((await viewIds()).map((p) => p.view)).toEqual([user.login]);
  await userContext.close();
  await adminContext.close();
});

test("«Сделать своей копией» создаёт проект администратора на сервере с новым идентификатором", async ({
  browser,
  baseURL,
  request,
}) => {
  const user: Login = await freshUser(request, "v");
  const [userContext, student] = await device(browser, baseURL, user);
  await userProject(student);
  const [project] = await serverProjects(request, await serverToken(request, user));
  const id = project?.id ?? "";

  const [adminContext, admin] = await device(browser, baseURL, ADMIN);
  await openUserProjects(admin, user.login);
  await admin.locator(`[data-testid="user-project-row"][data-id="${id}"]`).getByTestId("user-project-view").click();
  await expect(admin.getByTestId("project-name")).toHaveText("blink3");
  await admin.getByTestId("back").click();
  const view = admin.getByTestId("view-row");
  const viewId = await view.getAttribute("data-id");
  // The bench administrator account is shared: it may have its own projects. The copy is a new identifier.
  const before = (await sim(admin, (api) => api.projects())).map((p) => p.id);
  await view.getByTestId("project-claim").click();
  await expect(view).toHaveCount(0);
  await expect
    .poll(async () => (await sim(admin, (api) => api.projects())).filter((p) => !before.includes(p.id)).length)
    .toBe(1);
  const created = (await sim(admin, (api) => api.projects())).find((p) => !before.includes(p.id));
  const ownId = created?.id ?? "";
  expect(created).toMatchObject({ name: "blink3", view: null });
  expect(ownId).not.toBe(id);
  expect(ownId).not.toBe(viewId);
  await expect(admin.locator(`[data-testid="project-row"][data-id="${ownId}"]`)).toBeVisible();
  await syncNow(admin);
  await expect
    .poll(() => simWith(admin, ownId, (api, own) => api.projects().find((p) => p.id === own)))
    .toMatchObject({ view: null, sync: "synced" });
  expect(await sim(admin, (api) => api.projects().filter((p) => p.view !== null))).toEqual([]);
  const adminTok = await adminToken(request);
  const onServer = (await serverProjects(request, adminTok)).find((p) => p.id === ownId);
  expect(onServer).toMatchObject({ name: "blink3", deleted: false });
  expect(await serverFile(request, adminTok, ownId, "top.v")).toBe(
    await serverFile(request, await serverToken(request, user), id, "top.v"),
  );
  // The bench administrator account is shared: the copy is removed.
  await request.delete(`${SERVER}/v1/projects/${ownId}`, { headers: { Authorization: `Bearer ${adminTok}` } });
  await userContext.close();
  await adminContext.close();
});

test("«Вернуть из корзины» возвращает проект в список пользователя", async ({ browser, baseURL, request }) => {
  const user: Login = await freshUser(request, "v");
  const [userContext, student] = await device(browser, baseURL, user);
  await userProject(student);
  await student.getByTestId("back").click();
  await student.getByTestId("project-delete").click();
  await student.getByTestId("project-delete-confirm").click();
  await syncNow(student);
  const userTok = await serverToken(request, user);
  await expect.poll(async () => (await serverProjects(request, userTok)).map((p) => p.deleted)).toEqual([true]);
  const id = (await serverProjects(request, userTok))[0]?.id ?? "";
  expect(await projectNames(student)).toEqual([]);

  const [adminContext, admin] = await device(browser, baseURL, ADMIN);
  await openUserProjects(admin, user.login);
  const row = admin.locator(`[data-testid="user-project-row"][data-id="${id}"]`);
  await expect(row).toHaveAttribute("data-trashed", "true");
  await expect(row.getByTestId("user-project-state")).toHaveText("в корзине, сотрётся через 30 дн.");
  await row.getByTestId("user-project-restore").click();
  await expect(row).toHaveAttribute("data-trashed", "false");
  await expect(row.getByTestId("user-project-restore")).toHaveCount(0);

  expect((await serverProjects(request, userTok)).map((p) => p.deleted)).toEqual([false]);
  await syncNow(student);
  await expect.poll(() => projectNames(student)).toEqual(["blink3"]);
  await openProject(student, "blink3");
  await expect.poll(() => fileText(student, "top.v")).not.toBeNull();
  await userContext.close();
  await adminContext.close();
});
