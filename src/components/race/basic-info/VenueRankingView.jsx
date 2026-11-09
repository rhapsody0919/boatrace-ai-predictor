import { useTranslation } from "react-i18next";
import { computeVenueRanking } from "../basicInfoStats";
import { formatMetricValue, ownMetricLabel } from "./format";

export default function VenueRankingView({ records, metric, venueCode }) {
  const { t } = useTranslation();
  if (records === undefined || records === null) {
    return <p className="rbit-expanded-loading">{t("basicInfo.loading")}</p>;
  }
  const ranking = computeVenueRanking(records, metric);
  if (ranking.length === 0) {
    return <p className="rbit-expanded-empty">{t("basicInfo.noVenueData")}</p>;
  }
  const currentRank = ranking.findIndex((r) => r.venueCode === venueCode) + 1;
  return (
    <div className="rbit-venue-ranking">
      <p className="rbit-venue-metric-label">
        {t("basicInfo.venueRankingFor", {
          metric: ownMetricLabel(t, metric),
        })}
      </p>
      {/* 条件別と同じく自社集計で、上のバーの公式値とは別物。どの期間・
          どの会場が対象かも書く（#1069 ファン評価1周目） */}
      <p className="rbit-conditions-note rbit-venue-note">
        {t("basicInfo.venueRankingNote")}
      </p>
      {currentRank > 0 && (
        <p className="rbit-venue-current-rank">
          {t("basicInfo.currentVenueRank", {
            venue: t(`venues.${venueCode}`),
            rank: currentRank,
            total: ranking.length,
          })}
        </p>
      )}
      <ol className="rbit-venue-list">
        {ranking.slice(0, 5).map((row, idx) => {
          const rowN = metric === "avgSt" ? row.avgStN : row.n;
          const rowValue = metric === "avgSt" ? row.avgSt : row[metric];
          return (
            <li
              key={row.venueCode}
              className={
                row.venueCode === venueCode
                  ? "rbit-venue-item is-current"
                  : "rbit-venue-item"
              }
            >
              <span className="rbit-venue-rank">{idx + 1}</span>
              <span className="rbit-venue-name">
                {t(`venues.${row.venueCode}`)}
              </span>
              <span className="rbit-venue-rate">
                {formatMetricValue(metric, rowValue)}
              </span>
              <span className="rbit-venue-n">
                {t("basicInfo.sampleCount", { n: rowN })}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
