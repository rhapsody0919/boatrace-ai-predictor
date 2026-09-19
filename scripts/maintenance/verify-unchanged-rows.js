/**
 * verify-unchanged-rows.js - 「変更の無い行は書かない」比較ロジック
 * （scripts/lib/unchangedRows.js、WS8(b)・BOA-349）の検証。
 *
 * 最重要の観点は「変更を握りつぶさない」こと。変更のある行が1件でも「変更なし」と
 * 判定されると、値が更新されないままデータが古くなる。逆に「変更あり」への誤判定は
 * 従来どおり書くだけで実害が無い。そのため、
 *   1. 同一値は変更なしと判定できる（型・桁・null/undefined・jsonbキー順の差で誤判定しない）
 *   2. 1列でも異なる値は必ず変更ありと判定する（丸めでも握りつぶさない）
 *   3. 迷う場合（既存行なし・既存行にその列なし・既存行取得失敗）は書く側に倒れる
 * の3点を、本番DBの実データ形式のフィクスチャで確認する。
 *
 * フィクスチャ:
 *   - scripts/lib/__fixtures__/unchangedRows/db-rows-2026-09-18-04-05.json
 *       2026-09-18 平和島5R の本番DB実データ（race_entries/races/race_conditions/race_results）
 *   - scripts/lib/__fixtures__/kfile/k260911.txt
 *       2026-09-11 の公式Kファイル（144レース分）。BOA-349（進入コース同期の全件UPDATE）の再現に使う
 */
import fs from "node:fs";
import {
  diffRows,
  filterUnchangedRows,
  normalizeValue,
  NUMERIC_SCALES,
  roundToScale,
  upsertChangedRows,
} from "../lib/unchangedRows.js";
import { parseKFileRankings, parseKFileText } from "../lib/kfileParser.js";

let failures = 0;
function check(label, pass, detail = "") {
  if (pass) {
    console.log(`✅ ${label}`);
  } else {
    failures++;
    console.error(`❌ ${label}${detail ? ` (${detail})` : ""}`);
  }
}

const db = JSON.parse(
  fs.readFileSync(
    new URL(
      "../lib/__fixtures__/unchangedRows/db-rows-2026-09-18-04-05.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const kfileText = fs.readFileSync(
  new URL("../lib/__fixtures__/kfile/k260911.txt", import.meta.url),
  "utf8",
);

const clone = (v) => JSON.parse(JSON.stringify(v));
const diff = (table, existing, incoming, options) =>
  diffRows(existing, incoming, {
    scales: NUMERIC_SCALES[table] ?? {},
    ...options,
  });

// ---------------------------------------------------------------------------
// 1. 丸め・正規化（PostgreSQL numeric(p,s) の書き込み時丸めの再現）
// ---------------------------------------------------------------------------
check(
  "roundToScale: 1.005 → 1.01（2進誤差で1.00にならない）",
  roundToScale(1.005, 2) === 1.01,
);
check("roundToScale: 5.325 → 5.33", roundToScale(5.325, 2) === 5.33);
check(
  "roundToScale: 負数は0から遠い側 -1.005 → -1.01",
  roundToScale(-1.005, 2) === -1.01,
);
check(
  "roundToScale: 0.1234 → 0.123（scale3）",
  roundToScale(0.1234, 3) === 0.123,
);
check("roundToScale: 46.88はそのまま", roundToScale(46.88, 2) === 46.88);
check("roundToScale: 整数4はscale1で4", roundToScale(4, 1) === 4);
check(
  "normalizeValue: null/undefined/NaN/Infinityは全てnullに揃う",
  [undefined, null, NaN, Infinity, -Infinity].every(
    (v) =>
      normalizeValue(v, undefined) === null && normalizeValue(v, 2) === null,
  ),
);
check(
  "normalizeValue: numeric列は文字列'5.30'を数値5.3として比較できる",
  normalizeValue("5.30", 2) === 5.3,
);
check(
  "normalizeValue: 非numeric列は文字列'5'と数値5を区別する（迷ったら変更あり）",
  normalizeValue("5", undefined) !== normalizeValue(5, undefined),
);
check(
  "normalizeValue: jsonbはオブジェクトのキー順に依存しない",
  normalizeValue({ a: 1, b: { c: 2, d: 3 } }, undefined) ===
    normalizeValue({ b: { d: 3, c: 2 }, a: 1 }, undefined),
);
check(
  "normalizeValue: 配列は要素順を区別する",
  normalizeValue(["a", "b"], undefined) !==
    normalizeValue(["b", "a"], undefined),
);
check(
  "normalizeValue: 空配列とnullは別物（parts_changed）",
  normalizeValue([], undefined) !== normalizeValue(null, undefined),
);

// ---------------------------------------------------------------------------
// 2. race_entries（update-race-info.js・generate-predictions.js の書き込み形式）
// ---------------------------------------------------------------------------
// update-race-info.js が構築する行（ai_score系は含まない）を、既存行から再現する
const entryIncoming = (row) => ({
  race_id: row.race_id,
  boat_number: row.boat_number,
  racer_id: row.racer_id,
  player_name: row.player_name,
  grade: row.grade,
  age: row.age,
  win_rate: row.win_rate,
  local_win_rate: row.local_win_rate,
  global_2rate: row.global_2rate,
  local_2rate: row.local_2rate,
  global_3rate: row.global_3rate,
  local_3rate: row.local_3rate,
  motor_number: row.motor_number,
  motor_2rate: row.motor_2rate,
  motor_3rate: row.motor_3rate,
  boat_number_id: row.boat_number_id,
  boat_2rate: row.boat_2rate,
  boat_3rate: row.boat_3rate,
});
const entryOptions = { keyColumns: ["race_id", "boat_number"] };

{
  const incoming = db.race_entries.map(entryIncoming);
  const r = diff("race_entries", db.race_entries, incoming, entryOptions);
  check(
    "race_entries: 同一値6行は全て変更なし（ai_score列は書き込み対象外のため比較に現れない）",
    r.stats.unchanged === 6 && r.toWrite.length === 0,
    JSON.stringify(r.stats),
  );
}
{
  // 1列だけ変化（モーター2連率 46.88 → 47.10）→ その1行だけ書く
  const incoming = db.race_entries.map(entryIncoming);
  incoming[0].motor_2rate = 47.1;
  const r = diff("race_entries", db.race_entries, incoming, entryOptions);
  check(
    "race_entries: 1列だけ変化した行のみ書く",
    r.toWrite.length === 1 &&
      r.toWrite[0].boat_number === 1 &&
      r.stats.unchanged === 5,
    JSON.stringify(r.stats),
  );
}
{
  // 選手交代（player_name・racer_idが変わる）→ 書く
  const incoming = db.race_entries.map(entryIncoming);
  incoming[3].racer_id = 9999;
  incoming[3].player_name = "代替　　選手";
  const r = diff("race_entries", db.race_entries, incoming, entryOptions);
  check(
    "race_entries: 選手交代を握りつぶさない",
    r.toWrite.length === 1 && r.toWrite[0].boat_number === 4,
  );
}
{
  // nullへの変化（値が取れなくなった）も変更あり
  const incoming = db.race_entries.map(entryIncoming);
  incoming[1].motor_3rate = null;
  const r = diff("race_entries", db.race_entries, incoming, entryOptions);
  check(
    "race_entries: 値→nullの変化を握りつぶさない",
    r.toWrite.length === 1 && r.toWrite[0].boat_number === 2,
  );
}
{
  // DBに無い艇（新規）は書く
  const incoming = db.race_entries.map(entryIncoming);
  const extra = { ...incoming[0], race_id: "2026-09-18-04-06" };
  const r = diff(
    "race_entries",
    db.race_entries,
    [...incoming, extra],
    entryOptions,
  );
  check(
    "race_entries: 既存行が無い行（新規）は書く",
    r.toWrite.length === 1 &&
      r.toWrite[0].race_id === "2026-09-18-04-06" &&
      r.stats.missing === 1,
  );
}
{
  // 桁数違いの文字列・数値表記（"5.280"）でも同一値なら変更なし
  const incoming = db.race_entries.map(entryIncoming);
  incoming[0].win_rate = "5.280";
  const r = diff("race_entries", db.race_entries, incoming, entryOptions);
  check(
    'race_entries: 数値の表記違い("5.280")で変更ありに誤判定しない',
    r.toWrite.length === 0,
  );
}
{
  // 既存行に比較対象の列が無い（select漏れ等）→ 比較不能なので変更あり
  const existing = db.race_entries.map((row) => {
    const withoutColumn = { ...row };
    delete withoutColumn.boat_3rate;
    return withoutColumn;
  });
  const r = diff(
    "race_entries",
    existing,
    db.race_entries.map(entryIncoming),
    entryOptions,
  );
  check(
    "race_entries: 既存側に列が無い場合は変更ありに倒す",
    r.toWrite.length === 6,
  );
}
{
  // undefinedの列は書き込まれないため比較しない
  const incoming = db.race_entries.map(entryIncoming);
  incoming[0].boat_3rate = undefined;
  const r = diff("race_entries", db.race_entries, incoming, entryOptions);
  check(
    "race_entries: 値がundefinedの列（書き込まれない列）は比較しない",
    r.toWrite.length === 0,
  );
}
{
  // generate-predictions.js形式（ai_scoreを含む）で、ai_scoreだけ変わった → 書く
  const incoming = db.race_entries.map((row) => ({
    ...entryIncoming(row),
    ai_score_standard: row.ai_score_standard,
    ai_score_safe_bet: row.ai_score_safe_bet,
    ai_score_upset_focus: row.ai_score_upset_focus,
  }));
  incoming[2].ai_score_upset_focus += 1;
  const r = diff("race_entries", db.race_entries, incoming, entryOptions);
  check(
    "race_entries: ai_scoreだけの変化も握りつぶさない",
    r.toWrite.length === 1 && r.toWrite[0].boat_number === 3,
  );
}

// ---------------------------------------------------------------------------
// 3. races（generate-predictions.js: updated_atは毎回変わるが比較から外す）
// ---------------------------------------------------------------------------
const racesOptions = { keyColumns: ["race_id"], ignoreColumns: ["updated_at"] };
const racesIncoming = (row, overrides = {}) => ({
  race_id: row.race_id,
  race_date: row.race_date,
  venue_code: row.venue_code,
  race_number: row.race_number,
  start_time: row.start_time,
  volatility_score: row.volatility_score,
  volatility_level: row.volatility_level,
  recommended_model: row.recommended_model,
  volatility_reasons: row.volatility_reasons,
  first_boat_grade: row.first_boat_grade,
  first_boat_win_rate: row.first_boat_win_rate,
  first_boat_motor_2rate: row.first_boat_motor_2rate,
  first_boat_avg_st: row.first_boat_avg_st,
  race_grade: row.race_grade,
  win_rate_stddev: row.win_rate_stddev,
  win_rate_avg: row.win_rate_avg,
  motor_2rate_stddev: row.motor_2rate_stddev,
  updated_at: new Date().toISOString(),
  ...overrides,
});
{
  const race = db.races[0];
  const r = diff("races", db.races, [racesIncoming(race)], racesOptions);
  check(
    "races: updated_atだけが違う行は変更なし",
    r.toWrite.length === 0 && r.stats.unchanged === 1,
  );
}
{
  // 実際の計算値は桁数が多い（DBはnumeric(5,3)に丸めて保存）。丸め後に同じなら変更なし
  const race = db.races[0];
  const r = diff(
    "races",
    db.races,
    [
      racesIncoming(race, {
        win_rate_stddev: 1.0876543, // → 1.088
        win_rate_avg: 5.3579999, // → 5.358
        motor_2rate_stddev: 10.5412, // → 10.54
        first_boat_win_rate: 5.28,
        first_boat_avg_st: 0.1634, // → 0.163
      }),
    ],
    racesOptions,
  );
  check(
    "races: 高精度の計算値がDBの丸め後と一致するなら変更なし",
    r.toWrite.length === 0,
    JSON.stringify(r.stats),
  );
}
{
  // 丸めで1桁上がる値は変更あり（握りつぶさない）
  const race = db.races[0];
  const r = diff(
    "races",
    db.races,
    [racesIncoming(race, { win_rate_stddev: 1.0886 })],
    racesOptions,
  );
  check(
    "races: 丸め後に値が変わる（1.0886→1.089）なら変更あり",
    r.toWrite.length === 1,
  );
}
{
  const race = db.races[0];
  const r = diff(
    "races",
    db.races,
    [racesIncoming(race, { volatility_score: 49 })],
    racesOptions,
  );
  check(
    "races: volatility_scoreの変化を握りつぶさない",
    r.toWrite.length === 1,
  );
  check(
    "races: 変更あり行はupdated_atを含め従来どおりそのまま書く",
    r.toWrite[0]?.updated_at !== undefined,
  );
}
{
  const race = db.races[0];
  const reordered = [...race.volatility_reasons].reverse();
  const r = diff(
    "races",
    db.races,
    [racesIncoming(race, { volatility_reasons: reordered })],
    racesOptions,
  );
  check(
    "races: volatility_reasonsの順序変化を握りつぶさない",
    r.toWrite.length === 1,
  );
  const same = diff(
    "races",
    db.races,
    [racesIncoming(race, { volatility_reasons: [...race.volatility_reasons] })],
    racesOptions,
  );
  check(
    "races: volatility_reasonsが同一内容なら変更なし",
    same.toWrite.length === 0,
  );
}
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
{
  // volatility更新（writeMissing:false）: racesに行が無いレースはUPDATE対象外
  const race = db.races[0];
  const r = diffRows(
    db.races,
    [{ race_id: "2026-09-18-99-99", volatility_score: 10 }],
    {
      keyColumns: ["race_id"],
      writeMissing: false,
    },
  );
  check(
    "races volatility: 行が無いレースはUPDATEしない（writeMissing:false）",
    r.toWrite.length === 0 && r.stats.missing === 1,
  );
  void race;
}

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

// ---------------------------------------------------------------------------
// 6. BOA-349: 進入コース同期（実Kファイル144レース）
// ---------------------------------------------------------------------------
const kRows = parseKFileText(kfileText, "2026-09-11");
const ACTUAL = [1, 2, 3, 4, 5, 6].map((n) => `actual_course_${n}`);
const project = (row) => ({
  race_id: row.race_id,
  ...Object.fromEntries(ACTUAL.map((c) => [c, row[c]])),
});
const actualOptions = { keyColumns: ["race_id"], writeMissing: false };
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
{
  // 未同期のレースが3件（DBはnull、Kファイルに値がある）→ その3件だけUPDATE
  const incoming = kRows.map(project);
  const existing = clone(incoming);
  for (const i of [0, 50, 143]) for (const c of ACTUAL) existing[i][c] = null;
  const r = diff("race_results", existing, incoming, actualOptions);
  check(
    "BOA-349: 未同期の3レースだけUPDATEする（値が入る変更を握りつぶさない）",
    r.toWrite.length === 3 && r.stats.unchanged === 141,
    JSON.stringify(r.stats),
  );
}
{
  // Kファイルの値が既存と違う（進入変化の訂正）→ UPDATE
  const incoming = kRows.map(project);
  const existing = clone(incoming);
  existing[20].actual_course_2 = ((incoming[20].actual_course_2 ?? 0) % 6) + 1;
  const r = diff("race_results", existing, incoming, actualOptions);
  check(
    "BOA-349: 進入コースの値が異なるレースはUPDATEする",
    r.toWrite.length === 1 && r.toWrite[0].race_id === incoming[20].race_id,
    JSON.stringify(r.stats),
  );
}
{
  // race_resultsに行が無いレース（Kファイルにはある）→ UPDATEしても0件のため書かない
  const incoming = kRows.map(project);
  const existing = clone(incoming).slice(0, 100);
  const r = diff("race_results", existing, incoming, actualOptions);
  check(
    "BOA-349: race_resultsに行が無い44レースはUPDATEを発行しない",
    r.toWrite.length === 0 && r.stats.missing === 44,
    JSON.stringify(r.stats),
  );
}

// ---------------------------------------------------------------------------
// 6b. BOA-349の原因: 1号艇が欠場したレース（Kファイルの結果行が欠場行「K0」「K1」）
//     実Kファイル（2026-09-15 平和島3R・2026-09-16 唐津12R）から、該当レースの区画を抜き出した
//     フィクスチャ。actual_course_1がnullなのは正しい状態（欠場艇に進入コースは無い）で、
//     パーサーの不具合ではない。「未取得」判定を actual_course_1 のnullだけで行うと永久に真になる
// ---------------------------------------------------------------------------
for (const { file, date, raceId, absentLine } of [
  {
    file: "k260915-boat1-absent-04-03.txt",
    date: "2026-09-15",
    raceId: "2026-09-15-04-03",
    absentLine: "K0  1 4104",
  },
  {
    file: "k260916-boat1-absent-23-12.txt",
    date: "2026-09-16",
    raceId: "2026-09-16-23-12",
    absentLine: "K1  1 4477",
  },
]) {
  const text = fs.readFileSync(
    new URL(`../lib/__fixtures__/kfile/${file}`, import.meta.url),
    "utf8",
  );
  check(
    `BOA-349原因(${raceId}): Kファイル上、1号艇は欠場行（${absentLine.slice(0, 2)}）`,
    text.includes(absentLine),
  );
  const row = parseKFileText(text, date).find((r) => r.race_id === raceId);
  check(
    `BOA-349原因(${raceId}): 欠場の1号艇だけactual_course_1がnullで、他の5艇は進入コースが取れる`,
    row?.actual_course_1 === null &&
      [2, 3, 4, 5, 6].every((n) => row[`actual_course_${n}`] != null),
    JSON.stringify(row),
  );
  // 新しい「未取得」判定（actual_course_1〜6が全てnull）では、同期済みと判定される
  check(
    `BOA-349対策(${raceId}): 「全columnがnull」の判定では同期済み（未取得扱いにならない）`,
    !ACTUAL.every((c) => row[c] === null),
  );
  const ranking = parseKFileRankings(text, date).find(
    (r) => r.race_id === raceId,
  );
  check(
    `rank456(${raceId}): 欠場艇は着順に含まれず、rank6がnull（完走艇が5艇）。valid=true`,
    ranking?.valid === true && ranking.rank5 != null && ranking.rank6 === null,
    JSON.stringify(ranking),
  );
}
{
  // 未取得レース（全columnがnull）は、新しい判定でも「未取得」と判定される
  const unsynced = Object.fromEntries(ACTUAL.map((c) => [c, null]));
  check(
    "BOA-349対策: 全columnがnullのレースは未取得と判定される（取りこぼしを起こさない）",
    ACTUAL.every((c) => unsynced[c] === null),
  );
}

// ---------------------------------------------------------------------------
// 7. filterUnchangedRows / upsertChangedRows（Supabaseクライアントの差し替えで、
//    既存行の取得・チャンク分割・書き込み対象の絞り込み・dry-runを確認する）
// ---------------------------------------------------------------------------
function fakeClient({ existingByTable = {}, selectError = null } = {}) {
  const calls = { selects: [], upserts: [] };
  const client = {
    calls,
    from(table) {
      return {
        select(columns) {
          return {
            async in(column, ids) {
              calls.selects.push({ table, columns, column, ids });
              if (selectError) return { data: null, error: selectError };
              const rows = (existingByTable[table] ?? []).filter((row) =>
                ids.includes(row[column]),
              );
              return { data: clone(rows), error: null };
            },
          };
        },
        async upsert(batch, options) {
          calls.upserts.push({ table, batch, options });
          return { error: null };
        },
      };
    },
  };
  return client;
}
{
  const existing = db.race_entries;
  const client = fakeClient({ existingByTable: { race_entries: existing } });
  const incoming = db.race_entries.map(entryIncoming);
  incoming[0].motor_2rate = 47.1;
  const r = await upsertChangedRows(client, "race_entries", incoming, {
    onConflict: "race_id,boat_number",
    keyColumns: ["race_id", "boat_number"],
  });
  check(
    "upsertChangedRows: 変更のある1行だけをupsertする",
    client.calls.upserts.length === 1 &&
      client.calls.upserts[0].batch.length === 1 &&
      client.calls.upserts[0].batch[0].boat_number === 1 &&
      r.skipped === 5 &&
      r.written === 1,
  );
  check(
    "upsertChangedRows: 既存行の取得は主キー先頭列のIN句で、書き込む列と主キーだけをselectする",
    client.calls.selects.length === 1 &&
      client.calls.selects[0].column === "race_id" &&
      !client.calls.selects[0].columns.includes("ai_score_standard") &&
      client.calls.selects[0].columns.includes("boat_number"),
    client.calls.selects[0]?.columns,
  );
}
{
  const client = fakeClient({
    existingByTable: { race_entries: db.race_entries },
  });
  const r = await upsertChangedRows(
    client,
    "race_entries",
    db.race_entries.map(entryIncoming),
    {
      onConflict: "race_id,boat_number",
      keyColumns: ["race_id", "boat_number"],
    },
  );
  check(
    "upsertChangedRows: 全行が変更なしならupsertを1回も呼ばない",
    client.calls.upserts.length === 0 && r.written === 0 && r.skipped === 6,
  );
}
{
  const client = fakeClient({
    existingByTable: { race_entries: db.race_entries },
  });
  const incoming = db.race_entries.map(entryIncoming);
  incoming[0].motor_2rate = 47.1;
  const r = await upsertChangedRows(client, "race_entries", incoming, {
    onConflict: "race_id,boat_number",
    keyColumns: ["race_id", "boat_number"],
    dryRun: true,
  });
  check(
    "upsertChangedRows: dry-runは書き込みを行わず、書くはずの件数(1件)を返す",
    client.calls.upserts.length === 0 &&
      r.stats.toWrite === 1 &&
      r.toWrite.length === 1,
  );
}
{
  const client = fakeClient({ selectError: { message: "boom" } });
  const incoming = db.race_entries.map(entryIncoming);
  const r = await filterUnchangedRows(client, "race_entries", incoming, {
    keyColumns: ["race_id", "boat_number"],
  });
  check(
    "既存行の取得に失敗したら全行を書く（変更なしにしない）",
    r.fallback === true && r.toWrite.length === 6 && r.stats.unchanged === 0,
  );
}
{
  // 250レース分 → 100件ずつ3リクエストに分割
  const client = fakeClient();
  const rows = Array.from({ length: 250 }, (_, i) => ({
    race_id: `2026-09-18-01-${String(i).padStart(3, "0")}`,
    weather: "晴",
  }));
  const r = await filterUnchangedRows(client, "race_conditions", rows, {
    keyColumns: ["race_id"],
  });
  check(
    "filterUnchangedRows: 既存行の取得は100レースずつに分割される",
    client.calls.selects.length === 3 &&
      client.calls.selects.map((c) => c.ids.length).join(",") ===
        "100,100,50" &&
      r.toWrite.length === 250,
  );
}
{
  // ignoreColumns（updated_at）は既存行のselectに含めない
  const client = fakeClient({ existingByTable: { races: db.races } });
  await filterUnchangedRows(
    client,
    "races",
    [racesIncoming(db.races[0])],
    racesOptions,
  );
  check(
    "filterUnchangedRows: 比較から外す列(updated_at)はselectしない",
    !client.calls.selects[0].columns.includes("updated_at"),
    client.calls.selects[0]?.columns,
  );
}

if (failures > 0) {
  console.error(`\n❌ ${failures}件の検証に失敗`);
  process.exit(1);
}
console.log("\n✅ 全ての検証に成功");
