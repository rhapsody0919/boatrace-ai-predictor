/**
 * 会場別の1号艇勝率（直近N日）の集計（BOA-303）。
 * scripts/maintenance/update-venue-stats.js が venues.avg_first_win_rate と
 * avg_first_win_rate_race_count に保存し、分析ツールの「1号艇勝率ランキング」は保存値を読む。
 *
 * 母数から外すもの: 結果の行が無い、不成立（race_status='no_race'。旧フラグ is_no_race は全行 false で
 * 効かない、078）、rank1 が NULL（中止・未確定）。返還（partial_refund）は着順が有効なので数える。
 */
import { isNoRaceResult } from "./raceOutcomeFilters.js";

/**
 * @param {Array<{venue_code: number, race_results: object|object[]|null}>} races
 * @returns {Map<number, {raceCount: number, firstWins: number}>}
 */
export function aggregateFirstWinRate(races) {
  const byVenue = new Map();
  for (const race of races || []) {
    const result = Array.isArray(race.race_results)
      ? race.race_results[0]
      : race.race_results;
    if (!result || isNoRaceResult(result) || result.rank1 == null) continue;
    const v = byVenue.get(race.venue_code) ?? { raceCount: 0, firstWins: 0 };
    v.raceCount += 1;
    if (result.rank1 === 1) v.firstWins += 1;
    byVenue.set(race.venue_code, v);
  }
  return byVenue;
}
