import { SPARK_VIEW_W, SPARK_PAD_X } from "../../utils/trendDateLayout";

// 日付の横軸で、同じ日の2走を日の位置から左右にずらす最大幅（px、BOA-538）
const MAX_DAY_OFFSET_PX = 8;

const PAD_Y = 6;

// 縦の物差し（上ほど良い向きの反転も含む）を返す
function makeScale({ candidates, domain, upIsBetter, innerH }) {
  // domain を渡すと縦の物差しを外から固定できる。6艇を並べるときは
  // 全艇共通にしないと、各艇が自分の最小〜最大に伸びて比較にならない
  const min = domain ? domain[0] : Math.min(...candidates);
  const max = domain ? domain[1] : Math.max(...candidates);
  // 全点が同値でも線が潰れないように最小の幅を持たせる
  const span = max - min < 0.005 ? 0.005 : max - min;
  return (v) => {
    const ratio = (v - min) / span;
    // upIsBetter: 小さい値（速い）を上に
    return PAD_Y + (upIsBetter ? ratio : 1 - ratio) * innerH;
  };
}

// 横位置（日付の横軸なら外から、無ければ走った順で左右いっぱい）
function makeX({ xPositions, xCenters, boxWidth, count, innerW }) {
  const W = SPARK_VIEW_W;
  const padX = SPARK_PAD_X;
  // 日の位置からのずれの上限（割合）。箱の幅が分かるまでは上限をかけない
  const maxOffsetFrac =
    xCenters && boxWidth > 0
      ? MAX_DAY_OFFSET_PX / (boxWidth * (innerW / W))
      : Infinity;
  const cappedFrac = (i) => {
    const v = xPositions?.[i] ?? 0;
    const c = xCenters?.[i];
    if (c === undefined || c === null) return v;
    const d = v - c;
    return c + Math.max(-maxOffsetFrac, Math.min(maxOffsetFrac, d));
  };
  // xPositions（0〜1の割合）を渡すと横位置を外から決める（日付の横軸、BOA-538）。
  // 無ければ従来どおり走った順で左右いっぱいに並べる
  // 1走だけのときは右端（他の行の「前走」と同じ横位置）に置く
  const x = (i) => {
    if (xPositions) return padX + cappedFrac(i) * innerW;
    if (count === 1) return W - padX;
    return padX + (i / (count - 1)) * innerW;
  };
  return { x, cappedFrac };
}

// 線は、走っていない日をまたぐところで切る（breakBefore、BOA-538）。
// 値の無い走（欠場など）は従来どおり前後をつなぐ
function buildSegments(drawn, breakBefore, x, y) {
  const segments = [];
  drawn.forEach((d, k) => {
    const prev = drawn[k - 1];
    const cut =
      prev &&
      breakBefore &&
      breakBefore.slice(prev.i + 1, d.i + 1).some(Boolean);
    if (k === 0 || cut) segments.push([]);
    segments[segments.length - 1].push(
      `${x(d.i).toFixed(2)},${y(d.v).toFixed(2)}`,
    );
  });
  return segments;
}

// 点の下の着順の間隔（px）
// 日付の横軸（xPositions）では1日2走が近づくので、実際の横位置の最小の差で測る
function minStepOf({ xPositions, cappedFrac, count }) {
  if (xPositions) {
    return Math.min(
      // 日の位置からのずれに上限をかけた後の位置で測る
      ...xPositions.slice(1).map((_, i) => cappedFrac(i + 1) - cappedFrac(i)),
      Infinity,
    );
  }
  return count > 1 ? 1 / (count - 1) : Infinity;
}

// 間隔が足りない行は、間引かずに字を小さくして全走を1段に並べる。2段に振り分けると
// 段ごとに左から読んで順番を読み違える（BOA-537 ファン評価3周目）。
// 1文字の幅は、数字（半角）で字の大きさの約0.6倍、記号（落・欠などの全角）で約1倍。
// その行に全角の記号があるかで必要な間隔を変え、隣と3px以上あくように字を決める。
// 7px を下限にする（それ以下は読めない）。数字だけの行なら、375px（線の幅149px）で
// 等間隔のとき16走まで、日付の横軸で毎日2走でも7日まで10pxのまま並ぶ
function pickLabelFontPx({ pointLabels, labelGapPx }) {
  const hasWideLabel = (pointLabels ?? []).some(
    (lab) =>
      lab && typeof lab.text === "string" && !/^[0-9A-Za-z]$/.test(lab.text),
  );
  const glyphRatio = hasWideLabel ? 1 : 0.6;
  const fitFontPx = (labelGapPx - 3) / glyphRatio;
  return pointLabels && fitFontPx < 10
    ? Math.max(7, Math.floor(fitFontPx * 2) / 2)
    : null;
}

/**
 * 描画に要る座標まわりを一括で作る（純粋関数）。
 * @returns {{x: Function, y: Function, drawn: Array, segments: Array,
 *   refNumeric: Array<number>, labelFontPx: number|null}}
 */
export function computeSparkLayout({
  values,
  numeric,
  baseline,
  referenceSeries,
  domain,
  height,
  upIsBetter,
  pointLabels,
  xPositions,
  xCenters,
  breakBefore,
  boxWidth,
}) {
  const W = SPARK_VIEW_W;
  const refNumeric = (referenceSeries ?? []).filter(
    (v) => typeof v === "number",
  );
  const candidates = [
    ...numeric,
    ...refNumeric,
    ...(baseline === null ? [] : [baseline]),
  ];
  // 左右にも余白を取る。0だと両端の点（前走を含む）が半分見切れる
  const innerH = height - PAD_Y * 2;
  const innerW = W - SPARK_PAD_X * 2;
  const y = makeScale({ candidates, domain, upIsBetter, innerH });
  const count = values.length;
  const { x, cappedFrac } = makeX({
    xPositions,
    xCenters,
    boxWidth,
    count,
    innerW,
  });
  // null は線を切らずに前後をつなぐ（欠測で線が分断されると形が読めない）
  const drawn = values
    .map((v, i) => (typeof v === "number" ? { i, v } : null))
    .filter(Boolean);
  const segments = buildSegments(drawn, breakBefore, x, y);
  const minStepFrac = minStepOf({ xPositions, cappedFrac, count });
  const labelGapPx =
    boxWidth > 0 && Number.isFinite(minStepFrac)
      ? boxWidth * (innerW / W) * minStepFrac
      : Infinity;
  const labelFontPx = pickLabelFontPx({ pointLabels, labelGapPx });
  return { x, y, drawn, segments, refNumeric, labelFontPx };
}

/** 値の列・描けるか・箱の実寸を測る要否（hooks の前に決める） */
export function readSparkInputs({
  points,
  allowSinglePoint,
  pointLabels,
  xCenters,
}) {
  const values = (points ?? []).map((p) => p.value);
  const numeric = values.filter((v) => typeof v === "number");
  const canDraw = numeric.length >= (allowSinglePoint ? 1 : 2);
  // 着順の間隔・日の位置からのずれの上限の両方に箱の実寸を使う
  const hasLabels = Boolean(pointLabels) || Boolean(xCenters);
  return { values, numeric, canDraw, hasLabels };
}
