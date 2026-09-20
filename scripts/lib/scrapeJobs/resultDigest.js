/**
 * 結果取得（A6）の shadow で記録する result_digest（scrape_slots.result_digest）の計算。
 *
 * shadow は、取得・解析までして、データテーブルへは書かない。書かない代わりに、解析した結果の
 * ダイジェスト（ハッシュ）を予定表に残し、既存基盤（GitHub Actions）が race_results・race_start_timings に
 * 書いた値から同じ関数で計算したダイジェストと比べて、一致率を測る
 * （scripts/maintenance/check-result-shadow.js。plan.md §4.6、tasks.md T4b-02-3）。
 *
 * 比べる列は、結果ページ（raceresult）から解析する列に限る。
 *   - result_at（取得時刻）は、取得のたびに変わり情報を持たないため含めない
 *   - actual_course_1〜6のKファイル由来の同期・的中フラグ・気象は、別経路の値のため含めない
 *     （rank4〜6は結果ページにもあるため含める。Kファイルは、パース結果が rank1〜3 と一致する場合のみ、
 *     同じ順位で埋めるため、両者は一致する）
 * 純粋関数（DB・取得先に接続しない）。
 */
import { createHash } from "node:crypto";

/** ダイジェストに含める race_results の列（buildRaceResultRow が作る列から result_at を除いたもの） */
export const RESULT_DIGEST_COLUMNS = Object.freeze([
  "race_id",
  "rank1",
  "rank2",
  "rank3",
  "rank4",
  "rank5",
  "rank6",
  "race_time_1",
  "race_time_2",
  "race_time_3",
  "race_time_4",
  "race_time_5",
  "race_time_6",
  "payout_win",
  "payout_place_1",
  "payout_place_2",
  "payout_trifecta",
  "payout_trio",
  "payout_exacta",
  "payout_quinella",
  "payout_wide_1",
  "payout_wide_2",
  "payout_wide_3",
  "popularity_trifecta",
  "popularity_trio",
  "popularity_exacta",
  "popularity_quinella",
  "popularity_wide_1",
  "popularity_wide_2",
  "popularity_wide_3",
  "winning_technique",
  "course_1",
  "course_2",
  "course_3",
  "course_4",
  "course_5",
  "course_6",
]);

/** ダイジェストに含める race_start_timings の列 */
export const START_TIMING_DIGEST_COLUMNS = Object.freeze([
  "boat_number",
  "start_timing",
  "is_flying",
  "is_late_start",
]);

// undefined と null を同一視する。数値は有限のものだけ（DBの numeric が返す数値と解析値を同じ表記に揃える）
function normalizeValue(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  return value;
}

/** race_results の行から、ダイジェスト対象の列だけを、決まった順序で取り出す */
export function pickResultColumns(row) {
  return RESULT_DIGEST_COLUMNS.map((column) => normalizeValue(row?.[column]));
}

/** race_start_timings の行の一覧から、対象の列だけを、艇番順に取り出す（艇番の重複があれば例外） */
export function pickStartTimingColumns(rows) {
  // STを読めなかった艇（欠場・出遅れ。マイグレーション077以降に書く行）は、旧実装では行が無かった。
  // 077の適用前後・解析側とDB側で同じダイジェストになるよう、STのある行だけを比べる
  const withTiming = (rows ?? []).filter(
    (r) => r?.start_timing !== null && r?.start_timing !== undefined,
  );
  const sorted = [...withTiming].sort(
    (a, b) => Number(a.boat_number) - Number(b.boat_number),
  );
  const boats = sorted.map((r) => Number(r.boat_number));
  if (new Set(boats).size !== boats.length) {
    throw new Error(
      `スタート情報に艇番の重複があります: ${JSON.stringify(boats)}`,
    );
  }
  return sorted.map((r) =>
    START_TIMING_DIGEST_COLUMNS.map((column) => normalizeValue(r?.[column])),
  );
}

/**
 * 結果の行とスタート情報の一覧から、ダイジェスト（SHA-1の先頭16桁）を作る。
 *
 * @param {Record<string, unknown>} row race_results の行（DBの行でも、解析して組み立てた行でもよい）
 * @param {Array<Record<string, unknown>>} startTimings race_start_timings の行の一覧（無ければ空）
 * @returns {string}
 */
export function computeResultDigest(row, startTimings = []) {
  const canonical = JSON.stringify([
    pickResultColumns(row),
    pickStartTimingColumns(startTimings),
  ]);
  return createHash("sha1").update(canonical).digest("hex").slice(0, 16);
}
