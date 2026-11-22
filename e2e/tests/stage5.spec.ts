// Acceptance criteria of stage 5 (spec section 12): board, LEDs, buttons, time control.
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { build, choose, createFromExample, fileAction, openWithKey, replaceEditorText, sim, simWith } from "./stand";

const cycle = (page: Page) => sim(page, (api) => api.state().cycle);
const idle = (page: Page) => sim(page, (api) => api.state().run === "paused" && !api.state().stepping);

// A step by a command to the core and waiting for its end: the core sends state and a frame when the step is done.
async function stepCycles(page: Page, count: number): Promise<void> {
  const target = (await cycle(page)) + count;
  await simWith(page, count, (api, n) => api.command({ t: "step", unit: "cycle", count: n }));
  await expect.poll(() => cycle(page), { timeout: 60_000 }).toBe(target);
}

async function openExample(page: Page, name: string): Promise<void> {
  await openWithKey(page);
  await createFromExample(page, name);
  expect(await build(page)).toBe("ok");
  await expect.poll(() => sim(page, (api) => api.state().run)).toBe("paused");
}

const brightness = (page: Page, id: string) => simWith(page, id, (api, part) => api.part(part)?.brightness ?? -1);
const pressed = (page: Page, id: string) => simWith(page, id, (api, part) => api.part(part)?.pressed ?? null);

test("buttons: клавиша «1» меняет part(led0), отпускание возвращает; мышь и Shift работают так же", async ({
  page,
}) => {
  await openExample(page, "buttons");
  await page.getByTestId("run").click();
  await expect.poll(() => sim(page, (api) => api.state().run)).toBe("running");
  expect(await brightness(page, "led0")).toBe(0);
  expect(await brightness(page, "led1")).toBe(0);

  // Focus leaves the editor: button keys work only outside it (spec section 9.4).
  await page.getByTestId("board").click({ position: { x: 4, y: 4 } });
  await page.keyboard.down("1");
  await expect.poll(() => brightness(page, "led0")).toBe(1);
  expect(await pressed(page, "s1")).toBe(true);
  expect(await brightness(page, "led1")).toBe(0);
  expect(await sim(page, (api) => api.net(88)?.level)).toBe(1);
  await page.keyboard.up("1");
  await expect.poll(() => brightness(page, "led0")).toBe(0);
  expect(await pressed(page, "s1")).toBe(false);

  // Key "2" is button S2 and led[1].
  await page.keyboard.down("2");
  await expect.poll(() => brightness(page, "led1")).toBe(1);
  await page.keyboard.up("2");
  await expect.poll(() => brightness(page, "led1")).toBe(0);

  // Mouse: a press on the drawing holds the button, a release releases it.
  const box = await page.getByTestId("board").boundingBox();
  const point = await sim(page, (api) => api.part("s1")?.point ?? { x: 0, y: 0 });
  if (!box) throw new Error("нет области платы");
  await page.mouse.move(box.x + point.x, box.y + point.y);
  await page.mouse.down();
  await expect.poll(() => brightness(page, "led0")).toBe(1);
  await page.mouse.up();
  await expect.poll(() => brightness(page, "led0")).toBe(0);

  // A click with Shift latches the press; the next click releases it.
  await page.keyboard.down("Shift");
  await page.mouse.down();
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await expect.poll(() => brightness(page, "led0")).toBe(1);
  await page.waitForTimeout(300);
  expect(await brightness(page, "led0")).toBe(1);
  await page.mouse.down();
  await page.mouse.up();
  await expect.poll(() => brightness(page, "led0")).toBe(0);

  // On pause a press is also visible at once: the pin level and the LED change without a step and a run.
  await page.getByTestId("pause").click();
  await expect.poll(() => sim(page, (api) => api.state().run)).toBe("paused");
  const paused = await sim(page, (api) => api.state().time);
  await page.getByTestId("board").click({ position: { x: 4, y: 4 } });
  await page.keyboard.down("1");
  await expect.poll(() => pressed(page, "s1")).toBe(true);
  await expect.poll(() => sim(page, (api) => api.net(88)?.level)).toBe(1);
  await expect.poll(() => sim(page, (api) => api.part("led0")?.shown ?? 0)).toBeGreaterThan(0.99);
  // A release with Shift held reaches the button.
  await page.keyboard.down("Shift");
  await page.keyboard.up("1");
  await page.keyboard.up("Shift");
  await expect.poll(() => pressed(page, "s1")).toBe(false);
  await expect.poll(() => sim(page, (api) => api.net(88)?.level)).toBe(0);
  expect(await sim(page, (api) => api.state().time)).toBe(paused);

  // Reset releases the latched button both in the core and on the drawing.
  await page.mouse.move(box.x + point.x, box.y + point.y);
  await page.keyboard.down("Shift");
  await page.mouse.down();
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await expect.poll(() => sim(page, (api) => api.part("s1")?.latched)).toBe(true);
  await page.getByTestId("reset").click();
  await expect.poll(() => sim(page, (api) => api.part("s1")?.latched)).toBe(false);
  await expect.poll(() => pressed(page, "s1")).toBe(false);

  // In the editor key "1" is text, not a button.
  await page.locator(".cm-content").click();
  await page.keyboard.down("1");
  await page.waitForTimeout(200);
  expect(await pressed(page, "s1")).toBe(false);
  await page.keyboard.up("1");
});

test("pwm_fade: яркость в контрольные моменты совпадает с расчётной", async ({ page }) => {
  await openExample(page, "pwm_fade");
  // The calculation is at the start of examples/pwm_fade/top.v: the level changes once per 131 072 clock cycles, brightness equals
  // level / 256. The measurement takes 4096 clock cycles (16 PWM periods) in the middle of a step.
  const STEP = 131_072;
  const WINDOW = 4096;
  const moments = [
    { stage: 32, expected: 32 / 256 },
    { stage: 128, expected: 128 / 256 },
    { stage: 224, expected: 224 / 256 },
    // The level is already falling: step 382 is level 510 - 382 = 128.
    { stage: 382, expected: 128 / 256 },
  ];
  for (const moment of moments) {
    const target = moment.stage * STEP + STEP / 2;
    await stepCycles(page, target - (await cycle(page)));
    await stepCycles(page, WINDOW);
    const measured = await brightness(page, "led0");
    console.log(
      `pwm_fade: ступень ${String(moment.stage)}, яркость ${measured.toFixed(4)}, расчёт ${moment.expected.toFixed(4)}`,
    );
    expect(Math.abs(measured - moment.expected)).toBeLessThanOrEqual(0.05);
    // led[1] lights constantly at 1/8 brightness.
    expect(Math.abs((await brightness(page, "led1")) - 32 / 256)).toBeLessThanOrEqual(0.05);
  }
});

test("blink3: шаг на 1 такт, шаг до изменения выхода, шаг по времени, сброс", async ({ page }) => {
  await openExample(page, "blink3");
  expect(await cycle(page)).toBe(0);

  // A step of 1 clock cycle raises the clock cycle number by exactly 1.
  await page.getByTestId("step").click();
  await expect.poll(() => cycle(page)).toBe(1);
  await page.getByTestId("step").click();
  await expect.poll(() => cycle(page)).toBe(2);
  await choose(page.getByTestId("step-kind"), "cycle10");
  await page.getByTestId("step").click();
  await expect.poll(() => cycle(page)).toBe(12);

  // Reset returns the time and the clock cycle to zero.
  await page.getByTestId("reset").click();
  await expect.poll(() => cycle(page)).toBe(0);
  expect(await sim(page, (api) => api.state().time)).toBe("0");

  // The step "until output change" stops at the first switch of the fastest counter.
  // cnt_c counts from 0 and resets at 27 000 000 / 8 - 1 = 3 374 999: it has this value
  // before the edge number 3 375 000, and on this edge q[2] (led[2], pin 17) switches.
  await choose(page.getByTestId("step-kind"), "change");
  await page.getByTestId("step").click();
  await expect.poll(() => cycle(page), { timeout: 30_000 }).toBeGreaterThan(0);
  await expect.poll(() => idle(page)).toBe(true);
  expect(await cycle(page)).toBe(3_375_000);
  expect(await sim(page, (api) => [api.net(15)?.toggles, api.net(16)?.toggles, api.net(17)?.toggles])).toEqual([
    0, 0, 1,
  ]);

  await page.getByTestId("reset").click();
  await expect.poll(() => cycle(page)).toBe(0);
  expect(await sim(page, (api) => api.state().time)).toBe("0");
  expect(await sim(page, (api) => api.net(17)?.toggles)).toBe(0);

  // A long step is interrupted by pause.
  await choose(page.getByTestId("step-kind"), "time");
  await page.getByTestId("step-time").fill("600000");
  await page.getByTestId("step").click();
  await expect.poll(() => sim(page, (api) => api.state().stepping)).toBe(true);
  await page.getByTestId("pause").click();
  await expect.poll(() => idle(page)).toBe(true);
  expect(BigInt(await sim(page, (api) => api.state().time))).toBeLessThan(600_000_000_000_000n);
  await page.getByTestId("reset").click();
  await expect.poll(() => cycle(page)).toBe(0);

  // A step by the given time: 1 ms is 27 000 clock cycles.
  await choose(page.getByTestId("step-kind"), "time");
  await page.getByTestId("step-time").fill("1");
  await page.getByTestId("step").click();
  await expect.poll(() => cycle(page)).toBe(27_000);
  expect(await sim(page, (api) => api.state().time)).toBe("1000000000");
});

test("blink3: при множителе 0,1 за 5 с настоящего времени проходит 0,5 с времени симуляции", async ({ page }) => {
  await openExample(page, "blink3");
  await choose(page.getByTestId("speed"), "0.1");
  await expect.poll(() => sim(page, (api) => api.state().speed)).toBe(0.1);
  await page.getByTestId("run").click();
  await expect.poll(() => sim(page, (api) => api.state().run)).toBe("running");
  const read = () => sim(page, (api) => ({ time: api.state().time, real: performance.now() }));
  const before = await read();
  await page.waitForTimeout(5000);
  const after = await read();
  const simSeconds = Number(BigInt(after.time) - BigInt(before.time)) / 1e12;
  const realSeconds = (after.real - before.real) / 1000;
  // The Playwright wait does not last exactly 5 s, so the elapsed simulation time is scaled to 5 s.
  const per5 = (simSeconds / realSeconds) * 5;
  console.log(`blink3 при 0,1×: ${simSeconds.toFixed(4)} с симуляции за ${realSeconds.toFixed(3)} с`);
  expect(per5).toBeGreaterThanOrEqual(0.5 * 0.95);
  expect(per5).toBeLessThanOrEqual(0.5 * 1.05);
  await expect(page.getByTestId("ratio")).toHaveText(/^0,1\d×$/);

  // Reset on the fly returns the time and the clock cycle to zero and sets pause.
  await page.getByTestId("reset").click();
  await expect.poll(() => sim(page, (api) => api.state().run)).toBe("paused");
  expect(await cycle(page)).toBe(0);
  expect(await sim(page, (api) => api.state().time)).toBe("0");
});

test("shift_chain: BLKSEQ показано с русским текстом на верной строке, сборка успешна", async ({ page }) => {
  await openExample(page, "shift_chain");
  const source = readFileSync(new URL("../../examples/shift_chain/top.v", import.meta.url), "utf8").split("\n");
  const line = source.findIndex((text) => text.includes("q[0] = d;")) + 1;
  expect(line).toBeGreaterThan(1);

  const messages = await sim(page, (api) => api.messages().filter((m) => m.code === "BLKSEQ"));
  expect(messages[0]).toMatchObject({ level: "important", file: "top.v", line });
  expect(messages[0]?.text).toContain("В тактовом `always` стоит блокирующее `=`");
  expect(messages[0]?.explain).toContain("Блокирующее");

  // A row in the message panel: place, code, Russian text; a button shows the explanation.
  const row = page.locator('[data-testid="messages"] li[data-code="BLKSEQ"]').first();
  await expect(row.getByTestId("message")).toContainText(`top.v:${String(line)}`);
  await expect(row.getByTestId("message")).toContainText("В тактовом always стоит блокирующее =");
  await row.getByTestId("message-explain").click();
  await expect(row.getByTestId("message-explanation")).toContainText("Блокирующее = исполняется сразу");

  // The yellow warning marker is on the same editor line; a click on the message leads to it.
  expect((await sim(page, (api) => api.editor())).marks).toContainEqual({ line, severity: "warning" });
  await row.getByTestId("message").click();
  expect((await sim(page, (api) => api.editor())).line).toBe(line);
  await expect(page.locator(".cm-lint-marker-warning").first()).toBeVisible();
  // No errors: the simulation is loaded.
  expect(await sim(page, (api) => api.diagnostics().filter((d) => d.severity === "error"))).toEqual([]);
  expect(await sim(page, (api) => api.state().loaded)).toBe(true);
});

const BROKEN = `module top (
    input  wire       clk,
    output wire [5:0] led
);
    assign led = 6'b111111 + ;
endmodule
`;

test("проверка при правке и при сохранении ставит метки без сборки", async ({ page }) => {
  await openWithKey(page);
  await createFromExample(page, "blink3");
  const original = readFileSync(new URL("../../examples/blink3/top.v", import.meta.url), "utf8");

  // After 2 s idle following an edit /v1/check runs: the error marker appears without a build.
  await replaceEditorText(page, BROKEN);
  await expect.poll(() => sim(page, (api) => api.state().checks), { timeout: 15_000 }).toBe(1);
  expect((await sim(page, (api) => api.editor())).marks).toContainEqual({ line: 5, severity: "error" });
  expect(await sim(page, (api) => api.state().build.status)).toBe("none");
  await expect(page.locator('[data-testid="messages"] [data-level="error"]').first()).toBeVisible();

  // Saving (Ctrl/Cmd+S) checks at once: after the fix there are no error markers.
  await replaceEditorText(page, original);
  await page.keyboard.press("ControlOrMeta+s");
  await expect.poll(() => sim(page, (api) => api.state().checks), { timeout: 15_000 }).toBe(2);
  expect((await sim(page, (api) => api.editor())).marks.filter((m) => m.severity === "error")).toEqual([]);
  expect((await sim(page, (api) => api.editor())).dirty).toEqual([]);
  expect(await sim(page, (api) => api.state().build.status)).toBe("none");
});

test("раскладка: область сворачивается, граница двигается, раскладка переживает перезагрузку", async ({ page }) => {
  await openWithKey(page);
  await createFromExample(page, "blink3");
  const before = await sim(page, (api) => api.layout());
  expect(before.collapsed).toEqual({ files: false, editor: false, board: false });

  const splitter = await page.getByTestId("splitter-files").boundingBox();
  if (!splitter) throw new Error("нет границы области файлов");
  await page.mouse.move(splitter.x + 2, splitter.y + 100);
  await page.mouse.down();
  await page.mouse.move(splitter.x + 62, splitter.y + 100, { steps: 4 });
  await page.mouse.up();
  expect((await sim(page, (api) => api.layout())).files).toBe(before.files + 60);

  await page.getByTestId("area-toggle-board").click();
  await expect(page.getByTestId("board")).toHaveCount(0);
  expect((await sim(page, (api) => api.layout())).collapsed.board).toBe(true);

  await page.reload();
  await expect(page.getByTestId("project-name")).toHaveText("blink3");
  const after = await sim(page, (api) => api.layout());
  expect(after.files).toBe(before.files + 60);
  expect(after.collapsed.board).toBe(true);
  await page.getByTestId("area-toggle-board").click();
  await expect(page.getByTestId("board")).toBeVisible();
});

test("файлы проекта создаются, переименовываются и удаляются; диалог ограничений открывается", async ({ page }) => {
  await openWithKey(page);
  await createFromExample(page, "blink3");
  // The file name is in its own cell of the row: next to it are the file kind icon and the role mark (stage 9).
  const names = () => page.getByTestId("file-path").allInnerTexts();

  await page.getByTestId("file-create").click();
  await page.getByTestId("file-name-input").fill("top.v");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("file-problem")).toContainText("уже есть");
  await page.getByTestId("file-name-input").fill("extra.v");
  await page.keyboard.press("Enter");
  await expect.poll(names).toEqual(["extra.v", "tb_top.v", "top.cst", "top.v"]);
  expect((await sim(page, (api) => api.editor())).path).toBe("extra.v");

  await fileAction(page, "rename");
  await page.getByTestId("file-name-input").fill("helper.v");
  await page.keyboard.press("Enter");
  await expect.poll(names).toEqual(["helper.v", "tb_top.v", "top.cst", "top.v"]);

  await page.reload();
  await expect.poll(names).toEqual(["helper.v", "tb_top.v", "top.cst", "top.v"]);
  await page.getByTestId("file").filter({ hasText: "helper.v" }).click();
  await fileAction(page, "delete");
  await page.getByTestId("file-delete-confirm").click();
  await expect.poll(names).toEqual(["tb_top.v", "top.cst", "top.v"]);

  await page.getByTestId("limits-open").click();
  await expect(page.getByTestId("limits").locator("li")).toHaveCount(6);
  await expect(page.getByTestId("limits")).toContainText("Двунаправленные выводы не работают");
  await page.getByTestId("limits-close").click();
  await expect(page.getByTestId("limits")).toBeHidden();
});

test("чертёж платы: выводы показывают занятость и уровень", async ({ page }) => {
  await openExample(page, "blink3");
  const pins = await sim(page, (api) => api.pins());
  const state = (pin: number) => pins.find((p) => p.pin === pin);
  expect(pins).toHaveLength(34);
  expect(state(15)).toMatchObject({ state: "busy", level: 1 });
  expect(state(73)).toMatchObject({ state: "free", level: null });
  // Before the first switch the LEDs are off: pins at one, they light at zero.
  expect(await brightness(page, "led0")).toBe(0);
  await choose(page.getByTestId("step-kind"), "change");
  await page.getByTestId("step").click();
  await expect.poll(() => sim(page, (api) => api.state().cycle), { timeout: 30_000 }).toBe(3_375_000);
  expect((await sim(page, (api) => api.pins())).find((p) => p.pin === 17)?.level).toBe(0);
  // On pause the LED shows the instant pin level, not the average over the step: led[2] is on.
  await expect.poll(() => sim(page, (api) => api.part("led2")?.shown ?? 0)).toBeGreaterThan(0.99);
  expect(await sim(page, (api) => api.part("led0")?.shown)).toBeLessThan(0.01);
});
