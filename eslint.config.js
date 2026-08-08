import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist",
      ".tmp-fn-deploy",
      "android/**/build/**",
      "coverage",
      "playwright-report",
      "test-results",
    ],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      // Existing code intentionally uses broad provider/database payloads and
      // @ts-nocheck in legacy modules. Keep this debt visible without allowing
      // it to mask actionable control-flow and Hooks correctness failures.
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/ban-ts-comment": "warn",
      "@typescript-eslint/no-unused-vars": "off",
      "no-empty": "warn",
    },
  },
  {
    files: ["e2e/fixtures/**/*.{ts,tsx}"],
    rules: {
      // Playwright fixture callbacks conventionally name their lifecycle
      // continuation `use`; neither it nor an empty dependency object is React.
      "react-hooks/rules-of-hooks": "off",
      "no-empty-pattern": "off",
    },
  },
);
