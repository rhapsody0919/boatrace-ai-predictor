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
 * 3着以内判定（複勝の的中判定ではなく、2連率・3連率集計での「3着以内か」の
 * 判定に使う。isWinHit/isPlaceHitと同じ艇番比較パターンの3着版）
 * @param {number} boatNumber - 対象の艇番
 * @param {number} rank1 - 実際の1着
 * @param {number} rank2 - 実際の2着
 * @param {number} rank3 - 実際の3着
 * @returns {boolean}
 */
export function isShowHit(boatNumber, rank1, rank2, rank3) {
  return isPlaceHit(boatNumber, rank1, rank2) || boatNumber === rank3;
}
