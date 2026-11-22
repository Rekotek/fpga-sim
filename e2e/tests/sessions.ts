// Shared steps of stage 11: watching for content security policy violations and simultaneous sessions.
import { expect, type Browser, type Page } from "@playwright/test";
import { KEY, pickExample, sim } from "./stand";

// Page errors: exceptions, console messages of level error and content security policy violations.
// Call it before opening the page.
export async function watchProblems(page: Page): Promise<string[]> {
  const problems: string[] = [];
  page.on("pageerror", (error) => problems.push(`исключение: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(`консоль: ${message.text()}`);
  });
  await page.exposeFunction("__reportCsp", (text: string) => problems.push(`политика: ${text}`));
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      const report = (window as unknown as { __reportCsp: (text: string) => void }).__reportCsp;
      report(`${event.violatedDirective} ${event.blockedURI}`);
    });
  });
  return problems;
}

// Several sessions at once (stage 11 criterion): each has its own browser context and its own project.
// The builds run at the same time; then each session starts the simulation, and its time grows.
export async function parallelSessions(browser: Browser, baseURL: string, examples: string[]): Promise<void> {
  const sessions = await Promise.all(
    examples.map(async (name) => {
      const context = await browser.newContext({ baseURL });
      const page = await context.newPage();
      const problems = await watchProblems(page);
      await page.goto(`/?debug=1#key=${encodeURIComponent(KEY)}`);
      await pickExample(page, name);
      await expect(page.getByTestId("project-name")).toHaveText(name);
      return { name, context, page, problems };
    }),
  );
  try {
    await Promise.all(sessions.map(({ page }) => page.getByTestId("build").click()));
    await Promise.all(
      sessions.map(async ({ name, page }) => {
        const status = () => sim(page, (api) => api.state().build.status);
        // The server runs two jobs at once, the others wait in the queue (spec section 8.5).
        await expect.poll(status, { timeout: 120_000, message: name }).toMatch(/^(ok|failed|error)$/);
        expect(await status(), `${name}: ${JSON.stringify(await sim(page, (api) => api.state().build))}`).toBe("ok");
        await page.getByTestId("run").click();
      }),
    );
    await Promise.all(
      sessions.map(async ({ name, page }) => {
        await expect.poll(() => sim(page, (api) => api.state().run), { message: name }).toBe("running");
        const time = () => sim(page, (api) => Number(BigInt(api.state().time) / 1_000_000n));
        // 5 ms of simulation time: passes even for a design that the simulator computes slower than real time.
        await expect.poll(time, { timeout: 30_000, message: name }).toBeGreaterThan(5000);
      }),
    );
    const ids = await Promise.all(sessions.map(({ page }) => sim(page, (api) => api.state().build.buildId)));
    expect(new Set(ids).size).toBe(examples.length);
    for (const { name, problems } of sessions) expect(problems, name).toEqual([]);
  } finally {
    await Promise.all(sessions.map(({ context }) => context.close()));
  }
}
