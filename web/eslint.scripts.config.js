// ESLint rules for scripts outside web/: tools/**/*.mjs and the end-to-end tests in e2e/ (decision 17).
// Run from the repository root: web/node_modules/.bin/eslint -c web/eslint.scripts.config.js tools e2e
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

const typed = tseslint.configs.strictTypeChecked.map((config) => ({ ...config, files: ["e2e/**/*.ts"] }));

export default tseslint.config(
  { ignores: ["**/node_modules", "**/out", "**/dist"] },
  {
    files: ["tools/**/*.mjs"],
    ...js.configs.recommended,
    // The bench scripts run both in Node and on a page (bench_worker.mjs).
    languageOptions: { globals: { ...globals.node, ...globals.browser, ...globals.worker } },
    // Fields pulled out of an object to get the rest ({ a, ...rest }) count as used.
    rules: { ...js.configs.recommended.rules, "no-unused-vars": ["error", { ignoreRestSiblings: true }] },
  },
  ...typed,
  {
    files: ["e2e/**/*.ts"],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: `${import.meta.dirname}/../e2e` } },
  },
);
