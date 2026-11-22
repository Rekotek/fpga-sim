// Four cases of the assistant spike (2026-11-22) with the real model on the dev stand. Each answer, its tools and
// tokens go to .fpgasim/assistant-live/results.json with a screenshot; a person reads the answers.
import { readFileSync, writeFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const KEY = readFileSync(new URL("../../.fpgasim/dev/key", import.meta.url), "utf8").trim();
const OUT = new URL("../../.fpgasim/assistant-live/", import.meta.url);

const LED_INVERTED = `module top (
    input  wire       btn1,
    input  wire       btn2,
    output wire [5:0] led
);
    assign led[0] = btn1;
    assign led[1] = btn2;
    assign led[5:2] = 4'b0000;
endmodule
`;
const WRONG_PERIOD = `module top (
    input  wire       clk,
    output wire [5:0] led
);
    reg [24:0] cnt = 0;
    reg q = 0;
    always @(posedge clk) begin
        if (cnt == 27_000) begin cnt <= 0; q <= ~q; end
        else cnt <= cnt + 1'b1;
    end
    assign led = {5'b11111, ~q};
endmodule
`;
const SYNTAX_ERROR = WRONG_PERIOD.replace("27_000", "13_499_999").replace("cnt + 1'b1;", "cnt + 1'b1");

const CASES = [
  {
    id: "led_inverted",
    example: "buttons",
    top: LED_INVERTED,
    record: false,
    question:
      "Почему LED0 горит, хотя кнопку S1 я не нажимал? И почему горят LED2–LED5, я же выключил их нулями? Хочу, чтобы LED0 горел только пока нажата S1.",
  },
  {
    id: "button_nopull",
    example: "buttons_nopull",
    top: null,
    record: false,
    question: "Как правильно подключить кнопку, чтобы она срабатывала? Кажется, что-то не так с кнопками.",
  },
  {
    id: "wave_period",
    example: "blink3",
    top: WRONG_PERIOD,
    record: true,
    question:
      "LED0 должен мигать раз в секунду, а на плате он будто просто горит тусклым. Я записал осциллограмму, посмотри по ней, в чём дело.",
  },
  {
    id: "syntax_error",
    example: "blink3",
    top: SYNTAX_ERROR,
    record: false,
    question: "Проект не собирается. Что не так?",
  },
];

const results: unknown[] = [];

async function state<T>(page: Page, code: string): Promise<T> {
  return page.evaluate<T>(code);
}

for (const c of CASES) {
  test(c.id, async ({ page }) => {
    await page.goto(`/?debug=1#key=${encodeURIComponent(KEY)}`);
    await page.getByTestId("example-menu").click();
    await page.locator(`[data-testid="example-item"][data-example="${c.example}"]`).click();
    await expect(page.getByTestId("project-name")).toHaveText(c.example);
    if (c.top) {
      await page
        .locator('[data-testid="file"]')
        .filter({
          has: page.locator('[data-testid="file-path"]', {
            hasText: /^top\.v( •)?$/,
          }),
        })
        .click();
      await page.locator(".cm-content").click();
      await page.keyboard.press("ControlOrMeta+a");
      await page.keyboard.insertText(c.top);
      await page.keyboard.press("ControlOrMeta+s");
    }
    await page.getByTestId("build").click();
    await expect
      .poll(() => state<string>(page, "window.__fpgasim.state().build.status"), { timeout: 90_000 })
      .toMatch(/^(ok|failed|error)$/);
    if ((await state<string>(page, "window.__fpgasim.state().build.status")) === "ok") {
      await page.getByTestId("run").click();
      await page.waitForTimeout(1500);
    }
    if (c.record) {
      await page.getByTestId("tab-signals").click();
      await page.locator('[data-testid="signal-row"][data-name="pin:15"]').getByTestId("signal-record").click();
      await page.getByTestId("tab-waves").click();
      await page.getByTestId("wave-start").click();
      await page.waitForTimeout(1500);
      await page.getByTestId("wave-stop").click();
    }
    await page.getByTestId("tab-assistant").click();
    await page.getByTestId("assistant-input").fill(c.question);
    await page.getByTestId("assistant-ask").click();
    await expect
      .poll(() => state<number>(page, "window.__fpgasim.assistant().filter((t) => t.answer || t.error).length"), {
        timeout: 4 * 60_000,
      })
      .toBe(1);
    await expect(page.getByTestId("assistant-step")).toHaveCount(0);
    const [turn] = await state<unknown[]>(page, "window.__fpgasim.assistant()");
    results.push({ case: c.id, ...(turn as object) });
    writeFileSync(new URL("results.json", OUT), JSON.stringify(results, null, 2));
    await page.screenshot({ path: new URL(`${c.id}.png`, OUT).pathname });
  });
}
