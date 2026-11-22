// Acceptance criteria of stage 4 (spec section 12).
import { expect, test } from "@playwright/test";
import { KEY, build, createFromExample, openWithKey, replaceEditorText, sim, simWith } from "./stand";

// Speed ratio: the one accepted at stage 0 (1.45x, decision 11) minus 20%.
const MIN_RATIO = 1.16;

// Without a key and a session the login form shows (accounts spec section 5.1, docs/tz-accounts.md); a wrong key from the link is rejected with an explanation.
test("без ключа и сеанса видна форма входа; неверный ключ из ссылки отклоняется с пояснением", async ({ page }) => {
  await page.goto("/?debug=1");
  await expect(page.getByTestId("login-form")).toBeVisible();
  await expect(page.getByTestId("example-menu")).toHaveCount(0);

  await page.goto("about:blank");
  await page.goto("/?debug=1#key=not-a-key");
  await expect(page.getByTestId("login-problem")).toContainText("Ключ из ссылки не действует");
  await expect(page.getByTestId("login-form")).toBeVisible();
  await expect(page.getByTestId("example-menu")).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("fpgasim.key"))).toBeNull();

  await page.goto("about:blank");
  await page.goto(`/?debug=1#key=${encodeURIComponent(KEY)}`);
  await expect(page.getByTestId("example-menu")).toBeVisible();
  await expect(page.getByTestId("login-form")).toHaveCount(0);

  // The accepted key is stored: after a reload no login is needed.
  await page.reload();
  await expect(page.getByTestId("example-menu")).toBeVisible();
});

test("ссылка с ключом записывает ключ и убирает его из адресной строки", async ({ page }) => {
  await openWithKey(page);
  expect(page.url()).not.toContain("key=");
  expect(page.url()).not.toContain(KEY);
});

test("blink3 из примера собирается и запускается, уровни меняются со скоростью не ниже принятой", async ({ page }) => {
  await openWithKey(page);
  await createFromExample(page, "blink3");
  expect(await build(page)).toBe("ok");
  expect(await sim(page, (api) => api.diagnostics().filter((d) => d.severity === "error"))).toEqual([]);
  await expect.poll(() => sim(page, (api) => api.state().run)).toBe("paused");
  expect(await sim(page, (api) => api.net(15)?.toggles)).toBe(0);

  await page.getByTestId("run").click();
  await expect.poll(() => sim(page, (api) => api.state().run)).toBe("running");
  await sim(page, (api) => api.command({ t: "speed", speed: "max" }));
  const before = await sim(page, (api) => ({
    time: api.state().time,
    real: performance.now(),
  }));
  await page.waitForTimeout(3000);
  const after = await sim(page, (api) => ({
    time: api.state().time,
    real: performance.now(),
    ratio: api.state().ratio,
    toggles: api.net(15)?.toggles ?? -1,
  }));

  const measured = Number(BigInt(after.time) - BigInt(before.time)) / 1e9 / (after.real - before.real);
  console.log(
    `blink3: отношение скорости ${measured.toFixed(2)}× за 3 с, в последнем кадре ${after.ratio.toFixed(2)}×`,
  );
  expect(after.toggles).toBeGreaterThanOrEqual(4);
  expect(measured).toBeGreaterThanOrEqual(MIN_RATIO);
  expect(after.ratio).toBeGreaterThanOrEqual(MIN_RATIO);

  // The net table ("Nets" tab of the bottom panel) shows the same as window.__fpgasim gives:
  // pin 15 is led[0].
  await page.getByTestId("tab-nets").click();
  const row = page.getByTestId("nets").locator("tbody tr").filter({ hasText: "led[0]" });
  await expect(row.locator("td").first()).toHaveText("15");
  await expect
    .poll(async () => Number((await row.locator("td").nth(4).innerText()).replace(/\s/g, "")))
    .toBeGreaterThanOrEqual(4);

  await page.getByTestId("pause").click();
  await expect.poll(() => sim(page, (api) => api.state().run)).toBe("paused");
});

const BROKEN = `module top (
    input  wire       clk,
    output wire [5:0] led
);
    assign led = 6'b111111 + ;
endmodule
`;

test("ошибка в коде: состояние failed, метка на строке, щелчок по сообщению переводит курсор", async ({ page }) => {
  await openWithKey(page);
  await createFromExample(page, "blink3");
  await replaceEditorText(page, BROKEN);
  expect(await build(page)).toBe("failed");

  const errors = await sim(page, (api) => api.diagnostics().filter((d) => d.severity === "error"));
  expect(errors.length).toBeGreaterThan(0);
  expect(errors[0]).toMatchObject({ file: "top.v", line: 5 });

  // The editor itself went to the first error, its line has a marker.
  const shown = await sim(page, (api) => api.editor());
  expect(shown.path).toBe("top.v");
  expect(shown.line).toBe(5);
  expect(shown.marks).toContainEqual({ line: 5, severity: "error" });
  await expect(page.locator(".cm-lint-marker-error")).toHaveCount(1);

  // The cursor is moved off the error line and to another file; a click on the message brings it back.
  await page.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+Home");
  expect((await sim(page, (api) => api.editor())).line).toBe(1);
  await page.getByTestId("file").filter({ hasText: "top.cst" }).click();
  expect((await sim(page, (api) => api.editor())).path).toBe("top.cst");
  await page.getByTestId("message").first().click();
  const back = await sim(page, (api) => api.editor());
  expect(back.path).toBe("top.v");
  expect(back.line).toBe(5);
  expect(back.column).toBe(errors[0]?.column ?? 1);
});

test("перезагрузка страницы сохраняет проект и несохранённую правку", async ({ page }) => {
  await openWithKey(page);
  await createFromExample(page, "blink3");
  const edited = "// несохранённая правка\nmodule top;\nendmodule\n";
  await replaceEditorText(page, edited);
  await expect.poll(() => sim(page, (api) => api.editor().dirty)).toEqual(["top.v"]);
  // The edit goes to storage 300 ms after typing.
  await page.waitForTimeout(600);

  await page.reload();
  await expect(page.getByTestId("project-name")).toHaveText("blink3");
  await expect(page.locator(".cm-content")).toContainText("несохранённая правка");
  expect(await sim(page, (api) => api.editor())).toMatchObject({
    path: "top.v",
    dirty: ["top.v"],
  });
  await expect(page.getByTestId("file").filter({ hasText: "top.cst" })).toBeVisible();

  // The project stayed in the project list too.
  await page.getByTestId("back").click();
  await expect(page.getByTestId("project-row")).toHaveCount(1);
});

// Regression: the edit is already in storage, it was undone and saved sooner than
// the undo write fired after 300 ms. Saving must erase the edit from storage, or after
// a reload the undone edit comes back as unsaved.
test("правку отменили и сразу сохранили: после перезагрузки правки нет", async ({ page }) => {
  await openWithKey(page);
  await createFromExample(page, "blink3");
  const original = await page.locator(".cm-content").innerText();
  await replaceEditorText(page, "// отменённая правка\nmodule top;\nendmodule\n");
  await expect.poll(() => sim(page, (api) => api.editor().dirty)).toEqual(["top.v"]);
  // The edit goes to storage 300 ms after typing.
  await page.waitForTimeout(600);

  // Undo and save go one after another, without a pause: the timed undo write has not fired yet.
  await page.keyboard.press("ControlOrMeta+z");
  await page.keyboard.press("ControlOrMeta+s");
  // The "unsaved" mark is cleared by the undo already, so the end of the write is not visible by it. We wait
  // for the write to storage; without the fix it is absent altogether: saving cancels the undo timer.
  await page.waitForTimeout(600);
  expect(await sim(page, (api) => api.editor().dirty)).toEqual([]);

  await page.reload();
  await expect(page.getByTestId("project-name")).toHaveText("blink3");
  await expect(page.locator(".cm-content")).not.toContainText("отменённая правка");
  expect(await page.locator(".cm-content").innerText()).toBe(original);
  expect(await sim(page, (api) => api.editor())).toMatchObject({ path: "top.v", dirty: [] });
});

// Decision 107: portions run back to back at any multiplier while the core cannot keep up with the target. The multiplier
// 1000 is unreachable for blink3, so the speed at it must be close to the speed at `max`.
// With portions called only by the timer (12 ms of counting out of 16) it would be about 75% of `max`.
test("недостижимый множитель даёт скорость, близкую к скорости при max", async ({ page }) => {
  await openWithKey(page);
  await createFromExample(page, "blink3");
  expect(await build(page)).toBe("ok");
  await page.getByTestId("run").click();
  await expect.poll(() => sim(page, (api) => api.state().run)).toBe("running");

  const measure = async (speed: number | "max"): Promise<number> => {
    await simWith(page, speed, (api, value) => api.command({ t: "speed", speed: value }));
    await page.waitForTimeout(500);
    const read = () => sim(page, (api) => ({ time: api.state().time, real: performance.now() }));
    const before = await read();
    await page.waitForTimeout(3000);
    const after = await read();
    return Number(BigInt(after.time) - BigInt(before.time)) / 1e9 / (after.real - before.real);
  };
  const atMax = await measure("max");
  const atFixed = await measure(1000);
  console.log(`blink3: ${atMax.toFixed(2)}× при max, ${atFixed.toFixed(2)}× при множителе 1000`);
  expect(atFixed).toBeLessThan(1000);
  expect(atFixed).toBeGreaterThanOrEqual(atMax * 0.9);
});
