// End-to-end tests against the production URLs (make e2e-prod, spec section 11.3). The key is in the variable
// FPGASIM_KEY; the addresses are FPGASIM_WEB_URL and FPGASIM_BUILD_URL (or FPGASIM_SERVER) from the site settings.
import { defineConfig } from "@playwright/test";

if (!process.env.FPGASIM_KEY) throw new Error("нужен ключ сервера сборки в переменной FPGASIM_KEY");
if (!process.env.FPGASIM_WEB_URL || !(process.env.FPGASIM_SERVER ?? process.env.FPGASIM_BUILD_URL))
  throw new Error("нужны адреса сайта FPGASIM_WEB_URL и FPGASIM_BUILD_URL: настройки сайта, deploy/site.env.example");

export default defineConfig({
  testDir: "prod",
  outputDir: "../.fpgasim/e2e-prod-results",
  // The lesson speed measurement runs in the same run: a neighboring test must not take the cores.
  workers: 1,
  fullyParallel: false,
  forbidOnly: true,
  reporter: "list",
  timeout: 120_000,
  use: {
    // The site addresses come from the site settings through make e2e-prod (decision 173).
    baseURL: process.env.FPGASIM_WEB_URL,
    browserName: "chromium",
    // The tests check the Russian interface: the language follows the browser language (decision 168).
    locale: "ru-RU",
  },
});
