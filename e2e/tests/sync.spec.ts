// Acceptance criteria of stage 4 of docs/tz-accounts.md: project sync between devices.
// Two devices are two browser contexts of one account. The state is read through window.__fpgasim.
import { expect, test } from "@playwright/test";
import {
  device,
  edit,
  editAndSave,
  fileText,
  freshUser,
  openProject,
  projectNames,
  serverFile,
  serverProjects,
  serverToken,
  sharedProject,
  syncNow,
  syncState,
} from "./devices";
import { ADMIN, SERVER, USER, createFromExample, openAs, openWithKey, signIn, signOut, sim } from "./stand";

test.skip(!ADMIN.password || !USER.password, "стенд не завёл учётные записи (e2e/run.sh)");

test("проект первого устройства появляется на втором с теми же файлами; правка доходит после syncNow", async ({
  browser,
  baseURL,
  request,
}) => {
  const user = await freshUser(request, "s");
  const { a, b, contextA, contextB } = await sharedProject(browser, baseURL, user);
  const filesA = await sim(a, (api) => api.files());
  const filesB = await sim(b, (api) => api.files());
  expect(filesB).toEqual(filesA);
  expect(filesB.length).toBeGreaterThan(1);

  await editAndSave(a, "top.v", "// правка первого устройства\n");
  await syncNow(a);
  await syncNow(b);
  expect(await fileText(b, "top.v")).toBe("// правка первого устройства\n");
  await contextA.close();
  await contextB.close();
});

test("правки разных файлов на двух устройствах получают оба", async ({ browser, baseURL, request }) => {
  const user = await freshUser(request, "s");
  const { a, b, contextA, contextB } = await sharedProject(browser, baseURL, user);
  await editAndSave(a, "top.v", "// A\n");
  await editAndSave(b, "top.cst", "// B\n");
  await syncNow(a);
  await syncNow(b);
  await syncNow(a);
  for (const page of [a, b]) {
    expect(await fileText(page, "top.v")).toBe("// A\n");
    expect(await fileText(page, "top.cst")).toBe("// B\n");
    expect(await syncState(page)).toBe("synced");
  }
  await contextA.close();
  await contextB.close();
});

test("правка одного файла на двух устройствах: у второго расхождение, его текст не изменён", async ({
  browser,
  baseURL,
  request,
}) => {
  const user = await freshUser(request, "s");
  const { a, b, contextA, contextB } = await sharedProject(browser, baseURL, user);
  await editAndSave(a, "top.v", "// A\n");
  await editAndSave(b, "top.v", "// B\n");
  await syncNow(a);
  await syncNow(b);
  expect(await syncState(b)).toBe("conflict");
  expect(await sim(b, async (api) => (await api.sync())?.conflicts)).toEqual(["top.v"]);
  expect(await fileText(b, "top.v")).toBe("// B\n");
  await syncNow(a);
  expect(await fileText(a, "top.v")).toBe("// A\n");
  await contextA.close();
  await contextB.close();
});

test("второе устройство изменило файл с несохранённой правкой на первом: сохранение даёт расхождение", async ({
  browser,
  baseURL,
  request,
}) => {
  const user = await freshUser(request, "s");
  const { a, b, contextA, contextB } = await sharedProject(browser, baseURL, user);
  await edit(a, "top.v", "// правка A, не сохранена\n");
  await editAndSave(b, "top.v", "// B\n");
  await syncNow(b);
  await syncNow(a);
  // The editor edit stayed; the saved content came from the server.
  expect(await sim(a, (api) => api.editor().dirty)).toEqual(["top.v"]);
  expect(await fileText(a, "top.v")).toBe("// B\n");
  await a.keyboard.press("ControlOrMeta+s");
  await expect.poll(() => fileText(a, "top.v")).toBe("// правка A, не сохранена\n");
  await syncNow(a);
  expect(await syncState(a)).toBe("conflict");
  const token = await serverToken(request, user);
  const [project] = await serverProjects(request, token);
  expect(await serverFile(request, token, project?.id ?? "", "top.v")).toBe("// B\n");
  await contextA.close();
  await contextB.close();
});

test("обрыв сети: правка сохраняется в браузере, после возврата сети доходит до сервера сама", async ({
  browser,
  baseURL,
  request,
}) => {
  const user = await freshUser(request, "s");
  const [context, page] = await device(browser, baseURL, user);
  await createFromExample(page, "blink3");
  await syncNow(page);
  await expect.poll(() => syncState(page)).toBe("synced");

  await context.setOffline(true);
  await editAndSave(page, "top.v", "// без сети\n");
  await expect.poll(() => syncState(page), { timeout: 15_000 }).toBe("offline");
  expect(await fileText(page, "top.v")).toBe("// без сети\n");

  await context.setOffline(false);
  // The online event starts sync: there are no user actions and no syncNow.
  await expect.poll(() => syncState(page), { timeout: 30_000 }).toBe("synced");
  const token = await serverToken(request, user);
  const [project] = await serverProjects(request, token);
  expect(await serverFile(request, token, project?.id ?? "", "top.v")).toBe("// без сети\n");
  await context.close();
});

test("перезагрузка страницы с неотправленной правкой: правка уходит после загрузки", async ({
  browser,
  baseURL,
  request,
}) => {
  const user = await freshUser(request, "s");
  const [context, page] = await device(browser, baseURL, user);
  await createFromExample(page, "blink3");
  await syncNow(page);
  // Sync requests do not reach the server; the page and login work.
  await context.route(`${SERVER}/v1/projects/**`, (route) => route.abort());
  await editAndSave(page, "top.v", "// до перезагрузки\n");
  await expect.poll(() => sim(page, async (api) => (await api.sync())?.pending)).toEqual(["top.v"]);
  await page.reload();
  await expect(page.getByTestId("project-name")).toHaveText("blink3");
  // After loading the edit is still not sent: it could not go before the reload.
  await expect.poll(() => sim(page, async (api) => (await api.sync())?.pending)).toEqual(["top.v"]);
  const token = await serverToken(request, user);
  const [project] = await serverProjects(request, token);
  expect(await serverFile(request, token, project?.id ?? "", "top.v")).not.toBe("// до перезагрузки\n");
  await context.unroute(`${SERVER}/v1/projects/**`);
  await expect.poll(() => syncState(page), { timeout: 30_000 }).toBe("synced");
  expect(await serverFile(request, token, project?.id ?? "", "top.v")).toBe("// до перезагрузки\n");
  await context.close();
});

test("сервер не отвечал при загрузке страницы: после его возврата обмен начинается сам", async ({
  browser,
  baseURL,
  request,
}) => {
  test.setTimeout(120_000);
  const user = await freshUser(request, "s");
  const [context, page] = await device(browser, baseURL, user);
  await createFromExample(page, "blink3");
  await syncNow(page);
  await expect.poll(() => syncState(page)).toBe("synced");
  await context.route(`${SERVER}/**`, (route) => route.abort());
  await page.reload();
  // The project of the saved session is open, edit and save work without the server.
  await expect(page.getByTestId("project-name")).toHaveText("blink3");
  await editAndSave(page, "top.v", "// сервер не отвечал\n");
  expect(await sim(page, (api) => api.account().kind)).not.toBe("session");
  await context.unroute(`${SERVER}/**`);
  // No user actions: the login repeats itself, then the edit goes to the server.
  const token = await serverToken(request, user);
  const [project] = await serverProjects(request, token);
  await expect
    .poll(() => serverFile(request, token, project?.id ?? "", "top.v"), { timeout: 90_000 })
    .toBe("// сервер не отвечал\n");
  await expect.poll(() => syncState(page), { timeout: 15_000 }).toBe("synced");
  await context.close();
});

test("удаление проекта на первом устройстве убирает его из списка второго", async ({ browser, baseURL, request }) => {
  const user = await freshUser(request, "s");
  const { a, b, contextA, contextB } = await sharedProject(browser, baseURL, user);
  await b.getByTestId("back").click();
  await a.getByTestId("back").click();
  await a.getByTestId("project-delete").click();
  await a.getByTestId("project-delete-confirm").click();
  await expect.poll(() => projectNames(a)).toEqual([]);
  await syncNow(a);
  await syncNow(b);
  await expect.poll(() => projectNames(b)).toEqual([]);
  const token = await serverToken(request, user);
  expect((await serverProjects(request, token)).map((p) => p.deleted)).toEqual([true]);
  await contextA.close();
  await contextB.close();
});

test("проект удалён на другом устройстве, а здесь есть несохранённая правка: проект остаётся под новым идентификатором", async ({
  browser,
  baseURL,
  request,
}) => {
  const user = await freshUser(request, "s");
  const { a, b, contextA, contextB } = await sharedProject(browser, baseURL, user);
  const before = (await sim(b, (api) => api.projects()))[0]?.id;
  await edit(b, "top.v", "// правка, которую нельзя потерять\n");
  await a.getByTestId("back").click();
  await a.getByTestId("project-delete").click();
  await a.getByTestId("project-delete-confirm").click();
  await syncNow(a);
  await syncNow(b);
  await expect(b.getByTestId("project-name")).toHaveText("blink3");
  await expect.poll(() => sim(b, (api) => api.editor().dirty)).toEqual(["top.v"]);
  const after = await sim(b, (api) => api.projects());
  expect(after.length).toBe(1);
  expect(after[0]?.id).not.toBe(before);
  // The edit text is intact: saving makes it the content of the file of the new project.
  await b.keyboard.press("ControlOrMeta+s");
  await expect.poll(() => fileText(b, "top.v")).toBe("// правка, которую нельзя потерять\n");
  await contextA.close();
  await contextB.close();
});

test("первый вход записи принимает ничьи проекты: они появляются на сервере", async ({ page, request }) => {
  const user = await freshUser(request, "s");
  await openWithKey(page);
  await createFromExample(page, "blink3");
  await page.getByTestId("back").click();
  await signOut(page);
  await signIn(page, user.login, user.password);
  await expect.poll(() => projectNames(page)).toEqual(["blink3"]);
  const token = await serverToken(request, user);
  await expect.poll(async () => (await serverProjects(request, token)).map((p) => p.name)).toEqual(["blink3"]);
  await expect
    .poll(() => sim(page, (api) => api.projects().map((p) => p.sync)), { timeout: 15_000 })
    .toEqual(["synced"]);
});

test("проект, открытый в одной вкладке, во второй вкладке того же браузера не открывается", async ({
  browser,
  baseURL,
  request,
}) => {
  const user = await freshUser(request, "s");
  const [context, first] = await device(browser, baseURL, user);
  await createFromExample(first, "blink3");
  await syncNow(first);
  const second = await context.newPage();
  await second.goto("/?debug=1");
  await expect.poll(() => projectNames(second)).toEqual(["blink3"]);
  await second.getByTestId("project-row").filter({ hasText: "blink3" }).getByTestId("project-open").click();
  await expect(second.getByTestId("project-busy")).toBeVisible();
  expect(await sim(second, (api) => api.busyProject())).toBe("blink3");
  expect(await sim(second, (api) => api.project())).toBeNull();
  // After the project is closed in the first tab, the second tab opens it.
  await first.getByTestId("back").click();
  await openProject(second, "blink3");
  await context.close();
});

test("вход по ключу запросов /v1/projects не делает", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(new URL(request.url()).pathname));
  await openWithKey(page);
  await createFromExample(page, "blink3");
  await editAndSave(page, "top.v", "// по ключу\n");
  expect(await sim(page, (api) => api.sync())).toBeNull();
  await sim(page, (api) => api.syncNow());
  await page.getByTestId("back").click();
  await expect.poll(() => projectNames(page)).toEqual(["blink3"]);
  expect(requests.filter((path) => path.startsWith("/v1/projects"))).toEqual([]);
  expect(requests.some((path) => path === "/v1/info")).toBe(true);
});

test("проект записи USER стенда синхронизируется и убирается за собой", async ({ page, request }) => {
  // A permanent bench account: checks that login of an existing account with projects on the server works.
  await openAs(page, USER);
  await createFromExample(page, "buttons");
  await syncNow(page);
  await expect.poll(() => syncState(page)).toBe("synced");
  await page.getByTestId("back").click();
  const row = page.getByTestId("project-row").filter({ hasText: "buttons" }).first();
  await row.getByTestId("project-delete").click();
  await page.getByTestId("project-delete-confirm").click();
  await syncNow(page);
  const token = await serverToken(request, USER);
  expect((await serverProjects(request, token)).filter((p) => !p.deleted)).toEqual([]);
});

test("проект в папке при входе по сеансу запросов sync не делает", async ({ page, request }) => {
  const user = await freshUser(request, "s");
  // The lesson folder from the private browser storage instead of the folder choice dialog (as in the stage 10 tests).
  await page.addInitScript(() => {
    const proto = FileSystemHandle.prototype as unknown as Record<string, unknown>;
    proto.queryPermission = () => Promise.resolve("granted");
    proto.requestPermission = () => Promise.resolve("granted");
    (window as unknown as Record<string, unknown>).showDirectoryPicker = async () => {
      const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle("lesson", { create: true });
      const writable = await (await dir.getFileHandle("top.v", { create: true })).createWritable();
      await writable.write("module top; endmodule\n");
      await writable.close();
      return dir;
    };
  });
  const synced: string[] = [];
  page.on("request", (r) => {
    if (/\/v1\/projects\/[^/]+\/sync$/.test(new URL(r.url()).pathname)) synced.push(r.url());
  });
  await openAs(page, user);
  await page.getByTestId("folder-open").click();
  await expect(page.getByTestId("project-name")).toHaveText("lesson");
  expect(await sim(page, (api) => api.project()?.kind)).toBe("folder");
  await editAndSave(page, "top.v", "module top; wire a; endmodule\n");
  expect(await sim(page, (api) => api.sync())).toBeNull();
  await syncNow(page);
  expect(synced).toEqual([]);
  const token = await serverToken(request, user);
  expect(await serverProjects(request, token)).toEqual([]);
});
