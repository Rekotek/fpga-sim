// Acceptance of version 1 on the production URLs (stage 11, spec section 12): static files and their headers, build,
// testbench, four sessions, all lessons 2-10 with build time and speed measurement.
// The measurement goes to .fpgasim/prod-lessons.json: the table of the report docs/v1-report.md comes from it.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { checkExpect, readExpect, runLesson } from "../tests/expect";
import { parallelSessions, watchProblems } from "../tests/sessions";
import { KEY, build, choose, createFromExample, openWithKey, sim, simWith } from "../tests/stand";

const SERVER = (process.env.FPGASIM_SERVER ?? process.env.FPGASIM_BUILD_URL ?? "").replace(/\/+$/, "");
const LESSONS_DIR = new URL("../../examples/lessons/", import.meta.url);
const LESSONS = readdirSync(LESSONS_DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();
const REPORT = new URL("../../.fpgasim/prod-lessons.json", import.meta.url);

interface Measure {
  name: string;
  buildMs: number; // cold build on the server
  wasmBytes: number;
  clocked: boolean;
  ratio: number | null; // ratio of simulation time to real time at speed "maximum"
  mhz: number | null; // millions of clock cycles per second
}

const measures: Measure[] = [];

test("статика: заголовки безопасности, защищённый контекст, сервер отвечает", async ({ page }) => {
  const problems = await watchProblems(page);
  // The headers are read by a separate request: the page opens once, by a link with the key.
  const response = await page.request.get("/");
  expect(response.status()).toBe(200);
  const policy = response.headers()["content-security-policy"] ?? "";
  expect(policy).toContain("script-src 'self' 'wasm-unsafe-eval' blob:");
  expect(policy).toContain(`connect-src 'self' ${SERVER}`);
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  await openWithKey(page);
  // "Open folder" works only in a secure context (spec section 9.2).
  expect(await page.evaluate(() => window.isSecureContext && "showDirectoryPicker" in window)).toBe(true);
  await expect(page.getByTestId("folder-open")).toBeEnabled();
  await expect(page.getByTestId("status")).toContainText("Сервер сборки работает");
  // The key from the link is removed from the address bar.
  expect(page.url()).not.toContain("key=");
  expect(problems).toEqual([]);
});

test("blink3: сборка, пуск и тестбенч на рабочем сервере", async ({ page }) => {
  const problems = await watchProblems(page);
  await openWithKey(page);
  await createFromExample(page, "blink3");
  expect(await build(page)).toBe("ok");
  await page.getByTestId("run").click();
  await expect.poll(() => sim(page, (api) => api.state().cycle), { timeout: 30_000 }).toBeGreaterThan(27_000_000);
  await page.getByTestId("pause").click();
  await page.getByTestId("tab-testbench").click();
  await page.getByTestId("testbench-run").click();
  await expect(page.getByTestId("testbench-output")).toContainText("PASS: 8 checks", { timeout: 60_000 });
  await expect(page.getByTestId("testbench-wave")).toBeEnabled();
  expect(problems).toEqual([]);
});

// Tang Nano 9K board (spec section 3.3): both the static files and the server image read the board file,
// so the 9K project checks both deployments.
test("buttons_9k: плата 9K, сборка, expect.json и кнопка S2 на рабочем сервере", async ({ page }) => {
  const problems = await watchProblems(page);
  await openWithKey(page);
  await createFromExample(page, "buttons_9k");
  expect(await sim(page, (api) => api.board())).toBe("tang-nano-9k");
  expect(await build(page)).toBe("ok");
  await expect.poll(() => sim(page, (api) => api.state().run)).toBe("paused");
  expect(await sim(page, (api) => api.diagnostics().filter((d) => d.severity === "error"))).toEqual([]);
  await checkExpect(page, readExpect("examples/buttons_9k"));
  // Key "2" presses S2: the active level of the button is zero, pin 4.
  await page.getByTestId("run").click();
  await expect.poll(() => sim(page, (api) => api.state().run)).toBe("running");
  await page.getByTestId("board").click({ position: { x: 4, y: 4 } });
  const level = () => simWith(page, 4, (api, pin) => api.net(pin)?.level ?? -1);
  await expect.poll(level).toBe(1);
  await page.keyboard.down("2");
  await expect.poll(level).toBe(0);
  await page.keyboard.up("2");
  await expect.poll(level).toBe(1);
  expect(problems).toEqual([]);
});

test("четыре одновременных сеанса собирают и запускают разные проекты без ошибок", async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  await parallelSessions(browser, baseURL ?? "", ["blink3", "uart_hello", "lesson05_runner", "lesson10_color"]);
});

// Cold build: a comment with a label is added to top.v, so the server cache does not hit.
async function coldBuild(request: APIRequestContext, name: string): Promise<{ buildMs: number; wasmBytes: number }> {
  const dir = new URL(`${name}/`, LESSONS_DIR);
  // fpgasim.json goes as the config field, as from the interface, not as a schema file.
  const names = readdirSync(dir);
  const config: unknown = names.includes("fpgasim.json")
    ? JSON.parse(readFileSync(new URL("fpgasim.json", dir), "utf8"))
    : null;
  const files = names
    .filter((file) => file !== "expect.json" && file !== "fpgasim.json")
    .map((file) => {
      const content = readFileSync(new URL(file, dir), "utf8");
      return {
        path: file,
        content: file === "top.v" ? `${content}\n// замер ${String(Date.now())}\n` : content,
      };
    });
  const headers = { Authorization: `Bearer ${KEY}` };
  const response = await request.post(`${SERVER}/v1/build`, {
    headers,
    data: { files, config, options: { visibility: null } },
    timeout: 90_000,
  });
  expect(response.status(), await response.text()).toBe(200);
  const body = (await response.json()) as {
    status: string;
    cached: boolean;
    durationMs: number;
    artifacts: { wasm: string };
  };
  expect(body.status).toBe("ok");
  expect(body.cached).toBe(false);
  const wasm = await request.get(`${SERVER}${body.artifacts.wasm}`, {
    headers,
  });
  return { buildMs: body.durationMs, wasmBytes: (await wasm.body()).length };
}

// Speed at the multiplier "maximum": simulation time in 3 s of real time.
async function maxSpeed(page: Page): Promise<{ ratio: number; mhz: number }> {
  await page.getByTestId("reset").click();
  await expect.poll(() => sim(page, (api) => api.state().time)).toBe("0");
  await choose(page.getByTestId("speed"), "max");
  await page.getByTestId("run").click();
  await expect.poll(() => sim(page, (api) => api.state().run)).toBe("running");
  await page.waitForTimeout(500);
  const read = () =>
    sim(page, (api) => ({
      time: api.state().time,
      cycle: api.state().cycle,
      real: performance.now(),
    }));
  const before = await read();
  await page.waitForTimeout(3000);
  const after = await read();
  await page.getByTestId("pause").click();
  const seconds = (after.real - before.real) / 1000;
  return {
    ratio: Number(BigInt(after.time) - BigInt(before.time)) / 1e12 / seconds,
    mhz: (after.cycle - before.cycle) / 1e6 / seconds,
  };
}

test.describe("уроки 2–10", () => {
  for (const name of LESSONS) {
    test(`${name}: собирается и проходит expect.json`, async ({ page, request }) => {
      test.setTimeout(240_000);
      const cold = await coldBuild(request, name);
      await openWithKey(page);
      await runLesson(page, name);
      const clocked = (await sim(page, (api) => api.state().cycle)) > 0;
      const speed = clocked ? await maxSpeed(page) : null;
      measures.push({
        name,
        ...cold,
        clocked,
        ratio: speed?.ratio ?? null,
        mhz: speed?.mhz ?? null,
      });
    });
  }

  test.afterAll(() => {
    if (measures.length === 0) return;
    mkdirSync(new URL("./", REPORT), { recursive: true });
    writeFileSync(
      REPORT,
      `${JSON.stringify({ server: SERVER, date: new Date().toISOString(), lessons: measures }, null, 2)}\n`,
    );
  });
});
