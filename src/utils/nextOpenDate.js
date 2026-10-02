/**
 * 非開催会場の「次開催日」を節（race_series）から求める（BOA-225）。
 *
 * race_series は公式の月間スケジュール由来の「予定」で、前月〜翌月を毎日取り直している
 * （api/cron/race-series.js）。次開催は「開始日が今日より後の節のうち最も早いもの」。
 * 節の期間中（start_date <= 今日 <= end_date）の会場は、中止・順延で本日レースが無くても
 * 次開催を出さない（予定上は開催中で、順延後の日程は race_series に反映されないため）。
 */

/**
 * @param {Array<{venue_code: number, start_date: string, end_date: string}>} seriesRows
 *   end_date >= today の節（期間中と未来）
 * @param {string} today - YYYY-MM-DD（JST）
 * @returns {Map<number, string>} 会場コード → 次開催日（YYYY-MM-DD）
 */
export function computeNextOpenDates(seriesRows, today) {
  const inSeries = new Set();
  const next = new Map();
  for (const row of seriesRows || []) {
    const code = Number(row.venue_code);
    if (row.start_date <= today && today <= row.end_date) {
      inSeries.add(code);
      continue;
    }
    if (row.start_date <= today) continue;
    const current = next.get(code);
    if (!current || row.start_date < current) next.set(code, row.start_date);
  }
  for (const code of inSeries) next.delete(code);
  return next;
}

/** YYYY-MM-DD → "M/D"（カードが狭いので曜日は付けない。4言語共通の数字表記） */
export function formatMonthDay(dateStr) {
  const [, m, d] = dateStr.split("-");
  return `${Number(m)}/${Number(d)}`;
}
