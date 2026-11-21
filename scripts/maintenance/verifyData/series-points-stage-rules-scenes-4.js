/**
 * verify-series-points-stage-rules.js の後半の場面（4/5）。verify ではない。
 * 判定と期待値は分ける前の verify-series-points-stage-rules.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import {
  buildMeetRanking,
  postPrelimFlyingRacerIds,
  prelimEndDayOf,
  noRaceDaysOf,
  withdrawnByAbsence,
} from "../../../src/pure/seriesPoints.js";
import { buildMeets } from "../../lib/meetBoundaries.js";
import { pickMeetPretestByRacer } from "../../../src/utils/pretestRows.js";

let check;

function scene1() {
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
  // ---- 予選後に今節Fを切った選手（BOA-626） ----------------------------------
  // 桐生 2026-09-25 7R の6号艇 武田光史は 9/24 8R（予選後）でF。予選中のFではないので
  // 順位は付いたまま、印だけ添える。予選中のF（5号艇 大澤）は対象外
  {
    const END = "2026-09-23-01-12";
    const entries = [
      { race_id: "2026-09-22-01-03", boat_number: 5, racer_id: 501 },
      { race_id: "2026-09-24-01-08", boat_number: 6, racer_id: 601 },
      { race_id: "2026-09-24-01-09", boat_number: 1, racer_id: 701 },
    ];
    const starts = [
      { race_id: "2026-09-22-01-03", boat_number: 5, is_flying: true },
      { race_id: "2026-09-24-01-08", boat_number: 6, is_flying: true },
      { race_id: "2026-09-24-01-09", boat_number: 1, is_flying: false },
    ];
    check(
      "予選後のFだけを拾う（予選中のFは拾わない）",
      postPrelimFlyingRacerIds(starts, entries, END),
      [601],
    );
    check(
      "予選の締めが分からない節では空",
      postPrelimFlyingRacerIds(starts, entries, null),
      [],
    );
  }
}

function scene2() {
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
}

function scene3() {
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
}

function scene4() {
  // ---- 途中帰郷: 前の日まで走っていて、表示日に1走も組まれていない選手 ----------
  // 桐生 2026-09-20〜25（予選の締め 9/23）。北川・田中は 9/22 が最後の走（予選中に帰郷）。
  // 菊池は予選の後の 9/24 1R が最後。浜本は最後まで走る
  {
    const entries = [
      { race_id: "2026-09-22-01-03", racer_id: 3054 }, // 北川
      { race_id: "2026-09-22-01-05", racer_id: 3792 }, // 田中
      { race_id: "2026-09-22-01-07", racer_id: 3538 }, // 菊池
      { race_id: "2026-09-22-01-09", racer_id: 4834 }, // 浜本
      { race_id: "2026-09-23-01-04", racer_id: 3538 },
      { race_id: "2026-09-23-01-08", racer_id: 4834 },
      { race_id: "2026-09-24-01-01", racer_id: 3538 },
      { race_id: "2026-09-24-01-03", racer_id: 4834 },
      { race_id: "2026-09-25-01-05", racer_id: 4834 },
    ];
    const upTo = (d) => entries.filter((e) => e.race_id.slice(0, 10) <= d);
    check(
      "予選の最終日（9/23）から、予選中に帰った選手を外す",
      withdrawnByAbsence(upTo("2026-09-23"), "2026-09-23").sort(),
      [3054, 3792],
    );
    check(
      "最終日（9/25）は、予選の後に帰った選手も外す",
      withdrawnByAbsence(upTo("2026-09-25"), "2026-09-25").sort(),
      [3054, 3538, 3792],
    );
    check(
      "表示日の出走表が会場に1件も無いとき（取得の遅れ）は判定しない",
      withdrawnByAbsence(upTo("2026-09-24"), "2026-09-26"),
      [],
    );
    check(
      "初日は誰も外さない",
      withdrawnByAbsence(upTo("2026-09-22"), "2026-09-22"),
      [],
    );
  }
  // ---- 過去のレースは後の日付の前検の行も使い、別の節の行はモーター番号で弾く ----
  // 津 2026-09-21 初日の節は前検の行が 9/23 からしか無い（BOA-679）。前検は節の中で
  // 変わらないので 9/23 の行でよい。同じ選手が次の節で別のモーターに乗った行は使わない
  {
    const rows = [
      {
        racer_id: 1,
        race_date: "2026-09-23",
        motor_number: 33,
        pretest_time: 6.68,
      },
      {
        racer_id: 1,
        race_date: "2026-09-24",
        motor_number: 33,
        pretest_time: 6.68,
      },
      {
        racer_id: 2,
        race_date: "2026-09-26",
        motor_number: 70,
        pretest_time: 6.9,
      }, // 別の節
      {
        racer_id: 2,
        race_date: "2026-09-23",
        motor_number: 12,
        pretest_time: 6.72,
      },
    ];
    const picked = pickMeetPretestByRacer(
      rows,
      new Map([
        [1, 33],
        [2, 12],
      ]),
    );
    check(
      "選手ごとに今節のモーターの行の最も古いものを採る",
      [picked.get(1)?.race_date, picked.get(2)?.pretest_time],
      ["2026-09-23", 6.72],
    );
    const onlyOther = pickMeetPretestByRacer(
      [{ racer_id: 2, race_date: "2026-09-26", motor_number: 70 }],
      new Map([[2, 12]]),
    );
    check("今節のモーターの行が無ければ採らない", onlyOther.has(2), false);
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check） */
export function runSeriesPointsStageRulesScenes5(env) {
  ({ check } = env);
  scene1();
  scene2();
  scene3();
  scene4();
}
