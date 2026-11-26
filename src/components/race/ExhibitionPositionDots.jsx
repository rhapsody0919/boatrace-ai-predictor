/**
 * 展示タイムの6艇の位置（見せ方の型3、意味づけ 2026-11-26 オーナー承認）。
 * 1本の数直線に6艇の札を置く。左ほど速い。札は艇の色のまま、良し悪しの色は付けない
 * （良し悪しは表の ▲▼ が言う。ここは「どれだけ離れているか」だけを見せる）。
 * 近すぎて札が重なる艇は段を上げる。同じタイムは同じ位置に積む。
 */
import { useTranslation } from "react-i18next";
import { BOAT_COLORS } from "../../utils/colors";

// 札の幅を線の長さの何％と見て重なりを避けるか（375px で約22px の札。目安、根拠なし）
const MIN_GAP_PCT = 9;

// 速い順に並べ、位置（％）と段を決める。重なる札は空いている一番下の段へ
function place(points, min, max) {
  const lastX = [];
  return points.map((pt) => {
    const x = max === min ? 50 : ((pt.value - min) / (max - min)) * 100;
    let level = lastX.findIndex((lx) => x - lx >= MIN_GAP_PCT);
    if (level < 0) level = lastX.length;
    lastX[level] = x;
    return { ...pt, x, level };
  });
}

export default function ExhibitionPositionDots({ values }) {
  const { t } = useTranslation();
  const points = [...(values ?? new Map())]
    .map(([boat, v]) => ({ boat, value: v?.value }))
    .filter((pt) => typeof pt.value === "number" && Number.isFinite(pt.value))
    .map((pt) => ({ ...pt, value: Number(pt.value.toFixed(2)) }))
    .sort((a, b) => a.value - b.value || a.boat - b.boat);
  if (points.length < 2) return null;
  const min = points[0].value;
  const max = points[points.length - 1].value;
  if (min === max) return null;
  const placed = place(points, min, max);
  const levels = Math.max(...placed.map((pt) => pt.level)) + 1;
  return (
    <figure className="rbi-posdots" data-testid="rbi-position-dots">
      <figcaption className="rbi-posdots-title">{t("beforeInfo.positionTitle")}</figcaption>
      <div className="rbi-posdots-track" style={{ "--rbi-posdots-levels": levels }}>
        {placed.map((pt) => {
          const color = BOAT_COLORS[pt.boat] || {};
          return (
            <span
              key={pt.boat}
              className="rbi-posdots-chip"
              data-boat={pt.boat}
              data-value={pt.value.toFixed(2)}
              style={{
                left: `${pt.x}%`,
                bottom: `calc(${pt.level} * var(--rbi-posdots-step))`,
                background: color.bg,
                color: color.text,
              }}
              title={`${pt.boat}: ${pt.value.toFixed(2)}`}
            >
              {pt.boat}
            </span>
          );
        })}
      </div>
      <div className="rbi-posdots-scale">
        <span>{min.toFixed(2)}</span>
        <span>{max.toFixed(2)}</span>
      </div>
    </figure>
  );
}
