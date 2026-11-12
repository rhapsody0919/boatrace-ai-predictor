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

// src/shared の規則（下の最後の塊、BOA-1485）の文
const SHARED_MSG = (what) =>
  `src/shared はボットと共有する純関数の置き場。${what}を持ち込まない（BOA-1485）`;

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
  {
    // Playwright の fixture の use(...) は React の hook ではない。verify-no-undef.js の
    // rules-of-hooks を src の外で off にする（ignores: ["src/**"]）のと同じ考えで、e2e/ には当てない（BOA-1392）
    files: ["e2e/**/*.{js,mjs,cjs}"],
    rules: { "react-hooks/rules-of-hooks": "off" },
  },
  {
    // src/shared はボット（api/_lib の Node）と画面が共有する純関数の置き場（BOA-1452・HR37）。
    // ボットで届かない分岐の window・import.meta.env・動的 import は verify-bot-page-model の §1 の罠
    // （通った道だけを見る）が見逃すため、書いた時点でここで止める（BOA-1485、#2466 の残りの穴）。
    // no-restricted-globals は typeof window も数える。globalThis・self は window の抜け道なので同じ扱い。
    // import.meta は env 以外も含めて全部禁じる（分割代入 const { env } = import.meta の抜け道を塞ぐため）。
    // 動的 import() は行き先を問わず全部禁じる（supabaseClient の字を変数に入れる抜け道を塞ぐため）。
    files: ["src/shared/**/*.{js,jsx,mjs,cjs}"],
    rules: {
      "no-restricted-globals": [
        "error",
        ...[
          "window",
          "document",
          "localStorage",
          "sessionStorage",
          "navigator",
          "location",
          "history",
          "self",
          "globalThis",
        ].map((name) => ({ name, message: SHARED_MSG("ブラウザ依存") })),
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "MetaProperty[meta.name='import']",
          message: SHARED_MSG("import.meta（env を含む）"),
        },
        {
          selector: "ImportExpression",
          message: SHARED_MSG("動的 import（supabaseClient 等）"),
        },
      ],
      // 字から window を作る抜け道（Function("return window")・eval）も塞ぐ。function の this は静的に見られない
      "no-eval": "error",
      "no-new-func": "error",
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "**/supabaseClient*",
                "@supabase/*",
                "react",
                "react/*",
                "react-dom",
                "react-dom/*",
              ],
              message: SHARED_MSG("supabase・react"),
            },
          ],
        },
      ],
    },
  },
]);
