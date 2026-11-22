// Acceptance criteria of stage 7 (spec section 12): UART and WS2812 parts, the terminal tab.
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { build, choose, createFromExample, openWithKey, sim, simWith } from "./stand";

type Matcher = number | string | boolean | { min?: number; max?: number };

interface PartExpect {
  text?: string;
  bytes?: number[];
  colors?: string[];
  errors?: number;
  events?: (string | { event: string; data?: Record<string, Matcher> })[];
}

interface Expect {
  run: { ps: string };
  actions: { atPs: string; part: string; cmd: string; args?: Record<string, unknown> }[];
  parts: Record<string, PartExpect>;
}

const readExpect = (name: string): Expect =>
  JSON.parse(readFileSync(new URL(`../../examples/${name}/expect.json`, import.meta.url), "utf8")) as Expect;

const part = (page: Page, id: string) => simWith(page, id, (api, name) => api.part(name));
const events = (page: Page, id: string) => simWith(page, id, (api, name) => api.partEvents(name));
const builds = (page: Page) => sim(page, (api) => api.state().builds);
const terminalText = async (page: Page, id: string): Promise<string> =>
  String.fromCharCode(...((await part(page, id))?.terminal ?? []));

// Step to the given simulation time and waiting for its end.
async function stepTo(page: Page, target: bigint): Promise<void> {
  await expect.poll(() => sim(page, (api) => api.state().stepping)).toBe(false);
  const now = BigInt(await sim(page, (api) => api.state().time));
  if (target <= now) return;
  await simWith(page, (target - now).toString(), (api, value) => api.command({ t: "step", unit: "time", ps: value }));
  await expect.poll(() => sim(page, (api) => api.state().time), { timeout: 60_000 }).toBe(target.toString());
  await expect.poll(() => sim(page, (api) => api.state().stepping)).toBe(false);
}

async function openExample(page: Page, name: string): Promise<void> {
  await openWithKey(page);
  await createFromExample(page, name);
  expect(await build(page)).toBe("ok");
  await expect.poll(() => sim(page, (api) => api.state().run)).toBe("paused");
}

function matches(want: Matcher, got: unknown): boolean {
  if (typeof want !== "object") return got === want;
  return typeof got === "number" && got >= (want.min ?? got) && got <= (want.max ?? got);
}

// Runs the expect.json of the example in the browser (spec section 11.2): actions, run, expectations for parts.
// The same check is in tools/headless/run.mjs and tools/native/run_examples.py.
async function runExpect(page: Page, name: string): Promise<void> {
  const expected = readExpect(name);
  await openExample(page, name);
  for (const action of expected.actions) {
    await stepTo(page, BigInt(action.atPs));
    await simWith(page, action, (api, a) => api.command({ t: "part", part: a.part, cmd: a.cmd, args: a.args ?? {} }));
  }
  await stepTo(page, BigInt(expected.run.ps));
  for (const [id, want] of Object.entries(expected.parts)) {
    const got = await part(page, id);
    expect(got, `деталь ${id}`).not.toBeNull();
    if (want.text !== undefined) expect(await terminalText(page, id)).toBe(want.text);
    if (want.bytes !== undefined) expect(got?.terminal).toEqual(want.bytes);
    if (want.colors !== undefined) expect(got?.colors).toEqual(want.colors);
    if (want.errors !== undefined) expect(got?.errors).toBe(want.errors);
    const wanted = (want.events ?? []).map((e) => (typeof e === "string" ? { event: e } : e));
    const seen = await events(page, id);
    expect([...new Set(seen.map((e) => e.event))].sort()).toEqual([...new Set(wanted.map((e) => e.event))].sort());
    for (const item of wanted) {
      const fields = Object.entries(item.data ?? {});
      const found = seen.some((e) => e.event === item.event && fields.every(([k, v]) => matches(v, e.data[k])));
      expect(found, `событие ${item.event} с данными ${JSON.stringify(item.data)}`).toBe(true);
    }
  }
}

const MS = 1_000_000_000n;

test("uart_hello: терминал получает ожидаемую строку целиком", async ({ page }) => {
  await runExpect(page, "uart_hello");

  // A click on the UART icon on the board opens the terminal tab of this part.
  const point = (await part(page, "uart"))?.point ?? { x: -1, y: -1 };
  await page.getByTestId("board").click({ position: point });
  expect(await sim(page, (api) => api.bottomTab())).toBe("terminal:uart");
  const output = page.getByTestId("terminal-output");
  await expect(output).toHaveText("Hello, FPGA SIM!\nHello, FPGA SIM!\nHello, FPGA SIM!\n", { useInnerText: true });
  await expect(page.getByTestId("terminal-counters")).toContainText("принято 54");
  // Show as hexadecimal codes and back to text.
  await page.getByTestId("terminal-hex").check();
  await expect(output).toContainText("48 65 6c 6c 6f 2c 20 46 50 47 41 20 53 49 4d 21");
  await expect(output).toContainText("0d 0a");
  await page.getByTestId("terminal-hex").uncheck();
  await expect(output).toContainText("Hello, FPGA SIM!");
  // Clear erases the log; a simulation reset starts it again.
  await page.getByTestId("terminal-clear").click();
  await expect(output).toHaveText("");
  expect((await part(page, "uart"))?.terminal).toEqual([]);
  await stepTo(page, 3100n * MS);
  expect(await terminalText(page, "uart")).toBe("Hello, FPGA SIM!\r\n");
  await page.getByTestId("reset").click();
  await expect.poll(() => sim(page, (api) => api.state().time)).toBe("0");
  await expect.poll(async () => (await part(page, "uart"))?.terminal).toEqual([]);
});

test("uart_echo: 256 разных байтов возвращаются без потерь; ввод в терминале возвращается на ходу", async ({
  page,
}) => {
  await runExpect(page, "uart_echo");
  const state = await part(page, "uart");
  expect(state).toMatchObject({ received: 256, sent: 256, queued: 0 });

  // Input line: the text goes to the FPGA and returns to the terminal output.
  await page.getByTestId("tab-terminal-uart").click();
  await page.getByTestId("terminal-clear").click();
  await page.getByTestId("run").click();
  await page.getByTestId("terminal-text").fill("Привет, ПЛИС");
  await page.getByTestId("terminal-text").press("Enter");
  await expect(page.getByTestId("terminal-text")).toHaveValue("");
  await expect(page.getByTestId("terminal-output")).toHaveText("Привет, ПЛИС", { timeout: 20_000 });
  // Key "1" in the input line does not press button S1 (spec section 9.4).
  await page.getByTestId("terminal-text").focus();
  await page.keyboard.down("1");
  await page.waitForTimeout(200);
  expect((await part(page, "s1"))?.pressed).toBe(false);
  await page.keyboard.up("1");
  await expect(page.getByTestId("terminal-text")).toHaveValue("1");
  // Outside the input line the same key presses the button.
  await page.getByTestId("terminal-text").blur();
  await page.keyboard.down("1");
  await expect.poll(async () => (await part(page, "s1"))?.pressed).toBe(true);
  await page.keyboard.up("1");
});

test("скорость детали 9600 при схеме на 115 200 даёт baudMismatch с оценкой в пределах 5%", async ({ page }) => {
  await openExample(page, "uart_hello");
  // A built-in part setting changes in the dialog and goes to the core without a build.
  await page.getByTestId("parts-summary").click();
  await page.getByTestId("part-edit-uart").click();
  await page.getByTestId("setting-baud").fill("9600");
  await page.getByTestId("part-save").click();
  await expect(page.getByTestId("part-dialog")).toHaveCount(0);
  expect(await builds(page)).toBe(1);
  await stepTo(page, 10n * MS);
  const seen = (await events(page, "uart")).filter((e) => e.event === "baudMismatch");
  expect(seen).toHaveLength(1);
  const estimate = seen[0]?.data.baud as number;
  expect(estimate).toBeGreaterThan(115_200 * 0.95);
  expect(estimate).toBeLessThan(115_200 * 1.05);
  expect(seen[0]?.data.setting).toBe(9600);
  // The event shows in the "Messages" tab with a hint.
  await page.getByTestId("tab-messages").click();
  const notice = page.getByTestId("notice").filter({ hasText: "baudMismatch" });
  await expect(notice).toHaveCount(1);
  await expect(notice).toContainText("у детали задано 9600");
  // A valid speed: after reset there are no events, the line is accepted.
  await page.getByTestId("part-edit-uart").click();
  await page.getByTestId("setting-baud").fill("115200");
  await page.getByTestId("part-save").click();
  await expect(page.getByTestId("part-dialog")).toHaveCount(0);
  await page.getByTestId("reset").click();
  await expect.poll(() => sim(page, (api) => api.state().time)).toBe("0");
  await stepTo(page, 10n * MS);
  expect(await events(page, "uart")).toEqual([]);
  expect(await terminalText(page, "uart")).toBe("Hello, FPGA SIM!\r\n");
});

test("ws2812_rainbow: цвета восьми светодиодов в контрольный момент совпадают с расчётными", async ({ page }) => {
  await runExpect(page, "ws2812_rainbow");
  expect(await sim(page, (api) => api.parts().find((p) => p.id === "strip"))).toEqual({
    id: "strip",
    type: "ws2812",
    pins: { din: 76 },
    origin: "breadboard",
    enabled: true,
  });
  // After 0.1 s the colors shifted by one LED.
  const before = (await part(page, "strip"))?.colors ?? [];
  await stepTo(page, 350n * MS);
  const after = (await part(page, "strip"))?.colors ?? [];
  expect(after).toEqual([...before.slice(1), before[0]]);
  // The built-in LED of the board got no data.
  expect((await part(page, "ws2812"))?.colors).toEqual(["#000000"]);
});

test("ws2812_badtiming: приходит timingError с измеренной длительностью", async ({ page }) => {
  await runExpect(page, "ws2812_badtiming");
  const seen = await events(page, "ws2812");
  expect(seen[0]?.data.highNs as number).toBeCloseTo(518.5, 0);
  await page.getByTestId("tab-messages").click();
  const notice = page.getByTestId("notice").filter({ hasText: "timingError" });
  await expect(notice).toHaveCount(1);
  await expect(notice).toContainText("единица длится 519 нс");
});

test("детали UART и WS2812 ставятся на макетку из диалога; вывод UART можно не подключать", async ({ page }) => {
  await openExample(page, "blink3");
  await page.getByTestId("part-add").click();
  await page.getByTestId("part-type").click();
  const types = await page.getByRole("option").evaluateAll((o) => o.map((e) => e.getAttribute("data-value")));
  expect(types).toEqual(["button", "led", "probe", "switch", "uart", "ws2812"]);
  await page.keyboard.press("Escape");

  // UART: the pins of the new part are not connected; a part cannot be added without a single pin.
  await choose(page.getByTestId("part-type"), "uart");
  await expect(page.getByTestId("part-pins-problem")).toBeVisible();
  await expect(page.getByTestId("part-save")).toBeDisabled();
  await page.getByTestId("part-id").fill("uart_ext");
  await choose(page.getByTestId("part-pin-fromFpga"), "15");
  await page.getByTestId("part-save").click();
  await expect(page.getByTestId("part-dialog")).toHaveCount(0);
  await expect
    .poll(() => sim(page, (api) => api.parts().find((p) => p.id === "uart_ext")))
    .toEqual({ id: "uart_ext", type: "uart", pins: { fromFpga: 15 }, origin: "breadboard", enabled: true });
  // Each UART part has its own terminal tab.
  await expect(page.getByTestId("tab-terminal-uart")).toBeVisible();
  await expect(page.getByTestId("tab-terminal-uart_ext")).toBeVisible();

  // WS2812: a 4 x 2 matrix.
  await page.getByTestId("part-add").click();
  await choose(page.getByTestId("part-type"), "ws2812");
  await page.getByTestId("part-id").fill("matrix");
  await choose(page.getByTestId("part-pin-din"), "73");
  await page.getByTestId("setting-count").fill("8");
  await choose(page.getByTestId("setting-layout"), "matrix");
  await page.getByTestId("setting-width").fill("4");
  await page.getByTestId("part-save").click();
  await expect(page.getByTestId("part-dialog")).toHaveCount(0);
  await expect.poll(async () => (await part(page, "matrix"))?.colors).toHaveLength(8);
  expect(await builds(page)).toBe(1);

  // A disabled built-in UART part loses its terminal tab.
  await page.getByTestId("part-edit-uart").click();
  await page.getByTestId("part-enabled").uncheck();
  await page.getByTestId("part-save").click();
  await expect(page.getByTestId("tab-terminal-uart")).toHaveCount(0);
  await expect(page.getByTestId("tab-terminal-uart_ext")).toBeVisible();
});
