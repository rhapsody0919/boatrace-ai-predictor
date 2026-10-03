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
 * - 左に HSCROLL_PEEK_MAX より多く送られている: 「‹」（hasLess）
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
  // 「‹」も「›」と同じ境目にする。1pxを超えたら出していたため、指が少し触れただけで丸い「‹」が
  // 出て、押しても数px戻るだけだった（PR #1192 ファン評価2周目）
  return { hasMore, hasLess: scrollLeft > HSCROLL_PEEK_MAX, peekFadeWidth };
}

/**
 * 「›」「‹」で1回に送る幅。見えている幅の8割にする。
 *
 * 左の列（項目名・選手名）を固定している表では、その列の下に隠れる分を引かないと、送った幅が
 * 数字の見える幅より大きくなる。320px の展示情報の表で、「›」を押すだけでは3号艇の列が一度も
 * 見えなかった（PR #1192 ファン評価2周目）
 *
 * @param {{clientWidth: number, stickyWidth: number}} box stickyWidth は固定の左の列の幅（無ければ0）
 * @returns {number}
 */
export function horizontalScrollStep({ clientWidth, stickyWidth }) {
  return Math.max(40, Math.round((clientWidth - stickyWidth) * 0.8));
}

/**
 * 「›」「‹」で送る先を、列の境目にそろえる。
 *
 * 見える幅の8割だけ送ると、列の途中で止まり、固定の列のすぐ右に切れた値だけが残った。375px の
 * モーターのコース別成績で「1コース 2%」（実際は 87.2%）と読めた（PR #1202 ファン評価2周目）。
 * 送りたい位置（今の位置 ± step）を越えない範囲で、いちばん遠い列の境目に止める。1列も越えない
 * ときは次の列の境目まで送る。端（0・max）を越えるときは端に止める
 *
 * @param {{current: number, step: number, direction: 1|-1, max: number, columnStarts: number[]}} args
 *   columnStarts は、その列の左端が固定の列の右端にそろうときの scrollLeft
 * @returns {number}
 */
export function snapScrollTarget({
  current,
  step,
  direction,
  max,
  columnStarts,
}) {
  const raw = current + direction * step;
  if (direction > 0 && raw >= max) return max;
  if (direction < 0 && raw <= 0) return 0;
  const starts = [...new Set(columnStarts.map((v) => Math.round(v)))]
    .filter((v) => v > 0 && v < max)
    .sort((a, b) => a - b);
  if (direction > 0) {
    const within = starts.filter((v) => v > current + 1 && v <= raw);
    if (within.length > 0) return within[within.length - 1];
    const next = starts.find((v) => v > current + 1);
    return next ?? max;
  }
  const within = starts.filter((v) => v < current - 1 && v >= raw);
  if (within.length > 0) return within[0];
  const prev = [...starts].reverse().find((v) => v < current - 1);
  return prev ?? 0;
}

/**
 * 右端までスクロールした位置も列の境目にそろえるため、表の右に足す余白（px）。
 *
 * 途中の送りは列の境目にそろえても、右端の位置（scrollWidth − clientWidth）は列の境目と
 * 一致しない。そのため右端まで送った最後の1回だけ、固定した列のすぐ右に切れた値が残った
 * （320px の今節の日別表で展示「6.71(6)」が「71(6)」。PR #1202 ファン評価3周目）。
 * 右端より先にある最初の列の境目まで届くよう、差の分だけ余白を足す。少しだけ切れているとき
 * （HSCROLL_PEEK_MAX 以下で「›」を出さない）は足さない
 *
 * @param {{naturalMax: number, columnStarts: number[]}} args naturalMax は余白を足す前の右端の位置
 * @returns {number}
 */
export function tailPaddingFor({ naturalMax, columnStarts }) {
  if (naturalMax <= HSCROLL_PEEK_MAX) return 0;
  // 右端がすでに列の境目なら足さない
  if (columnStarts.some((v) => Math.abs(v - naturalMax) <= 1)) return 0;
  const next = columnStarts
    .filter((v) => v > naturalMax + 1)
    .sort((a, b) => a - b)[0];
  return next === undefined ? 0 : Math.ceil(next - naturalMax);
}
