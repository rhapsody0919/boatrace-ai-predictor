/**
 * 選手の成績比較の「今の値｜推移」の切り替えと、推移の中身（オーナー 2026-11-24 承認のモック改訂3）。
 * 推移は6艇の直近30走ごとの移動（src/pure/racerTrendSeries.js）。範囲（全国・当地）とグレードの絞り込みは
 * 今の値と同じものを使い、期間は使わない（推移そのものが期間を表すため）。
 * 勝率は公式の期ごとの段で出す予定で、まだ無い（準備中と出す）。
 */
import { useTranslation } from "react-i18next";
import BoatBadge from "../BoatBadge";
import TrendChart from "./TrendChart";
import { filterRecords } from "../../../pure/basicInfoStats.js";
import { TREND_METRICS, trendSeries } from "../../../pure/racerTrendSeries.js";
import "./TrendChart.css";

/** 「今の値｜推移」の切り替え。題の行の右に置く */
export function ViewToggle({ view, setView }) {
  const { t } = useTranslation();
  return (
    <span className="trc-tabs" role="group" aria-label={t("basicInfo.trend.viewLabel")}>
      {["now", "trend"].map((v) => (
        <button
          key={v}
          type="button"
          className="trc-tab"
          aria-pressed={view === v}
          onClick={() => setView(v)}
        >
          {t(`basicInfo.trend.view.${v}`)}
        </button>
      ))}
    </span>
  );
}

function seriesOf({ sortedPlayers, recordsOf, metric, scope, grade, venueCode }) {
  const out = new Map();
  for (const p of sortedPlayers) {
    const records = recordsOf(p.racerId);
    if (!Array.isArray(records)) continue;
    const scoped = filterRecords(records, { venueCode, scope, grade, period: "current" });
    const s = trendSeries(scoped, metric);
    if (s.length > 0) out.set(p.number, s);
  }
  return out;
}

export default function BasicInfoTrend({
  view,
  setView,
  metric,
  scope,
  grade,
  venueCode,
  sortedPlayers,
  recordsOf,
  selectedBoat,
  onSelectBoat,
}) {
  const { t } = useTranslation();
  const metricName = t(`basicInfo.metrics.${metric}`);
  const supported = TREND_METRICS.includes(metric);
  const loading = sortedPlayers.some((p) => p.racerId && recordsOf(p.racerId) === undefined);
  const series = supported && !loading
    ? seriesOf({ sortedPlayers, recordsOf, metric, scope, grade, venueCode })
    : new Map();
  const selected = series.has(selectedBoat) ? selectedBoat : [...series.keys()][0];
  return (
    <div className="trc-wrap">
      <div className="trc-head">
        <p className="trc-title">{t("basicInfo.trend.title", { metric: metricName })}</p>
        <ViewToggle view={view} setView={setView} />
      </div>
      {!supported && <p className="trc-note">{t("basicInfo.trend.winRatePending")}</p>}
      {supported && loading && <p className="trc-note">{t("basicInfo.loading")}</p>}
      {supported && !loading && series.size === 0 && (
        <p className="trc-note">{t("basicInfo.trend.notEnough")}</p>
      )}
      {series.size > 0 && (
        <>
          <TrendChart seriesByBoat={series} metric={metric} selected={selected} />
          <div className="trc-boats">
            {sortedPlayers.map((p) => (
              <button
                key={p.number}
                type="button"
                className="trc-boat"
                aria-pressed={p.number === selected}
                disabled={!series.has(p.number)}
                onClick={() => onSelectBoat(p.number)}
                aria-label={t("basicInfo.trend.selectBoat", { boat: p.number })}
              >
                <BoatBadge n={p.number} />
              </button>
            ))}
            <span className="trc-hint">{t("basicInfo.trend.tapHint")}</span>
          </div>
          <p className="trc-note">{t("basicInfo.trend.note", { metric: metricName })}</p>
        </>
      )}
    </div>
  );
}
