/**
 * 軽い道／重い道の判定（pr-lane.js、config/pr-path-rules.json）を固定する。外部接続なし（tier=ci）。
 * 設計: docs/proposal/dev-process-redesign-2026-11-05.md 1.2・1.5（#2277）。
 *
 * - 1.5 の振り分けの表の代表（PR の差分のパスと状態をそのまま入力にする）が、期待どおりの lane と規則になる
 * - src/utils の変更が SNS の自動送信（H2）と api（H6）に import でたどれる（#2236 → #2251 の壊れ）
 * - scripts/** は H1（新しい verify-*.js だけ除く）、src/locales/ja は H8、判定の script と規則の変更は H5
 * - 既存の src の .css の変更・削除は H7（#2144・#2157 の形）。新しい .css は全体のセレクタを足したときだけ H7
 * - CLI: 一時の git の木で base...head の差分（merge-base から）を判定し、JSON を出して終了 0。判定できなければ 0 以外で heavy
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fsIo } from "../lib/relativeImportGraph.js";
import {
  TREE_ROOT,
  classify,
  classifyCommits,
  globalSelectors,
  headerPath,
  loadMoveOnly,
  moveOnlyPaths,
  parsePatch,
} from "./pr-lane.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

// 手元の木（git ls-files の一覧と手元のファイル）を、コミットの木と同じ形で渡す
const files = execFileSync("git", ["ls-files", "-z"], {
  cwd: ROOT,
  encoding: "utf8",
})
  .split("\0")
  .filter(Boolean);
const toLocal = (p) => join(ROOT, p.slice(TREE_ROOT.length + 1));
const tree = {
  files,
  io: {
    isFile: (p) => fsIo.isFile(toLocal(p)),
    read: (p) => fsIo.read(toLocal(p)),
  },
};

// patches に無いファイルは行の変化なし（空）として渡す。読めない場合の安全側は fill: false で別に試す。
// 軽い道の例は import の閉包を手元の木で辿らない（関係ない import の追加でこの試験が落ちないように。
// 木で辿って軽い道になることは、下の CLI の一時の git の木で試す）
const run = (
  changes,
  patches = new Map(),
  { trees = [tree], fill = true } = {},
) => {
  const list = changes.map((c) => {
    const [status, path] = c.split(" ");
    return { status, path };
  });
  const all = new Map(
    fill ? list.map((c) => [c.path, { added: [], removed: [] }]) : [],
  );
  for (const [k, v] of patches ?? new Map()) all.set(k, v);
  return classify({ changes: list, patches: all, trees });
};
const rulesOf = (r) => [...new Set(r.hits.map((h) => h.rule))].sort();
const expect = (name, changes, lane, rules = [], patches, opts) => {
  const r = run(
    changes,
    patches,
    opts ?? (lane === "light" ? { trees: [] } : undefined),
  );
  assert.equal(
    r.lane,
    lane,
    `${name}: lane ${r.lane}（${JSON.stringify(r.hits)}）`,
  );
  for (const rule of rules)
    assert.ok(
      rulesOf(r).includes(rule),
      `${name}: ${rule} に当たらない（${rulesOf(r)}）`,
    );
  if (lane === "light") assert.deepEqual(r.hits, [], name);
  return r;
};
const patch = (path, added, removed = []) =>
  new Map([[path, { added, removed }]]);

// ---- 軽い道（1.5 の表で軽い） ----
expect(
  "#2267 docs だけ",
  ["A docs/proposal/refactoring-inventory-2026-11-05.md"],
  "light",
);
expect("#2257 用語集", ["M docs/reference/i18n-glossary.md"], "light");
expect(
  "#2252 data/analysis の新規",
  ["A data/analysis/ai-crawler/2026-10-30.json"],
  "light",
);
expect(
  "#2209 ESLint（既存の部品の直し）",
  [
    "M src/components/HitRaces.jsx",
    "M src/components/Toast.jsx",
    "M src/components/VenueMap.jsx",
  ],
  "light",
);
expect(
  "#2261 ページの OGP・title と新しい e2e",
  ["A e2e/venue-grid-social-meta.spec.js", "M src/pages/VenueGridPage.jsx"],
  "light",
);
expect(
  "#2157 から CSS を除いた形（既存の部品の jsx の直しと新しい e2e）",
  [
    "A e2e/today-featured-racer-link.spec.js",
    "M src/components/digest/FeaturedRaceCard.jsx",
  ],
  "light",
);
expect(
  "新しい部品の CSS（クラスの中だけ）",
  ["A src/components/digest/NewCard.css"],
  "light",
  [],
  patch("src/components/digest/NewCard.css", [
    ".new-card {",
    "  color: inherit;",
    "}",
    ".new-card a:hover,",
    "a.new-card__link {",
    "  text-decoration: underline;",
    "}",
    "@media (max-width: 480px) {",
    "  .new-card { padding: 0; }",
    "}",
    "@keyframes new-card-in {",
    "  from { opacity: 0; }",
    "  50%, to { opacity: 1; }",
    "}",
  ]),
);
// #1877（新しい verify と台帳の行の追加だけ）は軽い道のまま。後の #1879 は #1877 の verify が
// KNOWN_GAPS に記録していた前からの不具合（formatters.js の TZ）を直したもので、#1877 が壊したものではない（master の CI は緑）
expect(
  "#1877 新しい verify と台帳の行の追加",
  [
    "A scripts/maintenance/verify-formatters.js",
    "M scripts/maintenance/verify-registry.json",
  ],
  "light",
  [],
  patch("scripts/maintenance/verify-registry.json", [
    "    {",
    '      "script": "verify-formatters.js",',
    "    },",
  ]),
);
expect(
  "訳のキーの追加（ja 以外）",
  ["M src/locales/en/common.json", "M src/locales/ko/common.json"],
  "light",
  [],
  new Map([
    [
      "src/locales/en/common.json",
      { added: ['"x": "Win rate by course"'], removed: [] },
    ],
    [
      "src/locales/ko/common.json",
      { added: ['"x": "코스별 1착률"'], removed: [] },
    ],
  ]),
);
expect(
  "新しい verify-*.js と台帳の行の追加だけ",
  [
    "A scripts/maintenance/verify-new-thing.js",
    "M scripts/maintenance/verify-registry.json",
  ],
  "light",
  [],
  patch("scripts/maintenance/verify-registry.json", [
    "    {",
    '      "script": "verify-new-thing.js",',
    "    },",
  ]),
);
expect(
  "台帳の末尾に足す（前の行の } が }, になるだけ）",
  [
    "A scripts/maintenance/verify-zz-new.js",
    "M scripts/maintenance/verify-registry.json",
  ],
  "light",
  [],
  patch(
    "scripts/maintenance/verify-registry.json",
    ["    },", "    {", '      "script": "verify-zz-new.js"', "    }"],
    ["    }"],
  ),
);

// ---- 重い道 ----
expect(
  "行を読めないファイルは H9 を安全側で当てる",
  ["M src/components/HitRaces.jsx"],
  "heavy",
  ["H9"],
  new Map(),
  { trees: [], fill: false },
);
// src/utils の変更が SNS の自動送信と api に届く（#2236 の元、#2251 で直した）
{
  const r = expect(
    "#2251 src/utils",
    ["M src/utils/raceSeriesText.js"],
    "heavy",
    ["H2"],
  );
  assert.match(
    r.hits.find((h) => h.rule === "H2").reason,
    /sns-video-studio\/remotion\/.+ → src\/utils\/raceSeriesText\.js/,
    "H2 の理由に SNS の入口からの経路",
  );
  expect(
    "#2251 src/utils（api にも届く）",
    ["M src/utils/raceDetailHeading.js"],
    "heavy",
    ["H2", "H6"],
  );
  // 消したファイルも元の木で辿る
  expect("src/utils の削除", ["D src/utils/raceSeriesText.js"], "heavy", [
    "H2",
  ]);
}
expect("#2270 languages.js", ["M src/config/languages.js"], "heavy", [
  "H2",
  "H6",
  "H7",
]);
expect(
  "#2249 scripts/** は H1",
  ["M scripts/maintenance/run-verify-registry.js"],
  "heavy",
  ["H1"],
);
expect(
  "scripts/lib の変更も H1",
  ["M scripts/lib/upsertChangedRows.js"],
  "heavy",
  ["H1"],
);
expect(
  "scripts/** の削除も H1",
  ["D scripts/maintenance/some-old-job.js"],
  "heavy",
  ["H1"],
);
expect(
  "#2205 マイグレーション",
  ["A docs/db-migration/999_example.sql"],
  "heavy",
  ["H1"],
);
expect(
  "#2266 src/pure・src/services",
  ["M src/pure/raceMotorBreakdown.js", "M src/services/supabaseDataService.js"],
  "heavy",
  ["H3"],
);
expect(
  "#2243 scripts/analysis",
  ["A scripts/analysis/analyze-new.js"],
  "heavy",
  ["H1", "H3"],
);
expect("新しいページ", ["A src/pages/NewPage.jsx"], "heavy", ["H4"]);
expect(
  "#2232 新しい部品",
  ["A src/components/race/SixBoatCourseTable.jsx"],
  "heavy",
  ["H4"],
);
expect("ルートの定義", ["M src/AppRouter.jsx"], "heavy", ["H4", "H7"]);
expect(
  "#2235 既存の e2e の期待値",
  [
    "M e2e/race-detail-meet-form-trend.spec.js",
    "M src/components/race/RaceBeforeInfoTab.jsx",
  ],
  "heavy",
  ["H5"],
);
// e2e/ の下の spec 以外（global-setup・har-merge・録画のポインタ・shards・*-fixture・support/ 等）の変更も、試験を弱めうるので H5（2026-11-07 ハーネスの照合 P4）
expect(
  "e2e の補助ファイルの変更",
  [
    "M e2e/global-setup.js",
    "M e2e/har-merge.js",
    "M e2e/viewport-skip.js",
    "M e2e/recording.json",
    "M e2e/shards.json",
    "M e2e/analogy-v16-fixture.js",
    "D e2e/support/sns-x-send-server.js",
  ],
  "heavy",
  ["H5"],
);
expect(
  "新しい e2e の補助ファイルと新しい spec（追加は当てない）",
  ["A e2e/new-thing-fixture.js", "A e2e/new-thing.spec.js"],
  "light",
);
expect(
  "#2237 既存の verify の変更",
  ["M scripts/maintenance/verify-ai-copy-text.js"],
  "heavy",
  ["H1", "H5"],
);
expect(
  "台帳の既存の行の変更",
  ["M scripts/maintenance/verify-registry.json"],
  "heavy",
  ["H5"],
  patch(
    "scripts/maintenance/verify-registry.json",
    ['      "tier": "manual",'],
    ['      "tier": "ci",'],
  ),
);
expect("#2240 workflow", ["M .github/workflows/e2e.yml"], "heavy", ["H5"]);
expect(
  "#2216 remotion の package.json",
  ["M sns-video-studio/remotion/package.json"],
  "heavy",
  ["H2", "H5"],
);
expect("root の lock", ["M package-lock.json"], "heavy", ["H5"]);
expect("判定の script 自身", ["M scripts/maintenance/pr-lane.js"], "heavy", [
  "H1",
  "H5",
]);
expect("判定の規則", ["M config/pr-path-rules.json"], "heavy", ["H5", "H8"]);
expect("import の辿り方", ["M scripts/lib/relativeImportGraph.js"], "heavy", [
  "H1",
  "H5",
]);
expect("#2156 api/_lib", ["M api/_lib/botRace.js"], "heavy", ["H6"]);
expect("#2250 送る口", ["M api/cron/sns-send.js"], "heavy", ["H2", "H6"]);
expect("middleware", ["M middleware.js"], "heavy", ["H5"]);
expect("#2153 全体の CSS", ["M src/App.css"], "heavy", ["H7"]);
// 既存の src の .css の変更は H7（Vite の SPA では CSS は全部全体に効き、既存の画面への効き方を差分から決められない）
expect(
  "#2144 既存の部品の CSS の変更（手の分類で H7）",
  [
    "A e2e/racers-page-links.spec.js",
    "M src/components/racer/RacerListPagination.css",
    "M src/components/racer/RacerListPagination.jsx",
    "M src/pages/RacersPage.jsx",
  ],
  "heavy",
  ["H7"],
);
expect(
  "#2157 既存の部品の CSS に規則を足す",
  [
    "A e2e/today-featured-racer-link.spec.js",
    "M src/components/digest/FeaturedRaceCard.css",
    "M src/components/digest/FeaturedRaceCard.jsx",
  ],
  "heavy",
  ["H7"],
  patch("src/components/digest/FeaturedRaceCard.css", [
    ".featured-race__racer-name a {",
    "  color: inherit;",
    "}",
  ]),
);
expect(
  "既存のページの CSS の削除も H7",
  ["D src/pages/BlogPost.css"],
  "heavy",
  ["H7"],
);
expect(
  "新しい CSS でも全体のセレクタを足せば H7",
  ["A src/components/race/NewTable.css"],
  "heavy",
  ["H7"],
  patch("src/components/race/NewTable.css", [
    ".new-table { color: red; }",
    "body:has(.new-table) {",
    "  overflow: hidden;",
    "}",
  ]),
);
expect(
  "新しい CSS の行を読めないときは H7 を安全側で当てる",
  ["A src/components/race/NewTable.css"],
  "heavy",
  ["H7"],
  new Map(),
  { trees: [], fill: false },
);
{
  const r = run(
    ["A src/components/race/NewTable.css"],
    patch("src/components/race/NewTable.css", [
      "h2,",
      ".x h3 {",
      "}",
      ":root { --a: 1; }",
    ]),
    { trees: [] },
  );
  assert.match(
    r.hits.find((h) => h.rule === "H7").reason,
    /全体に効くセレクタ: h2・:root$/,
    "全体のセレクタを理由に並べる（クラスで絞った .x h3 は数えない）",
  );
}
// 全体のセレクタの拾い方（#2285 の /code-review の指摘を固定）
{
  const g = (css) => globalSelectors(css.split("\n"));
  assert.deepEqual(g("* { margin: 0; }\nul li > a { x: 1 }"), [
    "*",
    "ul li > a",
  ]);
  assert.deepEqual(g("/* body { */ .c { x: 1 }"), [], "コメントの中は見ない");
  assert.deepEqual(
    g("a:not(.x, .y) { color: red }\n.y:not(a) { x: 1 }"),
    ["a:not(.x, .y)"],
    "括弧の中のカンマで割らない・括弧の中のクラスは絞りに数えない",
  );
  assert.deepEqual(
    g(
      '[data-theme="dark"] h1 { x: 1 }\n#root a { x: 1 }\n.x[aria-disabled] { x: 1 }',
    ),
    ['[data-theme=""] h1', "#root a"],
    "属性・ID から始まっても、クラスで絞らなければ全体",
  );
  assert.deepEqual(g("BODY.modal-open { x: 1 }"), ["BODY.modal-open"]);
  assert.deepEqual(
    g(".c::before { content: \"{\"; }\n.d::after { content: '}'; }"),
    [],
    "文字列の中の括弧・セミコロンで割らない",
  );
  assert.deepEqual(
    g(".card { & a { color: red } a { x: 1 } }"),
    [],
    "入れ子の規則は親で絞られる",
  );
  assert.deepEqual(
    g(
      "@media (max-width: 480px) { a { x: 1 } .c { x: 1 } }\n@keyframes k { from { x: 0 } 50%, to { x: 1 } }\n@font-face { font-family: f; }",
    ),
    ["a"],
    "@media の中は見る。@keyframes・@font-face の中は見ない",
  );
}
expect(
  "#2258 src/locales/ja は H8",
  ["M src/locales/ja/common.json"],
  "heavy",
  ["H8"],
);
expect(
  "data/analysis の既存の変更は H8",
  ["M data/analysis/ai-crawler/2026-10-30.json"],
  "heavy",
  ["H8"],
);
expect("config/*.json", ["M config/today-variants.json"], "heavy", ["H8"]);
expect(
  "語が新しく入る（H9）",
  ["M src/pages/VenueGridPage.jsx"],
  "heavy",
  ["H9"],
  patch("src/pages/VenueGridPage.jsx", ["<p>回収率で見る</p>"]),
);
expect(
  "前からある語の行の書き換えは H9 に当てない",
  ["M src/pages/VenueGridPage.jsx"],
  "light",
  [],
  patch(
    "src/pages/VenueGridPage.jsx",
    ["<p>的中率（直近）</p>"],
    ["<p>的中率</p>"],
  ),
);
expect(
  "risk-rules の語（platforms: all）も H9",
  ["M src/components/HitRaces.jsx"],
  "heavy",
  ["H9"],
  patch("src/components/HitRaces.jsx", ["<p>一攫千金</p>"]),
);
expect(
  "記事の JSON（src/data/blog-posts/）の語は H9 に当てない",
  ["M src/data/blog-posts/kyotei-guide.json"],
  "light",
  [],
  patch("src/data/blog-posts/kyotei-guide.json", [
    '  "metaTitle": "競艇の回収率の見方",',
  ]),
);
expect(
  "src/data/ の記事以外の語は今までどおり H9",
  ["M src/data/morningDigestCopy.js"],
  "heavy",
  ["H9"],
  patch("src/data/morningDigestCopy.js", ['  title: "的中率",']),
);

// ---- unified diff の読み方 ----
{
  const p = parsePatch(
    [
      "diff --git a/x.json b/x.json",
      "--- a/x.json",
      "+++ b/x.json",
      "@@ -1 +1,2 @@",
      "-old",
      "+new",
      "+++plus",
      "diff --git a/gone.txt b/gone.txt",
      "--- a/gone.txt",
      "+++ /dev/null",
      "@@ -1 +0,0 @@",
      "-bye",
    ].join("\n"),
  );
  assert.deepEqual(p.get("x.json"), {
    added: ["new", "++plus"],
    removed: ["old"],
  });
  assert.deepEqual(p.get("gone.txt"), { added: [], removed: ["bye"] });
  // 空白を含むパスは末尾にタブ、引用符等は C の形で引用される
  assert.equal(headerPath("b/src/a b.jsx\t"), "src/a b.jsx");
  assert.equal(headerPath('"b/src/q\\"x.jsx"'), 'src/q"x.jsx');
  assert.equal(headerPath('"b/src/\\346\\227\\245.jsx"'), "src/日.jsx");
  assert.equal(headerPath("/dev/null"), null);
}

// ---- 移すだけ（BOA-1433 RA02b）: split-data-layer.mjs が字のまま移した PR は H3・H9 を外す ----
// fixture の import は文字列の中に置く（行の頭に相対の import を書くと verify-relative-imports が参照先を探す）
const SVC = "src/services/supabaseDataService.js";
const SQ = "src/services/scheduleQueries.js";
const lines = (...ls) => ls.join("\n") + "\n";
const MOVE_BASE = lines(
  "/** 頭の注釈 */",
  'import { a } from "../utils/a.js";',
  "",
  "const K = new Map();",
  "",
  "/** 殻 */",
  "export const supabaseDataService = {",
  "  /**",
  "   * X の注釈",
  "   */",
  "  async getX(v) {",
  "    return a(v) + K.size + this.getY(v);",
  "  },",
  "  getY(v) {",
  '    return "的中率" + v;',
  "  },",
  "  getZ(v) {",
  "    return v;",
  "  },",
  "};",
);
const MOVE_HEAD = lines(
  "/** 頭の注釈 */",
  'import { getX, getY } from "./scheduleQueries.js";',
  "",
  "/** 殻 */",
  "export const supabaseDataService = {",
  "  getX,",
  "  getY,",
  "  getZ(v) {",
  "    return v;",
  "  },",
  "};",
);
const MOVE_TO = lines(
  "// src/services/supabaseDataService.js から scripts/maintenance/split-data-layer.mjs で字のまま移した（領域: schedule）。",
  "// 本体の字下げは元のまま。手で直すときは普通の関数として直してよい",
  "",
  'import { a } from "../utils/a.js";',
  "",
  "const K = new Map();",
  "/**",
  " * X の注釈",
  " */",
  "export async function getX(v) {",
  "    return a(v) + K.size + getY(v);",
  "  }",
  "export function getY(v) {",
  '    return "的中率" + v;',
  "  }",
);
const moveOnly = loadMoveOnly();
const moveChanges = [
  { status: "M", path: SVC },
  { status: "A", path: SQ },
];
const moveRun = (to, { changes = moveChanges, head = MOVE_HEAD } = {}) => {
  const read = (side, p) =>
    p === SVC ? (side === "base" ? MOVE_BASE : head) : p === SQ ? to : null;
  const moved = moveOnlyPaths(moveOnly, changes, read);
  const r = classify({
    changes,
    patches: new Map(changes.map((c) => [c.path, { added: [], removed: [] }]).concat([[SQ, { added: ['    return "的中率" + v;'], removed: [] }]])),
    trees: [],
    moved,
  });
  return { moved, r };
};
{
  const ok = moveRun(MOVE_TO);
  assert.deepEqual([...ok.moved].sort(), [SQ, SVC], "字のまま移す→移すだけ");
  assert.equal(ok.r.lane, "light", `字のまま移す→軽（${JSON.stringify(ok.r.hits)}）`);
  const oneChar = moveRun(MOVE_TO.replace("K.size + getY", "K.size - getY"));
  assert.equal(oneChar.moved.size, 0, "移して1字変える→移すだけでない");
  assert.deepEqual(rulesOf(oneChar.r), ["H3", "H9"], "移して1字変える→重（H3・H9）");
  const extra = moveRun(MOVE_TO + lines("export function getNew() {", "  return 1;", "}"));
  assert.equal(extra.r.lane, "heavy", "新しい関数を足す→重");
  assert.ok(rulesOf(extra.r).includes("H3"));
  // 殻にだけ短い形を足す（中身の無い名前）・移した先が既存のファイル・読めない・src/pure を混ぜる
  const fakeHead = MOVE_HEAD.replace("  getY,\n", "  getY,\n  getW,\n");
  assert.equal(moveRun(MOVE_TO, { head: fakeHead }).moved.size, 0, "殻に名前だけ足す→移すだけでない");
  const modified = [{ status: "M", path: SVC }, { status: "M", path: SQ }];
  assert.equal(moveRun(MOVE_TO, { changes: modified }).moved.size, 0, "既存のファイルへ移す→移すだけでない");
  assert.equal(moveRun(null).moved.size, 0, "読めない→移すだけでない（安全側）");
  const withPure = [...moveChanges, { status: "M", path: "src/pure/raceModel.js" }];
  const pure = moveRun(MOVE_TO, { changes: withPure });
  assert.deepEqual(pure.r.hits.map((h) => `${h.rule} ${h.file}`), ["H3 src/pure/raceModel.js"], "src/pure は外さない");
  // 初期化に呼び出しを含む上の行の順を変える→移すだけでない
  const twoInit = (x, y) => MOVE_TO.replace("const K = new Map();", `${x}\n${y}`);
  const base2 = MOVE_BASE.replace("const K = new Map();", "const K = new Map();\nconst J = new Set();");
  const read2 = (to) => (side, p) => (p === SVC ? (side === "base" ? base2 : MOVE_HEAD) : to);
  assert.equal(moveOnlyPaths(moveOnly, moveChanges, read2(twoInit("const K = new Map();", "const J = new Set();"))).size, 2);
  assert.equal(moveOnlyPaths(moveOnly, moveChanges, read2(twoInit("const J = new Set();", "const K = new Map();"))).size, 0, "初期化の順を変える→移すだけでない");
  // 委ねるだけのメソッドを短い形にして上の関数を使う（注釈ごと消える）
  const delBase = MOVE_BASE.replace("  getZ(v) {\n    return v;\n  },", "  /** Z */\n  getZ(v) {\n    return getZ(v);\n  },");
  const delHead = MOVE_HEAD.replace("  getZ(v) {\n    return v;\n  },", "  getZ,");
  const readDel = (side, p) => (p === SVC ? (side === "base" ? delBase : delHead) : MOVE_TO);
  assert.equal(moveOnlyPaths(moveOnly, moveChanges, readDel).size, 2, "委ねるだけのメソッド");
  assert.equal(moveOnlyPaths(undefined, moveChanges, readDel).size, 0, "設定が無ければ外さない");
}

// ---- CLI（一時の git の木） ----
{
  const repo = mkdtempSync(join(tmpdir(), "pr-lane-"));
  const g = (...args) =>
    execFileSync(
      "git",
      [
        "-c",
        "user.name=pr-lane",
        "-c",
        "user.email=pr-lane@example.invalid",
        "-c",
        "commit.gpgsign=false",
        ...args,
      ],
      { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim();
  const put = (p, text) => {
    mkdirSync(dirname(join(repo, p)), { recursive: true });
    writeFileSync(join(repo, p), text);
  };
  g("init", "-q", "-b", "main");
  put("README.md", "x\n");
  put("src/utils/shared.js", "export const a = 1;\n");
  put("src/pages/Other.jsx", "export default 1;\n");
  // 語（H9）は判定する repo の merge-base の木の risk-rules から読む
  put(
    "sns-video-studio/remotion/risk-rules.json",
    readFileSync(
      join(ROOT, "sns-video-studio/remotion/risk-rules.json"),
      "utf8",
    ),
  );
  put(
    "sns-video-studio/remotion/src/Root.jsx",
    'import { a } from "../../../src/utils/shared.js";\nexport default a;\n',
  );
  g("add", "-A");
  g("commit", "-q", "-m", "base");
  const start = g("rev-parse", "HEAD");
  // master 側だけが進めた変更（head の差分には入らない）
  put("scripts/other.js", "x\n");
  g("add", "-A");
  g("commit", "-q", "-m", "master moves");
  const master = g("rev-parse", "HEAD");
  g("checkout", "-q", "-b", "docs", start);
  put("docs/a.md", "a\n");
  g("add", "-A");
  g("commit", "-q", "-m", "docs");
  const docs = g("rev-parse", "HEAD");
  g("checkout", "-q", "-b", "utils", start);
  put("src/utils/shared.js", "export const a = 2;\n");
  g("add", "-A");
  g("commit", "-q", "-m", "utils");
  const utils = g("rev-parse", "HEAD");
  // SNS・api から届かない画面の直し・バイナリ・空のファイル・空白を含むパス（語なし）
  g("checkout", "-q", "-b", "page", start);
  put("src/pages/Other.jsx", "export default 2;\n");
  put("src/a b.jsx", "export default 1;\n");
  put("src/empty.js", "");
  mkdirSync(join(repo, "public"), { recursive: true });
  writeFileSync(join(repo, "public/img.bin"), Buffer.from([0, 1, 2, 0, 255]));
  g("add", "-A");
  g("commit", "-q", "-m", "page");
  const page = g("rev-parse", "HEAD");
  // 空白・引用符を含むパスに語が入る（H9）
  g("checkout", "-q", "-b", "words", start);
  put("src/a b.jsx", "<p>回収率</p>\n");
  put('src/q"x.jsx', "<p>競艇</p>\n");
  g("add", "-A");
  g("commit", "-q", "-m", "words");
  const words = g("rev-parse", "HEAD");

  const cli = (base, head) =>
    spawnSync(
      process.execPath,
      [
        join(ROOT, "scripts/maintenance/pr-lane.js"),
        "--base",
        base,
        "--head",
        head,
        "--repo",
        repo,
      ],
      { encoding: "utf8" },
    );
  const light = cli(master, docs);
  assert.equal(light.status, 0, light.stderr);
  assert.deepEqual(
    JSON.parse(light.stdout),
    { lane: "light", hits: [] },
    "master だけの変更（scripts/other.js）は差分に入れない",
  );

  const heavy = cli(master, utils);
  assert.equal(heavy.status, 0, heavy.stderr);
  const out = JSON.parse(heavy.stdout);
  assert.equal(out.lane, "heavy");
  assert.deepEqual(
    out.hits.map((h) => [h.rule, h.file]),
    [["H2", "src/utils/shared.js"]],
    "SNS の入口から届く src/utils はコミットの木で辿る",
  );

  const pageRun = cli(master, page);
  assert.equal(pageRun.status, 0, pageRun.stderr);
  assert.deepEqual(
    JSON.parse(pageRun.stdout),
    { lane: "light", hits: [] },
    "届かない画面・バイナリ・空のファイル・空白を含むパスは軽い道",
  );
  const wordsRun = cli(master, words);
  assert.equal(wordsRun.status, 0, wordsRun.stderr);
  assert.deepEqual(
    JSON.parse(wordsRun.stdout).hits.map((h) => [h.rule, h.file]),
    [
      ["H9", "src/a b.jsx"],
      ["H9", 'src/q"x.jsx'],
    ],
    "空白・引用符を含むパスでも足した行の語を読む",
  );

  const bad = cli(master, "0000000000000000000000000000000000000000");
  assert.notEqual(bad.status, 0, "判定できないときは 0 以外");
  assert.equal(JSON.parse(bad.stdout).lane, "heavy");
  const missing = spawnSync(
    process.execPath,
    [join(ROOT, "scripts/maintenance/pr-lane.js"), "--repo", repo],
    {
      encoding: "utf8",
    },
  );
  assert.notEqual(missing.status, 0, "--base・--head が無いときは 0 以外");
  const flagAsValue = spawnSync(
    process.execPath,
    [
      join(ROOT, "scripts/maintenance/pr-lane.js"),
      "--base",
      "--head",
      docs,
      "--repo",
      repo,
    ],
    { encoding: "utf8" },
  );
  assert.notEqual(flagAsValue.status, 0);
  assert.match(
    JSON.parse(flagAsValue.stdout).error,
    /--base と --head が要る/,
    "次の旗を値にしない",
  );
  const empty = cli(docs, docs);
  assert.notEqual(empty.status, 0, "差分が空のときは判定しない（0 以外）");

  // 時間の上限を超えたら判定しない
  assert.throws(
    () => classifyCommits(repo, master, utils, 0),
    /時間の上限/,
    "上限を超えたら投げる（CLI は 0 以外）",
  );

  // hq の写し: pr-lane.js・規則・relativeImportGraph.js だけを同じ配置で（node_modules なし）置いても動く
  {
    const copy = mkdtempSync(join(tmpdir(), "pr-lane-hq-"));
    for (const p of [
      "scripts/maintenance/pr-lane.js",
      "config/pr-path-rules.json",
      "scripts/lib/relativeImportGraph.js",
    ]) {
      mkdirSync(dirname(join(copy, p)), { recursive: true });
      copyFileSync(join(ROOT, p), join(copy, p));
    }
    const r = spawnSync(
      process.execPath,
      [
        join(copy, "scripts/maintenance/pr-lane.js"),
        "--base",
        master,
        "--head",
        words,
        "--repo",
        repo,
      ],
      { encoding: "utf8" },
    );
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).lane, "heavy", "写しでも判定できる");
  }

  // risk-rules が merge-base の木に無ければ判定しない（語を確かめられない）
  {
    const bare = mkdtempSync(join(tmpdir(), "pr-lane-bare-"));
    const gb = (...args) =>
      execFileSync(
        "git",
        [
          "-c",
          "user.name=pr-lane",
          "-c",
          "user.email=pr-lane@example.invalid",
          "-c",
          "commit.gpgsign=false",
          ...args,
        ],
        { cwd: bare, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      ).trim();
    gb("init", "-q", "-b", "main");
    writeFileSync(join(bare, "README.md"), "x\n");
    gb("add", "-A");
    gb("commit", "-q", "-m", "base");
    const b0 = gb("rev-parse", "HEAD");
    writeFileSync(join(bare, "README.md"), "y\n");
    gb("commit", "-q", "-am", "next");
    const b1 = gb("rev-parse", "HEAD");
    const r = spawnSync(
      process.execPath,
      [
        join(ROOT, "scripts/maintenance/pr-lane.js"),
        "--base",
        b0,
        "--head",
        b1,
        "--repo",
        bare,
      ],
      { encoding: "utf8" },
    );
    assert.notEqual(r.status, 0, "risk-rules が無いときは 0 以外");
    assert.equal(JSON.parse(r.stdout).lane, "heavy");
  }
}

// hq との約束: Node の組み込みと相対の import だけ（npm の部品を使わない）
for (const p of [
  "scripts/maintenance/pr-lane.js",
  "scripts/lib/relativeImportGraph.js",
]) {
  const src = readFileSync(join(ROOT, p), "utf8");
  const specs = [...src.matchAll(/^import[^"']*["']([^"']+)["']/gm)].map(
    (m) => m[1],
  );
  assert.ok(specs.length > 0, p);
  for (const s of specs)
    assert.match(s, /^(node:|\.\.?\/)/, `${p} が組み込み以外を import: ${s}`);
}

// CLI: 一時の git の木で、移すだけの PR は H3・H9 を外して軽（git から base・head の字を読む道）
{
  const repo = mkdtempSync(join(tmpdir(), "pr-lane-move-"));
  const g = (...args) =>
    execFileSync("git", ["-c", "user.name=pr-lane", "-c", "user.email=pr-lane@example.invalid", "-c", "commit.gpgsign=false", ...args], {
      cwd: repo,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  const put = (p, text) => {
    mkdirSync(dirname(join(repo, p)), { recursive: true });
    writeFileSync(join(repo, p), text);
  };
  g("init", "-q", "-b", "main");
  put("sns-video-studio/remotion/risk-rules.json", readFileSync(join(ROOT, "sns-video-studio/remotion/risk-rules.json"), "utf8"));
  put(SVC, MOVE_BASE);
  g("add", "-A");
  g("commit", "-q", "-m", "base");
  const base = g("rev-parse", "HEAD");
  put(SVC, MOVE_HEAD);
  put(SQ, MOVE_TO);
  g("add", "-A");
  g("commit", "-q", "-m", "move");
  const moveHead = g("rev-parse", "HEAD");
  put(SQ, MOVE_TO.replace("K.size + getY", "K.size - getY"));
  g("add", "-A");
  g("commit", "-q", "-m", "move and change");
  const changed = g("rev-parse", "HEAD");
  const cli = (head) =>
    JSON.parse(
      spawnSync(process.execPath, [join(ROOT, "scripts/maintenance/pr-lane.js"), "--base", base, "--head", head, "--repo", repo], {
        encoding: "utf8",
      }).stdout,
    );
  assert.equal(cli(moveHead).lane, "light", "CLI: 移すだけ→軽");
  assert.equal(cli(changed).lane, "heavy", "CLI: 移して1字変える→重");
}

console.log("verify-pr-lane: OK");
