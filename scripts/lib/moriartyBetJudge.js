/**
 * モリアーティの推奨（bet_recommendations.reasons）の照合のうち、3連単・3連複の部分（純粋関数）。
 * scripts/daily/update-moriarty-outcomes.js の judgeBet から呼ぶ。命名スワップ（race_results の
 * payout_trio＝3連単、payout_trifecta＝3連複）はここでも同じ。
 */

/** 3連単（trifecta）・3連複（trio）の照合。組番が読めない・着順が欠けるなら外れ */
export function judgeThreeBoatBet(betType, reasons, result) {
  const combo = String(reasons.combo ?? "")
    .split("-")
    .map((s) => parseInt(s, 10));
  if (combo.length !== 3 || combo.some((n) => !(n >= 1 && n <= 6))) {
    return { isHit: false, payoutPer100: 0 };
  }
  const actual = [result.rank1, result.rank2, result.rank3];
  if (actual.some((r) => r == null)) {
    return { isHit: false, payoutPer100: 0 };
  }

  if (betType === "trifecta") {
    const isHit =
      combo[0] === actual[0] &&
      combo[1] === actual[1] &&
      combo[2] === actual[2];
    return {
      isHit,
      // 命名スワップ: payout_trio が3連単の払戻を保持している
      payoutPer100: isHit ? (result.payout_trio ?? 0) : 0,
    };
  }

  // trio: 順不同の集合一致
  const comboSet = new Set(combo);
  const isHit = actual.every((r) => comboSet.has(r));
  return {
    isHit,
    // 命名スワップ: payout_trifecta が3連複の払戻を保持している
    payoutPer100: isHit ? (result.payout_trifecta ?? 0) : 0,
  };
}
