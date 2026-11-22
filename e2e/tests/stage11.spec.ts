// Acceptance criteria of stage 11 (spec section 12) on the local bench: content security policy,
// quick help, lessons in the example list, four simultaneous sessions.
// make test-examples runs all lessons with expect.json; here one lesson of each kind.
import { expect, test } from "@playwright/test";
import { runLesson } from "./expect";
import { parallelSessions, watchProblems } from "./sessions";
import { build, createFromExample, openWithKey, sim } from "./stand";

test("статика отдаёт политику безопасности содержимого; сборка, пуск и редактор её не нарушают", async ({ page }) => {
  const problems = await watchProblems(page);
  // The headers are read by a separate request: the page opens once, by a link with the key.
  const response = await page.request.get("/");
  const policy = response.headers()["content-security-policy"] ?? "";
  expect(policy).toContain("default-src 'self'");
  expect(policy).toContain("script-src 'self' 'wasm-unsafe-eval' blob:");
  expect(policy).toMatch(/connect-src 'self' http\S+;/);
  expect(policy).not.toContain("'unsafe-eval'");
  expect(policy).toContain("worker-src 'self';");
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");

  await openWithKey(page);
  await createFromExample(page, "blink3");
  await page.locator(".cm-content").click();
  await page.keyboard.type("// правка\n");
  expect(await build(page)).toBe("ok");
  await page.getByTestId("run").click();
  await expect.poll(() => sim(page, (api) => api.state().cycle)).toBeGreaterThan(1000);
  // The policy works: a foreign address is closed to the request, and the violation reaches the observer.
  const blocked = await page.evaluate(() =>
    fetch("https://example.com/").then(
      () => false,
      () => true,
    ),
  );
  expect(blocked).toBe(true);
  // The violation message comes from the page by a separate call, a little after the request is refused.
  await expect.poll(() => problems.some((p) => p.startsWith("политика: connect-src"))).toBe(true);
  expect(problems.filter((p) => !p.includes("example.com"))).toEqual([]);
});

test("краткая справка открывается с экрана проектов и из рабочего места", async ({ page }) => {
  await openWithKey(page);
  await expect(page.getByTestId("help")).toBeHidden();
  await page.getByTestId("help-open").click();
  await expect(page.getByTestId("help")).toBeVisible();
  expect(await sim(page, (api) => api.help())).toEqual({
    open: true,
    sections: 8,
    shots: 8,
  });
  // Screenshots (decision 116): all loaded, the set matches the interface theme.
  const shots = () =>
    page
      .getByTestId("help-shot")
      .evaluateAll((list) => list.map((img) => (img as HTMLImageElement).naturalWidth > 0 && img.getAttribute("src")));
  const dark = await sim(page, (api) => api.theme().dark);
  await expect.poll(shots).toHaveLength(8);
  await expect
    .poll(async () => (await shots()).every((src) => src && src.endsWith(dark ? "-dark.png" : "-light.png")))
    .toBe(true);
  await expect(page.getByTestId("help-section")).toHaveCount(8);
  await expect(page.getByTestId("help")).toContainText("Ctrl+Enter");
  // No dictionary keys are left in the help text.
  await expect(page.getByTestId("help")).not.toContainText("help.");
  await page.getByTestId("help-close").click();
  await expect(page.getByTestId("help")).toBeHidden();
  expect(await sim(page, (api) => api.help().open)).toBe(false);

  await createFromExample(page, "blink3");
  await page.getByTestId("help-open").click();
  await expect(page.getByTestId("help")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("help")).toBeHidden();
  expect(await sim(page, (api) => api.help().open)).toBe(false);
});

test("список примеров: уроки 2–10 стоят отдельной группой перед примерами репозитория", async ({ page }) => {
  await openWithKey(page);
  const examples = await sim(page, (api) => api.examples());
  const lessons = examples.filter((e) => e.lesson).map((e) => e.name);
  expect(lessons).toHaveLength(32);
  expect(lessons[0]).toBe("lesson02_gates");
  expect(lessons.at(-1)).toBe("lesson10_uart");
  for (const n of ["02", "03", "04", "05", "06", "07", "08", "09", "10"])
    expect(
      lessons.some((name) => name.startsWith(`lesson${n}_`)),
      `урок ${n}`,
    ).toBe(true);
  expect(examples.filter((e) => !e.lesson).map((e) => e.name)).toContain("blink3");
  expect(examples.findIndex((e) => !e.lesson)).toBe(32);
  // The "From example" menu shows the same two groups and all list items.
  await page.getByTestId("example-menu").click();
  await expect(page.getByTestId("example-group")).toHaveCount(2);
  await expect(page.getByTestId("example-item")).toHaveCount(examples.length);
  await expect(page.getByTestId("example-group").first().getByTestId("example-item").first()).toHaveText(
    "lesson02_gates",
  );
  await page.keyboard.press("Escape");
});

// A clockless design with buttons, switches on the breadboard from fpgasim.json, UART with two design files,
// WS2812 with buttons.
for (const name of ["lesson02_gates", "lesson03_two_of_four", "lesson09_hello", "lesson10_buttons"]) {
  test(`${name}: собирается и проходит expect.json`, async ({ page }) => {
    await openWithKey(page);
    await runLesson(page, name);
  });
}

test("четыре одновременных сеанса собирают и запускают разные проекты без ошибок", async ({ browser, baseURL }) => {
  test.setTimeout(180_000);
  await parallelSessions(browser, baseURL ?? "", ["blink3", "uart_hello", "lesson05_runner", "lesson10_color"]);
});
