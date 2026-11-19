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
import { diffRows, normalizeValue, NUMERIC_SCALES, roundToScale } from "../lib/unchangedRows.js";
import { parseKFileRankings, parseKFileText } from "../lib/kfileParser.js";
import {
  runUnchangedRowsScenes1,
  runUnchangedRowsScenes2,
  runUnchangedRowsScenes3,
} from "./verifyData/unchanged-rows-scenes-1.js";
import { runUnchangedRowsScenes4, runUnchangedRowsScenes5 } from "./verifyData/unchanged-rows-scenes-2.js";
import { runUnchangedRowsScenes6 } from "./verifyData/unchanged-rows-scenes-3.js";

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

// ---- 後半の場面（verifyData/unchanged-rows-scenes-1.js） ----
runUnchangedRowsScenes1({ check, db, kfileText, clone, diff });
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

// ---- 後半の場面（verifyData/unchanged-rows-scenes-1.js） ----
runUnchangedRowsScenes2({ check, db, kfileText, clone, diff });
const ACTUAL = [1, 2, 3, 4, 5, 6].map((n) => `actual_course_${n}`);

// ---- 後半の場面（verifyData/unchanged-rows-scenes-1.js・unchanged-rows-scenes-2.js） ----
runUnchangedRowsScenes3({ check, db, kfileText, clone, diff, ACTUAL });
runUnchangedRowsScenes4({ check, db, clone, diff, entryIncoming, racesOptions, racesIncoming, ACTUAL });

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

// ---- 後半の場面（verifyData/unchanged-rows-scenes-2.js・unchanged-rows-scenes-3.js） ----
await runUnchangedRowsScenes5({ check, db, clone, diff, entryIncoming, racesOptions, racesIncoming, ACTUAL });
await runUnchangedRowsScenes6({ check, clone });

if (failures > 0) {
  console.error(`\n❌ ${failures}件の検証に失敗`);
  process.exit(1);
}
console.log("\n✅ 全ての検証に成功");
