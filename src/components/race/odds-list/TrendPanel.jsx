// オッズの推移パネル（スパークライン付き）。RaceOddsListTab.jsx から移しただけ
import { useTranslation } from "react-i18next";
import { approxEm, formatValue, isNoVotes, valueToNumber } from "./oddsListHelpers";

// 小さな折れ線スパークライン（MotorWakuStatsGridと同じ発想のインラインSVG）。
// 末尾がライブ値なら、その点を別色で打つ。
// 各点の横位置は、下の値のマス（推移の点と同じ数の列）の中心に置く。点とマスを同じ列にそろえ、どの幅でも
// 「どの点がどの値か」を位置で結べるようにする（ファン評価で3回出た指摘、BOA-547）
function Sparkline({ points, isRange }) {
  if (points.length < 2) return null;
  const nums = points.map((p) => valueToNumber(p.value, isRange));
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const range = max - min || 1;
  const width = 200;
  const height = 40;
  const xy = nums.map((v, i) => [
    ((i + 0.5) / nums.length) * width,
    height - ((v - min) / range) * height,
  ]);
  const toPoints = (list) =>
    list.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const last = xy[xy.length - 1];
  const lastPoint = points[points.length - 1];
  // 末尾が締切時オッズ（公式）なら、記録の折れ線は1つ手前まで。最後の区間を点線にし、点を青で打つ
  // （記録の推移と別の時点・出どころのため）
  const recorded = lastPoint.official ? xy.slice(0, -1) : xy;
  const prev = xy[xy.length - 2];
  return (
    <svg
      className="rol-sparkline"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {recorded.length >= 2 && (
        <polyline points={toPoints(recorded)} fill="none" strokeWidth="2" />
      )}
      {lastPoint.official && (
        <line
          className="rol-sparkline-official-line"
          x1={prev[0]}
          y1={prev[1]}
          x2={last[0]}
          y2={last[1]}
          strokeWidth="2"
        />
      )}
      {/* 点は長さ0の丸い線端で描く（preserveAspectRatio="none" で横に引き伸ばされても円のまま。circle だと楕円になる） */}
      {(lastPoint.live || lastPoint.official) && (
        <line
          className={
            lastPoint.official ? "rol-sparkline-official" : "rol-sparkline-live"
          }
          x1={last[0]}
          y1={last[1]}
          x2={last[0]}
          y2={last[1]}
        />
      )}
    </svg>
  );
}

export function TrendPanel({ combo, trend, isRange }) {
  const { t } = useTranslation();
  const labelOf = (p) => {
    if (p.official) return t("oddsList.finalTrendLabel");
    if (p.atTime) return t("oddsList.fetchedAt", { time: p.atTime });
    if (p.live) {
      return p.minutesBefore === null
        ? t("oddsList.liveLatest")
        : t("oddsList.liveTrendLabel", { n: p.minutesBefore });
    }
    if (p.minutesBefore === null) return "-";
    if (p.minutesBefore === 0) return t("oddsList.deadlineLabel");
    return t("oddsList.minutesBeforeLabel", { n: p.minutesBefore });
  };
  const valueText = (p) =>
    isNoVotes(p.value, isRange)
      ? t("oddsList.noVotes")
      : (formatValue(p.value, isRange) ?? "-");
  return (
    <div className="rol-trend rol-span-all">
      <div className="rol-trend-title">
        {t("oddsList.trendTitle", { combo })}
      </div>
      {trend.length === 0 ? (
        <p className="rol-no-data">{t("oddsList.noData")}</p>
      ) : (
        <>
          <Sparkline points={trend} isRange={isRange} />
          <div
            className="rol-trend-values"
            style={{ "--rol-trend-count": trend.length }}
          >
            {trend.map((p, i) => (
              <div
                className={`rol-trend-item${p.live ? " is-live" : ""}${p.official ? " is-official" : ""}`}
                key={i}
              >
                <div
                  className="rol-trend-value"
                  style={{ "--rol-trend-em": approxEm(valueText(p)) }}
                >
                  {valueText(p)}
                </div>
                <div className="rol-trend-label">{labelOf(p)}</div>
              </div>
            ))}
          </div>
          {isRange && trend.length >= 2 && (
            <p className="rol-trend-note" data-testid="odds-trend-range-note">
              {t("oddsList.rangeTrendNote")}
            </p>
          )}
          {trend.some((p) => p.official) &&
            trend.some((p) => !p.official) && (
            <p className="rol-trend-note" data-testid="odds-trend-note">
              {t("oddsList.finalTrendNote")}
            </p>
          )}
        </>
      )}
    </div>
  );
}
