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

// 字（Literal・テンプレートの字・JSX の字）に re が当たる選択子。注釈は AST に無いので数えない
const textHits = (re, message) => [
  { selector: `Literal[value=${re}]`, message },
  { selector: `TemplateElement[value.raw=${re}]`, message },
  { selector: `JSXText[value=${re}]`, message },
];

// no-restricted-syntax の見張り（BOA-1486、ZB03。.claude/rules の code-pitfalls.md・frontend-data-fetch.md・
// component-reuse.md の決まりのうち JS の本文を見る物。hq drafts/zb03-issues/1.md・2.md 末尾）。
// key は下の範囲の表（SCOPES）と既にある違反の表（EXISTING）が指す名前
const RESTRICTED = {
  serviceKey: [
    { selector: "Identifier[name='SUPABASE_SERVICE_ROLE_KEY']" },
    ...textHits("/SUPABASE_SERVICE_ROLE_KEY/"),
  ].map((x) => ({
    selector: x.selector,
    message:
      "環境変数名は SUPABASE_SERVICE_KEY（SUPABASE_SERVICE_ROLE_KEY は接続の失敗でなく undefined で静かに失敗する）",
  })),
  predictionsCreatedAt: [
    // .from("predictions") を中に持つ呼び出し（select・order・gte 等の鎖）の直の引数の字
    "Literal[value=/created_at/]",
    "TemplateLiteral > TemplateElement[value.raw=/created_at/]",
  ].map((leaf) => ({
    selector: `CallExpression:has(CallExpression[callee.property.name='from'][arguments.0.value='predictions']) > ${leaf}`,
    message:
      "predictions に created_at 列は無い。predicted_at を使う（無い列のフィルタはエラーにならず無視されうる）",
  })),
  onTouch: [
    {
      selector: "JSXAttribute[name.name=/^onTouch(Start|End|Move)$/]",
      message:
        "onTouchStart・onTouchEnd・onTouchMove の独自実装をしない（iOS のタッチの問題）。onClick だけで書く",
    },
  ],
  swallowCatch: (() => {
    // 握りつぶしの値: null・[]・set<名>([])
    const values = [
      "Literal[raw='null']",
      "ArrayExpression[elements.length=0]",
      "CallExpression[callee.name=/^set[A-Z]/][arguments.length=1][arguments.0.type='ArrayExpression'][arguments.0.elements.length=0]",
    ];
    const cb = "CallExpression[callee.property.name='catch'] >";
    return values
      .flatMap((v) => [
        // () => null（async も同じ）
        `${cb} ArrowFunctionExpression > ${v}`,
        // () => { return null }・function () { return [] }・() => { setRows([]) }（1文だけの本体）
        `${cb} :matches(ArrowFunctionExpression, FunctionExpression) > BlockStatement[body.length=1] > :matches(ReturnStatement, ExpressionStatement) > ${v}`,
      ])
      .map((selector) => ({
        selector,
        message:
          "取得の失敗を .catch で null・[] にしない（「データなし」と同じ表示になる）。失敗を state（failed 等）に残す",
      }));
  })(),
  // component-reuse.md: 件数で変わるグリッドに repeat(auto-fill, …)・repeat(N, …) を使わない（auto-fit は許す）
  cssRepeat: textHits(
    "/repeat\\(\\s*(auto-fill|\\d)/",
    "件数で変わるグリッドに repeat(auto-fill, …)・repeat(N, …) を使わない。auto-fit か DigestCardGrid.css の calc() 方式",
  ),
  bannedWords: textHits(
    "/数える|似た|ふつう|いつも|必ず当たる|的中保証|鉄板/",
    "禁止語（数える・似た・似ている・ふつう・いつも・似たレース・必ず当たる・的中保証・鉄板）を字に書かない（似たレースは類似レース）",
  ),
  sonarWords: textHits(
    "/集計|算出|対象/",
    "龍神ソナー・思考アシストの置き場では 集計・算出・対象 も使わない（数えるの言い換えに使わない）",
  ),
  shared: [
    {
      selector: "MetaProperty[meta.name='import']",
      message: SHARED_MSG("import.meta（env を含む）"),
    },
    {
      selector: "ImportExpression",
      message: SHARED_MSG("動的 import（supabaseClient 等）"),
    },
  ],
};

const JS = "{js,jsx,mjs,cjs}";
const SRC = [
  "serviceKey",
  "predictionsCreatedAt",
  "onTouch",
  "swallowCatch",
  "cssRepeat",
  "bannedWords",
];
// 範囲ごとに当てる見張り（places は "/" で終わればディレクトリ、それ以外はファイル）。
// flat config では同じ規則は後の塊が前の塊の設定を丸ごと上書きするので、狭い範囲は広い範囲の
// 見張りを含めた和で書く（並びは広い→狭い。ソナーの置き場と src/shared は重ならない）
const SCOPES = [
  {
    places: ["src/", "api/", "scripts/"],
    keys: ["serviceKey", "predictionsCreatedAt"],
  },
  { places: ["src/"], keys: SRC },
  {
    places: [
      "src/components/race/analogy/",
      "src/components/race/assist/",
      "src/data/thinkingAssistCopy.js",
      "src/pages/ThinkingAssistPage.jsx",
    ],
    keys: [...SRC, "sonarWords"],
  },
  { places: ["src/shared/"], keys: [...SRC, "shared"] },
];
// 入れた時点で既にある違反（直さずに凍結。ファイルと見張りの組で外す。直したら行を消す）。BOA-1486
const EXISTING = [
  {
    file: "scripts/maintenance/verify-pr-lane.js", // 試験の入力の字（1114行）
    except: ["serviceKey"],
  },
  { file: "src/components/RacerSearchBox.jsx", except: ["onTouch"] }, // 202行
  { file: "src/data/morningDigestCopy.js", except: ["bannedWords"] }, // 鉄板 4行（検索語に合わせた字、別の票）
];

const inPlace = (file, place) =>
  place.endsWith("/") ? file.startsWith(place) : file === place;
const placeGlob = (place) =>
  place.endsWith("/") ? `${place}**/*.${JS}` : place;
const keysFor = (file) =>
  SCOPES.filter((s) => s.places.some((p) => inPlace(file, p))).at(-1)?.keys ??
  [];

function restrictedSyntaxConfigs() {
  const rule = (keys) => ["error", ...keys.flatMap((k) => RESTRICTED[k])];
  const scoped = SCOPES.map(({ places, keys }) => ({
    files: places.map(placeGlob),
    rules: { "no-restricted-syntax": rule(keys) },
  }));
  const existing = EXISTING.map(({ file, except }) => ({
    files: [file],
    rules: {
      "no-restricted-syntax": rule(
        keysFor(file).filter((k) => !except.includes(k)),
      ),
    },
  }));
  const shared = {
    // src/shared はボット（api/_lib の Node）と画面が共有する純関数の置き場（BOA-1452・HR37）。
    // ボットで届かない分岐の window・import.meta.env・動的 import は verify-bot-page-model の §1 の罠
    // （通った道だけを見る）が見逃すため、書いた時点でここで止める（BOA-1485、#2466 の残りの穴）。
    // no-restricted-globals は typeof window も数える。globalThis・self は window の抜け道なので同じ扱い。
    // import.meta は env 以外も含めて全部禁じる（分割代入 const { env } = import.meta の抜け道を塞ぐため）。
    // 動的 import() は行き先を問わず全部禁じる（supabaseClient の字を変数に入れる抜け道を塞ぐため）。
    files: [`src/shared/**/*.${JS}`],
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
  };
  return [...scoped, ...existing, shared];
}

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
    // src は未使用の名前の例外を ^_ だけに狭める（BOA-1046。上の ^[A-Z_] は import React・使っていない定数を隠していた。
    // src の隠れていた未使用は BOA-1054〜1059 で消した）。scripts・sns-video-studio は今も大文字の未使用が残るので上のまま
    files: ["src/**/*.{js,jsx,mjs,cjs}"],
    rules: {
      "no-unused-vars": [
        "error",
        { varsIgnorePattern: "^_", ignoreRestSiblings: true },
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
  ...restrictedSyntaxConfigs(),
]);
