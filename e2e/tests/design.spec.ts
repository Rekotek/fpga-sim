// Interface design (decisions 111-115, 182): build label, "Run" with a build, one run and pause button,
// theme, pinned help heading, project menu and file rows, the tab icon.
import { expect, test } from "@playwright/test";
import { build, createFromExample, fileAction, openProjectMenu, openWithKey, sim } from "./stand";

const badge = (page: import("@playwright/test").Page) => page.getByTestId("build-badge");

test("«Пуск» собирает несобранный проект; правка ставит метку «изменён после сборки»", async ({ page }) => {
  await openWithKey(page);
  await createFromExample(page, "blink3");
  await expect(badge(page)).toHaveAttribute("data-state", "none");
  expect(await sim(page, (api) => api.state().stale)).toBe(false);

  // The project is not built: "Run" builds it and starts the simulation. "Pause" takes the place of "Run".
  await page.getByTestId("run").click();
  await expect.poll(() => sim(page, (api) => api.state().run), { timeout: 60_000 }).toBe("running");
  expect(await sim(page, (api) => api.state().builds)).toBe(1);
  await expect(badge(page)).toHaveAttribute("data-state", "ok");
  await expect(page.getByTestId("run")).toHaveCount(0);
  await page.getByTestId("pause").click();
  await expect.poll(() => sim(page, (api) => api.state().run)).toBe("paused");
  await expect(page.getByTestId("pause")).toHaveCount(0);

  // A built project without edits: "Run" only starts, no build.
  await page.getByTestId("run").click();
  await expect.poll(() => sim(page, (api) => api.state().run)).toBe("running");
  expect(await sim(page, (api) => api.state().builds)).toBe(1);
  await page.getByTestId("pause").click();

  // File edit: the simulation runs on the previous build, the label says so.
  await page.locator(".cm-content").click();
  await page.keyboard.type("// правка\n");
  await expect(badge(page)).toHaveAttribute("data-state", "stale");
  expect(await sim(page, (api) => api.state().stale)).toBe(true);
  // Undoing the edit brings the label back: the content is compared, not the fact of typing.
  await page.keyboard.press("ControlOrMeta+z");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(badge(page)).toHaveAttribute("data-state", "ok");

  // "Run" on a changed project builds it again.
  await page.keyboard.type("// правка\n");
  await expect(badge(page)).toHaveAttribute("data-state", "stale");
  await page.getByTestId("run").click();
  await expect.poll(() => sim(page, (api) => api.state().builds), { timeout: 60_000 }).toBe(2);
  await expect.poll(() => sim(page, (api) => api.state().run), { timeout: 60_000 }).toBe("running");
  await expect(badge(page)).toHaveAttribute("data-state", "ok");

  // An error in the code: "Run" builds, the build fails, the previous simulation stays.
  await page.getByTestId("pause").click();
  await page.locator(".cm-content").click();
  await page.keyboard.type("ошибка\n");
  await page.getByTestId("run").click();
  await expect(badge(page)).toHaveAttribute("data-state", "failed", { timeout: 60_000 });
  expect(await sim(page, (api) => api.bottomTab())).toBe("messages");
  expect(await sim(page, (api) => api.state().loaded)).toBe(true);
});

test("привязка и детали метку сборки не меняют", async ({ page }) => {
  await openWithKey(page);
  await createFromExample(page, "blink3");
  expect(await build(page)).toBe("ok");
  await page.getByTestId("part-add").click();
  await page.getByTestId("part-save").click();
  await expect.poll(() => sim(page, (api) => api.parts().some((p) => p.origin === "breadboard"))).toBe(true);
  await expect(badge(page)).toHaveAttribute("data-state", "ok");
});

test("тема переключается и запоминается в браузере", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await openWithKey(page);
  expect(await sim(page, (api) => api.theme())).toEqual({ choice: "system", dark: false });
  await page.getByTestId("theme-toggle").click();
  await page.getByTestId("theme-dark").click();
  expect(await sim(page, (api) => api.theme())).toEqual({ choice: "dark", dark: true });
  await expect(page.locator("html")).toHaveClass(/dark/);
  const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const dark = await background();

  await page.reload();
  await expect(page.getByTestId("example-menu")).toBeVisible();
  expect(await sim(page, (api) => api.theme())).toEqual({ choice: "dark", dark: true });
  // The drawing and the editor open in the dark theme without errors.
  await createFromExample(page, "blink3");
  await expect(page.getByTestId("board")).toBeVisible();

  // "System" follows the system setting.
  await page.getByTestId("theme-toggle").click();
  await page.getByTestId("theme-system").click();
  expect(await sim(page, (api) => api.theme())).toEqual({ choice: "system", dark: false });
  expect(await background()).not.toBe(dark);
  await page.emulateMedia({ colorScheme: "dark" });
  await expect.poll(() => sim(page, (api) => api.theme().dark)).toBe(true);
});

test("справка: заголовок с кнопкой закрытия остаётся на месте при прокрутке", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 600 });
  await openWithKey(page);
  await page.getByTestId("help-open").click();
  await expect(page.getByTestId("help")).toBeVisible();
  // The window opens with an animation: the button position is read after it.
  await page.waitForTimeout(400);
  const before = await page.getByTestId("help-close").boundingBox();
  await page.getByTestId("help-section").last().scrollIntoViewIfNeeded();
  await expect(page.getByTestId("help-section").last()).toBeInViewport();
  expect(await page.getByTestId("help-close").boundingBox()).toEqual(before);
  await expect(page.getByTestId("help-close")).toBeInViewport();
  await page.getByTestId("help-close").click();
  await expect(page.getByTestId("help")).toBeHidden();
});

test("меню проекта: переименование; меню строки файла: переименование и удаление", async ({ page }) => {
  await openWithKey(page);
  await createFromExample(page, "blink3");
  await openProjectMenu(page);
  await page.getByTestId("project-rename").click();
  await expect(page.getByTestId("project-name-input")).toBeFocused();
  await page.getByTestId("project-name-input").fill("blink_new");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("project-name")).toHaveText("blink_new");
  expect((await sim(page, (api) => api.project()))?.name).toBe("blink_new");

  const names = () => page.getByTestId("file-path").allInnerTexts();
  await page.getByTestId("file").filter({ hasText: "tb_top.v" }).click();
  await fileAction(page, "rename");
  await expect(page.getByTestId("file-name-input")).toBeFocused();
  await page.getByTestId("file-name-input").fill("tb_main.v");
  await page.keyboard.press("Enter");
  await expect.poll(names).toEqual(["tb_main.v", "top.cst", "top.v"]);
  // The right mouse button opens the same menu.
  await page.getByTestId("file").filter({ hasText: "tb_main.v" }).click({ button: "right" });
  await page.getByRole("menuitem").filter({ hasText: "Удалить" }).click();
  await page.getByTestId("file-delete-confirm").click();
  await expect.poll(names).toEqual(["top.cst", "top.v"]);
});

test("у вкладки есть иконка FPGA SIM", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute("href", "/favicon.svg");
  const icon = await request.get("/favicon.svg");
  expect(icon.ok()).toBe(true);
  expect(icon.headers()["content-type"]).toContain("image/svg+xml");
  expect(await icon.text()).toContain("<svg");
});
