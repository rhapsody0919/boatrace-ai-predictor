import { readFileSync } from "node:fs";

import { CLASSIFY_CASES, GAMAGORI, MARUGAME, WAKAMATSU } from "./verifyData/series-points-stage-rules.js";
/**
 * verify-series-points-stage-rules.js — 得点率の「種別判定」の回帰テスト
 * （BOA-457 / BOA-458）。
 *
 * `src/pure/seriesPoints.js` は `race_conditions.race_stage` の
 * 部分一致で「算入するか」「配点はどれか」を決める。この列は racelist ページの
 * 表示文字列をほぼ生で保存しているため会場の自由記述が入り、2026-09-28 の
 * 棚卸し（`scripts/analysis/race-stage-inventory.mjs`）では **349種** あった。
 *
 * ここで使う文字列は**すべて本番DBに実在した値**で、判定が壊れたときに
 * 気づけるようにするのが目的。実Supabaseへは接続しないので tier=ci。
 * 公式の得点率一覧との突き合わせは `scripts/verification/verify-series-points-*.mjs`
 * （tier=manual、実DB接続が要る）が担う。
 */
import {
  classifyStage,
  scoreTableFor,
  countsForSeriesScore,
  isExcludedStage,
  isPastPrelimDay,
  prelimEndRaceIdOf,
  semifinalRaceIdsOf,
  semifinalSlotsOf,
  normalizeStage,
  SCORE_POINTS,
  SPECIAL_SCORE_POINTS,
  TOKUSEN_SCORE_POINTS,
  officialSeriesScore,
  readOfficialPenalty,
  meetRateHidden,
  meetRateBestCandidates,
  prelimOfficialAdjustments,
  parseOfficialPlacements,
  buildMeetRanking,
  groupExcludedRacers,
} from "../../src/pure/seriesPoints.js";







import {
  runSeriesPointsStageRulesScenes1,
  runSeriesPointsStageRulesScenes2,
} from "./verifyData/series-points-stage-rules-scenes-1.js";
import { runSeriesPointsStageRulesScenes3 } from "./verifyData/series-points-stage-rules-scenes-2.js";
import { runSeriesPointsStageRulesScenes4 } from "./verifyData/series-points-stage-rules-scenes-3.js";
import { runSeriesPointsStageRulesScenes5 } from "./verifyData/series-points-stage-rules-scenes-4.js";
import {
  runSeriesPointsStageRulesScenes6,
  runSeriesPointsStageRulesScenes7,
} from "./verifyData/series-points-stage-rules-scenes-5.js";

let failures = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`✅ ${label}`);
  } else {
    failures += 1;
    console.error(`❌ ${label}: expected ${e}, got ${a}`);
  }
}

// BOA-1053: 賞典除外の印と減点を分け、行を保持する。
for (const [penalty, excluded, deduct] of [
  [0, false, 0],
  [10, false, 10],
  [99, true, 0],
  [109, true, 10],
]) {
  check(`減点の読み方 ${penalty}`, readOfficialPenalty(penalty), {
    awardExcluded: excluded,
    deduct,
  });
}
{
  const row = {
    placements: "１２３４５６",
    total_points: 31,
    penalty_points: 109,
  };
  check("109は10点だけ引く", officialSeriesScore(row), {
    points: 21,
    runs: 6,
    rate: 3.5,
    finishes: [1, 2, 3, 4, 5, 6],
    awardExcluded: true,
  });
  for (const p of [5, 7, 10, 15, 99]) {
    const score = officialSeriesScore({
      ...row,
      total_points: 40,
      penalty_points: p,
    });
    check(
      `既存減点 ${p}`,
      [score.points, score.rate, score.awardExcluded],
      [40 - (p === 99 ? 0 : p), (40 - (p === 99 ? 0 : p)) / 6, p === 99],
    );
  }
  const entries = [1, 2, 3].map((racerId) => ({
    racerId,
    playerName: String(racerId),
  }));
  const officialByRacer = Object.fromEntries(
    entries.map(({ racerId }) => [
      racerId,
      {
        ...row,
        total_points: racerId === 1 ? 40 : racerId === 2 ? 31 : 12,
        penalty_points: 0,
      },
    ]),
  );
  const baseline = buildMeetRanking({ entries, officialByRacer });
  officialByRacer[2].penalty_points = 109;
  for (const withdrawnRacerIds of [[], [2]]) {
    const ranked = buildMeetRanking({
      entries,
      officialByRacer,
      withdrawnRacerIds,
    });
    const excluded = ranked.find((r) => r.racerId === 2);
    check(
      "賞典除外の行・着順・走数を保持",
      [
        ranked.length,
        excluded.rank,
        excluded.withdrawn,
        excluded.excludedReason,
        excluded.finishes,
        excluded.runs,
      ],
      [3, null, true, "awardExcluded", [1, 2, 3, 4, 5, 6], 6],
    );
    check(
      "下位の順位を詰める",
      ranked.find((r) => r.racerId === 3).rank,
      baseline.find((r) => r.racerId === 3).rank - 1,
    );
  }
  check(
    "前夜の減点も印を除く",
    prelimOfficialAdjustments(
      [109, 99, 10].map((penalty_points, racer_id) => ({
        racer_id,
        penalty_points,
      })),
      "2026-10-18",
      "2026-10-19",
    ).penaltyByRacer,
    { 0: 10, 2: 10 },
  );
  for (const excludedReason of [
    "officialWithdrawn",
    "awardExcluded",
    "flying",
    "withdrawn",
    null,
  ]) {
    check(
      `得点率を隠す ${excludedReason}`,
      meetRateHidden({ excludedReason }),
      ["officialWithdrawn", "awardExcluded"].includes(excludedReason),
    );
  }
  check(
    "賞典除外は金枠の候補外",
    meetRateBestCandidates([
      { boat: 2, row: { rate: 3.5, runs: 6, excludedReason: "awardExcluded" } },
    ])[0].value,
    null,
  );
}

for (const [stage, expected] of CLASSIFY_CASES) {
  check(
    `classifyStage(${JSON.stringify(stage)})`,
    classifyStage(stage),
    expected,
  );
}

check(
  "正規化（全角→半角・空白除去）",
  normalizeStage("桐生ＤＲ戦 女子"),
  "桐生DR戦女子",
);

check("ドリーム戦の配点", scoreTableFor("ドリーム戦"), SPECIAL_SCORE_POINTS);
check("予選特選の配点", scoreTableFor("予選特選"), TOKUSEN_SCORE_POINTS);
check("記者選抜戦の配点", scoreTableFor("記者選抜戦"), TOKUSEN_SCORE_POINTS);
check("予選の配点", scoreTableFor("予選"), SCORE_POINTS);
check("ドラドキ目玉の配点", scoreTableFor("ドラドキ目玉"), SCORE_POINTS);
check("特選配点は通常配点の各着+1", TOKUSEN_SCORE_POINTS, {
  1: SCORE_POINTS[1] + 1,
  2: SCORE_POINTS[2] + 1,
  3: SCORE_POINTS[3] + 1,
  4: SCORE_POINTS[4] + 1,
  5: SCORE_POINTS[5] + 1,
  6: SCORE_POINTS[6] + 1,
});
check(
  "isExcludedStage は勝ち上がり戦だけ",
  [
    isExcludedStage("準優勝戦"),
    isExcludedStage("準優進出戦"),
    isExcludedStage("特別選抜戦"),
    isExcludedStage("予選"),
  ],
  [true, true, false, false],
);

const wakamatsuEnd = prelimEndRaceIdOf(WAKAMATSU);
check("若松G1の予選の締め", wakamatsuEnd, "2026-09-25-20-12");
check("若松G1の準優は3個＝18枠", semifinalRaceIdsOf(WAKAMATSU).length * 6, 18);
check("若松G1の枠数（中止なし）", semifinalSlotsOf(WAKAMATSU), 18);
check(
  "若松G1: 初日のドリーム戦は算入する",
  countsForSeriesScore("ドリーム戦", "2026-09-22-20-12", wakamatsuEnd),
  true,
);
check(
  "若松G1: 5日目の一般戦は算入しない（PR #871 が直した本体）",
  countsForSeriesScore("一般戦", "2026-09-26-20-01", wakamatsuEnd),
  false,
);
check(
  "若松G1: 最終日の特別選抜戦は算入しない",
  countsForSeriesScore("特別選抜戦", "2026-09-27-20-10", wakamatsuEnd),
  false,
);

const marugameEnd = prelimEndRaceIdOf(MARUGAME);
check("丸亀一般戦の予選の締め", marugameEnd, "2026-03-03-15-05");
check(
  "丸亀: 予選ラベルの後でも同日の会場固有レースは算入する",
  [
    countsForSeriesScore("かけうどん６", "2026-03-03-15-06", marugameEnd),
    countsForSeriesScore("ウチまる特賞", "2026-03-03-15-09", marugameEnd),
    countsForSeriesScore("蒼月まるる特賞", "2026-03-03-15-10", marugameEnd),
  ],
  [true, true, true],
);
check(
  "丸亀: 同日でも「一般」と付くレースは算入しない",
  countsForSeriesScore("一般選抜", "2026-03-03-15-11", marugameEnd),
  false,
);
check(
  "丸亀: 翌日以降は算入しない",
  countsForSeriesScore("一般", "2026-03-04-15-01", marugameEnd),
  false,
);

check(
  "蒲郡: 準優進出戦を準優の枠に数えない",
  semifinalRaceIdsOf(GAMAGORI).length * 6,
  18,
);
const gamagoriEnd = prelimEndRaceIdOf(GAMAGORI);
check("蒲郡の予選の締め", gamagoriEnd, "2026-02-13-07-09");
check(
  "蒲郡: 最終予選日の「一般特選」「一般特賞」は算入しない",
  [
    countsForSeriesScore("一般特賞", "2026-02-13-07-10", gamagoriEnd),
    countsForSeriesScore("一般特選", "2026-02-13-07-11", gamagoriEnd),
  ],
  [false, false],
);

// 「一般」の除外は**予選ラベルの最終レースより後**にだけ効かせる。日単位で
// 落とすと、予選がまだ続いている日の「一般」まで落ちる（BOA-457のレビュー指摘）
check(
  "予選最終日より前の日の「一般」は落とさない",
  [
    countsForSeriesScore("一般戦", "2026-09-23-20-05", "2026-09-25-20-12"),
    countsForSeriesScore("一般特選", "2026-09-24-20-11", "2026-09-25-20-12"),
  ],
  [true, true],
);
check(
  "予選最終日でも「予選」ラベルの最終レースまでは無条件に算入する",
  countsForSeriesScore("一般特選", "2026-02-13-07-08", "2026-02-13-07-09"),
  true,
);

check(
  "予選ラベルが1本も無い節は算入範囲を切らない",
  [
    prelimEndRaceIdOf([
      { race_id: "2026-05-01-09-01", race_stage: "５ールドレース" },
    ]),
    countsForSeriesScore("５ールドレース", "2026-05-01-09-01", null),
  ],
  [null, true],
);
check(
  "isPastPrelimDay は日単位",
  [
    isPastPrelimDay("2026-09-25-20-01", "2026-09-25-20-12"),
    isPastPrelimDay("2026-09-26-20-01", "2026-09-25-20-12"),
    isPastPrelimDay("2026-09-26-20-01", null),
  ],
  [false, true, false],
);

// ---- 後半の場面（verifyData/series-points-stage-rules-scenes-1.js） ----
runSeriesPointsStageRulesScenes1({ check });

// 3b で見る画面の本文（RaceMeetTab.jsx の字）。本文を fs で読む文は verify に残す
const meetTabSource = readFileSync(
  new URL("../../src/components/race/RaceMeetTab.jsx", import.meta.url),
  "utf8",
);

// ---- 後半の場面（verifyData/series-points-stage-rules-scenes-1.js） ----
await runSeriesPointsStageRulesScenes2({ check, meetTabSource });

// ---- 6. 公式の得点率一覧の読み替え（BOA-475） --------------------------------
// 公式の得点率は (着順点 − 減点) ÷ 走数。走数の列は無いが `placements` の
// 文字数から出せる（収録済み101行で検算し、得点率のある94行すべてで一致）
{
  check(
    "placements を着順の配列にする（全角空白は日の区切りなので落とす）",
    parseOfficialPlacements("３２１　４５２"),
    [3, 2, 1, 4, 5, 2],
  );
  check(
    // 以前は null（画面は「失」）にしていたが、推移の点の下・日別の表と表記を
    // そろえるため記号のまま返す（BOA-537 ファン評価）
    "着順が付いていない走（妨・落）は公式の記号のまま返す",
    parseOfficialPlacements("２２落"),
    [2, 2, "落"],
  );
  check("placements が無ければ空", parseOfficialPlacements(null), []);

  // 多摩川G1の岩瀬裕亮。公式は 得点38・減点10・6走・得点率4.67
  check(
    "減点を引いた得点率になる（岩瀬裕亮・多摩川G1）",
    officialSeriesScore({
      placements: "３２１　４５２",
      total_points: 38,
      penalty_points: 10,
    }),
    {
      points: 28,
      runs: 6,
      rate: 28 / 6,
      finishes: [3, 2, 1, 4, 5, 2],
      awardExcluded: false,
    },
  );
  // 若松G1の吉田裕平。減点99は賞典除外の印で、引くと得点が負になる
  check(
    "減点99（賞典除外の印）は引かない",
    officialSeriesScore({
      placements: "２　３３２１妨",
      total_points: 40,
      penalty_points: 99,
    })?.points,
    40,
  );
  check(
    "減点が無ければ着順点のまま",
    officialSeriesScore({
      placements: "１２３",
      total_points: 24,
      penalty_points: 0,
    }),
    { points: 24, runs: 3, rate: 8, finishes: [1, 2, 3], awardExcluded: false },
  );
  check(
    "得点が無い行は読み替えない",
    officialSeriesScore({ placements: "１２３", total_points: null }),
    null,
  );
  check("行が無ければ null", officialSeriesScore(null), null);
}

// ---- 後半の場面（verifyData/series-points-stage-rules-scenes-2.js・series-points-stage-rules-scenes-3.js・series-points-stage-rules-scenes-4.js・series-points-stage-rules-scenes-5.js） ----
runSeriesPointsStageRulesScenes3({ check });
runSeriesPointsStageRulesScenes4({ check });
runSeriesPointsStageRulesScenes5({ check });
runSeriesPointsStageRulesScenes6({ check });

// 順位の対象外の内訳は理由ごとに、今節F → 賞典除外 → 途中帰郷 → 欠場 の順でまとめる。
// 公式の備考による途中帰郷も「途中帰郷」に入れ、順位の付いた選手は入れない（BOA-697）
{
  const groups = groupExcludedRacers(
    [
      {
        racerId: 1,
        playerName: "山田　太郎",
        withdrawn: false,
        excludedReason: null,
      },
      {
        racerId: 2,
        playerName: "鈴木一郎",
        withdrawn: true,
        excludedReason: "withdrawn",
      },
      {
        racerId: 3,
        playerName: "佐藤花子",
        withdrawn: true,
        excludedReason: "flying",
      },
      {
        racerId: 4,
        playerName: "高橋",
        withdrawn: true,
        excludedReason: "officialWithdrawn",
      },
      {
        racerId: 5,
        playerName: "田中",
        withdrawn: true,
        excludedReason: "awardExcluded",
      },
    ],
    [{ racerId: 6, playerName: "伊藤" }],
  );
  check("理由ごとにまとめ、順位の付いた選手を入れない", groups, [
    { reason: "flying", names: ["佐藤花子"] },
    { reason: "awardExcluded", names: ["田中"] },
    { reason: "withdrawn", names: ["鈴木一郎", "高橋"] },
    { reason: "absent", names: ["伊藤"] },
  ]);
  check("対象外が居なければ空", groupExcludedRacers([], []), []);
}

// ---- 後半の場面（verifyData/series-points-stage-rules-scenes-5.js） ----
runSeriesPointsStageRulesScenes7({ check });

console.log(failures === 0 ? "\n全件パス" : `\n失敗 ${failures} 件`);
process.exit(failures === 0 ? 0 : 1);
