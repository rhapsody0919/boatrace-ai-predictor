/**
 * verify-pr-lane.js の後半の場面（1/6）。verify ではない。
 * 判定と期待値は分ける前の verify-pr-lane.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import assert from "node:assert/strict";

let expect, patch;

function prl1Scene1() {
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
}

function prl1Scene2() {
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
  for (const f of ["pr-lane", "prLaneClassify", "prLaneHuman", "prLaneLines"])
    expect(`判定の script 自身 ${f}.js`, [`M scripts/maintenance/${f}.js`], "heavy", ["H1", "H5"]);
  expect("判定の規則", ["M config/pr-path-rules.json"], "heavy", ["H5", "H8"]);
  expect("import の辿り方", ["M scripts/lib/relativeImportGraph.js"], "heavy", [
    "H1",
    "H5",
  ]);
  expect("#2156 api/_lib", ["M api/_lib/botRace.js"], "heavy", ["H6"]);
  expect("#2250 送る口", ["M api/cron/sns-send.js"], "heavy", ["H2", "H6"]);
  expect("middleware", ["M middleware.js"], "heavy", ["H5"]);
  expect("#2153 全体の CSS", ["M src/App.css"], "heavy", ["H7"]);
}

function prl1Scene3() {
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
}

/** verify から呼ぶ入口。env は verify 側の束縛（expect・patch） */
export function runPrLaneScenes1(env) {
  ({ expect, patch } = env);
  prl1Scene1();
  prl1Scene2();
  prl1Scene3();
}
