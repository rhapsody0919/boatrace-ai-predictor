/**
 * 軽い道／重い道の判定（pr-lane.js、config/pr-path-rules.json）を固定する。外部接続なし（tier=ci）。
 * 設計: docs/proposal/dev-process-redesign-2026-11-05.md 1.2・1.5（#2277）。
 *
 * - 1.5 の振り分けの表の代表（PR の差分のパスと状態をそのまま入力にする）が、期待どおりの lane と規則になる
 * - src/utils の変更が SNS の自動送信（H2）と api（H6）に import でたどれる（#2236 → #2251 の壊れ）
 * - scripts/** は H1（新しい verify-*.js だけ除く）、src/locales/ja は H8、判定の script と規則の変更は H5
 * - CLI: 一時の git の木で base...head の差分（merge-base から）を判定し、JSON を出して終了 0。判定できなければ 0 以外で heavy
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fsIo } from "../lib/relativeImportGraph.js";
import { TREE_ROOT, classify, parsePatch } from "./pr-lane.js";

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

const run = (changes, patches = new Map()) =>
  classify({
    changes: changes.map((c) => {
      const [status, path] = c.split(" ");
      return { status, path };
    }),
    patches,
    trees: [tree],
  });
const rulesOf = (r) => [...new Set(r.hits.map((h) => h.rule))].sort();
const expect = (name, changes, lane, rules = [], patches) => {
  const r = run(changes, patches);
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
  "#2157 既存の画面の小さな直しと新しい e2e",
  [
    "A e2e/today-featured-racer-link.spec.js",
    "M src/components/digest/FeaturedRaceCard.css",
    "M src/components/digest/FeaturedRaceCard.jsx",
  ],
  "light",
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

// ---- 重い道 ----
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
  const empty = cli(docs, docs);
  assert.notEqual(empty.status, 0, "差分が空のときは判定しない（0 以外）");
}

console.log("verify-pr-lane: OK");
