/**
 * 会場ごとの配当・逃げの集計（純関数、BOA-1242）。
 *
 * 分析の「会場ランキング」（supabaseDataService.getTodaysVenueRanking、BOA-171）の中にあった計算を、
 * 手を加えずに移した。画面と龍神ボート番付（scripts/sns/rank-data.js --dataset=venue_payout）の
 * 両方がこれを使う（画面と投稿の数字がずれないため）。入力は取得済みの行だけで、SQL・キャッシュは持たない。
 *
 * - 対象のレース: isUsableRaceResult（不成立 race_status=no_race と rank1 の無い行を除く）
 * - 3連単の配当: race_results.payout_trio（DB の列名と中身が逆。payout_trifecta は3連複。
 *   scripts/lib/payoutCalculator.js 参照）。配当の無い行は平均・1万円以上の割合の分母に入れない
 * - 逃げ: rank1 === 1 かつ決まり手が「逃げ」（艇番の基準。1コースの逃げではない）
 * - 1番人気の決着: 3連単の配当があり、3連単の人気（race_results.popularity_trio。列名は3連単の
 *   payout_trio と対）がある行のうち、人気が1のもの。画面には出していない（番付だけが使う）
 *
 * Node から読むため、import は拡張子付き。
 */
import { isUsableRaceResult } from "./raceResultUsable.js";

/** 3連単の「1万円以上」の線（画面の万舟率と同じ） */
export const HIGH_PAYOUT_YEN = 10000;

/**
 * @param {ReadonlyArray<{race_id: string, rank1: number|null, payout_trio: number|null,
 *   winning_technique: string|null, race_status?: string|null, popularity_trio?: number|null}>} results
 * @param {(raceId: string) => number|null|undefined} venueOf race_id から会場番号
 * @returns {Map<number, {venue_code: number, raceCount: number, payoutCount: number, payoutSum: number,
 *   nigeCount: number, manshuCount: number, popularityCount: number, favoriteCount: number}>}
 */
export function tallyVenuePayouts(results, venueOf) {
  const byVenue = new Map();
  (results ?? []).forEach((r) => {
    if (!isUsableRaceResult(r)) return;
    const venueCode = venueOf(r.race_id);
    if (venueCode === null || venueCode === undefined) return;
    if (!byVenue.has(venueCode)) {
      byVenue.set(venueCode, {
        venue_code: venueCode,
        raceCount: 0,
        payoutCount: 0,
        payoutSum: 0,
        nigeCount: 0,
        manshuCount: 0,
        popularityCount: 0,
        favoriteCount: 0,
      });
    }
    const v = byVenue.get(venueCode);
    v.raceCount += 1;
    if (r.payout_trio !== null) {
      v.payoutCount += 1;
      v.payoutSum += r.payout_trio;
      if (r.payout_trio >= HIGH_PAYOUT_YEN) v.manshuCount += 1;
      if (r.popularity_trio !== null && r.popularity_trio !== undefined) {
        v.popularityCount += 1;
        if (r.popularity_trio === 1) v.favoriteCount += 1;
      }
    }
    if (r.rank1 === 1 && r.winning_technique === "逃げ") v.nigeCount += 1;
  });
  return byVenue;
}

/**
 * 会場ごとの率（%）と平均配当。raceCount が minRaceCount 未満の会場は除く。
 * イン逃げ率は配当に依らないので配当0件の会場も出す。平均配当・1万円以上の割合は payoutCount>0 の会場だけ
 * @param {ReturnType<typeof tallyVenuePayouts>} byVenue
 * @param {number} minRaceCount
 */
export function venuePayoutRates(byVenue, minRaceCount) {
  const qualifyingVenues = [...byVenue.values()].filter(
    (v) => v.raceCount >= minRaceCount,
  );
  const nigeRateVenues = qualifyingVenues.map((v) => ({
    venue_code: v.venue_code,
    race_count: v.raceCount,
    nige_count: v.nigeCount,
    nige_rate: (v.nigeCount / v.raceCount) * 100,
  }));
  const payoutVenues = qualifyingVenues
    .filter((v) => v.payoutCount > 0)
    .map((v) => ({
      venue_code: v.venue_code,
      race_count: v.raceCount,
      payout_count: v.payoutCount,
      manshu_count: v.manshuCount,
      avg_payout: v.payoutSum / v.payoutCount,
      manshu_rate: (v.manshuCount / v.payoutCount) * 100,
    }));
  return { nigeRateVenues, payoutVenues };
}

/**
 * 画面の4つのランキング（固い場・荒れている場・イン逃げ率・万舟率）。各上位 limit 件
 * @param {ReturnType<typeof tallyVenuePayouts>} byVenue
 * @param {number} limit
 * @param {number} minRaceCount
 */
export function rankVenuesByPayout(byVenue, limit, minRaceCount) {
  const { nigeRateVenues, payoutVenues } = venuePayoutRates(
    byVenue,
    minRaceCount,
  );
  const pick = ({ venue_code, race_count, ...rest }, keys) => ({
    venue_code,
    race_count,
    ...Object.fromEntries(keys.map((k) => [k, rest[k]])),
  });
  const payoutRow = (v) => pick(v, ["avg_payout", "manshu_rate"]);
  const byAvgPayoutAsc = [...payoutVenues].sort(
    (a, b) => a.avg_payout - b.avg_payout,
  );
  const byAvgPayoutDesc = [...payoutVenues].sort(
    (a, b) => b.avg_payout - a.avg_payout,
  );
  return {
    stable: byAvgPayoutAsc.slice(0, limit).map(payoutRow),
    rough: byAvgPayoutDesc.slice(0, limit).map(payoutRow),
    nigeRate: [...nigeRateVenues]
      .sort((a, b) => b.nige_rate - a.nige_rate)
      .slice(0, limit)
      .map((v) => pick(v, ["nige_rate"])),
    manshu: [...payoutVenues]
      .sort((a, b) => b.manshu_rate - a.manshu_rate)
      .slice(0, limit)
      .map(payoutRow),
  };
}
