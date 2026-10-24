import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import { defineConfig, globalIgnores } from "eslint/config";

// JSX の要素名で使った変数を「使った」と印す（eslint-plugin-react の jsx-uses-vars と同じ働き）。
// ESLint 9 は JSX の要素名を変数の参照として数えないため、<motion.div> でだけ使う motion が
// no-unused-vars に「使っていない」と誤って出る。依存を足さずに直すため、ここで同じことをする。
// 小文字1語の名前（<div> 等）は HTML の要素で変数ではないので印さない。
// 何も報告しないルールなので、ruleFilter・--rule で no-unused-vars だけを動かすときは、これも一緒に残す
// （外すと motion の誤検知が戻る）
const jsxUsesVars = {
  rules: {
    "jsx-uses-vars": {
      meta: { type: "problem", schema: [] },
      create(context) {
        return {
          JSXOpeningElement(node) {
            let name = node.name;
            if (name.type === "JSXNamespacedName") return;
            if (name.type === "JSXIdentifier" && /^[a-z]/.test(name.name))
              return;
            while (name.type === "JSXMemberExpression") name = name.object;
            if (name.type === "JSXIdentifier") {
              context.sourceCode.markVariableAsUsed(name.name, node);
            }
          },
        };
      },
    },
  },
};

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
    plugins: { local: jsxUsesVars },
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
      "local/jsx-uses-vars": "error",
      // ignoreRestSiblings: ({ node, ...props }) のように、残りから外すための分割代入を使っていないと数えない
      "no-unused-vars": [
        "error",
        { varsIgnorePattern: "^[A-Z_]", ignoreRestSiblings: true },
      ],
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
