/**
 * 選手ページの冒頭の1行目「MM/DD の出走表」（#3258 の #2）。
 * 出走表の全国勝率・2連率は「今期の累積」ではなく、当月を含む直近6か月（起点は毎月1日）で、節の初日に固まる
 * （official-data-spec の照合 2026-11-23、docs/design/racer-wt-uiux-2026-11/analysis/number-scope.md）。
 * だから「今期」とは書かず、出走表の日付を付ける。F 数だけは期の中の本数で 5/1・11/1 に0へ戻るので、
 * その出走が今日と同じ期の中のときだけ出す（期をまたいだら出さない。0とも書かない）
 */

/** f_count が安定して入り始めた日（docs/design/analysis-visualization-upgrade/screens.md「Fバッジの仕様」） */
export const F_COUNT_RELIABLE_FROM = "2026-09-21";

/** 公式の期（5/1〜10/31・11/1〜4/30）の鍵。YYYY-MM-DD を受ける */
export function officialPeriodKey(date) {
  const [y, m] = date.split("-").map(Number);
  if (m >= 5 && m <= 10) return `${y}-a`;
  return m >= 11 ? `${y}-b` : `${y - 1}-b`;
}

/**
 * @param {{race_id:string, win_rate:number|null, global_2rate:number|null, f_count:number|null}|null} row 最新の race_entries の行
 * @param {string} today JST の今日（YYYY-MM-DD）
 * @returns {{dateLabel:string, winRate:number, top2Rate:number|null, fCount:number|null}|null}
 *   出走表の勝率が無い・0.00（新人）のときは null（行を出さない）
 */
export function latestEntryLine(row, today) {
  if (!row?.race_id || row.win_rate == null || !(row.win_rate > 0)) return null;
  const date = row.race_id.slice(0, 10);
  const samePeriod = officialPeriodKey(date) === officialPeriodKey(today);
  const fCount =
    row.f_count != null && date >= F_COUNT_RELIABLE_FROM && samePeriod ? row.f_count : null;
  return {
    dateLabel: date.replaceAll("-", "/"),
    winRate: row.win_rate,
    top2Rate: row.global_2rate ?? null,
    fCount,
  };
}
