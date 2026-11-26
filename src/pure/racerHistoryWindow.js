/**
 * 選手ページの走ごとの履歴の窓（getRacerRaceHistory の期間）と、その窓を月ごとに分ける計算。
 * 窓の始まりは src/utils/racerVenueBoatStats.js の racerHistoryCutoff と同じ式（見た時刻から730日前を UTC の日付にする）。
 * 回収率の全国の基準の集計（scripts/lib/racerBoatReturnBaselineJob.js、docs/design/racer-return-baseline/db-draft.md）が
 * Node から読むので src/pure に置く（src/utils は Node から読まない）。始まりの日は直書きしない（BOA-1719 の取り込みで延びる）
 */

export const RACER_HISTORY_DAYS = 730;

/**
 * @param {Date} now
 * @returns {string} 窓の始まり（YYYY-MM-DD）
 */
export function racerHistoryWindowStart(now) {
  const d = new Date(now.getTime());
  d.setDate(d.getDate() - RACER_HISTORY_DAYS);
  return d.toISOString().split("T")[0];
}

/** YYYY-MM-DD に n 日を足す（UTC で数える） */
export function addDaysIso(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * [from, to]（両端を含む）を暦の月ごとに分ける。RPC を月ごとに呼んで 8秒の打ち切りを避けるため
 * @returns {Array<[string, string]>} 古い順
 */
export function monthRanges(from, to) {
  const out = [];
  let start = from;
  while (start <= to) {
    const [y, m] = start.split("-").map(Number);
    const monthEnd = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    const end = monthEnd < to ? monthEnd : to;
    out.push([start, end]);
    start = addDaysIso(end, 1);
  }
  return out;
}
