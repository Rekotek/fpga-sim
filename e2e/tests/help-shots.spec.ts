// Screenshots for the help (decision 116). This is a capture, not a check: without the variable HELP_SHOTS the
// test is skipped. Run from the repository root:
//
//   HELP_SHOTS=1 e2e/run.sh tests/help-shots
//
// The test writes web/public/help/<name>-light.png and <name>-dark.png and the screenshot sizes
// to web/src/app/helpShots.json. With HELP_LANG=en it captures the English interface (decision 168):
// files <name>-<theme>-en.png and sizes in web/src/app/helpShots.en.json. The set of screenshots per help section is defined in web/src/app/HelpDialog.tsx.
import { mkdirSync, writeFileSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { USER, build, choose, createFromExample, openAs, openSettings, openWithKey, sim, simWith } from "./stand";

const OUT = new URL("../../web/public/help/", import.meta.url);
const LANG = process.env.HELP_LANG === "en" ? "en" : "ru";
const SUFFIX = LANG === "en" ? "-en" : "";
const SIZES = new URL(`../../web/src/app/helpShots${LANG === "en" ? ".en" : ""}.json`, import.meta.url);
const SCALE = 2;
const WIDTH = 1200;

test.skip(!process.env.HELP_SHOTS, "съёмка для справки: запускается с HELP_SHOTS=1");
test.use({
  viewport: { width: WIDTH, height: 760 },
  deviceScaleFactor: SCALE,
  locale: LANG === "en" ? "en-US" : "ru-RU",
});

const sizes: Record<string, [number, number]> = {};

async function setTheme(page: Page, theme: "light" | "dark"): Promise<void> {
  if ((await sim(page, (api) => api.theme().choice)) === theme) return;
  await page.getByTestId("theme-toggle").click();
  await page.getByTestId(`theme-${theme}`).click();
  await expect.poll(() => sim(page, (api) => api.theme().choice)).toBe(theme);
  // The menu closes with an animation: the next click on the switch waits for its end.
  await expect(page.getByTestId(`theme-${theme}`)).toHaveCount(0);
}

// Screenshot in both themes. target is the capture area: an element or the height of the top part of the page
// (without it, the whole page); open and close open and close a dialog: with a dialog open
// the theme switch is unavailable.
async function shoot(
  page: Page,
  name: string,
  target?: (() => Locator) | number,
  open?: () => Promise<void>,
  close?: () => Promise<void>,
): Promise<void> {
  for (const theme of ["light", "dark"] as const) {
    await setTheme(page, theme);
    // The "Theme" tooltip stays at the button while it has focus and the pointer: remove both.
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    });
    await page.mouse.move(0, 0);
    await open?.();
    // Radix menus and dialogs open with an animation, Canvas redraws after the theme change.
    await page.waitForTimeout(450);
    const png =
      typeof target === "function"
        ? await target().screenshot()
        : await page.screenshot(target ? { clip: { x: 0, y: 0, width: WIDTH, height: target } } : {});
    writeFileSync(new URL(`${name}-${theme}${SUFFIX}.png`, OUT), png);
    // The PNG size is in the IHDR header; the help takes the size in CSS pixels.
    sizes[name] = [Math.round(png.readUInt32BE(16) / SCALE), Math.round(png.readUInt32BE(20) / SCALE)];
    await close?.();
  }
  await setTheme(page, "light");
}

async function stepTo(page: Page, target: bigint): Promise<void> {
  const now = BigInt(await sim(page, (api) => api.state().time));
  await simWith(page, (target - now).toString(), (api, value) => api.command({ t: "step", unit: "time", ps: value }));
  await expect.poll(() => sim(page, (api) => api.state().time), { timeout: 60_000 }).toBe(target.toString());
  await expect.poll(() => sim(page, (api) => api.state().stepping)).toBe(false);
}

const signalRow = (page: Page, name: string) => page.locator(`[data-testid="signal-row"][data-name="${name}"]`);
// The whole bottom panel: the tab row and the tab content.
const bottom = (page: Page) => page.getByTestId("tab-messages").locator("xpath=../..");

test("снимки экрана для справки", async ({ page }) => {
  test.setTimeout(300_000);
  mkdirSync(OUT, { recursive: true });
  await page.emulateMedia({ colorScheme: "light" });
  // The screenshots show login by account: the account button and the icons of saving to the server.
  if (USER.password) await openAs(page, USER);
  else await openWithKey(page);

  // UART terminal: the example uart_hello prints a line every 100 ms.
  await createFromExample(page, "uart_hello");
  expect(await build(page)).toBe("ok");
  await expect.poll(() => sim(page, (api) => api.state().run)).toBe("paused");
  await stepTo(page, 250_000_000_000n);
  await page.getByTestId("tab-terminal-uart").click();
  await expect(page.getByTestId("terminal-output")).toContainText("Hello");
  await shoot(page, "terminal", () => bottom(page));
  await page.getByTestId("back").click();
  await expect(page.getByTestId("example-menu")).toBeVisible();

  // The other screenshots: example blink3 with internal signals and parts on the breadboard.
  await createFromExample(page, "blink3");
  await openSettings(page);
  await choose(page.getByTestId("settings-visibility"), "all");
  await page.getByTestId("settings-save").click();
  await expect(page.getByTestId("settings")).toHaveCount(0);
  expect(await build(page)).toBe("ok");
  await expect.poll(() => sim(page, (api) => api.state().run)).toBe("paused");

  await page.getByTestId("part-add").click();
  await choose(page.getByTestId("part-type"), "led");
  await choose(page.getByTestId("part-pin-in"), "15");
  await choose(page.getByTestId("setting-color"), "green");
  await page.getByTestId("part-save").click();
  await expect(page.getByTestId("part-dialog")).toHaveCount(0);
  await page.getByTestId("part-add").click();
  await choose(page.getByTestId("part-type"), "switch");
  await choose(page.getByTestId("part-pin-out"), "88");
  await page.getByTestId("part-save").click();
  await expect(page.getByTestId("part-dialog")).toHaveCount(0);

  await page.getByTestId("tab-signals").click();
  for (const name of ["pin:15", "pin:16", "top.q"]) await signalRow(page, name).getByTestId("signal-record").click();
  for (const name of ["top.cnt_a", "top.q", "pin:15"]) await signalRow(page, name).getByTestId("signal-watch").click();

  await page.getByTestId("tab-waves").click();
  await page.getByTestId("wave-start").click();
  await stepTo(page, 2_100_000_000_000n);
  await page.getByTestId("wave-stop").click();
  await page.getByTestId("wave-fit").click();
  await shoot(page, "waves", () => bottom(page));
  await shoot(page, "workspace");
  await shoot(page, "board", () => page.getByTestId("area-board"));

  await page.getByTestId("tab-signals").click();
  await shoot(page, "signals", () => bottom(page));

  await shoot(
    page,
    "binding",
    () => page.getByTestId("binding"),
    () => page.getByTestId("binding-open").click(),
    () => page.getByTestId("dialog-close").click(),
  );

  await page.getByTestId("tab-testbench").click();
  await page.getByTestId("testbench-run").click();
  await expect
    .poll(() => sim(page, (api) => api.testbench().status), { timeout: 60_000 })
    .not.toMatch(/^(none|running)$/);
  await shoot(page, "testbench", () => bottom(page));

  await page.getByTestId("back").click();
  await expect(page.getByTestId("project-list")).toBeVisible();
  await shoot(page, "projects", 300);

  const lines = Object.keys(sizes)
    .sort()
    .map((name) => `  ${JSON.stringify(name)}: [${sizes[name]?.join(", ") ?? ""}]`);
  writeFileSync(SIZES, `{\n${lines.join(",\n")}\n}\n`);
});
