import { readFileSync } from "node:fs";
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
  prelimEndDayOf,
  noRaceDaysOf,
  semifinalRaceIdsOf,
  semifinalSlotsOf,
  splitMeetSeries,
  computeSeriesScore,
  forecastSeriesScore,
  listSeriesFinishes,
  pointsNeededForBorder,
  normalizeStage,
  SCORE_POINTS,
  SPECIAL_SCORE_POINTS,
  TOKUSEN_SCORE_POINTS,
  officialSeriesScore,
  shouldUseOfficialSeries,
  parseOfficialPlacements,
  buildMeetRanking,
  listAbsentOnlyRacers,
  FINISH_ABSENT,
  isAbsentStartRow,
  flyingRacerIdsInMeet,
  runFinishLabel,
  officialMarkOf,
} from "../../src/components/race/seriesPoints.js";
import { getRaceStageKey } from "../../src/constants/raceStageConfig.js";
import {
  dayCenter,
  dayTickLabels,
  layoutTrendByDate,
} from "../../src/utils/trendDateLayout.js";
import { buildMeets, fetchAllByRaceId } from "../lib/meetBoundaries.js";

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

// ---- 3b. 欠場（不出走）と失格・落水の区別（BOA-489） --------------------------
// 着順に載らない走は2種類ある。失格・落水は「0点だが1走」、欠場は「走数にも
// 入れない」。区別は `started`（本番STの記録があるか）で行う
{
  const base = {
    raceStage: "予選",
    rank1: 1,
    rank2: 2,
    rank3: 3,
    rank4: 4,
    rank5: 5,
    rank6: null, // 6艇目が着順に載っていない（失格・落水 or 欠場）
  };
  const withPrelim = { prelimEndRaceId: "2026-09-25-20-12" };
  // 走ったが着順が付かない（STの記録がある）: 0点・1走
  const disqualified = computeSeriesScore(
    [{ ...base, raceId: "2026-09-23-20-01", boatNumber: 6, started: true }],
    withPrelim,
  );
  check("失格・落水は0点だが1走に数える", disqualified, {
    points: 0,
    runs: 1,
    rate: 0,
  });
  // 走っていない（STの記録が無い）: 走数にも入れない
  const absent = computeSeriesScore(
    [{ ...base, raceId: "2026-09-23-20-01", boatNumber: 6, started: false }],
    withPrelim,
  );
  check("欠場は走数にも入れない", absent, { points: 0, runs: 0, rate: null });
  // 並びには「欠」として残す。外すと欠場したこと自体が画面から消える（BOA-504）
  check(
    "欠場は着順の並びに FINISH_ABSENT で出す（失格とは区別）",
    listSeriesFinishes(
      [{ ...base, raceId: "2026-09-23-20-01", boatNumber: 6, started: false }],
      withPrelim,
    ),
    [FINISH_ABSENT],
  );
  check(
    "失格・落水は着順の並びに null で出す",
    listSeriesFinishes(
      [{ ...base, raceId: "2026-09-23-20-01", boatNumber: 6, started: true }],
      withPrelim,
    ),
    [null],
  );
  // `started` が付いていない行は従来どおり数える（旧来の呼び出し・ST未取得）
  const unknown = computeSeriesScore(
    [{ ...base, raceId: "2026-09-23-20-01", boatNumber: 6 }],
    withPrelim,
  );
  check("started が無い行は従来どおり1走に数える", unknown.runs, 1);
  // 着順が付いている走は `started` を見ない（着順に載る＝走っている）
  const finished = computeSeriesScore(
    [{ ...base, raceId: "2026-09-23-20-01", boatNumber: 1, started: false }],
    withPrelim,
  );
  check("着順が付いていれば started=false でも数える", finished, {
    points: 10,
    runs: 1,
    rate: 10,
  });

  // ---- 3c. 全走欠場の選手が比較表から消えない（BOA-504） ----
  // 2026-06-13 浜名湖12Rの2号艇（中岡正彦）は今節の走が全て欠場で、走数0の
  // ため順位表に載らず、6艇の比較表から黙って消えていた
  const board = {
    prelimEndRaceId: "2026-09-25-20-12",
    entries: [
      // 走った選手（1着）
      {
        ...base,
        raceId: "2026-09-23-20-01",
        boatNumber: 1,
        racerId: 1001,
        playerName: "走者",
        started: true,
      },
      // 全走欠場の選手（2走とも欠場）
      {
        ...base,
        raceId: "2026-09-23-20-01",
        boatNumber: 6,
        racerId: 2002,
        playerName: "欠場者",
        started: false,
      },
      {
        ...base,
        raceId: "2026-09-23-20-05",
        boatNumber: 6,
        racerId: 2002,
        playerName: "欠場者",
        started: false,
      },
      // 1走は欠場・1走は走った選手（全走欠場ではない）
      {
        ...base,
        raceId: "2026-09-23-20-02",
        boatNumber: 6,
        racerId: 3003,
        playerName: "混在",
        started: false,
      },
      {
        ...base,
        raceId: "2026-09-23-20-06",
        boatNumber: 1,
        racerId: 3003,
        playerName: "混在",
        started: true,
      },
      // まだ結果が無い走しかない選手（欠場ではない）
      {
        raceStage: "予選",
        raceId: "2026-09-23-20-12",
        boatNumber: 6,
        racerId: 4004,
        playerName: "未走",
        rank1: null,
        started: false,
      },
    ],
  };
  check(
    "全走欠場の選手だけを返す（走った選手・一部欠場・未走は含めない）",
    listAbsentOnlyRacers(board).map((r) => [r.racerId, r.finishes]),
    [[2002, [FINISH_ABSENT, FINISH_ABSENT]]],
  );
  check(
    "全走欠場の選手は順位表には載らない（走数0で得点率が出ない）",
    buildMeetRanking(board)
      .map((r) => r.racerId)
      .sort(),
    [1001, 3003],
  );
  check(
    "一部欠場の選手の並びは欠場の位置も残す",
    buildMeetRanking(board).find((r) => r.racerId === 3003).finishes,
    [FINISH_ABSENT, 1],
  );
  // 本番STの行は欠場の艇にもあり、finish_mark が「欠」（2026-06-05 芦屋7R の
  // 久永祥平・2026-06-20 尼崎12R の谷津幸宏で、一部欠場が「失」・分母入りになっていた）
  check(
    "本番STの行が「欠」なら欠場、出遅れ「L」やST付きの行は出走",
    [
      isAbsentStartRow({ start_timing: null, finish_mark: "欠" }),
      isAbsentStartRow({ start_timing: null, finish_mark: "L" }),
      isAbsentStartRow({ start_timing: 0.15, finish_mark: null }),
      isAbsentStartRow(null),
    ],
    [true, false, false, false],
  );
  {
    const service = readFileSync(
      new URL("../../src/services/supabaseDataService.js", import.meta.url),
      "utf8",
    );
    check(
      "今節の出走判定は、本番STの「欠」の行を出走に数えない",
      /\.filter\(\(r\) => !isAbsentStartRow\(r\)\)\s*\.map\(\(r\) => `\$\{r\.race_id\}\|\$\{r\.boat_number\}`\)/.test(
        service,
      ) &&
        /select\("race_id, boat_number, start_timing, is_flying, finish_mark"\)/.test(
          service,
        ),
      true,
    );
    // 本番STの行そのものが無い欠場（他艇の行はある）も、履歴で「欠場」と出す
    // （2026-06-13 浜名湖5R・12R の中岡正彦が「着外(順位不明)」になっていた）
    check(
      "選手の履歴は、本番STの行が無い欠場も欠場として扱う",
      /absent:\s*isAbsentStartRow\(st\) \|\|\s*\(!st && stRowsByRace\.has\(entry\.race_id\)\)/.test(
        service,
      ),
      true,
    );
    const meetTab = readFileSync(
      new URL("../../src/components/race/RaceMeetTab.jsx", import.meta.url),
      "utf8",
    );
    check(
      "全走欠場の選手を選んだ詳細に欠場の見出し、「欠」があれば意味の注記を出す",
      meetTab.includes('t("meetTab.absentDetail")') &&
        /r\.finishes\.includes\(FINISH_ABSENT\)[\s\S]{0,80}t\("meetTab\.finishAbsentNote"\)/.test(
          meetTab,
        ),
      true,
    );
  }
  // 推移の点の下に出す着順（BOA-537）。数字・F・欠・公式の記号。推測で「失」と書かない
  {
    const res = {
      rank1: 3,
      rank2: 1,
      rank3: 6,
      rank4: 2,
      rank5: 4,
      rank6: null,
    };
    check(
      "runFinishLabel: 着順・F・欠・公式の記号・未実施",
      [
        runFinishLabel(res, 1, { start_timing: 0.12 }, true),
        runFinishLabel(res, 5, { start_timing: 0.2, is_flying: true }, true),
        runFinishLabel(res, 5, { start_timing: null, finish_mark: "欠" }, true),
        runFinishLabel(res, 5, null, true),
        runFinishLabel(res, 5, { start_timing: 0.18, finish_mark: "転" }, true),
        runFinishLabel(res, 5, { start_timing: 0.18, finish_mark: null }, true),
        runFinishLabel(null, 1, null, false),
      ],
      [2, "F", "欠", "欠", "転", null, null],
    );
  }
  // 着順が付かない走は、比較表の並び・推移・日別の表で同じ公式の記号を出す（BOA-537）
  check(
    "officialMarkOf: 記号だけを返す（数字・空・null は記号でない）",
    [
      officialMarkOf("落"),
      officialMarkOf("転"),
      officialMarkOf("3"),
      officialMarkOf(""),
      officialMarkOf(null),
    ],
    ["落", "転", null, null, null],
  );
  check(
    "着順の並び: 着順の無い走は公式の記号（無ければ null＝画面は「失」）",
    listSeriesFinishes(
      [
        {
          ...base,
          raceId: "2026-09-23-20-01",
          boatNumber: 6,
          started: true,
          finishMark: "落",
        },
        { ...base, raceId: "2026-09-23-20-02", boatNumber: 6, started: true },
      ],
      withPrelim,
    ),
    ["落", null],
  );
  check(
    "着順の並び: 着欄の記号が未取得でも、フライングの走は「失」ではなく F（推移の点と同じ。BOA-589）",
    listSeriesFinishes(
      [
        {
          ...base,
          raceId: "2026-09-23-20-03",
          boatNumber: 6,
          started: true,
          isFlying: true,
        },
      ],
      withPrelim,
    ),
    ["F"],
  );
  // 6艇の推移の横軸を日付にする配置（BOA-538）
  {
    const days = ["2026-09-20", "2026-09-21", "2026-09-22", "2026-09-23"];
    const a = layoutTrendByDate(
      [
        { date: "2026-09-20" },
        { date: "2026-09-21" },
        { date: "2026-09-21" },
        { date: "2026-09-23" },
      ],
      days,
    );
    check(
      "日付の横軸: 日の位置に置き、1日2走は左右にずらし、走らない日をまたぐと線を切る",
      [
        Math.abs(a.xs[0] - dayCenter(0, 4)) < 1e-9,
        a.xs[1] < dayCenter(1, 4) && a.xs[2] > dayCenter(1, 4),
        Math.abs((a.xs[1] + a.xs[2]) / 2 - dayCenter(1, 4)) < 1e-9,
        Math.abs(a.xs[3] - dayCenter(3, 4)) < 1e-9,
        a.breakBefore,
      ],
      [true, true, true, true, [false, false, false, true]],
    );
    const one = layoutTrendByDate([{ date: "2026-09-20" }], ["2026-09-20"]);
    check("日付の横軸: 節の日が1日だけなら中央", one.xs, [0.5]);
    // 2走が続く行でも、同じ日の2点は日をまたぐ間より近い（等間隔に見えない。ファン評価）
    const pairs = layoutTrendByDate(
      ["2026-09-23", "2026-09-23", "2026-09-24", "2026-09-24"].map((date) => ({
        date,
      })),
      ["2026-09-23", "2026-09-24", "2026-09-25"],
    );
    check(
      "日付の横軸: 各走の日の位置（centers）を返し、同じ日の2走は同じ位置",
      [
        pairs.centers[0] === pairs.centers[1],
        pairs.centers[2] === pairs.centers[3],
      ],
      [true, true],
    );
    check(
      "日付の横軸: 同じ日の2点は、日をまたぐ間隔より近い",
      pairs.xs[1] - pairs.xs[0] < pairs.xs[2] - pairs.xs[1],
      true,
    );
    const oneDay = layoutTrendByDate(
      [{ date: "2026-09-20" }, { date: "2026-09-20" }],
      ["2026-09-20"],
    );
    check(
      "日付の横軸: 1日だけの節の2走は中央の近くに寄る（全幅の2割）",
      Math.abs(oneDay.xs[1] - oneDay.xs[0] - 0.2) < 1e-9,
      true,
    );
    check(
      "日付の目盛り: 最初の日と月が変わった日だけ「月/日」、ほかは日だけ",
      dayTickLabels([
        "2026-09-28",
        "2026-09-29",
        "2026-09-30",
        "2026-10-01",
        "2026-10-02",
      ]),
      ["9/28", "29", "30", "10/1", "2"],
    );
    // 端の日の2走も、ずらした両方が 0〜1 の中に収まる（端で潰れて重ならない）
    const edge = layoutTrendByDate(
      [
        { date: "2026-09-20" },
        { date: "2026-09-20" },
        { date: "2026-09-25" },
        { date: "2026-09-25" },
      ],
      [
        "2026-09-20",
        "2026-09-21",
        "2026-09-22",
        "2026-09-23",
        "2026-09-24",
        "2026-09-25",
      ],
    );
    check(
      "日付の横軸: 端の日の2走も同じ幅でずれ、0〜1に収まる",
      edge.xs.every((v) => v >= 0 && v <= 1) &&
        Math.abs(edge.xs[1] - edge.xs[0] - (edge.xs[3] - edge.xs[2])) < 1e-9 &&
        edge.xs[1] - edge.xs[0] > 0.05,
      true,
    );
  }
  check(
    "男女Ｗ優勝戦の節では別シリーズの全走欠場者を返さない",
    listAbsentOnlyRacers({ ...board, seriesRacerIds: [1001, 3003] }),
    [],
  );
}

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

// ---- 5. 全件取得のページング -----------------------------------------------
// `race_entries` は1レース6行で `race_id` が一意でない。ページの境目が同じ
// `race_id` の途中に落ちたときに行を取りこぼさないこと（BOA-457のレビュー指摘）
{
  // 1レース6行 × 10レースの擬似テーブル。ページサイズ8（6の倍数でない）だと
  // 必ず境目がレースの途中に落ちる。本番も1000行 ÷ 6行/レース で同じことが起きる
  const rows = [];
  for (let r = 1; r <= 10; r += 1) {
    for (let b = 1; b <= 6; b += 1) {
      rows.push({
        race_id: `2026-01-01-01-${String(r).padStart(2, "0")}`,
        boat_number: b,
      });
    }
  }
  const fake = {
    from: () => {
      let cursor = "";
      let limit = Infinity;
      const chain = {
        select: () => chain,
        gt: (_col, v) => {
          cursor = v;
          return chain;
        },
        order: () => chain,
        limit: (n) => {
          limit = n;
          return chain;
        },
        then: (res) =>
          Promise.resolve({
            data: rows.filter((r) => r.race_id > cursor).slice(0, limit),
            error: null,
          }).then(res),
      };
      return chain;
    },
  };
  const fetched = await fetchAllByRaceId(fake, "race_entries", "race_id", {
    pageSize: 8,
  });
  check(
    "ページの境目がレースの途中でも全行取れる",
    fetched.length,
    rows.length,
  );
  check(
    "取りこぼしたレースが無い",
    new Set(fetched.map((r) => r.race_id)).size,
    10,
  );
  check(
    "重複して取っていない",
    new Set(fetched.map((r) => `${r.race_id}-${r.boat_number}`)).size,
    rows.length,
  );
  // 1レースが1ページに収まらないときは、黙って取りこぼさず落とす
  let threw = null;
  try {
    await fetchAllByRaceId(fake, "race_entries", "race_id", { pageSize: 4 });
  } catch (e) {
    threw = e.message.includes("ページングできない");
  }
  check("1レースがページに収まらないときは例外で落とす", threw, true);
}

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
    { points: 28, runs: 6, rate: 28 / 6, finishes: [3, 2, 1, 4, 5, 2] },
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
    { points: 24, runs: 3, rate: 8, finishes: [1, 2, 3] },
  );
  check(
    "得点が無い行は読み替えない",
    officialSeriesScore({ placements: "１２３", total_points: null }),
    null,
  );
  check("行が無ければ null", officialSeriesScore(null), null);
}

// ---- 7. 公式値を使うと順位が変わる（BOA-475） --------------------------------
// 減点を持つ選手が過大な得点率のまま上位に残ると、その下の全員の順位がズレる
{
  // `rank{n}` は「n着だった艇番」。艇番1が1着なら rank1=1
  const entry = (racerId, raceId, boatNumber, rank1, rank2 = null) => ({
    racerId,
    playerName: `選手${racerId}`,
    raceId,
    raceStage: "予選",
    boatNumber,
    rank1,
    rank2,
    rank3: null,
    rank4: null,
    rank5: null,
    rank6: null,
  });
  // A(1着) / B(1着) / C(2着) の3人。Bだけ公式で減点10が付いている
  const board = {
    prelimEndRaceId: "2026-09-19-05-12",
    entries: [
      entry(1, "2026-09-16-05-01", 1, 1),
      entry(2, "2026-09-16-05-02", 1, 1),
      // 艇番2の選手が2着（1着は艇番1）
      entry(3, "2026-09-16-05-03", 2, 1, 2),
    ],
  };
  const own = buildMeetRanking(board);
  check(
    "公式行が無ければ当社計算（1着10点の2人が同率1位）",
    own.map((r) => [r.racerId, r.rank, r.points, r.fromOfficial]),
    [
      [1, 1, 10, false],
      [2, 1, 10, false],
      [3, 3, 8, false],
    ],
  );

  const withOfficial = buildMeetRanking({
    ...board,
    officialByRacer: {
      1: { placements: "１", total_points: 10, penalty_points: 0 },
      2: { placements: "１", total_points: 10, penalty_points: 10 },
      3: { placements: "２", total_points: 8, penalty_points: 0 },
    },
  });
  check(
    "公式行があれば減点込みで並び替わる（減点10のBが最下位へ）",
    withOfficial.map((r) => [r.racerId, r.rank, r.points, r.fromOfficial]),
    [
      [1, 1, 10, true],
      [3, 2, 8, true],
      [2, 3, 0, true],
    ],
  );
  check(
    "着順の並びも公式の placements から出す",
    withOfficial.find((r) => r.racerId === 3).finishes,
    [2],
  );

  // 公式に行が無い選手（予選終了後に乗り込んだ等）は当社計算に戻る
  const mixed = buildMeetRanking({
    ...board,
    officialByRacer: {
      1: { placements: "１", total_points: 10, penalty_points: 0 },
    },
  });
  check(
    "公式に行が無い選手は当社計算のまま（fromOfficial=false）",
    mixed.map((r) => [r.racerId, r.fromOfficial]),
    [
      [1, true],
      [2, false],
      [3, false],
    ],
  );
}

// ---- 8. 公式値を使うかのゲート（BOA-475） ------------------------------------
// **今回いちばんリスクのある判断**。公式の行は「予選終了時点」のスナップショット
// なので、予選中のレースを開いているときに使うと、まだ走っていない走を含む
// 得点率・順位が出る（実測: 予選2日目で最大47名の走数がズレる）
{
  const END = "2026-09-19-05-12"; // 多摩川G1の予選最終レース
  check(
    "予選の初日は使わない",
    shouldUseOfficialSeries("予選", "2026-09-16-05-01", END),
    false,
  );
  check(
    "予選最終日でも、予選の途中なら使わない",
    shouldUseOfficialSeries("予選", "2026-09-19-05-06", END),
    false,
  );
  check(
    "予選の最終レース自体でも使わない（そのレースの結果はまだ出ていない）",
    shouldUseOfficialSeries("予選", END, END),
    false,
  );
  check(
    "予選が終わった翌日から使う",
    shouldUseOfficialSeries("一般", "2026-09-20-05-01", END),
    true,
  );
  check(
    "準優・優勝戦でも使う",
    [
      shouldUseOfficialSeries("準優勝戦", "2026-09-20-05-10", END),
      shouldUseOfficialSeries("優勝戦", "2026-09-21-05-12", END),
    ],
    [true, true],
  );
  check(
    "予選の締めが分からない節（予選ラベルが無い）では使わない",
    shouldUseOfficialSeries("５ールドレース", "2026-05-01-09-05", null),
    false,
  );
  check(
    "表示中レースの種別が取れなくても、予選最終日までなら使わない",
    shouldUseOfficialSeries(null, "2026-09-18-05-03", END),
    false,
  );
}

// ---- 中止順延で番組に2日ぶん残る準優（BOA-490） -------------------------------
// 江戸川 2026-05-25開催の実データ。5/29の11R・12Rが中止（`races.cancellation_status`
// が `confirmed`、結果なし）で、5/30に同じ6名ずつで再編成された。
// 単純に数えると 4個 = 24枠だが、実際は12枠。枠数はボーダー（準優の目安）と
// 必要得点の基準なので、倍になると「届かず」の判定まで狂う
const EDOGAWA_POSTPONED = [
  { race_id: "2026-05-29-03-11", race_stage: "準優勝戦" },
  { race_id: "2026-05-29-03-12", race_stage: "準優勝戦" },
  { race_id: "2026-05-30-03-11", race_stage: "準優勝戦" },
  { race_id: "2026-05-30-03-12", race_stage: "準優勝戦" },
];
check(
  "中止フラグを渡さなければ従来どおり全部数える",
  semifinalSlotsOf(EDOGAWA_POSTPONED),
  24,
);
check(
  "中止で流れた準優は枠数から外す（江戸川 2026-05-25開催）",
  semifinalSlotsOf(EDOGAWA_POSTPONED, {
    cancelledRaceIds: ["2026-05-29-03-11", "2026-05-29-03-12"],
    ranRaceIds: ["2026-05-30-03-11", "2026-05-30-03-12"],
  }),
  12,
);
// 津・びわこ 2026-04-30開催は3個ずつ。36枠 → 18枠
check(
  "3個が2日ぶん残る場合も半分になる（津・びわこ 2026-04-30開催）",
  semifinalSlotsOf(
    [
      ...["10", "11", "12"].map((r) => ({
        race_id: `2026-05-04-09-${r}`,
        race_stage: "準優勝戦",
      })),
      ...["10", "11", "12"].map((r) => ({
        race_id: `2026-05-05-09-${r}`,
        race_stage: "準優勝戦",
      })),
    ],
    {
      cancelledRaceIds: [
        "2026-05-04-09-10",
        "2026-05-04-09-11",
        "2026-05-04-09-12",
      ],
      ranRaceIds: ["2026-05-05-09-10", "2026-05-05-09-11", "2026-05-05-09-12"],
    },
  ),
  18,
);
// **予選中は準優にまだ結果が無い**。「結果が無い準優を落とす」だけにすると、
// 枠数をいちばん知りたい場面で全部落ちてしまう。中止フラグとの AND にしてある
check(
  "予選中（準優にまだ結果が無い）は枠数を減らさない",
  semifinalSlotsOf(
    [
      { race_id: "2026-09-26-20-09", race_stage: "準優勝戦" },
      { race_id: "2026-09-26-20-10", race_stage: "準優勝戦" },
      { race_id: "2026-09-26-20-11", race_stage: "準優勝戦" },
    ],
    { cancelledRaceIds: [], ranRaceIds: [] },
  ),
  18,
);
// 中止フラグの誤検出（`confirmed` なのに実際は行われて結果がある）が32本ある
// （すべて2026-09-12の各会場1R〜3R。BOA-512）。準優には1本も無いが、
// 「結果が無い」も要求しておけば誤って枠を減らすことが原理的に起きない
check(
  "中止フラグが立っていても結果があれば数える（フラグの誤検出への保険）",
  semifinalSlotsOf(
    [
      { race_id: "2026-09-26-20-09", race_stage: "準優勝戦" },
      { race_id: "2026-09-26-20-10", race_stage: "準優勝戦" },
      { race_id: "2026-09-26-20-11", race_stage: "準優勝戦" },
    ],
    {
      cancelledRaceIds: ["2026-09-26-20-09"],
      ranRaceIds: ["2026-09-26-20-09", "2026-09-26-20-10", "2026-09-26-20-11"],
    },
  ),
  18,
);
// 準優が1本も行われずに優勝戦へ進んだ節（桐生 2026-02-24開催、下関 2026-03-26開催）。
// null を返し、画面は既定の18枠に落ちる
// 準優が1本も行われずに優勝戦へ進んだ節（桐生 2026-02-24開催、下関 2026-03-26開催）。
// 全滅なので番組どおりの3本＝18枠に戻る（慣例どおりの値で、表示も変わらない）
check(
  "準優が全部中止でも番組どおりの18枠（枠数が消えるよりまし）",
  semifinalSlotsOf(
    [
      { race_id: "2026-02-28-01-09", race_stage: "準優勝戦" },
      { race_id: "2026-02-28-01-10", race_stage: "準優勝戦" },
      { race_id: "2026-02-28-01-11", race_stage: "準優勝戦" },
    ],
    {
      cancelledRaceIds: [
        "2026-02-28-01-09",
        "2026-02-28-01-10",
        "2026-02-28-01-11",
      ],
      ranRaceIds: [],
    },
  ),
  18,
);
// **中止の除外で準優が全滅したら、番組どおりの本数に戻す**（2026-09-28の
// データ精度検証の指摘）。呼び出し側（`getMeetScoreboard`）が持つ番組は
// `.lte("race_id", "${date}-zz")` で**表示日まで**なので、準優が中止された
// 当日を開くと、振替（翌日）がまだ窓に入っていない。引き算だけだと0になり
// 画面が既定の18枠に落ちるが、正解は番組に出ている2本ぶんの12枠
check(
  "中止された当日を開いた場合（振替がまだ窓に無い）は番組どおりの本数",
  semifinalSlotsOf(
    [
      { race_id: "2026-05-29-03-11", race_stage: "準優勝戦" },
      { race_id: "2026-05-29-03-12", race_stage: "準優勝戦" },
    ],
    {
      cancelledRaceIds: ["2026-05-29-03-11", "2026-05-29-03-12"],
      ranRaceIds: [],
    },
  ),
  12,
);
// 翌日（振替が窓に入った状態）を開けば、中止ぶんを引いて同じ12枠になる。
// **どちらの日を開いても同じ値**になるのが、この規則のねらい
check(
  "翌日（振替が窓に入った）を開いても同じ12枠",
  semifinalSlotsOf(EDOGAWA_POSTPONED, {
    cancelledRaceIds: ["2026-05-29-03-11", "2026-05-29-03-12"],
    ranRaceIds: ["2026-05-30-03-11", "2026-05-30-03-12"],
  }),
  12,
);
check("準優が1本も無ければ null", semifinalSlotsOf([]), null);
check("配列でなければ null", semifinalSlotsOf(null), null);
// `Set` でも配列でも受ける（呼び出し側の形に合わせない）
check(
  "cancelledRaceIds に Set を渡しても同じ",
  semifinalSlotsOf(EDOGAWA_POSTPONED, {
    cancelledRaceIds: new Set(["2026-05-29-03-11", "2026-05-29-03-12"]),
    ranRaceIds: new Set(["2026-05-30-03-11", "2026-05-30-03-12"]),
  }),
  12,
);
// 準優進出戦は準優の枠ではない（PR #887）。中止判定を足しても変わらない
check(
  "準優進出戦は中止判定を足しても枠に数えない",
  semifinalSlotsOf(
    [
      { race_id: "2026-05-29-03-09", race_stage: "準優進出戦" },
      { race_id: "2026-05-29-03-10", race_stage: "準優進出戦" },
      { race_id: "2026-05-30-03-11", race_stage: "準優勝戦" },
      { race_id: "2026-05-30-03-12", race_stage: "準優勝戦" },
    ],
    { cancelledRaceIds: [], ranRaceIds: ["2026-05-30-03-11"] },
  ),
  12,
);

// ---- 男女Ｗ優勝戦の節を2シリーズに分ける（BOA-511／BOA-476） -------------------
// 1つの節に独立した2シリーズが同居する開催が全期間で6節ある。混ぜて順位を振ると
// 節内順位・出場人数・準優の目安が実際の勝ち上がり争いとズレる。
//
// 検出は `race_title` の「Ｗ優勝戦」、切り分けは「同じレースを走った選手」の
// 連結成分。**繋ぐのは得点率に算入するレースだけ**で、これが無いと多摩川が割れない。
//
// 下の並びは**桐生 2026-09-20開催の実データを縮めたもの**。桐生は6節で唯一
// `race_stage` に男女の接尾を持ち、切り分けの正解として使える。実測では
// 男24人/女0人 と 男0人/女24人 に分かれてラベルと完全一致した。
const W_TITLE = "第２０回マンスリーＢＯＡＴＲＡＣＥ杯　男女Ｗ優勝戦";
const KIRYU_W = [
  { race_id: "2026-09-20-01-01", race_stage: "予選男子", race_title: W_TITLE },
  { race_id: "2026-09-20-01-02", race_stage: "予選女子", race_title: W_TITLE },
  { race_id: "2026-09-21-01-01", race_stage: "予選男子", race_title: W_TITLE },
  { race_id: "2026-09-21-01-02", race_stage: "予選女子", race_title: W_TITLE },
  { race_id: "2026-09-24-01-08", race_stage: "準優勝戦", race_title: W_TITLE },
  { race_id: "2026-09-24-01-10", race_stage: "準優勝戦", race_title: W_TITLE },
  { race_id: "2026-09-25-01-11", race_stage: "優勝戦", race_title: W_TITLE },
  { race_id: "2026-09-25-01-12", race_stage: "優勝戦", race_title: W_TITLE },
];
const KIRYU_RACERS = new Map([
  // 男子（予選男子・準優08・優勝11）
  ["2026-09-20-01-01", [1001, 1002, 1003, 1004, 1005, 1006]],
  ["2026-09-21-01-01", [1001, 1002, 1003, 1007, 1008, 1009]],
  ["2026-09-24-01-08", [1001, 1002, 1003, 1004, 1005, 1006]],
  ["2026-09-25-01-11", [1001, 1002, 1003, 1004, 1005, 1006]],
  // 女子（予選女子・準優10・優勝12）
  ["2026-09-20-01-02", [2001, 2002, 2003, 2004, 2005, 2006]],
  ["2026-09-21-01-02", [2001, 2002, 2003, 2007, 2008, 2009]],
  ["2026-09-24-01-10", [2001, 2002, 2003, 2004, 2005, 2006]],
  ["2026-09-25-01-12", [2001, 2002, 2003, 2004, 2005, 2006]],
]);
const kiryuSplit = splitMeetSeries(KIRYU_W, KIRYU_RACERS);
check(
  "Ｗ優勝戦の節は2つに割れる（桐生 2026-09-20開催）",
  kiryuSplit?.length,
  2,
);
check(
  "分かれた人数（男子9人・女子9人）",
  kiryuSplit?.map((s) => s.size),
  [9, 9],
);
check(
  "男女が混ざらない（男子側に女子の登録番号が無い）",
  kiryuSplit?.some((s) => [...s].every((r) => r < 2000)),
  true,
);
check(
  "男女が混ざらない（女子側に男子の登録番号が無い）",
  kiryuSplit?.some((s) => [...s].every((r) => r >= 2000)),
  true,
);

// **予選終了後の消化レースで繋がない**。多摩川 2026-03-20開催の最終日1R・2R
// 「一般」は両シリーズの選手が同じレースに入っており、算入レースに含めると
// 節全体が1つに繋がって割れなくなる（実測で再現した唯一の節）
const TAMA_TITLE = "男女Ｗ優勝戦第２回ファイティングボートガイド杯";
const TAMAGAWA_W = [
  { race_id: "2026-03-20-05-01", race_stage: "予選", race_title: TAMA_TITLE },
  { race_id: "2026-03-20-05-02", race_stage: "予選", race_title: TAMA_TITLE },
  { race_id: "2026-03-20-05-03", race_stage: "予選", race_title: TAMA_TITLE },
  { race_id: "2026-03-20-05-04", race_stage: "予選", race_title: TAMA_TITLE },
  // 側の中を繋ぐ予選（実際の節でも、同じ側の選手は節を通して何度も顔を合わせる）
  { race_id: "2026-03-21-05-01", race_stage: "予選", race_title: TAMA_TITLE },
  { race_id: "2026-03-21-05-02", race_stage: "予選", race_title: TAMA_TITLE },
  {
    race_id: "2026-03-24-05-03",
    race_stage: "Ｗ準優戦前半",
    race_title: TAMA_TITLE,
  },
  {
    race_id: "2026-03-24-05-05",
    race_stage: "Ｗ準優戦前半",
    race_title: TAMA_TITLE,
  },
  {
    race_id: "2026-03-24-05-09",
    race_stage: "Ｗ準優戦後半",
    race_title: TAMA_TITLE,
  },
  {
    race_id: "2026-03-24-05-11",
    race_stage: "Ｗ準優戦後半",
    race_title: TAMA_TITLE,
  },
  { race_id: "2026-03-25-05-01", race_stage: "一般", race_title: TAMA_TITLE },
  { race_id: "2026-03-25-05-12", race_stage: "優勝戦", race_title: TAMA_TITLE },
];
const TAMAGAWA_RACERS = new Map([
  ["2026-03-20-05-01", [1001, 1002, 1003, 1004, 1005, 1006]],
  ["2026-03-20-05-02", [2001, 2002, 2003, 2004, 2005, 2006]],
  ["2026-03-20-05-03", [1007, 1008, 1009, 1010, 1011, 1012]],
  ["2026-03-20-05-04", [2007, 2008, 2009, 2010, 2011, 2012]],
  ["2026-03-21-05-01", [1001, 1002, 1003, 1007, 1008, 1009]],
  ["2026-03-21-05-02", [2001, 2002, 2003, 2007, 2008, 2009]],
  // **Ｗ準優戦は同じ12名が顔ぶれを組み替えて2回走るヒート**（実データがこの形）。
  // 前半・後半のそれぞれに両方の側が入っており、「前半＝男子／後半＝女子」では
  // ない。本数×6で数えると 4本×6 = 24枠になるが、実際に走るのは12名
  ["2026-03-24-05-03", [1001, 1002, 1003, 1004, 1005, 1006]],
  ["2026-03-24-05-05", [2001, 2002, 2003, 2004, 2005, 2006]],
  ["2026-03-24-05-09", [1007, 1008, 1009, 1010, 1011, 1012]],
  ["2026-03-24-05-11", [2007, 2008, 2009, 2010, 2011, 2012]],
  // 最終日の消化レース。**両方の側が同居する**（実データと同じ形）
  ["2026-03-25-05-01", [1001, 2001, 1002, 2002, 1003, 2003]],
  ["2026-03-25-05-12", [1001, 1002, 1003, 1004, 1005, 1006]],
]);
check(
  "予選終了後の消化レースで繋がないので割れる（多摩川 2026-03-20開催）",
  splitMeetSeries(TAMAGAWA_W, TAMAGAWA_RACERS)?.length,
  2,
);

// ---- 適用しない場合（安全弁） ---------------------------------------------------
// `race_title` が該当しなければ、成分がいくつあっても分けない。
// 2025-12〜2026-01は `race_stage` が全て null で、データの欠測により連結が
// 切れて2成分に見える節が**7節**ある。成分の数だけを根拠にすると誤適用する
check(
  "Ｗ優勝戦でなければ分けない（2つに割れて見えても）",
  splitMeetSeries(
    [
      { race_id: "2025-12-03-21-01", race_stage: null, race_title: "一般" },
      { race_id: "2025-12-03-21-02", race_stage: null, race_title: "一般" },
    ],
    new Map([
      ["2025-12-03-21-01", [1001, 1002, 1003]],
      ["2025-12-03-21-02", [2001, 2002, 2003]],
    ]),
  ),
  null,
);
check(
  "Ｗ優勝戦でも3つ以上に割れたら分けない（安全弁）",
  splitMeetSeries(
    [
      { race_id: "2026-09-20-01-01", race_stage: "予選", race_title: W_TITLE },
      { race_id: "2026-09-20-01-02", race_stage: "予選", race_title: W_TITLE },
      { race_id: "2026-09-20-01-03", race_stage: "予選", race_title: W_TITLE },
    ],
    new Map([
      ["2026-09-20-01-01", [1001, 1002]],
      ["2026-09-20-01-02", [2001, 2002]],
      ["2026-09-20-01-03", [3001, 3002]],
    ]),
  ),
  null,
);
check("Ｗ開催の判定: 空の入力は null", splitMeetSeries([], new Map()), null);
check(
  "Ｗ開催の判定: 配列でなければ null",
  splitMeetSeries(null, new Map()),
  null,
);
// 出走表が素のオブジェクトでも受ける（呼び出し側の形に合わせない）
check(
  "racersByRace が素のオブジェクトでも動く",
  splitMeetSeries(KIRYU_W, Object.fromEntries(KIRYU_RACERS))?.length,
  2,
);

// ---- 順位はシリーズの中だけで振る ------------------------------------------------
// `seriesRacerIds` を渡すと、その選手だけを母集団にする。渡さなければ従来どおり
const W_ENTRIES = [
  {
    raceId: "2026-09-20-01-01",
    racerId: 1001,
    playerName: "男A",
    raceStage: "予選男子",
    rank1: 1,
  },
  {
    raceId: "2026-09-20-01-01",
    racerId: 1002,
    playerName: "男B",
    raceStage: "予選男子",
    rank1: 1,
  },
  {
    raceId: "2026-09-20-01-02",
    racerId: 2001,
    playerName: "女A",
    raceStage: "予選女子",
    rank1: 2,
  },
  {
    raceId: "2026-09-20-01-02",
    racerId: 2002,
    playerName: "女B",
    raceStage: "予選女子",
    rank1: 2,
  },
];
check(
  "seriesRacerIds を渡さなければ節全体で順位を振る（従来どおり）",
  buildMeetRanking({ entries: W_ENTRIES }).length,
  4,
);
check(
  "seriesRacerIds を渡すとそのシリーズだけになる",
  buildMeetRanking({ entries: W_ENTRIES, seriesRacerIds: [1001, 1002] }).map(
    (r) => r.racerId,
  ),
  [1001, 1002],
);

// ---- 枠数は「本数 × 6」ではなく準優に出た実人数（BOA-511のデータ精度検証） -------
// 多摩川 2026-03-20開催の「Ｗ準優戦前半／後半」は、**同じ12名が顔ぶれを
// 組み替えて2回走るヒート**だった。本数で数えると 4本×6 = 24枠になるが、
// 実際に準優を走ったのは各側12名。実測でも、この節だけ
// 「本数×6 = 48 / 実人数 = 24」と食い違っていた（他5節は一致）
const HEAT_ROWS = [
  { race_id: "2026-03-24-05-03", race_stage: "Ｗ準優戦前半" },
  { race_id: "2026-03-24-05-05", race_stage: "Ｗ準優戦前半" },
  { race_id: "2026-03-24-05-09", race_stage: "Ｗ準優戦後半" },
  { race_id: "2026-03-24-05-11", race_stage: "Ｗ準優戦後半" },
];
const HEAT_RACERS = new Map([
  ["2026-03-24-05-03", [1001, 1002, 1003, 1004, 1005, 1006]],
  ["2026-03-24-05-05", [1007, 1008, 1009, 1010, 1011, 1012]],
  // 後半は前半と**同じ12名**の組み替え
  ["2026-03-24-05-09", [1001, 1003, 1005, 1007, 1009, 1011]],
  ["2026-03-24-05-11", [1002, 1004, 1006, 1008, 1010, 1012]],
]);
check(
  "ヒート形式の準優は実人数で数える（4本でも12枠）",
  semifinalSlotsOf(HEAT_ROWS, { racersByRace: HEAT_RACERS }),
  12,
);
check(
  "出走表を渡さなければ従来どおり本数×6（分析スクリプト向け）",
  semifinalSlotsOf(HEAT_ROWS),
  24,
);
// 普通の節では本数×6と実人数が一致するので、渡しても答えは変わらない
const PLAIN_SEMIS = [
  { race_id: "2026-09-26-20-09", race_stage: "準優勝戦" },
  { race_id: "2026-09-26-20-10", race_stage: "準優勝戦" },
  { race_id: "2026-09-26-20-11", race_stage: "準優勝戦" },
];
const PLAIN_RACERS = new Map([
  ["2026-09-26-20-09", [1, 2, 3, 4, 5, 6]],
  ["2026-09-26-20-10", [7, 8, 9, 10, 11, 12]],
  ["2026-09-26-20-11", [13, 14, 15, 16, 17, 18]],
]);
check(
  "普通の節は実人数で数えても18枠のまま",
  semifinalSlotsOf(PLAIN_SEMIS, { racersByRace: PLAIN_RACERS }),
  18,
);
// 番組だけ出ていて出走表がまだ無い準優は、実人数が0になるので本数から出す
check(
  "出走表がまだ無い準優は本数から出す（実人数0に落とさない）",
  semifinalSlotsOf(PLAIN_SEMIS, { racersByRace: new Map() }),
  18,
);
// 中止で流れた準優を除いたうえで実人数を数える
check(
  "中止の準優を除いてから実人数で数える",
  semifinalSlotsOf(
    [
      { race_id: "2026-05-29-03-11", race_stage: "準優勝戦" },
      { race_id: "2026-05-30-03-11", race_stage: "準優勝戦" },
    ],
    {
      cancelledRaceIds: ["2026-05-29-03-11"],
      ranRaceIds: ["2026-05-30-03-11"],
      racersByRace: new Map([
        ["2026-05-29-03-11", [1, 2, 3, 4, 5, 6]],
        ["2026-05-30-03-11", [1, 2, 3, 4, 5, 6]],
      ]),
    },
  ),
  6,
);

// ---- 賞典除外（BOA-587） -----------------------------------------------------
// 今節F（is_flying または着欄の F・Ｆ）の選手だけを拾う。L・欠・着順は拾わない
check(
  "今節Fの選手だけを賞典除外の候補にする（Lは数えない）",
  flyingRacerIdsInMeet(
    [
      {
        race_id: "2026-09-26-22-10",
        boat_number: 1,
        is_flying: true,
        finish_mark: "F",
      },
      {
        race_id: "2026-09-26-22-10",
        boat_number: 2,
        is_flying: false,
        finish_mark: "1",
      },
      {
        race_id: "2026-09-26-22-11",
        boat_number: 3,
        is_flying: false,
        finish_mark: "Ｆ",
      },
      {
        race_id: "2026-09-26-22-11",
        boat_number: 4,
        is_flying: false,
        finish_mark: "L",
      },
      {
        race_id: "2026-09-26-22-11",
        boat_number: 5,
        is_flying: false,
        finish_mark: "欠",
      },
      // 出走表に無い艇（選手が分からない）は拾わない
      {
        race_id: "2026-09-26-22-12",
        boat_number: 6,
        is_flying: true,
        finish_mark: "F",
      },
    ],
    [
      { race_id: "2026-09-26-22-10", boat_number: 1, racer_id: 101 },
      { race_id: "2026-09-26-22-10", boat_number: 2, racer_id: 102 },
      { race_id: "2026-09-26-22-11", boat_number: 3, racer_id: 103 },
      { race_id: "2026-09-26-22-11", boat_number: 4, racer_id: 104 },
      { race_id: "2026-09-26-22-11", boat_number: 5, racer_id: 105 },
    ],
  ).sort(),
  [101, 103],
);
{
  const run = (racerId, raceId, boatNumber) => ({
    racerId,
    playerName: `選手${racerId}`,
    raceId,
    raceStage: "予選",
    boatNumber,
    rank1: boatNumber,
    rank2: null,
    rank3: null,
    rank4: null,
    rank5: null,
    rank6: null,
  });
  // 3人とも1着10点。201は今節F、202は途中帰郷、203はどちらでもない
  const ranked = buildMeetRanking({
    entries: [
      run(201, "2026-09-22-22-01", 1),
      run(202, "2026-09-22-22-02", 1),
      run(203, "2026-09-22-22-03", 1),
    ],
    withdrawnRacerIds: [201, 202],
    exclusionReasonByRacer: { 201: "flying" },
  });
  check(
    "賞典除外・途中帰郷は順位から外し、理由を付ける（理由が無ければ途中帰郷）",
    ranked.map((r) => [r.racerId, r.rank, r.excludedReason]),
    [
      [201, null, "flying"],
      [202, null, "withdrawn"],
      [203, 1, null],
    ],
  );
}

// ---- 予選終了の日目は中止の日を数えない（BOA-578） ---------------------------
// 津 2026-09-21〜28 の節の実データ。9/21 は4Rまで成立、9/22 は丸一日中止
// （番組は残り、series_day=2）、公式は 9/23 を再び2日目とし 9/26 を5日目とする
// （公式の節間成績は「初日〜６日目・最終日」）。日付を数えると 9/26 は6日目になる
{
  const TSU_COND = [
    ["2026-09-21", 1],
    ["2026-09-22", 2],
    ["2026-09-23", 2],
    ["2026-09-24", 3],
    ["2026-09-25", 4],
    ["2026-09-26", 5],
  ].map(([d, sd]) => ({ race_id: `${d}-09-12`, series_day: sd }));
  const TSU_IDS = TSU_COND.map((c) => c.race_id);
  const TSU_RAN = new Set(TSU_IDS.filter((id) => !id.startsWith("2026-09-22")));
  check(
    "予選終了の日目は series_day を使う（津 9/26 は5日目）",
    prelimEndDayOf("2026-09-26-09-12", TSU_COND, TSU_IDS, TSU_RAN),
    5,
  );
  check(
    "series_day が無ければ、丸一日中止の日を飛ばして数える（津 9/26 は5日目）",
    prelimEndDayOf(
      "2026-09-26-09-12",
      TSU_COND.map((c) => ({ ...c, series_day: null })),
      TSU_IDS,
      TSU_RAN,
    ),
    5,
  );
  // 戸田 2026-09-18〜24: 9/21 が丸一日中止（series_day=4）、9/22 も4日目で予選最終日
  const TODA_COND = [
    ["2026-09-18", 1],
    ["2026-09-19", 2],
    ["2026-09-20", 3],
    ["2026-09-21", 4],
    ["2026-09-22", 4],
  ].map(([d, sd]) => ({ race_id: `${d}-02-12`, series_day: sd }));
  check(
    "戸田 9/22（中止の翌日）は4日目",
    prelimEndDayOf(
      "2026-09-22-02-12",
      TODA_COND,
      TODA_COND.map((c) => c.race_id),
      new Set(
        TODA_COND.map((c) => c.race_id).filter(
          (id) => !id.startsWith("2026-09-21"),
        ),
      ),
    ),
    4,
  );
  check(
    "予選の締めが無ければ null",
    prelimEndDayOf(null, TSU_COND, TSU_IDS, TSU_RAN),
    null,
  );
}

// ---- buildMeets は順延（同じ日目が翌日に続く）で節を割らない（BOA-506） --------
// 戸田 2026-09-18〜24 の実データ。9/21 が丸一日中止で、公式は 9/22 も4日目とする
// （9/21→22 で出場43人が全員同じ）。以前は同値を新しい節として扱い、9/21 で節を
// 割って予選の締めを 9/21 8R（中止で走っていない日）に確定させていた
{
  const day = (d, sd, stage, fin = false) => ({
    race_id: `${d}-02-08`,
    race_stage: stage,
    series_day: sd,
    is_final_day: fin,
  });
  const TODA = [
    day("2026-09-18", 1, "予選"),
    day("2026-09-19", 2, "予選"),
    day("2026-09-20", 3, "予選"),
    day("2026-09-21", 4, "予選"),
    day("2026-09-22", 4, "予選"),
    day("2026-09-23", 5, "準優勝戦"),
    day("2026-09-24", 6, "優勝戦", true),
    // 次の節
    day("2026-09-26", 1, "予選"),
  ];
  const meets = buildMeets(TODA);
  check(
    "順延の日（4→4）は同じ節。予選の締めは 9/22",
    meets.map((m) => [m.dates[0], m.dates.at(-1), m.prelimEndRaceId]),
    [
      ["2026-09-18", "2026-09-24", "2026-09-22-02-08"],
      ["2026-09-26", "2026-09-26", "2026-09-26-02-08"],
    ],
  );
  // 同じ日目でも日付が空いていれば別の節（従来どおり）
  const GAP = [day("2026-09-01", 1, "予選"), day("2026-09-03", 1, "予選")];
  check(
    "日付が空いた同値は別の節",
    buildMeets(GAP).map((m) => m.dates),
    [["2026-09-01"], ["2026-09-03"]],
  );
}

// ---- 丸一日レースが無かった日（BOA-636） --------------------------------------
// 津 2026-09-21〜: 9/21 は 1〜4R が成立（5R以降は中止）、9/22 は全レース中止
{
  const ids = [];
  for (const d of ["2026-09-21", "2026-09-22", "2026-09-23"])
    for (let r = 1; r <= 12; r++)
      ids.push(`${d}-09-${String(r).padStart(2, "0")}`);
  const cancelled = new Set(
    ids.filter(
      (id) =>
        id.startsWith("2026-09-22") ||
        (id.startsWith("2026-09-21") && Number(id.slice(-2)) >= 5),
    ),
  );
  check(
    "全レースが中止の日だけを返す（一部成立の 9/21 は含めない）",
    noRaceDaysOf(ids, cancelled),
    ["2026-09-22"],
  );
  check("中止が無ければ空", noRaceDaysOf(ids, new Set()), []);
}

console.log(failures === 0 ? "\n全件パス" : `\n失敗 ${failures} 件`);
process.exit(failures === 0 ? 0 : 1);
