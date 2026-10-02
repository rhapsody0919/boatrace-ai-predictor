/** 右に残っている幅がこれ以下なら「›」は出さず、細いフェードだけにする（px） */
export const HSCROLL_PEEK_MAX = 12;

/** 少しだけ切れているときの細いフェードの幅（px） */
export const HSCROLL_PEEK_FADE = 12;

/**
 * 横スクロールの手がかりの出し方を決める（純関数。verify-frontend-pure-functions で固定）。
 *
 * - 右に残っている幅が HSCROLL_PEEK_MAX を超える: 「›」と幅40pxのフェード（hasMore）
 * - 1px より多く HSCROLL_PEEK_MAX 以下: 「›」は出さず、幅 HSCROLL_PEEK_FADE の細いフェードだけ
 *   （以前は 5px 残りでも40pxのフェードと「›」が、ほぼ見えている最後の列を覆っていた。
 *   逆に4px以下の残りでは何も出ず、最後の列の端が黙って切れていた。#1130 ファン評価2・3周目）
 *   境目を24px・フェードを「残り＋12px」にした最初の版では、20px残りで32pxのフェードが最後の列の
 *   見えている部分を覆い、「›」も無いため列ごと無いように見えた（PR #1169 ファン評価1周目）
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
  const peekFadeWidth = !hasMore && remaining > 1 ? HSCROLL_PEEK_FADE : 0;
  return { hasMore, hasLess: scrollLeft > 1, peekFadeWidth };
}
