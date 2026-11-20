/**
 * verify-full-picture-scene2.js の後半の場面（9/13）。verify ではない。
 * 判定と期待値は分ける前の verify-full-picture-scene2.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import assert from "node:assert/strict";
import { b3 } from "./full-picture-scene2-b-8.js";
import { got, boats } from "./full-picture-scene2-b-4.js";
import { r3, rpcBodies } from "./full-picture-scene2-b-2.js";
import { date } from "./full-picture-scene2-b-1.js";
import { seenQueries, Y } from "./full-picture-scene2-b-3.js";

let m;

// ---- 5. 本人の優勝戦の成績・優出・優勝回数（2026-10-26 hq 依頼、FT01 の PR B）----
export const fin = (n) => got.db.exhibition.boats[n - 1].final_race_record;

const windowsKbUnread = [
  { source: "races", from: "2025-12-03", to: null, read: true },
  { source: "kb_archive", from: null, to: "2025-12-02", read: false },
];

function scene1() {
  assert.deepEqual(
    Object.keys(b3.condition_rows),
    [
      "national",
      "local",
      "ippan",
      "sgg1",
      "firstDay",
      "finalDay",
      "wave5",
      "fHolding",
      "fClean",
    ],
    "条件別の表の全行",
  );
  assert.ok(
    got.missing.some(
      (x) =>
        x.source === "db.exhibition.boats.1.condition_rows.local" &&
        /走が0/.test(x.reason),
    ),
    "走の無い条件を記録",
  );
  // 11. 風5m以上・波5cm以上（選手ページのレース条件別の成績 aggregateRacerConditionStats と同じ。5走未満は出さない）
  assert.deepEqual(
    [
      b3.condition_stats.overall,
      b3.condition_stats.rows,
      b3.condition_stats.since,
    ],
    [
      { n: 3, win_rate: 66.7, top2_rate: 100, top3_rate: 100 },
      {},
      "2026-09-01",
    ],
    "選手ページの条件別: 3走では5走以上の条件が無い",
  );
  assert.ok(
    got.missing.some(
      (x) =>
        x.source === "db.exhibition.boats.3.condition_stats.windStrong" &&
        /5走未満/.test(x.reason),
    ),
    "風5m以上が出ないことを記録",
  );
  // 6. 今節の各走（今節タブ buildMeetResults・getRecentRaces と同じ。別の会場の9/01は今節でない）
  assert.deepEqual(
    b3.meet_results,
    [
      {
        race_id: r3.a,
        date: "2026-10-10",
        race_no: 5,
        boat_number: 3,
        entry_course: 2,
        start_timing: 0.12,
        is_flying: false,
        finish_rank: 1,
        finish_mark: null,
        absent: false,
        winning_technique: "差し",
        race_stage: "予選",
        race_title: "x杯",
        exhibition_time: 6.7,
        exhibition_rank: 1,
      },
      {
        race_id: r3.b,
        date: "2026-10-11",
        race_no: 3,
        boat_number: 3,
        entry_course: 3,
        start_timing: 0.16,
        is_flying: false,
        finish_rank: 2,
        finish_mark: null,
        absent: false,
        winning_technique: null,
        race_stage: "予選",
        race_title: "x杯",
        exhibition_time: 6.75,
        exhibition_rank: 1,
      },
    ],
    "今節: 進入・本番ST・着・決まり手（1着だけ）・レースの種別",
  );
}

function scene2() {
  // 7. 前づけ%・枠なり進入率（直前情報タブ computeFrameEntryDistribution・枠情報タブ computeWakuNariRate と同じ）
  assert.deepEqual(
    b3.entry_distribution,
    {
      frame: 3,
      n: 2,
      counts: [0, 1, 1, 0, 0, 0],
      waku_rate: 50,
      inward_rate: 50,
      outward_rate: 0,
      waku_nari: { rate: 66.7, n: 3 },
    },
    "この枠（3号艇）からの進入: 2走のうち前づけ1・枠なり1。枠なり進入率は全枠の3走",
  );
  // 10. 事故率（RPC get_racer_accident_records ＋ computeAccidentStats。今期は 5/1 から、その日の走は含めない）
  assert.deepEqual(
    rpcBodies.at(-1),
    {
      p_racer_ids: [4001, 4002, 4003, 4004, 4005],
      p_from: "2026-05-01",
      p_to: date,
    },
    "画面と同じ RPC・同じ期間",
  );
  assert.deepEqual(
    b3.accident,
    {
      from: "2026-05-01",
      to: date,
      starts: 40,
      points: 35,
      rate: 0.87,
      need: 0,
      counts: { F: 1, L1: 0, K1: 0, S1: 0, S2: 1 },
      status: "over",
      settled: true,
      show_badge: true,
    },
    "事故率: F 20点＋妨害失格 15点 ÷ 40走",
  );
  assert.deepEqual(
    [
      boats[0].accident.starts,
      boats[0].accident.rate,
      boats[0].accident.status,
      boats[5].accident,
    ],
    [0, null, null, null],
    "RPC の行が無い選手は出走0（画面と同じ）、選手が分からない艇は null",
  );
  // 9. オリジナル展示（getRaceOriginalExhibition と同じ表と整形）。会場に無い項目は not_offered、欠測は no_value
  assert.deepEqual(
    boats[1].original_exhibition,
    {
      一周: { value: 37.2, status: "value" },
      半周ラップ: { value: null, status: "not_offered" },
      まわり足: { value: 5.52, status: "value" },
      直線: { value: null, status: "no_value" },
    },
    "オリジナル展示: 値・会場に無い項目・欠測を分ける",
  );
  assert.deepEqual(
    Object.values(boats[5].original_exhibition).map((x) => x.status),
    ["no_value", "not_offered", "no_value", "no_value"],
    "値の行が無い艇は欠け",
  );
  assert.deepEqual(
    got.db.exhibition.originalExhibition,
    {
      state: "published",
      measure_status: 1,
      item_labels: ["一周", "まわり足", "直線"],
      kinds: ["一周", "まわり足", "直線"],
      captured_at: `${date}T06:50:00+00:00`,
      last_written_at: `${date}T06:50:00+00:00`,
    },
    "オリジナル展示のレースの状態",
  );
  assert.ok(
    got.missing.some(
      (x) =>
        x.source === "db.exhibition.boats.2.original_exhibition.直線" &&
        /欠測/.test(x.reason),
    ),
    "欠測を記録",
  );
  assert.ok(
    got.missing.some(
      (x) =>
        x.source === "db.exhibition.originalExhibition.kinds" &&
        /半周ラップ/.test(x.reason),
    ),
    "会場に無い項目を記録",
  );
}

function scene3() {
  assert.ok(
    !got.missing.some(
      (x) =>
        x.source === "db.exhibition.originalExhibition" &&
        /締切の後/.test(x.reason),
    ),
    "締切の前の値なら記録しない",
  );
  // 3. 会場の負けの決まり手（losing_technique_stats、LosingTechniqueChart と同じまとめ）
  assert.deepEqual(
    got.db.exhibition.losingTechnique,
    {
      last_updated: "2026-10-25",
      by_boat: {
        1: {
          total_races: 80,
          techniques: [
            { technique: "差し", count: 30, percentage: 37.5 },
            { technique: "まくり", count: 20, percentage: 25 },
          ],
        },
        2: {
          total_races: 300,
          techniques: [{ technique: "逃げ", count: 50, percentage: 16.67 }],
        },
      },
    },
    "負けの決まり手: 枠ごとにまとめる",
  );
  assert.ok(
    seenQueries.some(
      (x) =>
        x.startsWith("losing_technique_stats?") &&
        /venue_code=eq\.1/.test(x) &&
        /order=boat_number,percentage\.desc/.test(x),
    ),
    "画面と同じ並びで読む",
  );
  assert.ok(
    got.missing.some(
      (x) =>
        x.source === "db.exhibition.losingTechnique" &&
        /より後の集計/.test(x.reason),
    ),
    "レースの日より後の集計を記録（値は残す）",
  );
  assert.deepEqual(
    fin(1),
    {
      stage: "優勝戦",
      before: m.raceId,
      windows: windowsKbUnread,
      complete: false,
      runs: 2,
      wins: 1,
      win_rate: 50,
      boat1_runs: 1,
      boat1_wins: 1,
      boat1_win_rate: 100,
      fl_runs: 0,
      absent_runs: 0,
      excluded_races: { no_result: 1, no_race: 1, cancelled: 1 },
      rides: [
        { race_id: Y.y1, boat_number: 1, kind: "win", source: "races" },
        { race_id: Y.y2, boat_number: 3, kind: "run", source: "races" },
      ],
    },
    "優勝戦: 不成立・中止・結果なしを除き、このレースの後・本体の窓の前の走は数えない",
  );
}

/** verify から呼ぶ入口。env は verify 側の束縛（m） */
export function runFullPictureScene2B10(env) {
  ({ m } = env);
  scene1();
  scene2();
  scene3();
}
