/**
 * TodaysVolatilityHighlights - 本日のイン崩れ注意度ハイライト
 * ホーム画面の会場グリッド直前に表示し、当日全レースをイン崩れ指数（unified予想モデルの
 * feature_contributions.volatilityPercentile、get_today_races RPC経由）でソートして
 * 上位（注意度が高い）・下位（注意度が低い）を提示する。
 * scripts/daily/todays-volatility-digest.js（SNS投稿用ダイジェスト）と同じ
 * predictions.feature_contributions.volatilityPercentileが情報源のため、
 * Web/SNS間で表示内容が食い違うことはない。
 */
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useLocalizedPath } from "../../hooks/useLocalizedPath";
import { getRaceId } from "../../utils/raceId";
import "./TodaysVolatilityHighlights.css";

const HIGHLIGHT_COUNT = 5;

function flattenRaces(venuesData) {
  const races = [];
  for (const venue of venuesData || []) {
    for (const race of venue.races || []) {
      // isFallbackは会場内サンプル数不足によるプレースホルダ値（0.5）のため、
      // 「注意度が高い/低い」の根拠として提示すると誤解を招く。除外する
      if (!race.volatility || race.volatility.isFallback) continue;
      if (typeof race.volatility.percentile !== "number") continue;
      races.push({
        raceId: getRaceId({ rawData: race }),
        venueName: venue.placeName,
        raceNo: race.raceNo,
        percentile: race.volatility.percentile,
      });
    }
  }
  return races;
}

function HighlightList({ title, races, t }) {
  if (races.length === 0) return null;
  return (
    <div className="volatility-highlights__column">
      <h3 className="volatility-highlights__column-title">{title}</h3>
      <ul className="volatility-highlights__list">
        {races.map((race) => (
          <li key={race.raceId}>
            <RaceLink race={race} t={t} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function RaceLink({ race, t }) {
  const localize = useLocalizedPath();
  return (
    <Link
      to={localize(`/race/${race.raceId}`)}
      className="volatility-highlights__race-link"
    >
      <span translate="no">
        {race.venueName} {race.raceNo}R
      </span>
      <span className="volatility-highlights__percentile">
        {Math.round(race.percentile * 100)}%
      </span>
    </Link>
  );
}

function TodaysVolatilityHighlights({ venuesData }) {
  const { t } = useTranslation();

  const races = flattenRaces(venuesData);
  const n = Math.min(HIGHLIGHT_COUNT, Math.floor(races.length / 2));
  if (n === 0) return null;

  const sorted = [...races].sort((a, b) => b.percentile - a.percentile);
  const highRaces = sorted.slice(0, n);
  const lowRaces = sorted.slice(races.length - n).reverse();

  return (
    <section className="volatility-highlights">
      <h2 className="volatility-highlights__title">
        {t("home.volatilityHighlightsTitle")}
      </h2>
      <div className="volatility-highlights__columns">
        <HighlightList
          title={`⚠️ ${t("volatility.levelHigh")}`}
          races={highRaces}
          t={t}
        />
        <HighlightList
          title={`🎯 ${t("volatility.levelLow")}`}
          races={lowRaces}
          t={t}
        />
      </div>
    </section>
  );
}

export default TodaysVolatilityHighlights;
