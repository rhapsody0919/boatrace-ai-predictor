/**
 * レース情報（A1）・展示（A2）の shadow で記録する result_digest（scrape_slots.result_digest）の計算。
 *
 * shadow は、取得・解析までして、データテーブルへは書かない。書かない代わりに、解析した結果のダイジェスト
 * （ハッシュ）を予定表に残し、既存基盤（GitHub Actions・Vercel の従来の展示関数）が race_entries・race_conditions・
 * races・exhibition_data に書いた値から、同じ関数で計算したダイジェストと比べて、一致率を測る
 * （scripts/maintenance/check-pre-race-shadow.js。tasks.md T4b-09-3・T4b-06、verification-runbook.md Q）。
 *
 * 比べる列は、マイグレーション081・082より前から存在する列に限る。081・082の適用の前後、書き込み側が新しい列を
 * 書く・書かないに依らず、同じダイジェストになるようにするため（新しい列の一致は、verify:pre-race-parsers が
 * フィクスチャで検証する）。値は、出走表・直前情報のページから解析する列のみで、取得時刻・気象は含めない
 * （気象は展示側で、観測のたびに変わる）。
 * 純粋関数（DB・取得先に接続しない）。
 */
import { createHash } from "node:crypto";

/** race_entries のダイジェスト対象の列（buildRaceEntryRows の、081以前からある列） */
export const RACE_ENTRY_DIGEST_COLUMNS = Object.freeze([
  "boat_number",
  "racer_id",
  "player_name",
  "grade",
  "age",
  "win_rate",
  "local_win_rate",
  "global_2rate",
  "local_2rate",
  "global_3rate",
  "local_3rate",
  "motor_number",
  "motor_2rate",
  "motor_3rate",
  "boat_number_id",
  "boat_2rate",
  "boat_3rate",
]);

/** race_conditions のダイジェスト対象の列（出走表の節・レース名。気象は含めない） */
export const RACE_CONDITION_DIGEST_COLUMNS = Object.freeze([
  "series_day",
  "is_final_day",
  "race_title",
  "race_stage",
]);

/** exhibition_data のダイジェスト対象の列（buildExhibitionRows の、082以前からある列） */
export const EXHIBITION_DIGEST_COLUMNS = Object.freeze([
  "boat_number",
  "exhibition_time",
  "start_timing",
  "tilt",
  "propeller_change",
  "parts_changed",
  "adjustment_weight",
  "today_weight",
  "prev_race_no",
  "prev_entry_course",
  "prev_start_timing",
  "prev_finish_rank",
]);

// undefined と null を同一視する。数値は有限のものだけ（DBの numeric が返す数値と解析値を同じ表記に揃える）。
// 配列（parts_changed）は、要素を並べた文字列にする（DBのtext[]とJSの配列の表記の差を無くす）
function normalizeValue(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.length === 0 ? null : value.join("|");
  return value;
}

const pick = (row, columns) =>
  columns.map((column) => normalizeValue(row?.[column]));

const sha1 = (value) =>
  createHash("sha1").update(JSON.stringify(value)).digest("hex").slice(0, 16);

/** 艇番の昇順に並べる（重複があれば例外。同じ艇の行が2つあると、比較が意味を持たない） */
function sortedByBoat(rows, label) {
  const sorted = [...(rows ?? [])].sort(
    (a, b) => Number(a.boat_number) - Number(b.boat_number),
  );
  const boats = sorted.map((r) => Number(r.boat_number));
  if (new Set(boats).size !== boats.length) {
    throw new Error(`${label}に艇番の重複があります: ${JSON.stringify(boats)}`);
  }
  return sorted;
}

/**
 * レース情報（A1）のダイジェスト。
 *
 * @param {Object} input
 * @param {Array<Record<string, unknown>>} input.entries race_entries の行（DBの行でも、解析して組み立てた行でもよい）
 * @param {Record<string, unknown>|null} input.condition race_conditions の行（無ければ null）
 * @param {string|null} input.raceGrade races.race_grade（無ければ null）
 * @returns {string} SHA-1の先頭16桁
 */
export function computeRaceInfoDigest({ entries, condition, raceGrade }) {
  return sha1([
    sortedByBoat(entries, "出走表").map((row) =>
      pick(row, RACE_ENTRY_DIGEST_COLUMNS),
    ),
    condition ? pick(condition, RACE_CONDITION_DIGEST_COLUMNS) : null,
    normalizeValue(raceGrade),
  ]);
}

/**
 * 展示（A2）のダイジェスト。展示タイム・展示STのある艇の行だけを比べる（buildExhibitionRows の、082未適用の形。
 * 欠場艇の行は、082適用後にだけ書かれるため含めない）。
 *
 * @param {Array<Record<string, unknown>>} rows exhibition_data の行
 * @returns {string} SHA-1の先頭16桁
 */
export function computeExhibitionDigest(rows) {
  const withValues = (rows ?? []).filter(
    (r) =>
      (r?.exhibition_time !== null && r?.exhibition_time !== undefined) ||
      (r?.start_timing !== null && r?.start_timing !== undefined),
  );
  return sha1(
    sortedByBoat(withValues, "展示データ").map((row) =>
      pick(row, EXHIBITION_DIGEST_COLUMNS),
    ),
  );
}
