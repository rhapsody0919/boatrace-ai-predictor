import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  globalIgnores(["dist"]),
  {
    // .mjs / .cjs を含めないと、それらのファイルは no-undef を含む全ルールが無効のまま素通りする
    files: ["**/*.{js,jsx,mjs,cjs}"],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: "latest",
        ecmaFeatures: { jsx: true },
        sourceType: "module",
      },
    },
    rules: {
      "no-unused-vars": ["error", { varsIgnorePattern: "^[A-Z_]" }],
    },
  },
  {
    // Node.js（または Vercel の関数・Edge ランタイム）で動くコード。process 等のグローバルを許可する。
    // ブラウザで動く src/ には付けない（付けると src/ で process を参照しても no-undef が黙る）。
    // e2e/ は page.evaluate の中で document 等も使うため、上のブラウザ用グローバルと併存させる。
    // 未定義参照の検査は scripts/maintenance/verify-no-undef.js がこの区分で行う（ADR-0079）
    files: [
      "scripts/**/*.{js,mjs,cjs}",
      "api/**/*.{js,mjs,cjs}",
      "e2e/**/*.{js,mjs,cjs}",
      "analysis/**/*.{js,mjs,cjs}",
      "middleware.js",
      "*.config.js",
      "*.{mjs,cjs}",
    ],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
]);
