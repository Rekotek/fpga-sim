// End-to-end tests on the local bench. e2e/run.sh sets the port and the folder of the built interface.
import { defineConfig } from "@playwright/test";

const port = process.env.FPGASIM_WEB_PORT;
const dist = process.env.FPGASIM_WEB_DIST;
if (!port || !dist || !process.env.FPGASIM_KEY) throw new Error("тесты запускаются через e2e/run.sh (make e2e)");

export default defineConfig({
  testDir: "tests",
  // Results of failed tests: one folder for all runs, not tracked in Git.
  outputDir: "../.fpgasim/e2e-results",
  // The speed test measures the ratio to real time: a neighboring test must not take the cores.
  workers: 1,
  fullyParallel: false,
  forbidOnly: true,
  reporter: "list",
  timeout: 60_000,
  // The tests check the Russian interface: the language follows the browser language (decision 168).
  use: { baseURL: `http://localhost:${port}`, browserName: "chromium", locale: "ru-RU" },
  webServer: {
    command: `npx vite preview --outDir "${dist}"`,
    cwd: "../web",
    url: `http://localhost:${port}`,
    reuseExistingServer: false,
  },
});
