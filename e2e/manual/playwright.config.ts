// Manual check of the assistant with the real model (decision 175): not part of make check, it spends money.
// Start the dev stand with the assistant on (docs/deploy-server.md, "Assistant"), then:
//   cd e2e && npx playwright test -c manual/playwright.config.ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  outputDir: "../../.fpgasim/assistant-live",
  workers: 1,
  reporter: "list",
  timeout: 5 * 60_000,
  use: {
    baseURL: process.env.FPGASIM_WEB_URL ?? "http://localhost:5173",
    browserName: "chromium",
    locale: "ru-RU",
  },
});
