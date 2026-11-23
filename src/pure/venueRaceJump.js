/**
 * 会場ページの見出しの下の「1R〜12R」のボタン（公式スマホの形、docs/design/venue-race-card-redesign/approved.md）の状態。
 *
 * 本日ビューだけ、いまの時刻での次の発走レース（liveNextIndex。VenueRaceListPageModel の buildListState）で
 * 前を「終わった」、そのレースを「次」にする。次が無い（全レース締切後）なら全部「終わった」。
 * 過去日付は状態を付けない（全部終わっているので、灰にしても情報にならない）。
 *
 * @param {{id: string, raceNumber: number}[]} venueRaces - レース番号順
 * @param {number} liveNextIndex - 次の発走レースの位置。無ければ -1
 * @param {boolean} isToday
 * @returns {{id: string, raceNumber: number, state: "done"|"next"|"upcoming"|null}[]}
 */
export function venueRaceJumpItems(venueRaces, liveNextIndex, isToday) {
  return venueRaces.map((race, index) => ({
    id: race.id,
    raceNumber: race.raceNumber,
    state: !isToday
      ? null
      : liveNextIndex < 0 || index < liveNextIndex
        ? "done"
        : index === liveNextIndex
          ? "next"
          : "upcoming",
  }));
}
