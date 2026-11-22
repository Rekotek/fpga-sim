// Acceptance criteria of stage 8 (spec section 12): signal tree, watching, recording, waveforms, VCD.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { modelChanges } from "../../web/src/wave/model";
import { parseVcd } from "../../web/src/wave/vcd";
import { build, choose, createFromExample, openSettings, openWithKey, sim, simWith } from "./stand";

const API_IMAGE = process.env.FPGASIM_API_IMAGE ?? "fpgasim-api:dev";
const TOOLS = fileURLToPath(new URL("../../tools/wave", import.meta.url));
const CLK_HZ = 27_000_000n;
const HALF_PERIOD_PS = 18_519; // half cycle at 27 MHz, rounded up

// Moment of the rising edge number n (from one): the start of half cycle 2(n - 1), spec section 5.2.
const edgePs = (n: bigint): bigint => ((n - 1n) * 1_000_000_000_000n) / CLK_HZ;

const cycle = (page: Page) => sim(page, (api) => api.state().cycle);
const record = (page: Page) => sim(page, (api) => api.record());
const wave = (page: Page) => sim(page, (api) => api.wave());
const view = (page: Page) => sim(page, (api) => api.waveView());
const changes = (page: Page, name: string) => simWith(page, name, (api, n) => api.waveChanges(n));
const savedConfig = async (page: Page): Promise<Record<string, unknown>> =>
  JSON.parse((await sim(page, (api) => api.file("fpgasim.json"))) ?? "{}") as Record<string, unknown>;

// The example builds in the default mode (ports, decision 108). The stage tests need internal
// signals: mode all is chosen in the settings before the first build, so as not to build the project twice
// (request limit per key). The first test checks the "Signals" tab button.
async function openExample(page: Page, name: string, internal = true): Promise<void> {
  await openWithKey(page);
  await createFromExample(page, name);
  if (internal) {
    await openSettings(page);
    await choose(page.getByTestId("settings-visibility"), "all");
    await page.getByTestId("settings-save").click();
    await expect(page.getByTestId("settings")).toHaveCount(0);
  }
  expect(await build(page)).toBe("ok");
  await expect.poll(() => sim(page, (api) => api.state().run)).toBe("paused");
}

async function stepCycles(page: Page, count: number): Promise<void> {
  const target = (await cycle(page)) + count;
  await simWith(page, count, (api, n) => api.command({ t: "step", unit: "cycle", count: n }));
  await expect.poll(() => cycle(page), { timeout: 60_000 }).toBe(target);
  await expect.poll(() => sim(page, (api) => api.state().stepping)).toBe(false);
}

async function stepTo(page: Page, target: bigint): Promise<void> {
  await expect.poll(() => sim(page, (api) => api.state().stepping)).toBe(false);
  const now = BigInt(await sim(page, (api) => api.state().time));
  if (target <= now) return;
  await simWith(page, (target - now).toString(), (api, value) => api.command({ t: "step", unit: "time", ps: value }));
  await expect.poll(() => sim(page, (api) => api.state().time), { timeout: 60_000 }).toBe(target.toString());
  await expect.poll(() => sim(page, (api) => api.state().stepping)).toBe(false);
}

const signalRow = (page: Page, name: string) => page.locator(`[data-testid="signal-row"][data-name="${name}"]`);
const waveRow = (page: Page, name: string) => page.locator(`[data-testid="wave-row"][data-name="${name}"]`);

// The "Record" button on tree signals; the record list is read from fpgasim.json.
async function addToRecord(page: Page, names: string[]): Promise<void> {
  await page.getByTestId("tab-signals").click();
  for (const name of names) await signalRow(page, name).getByTestId("signal-record").click();
  await expect.poll(() => view(page).then((v) => v.rows)).toEqual(names);
}

test("дерево сигналов blink3: только порты по умолчанию, внутренние сигналы по кнопке и в режиме all", async ({
  page,
}) => {
  // The default is mode ports: the tree has only ports, there is no settings file.
  await openExample(page, "blink3", false);
  const first = await sim(page, (api) => api.signals());
  expect(first.map((s) => s.path)).toEqual(["top.clk", "top.led"]);
  expect(await sim(page, (api) => api.file("fpgasim.json"))).toBeNull();
  await page.getByTestId("tab-signals").click();
  await expect(signalRow(page, "top.cnt_a")).toHaveCount(0);
  await expect(page.getByTestId("signals")).toContainText("только порты");

  // The button writes mode all and rebuilds the project.
  await page.getByTestId("signals-show-internal").click();
  await expect.poll(() => sim(page, (api) => api.signals().length), { timeout: 60_000 }).toBeGreaterThan(2);
  await expect.poll(() => sim(page, (api) => api.state().run)).toBe("paused");
  expect(await savedConfig(page)).toEqual({ format: 1, design: { visibility: "all" } });
  await expect(page.getByTestId("signals-show-internal")).toHaveCount(0);
  const paths = async (): Promise<string[]> => (await sim(page, (api) => api.signals())).map((s) => s.path);
  expect(await paths()).toEqual(expect.arrayContaining(["top.cnt_a", "top.cnt_b", "top.cnt_c", "top.q"]));

  await page.getByTestId("tab-signals").click();
  for (const name of ["top.clk", "top.led", "top.cnt_a", "top.cnt_b", "top.cnt_c", "top.q", "pin:15"]) {
    await expect(signalRow(page, name)).toBeVisible();
  }
  await expect(signalRow(page, "top.cnt_a")).toContainText("регистр, 25 разр.");
  await expect(signalRow(page, "pin:15")).toContainText("led[0]");
  // Search keeps the matching rows; a collapsed group hides its own.
  await page.getByTestId("signals-search").fill("cnt_");
  await expect(page.getByTestId("signal-row")).toHaveCount(3);
  await page.getByTestId("signals-search").fill("");
  await page.locator('[data-testid="signal-group"][data-name="top"]').click();
  await expect(signalRow(page, "top.cnt_a")).toHaveCount(0);
  await expect(signalRow(page, "pin:15")).toBeVisible();

  // Back to mode ports through the settings: after the build the tree has only ports again.
  await openSettings(page);
  await choose(page.getByTestId("settings-visibility"), "ports");
  await page.getByTestId("settings-save").click();
  await expect(page.getByTestId("settings")).toHaveCount(0);
  expect(await build(page)).toBe("ok");
  await expect.poll(() => sim(page, (api) => api.state().run)).toBe("paused");
  const signals = await sim(page, (api) => api.signals());
  expect(signals.map((s) => s.path)).toEqual(["top.clk", "top.led"]);
  expect(signals.every((s) => s.kind === "port")).toBe(true);
  await expect(signalRow(page, "top.led")).toBeVisible();
  await expect(signalRow(page, "top.cnt_a")).toHaveCount(0);
  await expect(page.getByTestId("signals")).toContainText("только порты");
});

test("наблюдение: top.cnt_a после шага на 1000 тактов от начала равен 1000", async ({ page }) => {
  await openExample(page, "blink3");
  await page.getByTestId("tab-signals").click();
  await signalRow(page, "top.cnt_a").getByTestId("signal-watch").click();
  await signalRow(page, "pin:15").getByTestId("signal-watch").click();
  await expect(signalRow(page, "top.cnt_a").getByTestId("signal-watch")).toBeDisabled();
  expect((await savedConfig(page)).watch).toEqual([{ signal: "top.cnt_a" }, { signal: "pin:15" }]);
  const watch = () => sim(page, (api) => api.watch());
  // On pause the value arrives at once: before the step the counter is zero.
  await expect.poll(watch).toEqual([
    { signal: "top.cnt_a", radix: "dec", value: "0", text: "0" },
    { signal: "pin:15", radix: "dec", value: "1", text: "1" },
  ]);

  await stepCycles(page, 1000);
  expect((await watch())[0]).toEqual({ signal: "top.cnt_a", radix: "dec", value: "1000", text: "1000" });
  const row = page.locator('[data-testid="watch-row"][data-name="top.cnt_a"]');
  await expect(row.getByTestId("watch-value")).toHaveText("1000");

  // The number system changes the display and is written to fpgasim.json.
  await choose(row.getByTestId("watch-radix"), "hex");
  await expect(row.getByTestId("watch-value")).toHaveText("00003E8");
  await choose(row.getByTestId("watch-radix"), "bin");
  await expect(row.getByTestId("watch-value")).toHaveText("0000000000000001111101000");
  expect((await savedConfig(page)).watch).toEqual([{ signal: "top.cnt_a", radix: "bin" }, { signal: "pin:15" }]);

  // Reset returns the counter to zero; the watch stays.
  await page.getByTestId("reset").click();
  await expect.poll(async () => (await watch())[0]?.value).toBe("0");
  // Build again: the watch list from the file works in the new core.
  expect(await build(page)).toBe("ok");
  await expect.poll(() => sim(page, (api) => api.state().run)).toBe("paused");
  await stepCycles(page, 12);
  expect((await watch())[0]?.value).toBe("12");

  // A build on the fly: the watch is set to the new core while it is already running. There is no refusal of a zero-length
  // step (BAD_STATE): the tab stays the same, the value grows.
  await page.getByTestId("run").click();
  await expect.poll(() => sim(page, (api) => api.state().run)).toBe("running");
  expect(await build(page)).toBe("ok");
  await expect.poll(() => sim(page, (api) => api.state().run)).toBe("running");
  await expect.poll(async () => Number((await watch())[0]?.value ?? "0"), { timeout: 15_000 }).toBeGreaterThan(1000);
  expect(await sim(page, (api) => api.bottomTab())).toBe("signals");
  await page.getByTestId("pause").click();
  await expect.poll(() => sim(page, (api) => api.state().run)).toBe("paused");

  await row.getByTestId("watch-remove").click();
  await expect(row).toHaveCount(0);
  expect((await savedConfig(page)).watch).toEqual([{ signal: "pin:15" }]);
});

test("запись в режиме window с условием по фронту pin:15 начинается в момент фронта", async ({ page }) => {
  await openExample(page, "blink3");
  await addToRecord(page, ["pin:15", "top.q"]);
  await page.getByTestId("tab-waves").click();
  await choose(page.getByTestId("wave-mode"), "window");
  await page.getByTestId("wave-window").fill("1");
  await page.getByTestId("wave-window").blur();
  await choose(page.getByTestId("wave-trigger"), "pin:15");
  await choose(page.getByTestId("wave-edge"), "fall");
  expect((await savedConfig(page)).record).toEqual({
    signals: ["pin:15", "top.q"],
    mode: "window",
    depth: 200_000,
    windowPs: 1_000_000_000,
    trigger: { signal: "pin:15", edge: "fall" },
  });

  await page.getByTestId("wave-start").click();
  await expect.poll(async () => (await record(page))?.state).toBe("armed");
  await expect(page.getByTestId("wave-status")).toHaveText("Запись ждёт условия запуска");
  await sim(page, (api) => api.command({ t: "run", speed: "max" }));
  await expect.poll(async () => (await record(page))?.state, { timeout: 60_000 }).toBe("done");
  await page.getByTestId("pause").click();

  // Pin 15 falls to zero on rising edge number 13 500 000: at that moment q[0] becomes
  // one.
  const edge = edgePs(13_500_000n);
  await expect.poll(async () => (await wave(page))?.signals.length).toBe(2);
  const got = await wave(page);
  expect(Math.abs(Number(BigInt(got?.fromPs ?? "0") - edge))).toBeLessThanOrEqual(HALF_PERIOD_PS);
  // The window lasts exactly 1 ms; the values at the start of the span already contain the edge itself (decision 25).
  expect(BigInt(got?.toPs ?? "0") - BigInt(got?.fromPs ?? "0")).toBe(1_000_000_000n);
  expect(got?.signals).toEqual([
    { name: "pin:15", width: 1, changes: 0, initial: "0", last: "0" },
    { name: "top.q", width: 3, changes: 0, initial: "1", last: "1" },
  ]);
  expect(await record(page)).toMatchObject({ state: "done", changes: 0, fromPs: got?.fromPs, error: null });
  await expect(page.getByTestId("wave-status")).toContainText("Запись окончена. Изменений: 0, участок 1 мс");
});

test("кольцо на 1000 изменений после 10 000 изменений; выгруженный VCD читают два разборщика", async ({
  page,
}, testInfo) => {
  await openExample(page, "blink3");
  await addToRecord(page, ["top.cnt_a", "pin:15"]);
  await page.getByTestId("tab-waves").click();
  await page.getByTestId("wave-depth").fill("1000");
  await page.getByTestId("wave-depth").press("Enter");
  await expect.poll(async () => (await savedConfig(page)).record).toMatchObject({ mode: "ring", depth: 1000 });
  await page.getByTestId("wave-start").click();
  await expect.poll(async () => (await record(page))?.state).toBe("recording");

  // The counter changes on every clock cycle: 10 000 clock cycles give 10 000 changes.
  await stepCycles(page, 10_000);
  await expect.poll(async () => (await wave(page))?.changes).toBe(1000);
  const got = await wave(page);
  // The ring holds the last 1000 changes: values 9001...10000; at the start of the span the counter equals 9000.
  expect(got?.signals).toEqual([
    { name: "top.cnt_a", width: 25, changes: 1000, initial: "9000", last: "10000" },
    { name: "pin:15", width: 1, changes: 0, initial: "1", last: "1" },
  ]);
  expect(BigInt(got?.fromPs ?? "0")).toBe(edgePs(9000n));
  const list = await changes(page, "top.cnt_a");
  expect(list.length).toBe(1000);
  expect(list[0]).toEqual({ t: edgePs(9001n).toString(), v: "9001" });
  expect(list[999]).toEqual({ t: edgePs(10_000n).toString(), v: "10000" });
  expect((await record(page))?.changes).toBe(1000);
  await expect(page.getByTestId("wave-status")).toContainText("Идёт запись. Изменений: 1 000");
  await page.getByTestId("wave-stop").click();
  await expect.poll(async () => (await record(page))?.state).toBe("stopped");

  // VCD export by the button: the file equals the text from window.__fpgasim.
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("wave-vcd").click()]);
  expect(download.suggestedFilename()).toBe("blink3.vcd");
  const file = testInfo.outputPath("record.vcd");
  await download.saveAs(file);
  const text = readFileSync(file, "utf8");
  expect(text).toBe(await sim(page, (api) => api.vcd()));
  expect(text).toContain("$timescale 1ps $end");

  // Own parser: the same number of changes and the same values as in the record.
  const own = parseVcd(text);
  expect(modelChanges(own)).toBe(1000);
  expect(own.signals.map((s) => [s.name, s.width, s.times.length - 1])).toEqual([
    ["top.cnt_a", 25, 1000],
    ["pins.pin15", 1, 0],
  ]);
  expect([own.fromPs, own.toPs]).toEqual([Number(got?.fromPs), Number((await wave(page))?.toPs)]);

  // Third-party parser (pyvcd in the test container of the server).
  writeFileSync(file, text);
  const output = execFileSync(
    "docker",
    [
      "run",
      "--rm",
      "-v",
      `${dirname(file)}:/data:ro`,
      "-v",
      `${TOOLS}:/tools:ro`,
      API_IMAGE,
      "python",
      "/tools/read_vcd.py",
      "/data/record.vcd",
    ],
    { encoding: "utf8" },
  );
  const foreign = JSON.parse(output) as {
    timescale: string;
    fromPs: string;
    changes: number;
    signals: { name: string; width: number; changes: number; initial: string; last: string }[];
  };
  expect(foreign.timescale).toBe("1ps");
  expect(foreign.changes).toBe(1000);
  expect(foreign.fromPs).toBe(got?.fromPs);
  expect(foreign.signals).toEqual([
    { name: "top.cnt_a", width: 25, changes: 1000, initial: "9000", last: "10000" },
    { name: "pins.pin15", width: 1, changes: 0, initial: "1", last: "1" },
  ]);

  // Reset erases the record in the core; the waveform stays on screen.
  await page.getByTestId("reset").click();
  await expect.poll(() => record(page)).toBeNull();
  expect((await wave(page))?.changes).toBe(1000);
});

test("shift_chain: с «<=» значение сдвигается на разряд за такт, с «=» — на все разряды сразу", async ({ page }) => {
  await openExample(page, "shift_chain");
  await addToRecord(page, ["top.u_good.q", "top.u_bad.q"]);
  await page.getByTestId("tab-waves").click();
  await page.getByTestId("wave-start").click();
  await expect.poll(async () => (await record(page))?.state).toBe("recording");

  await stepTo(page, 100_000_000_000n);
  await sim(page, (api) => api.command({ t: "part", part: "s1", cmd: "press", args: {} }));
  await stepTo(page, 1_000_000_000_000n);
  await expect.poll(async () => (await wave(page))?.toPs).toBe("1000000000000");

  // The chains shift on rising edges 1, 8 388 609, 16 777 217, 25 165 825 (every 2^23 clock cycles).
  const shift = (n: bigint): string => edgePs(n * 8_388_608n + 1n).toString();
  // A correct chain: the one passes one bit per shift.
  expect(await changes(page, "top.u_good.q")).toEqual([
    { t: shift(1n), v: "1" },
    { t: shift(2n), v: "3" },
    { t: shift(3n), v: "7" },
  ]);
  // A chain with a blocking "=": all three bits change in one clock cycle.
  expect(await changes(page, "top.u_bad.q")).toEqual([{ t: shift(1n), v: "7" }]);

  // The value under cursor A is in the panel rows; the binary form shows the shift.
  await choose(waveRow(page, "top.u_good.q").getByTestId("wave-radix"), "bin");
  await choose(waveRow(page, "top.u_bad.q").getByTestId("wave-radix"), "bin");
  const canvas = page.getByTestId("wave-canvas");
  const box = (await canvas.boundingBox()) ?? { x: 0, y: 0, width: 1, height: 1 };
  const before = await view(page);
  // A click at a moment between the first and the second shift.
  const at = (Number(shift(1n)) + Number(shift(2n))) / 2;
  const x = ((at - before.fromPs) * box.width) / (before.toPs - before.fromPs);
  await canvas.click({ position: { x, y: 10 } });
  const cursor = (await view(page)).cursorA ?? 0;
  expect(Math.abs(cursor - at)).toBeLessThan((before.toPs - before.fromPs) / box.width + 1);
  await expect(waveRow(page, "top.u_good.q").getByTestId("wave-value")).toHaveText("001");
  await expect(waveRow(page, "top.u_bad.q").getByTestId("wave-value")).toHaveText("111");
});

test("панель осциллограмм: масштаб, сдвиг, курсоры, строки, отказ записи", async ({ page }) => {
  await openExample(page, "blink3");
  // The record list is empty: "Record" explains what to do.
  await page.getByTestId("tab-waves").click();
  await page.getByTestId("wave-start").click();
  await expect(page.getByTestId("wave-error")).toContainText("В списке записи нет сигналов");
  expect(await record(page)).toMatchObject({ state: "none", id: null });

  await addToRecord(page, ["pin:15", "pin:16", "top.q"]);
  await page.getByTestId("tab-waves").click();
  await page.getByTestId("wave-start").click();
  await expect(page.getByTestId("wave-error")).toHaveCount(0);
  await stepTo(page, 2_100_000_000_000n);
  await expect.poll(async () => (await wave(page))?.toPs).toBe("2100000000000");
  // In 2.1 s pin 15 switches 4 times, pin 16 switches 8 times (spec section 2.7); q changes 16 times:
  // the switches of q[0] and q[1] coincide in time with the switches of q[2].
  expect((await wave(page))?.signals.map((s) => [s.name, s.changes])).toEqual([
    ["pin:15", 4],
    ["pin:16", 8],
    ["top.q", 16],
  ]);

  // The view window first shows the whole span.
  const full = await view(page);
  expect(full.fromPs).toBeLessThan(0);
  expect(full.toPs).toBeGreaterThan(2.1e12);
  const canvas = page.getByTestId("wave-canvas");
  const box = (await canvas.boundingBox()) ?? { x: 0, y: 0, width: 1, height: 1 };
  // The wheel zooms in around the pointer.
  await page.mouse.move(box.x + box.width / 2, box.y + 30);
  await page.mouse.wheel(0, -400);
  const zoomed = await view(page);
  expect(zoomed.toPs - zoomed.fromPs).toBeLessThan((full.toPs - full.fromPs) * 0.7);
  expect((zoomed.fromPs + zoomed.toPs) / 2).toBeCloseTo((full.fromPs + full.toPs) / 2, -9);
  // Dragging left moves the window to a later time.
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 100, box.y + 30, { steps: 4 });
  await page.mouse.up();
  const panned = await view(page);
  expect(panned.fromPs).toBeGreaterThan(zoomed.fromPs);
  expect(panned.toPs - panned.fromPs).toBeCloseTo(zoomed.toPs - zoomed.fromPs, -3);
  expect(panned.cursorA).toBeNull();
  // Keys: "-" zooms out, "+" zooms in, an arrow shifts, F shows everything.
  await canvas.focus();
  await page.keyboard.press("-");
  expect((await view(page)).toPs - (await view(page)).fromPs).toBeGreaterThan(panned.toPs - panned.fromPs);
  await page.keyboard.press("f");
  expect(await view(page)).toMatchObject({ fromPs: full.fromPs, toPs: full.toPs });
  await page.getByTestId("wave-fit").click();

  // Two cursors: time difference and frequency. The period of led[0] is 1 s.
  const xOf = (ps: number): number => ((ps - full.fromPs) * box.width) / (full.toPs - full.fromPs);
  await canvas.click({ position: { x: xOf(0.6e12), y: 10 } });
  await canvas.click({ position: { x: xOf(1.6e12), y: 10 }, modifiers: ["Shift"] });
  const cursors = await view(page);
  expect(Math.abs((cursors.cursorB ?? 0) - (cursors.cursorA ?? 0) - 1e12)).toBeLessThan(5e9);
  await expect(page.getByTestId("wave-cursors")).toContainText("Δ");
  await expect(page.getByTestId("wave-cursors")).toContainText("Гц");
  // The value under cursor A: at 0.6 s q = 001 (q[0] switched at 0.5 s, q[1] and q[2] an even number of times).
  await expect(waveRow(page, "top.q").getByTestId("wave-value")).toHaveText("1");
  await expect(waveRow(page, "pin:15").getByTestId("wave-value")).toHaveText("0");
  await page.keyboard.press("Escape");
  expect(await view(page)).toMatchObject({ cursorA: null, cursorB: null });

  // Reordering and deleting rows are written to fpgasim.json.
  await waveRow(page, "top.q").getByTestId("wave-up").click();
  await expect.poll(() => view(page).then((v) => v.rows)).toEqual(["pin:15", "top.q", "pin:16"]);
  await waveRow(page, "pin:15").getByTestId("wave-down").click();
  await expect.poll(() => view(page).then((v) => v.rows)).toEqual(["top.q", "pin:15", "pin:16"]);
  await waveRow(page, "pin:15").getByTestId("wave-remove").click();
  await expect.poll(() => view(page).then((v) => v.rows)).toEqual(["top.q", "pin:16"]);
  expect((await savedConfig(page)).record).toMatchObject({ signals: ["top.q", "pin:16"] });
  await expect(page.getByTestId("wave-row")).toHaveCount(2);
});
