/**
 * Sparkline - 値の列を折れ線で描く小さなインラインSVG
 *
 * values の min/max を viewBox（width×height）の高さに正規化する（大きい値ほど上）。
 * 2点未満は描画しない。線色は currentColor（既定は親の文字色）なので、
 * 呼び出し側のCSSで color か `polyline { stroke }` を指定して変える。
 * 描画サイズは既定で width×height px。CSSで width/height を上書きして
 * 可変幅にする場合は preserveAspectRatio="none" を渡すと枠いっぱいに伸びる。
 */
function Sparkline({
  values,
  width = 200,
  height = 40,
  strokeWidth = 2,
  preserveAspectRatio,
  className,
}) {
  if (!values || values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * width;
      const y = height - ((v - min) / range) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg
      className={className}
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      preserveAspectRatio={preserveAspectRatio}
      aria-hidden="true"
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
      />
    </svg>
  );
}

export default Sparkline;
