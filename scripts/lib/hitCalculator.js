/**
 * 的中判定ユーティリティ
 * ボートレースの各種買い方の的中判定と配当計算を一元管理
 *
 * ⚠️ 命名注意: DB列名と英語名が逆転している（歴史的経緯）
 *   trifecta / is_hit_trifecta / payout_trifecta → 実態: 3連複（順不同）
 *   trio / is_hit_trio / payout_trio             → 実態: 3連単（順序一致）
 */

/**
 * 全買い方の的中判定と配当計算
 * @param {Object} prediction - { top_pick, top_2nd, top_3rd }
 * @param {Object} result - { rank1, rank2, rank3, payout_win, payout_place_1, payout_place_2, payout_trifecta, payout_trio }
 * @returns {Object} 的中フラグと配当
 */
export function calculateHits(prediction, result) {
  // 単勝: top_pickが1着と一致
  const isHitWin = prediction.top_pick === result.rank1;

  // 複勝: top_pickが2着以内（ボートレースのルール）
  const isHitPlace =
    prediction.top_pick === result.rank1 ||
    prediction.top_pick === result.rank2;

  // isHitTrifecta → 実態: 3連複的中（順不同で3艇一致）
  const predTop3 = [
    prediction.top_pick,
    prediction.top_2nd,
    prediction.top_3rd,
  ].sort((a, b) => a - b);
  const resultTop3 = [result.rank1, result.rank2, result.rank3].sort(
    (a, b) => a - b,
  );
  const isHitTrifecta =
    predTop3[0] === resultTop3[0] &&
    predTop3[1] === resultTop3[1] &&
    predTop3[2] === resultTop3[2];

  // isHitTrio → 実態: 3連単的中（完全順序一致）
  const isHitTrio =
    prediction.top_pick === result.rank1 &&
    prediction.top_2nd === result.rank2 &&
    prediction.top_3rd === result.rank3;

  // 配当計算
  const payoutWin = isHitWin ? result.payout_win || 0 : 0;

  let payoutPlace = 0;
  if (isHitPlace) {
    if (prediction.top_pick === result.rank1) {
      payoutPlace = result.payout_place_1 || 0;
    } else if (prediction.top_pick === result.rank2) {
      payoutPlace = result.payout_place_2 || 0;
    }
  }

  const payoutTrifecta = isHitTrifecta ? result.payout_trifecta || 0 : 0;
  const payoutTrio = isHitTrio ? result.payout_trio || 0 : 0;

  return {
    isHitWin,
    isHitPlace,
    isHitTrifecta,
    isHitTrio,
    payoutWin,
    payoutPlace,
    payoutTrifecta,
    payoutTrio,
  };
}

/**
 * 単勝的中判定
 * @param {number} topPick - 予想1着
 * @param {number} rank1 - 実際の1着
 * @returns {boolean}
 */
export function isWinHit(topPick, rank1) {
  return topPick === rank1;
}

/**
 * 複勝的中判定（2着以内）
 * @param {number} topPick - 予想1着
 * @param {number} rank1 - 実際の1着
 * @param {number} rank2 - 実際の2着
 * @returns {boolean}
 */
export function isPlaceHit(topPick, rank1, rank2) {
  return topPick === rank1 || topPick === rank2;
}

/**
 * 実態: 3連複的中判定（順不同で3艇一致）
 * ⚠️ 関数名は trifecta だが、実態は3連複（DB列名に合わせた歴史的命名）
 * @param {number[]} predTop3 - 予想上位3艇 [1着予想, 2着予想, 3着予想]
 * @param {number} rank1 - 実際の1着
 * @param {number} rank2 - 実際の2着
 * @param {number} rank3 - 実際の3着
 * @returns {boolean}
 */
export function isTrifectaHit(predTop3, rank1, rank2, rank3) {
  if (!predTop3 || predTop3.length !== 3) return false;
  const sortedPred = [...predTop3].sort((a, b) => a - b);
  const sortedResult = [rank1, rank2, rank3].sort((a, b) => a - b);
  return (
    sortedPred[0] === sortedResult[0] &&
    sortedPred[1] === sortedResult[1] &&
    sortedPred[2] === sortedResult[2]
  );
}

/**
 * 実態: 3連単的中判定（順序一致で3艇一致）
 * ⚠️ 関数名は trio だが、実態は3連単（DB列名に合わせた歴史的命名）
 * @param {number[]} predTop3 - 予想上位3艇 [1着予想, 2着予想, 3着予想]
 * @param {number} rank1 - 実際の1着
 * @param {number} rank2 - 実際の2着
 * @param {number} rank3 - 実際の3着
 * @returns {boolean}
 */
export function isTrioHit(predTop3, rank1, rank2, rank3) {
  if (!predTop3 || predTop3.length !== 3) return false;
  return (
    predTop3[0] === rank1 && predTop3[1] === rank2 && predTop3[2] === rank3
  );
}

/**
 * 複勝配当を取得
 * @param {number} topPick - 予想1着
 * @param {number} rank1 - 実際の1着
 * @param {number} rank2 - 実際の2着
 * @param {number} payoutPlace1 - 1着複勝配当
 * @param {number} payoutPlace2 - 2着複勝配当
 * @returns {number} 配当金額
 */
export function getPlacePayout(
  topPick,
  rank1,
  rank2,
  payoutPlace1,
  payoutPlace2,
) {
  if (topPick === rank1) {
    return payoutPlace1 || 0;
  } else if (topPick === rank2) {
    return payoutPlace2 || 0;
  }
  return 0;
}
