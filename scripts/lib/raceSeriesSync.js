/**
 * 節（race_series、マイグレーション084）を、月間スケジュールの解析済みページから作って書く共通の部品。
 *
 * 使う側:
 *   - scripts/maintenance/monthly-schedule-backfill.js（過去分の一括。アーカイブの解析済みページから load）
 *   - scripts/lib/raceSeriesJob.js（定期取得。前月・当月・翌月のページをその場で取得して書く）
 *
 * 節の確定には前後1か月のページが要る（表の端に接する節の開始日・終了日を、隣の月のページで確定する）。
 */
import {
  MS_SCHEMA,
  addDays,
  mergeMonthlySchedules,
  parseYm,
} from "./monthlyScheduleParser.js";
import { SERIES_TABLE, buildSeriesRows } from "./raceSeriesRows.js";
import { diffRows } from "./unchangedRows.js";

/** YYYYMM の delta か月前・後 */
export function shiftYm(ym, delta) {
  const { year, month } = parseYm(ym);
  const idx = year * 12 + (month - 1) + delta;
  return `${Math.floor(idx / 12)}${String((idx % 12) + 1).padStart(2, "0")}`;
}

export const ymOf = (date) => `${date.slice(0, 4)}${date.slice(5, 7)}`;
export const firstDayOf = (ym) => `${ym.slice(0, 4)}-${ym.slice(4)}-01`;
export const lastDayOf = (ym) => addDays(firstDayOf(shiftYm(ym, 1)), -1);

/**
 * 公式がまだ節名を出していない節（先の月の節は、日程と色分けだけが先に載り、節名のリンクが後から付く）。
 * 構造の変更ではないため、定期取得はこの要確認だけを許す。節名は NULL で書き、節名が載った後の取得で書き直す。
 */
export const UNTITLED_SEGMENT_RE = /^端以外の節に節名のリンクがありません/;

/**
 * 解析済みのページから、開始日が fromYm〜toYm の月にある節の行を作る。pages には、前後1か月を含める。
 * @param {object[]} pages parseMonthlySchedule の結果（monthly-schedule/v1）
 * @returns {{rows: object[], unresolved: object[], anomalies: object[]}}
 *   unresolved は、範囲内に開始日・終了日が収まるのに確定できなかった節（前後1か月があれば、通常は0件）
 */
export function planRaceSeriesRows(pages, fromYm, toYm) {
  for (const p of pages)
    if (p.schema !== MS_SCHEMA)
      throw new Error(`${p.ym}: 未対応のスキーマ ${p.schema}`);
  const merged = mergeMonthlySchedules(pages);
  const from = firstDayOf(fromYm);
  const to = lastDayOf(toYm);
  return {
    rows: buildSeriesRows(merged.series, { from, to }),
    unresolved: merged.unresolved.filter(
      (u) => u.seen_from >= from && u.seen_to <= to,
    ),
    anomalies: merged.anomalies,
  };
}

const sleepDefault = (ms) => new Promise((r) => setTimeout(r, ms));
const chunk = (arr, n) =>
  Array.from({ length: Math.ceil(arr.length / n) }, (_, i) =>
    arr.slice(i * n, i * n + n),
  );

/**
 * 節の行を race_series へ書く。開始日の月ごとに既存の行を読み、値の違う行だけを upsert する。
 * @returns {Promise<{written: number, unchanged: number, failedMonths: number, errors: string[]}>}
 * @throws race_series を読めない（DDL 084 が未適用等）・既存の行の取得に失敗したとき
 */
export async function writeRaceSeriesRows(
  client,
  rows,
  { batchSize = 200, sleepMs = 500, sleep = sleepDefault } = {},
) {
  const probe = await client
    .from(SERIES_TABLE.table)
    .select("venue_code")
    .limit(1);
  if (probe.error)
    throw new Error(
      `${SERIES_TABLE.table} を読めません（DDL 084 が未適用の可能性）: ${probe.error.message}`,
    );
  const byMonth = new Map();
  for (const r of rows) {
    const list = byMonth.get(ymOf(r.start_date)) ?? [];
    list.push(r);
    byMonth.set(ymOf(r.start_date), list);
  }
  const summary = { written: 0, unchanged: 0, failedMonths: 0, errors: [] };
  for (const [ym, monthRows] of [...byMonth.entries()].sort()) {
    const { data, error } = await client
      .from(SERIES_TABLE.table)
      .select(Object.keys(monthRows[0]).join(","))
      .gte("start_date", firstDayOf(ym))
      .lte("start_date", lastDayOf(ym))
      .range(0, 999);
    if (error)
      throw new Error(`${SERIES_TABLE.table} の取得に失敗: ${error.message}`);
    const { toWrite, stats } = diffRows(data ?? [], monthRows, {
      keyColumns: SERIES_TABLE.keyColumns,
    });
    summary.unchanged += stats.unchanged;
    for (const part of chunk(toWrite, batchSize)) {
      const { error: e } = await client
        .from(SERIES_TABLE.table)
        .upsert(part, { onConflict: SERIES_TABLE.onConflict });
      if (e) {
        summary.failedMonths++;
        summary.errors.push(`${ym}: 書き込みに失敗: ${e.message}`);
        break;
      }
      summary.written += part.length;
      await sleep(sleepMs);
    }
  }
  return summary;
}
