/**
 * 会場ページの「1R〜12R」のボタンの状態（docs/design/venue-race-card-redesign/approved.md）。本日は次の発走レース
 * （liveNextIndex、無ければ -1）より前を done、そのレースを next。過去日付は全部終わっているので状態を付けない（null）
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
