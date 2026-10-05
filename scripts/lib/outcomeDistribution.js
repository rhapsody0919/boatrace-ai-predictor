/**
 * 出目分布（3連単の出現パターン）の会場別集計。純粋関数（DBに触れない）。
 * scripts/daily/update-outcome-distribution.js（全レース）と update-nige-outcome-distribution.js（逃げのみ）が使う。
 *
 * 平均配当は3連単の配当で出す。race_results の列名は中身と逆で、**payout_trio が3連単、payout_trifecta が3連複**
 * （docs/db-migration/079_race_payouts.sql:29）。2026-09-29 まで payout_trifecta（3連複）を足していたため、画面の
 * 「3連単」の平均配当に3連複の値が出ていた（BOA-535）。
 *
 * 完走が3艇未満のレース（一部返還）は、取り込みが返還艇を rank1〜3 に入れている（BOA-579、data-catalog E9）。
 * placedRanks で返還艇を飛ばし、1〜3着がそろわないレースはパターンにも total_races にも入れない。
 * 3連単が不成立（配当なし）で出目が存在せず、テーブルは3着の空いた組を持てない（third_boat は NOT NULL）ため。
 * 分母に残してパターンだけ外すと、完走した1着・2着の艇の分まで数えなくなり、件数の合計が total_races と合わなくなる
 * （会場特徴カードの合算 src/utils/venuePlaceRates.js はこの一致を前提にしている）。
 */
import { placedRanks } from "./raceOutcomeFilters.js";

/** 3連単の配当の列（列名と中身が逆: payout_trio = 3連単） */
export const TRIFECTA_PAYOUT_COLUMN = "payout_trio";

/** 返還艇を飛ばしても1〜3着がそろうか（そろわなければ3連単の出目が無い） */
export function hasThreePlaced(result) {
  const { rank1, rank2, rank3 } = placedRanks(result);
  return rank1 != null && rank2 != null && rank3 != null;
}

/**
 * @param {Array<{race_id: string, rank1: number, rank2: number, rank3: number, refund_boats?: number[]|null,
 *   payout_trio?: number|null}>} raceResults refund_boats を渡さないと返還艇を飛ばせない
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
  for (const result of raceResults.filter(hasThreePlaced)) {
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
