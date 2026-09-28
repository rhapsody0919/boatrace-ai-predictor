/**
 * verify-series-points-stage-rules.js — 得点率の「種別判定」の回帰テスト
 * （BOA-457 / BOA-458）。
 *
 * `src/components/race/seriesPoints.js` は `race_conditions.race_stage` の
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
  computeSeriesScore,
  forecastSeriesScore,
  listSeriesFinishes,
  pointsNeededForBorder,
  normalizeStage,
  SCORE_POINTS,
  SPECIAL_SCORE_POINTS,
  TOKUSEN_SCORE_POINTS,
} from "../../src/components/race/seriesPoints.js";
import { getRaceStageKey } from "../../src/constants/raceStageConfig.js";

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

// ---- 1. 配点区分 -----------------------------------------------------------
// 実データの表記（左）と、そのときの区分（右）。件数は棚卸しの「予選期間内」
const CLASSIFY_CASES = [
  // 勝ち上がり戦（算入しない）
  ["優勝戦", "excluded"],
  ["準優勝戦", "excluded"],
  ["準々優勝戦", "excluded"], // 実データ4件
  ["準優進出戦", "excluded"], // 実データ39件
  ["ツッキー優勝戦", "excluded"],
  ["団体・優勝戦", "excluded"],
  // ドリーム戦（12/10/9/7/6/5）。公式の得点率一覧と一致済み
  ["ドリーム戦", "dream"],
  ["ドリーム", "dream"],
  ["ドリームレース", "dream"],
  ["１ｓｔドリーム", "dream"],
  ["予選ドリーム戦", "dream"],
  // 「ＤＲ」はドリーム戦の略（全角。桐生・びわこ・津ほか多数）
  ["桐生ＤＲ戦女子", "dream"],
  ["ツッキーＤＲ戦", "dream"],
  ["プリンセスＤＲ", "dream"],
  ["三重選抜ＤＲ戦", "dream"], // 選抜とDRの両方を含む → ドリーム優先
  // 特選・特賞・選抜（11/9/7/5/3/2）
  ["予選特選", "tokusen"], // 予選期間内 1466件
  ["予選特賞", "tokusen"], // 予選期間内 2233件
  ["予選特選男子", "tokusen"],
  ["一般特選", "tokusen"],
  ["桐生特選", "tokusen"],
  ["戸田特賞", "tokusen"],
  ["ＢＴＳ名張特賞", "tokusen"],
  ["選抜戦", "tokusen"],
  ["記者選抜戦", "tokusen"], // 予選期間内 139件
  ["予選選抜", "tokusen"],
  ["特別選抜戦", "tokusen"],
  // 通常配点（会場固有のシリーズ名。特別配点と判定する根拠が無い）
  ["予選", "normal"],
  ["一般", "normal"],
  ["一般戦", "normal"],
  ["サンライズＸ戦", "normal"],
  ["ドラドキ３", "normal"], // 「ドリーム」でも「DR」でもない
  ["ドラドキ目玉", "normal"],
  ["ＤＤ目玉女子", "normal"],
  ["かけうどん６", "normal"],
  ["５ールドレース", "normal"],
  ["予選特別Ａ戦", "normal"], // 「特別」は加点しない（実測で改善しなかった）
  ["", "normal"],
  [null, "normal"],
];
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

// ---- 2. 算入範囲（予選の締め） ----------------------------------------------
// 若松G1（2026-09-22〜27）。4日目までが予選で、5日目に一般戦＋準優、
// 最終日に特別選抜戦＋優勝戦。予選の締めは4日目12R
const WAKAMATSU = [
  ...Array.from({ length: 11 }, (_, i) => ({
    race_id: `2026-09-22-20-${String(i + 1).padStart(2, "0")}`,
    race_stage: "予選",
  })),
  { race_id: "2026-09-22-20-12", race_stage: "ドリーム戦" },
  ...Array.from({ length: 12 }, (_, i) => ({
    race_id: `2026-09-25-20-${String(i + 1).padStart(2, "0")}`,
    race_stage: "予選",
  })),
  ...Array.from({ length: 8 }, (_, i) => ({
    race_id: `2026-09-26-20-${String(i + 1).padStart(2, "0")}`,
    race_stage: "一般戦",
  })),
  { race_id: "2026-09-26-20-09", race_stage: "準優勝戦" },
  { race_id: "2026-09-26-20-10", race_stage: "準優勝戦" },
  { race_id: "2026-09-26-20-11", race_stage: "準優勝戦" },
  { race_id: "2026-09-26-20-12", race_stage: "一般戦" },
  { race_id: "2026-09-27-20-10", race_stage: "特別選抜戦" },
  { race_id: "2026-09-27-20-12", race_stage: "優勝戦" },
];
const wakamatsuEnd = prelimEndRaceIdOf(WAKAMATSU);
check("若松G1の予選の締め", wakamatsuEnd, "2026-09-25-20-12");
check("若松G1の準優は3個＝18枠", semifinalRaceIdsOf(WAKAMATSU).length * 6, 18);
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

// 丸亀の一般戦（2026-03-02〜05）。1R〜5Rが「予選」で、6R以降は会場固有名。
// 予選の締めは2日目5Rだが、同じ日の6R〜10Rも番組上は予選なので算入する
// （旧実装では丸ごと落ちていた。BOA-457）
const MARUGAME = [
  ...[1, 2, 3, 4, 5].map((r) => ({
    race_id: `2026-03-03-15-${String(r).padStart(2, "0")}`,
    race_stage: "予選",
  })),
  { race_id: "2026-03-03-15-06", race_stage: "かけうどん６" },
  { race_id: "2026-03-03-15-09", race_stage: "ウチまる特賞" },
  { race_id: "2026-03-03-15-10", race_stage: "蒼月まるる特賞" },
  { race_id: "2026-03-03-15-11", race_stage: "一般選抜" },
  { race_id: "2026-03-03-15-12", race_stage: "一般選抜" },
  { race_id: "2026-03-04-15-01", race_stage: "一般" },
  { race_id: "2026-03-04-15-09", race_stage: "準優勝戦" },
];
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

// 蒲郡の一般戦。5日目に「準優進出戦」4個、6日目に「準優勝戦」3個。
// 準優の枠は18で、42（7個×6）ではない
const GAMAGORI = [
  { race_id: "2026-02-13-07-09", race_stage: "予選特賞" },
  { race_id: "2026-02-13-07-10", race_stage: "一般特賞" },
  { race_id: "2026-02-13-07-11", race_stage: "一般特選" },
  { race_id: "2026-02-14-07-08", race_stage: "準優進出戦" },
  { race_id: "2026-02-14-07-09", race_stage: "準優進出戦" },
  { race_id: "2026-02-14-07-10", race_stage: "準優進出戦" },
  { race_id: "2026-02-14-07-11", race_stage: "準優進出戦" },
  { race_id: "2026-02-15-07-09", race_stage: "準優勝戦" },
  { race_id: "2026-02-15-07-10", race_stage: "準優勝戦" },
  { race_id: "2026-02-15-07-11", race_stage: "準優勝戦" },
];
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

// ---- 3. 得点率の計算 -------------------------------------------------------
// ドリーム戦1着(12) + 予選2着(8) + 予選特選1着(11) = 31点 / 3走 = 10.33
const RECORDS = [
  {
    raceId: "2026-09-22-20-12",
    raceStage: "ドリーム戦",
    boatNumber: 1,
    rank1: 1,
    rank2: 2,
    rank3: 3,
    rank4: 4,
    rank5: 5,
    rank6: 6,
  },
  {
    raceId: "2026-09-23-20-05",
    raceStage: "予選",
    boatNumber: 2,
    rank1: 1,
    rank2: 2,
    rank3: 3,
    rank4: 4,
    rank5: 5,
    rank6: 6,
  },
  {
    raceId: "2026-09-25-20-11",
    raceStage: "予選特選",
    boatNumber: 3,
    rank1: 3,
    rank2: 2,
    rank3: 1,
    rank4: 4,
    rank5: 5,
    rank6: 6,
  },
  // 予選終了後の一般戦（算入しない）
  {
    raceId: "2026-09-26-20-01",
    raceStage: "一般戦",
    boatNumber: 1,
    rank1: 1,
    rank2: 2,
    rank3: 3,
    rank4: 4,
    rank5: 5,
    rank6: 6,
  },
];
const score = computeSeriesScore(RECORDS, {
  prelimEndRaceId: "2026-09-25-20-12",
});
check("得点（ドリーム12 + 予選8 + 特選11）", score.points, 31);
check("走数（予選終了後の一般戦を除く3走）", score.runs, 3);
check("得点率", Math.round(score.rate * 100) / 100, 10.33);
// 着順の並びは**算入したレースだけ**。得点率の隣に出すので、算入していない走を
// 混ぜると「着順が4つ並ぶのに3走」という食い違いになる（BOA-457）
check(
  "着順の並びは算入したレースだけ（予選終了後の一般戦を含めない）",
  listSeriesFinishes(RECORDS, { prelimEndRaceId: "2026-09-25-20-12" }),
  [1, 2, 1],
);

// 「届かず」の判定に使う上限は、残りレースの種別ごとの1着の点で出す。
// 予選配点の10点で決め打ちすると、ドリーム戦が残っている選手を取りこぼす
check(
  "必要得点の上限は残りレースの配点で決まる",
  [
    // 残り1走・必要11点。予選配点（上限10）では届かないが、ドリーム戦（12）なら届く
    pointsNeededForBorder({ points: 0, runs: 1 }, 5.5, 1),
    pointsNeededForBorder({ points: 0, runs: 1 }, 5.5, 1, 12),
  ],
  [
    { needed: 11, max: 10, reachable: false },
    { needed: 11, max: 12, reachable: true },
  ],
);

check(
  "早見はドリーム戦の日はドリーム配点で出す",
  forecastSeriesScore({ points: 31, runs: 3 }, "ドリーム戦")[0].rate,
  (31 + 12) / 4,
);
check(
  "早見は予選の日は予選配点で出す",
  forecastSeriesScore({ points: 31, runs: 3 }, "予選")[0].rate,
  (31 + 10) / 4,
);

// ---- 4. バッジ判定 ---------------------------------------------------------
check("バッジ: 優勝戦", getRaceStageKey("優勝戦"), "final");
check("バッジ: 会場名付きの優勝戦", getRaceStageKey("ツッキー優勝戦"), "final");
check("バッジ: 準優勝戦", getRaceStageKey("準優勝戦"), "semifinal");
check("バッジ: 準々優勝戦は山場でない", getRaceStageKey("準々優勝戦"), null);
check("バッジ: 準優進出戦は準優でない", getRaceStageKey("準優進出戦"), null);
check("バッジ: 予選", getRaceStageKey("予選"), null);

console.log(failures === 0 ? "\n全件パス" : `\n失敗 ${failures} 件`);
process.exit(failures === 0 ? 0 : 1);
