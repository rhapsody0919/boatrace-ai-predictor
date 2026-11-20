/**
 * verify-series-points-stage-rules.js の後半の場面（5/5）。verify ではない。
 * 判定と期待値は分ける前の verify-series-points-stage-rules.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { PRETEST_KNOWN_GAPS } from "./series-points-stage-rules.js";
import { prelimOfficialAdjustments, buildMeetRanking } from "../../../src/pure/seriesPoints.js";
import { pickLatestPretestByRacer, pickMeetPretestByRacer } from "../../../src/utils/pretestRows.js";

let check;

function scene1() {
  // ---- モータ情報タブは選手ごとに最新の前検の行を採る（BOA-1128） ------------
  {
    for (const [label, rows] of [
      ["null", null],
      ["undefined", undefined],
      ["空配列", []],
    ]) {
      check(
        `最新の前検: ${label} は空`,
        [...pickLatestPretestByRacer(rows).entries()],
        [],
      );
    }
    const rows = [
      { racer_id: 1, race_date: "2026-10-20", t: 6.8 },
      { racer_id: 1, race_date: "2026-10-23", t: 6.7 },
      { racer_id: 2, race_date: "2026-10-21", t: 6.9 },
    ];
    check(
      "最新の前検: 選手ごとに日付の一番新しい行を採る",
      [...pickLatestPretestByRacer(rows).entries()],
      [
        [1, { racer_id: 1, race_date: "2026-10-23", t: 6.7 }],
        [2, { racer_id: 2, race_date: "2026-10-21", t: 6.9 }],
      ],
    );
    check(
      "今節の前検: 同じ入力でも最も古い行を採る",
      [...pickMeetPretestByRacer(rows, new Map()).entries()],
      [
        [1, { racer_id: 1, race_date: "2026-10-20", t: 6.8 }],
        [2, { racer_id: 2, race_date: "2026-10-21", t: 6.9 }],
      ],
    );
    check(
      "最新の前検: 同じ日付は入力の先の行を採る",
      [
        ...pickLatestPretestByRacer([
          { racer_id: 1, race_date: "2026-10-23", t: "a" },
          { racer_id: 1, race_date: "2026-10-23", t: "b" },
        ]).entries(),
      ],
      [[1, { racer_id: 1, race_date: "2026-10-23", t: "a" }]],
    );
    check(
      "最新の前検: Map のキーは日付の新しい順",
      [
        ...pickLatestPretestByRacer([
          { racer_id: 2, race_date: "2026-10-20" },
          { racer_id: 1, race_date: "2026-10-23" },
          { racer_id: 3, race_date: "2026-10-22" },
        ]).keys(),
      ],
      [1, 3, 2],
    );
    const input = [
      { racer_id: 1, race_date: "2026-10-20" },
      { racer_id: 1, race_date: "2026-10-23" },
    ];
    pickLatestPretestByRacer(input);
    check(
      "最新の前検: 入力の配列を並べ替えない",
      input.map((row) => row.race_date),
      ["2026-10-20", "2026-10-23"],
    );
  }
  console.log(`PRETEST_KNOWN_GAPS: ${PRETEST_KNOWN_GAPS.length} 件`);
  for (const gap of PRETEST_KNOWN_GAPS) console.log(JSON.stringify(gap));
}

/** verify から呼ぶ入口。env は verify 側の束縛（check） */
export function runSeriesPointsStageRulesScenes6(env) {
  ({ check } = env);
  scene1();
}

function scene2() {
  // 予選中の今節タブは当社計算のまま、公式の前夜の減点と途中帰郷だけを足す（BOA-782）。
  // 三国G1 10/6: 白井英治（公式14位・減点10）を2位と出し、公式で途中帰郷の選手を順位に残した
  {
    const officialRows = [
      { racer_id: 1, remarks: null, penalty_points: 0 },
      { racer_id: 2, remarks: null, penalty_points: 10 },
      { racer_id: 3, remarks: "途中帰郷", penalty_points: 0 },
      // 99 は賞典除外の印。引く点数ではない
      { racer_id: 4, remarks: "賞典除外", penalty_points: 99 },
    ];
    check(
      "表の時点が表示日より前なら、減点（99以外）と途中帰郷を返す",
      prelimOfficialAdjustments(officialRows, "2026-10-05", "2026-10-06"),
      { asOf: "2026-10-05", penaltyByRacer: { 2: 10 }, withdrawnRacerIds: [3] },
    );
    check(
      "表の時点が表示日と同じか後なら使わない（過去のレースへの後出しを防ぐ）",
      [
        prelimOfficialAdjustments(officialRows, "2026-10-06", "2026-10-06"),
        prelimOfficialAdjustments(officialRows, "2026-10-08", "2026-10-06"),
      ],
      [null, null],
    );
    check(
      "公式の行・表の時点が無ければ使わない",
      [
        prelimOfficialAdjustments([], "2026-10-05", "2026-10-06"),
        prelimOfficialAdjustments(officialRows, null, "2026-10-06"),
      ],
      [null, null],
    );

    const run = (racerId, raceId, boatNumber, rank1, rank2 = null) => ({
      racerId,
      playerName: `選手${racerId}`,
      raceId,
      raceStage: "予選",
      boatNumber,
      started: true,
      rank1,
      rank2,
      rank3: null,
      rank4: null,
      rank5: null,
      rank6: null,
    });
    const board = {
      prelimEndRaceId: null,
      entries: [
        // 選手1: 2着2本 = 16点 / 2走 = 8.00
        run(1, "2026-10-05-10-01", 2, 9, 2),
        run(1, "2026-10-06-10-01", 2, 9, 2),
        // 選手2: 1着・2着 = 18点 / 2走 = 9.00、減点10で 4.00
        run(2, "2026-10-05-10-02", 1, 1),
        run(2, "2026-10-06-10-02", 2, 9, 2),
      ],
      officialPenaltyByRacer: { 2: 10 },
    };
    const ranked = buildMeetRanking(board);
    check(
      "当社計算から公式の前夜の減点を引いて並べる（当日の走は当社計算のまま）",
      ranked.map((r) => [
        r.racerId,
        r.rank,
        r.points,
        r.runs,
        r.fromOfficial,
        r.penaltyFromOfficial,
      ]),
      [
        [1, 1, 16, 2, false, 0],
        [2, 2, 8, 2, false, 10],
      ],
    );
    check(
      "減点が無ければ従来どおり（選手2が 9.00 で1位）",
      buildMeetRanking({ ...board, officialPenaltyByRacer: null }).map((r) => [
        r.racerId,
        r.rank,
      ]),
      [
        [2, 1],
        [1, 2],
      ],
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check） */
export function runSeriesPointsStageRulesScenes7(env) {
  ({ check } = env);
  scene2();
}
