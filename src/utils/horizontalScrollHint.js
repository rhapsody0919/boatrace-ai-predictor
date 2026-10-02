/** 右に残っている幅がこれ以下なら「›」は出さず、薄いフェードだけにする（px） */
export const HSCROLL_PEEK_MAX = 24;

/**
 * 横スクロールの手がかりの出し方を決める（純関数。verify-frontend-pure-functions で固定）。
 *
 * - 右に残っている幅が HSCROLL_PEEK_MAX を超える: 「›」と幅40pxのフェード（hasMore）
 * - 1px より多く HSCROLL_PEEK_MAX 以下: 「›」は出さず、残りの幅＋12px（最大40px）の薄いフェードだけ
 *   （以前は 5px 残りでも40pxのフェードと「›」が、ほぼ見えている最後の列を覆っていた。
 *   逆に4px以下の残りでは何も出ず、最後の列の端が黙って切れていた。#1130 ファン評価2・3周目）
 * - 左に1pxより多く送られている: 「‹」（hasLess）
 *
 * @param {{scrollWidth: number, clientWidth: number, scrollLeft: number}} box
 * @returns {{hasMore: boolean, hasLess: boolean, peekFadeWidth: number}}
 */
export function horizontalScrollHintState({
  scrollWidth,
  clientWidth,
  scrollLeft,
}) {
  const remaining = scrollWidth - clientWidth - scrollLeft;
  const hasMore = remaining > HSCROLL_PEEK_MAX;
  const peekFadeWidth =
    !hasMore && remaining > 1 ? Math.min(40, Math.round(remaining) + 12) : 0;
  return { hasMore, hasLess: scrollLeft > 1, peekFadeWidth };
}
