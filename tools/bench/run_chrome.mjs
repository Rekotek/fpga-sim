// Benchmark: WebAssembly measurement in Chrome through Playwright.
// Usage: node run_chrome.mjs [bench/out directory relative to the root] [machine label]
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import { chromium } from "playwright";
import { startServer } from "./serve.mjs";
import { powerSpan, powerState } from "./power.mjs";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const outRel = process.argv[2] ?? "bench/out";
const host = process.argv[3] ?? "mac";
const port = 8377;

const powerStart = powerState();
const server = await startServer(port);
// The real Chrome installed on the machine, not the Chromium of Playwright.
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage();
  page.on("console", (m) => console.log(`[страница] ${m.text()}`));
  await page.goto(`http://127.0.0.1:${port}/tools/bench/bench.html?auto=1&out=/${outRel}`);
  await page.waitForFunction(() => window.__benchDone === true, null, { timeout: 30 * 60 * 1000 });
  const error = await page.evaluate(() => window.__benchError ?? null);
  if (error) throw new Error(error);
  const data = await page.evaluate(() => window.__benchResults);
  const results = data.results.map((r) => ({ ...r, env: `chrome-${host}` }));
  for (const r of results)
    console.log(`chrome ${r.mode}-${r.opt}${r.lto ? "-lto" : ""}: медиана ${r.median.toFixed(1)} млн тактов/с`);
  const doc = {
    host,
    arch: process.arch,
    cpu: os.cpus()[0]?.model,
    cpus: os.cpus().length,
    versions: { chrome: browser.version(), userAgent: data.userAgent },
    headless: true,
    power: powerSpan(powerStart, powerState()),
    halfSteps: data.halfSteps,
    results,
  };
  writeFileSync(resolve(root, outRel, `speed-chrome-${host}.json`), JSON.stringify(doc, null, 2) + "\n");
} finally {
  await browser.close();
  server.close();
}
