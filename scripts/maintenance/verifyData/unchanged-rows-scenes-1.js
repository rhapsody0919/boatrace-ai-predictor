/**
 * verify-unchanged-rows.js の後半の場面（1/3）。verify ではない。
 * 判定と期待値は分ける前の verify-unchanged-rows.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { diffRows } from "../../lib/unchangedRows.js";
import { parseKFileText } from "../../lib/kfileParser.js";

let check, db, kfileText, clone, diff, ACTUAL;
export let kRows;

// ---------------------------------------------------------------------------
// 4. race_conditions（update-race-info.js・generate-predictions.js）
// ---------------------------------------------------------------------------
const condOptions = { keyColumns: ["race_id"] };

const condIncoming = (row, overrides = {}) => ({
  race_id: row.race_id,
  weather: row.weather,
  wind_direction: row.wind_direction,
  wind_speed: row.wind_speed,
  series_day: row.series_day,
  is_final_day: row.is_final_day,
  wave_height: row.wave_height,
  temperature: row.temperature,
  water_temperature: row.water_temperature,
  race_title: row.race_title,
  race_stage: row.race_stage,
  ...overrides,
});

// ---------------------------------------------------------------------------
// 5. race_results（scrape-results.js: result_atは取得時刻で毎回変わるため比較から外す）
// ---------------------------------------------------------------------------
const resultsOptions = {
  keyColumns: ["race_id"],
  ignoreColumns: ["result_at"],
};

// scrapeAndSaveResults() が構築する行（actual_course・is_cancelled等は含まない）を再現
const resultIncoming = (row, overrides = {}) => ({
  race_id: row.race_id,
  rank1: row.rank1,
  rank2: row.rank2,
  rank3: row.rank3,
  rank4: row.rank4,
  rank5: row.rank5,
  rank6: row.rank6,
  race_time_1: row.race_time_1,
  race_time_2: row.race_time_2,
  race_time_3: row.race_time_3,
  race_time_4: row.race_time_4,
  race_time_5: row.race_time_5,
  race_time_6: row.race_time_6,
  payout_win: row.payout_win,
  payout_place_1: row.payout_place_1,
  payout_place_2: row.payout_place_2,
  payout_trifecta: row.payout_trifecta,
  payout_trio: row.payout_trio,
  payout_exacta: row.payout_exacta,
  payout_quinella: row.payout_quinella,
  payout_wide_1: row.payout_wide_1,
  payout_wide_2: row.payout_wide_2,
  payout_wide_3: row.payout_wide_3,
  popularity_trifecta: row.popularity_trifecta,
  popularity_trio: row.popularity_trio,
  popularity_exacta: row.popularity_exacta,
  popularity_quinella: row.popularity_quinella,
  popularity_wide_1: row.popularity_wide_1,
  popularity_wide_2: row.popularity_wide_2,
  popularity_wide_3: row.popularity_wide_3,
  winning_technique: row.winning_technique,
  course_1: row.course_1,
  course_2: row.course_2,
  course_3: row.course_3,
  course_4: row.course_4,
  course_5: row.course_5,
  course_6: row.course_6,
  result_at: new Date().toISOString(),
  ...overrides,
});

export const project = (row) => ({
  race_id: row.race_id,
  ...Object.fromEntries(ACTUAL.map((c) => [c, row[c]])),
});

export const actualOptions = { keyColumns: ["race_id"], writeMissing: false };

function scene1() {
  {
    // races.race_grade（update-race-info.js: 既存行からrace_gradeを比較）
    const race = db.races[0];
    const same = diffRows(
      db.races,
      [{ race_id: race.race_id, race_grade: "ippan" }],
      {
        keyColumns: ["race_id"],
        writeMissing: false,
      },
    );
    const changed = diffRows(
      db.races,
      [{ race_id: race.race_id, race_grade: "G1" }],
      {
        keyColumns: ["race_id"],
        writeMissing: false,
      },
    );
    check("races.race_grade: 同一値は変更なし", same.toWrite.length === 0);
    check(
      "races.race_grade: 変化（ippan→G1）は書く",
      changed.toWrite.length === 1,
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・db・kfileText・clone・diff） */
export function runUnchangedRowsScenes1(env) {
  ({ check, db, kfileText, clone, diff } = env);
  scene1();
}

function scene2() {
  {
    const c = db.race_conditions[0];
    const r = diff(
      "race_conditions",
      db.race_conditions,
      [condIncoming(c)],
      condOptions,
    );
    check("race_conditions: 同一値は変更なし", r.toWrite.length === 0);
    const wind = diff(
      "race_conditions",
      db.race_conditions,
      [condIncoming(c, { wind_speed: 5 })],
      condOptions,
    );
    check(
      "race_conditions: 風速の変化を握りつぶさない",
      wind.toWrite.length === 1,
    );
    const temp = diff(
      "race_conditions",
      db.race_conditions,
      [condIncoming(c, { temperature: 23.04 })],
      condOptions,
    );
    check(
      "race_conditions: 気温23.04→23.0（scale1丸め）は変更なし",
      temp.toWrite.length === 0,
    );
    const temp2 = diff(
      "race_conditions",
      db.race_conditions,
      [condIncoming(c, { temperature: 23.06 })],
      condOptions,
    );
    check(
      "race_conditions: 気温23.06→23.1は変更あり",
      temp2.toWrite.length === 1,
    );
    const finalDay = diff(
      "race_conditions",
      db.race_conditions,
      [condIncoming(c, { is_final_day: true })],
      condOptions,
    );
    check(
      "race_conditions: boolean(is_final_day)の変化を握りつぶさない",
      finalDay.toWrite.length === 1,
    );
    // generate-predictions.js形式: 天候系の列を省いた行（race_title/race_stageのみ）
    const partial = diff(
      "race_conditions",
      db.race_conditions,
      [
        {
          race_id: c.race_id,
          race_title: c.race_title,
          race_stage: c.race_stage,
        },
      ],
      condOptions,
    );
    check(
      "race_conditions: 列を省いた行は、持つ列だけで比較する（省いた列で誤判定しない）",
      partial.toWrite.length === 0,
    );
    const partialChanged = diff(
      "race_conditions",
      db.race_conditions,
      [{ race_id: c.race_id, race_title: c.race_title, race_stage: "準優勝戦" }],
      condOptions,
    );
    check(
      "race_conditions: 省略列があっても、持つ列の変化は検知する",
      partialChanged.toWrite.length === 1,
    );
  }
}

function scene3() {
  {
    const res = db.race_results[0];
    const r = diff(
      "race_results",
      db.race_results,
      [resultIncoming(res)],
      resultsOptions,
    );
    check(
      "race_results: result_atだけが違う再取得は変更なし（決まり手待ちの再取得ループ）",
      r.toWrite.length === 0,
    );
    const tech = diff(
      "race_results",
      db.race_results,
      [resultIncoming(res, { winning_technique: null })],
      resultsOptions,
    );
    check(
      "race_results: 決まり手の変化(逃げ→null)を握りつぶさない",
      tech.toWrite.length === 1,
    );
    const pay = diff(
      "race_results",
      db.race_results,
      [resultIncoming(res, { payout_trifecta: 320 })],
      resultsOptions,
    );
    check("race_results: 払戻金の変化を握りつぶさない", pay.toWrite.length === 1);
    const time = diff(
      "race_results",
      db.race_results,
      [resultIncoming(res, { race_time_4: "1'53\"3" })],
      resultsOptions,
    );
    check(
      "race_results: レースタイム(文字列)の変化を握りつぶさない",
      time.toWrite.length === 1,
    );
    const rank4 = diff(
      "race_results",
      db.race_results,
      [resultIncoming(res, { rank4: null })],
      resultsOptions,
    );
    check(
      "race_results: HTML取得のrank4=nullがKファイル由来のrank4=3と食い違う場合は変更あり（従来どおり書く）",
      rank4.toWrite.length === 1,
    );
  }
  {
    // race_start_timings（scale 3）
    const existing = [
      {
        race_id: "2026-09-18-04-05",
        boat_number: 1,
        start_timing: 0.12,
        is_flying: false,
        is_late_start: false,
      },
      {
        race_id: "2026-09-18-04-05",
        boat_number: 2,
        start_timing: 0.093,
        is_flying: false,
        is_late_start: false,
      },
    ];
    const incoming = [
      {
        race_id: "2026-09-18-04-05",
        boat_number: 1,
        start_timing: 0.12,
        is_flying: false,
        is_late_start: false,
      },
      {
        race_id: "2026-09-18-04-05",
        boat_number: 2,
        start_timing: 0.093,
        is_flying: true,
        is_late_start: false,
      },
    ];
    const r = diff("race_start_timings", existing, incoming, {
      keyColumns: ["race_id", "boat_number"],
    });
    check(
      "race_start_timings: 同一行はスキップし、フライング判定の変化は書く",
      r.toWrite.length === 1 && r.toWrite[0].boat_number === 2,
    );
  }
}

function scene4() {
  // ---------------------------------------------------------------------------
  // 6. BOA-349: 進入コース同期（実Kファイル144レース）
  // ---------------------------------------------------------------------------
  kRows = parseKFileText(kfileText, "2026-09-11");
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・db・kfileText・clone・diff） */
export function runUnchangedRowsScenes2(env) {
  ({ check, db, kfileText, clone, diff } = env);
  scene2();
  scene3();
  scene4();
}

function scene5() {
  check("BOA-349: Kファイル144レースをパース", kRows.length === 144);
  {
    const incoming = kRows.map(project);
    // 同期済みDB（全レースが既にKファイルと同じ値）。1レースだけ滞留（actual_course_1がnull）していても
    // 全件UPDATEにならないこと。滞留レースはKファイル側にも進入コースが無い（null）ため値は同じ
    const existing = clone(incoming);
    existing[10].actual_course_1 = null; // 滞留レース（DBもKファイルもnull）
    incoming[10].actual_course_1 = null;
    const r = diff("race_results", existing, incoming, actualOptions);
    check(
      "BOA-349: 滞留1件を含む同期済みの日は、UPDATE対象が0件（従来は144件）",
      r.toWrite.length === 0 && r.stats.unchanged === 144,
      JSON.stringify(r.stats),
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・db・kfileText・clone・diff・ACTUAL） */
export function runUnchangedRowsScenes3(env) {
  ({ check, db, kfileText, clone, diff, ACTUAL } = env);
  scene5();
}
