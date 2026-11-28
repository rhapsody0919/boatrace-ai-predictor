/**
 * 推移の図の、基準の線（refOf が返す値。走ごとに変わってよい）と値の線の間のうち、基準より速い側（上。invert の尺度）だけを
 * 薄く塗る面。TrendChart の renderOver の中で使う。塗りの色は使う側の className で決める
 */
import { useId } from "react";

// 値と基準がどちらもある走の続き（線と破線の間の面を作る単位）
function gainSegments(sel, x, y, refOf) {
  const segs = [[]];
  sel.forEach((p, i) => {
    const r = refOf(p);
    if (p.value == null || r == null) segs.push([]);
    else
      segs[segs.length - 1].push({
        x: x(i, sel.length),
        yv: y(p.value),
        yr: y(r),
      });
  });
  return segs.filter((g) => g.length > 1);
}

// 基準の線より速い側（上）だけを薄く塗る（オーナー 2026-11-27「破線より速い側を薄く塗る」。今節の詳細の小さな線 R-45 と
// 選手ページの展示の推移で使う）。線と破線の間の面を、
// 破線より上の範囲で切り抜く。基準より速い走の量が面で読める。上向き・下向きの判定ではない
export default function TrendGainFill({ sel, x, y, refOf, className }) {
  const id = useId();
  const segs = gainSegments(sel, x, y, refOf);
  const pts = (arr) => arr.map((q) => `${q[0]},${q[1]}`).join(" ");
  return segs.map((g, k) => {
    const ref = g.map((q) => [q.x, q.yr]);
    const clip = `${id}-gain-${k}`;
    return (
      <g key={clip}>
        <clipPath id={clip}>
          <polygon
            points={pts([...ref, [g[g.length - 1].x, 0], [g[0].x, 0]])}
          />
        </clipPath>
        <polygon
          className={className}
          clipPath={`url(#${clip})`}
          points={pts([...g.map((q) => [q.x, q.yv]), ...ref.reverse()])}
        />
      </g>
    );
  });
}
