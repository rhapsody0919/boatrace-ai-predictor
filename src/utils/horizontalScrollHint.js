/**
 * 右に残っている幅がこれを超えたら「溢れている」とみなす（px）。「›」を出す、右に余白を足す、
 * 列の境目に止める、の3つを同じ境目にそろえる（ずれると、「›」が出るのに余白が無い、止める位置に
 * 右端が無い、が起きる）。1px 以下は丸めの誤差として扱う
 */
export const HSCROLL_MORE_MIN = 1;

/** 左に送った量がこれを超えたら「‹」を出す（px）。指が少し触れただけで出さないため */
export const HSCROLL_LESS_MIN = 12;

/**
 * 横スクロールの手がかりの出し方を決める（純関数。verify-frontend-pure-functions で固定）。
 *
 * - 右に HSCROLL_MORE_MIN より多く残っている: 「›」と幅40pxのフェード（hasMore）
 *   以前は 12px 以下の残りでは「›」を出さず細いフェードだけにしていた（#1169）。380〜386px の
 *   枠別の全コース表で 4〜10px だけ溢れ、6コースの「(n=20)」が「(n=2」に読めた。右の余白
 *   （tailPaddingFor）も足されず、指で送らない限り読めなかった（BOA-735、ユーザー判断で境目を下げた）
 * - 左に HSCROLL_LESS_MIN より多く送られている: 「‹」（hasLess）
 *
 * @param {{scrollWidth: number, clientWidth: number, scrollLeft: number}} box
 * @returns {{hasMore: boolean, hasLess: boolean}}
 */
export function horizontalScrollHintState({
  scrollWidth,
  clientWidth,
  scrollLeft,
}) {
  const remaining = scrollWidth - clientWidth - scrollLeft;
  // 「‹」は1pxを超えたら出していたため、指が少し触れただけで丸い「‹」が出て、押しても数px戻るだけ
  // だった（PR #1192 ファン評価2周目）
  return {
    hasMore: remaining > HSCROLL_MORE_MIN,
    hasLess: scrollLeft > HSCROLL_LESS_MIN,
  };
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
 * 右端より先にある最初の列の境目まで届くよう、差の分だけ余白を足す。溢れていなければ足さない
 *
 * @param {{naturalMax: number, columnStarts: number[]}} args naturalMax は余白を足す前の右端の位置
 * @returns {number}
 */
export function tailPaddingFor({ naturalMax, columnStarts }) {
  if (naturalMax <= HSCROLL_MORE_MIN) return 0;
  // 右端がすでに列の境目なら足さない
  if (columnStarts.some((v) => Math.abs(v - naturalMax) <= 1)) return 0;
  const next = columnStarts
    .filter((v) => v > naturalMax + 1)
    .sort((a, b) => a - b)[0];
  return next === undefined ? 0 : Math.ceil(next - naturalMax);
}
