// verify-no-undef.js の自己テストの場面（越えの単位を分けるため移した。verify ではない）。
// eslint・findingsIn 等は verify から受け取る
import path from "node:path";
import { compareWithAllowlist } from "./no-undef-allowlist.js";

// 全角空白（U+3000）。このファイル自体が no-irregular-whitespace に当たらないよう、文字で書かない
export const IDEOGRAPHIC_SPACE = String.fromCodePoint(0x3000);
export const HOOK_IN_CONDITION =
  'import { useState } from "react";\nexport function Selftest({ a }) {\n  if (a) {\n    useState(0);\n  }\n  return null;\n}\n';
export const EMPTY_CATCH =
  "export function a() {\n  try {\n    JSON.parse('1');\n  } catch (e) {}\n}\n";

/** 自己テストの前半（走査の対象・no-undef・設定コメント） */
function undefCases({
  eslint,
  ROOT,
  findingsIn,
  gitShow,
  BROKEN_REV,
  BROKEN_FILE,
}) {
  const found = (code, file) => async () =>
    (await findingsIn(code, file)).found;
  const both = (code, file) => () => findingsIn(code, file);
  return [
    {
      rule: null,
      name: "変異検査の一時ファイル（*.__mutant-*.js）だけを走査から外し、本物の scripts のファイルは外さない（BOA-1583）",
      run: async () => [
        await eslint.isPathIgnored(
          path.join(ROOT, "scripts/maintenance/verify-x.__mutant-1-1.js"),
        ),
        await eslint.isPathIgnored(
          path.join(ROOT, "scripts/maintenance/verify-x.js"),
        ),
        await eslint.isPathIgnored(path.join(ROOT, "src/mutant-notes.js")),
      ],
      want: [true, false, false],
    },
    {
      rule: "no-undef",
      name: "#1020 直前の master の supabaseDataService.js → groupIntoCurrentMeet を検出する",
      run: async () =>
        (
          await findingsIn(gitShow(`${BROKEN_REV}:${BROKEN_FILE}`), BROKEN_FILE)
        ).found.filter((x) => x.startsWith("no-undef:")),
      want: ["no-undef:groupIntoCurrentMeet"],
    },
    {
      rule: "no-undef",
      name: "src/ はブラウザ用 → process を検出する（Node のグローバルを付けていない）",
      run: found("export const a = process.env.X;\n", "src/undef-selftest.js"),
      want: ["no-undef:process"],
    },
    {
      rule: "no-undef",
      name: "src/ の window・document は通す",
      run: found(
        "export const a = window.innerWidth + document.title;\n",
        "src/undef-selftest.js",
      ),
      want: [],
    },
    {
      rule: "no-undef",
      name: "e2e/ は Node と page.evaluate 内のブラウザの両方 → process・Buffer・document を通す",
      run: found(
        "export const a = [process.env.X, Buffer.from('x'), () => document.title];\n",
        "e2e/undef-selftest.spec.js",
      ),
      want: [],
    },
    {
      rule: "no-undef",
      name: "scripts/ の .mjs も検査対象 → 未定義を検出し、process は通す",
      run: found(
        "console.log(process.argv, notDefinedAnywhere);\n",
        "scripts/undef-selftest.mjs",
      ),
      want: ["no-undef:notDefinedAnywhere"],
    },
    {
      rule: "no-undef",
      name: "api/ は Node → process を通し、未定義は検出する",
      run: found(
        "export default () => [process.env.X, missingHelper()];\n",
        "api/undef-selftest.js",
      ),
      want: ["no-undef:missingHelper"],
    },
    {
      rule: "no-undef",
      name: "/* global */ と /* eslint-disable */ は効かず、設定コメントとして検出する",
      run: both(
        "/* eslint-disable */\n/* global someGlobal */\nexport const a = someGlobal;\n",
        "src/lint-gate-selftest.js",
      ),
      want: { found: ["no-undef:someGlobal"], directives: 2 },
    },
  ];
}

/** 自己テストの後半（設定コメント・no-empty・no-irregular-whitespace・rules-of-hooks） */
function gateCases({ findingsIn }) {
  const found = (code, file) => async () =>
    (await findingsIn(code, file)).found;
  const both = (code, file) => () => findingsIn(code, file);
  return [
    {
      rule: "no-undef",
      name: "説明の区切りが --- でも、検査中の規則を名指す disable を検出する",
      run: both(
        "// eslint-disable-next-line no-undef --- 理由\nexport const a = otherGlobal;\n",
        "src/lint-gate-selftest.js",
      ),
      want: { found: ["no-undef:otherGlobal"], directives: 1 },
    },
    {
      rule: null,
      name: "検査中でない規則（exhaustive-deps）の disable と規則の設定は通す",
      run: both(
        "// eslint-disable-next-line react-hooks/exhaustive-deps -- 理由\n/* eslint react-hooks/exhaustive-deps: off */\nexport const a = 1;\n",
        "src/lint-gate-selftest.js",
      ),
      want: { found: [], directives: 0 },
    },
    {
      rule: "no-undef",
      name: "検査中の規則の設定（/* eslint no-undef: off */）は検出する",
      run: both(
        "/* eslint no-undef: off */\nexport const a = 1;\n",
        "src/lint-gate-selftest.js",
      ),
      want: { found: [], directives: 1 },
    },
    {
      rule: "no-empty",
      name: "no-empty: 空の catch を検出する",
      run: found(EMPTY_CATCH, "src/lint-gate-selftest.js"),
      want: ["no-empty"],
    },
    {
      rule: "no-empty",
      name: "no-empty: eslint-disable-next-line no-empty は効かず、違反と設定コメントの両方を検出する",
      run: both(
        "export function a() {\n  try {\n    JSON.parse('1');\n    // eslint-disable-next-line no-empty\n  } catch (e) {}\n}\n",
        "src/lint-gate-selftest.js",
      ),
      want: { found: ["no-empty"], directives: 1 },
    },
    {
      rule: "no-irregular-whitespace",
      name: "no-irregular-whitespace: コメント中の全角空白を検出する",
      run: found(
        `// a${IDEOGRAPHIC_SPACE}b\nexport const a = 1;\n`,
        "scripts/lint-gate-selftest.js",
      ),
      want: ["no-irregular-whitespace"],
    },
    {
      rule: "react-hooks/rules-of-hooks",
      name: "rules-of-hooks: src/ の条件の中の useState を検出する",
      run: found(HOOK_IN_CONDITION, "src/lint-gate-selftest.jsx"),
      want: ["react-hooks/rules-of-hooks"],
    },
    {
      rule: "react-hooks/rules-of-hooks",
      name: "rules-of-hooks: e2e/ は対象外（Playwright の use(...) の誤検出を避ける）",
      run: found(HOOK_IN_CONDITION, "e2e/lint-gate-selftest.spec.js"),
      want: [],
    },
  ];
}

/** 自己テスト。rule は対象の規則（null は常に実行）。検査中の規則のものだけを実行する */
export function unitCases(deps) {
  return [...undefCases(deps), ...gateCases(deps)];
}

/** 突き合わせの純粋な自己テスト（許可リストが空でも added・stale の判定を確かめる） */
export function compareCases(RULES) {
  const v = (rule, file, name = null) => ({
    rule,
    file,
    name,
    line: 1,
    column: 1,
    message: "m",
  });
  const summarize = (r) => [
    r.added.map((a) => `${a.rule} ${a.file}`),
    r.stale.map((s) => `${s.rule} ${s.file}`),
  ];
  const undefAllow = {
    "no-undef": {
      "a.js": { names: ["x"], reason: "r" },
      "b.js": { names: ["y"], reason: "r" },
    },
  };
  const emptyAllow = { "no-empty": { "c.js": { count: 2, reason: "r" } } };
  return [
    {
      rule: "no-undef",
      name: "突き合わせ: 載っている名前は通し、出なくなった名前は stale、同じファイルの別の名前は added",
      run: () =>
        summarize(
          compareWithAllowlist(
            [v("no-undef", "a.js", "x"), v("no-undef", "a.js", "z")],
            undefAllow,
            RULES,
          ),
        ),
      want: [["no-undef a.js"], ["no-undef b.js"]],
    },
    {
      rule: "no-empty",
      name: "突き合わせ: 件数の許可は、超えたら added、満たなければ stale",
      run: () => [
        summarize(
          compareWithAllowlist(
            [1, 2, 3].map(() => v("no-empty", "c.js")),
            emptyAllow,
            RULES,
          ),
        ),
        summarize(
          compareWithAllowlist([v("no-empty", "c.js")], emptyAllow, RULES),
        ),
      ],
      want: [
        [["no-empty c.js"], []],
        [[], ["no-empty c.js"]],
      ],
    },
  ];
}
