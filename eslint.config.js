import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import prettier from "eslint-plugin-prettier/recommended";
import tailwindcss from "eslint-plugin-tailwindcss";

export default defineConfig([
  globalIgnores(["dist", "src-tauri/target", "src-tauri/gen"]),
  {
    files: ["**/*.{ts,tsx}"],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat["recommended-latest"],
      reactRefresh.configs.vite,
      prettier,
    ],
    plugins: { tailwindcss },
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    settings: {
      tailwindcss: {
        // Tailwind v4 keeps the theme in CSS. The `@theme` tokens, the
        // `cockpit` breakpoint and the type scale live here.
        cssConfigPath: "./src/index.css",
        // Overrides the plugin defaults, so they are listed back plus `cx`,
        // our own helper.
        functions: [
          "classnames",
          "classNames",
          "clsx",
          "cn",
          "ctl",
          "cva",
          "tv",
          "tw",
          "twMerge",
          "twJoin",
          "cx",
        ],
      },
    },
    rules: {
      "tailwindcss/classnames-order": "warn",
      "tailwindcss/enforces-canonical-classname": "warn",
      "tailwindcss/enforces-negative-arbitrary-values": "warn",
      "tailwindcss/enforces-shorthand": "warn",
      "tailwindcss/no-contradicting-classname": "error",
      "tailwindcss/no-unnecessary-arbitrary-value": "warn",
    },
  },
  {
    files: ["*.config.{ts,js}"],
    languageOptions: {
      globals: globals.node,
    },
  },
]);
