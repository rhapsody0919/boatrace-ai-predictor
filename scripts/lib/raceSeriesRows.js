/**
 * 節（開催）の確定結果（mergeMonthlySchedules の series）→ race_series の行への変換（純関数）
 *
 * 出力先: race_series（docs/db-migration/084_race_series.sql）。主キー (venue_code, start_date)。
 *
 * 既存の列との関係（docs/design/racer-period-stats/plan.md §5）:
 *   races.race_grade（racelistの見出しの色分け。SG/G1/G2/G3/ippan）が、レース単位の一次情報で、優先する。
 *   race_series.grade は、その欠落（race_grade がNULLの行）の補完に使う（COALESCE(races.race_grade, race_series.grade)）。
 *   grade が確定するのは、色分けが SG・G1・G2・G3・Ippan の節のみ。オールレディース・ヴィーナス・ルーキー・
 *   マスターズは、月間スケジュールの色分けが1色のため、G3相当か一般かは分からない（grade=NULL、kind で区別する）。
 *   日目（race_conditions.series_day）は race_date − start_date + 1 で導出できる（順延で日がずれた節は、
 *   月間スケジュールが予定のため、実開催日とずれる）。
 */

export const SERIES_TABLE = {
  table: "race_series",
  onConflict: "venue_code,start_date",
  keyColumns: ["venue_code", "start_date"],
};

export const SERIES_COLUMNS = [
  "venue_code",
  "start_date",
  "end_date",
  "total_days",
  "title",
  "class_code",
  "grade",
  "kind",
  "source_ym",
];

/**
 * @param {Array<ReturnType<import("./monthlyScheduleParser.js").mergeMonthlySchedules>["series"][number]>} series
 * @param {{from?: string, to?: string}} [range] 開始日がこの範囲（YYYY-MM-DD、両端含む）の節だけを返す
 */
export function buildSeriesRows(series, { from = null, to = null } = {}) {
  return series
    .filter(
      (s) => (!from || s.start_date >= from) && (!to || s.start_date <= to),
    )
    .map((s) => ({
      venue_code: s.venue_code,
      start_date: s.start_date,
      end_date: s.end_date,
      total_days: s.total_days,
      title: s.title,
      class_code: s.class_code,
      grade: s.grade,
      kind: s.kind,
      source_ym: s.source_yms[0] ?? null,
    }));
}
