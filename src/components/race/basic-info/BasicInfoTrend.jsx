/**
 * 選手の成績比較の「今の値｜推移」の切り替えと、推移の中身（オーナー 2026-11-24 承認のモック改訂3）。
 * 推移は6艇の直近30走ごとの移動（src/pure/racerTrendSeries.js）。範囲（全国・当地）とグレードの絞り込みは
 * 今の値と同じものを使い、期間は使わない（推移そのものが期間を表すため）。
 * 勝率は公式の期別成績の段で出す（WinRateTrend）。
 */
import { useTranslation } from "react-i18next";
import BoatBadge from "../BoatBadge";
import InlineFetchError from "../../InlineFetchError";
import TrendChart from "./TrendChart";
import WinRateTrend from "./WinRateTrend";
import { filterRecords, getRecentRaces } from "../../../pure/basicInfoStats.js";
import { TREND_METRICS, trendSeries } from "../../../pure/racerTrendSeries.js";
import "./TrendChart.css";

/** 題（今の値／推移）と「今の値｜推移」の切り替えの行。指標の札のすぐ下に置く */
export function ViewHead({ view, setView, metric }) {
  const { t } = useTranslation();
  const metricName = t(`basicInfo.metrics.${metric}`);
  return (
    <div className="trc-head">
      <p className="trc-title">
        {t(
          view === "now"
            ? "basicInfo.trend.nowTitle"
            : metric === "winRate"
              ? "basicInfo.trend.winRateTitle"
              : "basicInfo.trend.title",
          {
            metric: metricName,
          },
        )}
      </p>
      <span
        className="trc-tabs"
        role="group"
        aria-label={t("basicInfo.trend.viewLabel")}
      >
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
    </div>
  );
}

// 右端（最新）の値の字（図の右の札と同じ桁）
const endValue = (s, metric) =>
  s?.length ? s[s.length - 1].value.toFixed(metric === "avgSt" ? 2 : 1) : null;

function seriesOf({
  sortedPlayers,
  recordsOf,
  metric,
  scope,
  grade,
  venueCode,
}) {
  const out = new Map();
  for (const p of sortedPlayers) {
    const records = recordsOf(p.racerId);
    if (!Array.isArray(records)) continue;
    const scoped = filterRecords(records, {
      venueCode,
      scope,
      grade,
      period: "current",
    });
    // 点ごとにその走の中身（吹き出しで出す日付・会場・R・コース・着順・ST）を持たせる
    const runs = new Map(
      getRecentRaces(scoped, scoped.length).map((r) => [r.raceId, r]),
    );
    const s = trendSeries(scoped, metric).map((pt) => ({
      ...pt,
      run: runs.get(pt.raceId) ?? null,
    }));
    if (s.length > 0) out.set(p.number, s);
  }
  return out;
}

/**
 * 太線にする艇を選ぶ札（線の無い艇は押せない）。1200px 以上は右の列で6艇の一覧（艇番・選手名・右端の値）になる。
 * 1199px 以下は名前と値を隠し、今までの札の横並び（オーナー 11/25 の案 A）
 */
export function BoatPicker({
  sortedPlayers,
  has,
  selected,
  onSelectBoat,
  valueOf,
  valueLabel,
}) {
  const { t } = useTranslation();
  return (
    <div className="trc-boats">
      {/* 1200px 以上の一覧の見出し（案内と値の札）。それ未満は隠す（visual-designer 11/25） */}
      <div className="trc-boats-head" aria-hidden="true">
        <span>{t("basicInfo.trend.pickHint")}</span>
        <span>{valueLabel ?? t("basicInfo.trend.latest")}</span>
      </div>
      {sortedPlayers.map((p) => (
        <button
          key={p.number}
          type="button"
          className="trc-boat"
          aria-pressed={p.number === selected}
          disabled={!has(p.number)}
          onClick={() => onSelectBoat(p.number)}
          aria-label={t("basicInfo.trend.selectBoat", { boat: p.number })}
        >
          <BoatBadge n={p.number} />
          <span className="trc-boat-name" translate="no">
            {p.name?.replace(/\s+/g, "")}
          </span>
          <span className="trc-boat-value">{valueOf?.(p.number) ?? "—"}</span>
        </button>
      ))}
      <span className="trc-hint">{t("basicInfo.trend.tapHint")}</span>
    </div>
  );
}

export default function BasicInfoTrend({
  metric,
  scope,
  grade,
  venueCode,
  sortedPlayers,
  recordsOf,
  selectedBoat,
  onSelectBoat,
  winRate,
}) {
  const { t } = useTranslation();
  if (metric === "winRate")
    return (
      <WinRateTrend
        {...winRate}
        sortedPlayers={sortedPlayers}
        selectedBoat={selectedBoat}
        renderPicker={(has, selected, valueOf) => (
          <BoatPicker
            sortedPlayers={sortedPlayers}
            has={has}
            selected={selected}
            onSelectBoat={onSelectBoat}
            valueOf={valueOf}
            valueLabel={t("basicInfo.trend.lastPeriod")}
          />
        )}
      />
    );
  const metricName = t(`basicInfo.metrics.${metric}`);
  const supported = TREND_METRICS.includes(metric);
  const loading = sortedPlayers.some(
    (p) => p.racerId && recordsOf(p.racerId) === undefined,
  );
  // 取得の失敗（null）は「記録が足りない」と分けて出す。失敗した艇は線から外れる
  const failed = sortedPlayers.some(
    (p) => p.racerId && recordsOf(p.racerId) === null,
  );
  const series =
    supported && !loading
      ? seriesOf({ sortedPlayers, recordsOf, metric, scope, grade, venueCode })
      : new Map();
  const selected = series.has(selectedBoat)
    ? selectedBoat
    : [...series.keys()][0];
  return (
    <div className="trc-wrap trc-wrap--wide">
      {supported && loading && (
        <p className="trc-note">{t("basicInfo.loading")}</p>
      )}
      {supported && failed && <InlineFetchError />}
      {supported && !loading && !failed && series.size === 0 && (
        <p className="trc-note">{t("basicInfo.trend.notEnough")}</p>
      )}
      {series.size > 0 && (
        // 1200px 以上は左に図・右に6艇の一覧と注記（.race-split、オーナー 11/25 の案 A）。それ未満は縦に並ぶ
        <div className="race-split trc-split">
          <div className="race-split__main">
            <TrendChart
              seriesByBoat={series}
              metric={metric}
              selected={selected}
            />
          </div>
          <div className="race-split__side">
            <BoatPicker
              sortedPlayers={sortedPlayers}
              has={(boat) => series.has(boat)}
              selected={selected}
              onSelectBoat={onSelectBoat}
              valueOf={(boat) => endValue(series.get(boat), metric)}
            />
            <p className="trc-note">
              {t("basicInfo.trend.note", { metric: metricName })}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
