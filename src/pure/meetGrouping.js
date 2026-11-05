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

/**
 * 表示中のレース（`beforeRaceId`）と**同じ会場・同じ節**で、それより前の走だけを
 * 抜き出す（純関数、BOA-591）。
 *
 * `groupIntoCurrentMeet` をそのまま呼ぶと2つずれる。
 *
 * 1. **会場で絞らない**と、別会場の節が地続きのとき1つの節として繋がる。race_id の
 *    会場コード（`YYYY-MM-DD-VV-RR` の VV）で絞る
 * 2. **表示中のレースを目印に足さない**と「表示中のレースより前の最後のまとまり」を
 *    返す。節の初戦（今節の走がまだ無い）で、何ヶ月も前の前の節を今節として拾う
 *
 * @param {Array<{race_id: string}>} entries 1選手分。順序は問わない
 * @param {string} beforeRaceId 表示中のレース（`YYYY-MM-DD-VV-RR`）。結果には含めない
 * @returns {Array} 抜き出した走（race_id 昇順、入力の要素そのまま）
 */
export function groupIntoMeetBeforeRace(entries, beforeRaceId) {
  if (!Array.isArray(entries) || typeof beforeRaceId !== "string") return [];
  const venue = beforeRaceId.slice(11, 13);
  if (!venue) return [];
  const upto = entries
    .filter(
      (e) =>
        typeof e?.race_id === "string" &&
        e.race_id.slice(11, 13) === venue &&
        // **表示中のレースより前**だけ。日付単位（`<=` 同じ日）で切ると、5Rを見て
        // いるのに同じ日の9Rが入る（2026-09-20 桐生5Rで発生）。race_id は固定長
        // なので文字列比較でレース単位に切れる
        e.race_id < beforeRaceId,
    )
    .sort((a, b) => a.race_id.localeCompare(b.race_id));
  const ANCHOR = { race_id: beforeRaceId };
  return groupIntoCurrentMeet([...upto, ANCHOR]).filter((e) => e !== ANCHOR);
}
