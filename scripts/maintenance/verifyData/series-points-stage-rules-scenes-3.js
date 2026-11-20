/**
 * verify-series-points-stage-rules.js の後半の場面（3/5）。verify ではない。
 * 判定と期待値は分ける前の verify-series-points-stage-rules.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import {
  KIRYU_W,
  KIRYU_RACERS,
  TAMAGAWA_W,
  TAMAGAWA_RACERS,
  W_TITLE,
  W_ENTRIES,
} from "./series-points-stage-rules.js";
import {
  semifinalSlotsOf,
  splitMeetSeries,
  buildMeetRanking,
  flyingRacerIdsInMeet,
} from "../../../src/pure/seriesPoints.js";

let check;
let kiryuSplit, HEAT_RACERS, PLAIN_RACERS;

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

// 普通の節では本数×6と実人数が一致するので、渡しても答えは変わらない
const PLAIN_SEMIS = [
  { race_id: "2026-09-26-20-09", race_stage: "準優勝戦" },
  { race_id: "2026-09-26-20-10", race_stage: "準優勝戦" },
  { race_id: "2026-09-26-20-11", race_stage: "準優勝戦" },
];

function scene1() {
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
  kiryuSplit = splitMeetSeries(KIRYU_W, KIRYU_RACERS);
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
}

function scene2() {
  // 出走表が素のオブジェクトでも受ける（呼び出し側の形に合わせない）
  check(
    "racersByRace が素のオブジェクトでも動く",
    splitMeetSeries(KIRYU_W, Object.fromEntries(KIRYU_RACERS))?.length,
    2,
  );
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
  HEAT_RACERS = new Map([
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
  PLAIN_RACERS = new Map([
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
}

function scene3() {
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
}

/** verify から呼ぶ入口。env は verify 側の束縛（check） */
export function runSeriesPointsStageRulesScenes4(env) {
  ({ check } = env);
  scene1();
  scene2();
  scene3();
}
