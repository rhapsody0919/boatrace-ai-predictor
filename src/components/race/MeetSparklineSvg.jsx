import { SPARK_VIEW_W, SPARK_PAD_X } from "../../utils/trendDateLayout";

/** 基準線（折れ線 or 水平線）・本線・点・合わせている点の輪を描く SVG */
export default function MeetSparklineSvg({
  layout,
  referenceSeries,
  baseline,
  color,
  markLast,
  active,
  height,
}) {
  const { x, y, drawn, segments, refNumeric } = layout;
  const W = SPARK_VIEW_W;
  const padX = SPARK_PAD_X;
  const lastIndex = drawn.length - 1;
  return (
    <svg
      className="meet-sparkline"
      viewBox={`0 0 ${W} ${height}`}
      preserveAspectRatio="none"
      /* 同じ内容は下の「日別の走り」表にあるので、支援技術には出さない。
         ここは形を読むための絵で、点の値は表が正になる */
      role="presentation"
      style={{ height }}
    >
      {refNumeric.length >= 2 && (
        // 基準が日ごとに動く場合（展示のその日の会場平均）は折れ線で引く。
        // 1本の水平線にすると、水面が重い日と軽い日を同じ物差しで比べてしまう
        <polyline
          className="meet-sparkline-baseline"
          fill="none"
          points={(referenceSeries ?? [])
            .map((v, i) =>
              typeof v === "number"
                ? `${x(i).toFixed(2)},${y(v).toFixed(2)}`
                : null,
            )
            .filter(Boolean)
            .join(" ")}
          vectorEffect="non-scaling-stroke"
        />
      )}
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
      {segments.map((seg, k) => (
        <polyline
          key={k}
          className="meet-sparkline-line"
          points={seg.join(" ")}
          stroke={color}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {drawn.map((d, idx) => (
        <circle
          key={d.i}
          cx={x(d.i)}
          cy={y(d.v)}
          // 前走だけ大きくする（「今どこにいるか」が一番知りたい点）
          r={markLast && idx === lastIndex ? 3.2 : 2}
          fill={color}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {active && (
        // 合わせている点を囲う。点そのものを大きくすると「前走だけ大きい」の
        // 意味が壊れるので、外側に輪を足す
        <circle
          className="meet-sparkline-active"
          cx={x(active.i)}
          cy={y(active.v)}
          r={5}
          fill="none"
          stroke={color}
          vectorEffect="non-scaling-stroke"
        />
      )}
    </svg>
  );
}
