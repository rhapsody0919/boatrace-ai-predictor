/**
 * verify-series-points-stage-rules.js の後半の場面（2/5）。verify ではない。
 * 判定と期待値は分ける前の verify-series-points-stage-rules.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import {
  buildMeetRanking,
  shouldUseOfficialSeries,
  semifinalSlotsOf,
} from "../../../src/pure/seriesPoints.js";

let check;

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

function scene1() {
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
}

function scene2() {
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
}

function scene3() {
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
}

/** verify から呼ぶ入口。env は verify 側の束縛（check） */
export function runSeriesPointsStageRulesScenes3(env) {
  ({ check } = env);
  scene1();
  scene2();
  scene3();
}
