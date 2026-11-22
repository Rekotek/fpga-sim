// Tang Nano 9K board (spec section 3.3): board choice when creating a project, example buttons_9k,
// drawing from the board file, button key with active zero.
import { expect, test } from "@playwright/test";
import { checkExpect, readExpect } from "./expect";
import { build, choose, createFromExample, openSettings, openWithKey, replaceEditorText, sim, simWith } from "./stand";

test("«Новый проект»: меню называет обе платы; 9K записывается в fpgasim.json", async ({ page }) => {
  await openWithKey(page);
  await page.getByTestId("project-new").click();
  const items = page.getByTestId("project-new-board");
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toHaveAttribute("data-board", "tang-nano-20k");
  await page.locator('[data-testid="project-new-board"][data-board="tang-nano-9k"]').click();
  await expect(page.getByTestId("project-name")).toBeVisible();
  expect(await sim(page, (api) => api.board())).toBe("tang-nano-9k");
  expect(JSON.parse((await sim(page, (api) => api.file("fpgasim.json"))) ?? "{}")).toEqual({
    format: 1,
    board: "tang-nano-9k",
  });
  // The drawing follows the 9K file: button S1 on pin 3, no built-in WS2812, headers of 24 contacts each.
  const parts = await sim(page, (api) => api.parts());
  expect(parts.find((p) => p.id === "s1")?.pins).toEqual({ out: 3 });
  expect(parts.some((p) => p.type === "ws2812")).toBe(false);
  const pins = await sim(page, (api) => api.pins().map((p) => p.pin));
  expect(pins).toHaveLength(45);
  expect(pins).toContain(63);
  expect(pins).not.toContain(88);
});

test("«Новый проект» с платой 20K: файла fpgasim.json нет", async ({ page }) => {
  await openWithKey(page);
  await page.getByTestId("project-new").click();
  await page.locator('[data-testid="project-new-board"][data-board="tang-nano-20k"]').click();
  await expect(page.getByTestId("project-name")).toBeVisible();
  expect(await sim(page, (api) => api.board())).toBe("tang-nano-20k");
  expect(await sim(page, (api) => api.files().map((f) => f.path))).toEqual(["top.v"]);
});

// Decision 167: the board changes in "Project settings"; the board field goes into fpgasim.json, the drawing
// is built again, the project entry in the list gets the new board.
test("«Настройки проекта»: смена платы 20K → 9K → 20K", async ({ page }) => {
  await openWithKey(page);
  await page.getByTestId("project-new").click();
  await page.locator('[data-testid="project-new-board"][data-board="tang-nano-20k"]').click();
  await expect(page.getByTestId("project-name")).toBeVisible();
  await openSettings(page);
  await expect(page.getByTestId("settings-board-note")).toHaveCount(0);
  await choose(page.getByTestId("settings-board"), "tang-nano-9k");
  await expect(page.getByTestId("settings-board-note")).toContainText("Tang Nano 20K");
  await page.getByTestId("settings-save").click();
  await expect(page.getByTestId("settings")).toHaveCount(0);
  expect(await sim(page, (api) => api.board())).toBe("tang-nano-9k");
  expect(JSON.parse((await sim(page, (api) => api.file("fpgasim.json"))) ?? "{}")).toEqual({
    format: 1,
    board: "tang-nano-9k",
  });
  // The drawing follows the 9K file: button S1 on pin 3, no built-in WS2812.
  const parts9k = await sim(page, (api) => api.parts());
  expect(parts9k.find((p) => p.id === "s1")?.pins).toEqual({ out: 3 });
  expect(parts9k.some((p) => p.type === "ws2812")).toBe(false);
  expect(await sim(page, (api) => api.pins().map((p) => p.pin))).toContain(63);
  // Back to 20K: the default board is not written to the file.
  await openSettings(page);
  await choose(page.getByTestId("settings-board"), "tang-nano-20k");
  await page.getByTestId("settings-save").click();
  await expect(page.getByTestId("settings")).toHaveCount(0);
  expect(await sim(page, (api) => api.board())).toBe("tang-nano-20k");
  expect(JSON.parse((await sim(page, (api) => api.file("fpgasim.json"))) ?? "{}")).toEqual({ format: 1 });
  const parts20k = await sim(page, (api) => api.parts());
  expect(parts20k.find((p) => p.id === "s1")?.pins).toEqual({ out: 88 });
  expect(parts20k.some((p) => p.type === "ws2812")).toBe(true);
});

test("buttons_9k: проект открывается с платой 9K, собирается и проходит expect.json", async ({ page }) => {
  await openWithKey(page);
  await createFromExample(page, "buttons_9k");
  expect(await sim(page, (api) => api.board())).toBe("tang-nano-9k");
  expect(await build(page)).toBe("ok");
  await expect.poll(() => sim(page, (api) => api.state().run)).toBe("paused");
  expect(await sim(page, (api) => api.diagnostics().filter((d) => d.severity === "error"))).toEqual([]);
  await checkExpect(page, readExpect("examples/buttons_9k"));
});

test("buttons_9k: клавиша «2» нажимает S2 — вывод 4 идёт в ноль, отпускание возвращает единицу", async ({ page }) => {
  await openWithKey(page);
  await createFromExample(page, "buttons_9k");
  expect(await build(page)).toBe("ok");
  await page.getByTestId("run").click();
  await expect.poll(() => sim(page, (api) => api.state().run)).toBe("running");
  await page.getByTestId("board").click({ position: { x: 4, y: 4 } });
  const level = () => simWith(page, 4, (api, pin) => api.net(pin)?.level ?? -1);
  await expect.poll(level).toBe(1);
  await page.keyboard.down("2");
  await expect.poll(level).toBe(0);
  await page.keyboard.up("2");
  await expect.poll(level).toBe(1);
});

// Decision 163: the board has pull-up resistors on the buttons, so a released button gives 1 even without PULL_MODE.
test("buttons_9k без PULL_MODE: отпущенные кнопки читаются как 1, счётчик идёт", async ({ page }) => {
  await openWithKey(page);
  await createFromExample(page, "buttons_9k");
  await page.locator('[data-testid="file"]', { hasText: "top.cst" }).click();
  await replaceEditorText(
    page,
    'IO_LOC "clk" 52;\nIO_LOC "btn_s1" 3;\nIO_LOC "btn_s2" 4;\nIO_LOC "led[0]" 10;\nIO_LOC "led[1]" 11;\n',
  );
  expect(await build(page)).toBe("ok");
  expect(await sim(page, (api) => api.file("top.cst"))).not.toContain("PULL_MODE");
  await simWith(page, "600000000000", (api, ps) => api.command({ t: "step", unit: "time", ps }));
  await expect.poll(() => sim(page, (api) => api.state().time), { timeout: 60_000 }).toBe("600000000000");
  expect(await simWith(page, 3, (api, pin) => api.net(pin)?.level)).toBe(1);
  expect(await simWith(page, 4, (api, pin) => api.net(pin)?.level)).toBe(1);
  // In 0.6 s the counter added 1 twice: LED0 switched twice.
  expect(await simWith(page, 10, (api, pin) => api.net(pin)?.toggles)).toBe(2);
});
