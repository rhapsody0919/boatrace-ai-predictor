/**
 * verify-pre-race-parsers.js の後半の場面（1/5）。verify ではない。
 * 判定と期待値は分ける前の verify-pre-race-parsers.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import * as realListParser from "../../lib/raceListParser.js";
import * as realBeforeParser from "../../lib/beforeInfoParser.js";
import * as realRows from "../../lib/preRaceRows.js";
import { evaluateParsers } from "./pre-race-parsers-evaluate.js";

let printOut, check, show, same, readFixture, LIST_FILES, LIST_CASES;

export const BEFORE_FILES = {
  fFlag: "beforeinfo-2026-09-19-02-09-f-exhibition.html",
  absent: "beforeinfo-2026-09-16-23-12-absent.html",
  parts: "beforeinfo-2026-09-20-12-01-parts-f.html",
  pre: "beforeinfo-2026-09-21-10-08-before-exhibition.html",
  stabilizer: "beforeinfo-2026-09-21-10-04-stabilizer-1200m.html",
};

const N = null;

export const BEFORE_CASES = [
  {
    // 戸田 2026-09-19 9R: スタート展示の並びが 1,2,3,4,6,5（5号艇が6コース）、2号艇が展示でF.01、プロペラ新
    file: BEFORE_FILES.fFlag,
    distanceM: 1800,
    labels: [],
    order: [1, 2, 3, 4, 6, 5],
    published: true,
    is_absent: [false, false, false, false, false, false],
    weight_kg: [51.5, 47, 59.1, 51.5, 49.9, 52],
    exhibition_time: [6.61, 6.72, 6.77, 6.73, 6.76, 6.81],
    tilt: [0, -0.5, -0.5, -0.5, 0, -0.5],
    propeller_text: [N, "新", N, N, N, N],
    parts_changed: [[], [], [], [], [], []],
    adjustment_weight: [0.5, 0, 0, 0.5, 0, 0],
    prev_race_no: [3, N, 5, 4, 2, N],
    prev_entry_course: [2, N, 6, 4, 6, N],
    prev_start_timing: [0.18, N, 0.12, 0.17, 0.08, N],
    prev_finish_mark: ["5", N, "5", "3", "6", N],
    prev_finish_rank: [5, N, 5, 3, 6, N],
    exhibition_course: [1, 2, 3, 4, 6, 5],
    start_timing: [0.13, 0.01, 0.05, 0.07, 0.09, 0.17],
    start_flag: [N, "F", N, N, N, N],
    conditions: {
      weather: "雨",
      airTemp: 23,
      windVelocity: 0,
      observedRace: 8,
    },
  },
  {
    // 唐津 2026-09-16 12R: 1号艇が欠場（is-miss）。スタート展示は5行で、コースは繰り上がる
    file: BEFORE_FILES.absent,
    distanceM: 1800,
    labels: [],
    order: [2, 3, 4, 5, 6],
    published: true,
    is_absent: [true, false, false, false, false, false],
    weight_kg: [55.2, 55.1, 52.2, 52.9, 52.5, 55.6],
    exhibition_time: [N, 6.93, 6.88, 6.91, 6.96, 6.99],
    tilt: [N, -0.5, -0.5, -0.5, -0.5, -0.5],
    propeller_text: [N, N, N, N, N, N],
    parts_changed: [[], [], [], [], [], []],
    adjustment_weight: [0, 0, 0, 0, 0, 0],
    prev_race_no: [8, 7, 5, 4, 6, 2],
    prev_entry_course: [4, 3, 5, 1, 2, 3],
    prev_start_timing: [0.17, 0.09, 0.13, 0.21, 0.11, 0.15],
    prev_finish_mark: ["4", "2", "4", "1", "2", "4"],
    prev_finish_rank: [4, 2, 4, 1, 2, 4],
    exhibition_course: [N, 1, 2, 3, 4, 5],
    start_timing: [N, 0.01, 0.07, 0.13, 0.02, 0.01],
    start_flag: [N, "F", N, N, N, N],
    conditions: {
      weather: "晴",
      airTemp: 27,
      windVelocity: 6,
      observedRace: 11,
    },
  },
  {
    // 住之江 2026-09-20 1R: 5号艇の部品交換（電気・キャブ）、5号艇が展示でF.03、気象は「20:34現在」
    file: BEFORE_FILES.parts,
    distanceM: 1800,
    labels: [],
    order: [1, 2, 3, 4, 5, 6],
    published: true,
    is_absent: [false, false, false, false, false, false],
    weight_kg: [52.8, 54.2, 54.7, 55, 52, 58.6],
    exhibition_time: [6.98, 7.07, 7.04, 7.06, 7.11, 6.99],
    tilt: [-0.5, -0.5, 0, -0.5, -0.5, -0.5],
    propeller_text: [N, N, N, N, N, N],
    parts_changed: [[], [], [], [], ["電気", "キャブ"], []],
    adjustment_weight: [0, 0, 0, 0, 0, 0],
    prev_race_no: [N, N, N, N, N, N],
    prev_entry_course: [N, N, N, N, N, N],
    prev_start_timing: [N, N, N, N, N, N],
    prev_finish_mark: [N, N, N, N, N, N],
    prev_finish_rank: [N, N, N, N, N, N],
    exhibition_course: [1, 2, 3, 4, 5, 6],
    start_timing: [0.12, 0.1, 0.1, 0.08, 0.03, 0.1],
    start_flag: [N, N, N, N, "F", N],
    conditions: {
      weather: "晴",
      airTemp: 26,
      windVelocity: 4,
      observedTime: "20:34",
    },
  },
  {
    // 三国 2026-09-21 8R: 展示航走前。展示タイム・スタート展示は無い。体重・調整重量・前走成績は既にある
    file: BEFORE_FILES.pre,
    distanceM: 1200,
    labels: [],
    order: [],
    published: false,
    is_absent: [false, false, false, false, false, false],
    weight_kg: [52, 52, 52, 50.5, 52, 52.8],
    exhibition_time: [N, N, N, N, N, N],
    tilt: [N, N, N, N, N, N],
    propeller_text: [N, N, N, N, N, N],
    parts_changed: [[], [], [], [], [], []],
    adjustment_weight: [0, 0, 0, 1.5, 0, 0],
    prev_race_no: [N, N, 1, 2, N, N],
    prev_entry_course: [N, N, 1, 3, N, N],
    prev_start_timing: [N, N, 0.23, 0.25, N, N],
    prev_finish_mark: [N, N, "2", "6", N, N],
    prev_finish_rank: [N, N, 2, 6, N, N],
    exhibition_course: [N, N, N, N, N, N],
    start_timing: [N, N, N, N, N, N],
    start_flag: [N, N, N, N, N, N],
    conditions: { weather: "曇り", windVelocity: 10, observedRace: 4 },
  },
  {
    // 三国 2026-09-21 4R: 安定板使用のラベル・距離1200m
    file: BEFORE_FILES.stabilizer,
    distanceM: 1200,
    labels: ["安定板使用"],
    order: [1, 2, 3, 4, 5, 6],
    published: true,
    is_absent: [false, false, false, false, false, false],
    weight_kg: [55.5, 52.2, 52.4, 52.3, 52.5, 52.6],
    exhibition_time: [7, 7.03, 6.94, 7.07, 6.94, 6.96],
    tilt: [0, 0, 0, -0.5, 0, 0],
    propeller_text: [N, N, N, N, N, N],
    parts_changed: [[], [], [], [], [], []],
    adjustment_weight: [0, 0, 0, 0, 0, 0],
    prev_race_no: [N, N, N, N, N, N],
    prev_entry_course: [N, N, N, N, N, N],
    prev_start_timing: [N, N, N, N, N, N],
    prev_finish_mark: [N, N, N, N, N, N],
    prev_finish_rank: [N, N, N, N, N, N],
    exhibition_course: [1, 2, 3, 4, 5, 6],
    start_timing: [0.04, 0.07, 0.03, 0.12, 0.27, 0.09],
    start_flag: [N, N, N, N, N, N],
    conditions: { weather: "曇り", windVelocity: 7, observedRace: 3 },
  },
];

// ---------------------------------------------------------------------------
// (a)(c)(e) を、差し替え可能なモジュールに対して評価する（変異検証で、壊した版にも同じ評価をかける）
// 評価の本体は verifyData/pre-race-parsers-evaluate.js（フィクスチャの期待値と読み方を渡す）
export const evaluate = (m) =>
  evaluateParsers(m, {
    LIST_CASES,
    BEFORE_CASES,
    LIST_FILES,
    BEFORE_FILES,
    N,
    readFixture,
    same,
  });

export const realModules = {
  parseRaceListPage: realListParser.parseRaceListPage,
  parseBeforeInfoPage: realBeforeParser.parseBeforeInfoPage,
  buildRaceEntryRows: realRows.buildRaceEntryRows,
  buildRaceConditionRow: realRows.buildRaceConditionRow,
  buildExhibitionRows: realRows.buildExhibitionRows,
  planDeadlineUpdates: realRows.planDeadlineUpdates,
};

// parseDeadlines が HH:MM に正規化して渡す契約の外。仕様未定のため合否に含めない。
const KNOWN_GAPS = [];

function scene1() {
  // ---------------------------------------------------------------------------
  // (a)(c) 実装の評価
  // ---------------------------------------------------------------------------
  {
    const failed = evaluate(realModules);
    check(
      `全項目の解析・行の組み立て: 実ページ（出走表${LIST_CASES.length}件・直前情報${BEFORE_CASES.length}件）と合成の全項目が期待どおり`,
      failed.length === 0,
      failed.join(" / "),
    );
  }
  // JST はホストの TZ に依存せず、秒を表示しない。
  {
    const originalTz = process.env.TZ;
    try {
      for (const tz of ["UTC", "America/Los_Angeles"]) {
        process.env.TZ = tz;
        for (const [input, expected] of [
          ["2026-10-25T15:00:00Z", "00:00"],
          ["2026-10-25T14:59:59.999Z", "23:59"],
          ["2026-10-25T00:00:00Z", "09:00"],
          ["2026-12-31T15:00:00Z", "00:00"],
          ["2026-10-25T08:30:00+09:00", "08:30"],
        ]) {
          check(`formatJstHm: ${tz} / ${input}`, realRows.formatJstHm(new Date(input)) === expected);
        }
        let error;
        try {
          realRows.formatJstHm(new Date(NaN));
        } catch (e) {
          error = e;
        }
        check(`formatJstHm: ${tz} / Invalid Date は RangeError`, error instanceof RangeError);
      }
    } finally {
      if (originalTz === undefined) delete process.env.TZ;
      else process.env.TZ = originalTz;
    }
  }
  for (const [input, currentTime, time] of [
    ["1R 09:05 → 9:05", "09:05", "9:05"],
    ["1R 10:00 → 全角１０:０５", "10:00", "１０:０５"],
  ]) {
    KNOWN_GAPS.push({
      input,
      specification: "HH:MM 以外の入力は仕様未定",
      current: realRows.planDeadlineUpdates([{
        race_id: "2026-09-16-23-01", venue_code: 23, race_no: 1,
        start_time: new Date(`2026-09-16T${currentTime}:00+09:00`),
      }], 23, [{ race_number: 1, time }]),
    });
  }
  for (const input of [null, "2026-10-25T00:00:00Z"]) {
    let current;
    try {
      current = realRows.formatJstHm(input);
    } catch (e) {
      current = e.name;
    }
    KNOWN_GAPS.push({ input, specification: "Date 以外は仕様未定", current });
  }
  printOut(`KNOWN_GAPS ${KNOWN_GAPS.length}件`);
  for (const gap of KNOWN_GAPS) printOut(show(gap));
}

/** verify から呼ぶ入口。env は verify 側の束縛（printOut・check・show・same・readFixture・LIST_FILES・LIST_CASES） */
export function runPreRaceParsersScenes1(env) {
  ({ printOut, check, show, same, readFixture, LIST_FILES, LIST_CASES } = env);
  scene1();
}
