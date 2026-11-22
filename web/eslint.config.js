// ESLint rules for the interface. Type-aware checks: errors such as a forgotten await are caught here.
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "node_modules"] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  { files: ["**/*.js"], ...tseslint.configs.disableTypeChecked },
  {
    // UI strings live only in the dictionary src/i18n/ru.json (spec section 9.1): Cyrillic
    // in strings and in component markup is an error. Comments do not trigger the rule.
    files: ["src/**/*.ts", "src/**/*.tsx"],
    ignores: ["src/**/*.test.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        { selector: "Literal[value=/[А-Яа-яЁё]/]", message: "Строка интерфейса мимо словаря: используйте t(key)." },
        {
          selector: "TemplateElement[value.raw=/[А-Яа-яЁё]/]",
          message: "Строка интерфейса мимо словаря: используйте t(key).",
        },
        { selector: "JSXText[value=/[А-Яа-яЁё]/]", message: "Строка интерфейса мимо словаря: используйте t(key)." },
      ],
    },
  },
);
