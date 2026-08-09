/**
 * VenueRankingChart - 本日の会場ランキング（BOA-171）
 * 本日の結果確定済みレースを会場別に横断集計し、固い場・荒れている場・
 * イン逃げ率・万舟率の4指標でランキング表示する。他のタブと異なり、
 * 会場・レースを選ばず本日のカード全体から注目会場を発見できる。
 */
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { supabaseDataService } from "../../services/supabaseDataService";
import "./MotorConditionChart.css";

function RankingTable({ title, rows, emptyMessage, valueHeader, formatValue }) {
  const { t } = useTranslation();
  return (
    <div className="table-wrapper">
      <h3 className="selected-motor-heading">{title}</h3>
      {rows.length === 0 ? (
        <div className="empty-state">{emptyMessage}</div>
      ) : (
        <table className="motor-ranking-table">
          <thead>
            <tr>
              <th>{t("analysis.rankHeader")}</th>
              <th>{t("analysis.venueHeader")}</th>
              <th>{valueHeader}</th>
              <th>{t("analysis.venueRanking.raceCountHeader")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr
                key={row.venue_code}
                className="motor-ranking-row non-clickable-row"
              >
                <td className="rank">{idx + 1}</td>
                <td>{t(`venues.${row.venue_code}`, String(row.venue_code))}</td>
                <td className="rate">{formatValue(row)}</td>
                <td className="rate">{row.race_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function VenueRankingChart() {
  const { t } = useTranslation();
  const [ranking, setRanking] = useState({
    stable: [],
    rough: [],
    nigeRate: [],
    manshu: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const loadRanking = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await supabaseDataService.getTodaysVenueRanking(5);
        setRanking(data);
      } catch (err) {
        setError(err.message || t("analysis.dataLoadError"));
        console.error("Failed to load today's venue ranking:", err);
      } finally {
        setLoading(false);
      }
    };
    loadRanking();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isEmpty =
    ranking.stable.length === 0 &&
    ranking.rough.length === 0 &&
    ranking.nigeRate.length === 0 &&
    ranking.manshu.length === 0;

  return (
    <div className="motor-condition-container">
      <h2>{t("analysis.venueRanking.title")}</h2>
      <p className="section-description">
        {t("analysis.venueRanking.description")}
      </p>

      {loading && <div className="loading-state">{t("analysis.loading")}</div>}
      {error && (
        <div className="error-state">
          {t("analysis.error", { message: error })}
        </div>
      )}

      {!loading && !error && isEmpty && (
        <div className="empty-state">{t("analysis.venueRanking.empty")}</div>
      )}

      {!loading && !error && !isEmpty && (
        <>
          <RankingTable
            title={t("analysis.venueRanking.stableTitle")}
            rows={ranking.stable}
            emptyMessage={t("analysis.venueRanking.notEnoughData")}
            valueHeader={t("analysis.venueRanking.avgPayoutHeader")}
            formatValue={(row) =>
              `¥${Math.round(row.avg_payout).toLocaleString()}`
            }
          />
          <RankingTable
            title={t("analysis.venueRanking.roughTitle")}
            rows={ranking.rough}
            emptyMessage={t("analysis.venueRanking.notEnoughData")}
            valueHeader={t("analysis.venueRanking.avgPayoutHeader")}
            formatValue={(row) =>
              `¥${Math.round(row.avg_payout).toLocaleString()}`
            }
          />
          <RankingTable
            title={t("analysis.venueRanking.nigeRateTitle")}
            rows={ranking.nigeRate}
            emptyMessage={t("analysis.venueRanking.notEnoughData")}
            valueHeader={t("analysis.venueRanking.nigeRateHeader")}
            formatValue={(row) => `${row.nige_rate.toFixed(1)}%`}
          />
          <RankingTable
            title={t("analysis.venueRanking.manshuTitle")}
            rows={ranking.manshu}
            emptyMessage={t("analysis.venueRanking.notEnoughData")}
            valueHeader={t("analysis.venueRanking.manshuRateHeader")}
            formatValue={(row) => `${row.manshu_rate.toFixed(1)}%`}
          />
        </>
      )}

      <p className="table-note">{t("analysis.venueRanking.note")}</p>
    </div>
  );
}

export default VenueRankingChart;
