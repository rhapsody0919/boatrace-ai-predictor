/**
 * meetGrouping - 節（開催）のグルーピング共通ロジック
 *
 * 節の範囲はrace_idの日付部分の連続性で推定する（モーターは節単位で入れ替わる
 * ため、日付が連続していれば同じ節とみなせる）。実装当時（2026-09-15）は
 * race_conditions.series_day/is_final_dayが全件nullだったためこの方式にしたが、
 * 現在はBOA-226・BOA-390のバックフィルで2026-02以降99.8%埋まっている。
 * この2列に切り替えるかは未検討で、挙動は当時のまま（日付の連続性で推定）。
 * racerService.jsのモーター使用履歴（BOA-265）で最初に実装したロジックを、
 * BOA-304の「今節展示情報」でも再利用するため共通関数として抜き出した。
 */

/**
 * race_id昇順ソート済みの配列を受け取り、末尾（最新）から遡って日付の間隔が
 * maxGapDays以下の連続区間のみを1節として抜き出す
 * @param {Array<{race_id: string}>} sortedAscEntries - race_id（YYYY-MM-DD-VV-RR）昇順ソート済み
 * @param {number} maxGapDays - この日数を超えて空いたら別節とみなす
 * @returns {Array} 抜き出した節（昇順のまま）
 */
export function groupIntoCurrentMeet(sortedAscEntries, maxGapDays = 2) {
  if (!sortedAscEntries || sortedAscEntries.length === 0) return [];
  const meet = [sortedAscEntries[sortedAscEntries.length - 1]];
  for (let i = sortedAscEntries.length - 2; i >= 0; i--) {
    const currentDate = new Date(meet[0].race_id.slice(0, 10));
    const prevDate = new Date(sortedAscEntries[i].race_id.slice(0, 10));
    const diffDays = (currentDate - prevDate) / (1000 * 60 * 60 * 24);
    if (diffDays > maxGapDays) break;
    meet.unshift(sortedAscEntries[i]);
  }
  return meet;
}
