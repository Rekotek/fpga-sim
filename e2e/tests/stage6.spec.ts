// Acceptance criteria of stage 6 (spec section 12): breadboard and pin binding.
import { expect, test, type Page } from "@playwright/test";
import {
  build,
  choose,
  createFromExample,
  fileAction,
  openSettings,
  openWithKey,
  replaceEditorText,
  sim,
  simWith,
} from "./stand";

const builds = (page: Page) => sim(page, (api) => api.state().builds);
const boundPins = (page: Page) => sim(page, (api) => api.binding().pins);
const pinOf = (page: Page, name: string) =>
  simWith(page, name, (api, port) => api.binding().rows.find((r) => r.name === port)?.pin ?? null);
const toggles = (page: Page, pin: number) => simWith(page, pin, (api, n) => api.net(n)?.toggles ?? -1);
const level = (page: Page, pin: number) => simWith(page, pin, (api, n) => api.net(n)?.level ?? -1);
const savedConfig = async (page: Page): Promise<Record<string, unknown>> =>
  JSON.parse((await sim(page, (api) => api.file("fpgasim.json"))) ?? "{}") as Record<string, unknown>;

async function deleteFile(page: Page, path: string): Promise<void> {
  await page.getByTestId("file").filter({ hasText: path }).click();
  await fileAction(page, "delete");
  await page.getByTestId("file-delete-confirm").click();
  await expect(page.getByTestId("file").filter({ hasText: path })).toHaveCount(0);
}

// A project from the example blink3 without a binding file: the build passes, the ports are not bound.
async function openWithoutCst(page: Page): Promise<void> {
  await openWithKey(page);
  await createFromExample(page, "blink3");
  await deleteFile(page, "top.cst");
  expect(await build(page)).toBe("ok");
  await expect.poll(() => sim(page, (api) => api.state().run)).toBe("paused");
}

// Binding of a port bit in the "Pin binding" dialog.
async function bind(page: Page, port: string, pin: number): Promise<void> {
  await choose(page.getByTestId(`bind-pin-${port}`), String(pin));
}

// A step by the given simulation time and waiting for its end.
async function stepPs(page: Page, ps: bigint): Promise<void> {
  // The interface itself sends a zero-length step after a part settings change: it must finish.
  await expect.poll(() => sim(page, (api) => api.state().stepping)).toBe(false);
  const target = BigInt(await sim(page, (api) => api.state().time)) + ps;
  await simWith(page, ps.toString(), (api, value) => api.command({ t: "step", unit: "time", ps: value }));
  await expect.poll(() => sim(page, (api) => api.state().time), { timeout: 60_000 }).toBe(target.toString());
  await expect.poll(() => sim(page, (api) => api.state().stepping)).toBe(false);
}

const MS = 1_000_000_000n;

test("проект без .cst: после привязки в диалоге симуляция идёт без сборки; выгруженный .cst даёт те же выводы", async ({
  page,
}) => {
  await openWithoutCst(page);
  expect(await builds(page)).toBe(1);
  expect(await sim(page, (api) => api.binding().source)).toBe("pins");
  expect(await boundPins(page)).toEqual([]);
  expect((await sim(page, (api) => api.diagnostics())).map((d) => d.code)).toContain("PORT_UNBOUND");

  await page.getByTestId("binding-open").click();
  await expect(page.getByTestId("binding-table")).toBeVisible();
  await bind(page, "clk", 4);
  await bind(page, "led[0]", 15);
  await bind(page, "led[1]", 16);
  await bind(page, "led[2]", 17);
  await expect.poll(() => boundPins(page)).toHaveLength(4);
  // The pull also goes into the binding and then into the exported file.
  await choose(page.getByTestId("bind-pull-led[2]"), "up");
  await expect.poll(async () => (await boundPins(page)).find((p) => p.pin === 17)?.pull).toBe("up");
  await page.getByTestId("dialog-close").click();

  // The binding is written to fpgasim.json and went to the core by the configure command: there was no build.
  expect((await savedConfig(page)).pins).toEqual({
    clk: { pin: 4 },
    "led[0]": { pin: 15 },
    "led[1]": { pin: 16 },
    "led[2]": { pin: 17, pull: "up" },
  });
  await page.getByTestId("run").click();
  await expect.poll(() => toggles(page, 17), { timeout: 20_000 }).toBeGreaterThanOrEqual(2);
  expect(await sim(page, (api) => api.state().cycle)).toBeGreaterThan(0);
  expect(await builds(page)).toBe(1);
  await page.getByTestId("pause").click();
  await expect.poll(() => sim(page, (api) => api.state().run)).toBe("paused");

  // Export: the .cst file is created, the pins field is cleared, the file takes effect.
  const before = await boundPins(page);
  await page.getByTestId("binding-open").click();
  await page.getByTestId("binding-export").click();
  await expect(page.getByTestId("binding-exported")).toBeVisible();
  const cst = await sim(page, (api) => api.file("top.cst"));
  expect(cst).toContain('IO_LOC "clk" 4;');
  expect(cst).toContain('IO_PORT "led[2]" IO_TYPE=LVCMOS33 PULL_MODE=UP;');
  expect((await savedConfig(page)).pins).toBeUndefined();
  expect(await sim(page, (api) => api.binding())).toMatchObject({ source: "cst", file: "top.cst" });
  // With an active .cst the table is read-only.
  await expect(page.getByTestId("bind-pin-clk")).toBeDisabled();
  await page.getByTestId("dialog-close").click();
  expect(await builds(page)).toBe(1);

  // A repeated build reads the binding from the file and gives the same resolved.pins.
  expect(await build(page)).toBe("ok");
  expect(await builds(page)).toBe(2);
  expect(await boundPins(page)).toEqual(before);
  expect(await sim(page, (api) => api.binding().source)).toBe("cst");
  await page.getByTestId("run").click();
  await expect.poll(() => toggles(page, 17), { timeout: 20_000 }).toBeGreaterThanOrEqual(2);
});

test("внешний светодиод на выводе 73 светится по уровню порта; два порта на один вывод привязать нельзя", async ({
  page,
}) => {
  await openWithoutCst(page);
  await page.getByTestId("binding-open").click();
  await bind(page, "clk", 4);
  await bind(page, "led[0]", 73);
  await expect.poll(() => boundPins(page)).toHaveLength(2);

  // A second port on the same pin: refusal with an explanation, the binding does not change.
  await bind(page, "led[1]", 73);
  await expect(page.getByTestId("bind-error")).toBeVisible();
  expect(await pinOf(page, "led[1]")).toBeNull();
  expect(await pinOf(page, "led[0]")).toBe(73);
  expect(Object.keys((await savedConfig(page)).pins as object)).toEqual(["clk", "led[0]"]);
  await page.getByTestId("dialog-close").click();

  // A part onto the breadboard: the "Add part" dialog, the settings form is built from the part description.
  await page.getByTestId("part-add").click();
  await choose(page.getByTestId("part-type"), "led");
  await page.getByTestId("part-id").fill("led_ext1");
  await choose(page.getByTestId("part-pin-in"), "73");
  await choose(page.getByTestId("setting-color"), "green");
  await page.getByTestId("part-save").click();
  await expect(page.getByTestId("part-dialog")).toHaveCount(0);
  await expect
    .poll(() => sim(page, (api) => api.parts().find((p) => p.id === "led_ext1")))
    .toEqual({ id: "led_ext1", type: "led", pins: { in: 73 }, origin: "breadboard", enabled: true });
  expect((await savedConfig(page)).parts).toEqual([
    { id: "led_ext1", type: "led", pins: { in: 73 }, settings: { color: "green" }, position: { x: 0, y: 0 } },
  ]);
  expect(await builds(page)).toBe(1);

  // led[0] = ~q[0], q[0] switches once per 0.5 s: the level of pin 73 is 1, 0, 1 ...
  // An active-high LED repeats the port level.
  const brightness = () => sim(page, (api) => api.part("led_ext1")?.brightness ?? -1);
  await expect.poll(() => level(page, 73)).toBe(1);
  await stepPs(page, 100n * MS);
  expect(await brightness()).toBe(1);
  await stepPs(page, 500n * MS); // t = 0.6 s: the port is at zero
  await stepPs(page, 100n * MS);
  expect(await level(page, 73)).toBe(0);
  expect(await brightness()).toBe(0);
  await stepPs(page, 400n * MS); // t = 1.1 s: the port is at one again
  await stepPs(page, 100n * MS);
  expect(await level(page, 73)).toBe(1);
  expect(await brightness()).toBe(1);

  // A part pin changes by dragging from the part to a header contact.
  const box = await page.getByTestId("board").boundingBox();
  if (!box) throw new Error("нет области платы");
  const from = await sim(page, (api) => api.part("led_ext1")?.point ?? { x: 0, y: 0 });
  const to = await sim(page, (api) => api.pins().find((p) => p.pin === 74)?.point ?? { x: 0, y: 0 });
  await page.mouse.move(box.x + from.x, box.y + from.y);
  await page.mouse.down();
  await page.mouse.move(box.x + (from.x + to.x) / 2, box.y + (from.y + to.y) / 2);
  await page.mouse.move(box.x + to.x, box.y + to.y);
  await page.mouse.up();
  await expect.poll(() => sim(page, (api) => api.parts().find((p) => p.id === "led_ext1")?.pins)).toEqual({ in: 74 });
  expect(await builds(page)).toBe(1);

  // A part is removed from the breadboard from its own dialog.
  await page.getByTestId("part-edit-led_ext1").click();
  await page.getByTestId("part-remove").click();
  await expect.poll(() => sim(page, (api) => api.parts().some((p) => p.id === "led_ext1"))).toBe(false);
});

test("привязка к выводам 59–62 показывает предупреждение", async ({ page }) => {
  await openWithoutCst(page);
  await page.getByTestId("binding-open").click();
  for (const pin of [59, 60, 61, 62]) {
    await bind(page, "led[2]", pin);
    await expect.poll(() => pinOf(page, "led[2]")).toBe(pin);
    await expect(page.getByTestId("bind-warning")).toHaveAttribute("data-code", "PIN_FORBIDDEN");
    await expect(page.getByTestId("bind-warning")).toContainText(String(pin));
    expect(await sim(page, (api) => api.binding().problems)).toEqual([{ code: "PIN_FORBIDDEN", name: "led[2]", pin }]);
  }
  // The server gives the same warning on check: it shows in the "Messages" tab.
  await expect
    .poll(() => sim(page, (api) => api.messages().map((m) => m.code)), { timeout: 15_000 })
    .toContain("PIN_FORBIDDEN");
  // A free pin gives no warning.
  await bind(page, "led[2]", 75);
  await expect.poll(() => pinOf(page, "led[2]")).toBe(75);
  await expect(page.getByTestId("bind-warning")).toHaveCount(0);
});

test("debounce: при bounceMs = 5 счётчик без подавления растёт больше чем на 1 за нажатие, с подавлением — ровно на 1", async ({
  page,
}) => {
  await openWithKey(page);
  await createFromExample(page, "debounce");
  expect(await build(page)).toBe("ok");
  await expect.poll(() => sim(page, (api) => api.state().run)).toBe("paused");

  // Pin 15 is the low bit of the counter with suppression, pin 18 is without suppression: the bit
  // switches on every counter increment.
  const press = async (): Promise<{ clean: number; raw: number }> => {
    const clean = await toggles(page, 15);
    const raw = await toggles(page, 18);
    await sim(page, (api) => api.command({ t: "part", part: "s1", cmd: "press" }));
    await stepPs(page, 200n * MS);
    await sim(page, (api) => api.command({ t: "part", part: "s1", cmd: "release" }));
    await stepPs(page, 200n * MS);
    return { clean: (await toggles(page, 15)) - clean, raw: (await toggles(page, 18)) - raw };
  };
  await stepPs(page, 100n * MS);
  for (let i = 0; i < 3; i += 1) {
    const counted = await press();
    expect(counted.clean).toBe(1);
    expect(counted.raw).toBeGreaterThan(1);
  }

  // Bounce is a setting of the built-in button (the boardParts field). The part dialog changes it on the fly,
  // without a build: without bounce both counters grow by exactly 1.
  await page.getByTestId("part-edit-s1").click();
  await expect(page.getByTestId("setting-bounceMs")).toHaveValue("5");
  await page.getByTestId("setting-bounceMs").fill("21");
  await expect(page.getByTestId("setting-problem-bounceMs")).toBeVisible();
  await expect(page.getByTestId("part-save")).toBeDisabled();
  // A fractional number is entered by characters and stays what was typed.
  await page.getByTestId("setting-bounceMs").fill("");
  await page.getByTestId("setting-bounceMs").pressSequentially("2.5");
  await expect(page.getByTestId("setting-bounceMs")).toHaveValue("2.5");
  await expect(page.getByTestId("part-save")).toBeEnabled();
  await page.getByTestId("setting-bounceMs").fill("0");
  await page.getByTestId("part-save").click();
  await expect(page.getByTestId("part-dialog")).toHaveCount(0);
  await expect.poll(() => savedConfig(page)).toEqual({ format: 1 });
  const time = await sim(page, (api) => api.state().time);
  expect(BigInt(time)).toBeGreaterThan(0n); // the setting changed on the fly, the simulation did not start over
  expect(await press()).toEqual({ clean: 1, raw: 1 });
  expect(await builds(page)).toBe(1);
});

test("переключатель и пробник на макетке; при действующем .cst таблица привязки только для чтения", async ({
  page,
}) => {
  await openWithKey(page);
  await createFromExample(page, "buttons");
  expect(await build(page)).toBe("ok");

  // A switch on the pin of button S1 (port btn1), a probe on pin led[0].
  await page.getByTestId("part-add").click();
  await choose(page.getByTestId("part-type"), "switch");
  await expect(page.getByTestId("part-id")).toHaveValue("switch1");
  await choose(page.getByTestId("part-pin-out"), "88");
  await page.getByTestId("part-save").click();
  await page.getByTestId("part-add").click();
  await choose(page.getByTestId("part-type"), "probe");
  await choose(page.getByTestId("part-pin-in"), "15");
  await page.getByTestId("setting-label").fill("led0");
  await page.getByTestId("part-save").click();
  await expect.poll(() => sim(page, (api) => api.parts().filter((p) => p.origin === "breadboard").length)).toBe(2);
  await expect.poll(() => sim(page, (api) => api.state().run)).toBe("paused");
  expect(await builds(page)).toBe(1);

  // led[0] = ~btn1: the switch is on, so pin 15 is zero.
  const probe = () => sim(page, (api) => api.part("probe1")?.level ?? -1);
  await expect.poll(probe).toBe(1);
  const box = await page.getByTestId("board").boundingBox();
  if (!box) throw new Error("нет области платы");
  const click = async (): Promise<void> => {
    const point = await sim(page, (api) => api.part("switch1")?.point ?? { x: 0, y: 0 });
    await page.mouse.click(box.x + point.x, box.y + point.y);
  };
  await click();
  await expect.poll(() => sim(page, (api) => api.part("switch1")?.on)).toBe(true);
  await expect.poll(() => level(page, 88)).toBe(1);
  await expect.poll(probe).toBe(0);
  await click();
  await expect.poll(() => sim(page, (api) => api.part("switch1")?.on)).toBe(false);
  await expect.poll(probe).toBe(1);

  // A built-in part is turned off in its dialog: it no longer goes to the core.
  await page.getByTestId("part-edit-s2").click();
  await page.getByTestId("part-enabled").uncheck();
  await page.getByTestId("part-save").click();
  await expect.poll(() => sim(page, (api) => api.parts().find((p) => p.id === "s2")?.enabled)).toBe(false);
  expect((await savedConfig(page)).boardParts).toEqual({ s2: { enabled: false } });

  // top.cst is active: the pins in the dialog do not change, the button leads to the file.
  await page.getByTestId("binding-open").click();
  await expect(page.getByTestId("binding-source")).toContainText("top.cst");
  await expect(page.getByTestId("bind-pin-btn1")).toBeDisabled();
  await expect(page.getByTestId("bind-pin-btn1")).toHaveAttribute("data-value", "88");
  await expect(page.getByTestId("binding-export")).toBeDisabled();
  await page.getByTestId("binding-edit-cst").click();
  await expect(page.getByTestId("binding")).toHaveCount(0);
  expect((await sim(page, (api) => api.editor())).path).toBe("top.cst");
});

const TWO_TOPS = `module first (
    input  wire a,
    output wire y
);
    assign y = a;
endmodule

module second (
    input  wire a,
    output wire y
);
    assign y = ~a;
endmodule
`;

test("несколько верхних модулей: выбор из сообщения записывается в design.top; диалог настроек проекта", async ({
  page,
}) => {
  await openWithKey(page);
  await createFromExample(page, "blink3");
  await deleteFile(page, "top.cst");
  await replaceEditorText(page, TWO_TOPS);
  expect(await build(page)).toBe("failed");
  expect((await sim(page, (api) => api.diagnostics())).map((d) => d.code)).toContain("TOP_AMBIGUOUS");

  await page.getByTestId("choose-top").filter({ hasText: "second" }).click();
  await expect.poll(() => sim(page, (api) => api.state().build.status), { timeout: 60_000 }).toBe("ok");
  expect((await savedConfig(page)).design).toEqual({ top: "second" });
  expect((await sim(page, (api) => api.binding().rows)).map((r) => r.name)).toEqual(["a", "y"]);

  // An unsaved edit of fpgasim.json in the editor is not lost: the dialog opens over it.
  await page.getByTestId("file").filter({ hasText: "fpgasim.json" }).click();
  await replaceEditorText(page, '{ "format": 1, "design": { "top": "second" }, "sim": { "speed": 0.5 } }');
  await expect.poll(() => sim(page, (api) => api.editor().dirty)).toEqual(["fpgasim.json"]);
  await openSettings(page);
  await expect(page.getByTestId("settings-top")).toHaveValue("second");
  await expect(page.getByTestId("settings-resolved")).toContainText("second");
  await page.getByTestId("settings-top").fill("first");
  await choose(page.getByTestId("settings-visibility"), "all");
  await page.getByTestId("settings-parameters").fill("WIDTH");
  await expect(page.getByTestId("settings-save")).toBeDisabled();
  await page.getByTestId("settings-parameters").fill("");
  await page.getByTestId("settings-save").click();
  await expect(page.getByTestId("settings")).toHaveCount(0);
  expect(await savedConfig(page)).toEqual({
    format: 1,
    design: { top: "first", visibility: "all" },
    sim: { speed: 0.5 },
  });
  expect(await build(page)).toBe("ok");
});

test("fpgasim.json с ошибкой: симуляция и чертёж остаются прежними, страница работает", async ({ page }) => {
  await openWithoutCst(page);
  await page.getByTestId("binding-open").click();
  await bind(page, "clk", 4);
  await bind(page, "led[2]", 17);
  await expect.poll(() => boundPins(page)).toHaveLength(2);
  await page.getByTestId("dialog-close").click();
  await page.getByTestId("part-add").click();
  await choose(page.getByTestId("part-type"), "led");
  await choose(page.getByTestId("part-pin-in"), "17");
  await page.getByTestId("part-save").click();
  await expect.poll(() => sim(page, (api) => api.parts().some((p) => p.id === "led1"))).toBe(true);
  await page.getByTestId("run").click();
  await expect.poll(() => toggles(page, 17), { timeout: 20_000 }).toBeGreaterThanOrEqual(1);

  // The text does not parse as JSON: the core is not reconfigured, parts and binding stay in place.
  await page.getByTestId("file").filter({ hasText: "fpgasim.json" }).click();
  await replaceEditorText(page, '{ "format": 1, ');
  await page.keyboard.press("ControlOrMeta+s");
  await expect.poll(() => sim(page, (api) => api.editor().dirty)).toEqual([]);
  const before = await toggles(page, 17);
  await expect.poll(() => toggles(page, 17), { timeout: 20_000 }).toBeGreaterThan(before);
  expect(await sim(page, (api) => api.state().run)).toBe("running");
  expect(await sim(page, (api) => api.parts().some((p) => p.id === "led1"))).toBe(true);
  expect(await sim(page, (api) => api.net(4) !== null)).toBe(true);

  // Valid JSON with an unfinished part: the page does not crash, the part of the wrong kind is not shown.
  await replaceEditorText(
    page,
    '{ "format": 1, "pins": { "clk": null }, "parts": [null, { "id": "x", "type": "led" }] }',
  );
  await page.keyboard.press("ControlOrMeta+s");
  await expect.poll(() => sim(page, (api) => api.editor().dirty)).toEqual([]);
  await expect.poll(() => sim(page, (api) => api.parts().some((p) => p.origin === "breadboard"))).toBe(false);
  await expect(page.getByTestId("board")).toBeVisible();
  await expect(page.getByTestId("part-add")).toBeEnabled();

  // After the file is fixed, the edit from the dialog works again.
  await replaceEditorText(page, '{ "format": 1 }');
  await page.keyboard.press("ControlOrMeta+s");
  await page.getByTestId("binding-open").click();
  await bind(page, "clk", 4);
  await expect.poll(() => boundPins(page)).toHaveLength(1);
});
