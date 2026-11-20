/**
 * verify-e2e-scope.js の後半の場面。verify ではない。
 * 判定と期待値は分ける前の verify-e2e-scope.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { classifyE2eScope, grandfatherRemovals, GATE_CONFIG_PATH } from "../e2e-scope.js";

let config, check, scopeOf;
let tampered;

const tamperedDiff = [
  "scripts/content/content-pr-gate.json",
  "src/App.jsx",
  "public/blog/a.md",
];

export const CSS_RE = /(?:@import\s+(?:url\(\s*)?|url\(\s*)["']?([^"')\s;]+)/g;

export const UP_RE = /["'`]((?:\.\.\/)+[^"'`\s]*?)(?:\$\{|["'`])/g;

export const LITERAL_RE = /["'`](?:\.\/)?([^"'`\s$]+?)(?:\$\{|["'`])/g;

export const stripComments = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// --- 設定が無い・壊れているときは例外（CLI は full に倒す） ---
export let threw = false;

function scene1() {
  check("空の差分は全部に倒す", scopeOf([]), "full");
  check(
    "一覧の外のパスを理由に出す",
    classifyE2eScope(["public/blog/a.md", "src/b.js"], config).outside,
    ["src/b.js"],
  );
  // --- 免除の一覧から外すだけの設定の変更（オーナー決定 2026-10-26、#1934→#1938） ---
  {
    const list = config.internalLinkGrandfathered;
    const removed = { ...config, internalLinkGrandfathered: list.slice(1) };
    check(
      "一覧から1行を外すだけなら外した行を返す",
      grandfatherRemovals(config, removed),
      [list[0]],
    );
    const others = Object.fromEntries(
      Object.entries(config).filter(([k]) => k !== "internalLinkGrandfathered"),
    );
    const x = "public/blog/x.md";
    for (const [label, next] of [
      ["行を足すと null", { ...config, internalLinkGrandfathered: [...list, x] }],
      [
        "外して足すと null",
        { ...config, internalLinkGrandfathered: [...list.slice(1), x] },
      ],
      [
        "残った行の並べ替えは null",
        { ...config, internalLinkGrandfathered: [...list.slice(2), list[1]] },
      ],
      [
        "他のキーの変更が混ざると null",
        {
          ...removed,
          allowedPathPatterns: [...config.allowedPathPatterns, "^src/"],
        },
      ],
      [
        "キーの順の変更は null",
        {
          internalLinkGrandfathered: removed.internalLinkGrandfathered,
          ...others,
        },
      ],
      ["変更なし（整形だけ）は null", config],
    ])
      check(label, grandfatherRemovals(config, next), null);
    const articlePr = [
      "public/blog/foo.md",
      "src/data/blog-posts/foo.json",
      "docs/content-manifests/foo.json",
      GATE_CONFIG_PATH,
    ];
    check(
      "記事の PR に一覧から外すだけの設定の変更が混ざっても軽い組",
      scopeOf(articlePr, config, { gateConfigRemovalOnly: true }),
      "light",
    );
    check(
      "削除だけと確かめていなければ全部（今までどおり）",
      scopeOf(articlePr),
      "full",
    );
    check(
      "削除だけでも src が混ざれば全部",
      scopeOf([...articlePr, "src/App.jsx"], config, {
        gateConfigRemovalOnly: true,
      }),
      "full",
    );
    check(
      "印は設定のパスにだけ効く（e2e-scope.js 自身は全部）",
      scopeOf([...articlePr, "scripts/maintenance/e2e-scope.js"], config, {
        gateConfigRemovalOnly: true,
      }),
      "full",
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（config・check・scopeOf） */
export function runE2eScopeScenes1(env) {
  ({ config, check, scopeOf } = env);
  scene1();
}

function scene2() {
  // --- 一覧の改ざん ---
  // PR の側で一覧に src を足しても、master の一覧（ここでは今のファイル）で判定すれば全部に戻る
  tampered = {
    ...config,
    allowedPathPatterns: [...config.allowedPathPatterns, "^src/", "^scripts/"],
  };
  check(
    "改ざんした一覧では軽い組に見える（前提の確認）",
    scopeOf(tamperedDiff, tampered),
    "light",
  );
  check("master の一覧で判定すれば全部", scopeOf(tamperedDiff, config), "full");
}

/** verify から呼ぶ入口。env は verify 側の束縛（config・check・scopeOf） */
export function runE2eScopeScenes2(env) {
  ({ config, check, scopeOf } = env);
  scene2();
}

function scene3() {
  // --- docs 以外の0件（CI の分数の削減 段2b、ADR-0100 追記） ---
  for (const files of [
    [".claude/rules/a.md", ".claude/hooks/x.sh"],
    ["sns-video-studio/remotion/src/A.jsx"],
    [
      "scripts/maintenance/verify-foo.js",
      "scripts/maintenance/verify-registry.json",
    ],
    ["scripts/sns/push-x.js", "scripts/analysis/a.mjs", "docs/a.md"],
    // verify を分けた補助（verify-* だけが import する。閉包の検査が下で確かめる）
    [
      "scripts/maintenance/verify-foo.js",
      "scripts/maintenance/verifyData/foo-fixtures.js",
    ],
  ]) {
    check(`${files.join("・")} だけは0件`, scopeOf(files), "none");
  }
  for (const file of [
    "scripts/maintenance/e2e-recording.js",
    "scripts/maintenance/e2e-shards.js",
    "scripts/maintenance/guard-pr-merge.js",
    "scripts/maintenance/verify/x.js",
    // verifyData は直下の .js だけ。下の階層・.js 以外・verify-e2e-scope の補助になりうる名前は全部
    "scripts/maintenance/verifyData/sub/x.js",
    "scripts/maintenance/verifyData/x.json",
    "scripts/maintenance/verifyData/e2e-scope-cases.js",
    "scripts/lib/hitCalculator.js",
    "scripts/daily/scrape-odds.js",
    "scripts/maintenance/verify-e2e-scope.js",
    "api/a.js",
  ]) {
    check(
      `${file} を触る PR は全部（0件の一覧と混ぜても）`,
      scopeOf([".claude/a.md", file]),
      "full",
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（config・check・scopeOf） */
export function runE2eScopeScenes3(env) {
  ({ config, check, scopeOf } = env);
  scene3();
}

/** verify から呼ぶ入口。env は verify 側の束縛（config・check・scopeOf） */
export function runE2eScopeScenes4(env) {
  ({ config, check, scopeOf } = env);

}

function scene4() {
  try {
    classifyE2eScope(["public/blog/a.md"], { allowedPathPatterns: ["^x"] });
  } catch {
    threw = true;
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（config・check・scopeOf） */
export function runE2eScopeScenes5(env) {
  ({ config, check, scopeOf } = env);
  scene4();
}
