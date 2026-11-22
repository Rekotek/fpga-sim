// Acceptance criteria of stage 9 (spec section 12): the "Testbench" tab, output and exit code,
// waveform from a VCD file, compile error with file and line, truncated output, time limit.
import { expect, test, type Page } from "@playwright/test";
import { build, createFromExample, openWithKey, replaceEditorText, sim } from "./stand";

const run = (page: Page) => sim(page, (api) => api.testbench());
const wave = (page: Page) => sim(page, (api) => api.wave());
const view = (page: Page) => sim(page, (api) => api.waveView());
const waveRow = (page: Page, name: string) => page.locator(`[data-testid="wave-row"][data-name="${name}"]`);

async function openTestbench(page: Page, example: string): Promise<void> {
  await openWithKey(page);
  await createFromExample(page, example);
  // The server names the file roles when the project opens: the file list marks the top module and the testbench.
  await expect.poll(() => sim(page, (api) => api.fileRoles())).toEqual({ top: "top.v", testbenches: ["tb_top.v"] });
  const file = (path: string) => page.getByTestId("file").filter({ has: page.getByText(path, { exact: true }) });
  await expect(file("top.v").getByTestId("file-mark-top")).toBeVisible();
  await expect(file("tb_top.v").getByTestId("file-mark-testbench")).toBeVisible();
  await expect(page.getByTestId("file-mark-top")).toHaveCount(1);
  await expect(page.getByTestId("file-mark-testbench")).toHaveCount(1);
  // This request does not touch the messages and the check counter.
  expect(await sim(page, (api) => [api.state().checks, api.diagnostics().length])).toEqual([0, 0]);
  await page.getByTestId("tab-testbench").click();
  await expect.poll(() => run(page).then((r) => r.files)).toEqual(["tb_top.v"]);
  await expect(page.getByTestId("testbench-file")).toHaveAttribute("data-value", "tb_top.v");
}

async function runTestbench(page: Page, timeout = 30_000): Promise<Awaited<ReturnType<typeof run>>> {
  await page.getByTestId("testbench-run").click();
  await expect.poll(() => run(page).then((r) => r.status), { timeout }).not.toMatch(/^(none|running)$/);
  return run(page);
}

// New testbench text: the file opens in the editor, the edit is saved by the run.
async function writeTestbench(page: Page, text: string): Promise<void> {
  await page.getByTestId("file").filter({ hasText: "tb_top.v" }).click();
  await expect.poll(() => sim(page, (api) => api.editor().path)).toBe("tb_top.v");
  await replaceEditorText(page, text);
}

for (const [example, text, signals] of [
  ["blink3", "PASS: 8 checks", ["tb_top.clk", "tb_top.led", "tb_top.dut.cnt_a", "tb_top.dut.q"]],
  ["shift_chain", "PASS: 6 checks", ["tb_top.clk", "tb_top.good", "tb_top.bad", "tb_top.u_good.q"]],
] as const) {
  test(`тестбенч ${example}: ожидаемый текст, код 0 и осциллограмма`, async ({ page }) => {
    await openTestbench(page, example);
    await expect(page.getByTestId("testbench-wave")).toBeDisabled();
    const result = await runTestbench(page);
    expect([result.status, result.exitCode, result.truncated, result.error]).toEqual(["ok", 0, false, null]);
    expect(result.stdout).toContain(`${text}\n`);
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    await expect(page.getByTestId("testbench-output")).toContainText(text);
    await expect(page.getByTestId("testbench-status")).toContainText("завершён с кодом 0");

    // The waveform opens in the panel: the rows are the signals of the VCD file, at least three.
    await page.getByTestId("testbench-wave").click();
    await expect.poll(() => sim(page, (api) => api.bottomTab())).toBe("waves");
    const model = await wave(page);
    expect(model?.source).toBe("vcd");
    const names = (model?.signals ?? []).map((s) => s.name);
    expect(names.length).toBeGreaterThanOrEqual(3);
    expect(names).toEqual(expect.arrayContaining([...signals]));
    expect(model?.signals.find((s) => s.name === "tb_top.clk")?.changes).toBeGreaterThan(5);
    const shown = await view(page);
    expect(shown.vcd).toBe("tb_top.v");
    expect(shown.rows).toEqual(names);
    // The view window covers the whole file (with margins at the edges).
    expect(shown.fromPs).toBeLessThanOrEqual(Number(model?.fromPs));
    expect(shown.toPs).toBeGreaterThanOrEqual(Number(model?.toPs));
    expect(shown.toPs - shown.fromPs).toBeLessThan(1.5 * (Number(model?.toPs) - Number(model?.fromPs)));
    for (const name of signals) await expect(waveRow(page, name)).toBeVisible();
    await expect(page.getByTestId("wave-source")).toContainText("tb_top.v");
    await expect(page.getByTestId("wave-start")).toHaveCount(0);
    await expect(page.getByTestId("wave-canvas")).toBeVisible();

    // Reordering and deleting rows work in the panel and do not touch fpgasim.json.
    // The last of the checked signals is not first in the file: it can be moved up.
    const moved = signals[3];
    const before = names.indexOf(moved);
    expect(before).toBeGreaterThan(0);
    await waveRow(page, moved).getByTestId("wave-up").click();
    expect((await view(page)).rows.indexOf(moved)).toBe(before - 1);
    await waveRow(page, signals[0]).getByTestId("wave-remove").click();
    const rows = (await view(page)).rows;
    expect(rows).not.toContain(signals[0]);
    expect(rows.length).toBe(names.length - 1);
    // These examples have no fpgasim.json file: editing rows does not create it.
    expect(await sim(page, (api) => api.file("fpgasim.json"))).toBeNull();

    // Back to the simulator record: the panel shows the record list again.
    await page.getByTestId("wave-close-vcd").click();
    expect(await view(page)).toMatchObject({ vcd: null, rows: [] });
    expect(await wave(page)).toBeNull();
    await expect(page.getByTestId("wave-start")).toBeVisible();

    // The testbench file does not go into the simulator build: the project builds as it does without it.
    expect(await build(page)).toBe("ok");
    expect((await sim(page, (api) => api.signals())).some((s) => s.path.startsWith("tb_top"))).toBe(false);
  });
}

test("ошибка компиляции тестбенча показана с файлом и строкой", async ({ page }) => {
  await openTestbench(page, "blink3");
  await writeTestbench(
    page,
    ["module tb_top;", "    initial begin", '        $display("no semicolon")', "    end", "endmodule", ""].join("\n"),
  );
  const result = await runTestbench(page);
  expect([result.status, result.exitCode, result.vcd, result.stdout]).toEqual(["failed", null, null, ""]);
  const errors = result.diagnostics.filter((d) => d.severity === "error");
  expect(errors.length).toBeGreaterThan(0);
  const first = errors[0];
  expect([first?.source, first?.file]).toEqual(["iverilog", "tb_top.v"]);
  expect([3, 4]).toContain(first?.line);
  // The message is in the tab with a place in the code; a click moves the editor to that line.
  const message = page.getByTestId("testbench-messages").getByTestId("message").first();
  await expect(message).toContainText(`tb_top.v:${String(first?.line)}`);
  await expect(page.getByTestId("testbench-status")).toHaveAttribute("data-status", "failed");
  await expect(page.getByTestId("testbench-wave")).toBeDisabled();
  await page.getByTestId("file").filter({ hasText: "top.cst" }).click();
  await message.click();
  expect(await sim(page, (api) => api.editor())).toMatchObject({ path: "tb_top.v", line: first?.line });
});

test("длинный вывод обрезан, бесконечный тестбенч остановлен по времени", async ({ page }) => {
  test.setTimeout(120_000);
  await openTestbench(page, "blink3");
  await writeTestbench(
    page,
    [
      "module tb_top;",
      "    integer i;",
      "    initial begin",
      "        for (i = 0; i < 6000; i = i + 1)",
      '            $display("%05d 67890123456789012345678901234567890123456789012345678901234567890123456789", i);',
      "        $finish;",
      "    end",
      "endmodule",
      "",
    ].join("\n"),
  );
  const long = await runTestbench(page);
  expect([long.status, long.exitCode, long.truncated, long.vcd]).toEqual(["ok", 0, true, null]);
  expect(long.stdout.length).toBe(256 * 1024);
  await expect(page.getByTestId("testbench-truncated")).toContainText("Вывод обрезан");

  // Without $finish the testbench does not end: the server stops it after 20 s, the response comes no later than 25 s.
  await writeTestbench(
    page,
    [
      "module tb_top;",
      "    reg clk = 0;",
      "    always #1 clk = ~clk;",
      '    initial $display("started");',
      "endmodule",
      "",
    ].join("\n"),
  );
  const started = Date.now();
  const endless = await runTestbench(page, 40_000);
  expect(Date.now() - started).toBeLessThan(25_000);
  expect([endless.status, endless.exitCode, endless.stdout]).toEqual(["timeout", null, "started\n"]);
  expect(endless.diagnostics.map((d) => d.code)).toEqual(["TB_TIMEOUT"]);
  await expect(page.getByTestId("testbench-status")).toContainText("остановлен по времени");
  await expect(page.getByTestId("testbench-messages")).toContainText("не закончился за 20 с");
});
