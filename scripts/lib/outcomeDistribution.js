/**
 * 出目分布（3連単の出現パターン）の会場別集計。純粋関数（DBに触れない）。
 * scripts/daily/update-outcome-distribution.js（全レース）と update-nige-outcome-distribution.js（逃げのみ）が使う。
 *
 * 平均配当は3連単の配当で出す。race_results の列名は中身と逆で、**payout_trio が3連単、payout_trifecta が3連複**
 * （docs/db-migration/079_race_payouts.sql:29）。2026-09-29 まで payout_trifecta（3連複）を足していたため、画面の
 * 「3連単」の平均配当に3連複の値が出ていた（BOA-535）。
 */

/** 3連単の配当の列（列名と中身が逆: payout_trio = 3連単） */
export const TRIFECTA_PAYOUT_COLUMN = "payout_trio";

/**
 * @param {Array<{race_id: string, rank1: number, rank2: number, rank3: number, payout_trio?: number|null}>} raceResults
 * @param {{today: string}} options today: last_updated に入れる日付（YYYY-MM-DD、JST）
 * @returns {Record<string, Array<{venue_code: number, first_boat: number, second_boat: number, third_boat: number,
 *   count_90days: number, total_races: number, probability: number, avg_payout: number, last_updated: string}>>}
 *   キーは会場コード（文字列）
 *
 * avg_payout: そのパターンで決まったレースのうち、3連単の配当があるレースの平均（円、四捨五入）。
 * 配当が無いレース（不成立等）は、平均の分母に入れない（入れると0円として平均を引き下げる）。1件も無ければ0
 */
export function aggregateOutcomeDistribution(raceResults, { today }) {
  const byVenue = new Map();
  for (const result of raceResults) {
    const venueCode = parseInt(result.race_id.split("-")[3], 10);
    if (!byVenue.has(venueCode)) byVenue.set(venueCode, []);
    byVenue.get(venueCode).push(result);
  }

  const aggregated = {};
  for (const [venueCode, results] of byVenue) {
    const totalRaces = results.length;
    const patterns = new Map();
    for (const result of results) {
      const key = `${result.rank1}-${result.rank2}-${result.rank3}`;
      const p = patterns.get(key) ?? { count: 0, payoutSum: 0, payoutCount: 0 };
      p.count++;
      const payout = result[TRIFECTA_PAYOUT_COLUMN];
      if (payout != null) {
        p.payoutSum += payout;
        p.payoutCount++;
      }
      patterns.set(key, p);
    }
    aggregated[venueCode] = [...patterns].map(([key, p]) => {
      const [firstBoat, secondBoat, thirdBoat] = key
        .split("-")
        .map((n) => parseInt(n, 10));
      return {
        venue_code: venueCode,
        first_boat: firstBoat,
        second_boat: secondBoat,
        third_boat: thirdBoat,
        count_90days: p.count,
        total_races: totalRaces,
        probability: parseFloat(((p.count / totalRaces) * 100).toFixed(2)),
        avg_payout:
          p.payoutCount > 0 ? Math.round(p.payoutSum / p.payoutCount) : 0,
        last_updated: today,
      };
    });
  }
  return aggregated;
}
