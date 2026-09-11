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
        startTime: race.startTime || null,
        percentile: race.volatility.percentile,
        // turnPrediction は get_today_races RPC（052マイグレーション）が返す場合のみ
        // 存在する。未適用環境ではundefinedのため、無いものとして扱う
        turnPrediction: race.turnPrediction || null,
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
  const tp = race.turnPrediction;
  return (
    <Link
      to={localize(`/race/${race.raceId}`)}
      className="volatility-highlights__race-link"
    >
      <div className="volatility-highlights__race-main">
        <span translate="no">
          {race.venueName} {race.raceNo}R
          {race.startTime && (
            <span className="volatility-highlights__time">
              {" "}
              {race.startTime}
            </span>
          )}
        </span>
        <span className="volatility-highlights__percentile">
          {Math.round(race.percentile * 100)}%
        </span>
      </div>
      {tp && typeof tp.probability === "number" && (
        <div className="volatility-highlights__turn">
          {t("home.volatilityHighlightsTurnPrediction", {
            course: tp.winnerCourse,
            technique: t(`techniques.${tp.technique}`, tp.technique),
            probability: Math.round(tp.probability * 100),
          })}
        </div>
      )}
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
      <AccuracyLink t={t} />
    </section>
  );
}

// BOA-248: イン崩れ指数を根拠にレースを選んだユーザーが、その指数自体の
// 実測精度をすぐ確認できるよう、ハイライト直後に導線を置く
function AccuracyLink({ t }) {
  const localize = useLocalizedPath();
  return (
    <p className="volatility-highlights__accuracy-link">
      <Link to={localize("/accuracy")}>
        📈 {t("home.volatilityHighlightsAccuracyLink")}
      </Link>
    </p>
  );
}

export default TodaysVolatilityHighlights;
