/**
 * VenueRankingChart - 会場ランキング（BOA-171、BOA-267で90日指標を追加）
 * 「本日限定」（固い場・荒れている場・イン逃げ率・万舟率、本日の結果確定済み
 * レースのみが対象）と「直近90日実績」（1号艇勝率、全24会場）の2グループを
 * 表示する。タブ名・見出しから「本日の」を外しているのは、90日指標を追加した
 * ことで「このタブ全体が本日限定」という前提が成り立たなくなったため
 * （2026-09-15、ユーザー指摘を受けて修正。両グループを見出しで明確に分離する）
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
  const [firstWinRate, setFirstWinRate] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const loadRanking = async () => {
      setLoading(true);
      setError(null);
      // allSettled: 1号艇勝率（新規・全会場90日スキャンで相対的に重い）の失敗が
      // 従来から安定していた本日限定の4指標まで道連れでエラー状態にしないよう、
      // 互いに独立して失敗を扱う
      const [todaysResult, firstWinRateResult] = await Promise.allSettled([
        supabaseDataService.getTodaysVenueRanking(5),
        supabaseDataService.getVenueFirstWinRateRanking(),
      ]);

      if (todaysResult.status === "fulfilled") {
        setRanking(todaysResult.value);
      } else {
        setError(todaysResult.reason?.message || t("analysis.dataLoadError"));
        console.error(
          "Failed to load today's venue ranking:",
          todaysResult.reason,
        );
      }

      if (firstWinRateResult.status === "fulfilled") {
        setFirstWinRate(firstWinRateResult.value);
      } else {
        console.error(
          "Failed to load venue first-win-rate ranking:",
          firstWinRateResult.reason,
        );
      }

      setLoading(false);
    };
    loadRanking();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isEmpty =
    ranking.stable.length === 0 &&
    ranking.rough.length === 0 &&
    ranking.nigeRate.length === 0 &&
    ranking.manshu.length === 0 &&
    firstWinRate.length === 0;

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
          <h3 className="venue-ranking-scope-heading">
            {t("analysis.venueRanking.todayGroupHeading")}
          </h3>
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
          <p className="table-note">{t("analysis.venueRanking.note")}</p>

          <h3 className="venue-ranking-scope-heading">
            {t("analysis.venueRanking.ninetyDayGroupHeading")}
          </h3>
          <RankingTable
            title={t("analysis.venueRanking.firstWinRateTitle")}
            rows={firstWinRate}
            emptyMessage={t("analysis.venueRanking.notEnoughData")}
            valueHeader={t("analysis.venueRanking.firstWinRateHeader")}
            formatValue={(row) => `${row.first_win_rate.toFixed(1)}%`}
          />
          <p className="table-note">
            {t("analysis.venueRanking.firstWinRateNote")}
          </p>
        </>
      )}

      <p className="table-note">{t("analysis.venueRanking.note")}</p>
    </div>
  );
}

export default VenueRankingChart;
