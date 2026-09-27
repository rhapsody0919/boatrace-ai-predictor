import "./MeetSparkline.css";

/**
 * 今節の走順に並べた小さな折れ線（軸なし）。
 *
 * ## なぜ数字の羅列ではなく線なのか
 *
 * 今節のST・展示は「上がってきたか」を読むための数字で、値そのものより
 * **並びの形**が意味を持つ。表の列に数字が縦に並ぶだけだと、8走ぶんの
 * 上下を頭の中で組み立てることになる（2026-09-27、ファン視点の議論）。
 *
 * ## 上ほど良い（速い）向きで描く
 *
 * ST・展示タイムは**小さいほど速い**。素の値をそのまま縦位置にすると
 * 「速い＝下」になり、同じPRで直した展示タイムの棒グラフ（長いほど速い）と
 * 逆になる。「上がり調子」という日常語とも合わないので、**値を反転して
 * 上ほど速い**に統一する。`upIsBetter` を false にすると素の向きになる。
 *
 * ## 断定はしない
 *
 * 「上向き/下向き」の判定文は出さない。初日と直近の2点だけで断定して
 * 実態と逆の結論を出していた反省（同PR）から、形と基準線を見せて
 * 読み手に委ねる。
 *
 * @param {Array<{value: number|null, label?: string}>} points 走順（古い→新しい）
 * @param {number|null} [baseline] 破線で引く基準（STはその選手の通常平均、
 *   展示はこの節の前検タイム）
 * @param {string} [color] 線の色（CSS値）
 * @param {boolean} [upIsBetter] 値が小さいほど上に描く（既定 true）
 * @param {number} [height] 高さ（px）
 */
function MeetSparkline({
  points,
  baseline = null,
  color = "var(--brand-accent-primary)",
  upIsBetter = true,
  height = 56,
}) {
  const values = (points ?? []).map((p) => p.value);
  const numeric = values.filter((v) => typeof v === "number");
  if (numeric.length < 2) return null;

  const candidates = baseline === null ? numeric : [...numeric, baseline];
  const min = Math.min(...candidates);
  const max = Math.max(...candidates);
  // 全点が同値でも線が潰れないように最小の幅を持たせる
  const span = max - min < 0.005 ? 0.005 : max - min;

  // viewBoxの幅。`preserveAspectRatio="none"` で横いっぱいに伸ばすため、
  // この値が実際の表示幅から離れるほど点（circle）が楕円に歪む。
  // 390px幅の端末での実表示が約340pxなので、それに近い値にして歪みを消す
  // （100にしていたときは3.4倍に引き伸ばされて明らかに潰れていた）
  const W = 340;
  const padY = 6;
  // 左右にも余白を取る。0だと両端の点（前走を含む）が半分見切れる
  const padX = 5;
  const innerH = height - padY * 2;
  const innerW = W - padX * 2;
  const x = (i) =>
    values.length === 1
      ? W / 2
      : padX + (i / (values.length - 1)) * innerW;
  const y = (v) => {
    const ratio = (v - min) / span;
    // upIsBetter: 小さい値（速い）を上に
    return padY + (upIsBetter ? ratio : 1 - ratio) * innerH;
  };

  // null は線を切らずに前後をつなぐ（欠測で線が分断されると形が読めない）
  const drawn = values
    .map((v, i) => (typeof v === "number" ? { i, v } : null))
    .filter(Boolean);
  const path = drawn.map((d) => `${x(d.i).toFixed(2)},${y(d.v).toFixed(2)}`);
  const lastIndex = drawn.length - 1;

  return (
    <svg
      className="meet-sparkline"
      viewBox={`0 0 ${W} ${height}`}
      preserveAspectRatio="none"
      role="presentation"
      style={{ height }}
    >
      {baseline !== null && (
        <line
          className="meet-sparkline-baseline"
          x1={padX}
          x2={W - padX}
          y1={y(baseline)}
          y2={y(baseline)}
          vectorEffect="non-scaling-stroke"
        />
      )}
      <polyline
        className="meet-sparkline-line"
        points={path.join(" ")}
        stroke={color}
        vectorEffect="non-scaling-stroke"
      />
      {drawn.map((d, idx) => (
        <circle
          key={d.i}
          cx={x(d.i)}
          cy={y(d.v)}
          // 前走だけ大きくする（「今どこにいるか」が一番知りたい点）
          r={idx === lastIndex ? 3.2 : 2}
          fill={color}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}

export default MeetSparkline;
