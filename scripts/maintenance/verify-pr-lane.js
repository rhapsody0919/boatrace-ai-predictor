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
  parsePatch,
} from "./pr-lane.js";
import { moveOnlyPaths, moveOnlyReason } from "./prLaneMoveOnly.js";

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
// 約束: light なら human・needs は空。heavy なら hits の全部のファイルが human か needs に入る（file・kind の順、同じ組は1回）
const promise = (name, r) => {
  if (r.lane === "light") {
    assert.deepEqual([r.human, r.needs], [[], []], `${name}: light なのに human・needs`);
    return;
  }
  const covered = new Set([...r.human, ...r.needs].map((x) => x.file));
  for (const h of r.hits)
    assert.ok(covered.has(h.file), `${name}: ${h.file} が human にも needs にも入らない`);
  for (const list of [r.human, r.needs]) {
    const keys = list.map((x) => `${x.file}\0${x.kind}`);
    assert.equal(new Set(keys).size, keys.length, `${name}: 同じ組が2回`);
    assert.deepEqual(keys, [...keys].sort((a, b) => a.split("\0")[0].localeCompare(b.split("\0")[0]) || a.split("\0")[1].localeCompare(b.split("\0")[1])), `${name}: 並び`);
  }
};
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
  promise(name, r);
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

// ---- 別のファイルへ字のまま移した語の行は H9 に当てない（#2504 BOA-1403 の分割の誤検知） ----
{
  const BIG = "src/pages/VenueGridPage.jsx";
  const PART = "src/components/HitRaces.jsx";
  const LINE = "<p>回収率100%は超えていません</p>";
  const files = (...entries) => new Map(entries);
  const h9 = (r) => r.hits.filter((h) => h.rule === "H9").map((h) => h.file);
  expect(
    "別のファイルへ移しただけ（字下げだけ違う）は H9 に当てない",
    [`M ${BIG}`, `M ${PART}`],
    "light",
    [],
    files(
      [BIG, { added: [], removed: [`              ${LINE}`] }],
      [PART, { added: [`      ${LINE}`, "<p>見出し</p>"], removed: [] }],
    ),
  );
  expect(
    "消したファイルから移しただけも H9 に当てない",
    [`D ${BIG}`, `M ${PART}`],
    "light",
    [],
    files(
      [BIG, { added: [], removed: [LINE] }],
      [PART, { added: [LINE], removed: [] }],
    ),
  );
  const fresh = expect(
    "移した上に新しい語を足せば H9（移した先に当たる）",
    [`M ${BIG}`, `M ${PART}`],
    "heavy",
    ["H9"],
    files(
      [BIG, { added: [], removed: [LINE] }],
      [PART, { added: [LINE, "<p>的中率で見る</p>"], removed: [] }],
    ),
  );
  assert.deepEqual(h9(fresh), [PART], "移した先だけに当たる");
  assert.match(fresh.hits.find((h) => h.rule === "H9").reason, /的中率$/);
  expect(
    "移して1字変えれば H9",
    [`M ${BIG}`, `M ${PART}`],
    "heavy",
    ["H9"],
    files(
      [BIG, { added: [], removed: [LINE] }],
      [PART, { added: [LINE.replace("100", "120")], removed: [] }],
    ),
  );
  const dup = expect(
    "元に残したまま別のファイルへ写す（複製）は H9",
    [`M ${BIG}`, `M ${PART}`],
    "heavy",
    ["H9"],
    files(
      [BIG, { added: [`  ${LINE}`], removed: [LINE] }],
      [PART, { added: [LINE], removed: [] }],
    ),
  );
  assert.deepEqual(h9(dup), [PART]);
  expect(
    "1行を2つのファイルへ写せば H9（消した行と1対1）",
    [`M ${BIG}`, `M ${PART}`, "M src/components/RaceCard.jsx"],
    "heavy",
    ["H9"],
    files(
      [BIG, { added: [], removed: [LINE] }],
      [PART, { added: [LINE], removed: [] }],
      ["src/components/RaceCard.jsx", { added: [LINE], removed: [] }],
    ),
  );
  expect(
    "移し元の行を書き換えて残せば、移し元に新しい語が入ったとして H9",
    [`M ${BIG}`, `M ${PART}`],
    "heavy",
    ["H9"],
    files(
      [BIG, { added: ["<p>回収率は未達</p>"], removed: [LINE] }],
      [PART, { added: [LINE], removed: [] }],
    ),
  );
  expect(
    "語を見ないファイル（記事）から持ち込んだ行は H9",
    ["M src/data/blog-posts/guide.json", `M ${PART}`],
    "heavy",
    ["H9"],
    files(
      ["src/data/blog-posts/guide.json", { added: [], removed: [LINE] }],
      [PART, { added: [LINE], removed: [] }],
    ),
  );
  // 移すだけ（moveOnly）で外すファイルは移し元の席を取らない: from → to へ字のまま移した行を、
  // パスの順が先の別のファイルにも足すと、そのファイルに当たる（審査 P0）
  {
    const FROM = "src/services/supabaseDataService.js";
    const TO = "src/services/core2.js";
    const OTHER = "src/a/New.jsx";
    const r = classify({
      changes: [
        { status: "A", path: OTHER },
        { status: "A", path: TO },
        { status: "M", path: FROM },
      ],
      patches: files(
        [OTHER, { added: [LINE], removed: [] }],
        [TO, { added: [LINE], removed: [] }],
        [FROM, { added: [], removed: [LINE] }],
      ),
      trees: [],
      moved: new Set([FROM, TO]),
    });
    assert.ok(
      r.hits.some((h) => h.rule === "H9" && h.file === OTHER),
      `移すだけのファイルの行を別のファイルへ写すと H9（${JSON.stringify(r.hits)}）`,
    );
  }
}

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

// ---- 移すだけ（BOA-1433 RA02b）: split-data-layer.mjs が字のまま移した PR は H3・H9 を外す（prLaneMoveOnly.js） ----
// fixture の import は文字列の中に置く（行の頭に相対の import を書くと verify-relative-imports が参照先を探す）
const SVC = "src/services/supabaseDataService.js";
const SQ = "src/services/scheduleQueries.js";
const lines = (...ls) => ls.join("\n") + "\n";
const MOVE_BASE = lines(
  "/** 頭の注釈 */",
  'import { a, b } from "../utils/a.js";',
  'import { c } from "../utils/c.js";',
  "",
  "const K = new Map();",
  "const J = new Set();",
  "",
  "export function clearCache() {",
  "  K.clear();",
  "}",
  "",
  "/** 殻 */",
  "export const supabaseDataService = {",
  "  /**",
  "   * X の注釈",
  "   */",
  "  async getX(v) {",
  "    const n = a(v) + K.size;",
  "    const m = J.size;",
  "    return n + m + this.getY(v);",
  "  },",
  "  getY(v) {",
  '    return "的中率" + b(v);',
  "  },",
  "  getZ(v) {",
  "    return c(v);",
  "  },",
  "};",
);
const MOVE_HEAD = lines(
  "/** 頭の注釈 */",
  'import { c } from "../utils/c.js";',
  'import { getX, getY } from "./scheduleQueries.js";',
  'export { clearCache } from "./scheduleQueries.js";',
  "",
  "/** 殻 */",
  "export const supabaseDataService = {",
  "  getX,",
  "  getY,",
  "  getZ(v) {",
  "    return c(v);",
  "  },",
  "};",
);
const MOVE_TO = lines(
  "// src/services/supabaseDataService.js から scripts/maintenance/split-data-layer.mjs で字のまま移した（領域: schedule）。",
  "// 本体の字下げは元のまま。手で直すときは普通の関数として直してよい",
  "",
  'import { a, b } from "../utils/a.js";',
  "",
  "const K = new Map();",
  "const J = new Set();",
  "",
  "export function clearCache() {",
  "  K.clear();",
  "}",
  "/**",
  " * X の注釈",
  " */",
  "export async function getX(v) {",
  "    const n = a(v) + K.size;",
  "    const m = J.size;",
  "    return n + m + getY(v);",
  "  }",
  "export function getY(v) {",
  '    return "的中率" + b(v);',
  "  }",
);
const moveOnly = loadMoveOnly();
const moveChanges = [
  { status: "M", path: SVC },
  { status: "A", path: SQ },
];
const reader =
  ({ base = MOVE_BASE, head = MOVE_HEAD, to = MOVE_TO } = {}) =>
  (side, p) =>
    p === SVC ? (side === "base" ? base : head) : p === SQ ? to : null;
const why = (texts, changes = moveChanges) =>
  moveOnlyReason(moveOnly, changes, reader(texts));
const moveRun = (texts, changes = moveChanges) => {
  const moved = moveOnlyPaths(moveOnly, changes, reader(texts));
  const added = ['    return "的中率" + b(v);'];
  const r = classify({
    changes,
    patches: new Map(
      changes.map((c) => [
        c.path,
        { added: c.path === SQ ? added : [], removed: [] },
      ]),
    ),
    trees: [],
    moved,
  });
  return { moved, r };
};
{
  const ok = moveRun({});
  assert.equal(why({}), null, "字のまま移す→移すだけ");
  assert.deepEqual([...ok.moved].sort(), [SQ, SVC]);
  assert.equal(
    ok.r.lane,
    "light",
    `字のまま移す→軽（${JSON.stringify(ok.r.hits)}）`,
  );
  const oneChar = moveRun({ to: MOVE_TO.replace("n + m +", "n - m +") });
  assert.equal(oneChar.moved.size, 0, "移して1字変える→移すだけでない");
  assert.deepEqual(
    rulesOf(oneChar.r),
    ["H3", "H9"],
    "移して1字変える→重（H3・H9）",
  );
  const extra = lines("export function getNew() {", "  return 1;", "}");
  assert.match(why({ to: MOVE_TO + extra }), /getNew/, "新しい関数を足す");
  // 最後の単位の後ろの注釈（どの単位にも入らず比べられなかった。11/11 窓口の調べ neg1）
  const tail = "// 手で足した注釈\n";
  assert.match(why({ to: MOVE_TO + tail }), /注釈だけ/, "to の末に注釈を足す");
  assert.match(
    why({ head: MOVE_HEAD + tail }),
    /注釈だけ/,
    "殻の末に注釈を足す",
  );
  assert.match(
    why({ head: MOVE_HEAD.replace("\n};\n", "\n  // 手で足した注釈\n};\n") }),
    /注釈だけ/,
    "object の最後のメンバーの後ろに注釈を足す",
  );
  assert.equal(why({ to: MOVE_TO + "\n\n" }), null, "末の空行は移すだけのまま");
  assert.match(
    why({ to: MOVE_TO + "/*\n * x\n */\n" }),
    /注釈だけ/,
    "to の末に複数行の注釈を足す",
  );
  assert.match(
    why({ head: MOVE_HEAD.replace("\n};\n", "\n  // 手で足した注釈\n\n};\n") }),
    /注釈だけ/,
    "object の末に注釈と空行を足す",
  );
  // 審査（11/11）重大1: `/* a */ code /* b */` の行は注釈でない（import・export の前に置くとコードを隠せた）
  const hidden = "/* a */ globalThis.evil = 1; /* b */\n";
  const toHead = (t) => MOVE_TO.replace("\n\nimport {", `\n\n${t}import {`);
  assert.match(
    why({ to: toHead(hidden) }),
    /注釈の後ろに字/,
    "to の import の前に隠す",
  );
  assert.match(
    why({ head: MOVE_HEAD.replace("import { c }", `${hidden}import { c }`) }),
    /注釈の後ろに字/,
    "殻の import の前に隠す",
  );
  assert.match(
    why({
      head: MOVE_HEAD.replace(
        "export { clearCache }",
        `${hidden}export { clearCache }`,
      ),
    }),
    /注釈の後ろに字/,
    "殻の export の前に隠す",
  );
  assert.match(
    why({ to: toHead("/*\n x */ globalThis.evil = 1;\n") }),
    /注釈の後ろに字/,
    "複数行の注釈の閉じの後ろに隠す",
  );
  // 中1: import・export の注釈（名前だけで比べていた）
  assert.match(
    why({ to: toHead("// 足した\n") }),
    /import に注釈/,
    "to の import の前に注釈",
  );
  assert.match(
    why({
      to: MOVE_TO.replace(
        "import { a, b }",
        "import {\n  a, // 足した\n  b,\n}",
      ),
    }),
    /import に注釈/,
    "to の import の行末に注釈",
  );
  assert.match(
    why({
      to: MOVE_TO.replace(
        "import { a, b }",
        "import {\n  a,\n  /*\n  b,\n  */\n}",
      ),
    }),
    /文の中のブロックの注釈/,
    "to の import の名前を注釈で消す",
  );
  assert.match(
    why({ head: MOVE_HEAD.replace("import { c }", "// 足した\nimport { c }") }),
    /殻の import・export の注釈/,
    "殻の import の前に注釈を足す",
  );
  assert.match(
    why({
      head: MOVE_HEAD.replace(
        "export { clearCache }",
        "// 足した\nexport { clearCache }",
      ),
    }),
    /殻の import・export の注釈/,
    "殻の export の前に注釈を足す",
  );
  assert.match(
    why({ head: MOVE_HEAD.replace("import { c }", "import { c /* x */ }") }),
    /行の中の注釈/,
    "殻の import の行の中に注釈",
  );
  // 再審査（11/11）重大: base にある `/**`・`*/` を殻の import の中に差し込み、名前を注釈にして消す
  const blockBase = MOVE_BASE.replace("/** 頭の注釈 */", "/**\n * h\n */");
  assert.match(
    why({
      base: blockBase,
      head: MOVE_HEAD.replace("/** 頭の注釈 */\n", "").replace(
        'import { getX, getY } from "./scheduleQueries.js";',
        'import {\n  /**\n  getX,\n  */\n  getY,\n} from "./scheduleQueries.js";',
      ),
    }),
    /注釈/,
    "殻の import の名前を base の注釈の字で囲む",
  );
  // 本物の殻と同じ形: 複数行の import の中の `//` の注釈を殻にそのまま残すのは移すだけのまま
  const slashBase = MOVE_BASE.replace(
    'import { c } from "../utils/c.js";',
    'import {\n  // c の注釈\n  // 2行目\n  c,\n} from "../utils/c.js";',
  );
  const slashHead = MOVE_HEAD.replace(
    'import { c } from "../utils/c.js";',
    'import {\n  // c の注釈\n  // 2行目\n  c,\n} from "../utils/c.js";',
  );
  assert.equal(
    why({ base: slashBase, head: slashHead }),
    null,
    "殻の import の中の // の注釈はそのまま残してよい",
  );
  // 審査の重大1: 行の順と単位の境を見る（行の多重集合では通ってしまう形）
  const swap = MOVE_TO.replace(
    "    const n = a(v) + K.size;\n    const m = J.size;",
    "    const m = J.size;\n    const n = a(v) + K.size;",
  );
  assert.match(why({ to: swap }), /getX/, "単位の中の文を入れ替える");
  const hop = MOVE_TO.replace("    const m = J.size;\n", "").replace(
    "  }\nexport function getY(v) {\n",
    "  }\nexport function getY(v) {\n    const m = J.size;\n",
  );
  assert.match(why({ to: hop }), /getX|getY/, "文を別の関数へ移す");
  const order = MOVE_TO.replace(
    "const K = new Map();\nconst J = new Set();",
    "const J = new Set();\nconst K = new Map();",
  );
  assert.match(why({ to: order }), /const の順/, "上の const の順を変える");
  // 審査の重大2: import と export は名前・元・as まで base と同じか、この PR の to から
  const src = MOVE_TO.replace('"../utils/a.js"', '"../utils/a2.js"');
  assert.match(why({ to: src }), /import/, "import の元を差し替える");
  const alias = MOVE_TO.replace("import { a, b }", "import { a, c as b }");
  assert.match(why({ to: alias }), /import/, "as で別の物を同じ名前にする");
  const side = MOVE_TO.replace(
    "\nconst K",
    '\nimport "../utils/side.js";\nconst K',
  );
  assert.match(why({ to: side }), /副作用/, "副作用だけの import を足す");
  const reexp = MOVE_HEAD.replace("{ clearCache }", "{ clearCache, getX }");
  assert.match(
    why({ head: reexp }),
    /export/,
    "base で export していない名前を殻から export",
  );
  const lost = MOVE_HEAD.replace(
    'export { clearCache } from "./scheduleQueries.js";\n',
    "",
  );
  assert.match(why({ head: lost }), /clearCache/, "base の export を落とす");
  // 審査の重大3: import の頭と終わり（import(・import.meta を import と見ない、; の無い import は閉じない）
  const dyn = MOVE_TO.replace(
    "\nconst K",
    '\nimport("../utils/side.js");\nconst K',
  );
  assert.notEqual(why({ to: dyn }), null, "import( を足す");
  const meta = MOVE_TO.replace("\nconst K", "\nimport.meta.x = 1;\nconst K");
  assert.notEqual(why({ to: meta }), null, "import.meta を足す");
  const open = MOVE_TO.replace(
    'import { a, b } from "../utils/a.js";',
    'import { a, b } from "../utils/a.js"\nglobalThis.evil = 1;',
  );
  assert.notEqual(why({ to: open }), null, "; の無い import の後ろに文");
  // this.X → X は、移したメソッドを指し、局所の名前に隠れないときだけ
  const shadow = (t) => t.replace("const m = J.size;", "const getY = J.size;");
  assert.match(
    why({ base: shadow(MOVE_BASE), to: shadow(MOVE_TO) }),
    /裸の getY/,
    "this.X が局所の名前に隠れる",
  );
  const stay = (t) => t.replace("this.getY(v)", "this.getZ(v)");
  const stayTo = MOVE_TO.replace("+ getY(v)", "+ getZ(v)");
  assert.notEqual(
    why({ base: stay(MOVE_BASE), to: stayTo }),
    null,
    "this.X が殻に残るメソッド",
  );
  // 殻: 名前だけ足す・残すメンバーを変える・既存のファイルへ・読めない・設定なし・src/pure は外さない
  assert.notEqual(
    why({ head: MOVE_HEAD.replace("  getY,\n", "  getY,\n  getW,\n") }),
    null,
    "殻に名前だけ足す",
  );
  assert.match(
    why({ head: MOVE_HEAD.replace("return c(v)", "return c(v + 1)") }),
    /getZ/,
    "残すメンバーを変える",
  );
  const modified = [
    { status: "M", path: SVC },
    { status: "M", path: SQ },
  ];
  assert.notEqual(why({}, modified), null, "既存のファイルへ移す");
  assert.match(why({ to: null }), /読めない/, "読めない→安全側");
  assert.equal(
    moveOnlyPaths(undefined, moveChanges, reader()).size,
    0,
    "設定が無ければ外さない",
  );
  const withPure = [
    ...moveChanges,
    { status: "M", path: "src/pure/raceModel.js" },
  ];
  const pure = moveRun({}, withPure);
  assert.deepEqual(
    pure.r.hits.map((h) => `${h.rule} ${h.file}`),
    ["H3 src/pure/raceModel.js"],
    "src/pure は外さない",
  );
  // 審査（2回目）の再現: 頭の行で名前が隠れる・生の this・文字列の中の this.・注釈の後ろのコード・見えない名前・殻の import
  const param = (t) => t.replace("getY(v) {", "getY(getX) {");
  assert.notEqual(
    why({ base: param(MOVE_BASE), to: param(MOVE_TO) }),
    null,
    "頭の行の引数で名前が隠れる",
  );
  const rawThis = (t) =>
    t.replace(
      'return "的中率" + b(v);',
      'return "的中率" + b(v)\n      * this["k"];',
    );
  assert.match(
    why({ base: rawThis(MOVE_BASE), to: rawThis(MOVE_TO) }),
    /this/,
    "`*` で始まる行の this",
  );
  const strThis = (t) => t.replace('"的中率"', '"this.getY"');
  assert.match(
    why({
      base: strThis(MOVE_BASE),
      to: MOVE_TO.replace('"的中率"', '"getY"'),
    }),
    /this/,
    "文字列の中の this.",
  );
  const afterComment = MOVE_TO.replace(
    "\nconst K",
    '\n/* x */ import "../utils/side.js";\nconst K',
  );
  assert.match(why({ to: afterComment }), /注釈の後ろ/, "注釈の後ろのコード");
  const noImport = MOVE_TO.replace(
    'import { a, b } from "../utils/a.js";',
    'import { a } from "../utils/a.js";',
  );
  assert.match(
    why({ to: noImport }),
    /b が見えない/,
    "to で使う名前の import を外す",
  );
  const headNoImport = MOVE_HEAD.replace(
    'import { c } from "../utils/c.js";\n',
    "",
  );
  assert.match(
    why({ head: headNoImport }),
    /c が見えない/,
    "殻で使う名前の import を外す",
  );
  const headOrder = (t) =>
    t.replace(
      'import { c } from "../utils/c.js";',
      'import { c } from "../utils/c.js";\nimport "../utils/s.js";',
    );
  const swapped = MOVE_HEAD.replace(
    'import { c } from "../utils/c.js";',
    'import "../utils/s.js";\nimport { c } from "../utils/c.js";',
  );
  assert.equal(
    why({ base: headOrder(MOVE_BASE), head: headOrder(MOVE_HEAD) }),
    null,
    "副作用の import を残す",
  );
  assert.match(
    why({ base: headOrder(MOVE_BASE), head: swapped }),
    /import の順/,
    "殻の import の順を変える",
  );
  assert.match(
    why({ base: headOrder(MOVE_BASE) }),
    /副作用/,
    "殻の副作用の import を外す",
  );
  const selfImport = MOVE_TO.replace(
    "\nconst K",
    '\nimport { supabaseDataService } from "./supabaseDataService.js";\nconst K',
  );
  assert.match(why({ to: selfImport }), /import/, "to が殻を import する");
  assert.match(
    why({ to: MOVE_TO.replace("+ getY(v);", "+ this.getY(v);") }),
    /getX/,
    "to に this が残る",
  );
  const keepLet = (t) => t.replace("/** 殻 */", "let L = 0;\n\n/** 殻 */");
  assert.match(
    why({ base: keepLet(MOVE_BASE), head: keepLet(MOVE_HEAD) }),
    /宣言でない文/,
    "殻に残す上の let",
  );
  // 委ねるだけのメソッドは、上の関数を移したときだけ短い形にしてよい
  const delBase = MOVE_BASE.replace(
    "  getZ(v) {\n    return c(v);\n  },",
    "  /** Z */\n  clearCache() {\n    return clearCache();\n  },\n  getZ(v) {\n    return c(v);\n  },",
  );
  const delHead = MOVE_HEAD.replace(
    "  getZ(v) {",
    "  clearCache,\n  getZ(v) {",
  ).replace("import { getX, getY }", "import { clearCache, getX, getY }");
  assert.equal(
    why({ base: delBase, head: delHead }),
    null,
    "委ねるだけのメソッド",
  );
  const delAsync = delBase.replace(
    "  clearCache() {",
    "  async clearCache() {",
  );
  assert.notEqual(
    why({ base: delAsync, head: delHead }),
    null,
    "async のメソッドが同期の関数に委ねる",
  );
  const delArgs = delBase.replace(
    "return clearCache();",
    "return clearCache(1);",
  );
  assert.notEqual(
    why({ base: delArgs, head: delHead }),
    null,
    "引数を変えて委ねる",
  );
}

// ---- 死んだ型の検査: 規則の型が手元の木のどのファイルにも当たらないと、移す PR（RA02）で規則が黙って外れる ----
{
  const config = JSON.parse(
    readFileSync(join(ROOT, "config/pr-path-rules.json"), "utf8"),
  );
  const reserved = new Set(config.reservedPatterns.map((r) => r.pattern));
  for (const r of config.reservedPatterns)
    assert.ok(r.reason, `reservedPatterns に理由が要る: ${r.pattern}`);
  const keys = [
    "paths", "added", "changed", "exceptAdded", "except",
    "reachFrom", "rowsOnlyAdded", "globalSelectors",
  ];
  const patterns = [
    ...config.rules.flatMap((rule) =>
      [
        ...keys.flatMap((k) => rule[k] ?? []),
        ...(rule.terms ? [...rule.terms.scan, ...rule.terms.except] : []),
        ...(typeof rule.needs === "object" ? Object.values(rule.needs).flat() : []),
      ].map((p) => [rule.id, p, ""]),
    ),
    ...[config.moveOnly.from, ...config.moveOnly.to].map((p) => ["moveOnly", p, ""]),
    ...Object.entries(config.human).flatMap(([kind, spec]) =>
      ["paths", "writerFiles", "deleted", "changedScripts", "addedRows", "registryRows", "removedRows"]
        .flatMap((k) => spec[k] ?? [])
        .map((p) => [`human.${kind}`, p, "i"]),
    ),
  ];
  assert.ok(patterns.length > 50, "型を集められていない");
  const dead = patterns.filter(
    ([, p, flags]) =>
      !reserved.has(p) && !files.some((f) => new RegExp(p, flags).test(f)),
  );
  assert.deepEqual(
    dead,
    [],
    "どのファイルにも当たらない型（移す PR は規則の型も同じ PR で直す。今は無いが残す物は reservedPatterns に理由つきで）",
  );
}

// ---- human（人にしか判断できない理由）と needs（機械の確かめ） ----
{
  // blobs: パス → { base, head }（無ければ害のない中身。null は読めない）
  const explain = (changes, { patches, blobs = {} } = {}) => {
    const list = changes.map((c) => {
      const [status, path] = c.split(" ");
      return { status, path };
    });
    const all = new Map(list.map((c) => [c.path, { added: [], removed: [] }]));
    for (const [k, v] of patches ?? new Map()) all.set(k, v);
    const r = classify({
      changes: list,
      patches: all,
      trees: [],
      readBlob: (side, p) =>
        p in blobs && side in blobs[p] ? blobs[p][side] : "const a = 1;\n",
    });
    promise(changes.join(","), r);
    return r;
  };
  const ex = (changes, opts = {}, { human = [], noHuman = [], needs = [], noNeeds = [] } = {}) => {
    const r = explain(changes, opts);
    const h = r.human.map((x) => `${x.kind} ${x.file}`);
    const n = r.needs.map((x) => `${x.kind} ${x.file}`);
    const at = `${changes.join(",")} human=${h} needs=${n}`;
    for (const x of human) assert.ok(h.includes(x), `${at}: human に ${x} が無い`);
    for (const x of noHuman) assert.ok(!h.includes(x), `${at}: human に ${x} がある`);
    for (const x of needs) assert.ok(n.includes(x), `${at}: needs に ${x} が無い`);
    for (const x of noNeeds) assert.ok(!n.includes(x), `${at}: needs に ${x} がある`);
  };
  const upsert = { "scripts/daily/w.js": { head: 'await sb.from("x").upsert(rows);\n' } };

  ex(["M .github/workflows/ci.yml"], {}, { human: ["github .github/workflows/ci.yml"] });
  ex(["A scripts/maintenance/ryujin-maker-token.js"], {}, { human: ["secret scripts/maintenance/ryujin-maker-token.js"] });
  ex(["M package-lock.json"], {}, { human: ["secret package-lock.json"] });
  ex(["M scripts/analysis/foo.js"], {}, {
    noHuman: ["secret scripts/analysis/foo.js", "db scripts/analysis/foo.js", "github scripts/analysis/foo.js"],
    needs: ["line-mutation scripts/analysis/foo.js"],
  });
  ex(["M scripts/lib/x.js"], {}, { human: ["db scripts/lib/x.js"], noNeeds: ["line-mutation scripts/lib/x.js"] });
  ex(["M scripts/daily/w.js"], { blobs: upsert }, { human: ["db scripts/daily/w.js"] });
  ex(["M scripts/daily/w.js"], { blobs: { "scripts/daily/w.js": { base: 'sb\n.from("x")\n  .delete()\n', head: "" } } }, { human: ["db scripts/daily/w.js"] });
  ex(["M scripts/daily/w.js"], { blobs: { "scripts/daily/w.js": { head: "const k = process.env.SUPABASE_SERVICE_ROLE_KEY;\n" } } }, { human: ["db scripts/daily/w.js"] });
  ex(["M scripts/daily/w.js"], { blobs: { "scripts/daily/w.js": { head: null } } }, { human: ["db scripts/daily/w.js"] });
  ex(["M scripts/daily/w.js"], { blobs: { "scripts/daily/w.js": { head: 'sb.from("x").select("*");\n' } } }, { noHuman: ["db scripts/daily/w.js"], needs: ["line-mutation scripts/daily/w.js"] });
  ex(["M scripts/sns/post.js"], {}, { human: ["sns scripts/sns/post.js"], noHuman: ["terms scripts/sns/post.js"] });
  ex(["M src/components/Foo.jsx"], { patches: patch("src/components/Foo.jsx", ["<p>回収率</p>"]) }, { human: ["terms src/components/Foo.jsx"], noHuman: ["sns src/components/Foo.jsx"] });
  ex(["M public/robots.txt"], {}, { human: ["seo public/robots.txt"] });
  ex(["M scripts/maintenance/pr-lane.js"], {}, { human: ["judge scripts/maintenance/pr-lane.js"], noNeeds: ["line-mutation scripts/maintenance/pr-lane.js"] });
  ex(["M e2e/fixtures.js"], {}, { human: ["fixture e2e/fixtures.js"], noNeeds: ["base-spec-on-head e2e/fixtures.js"] });
  ex(["M e2e/recordings/x.json.gz"], {}, { human: ["fixture e2e/recordings/x.json.gz"], noNeeds: ["base-spec-on-head e2e/recordings/x.json.gz"] });
  ex(["D scripts/maintenance/verify-foo.js"], {}, { human: ["weaken scripts/maintenance/verify-foo.js"] });
  ex(["M scripts/maintenance/verify-foo.js"], {}, { noHuman: ["weaken scripts/maintenance/verify-foo.js"], needs: ["verify-mutation scripts/maintenance/verify-foo.js"] });
  ex(["M scripts/maintenance/verify-foo.mjs"], {}, { human: ["weaken scripts/maintenance/verify-foo.mjs"] });
  ex(["D e2e/foo.spec.js"], {}, { human: ["weaken e2e/foo.spec.js"] });
  ex(["M e2e/foo.spec.js"], {}, { noHuman: ["weaken e2e/foo.spec.js"], needs: ["base-spec-on-head e2e/foo.spec.js"] });
  ex(["M docs/x-allowlist.json"], { patches: patch("docs/x-allowlist.json", ['  "a",']) }, { human: ["weaken docs/x-allowlist.json"] });
  ex(["M docs/x-allowlist.json"], { patches: patch("docs/x-allowlist.json", [], ['  "a",']) }, { noHuman: ["weaken docs/x-allowlist.json"], human: ["unclassified docs/x-allowlist.json"] });
  const reg = "scripts/maintenance/verify-registry.json";
  ex([`M ${reg}`], { patches: patch(reg, ['{ "name": "b" }'], ['{ "name": "a" }']) }, { human: [`weaken ${reg}`] });
  ex(["M AGENTS.md"], { patches: patch("AGENTS.md", ["b"], ["a"]) }, { human: ["weaken AGENTS.md"] });
  ex(["M AGENTS.md"], { patches: patch("AGENTS.md", ["b"]) }, { noHuman: ["weaken AGENTS.md"], human: ["unclassified AGENTS.md"] });
  ex(["M src/App.css"], {}, { human: ["css-core src/App.css"], noNeeds: ["screenshot-diff src/App.css"] });
  ex(["M src/components/Foo.css"], {}, { noHuman: ["css-core src/components/Foo.css"], needs: ["screenshot-diff src/components/Foo.css"] });
  ex(["M src/pure/x.js"], {}, { needs: ["line-mutation src/pure/x.js"] });
  ex(["M api/x.js"], {}, { needs: ["line-mutation api/x.js"] });
  ex(["A src/pages/NewPage.jsx"], {}, { needs: ["route-in-e2e src/pages/NewPage.jsx"] });
  ex(["M data/x.json"], {}, { needs: ["line-mutation data/x.json"] });
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
  // 別のファイルへ字のまま移す（H9 に当てない）・移して新しい語・PR で risk-rules の語を消す（merge-base の語で当てる）
  g("checkout", "-q", "-b", "split", start);
  put(
    "src/pages/Long.jsx",
    "export default () => (\n  <div>\n        <p>回収率は未達</p>\n        <p>一攫千金ではない</p>\n  </div>\n);\n",
  );
  g("add", "-A");
  g("commit", "-q", "-m", "split base");
  const splitBase = g("rev-parse", "HEAD");
  put(
    "src/pages/Long.jsx",
    'import Part from "./long/Part.jsx";\nexport default () => <Part />;\n',
  );
  put(
    "src/pages/long/Part.jsx",
    "export default () => (\n  <div>\n    <p>回収率は未達</p>\n    <p>一攫千金ではない</p>\n  </div>\n);\n",
  );
  g("add", "-A");
  g("commit", "-q", "-m", "split");
  const splitHead = g("rev-parse", "HEAD");
  put(
    "src/pages/long/Part.jsx",
    "export default () => (\n  <div>\n    <p>回収率は未達</p>\n    <p>一攫千金ではない</p>\n    <p>的中率</p>\n  </div>\n);\n",
  );
  g("add", "-A");
  g("commit", "-q", "-m", "split and new word");
  const splitFresh = g("rev-parse", "HEAD");
  g("checkout", "-q", "-b", "weaken", start);
  const risk = JSON.parse(
    readFileSync(
      join(repo, "sns-video-studio/remotion/risk-rules.json"),
      "utf8",
    ),
  );
  put(
    "sns-video-studio/remotion/risk-rules.json",
    JSON.stringify({
      ...risk,
      rules: risk.rules.filter((r) => !r.patterns.includes("一攫千金")),
    }),
  );
  put("src/pages/Other.jsx", "export default () => <p>一攫千金</p>;\n");
  g("add", "-A");
  g("commit", "-q", "-m", "weaken words");
  const weaken = g("rev-parse", "HEAD");
  // 移すだけ（BOA-1433）: git から base・head の字を読む道。移す前の殻・移した木・移して1字変えた木
  const moveCommit = (files, msg) => {
    for (const [p, text] of files) put(p, text);
    g("add", "-A");
    g("commit", "-q", "-m", msg);
    return g("rev-parse", "HEAD");
  };
  g("checkout", "-q", "-b", "move", start);
  const moveBase = moveCommit([[SVC, MOVE_BASE]], "move base");
  const moveHead = moveCommit(
    [
      [SVC, MOVE_HEAD],
      [SQ, MOVE_TO],
    ],
    "move",
  );
  const moveChanged = moveCommit(
    [[SQ, MOVE_TO.replace("n + m +", "n - m +")]],
    "move and change",
  );

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
    { lane: "light", hits: [], human: [], needs: [] },
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
  assert.deepEqual(
    [out.human.map((x) => x.kind), out.needs],
    [["sns"], []],
    "CLI: heavy の出力に human（sns）・needs がある",
  );

  const pageRun = cli(master, page);
  assert.equal(pageRun.status, 0, pageRun.stderr);
  assert.deepEqual(
    JSON.parse(pageRun.stdout),
    { lane: "light", hits: [], human: [], needs: [] },
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
  const h9Files = (base, head) => {
    const r = cli(base, head);
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout)
      .hits.filter((h) => h.rule === "H9")
      .map((h) => h.file);
  };
  assert.deepEqual(
    h9Files(splitBase, splitHead),
    [],
    "CLI: 別のファイルへ字のまま移しただけは H9 に当てない",
  );
  assert.deepEqual(
    h9Files(splitBase, splitFresh),
    ["src/pages/long/Part.jsx"],
    "CLI: 移した上に新しい語を足せば H9",
  );
  assert.deepEqual(
    h9Files(master, weaken),
    ["src/pages/Other.jsx"],
    "CLI: PR が risk-rules から語を消しても merge-base の語で H9",
  );
  assert.deepEqual(
    JSON.parse(cli(moveBase, moveHead).stdout),
    { lane: "light", hits: [], human: [], needs: [] },
    "CLI: 移すだけ→軽",
  );
  assert.equal(
    JSON.parse(cli(moveBase, moveChanged).stdout).lane,
    "heavy",
    "CLI: 移して1字変える→重",
  );

  const bad = cli(master, "0000000000000000000000000000000000000000");
  assert.notEqual(bad.status, 0, "判定できないときは 0 以外");
  assert.equal(JSON.parse(bad.stdout).lane, "heavy");
  assert.deepEqual(
    [JSON.parse(bad.stdout).human.map((x) => [x.kind, x.file]), JSON.parse(bad.stdout).needs],
    [[["error", ""]], []],
    "判定できないときは human に error の要素",
  );
  assert.ok(JSON.parse(bad.stdout).human[0].reason, "error の reason");
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

  // hq の写し: pr-lane.js・prLaneMoveOnly*.js・規則・relativeImportGraph.js だけを同じ配置で（node_modules なし）置いても動く
  {
    const copy = mkdtempSync(join(tmpdir(), "pr-lane-hq-"));
    for (const p of [
      "scripts/maintenance/pr-lane.js",
      "scripts/maintenance/prLaneMoveOnly.js",
      "scripts/maintenance/prLaneMoveOnlyParse.js",
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
  "scripts/maintenance/prLaneMoveOnly.js",
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

console.log("verify-pr-lane: OK");
