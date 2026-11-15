import { SPARK_VIEW_W } from "../../utils/trendDateLayout";
import { computeSparkLayout } from "./MeetSparklineLayout";
import MeetSparklineSvg from "./MeetSparklineSvg";
import MeetSparklineLabels from "./MeetSparklineLabels";

// 点の下の文字（着順）の帯の高さ（px）
const LABEL_STRIP_HEIGHT = 13;

// 値のある点のうち、ポインタの横位置に最も近いものを選ぶ。
// viewBox は `preserveAspectRatio="none"` で横に引き伸ばされるため、
// SVG座標ではなく**実表示幅に対する割合**で比べる
function nearestPoint(drawn, x, ratio) {
  let best = drawn[0];
  let bestDist = Infinity;
  for (const d of drawn) {
    const dist = Math.abs(x(d.i) / SPARK_VIEW_W - ratio);
    if (dist < bestDist) {
      bestDist = dist;
      best = d;
    }
  }
  return best;
}

function tipPlacement(active, activeRatio, y, height) {
  // 吹き出しは**点に追従させず、近い方の端に寄せる**。点の位置に置くと
  // 長い文言で箱からはみ出す（390pxでの実測: 箱308pxに対して
  // ja「9/26 11R・展示 6.69(3)・着外(順位不明)」が241px、
  // en「9/26 R11 · Trial 6.69(3) · Unplaced (rank unknown)」が302px。
  // 点が左から20%の位置だと、中央寄せで左へ89pxはみ出す）。
  // どの点を見ているかは点を囲う輪が示すので、位置で示さなくてよい
  const tipX = activeRatio > 0.5 ? "right" : "left";
  // 吹き出しは**線の箱の中**に置く。上に出すと見出し（平均・通常値・前検）に、
  // 下に出すと「9/26 / 前走 0.09」の行に重なる。箱は56pxあり、1行の
  // 吹き出し（約22px）なら収まる。合わせている点と反対側の半分に置けば、
  // 見ている点そのものを隠さない
  const tipSide = active && y(active.v) > height / 2 ? "top" : "bottom";
  return { tipX, tipSide };
}

export default function MeetSparklineView({
  points,
  values,
  numeric,
  baseline,
  referenceSeries,
  domain,
  color,
  upIsBetter,
  height,
  pointLabels,
  markLast,
  xPositions,
  xCenters,
  breakBefore,
  boxWidth,
  wrapRef,
  activeIndex,
  setActiveIndex,
}) {
  // viewBoxの幅。`preserveAspectRatio="none"` で横いっぱいに伸ばすため、
  // この値が実際の表示幅から離れるほど点（circle）が楕円に歪む。
  // 390px幅の端末での実表示が約340pxなので、それに近い値にして歪みを消す
  // （100にしていたときは3.4倍に引き伸ばされて明らかに潰れていた）
  const layout = computeSparkLayout({
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
  });
  const { x, y, drawn, labelFontPx } = layout;

  const pickNearest = (event) => {
    const el = wrapRef.current;
    if (!el || drawn.length === 0) return;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0) return;
    const ratio = (event.clientX - rect.left) / rect.width;
    setActiveIndex(nearestPoint(drawn, x, ratio).i);
  };

  const active =
    activeIndex === null
      ? null
      : (drawn.find((d) => d.i === activeIndex) ?? null);
  const activeLabel = active ? (points[active.i]?.label ?? null) : null;
  const activeRatio = active ? x(active.i) / SPARK_VIEW_W : 0;

  const { tipX, tipSide } = tipPlacement(active, activeRatio, y, height);

  return (
    <div
      className="meet-sparkline-wrap"
      ref={wrapRef}
      style={{ height: pointLabels ? height + LABEL_STRIP_HEIGHT : height }}
      onPointerMove={pickNearest}
      onPointerDown={pickNearest}
      onPointerLeave={() => setActiveIndex(null)}
      onPointerCancel={() => setActiveIndex(null)}
    >
      <MeetSparklineSvg
        layout={layout}
        referenceSeries={referenceSeries}
        baseline={baseline}
        color={color}
        markLast={markLast}
        active={active}
        height={height}
      />
      {pointLabels && (
        <MeetSparklineLabels
          pointLabels={pointLabels}
          x={x}
          labelFontPx={labelFontPx}
        />
      )}
      {activeLabel && (
        <span
          className={`meet-sparkline-tip x-${tipX} at-${tipSide}`}
          aria-hidden="true"
        >
          {activeLabel}
        </span>
      )}
    </div>
  );
}
