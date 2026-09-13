/**
 * RacerFormChart - 選手勝率上昇/下降（BOA-152）
 * 本日開催中の会場・レースを選ぶと、そのレースに出走する6選手の
 * 現在の全国勝率と約90日前時点の全国勝率を比較し、調子の変化を示す。
 * 気になる選手は節ごとの推移グラフにドリルダウンできる。
 */
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { supabaseDataService } from "../../services/supabaseDataService";
import { STADIUM_NAMES as VENUE_NAMES } from "../../constants";
import { useVenueRaceSelector } from "../../hooks/useVenueRaceSelector";
import TrendLineChart from "./TrendLineChart";
import DrillDownHeader from "./DrillDownHeader";
import "./MotorConditionChart.css";

function RacerFormChart({
  initialVenueCode = null,
  initialRaceId = null,
  embedded = false,
}) {
  const { t } = useTranslation();
  const {
    venues,
    selectedVenue,
    setSelectedVenue,
    races,
    selectedRace,
    setSelectedRace,
    loading,
    setLoading,
    error,
    setError,
  } = useVenueRaceSelector({ initialVenueCode, initialRaceId, embedded, t });

  const [breakdown, setBreakdown] = useState([]);
  const [drillDownRacer, setDrillDownRacer] = useState(null);
  const [trendData, setTrendData] = useState(null);

  useEffect(() => {
    if (selectedRace === null) return;
    const loadBreakdown = async () => {
      try {
        setLoading(true);
        setError(null);
        setDrillDownRacer(null);
        const data =
          await supabaseDataService.getRaceRacerFormBreakdown(selectedRace);
        setBreakdown(data);
      } catch (err) {
        setError(err.message || t("analysis.dataLoadError"));
        console.error("Failed to load race racer form breakdown:", err);
      } finally {
        setLoading(false);
      }
    };
    loadBreakdown();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRace]);

  // 選手選択時: 節ごとの全国勝率推移を取得
  useEffect(() => {
    if (drillDownRacer === null) return;
    const loadTrend = async () => {
      try {
        setLoading(true);
        setError(null);
        const data =
          await supabaseDataService.getRacerFormTrend(drillDownRacer);
        setTrendData(data);
      } catch (err) {
        setError(err.message || t("analysis.dataLoadError"));
        console.error("Failed to load racer form trend:", err);
      } finally {
        setLoading(false);
      }
    };
    loadTrend();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drillDownRacer]);

  const bestDelta =
    breakdown.length > 0
      ? Math.max(
          ...breakdown.filter((r) => r.delta !== null).map((r) => r.delta),
        )
      : null;

  const chartData = (trendData?.trend ?? []).map((row) => ({
    date: row.date.slice(5),
    national_win_rate: row.win_rate,
    local_win_rate: row.local_win_rate,
  }));

  const drillDownRacerName = breakdown.find(
    (r) => r.racer_id === drillDownRacer,
  )?.player_name;

  return (
    <div className="motor-condition-container">
      {!embedded && (
        <>
          <h2>{t("analysis.racerForm.title")}</h2>
          <p className="section-description">
            {t("analysis.racerForm.description")}
          </p>
        </>
      )}

      {!embedded &&
        (venues.length === 0 && !loading ? (
          <div className="empty-state">{t("analysis.noRacesToday")}</div>
        ) : (
          <div className="controls-section">
            <label htmlFor="racer-venue-select">
              {t("analysis.venueSelectTodayLabel")}
            </label>
            <select
              id="racer-venue-select"
              value={selectedVenue ?? ""}
              onChange={(e) => setSelectedVenue(parseInt(e.target.value, 10))}
              className="venue-select"
            >
              {venues.map((v) => (
                <option key={v} value={v}>
                  {t(`venues.${v}`, VENUE_NAMES[v] || String(v))}
                </option>
              ))}
            </select>

            {races.length > 0 && (
              <>
                <label htmlFor="racer-race-select">
                  {t("analysis.raceSelectLabel")}
                </label>
                <select
                  id="racer-race-select"
                  value={selectedRace ?? ""}
                  onChange={(e) => setSelectedRace(e.target.value)}
                  className="venue-select"
                >
                  {races.map((r) => (
                    <option key={r.race_id} value={r.race_id}>
                      {t("analysis.raceOption", {
                        number: r.race_number,
                        time: r.start_time?.slice(0, 5),
                      })}
                    </option>
                  ))}
                </select>
              </>
            )}
          </div>
        ))}

      {loading && <div className="loading-state">{t("analysis.loading")}</div>}
      {error && (
        <div className="error-state">
          {t("analysis.error", { message: error })}
        </div>
      )}

      {!loading &&
        !error &&
        drillDownRacer === null &&
        breakdown.length > 0 && (
          <div className="table-wrapper">
            <table className="motor-ranking-table">
              <thead>
                <tr>
                  <th>{t("analysis.laneHeader")}</th>
                  <th>{t("table.playerName")}</th>
                  <th>{t("analysis.racerForm.currentWinRateHeader")}</th>
                  <th>{t("analysis.racerForm.past90Header")}</th>
                  <th>{t("analysis.racerForm.deltaHeader")}</th>
                </tr>
              </thead>
              <tbody>
                {breakdown.map((row) => (
                  <tr
                    key={row.boat_number}
                    className={`motor-ranking-row ${row.racer_id === null ? "non-clickable-row" : ""} ${row.delta === bestDelta && bestDelta > 0 ? "best-motor" : ""}`}
                    onClick={() =>
                      row.racer_id !== null && setDrillDownRacer(row.racer_id)
                    }
                  >
                    <td className="rank">{row.boat_number}</td>
                    <td translate="no">
                      {row.player_name?.replace(/\s+/g, "")}
                    </td>
                    <td className="rate">{row.win_rate?.toFixed(2)}</td>
                    <td className="rate">
                      {row.past_win_rate !== null
                        ? row.past_win_rate.toFixed(2)
                        : t("analysis.noData")}
                    </td>
                    <td className="rate">
                      {row.delta !== null ? (
                        <span
                          className={
                            row.delta > 0
                              ? "delta-up"
                              : row.delta < 0
                                ? "delta-down"
                                : ""
                          }
                        >
                          {row.delta > 0 ? "↑" : row.delta < 0 ? "↓" : "→"}{" "}
                          {Math.abs(row.delta).toFixed(2)}
                        </span>
                      ) : (
                        "-"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

      {!loading && !error && drillDownRacer !== null && (
        <>
          <DrillDownHeader
            onBack={() => setDrillDownRacer(null)}
            backLabel={t("analysis.backToList")}
            heading={t("analysis.racerTrendHeading", {
              name: drillDownRacerName?.replace(/\s+/g, ""),
            })}
            racerId={drillDownRacer}
            racerLinkLabel="→ 選手ページを見る"
          />

          {chartData.length > 0 ? (
            <TrendLineChart
              data={chartData}
              yAxisLabel={t("analysis.racerForm.yAxis")}
              tooltipFormatter={(value) => value.toFixed(2)}
              series={[
                {
                  dataKey: "national_win_rate",
                  name: t("analysis.racerForm.legendNational"),
                  stroke: "var(--brand-accent-primary)",
                  type: "stepAfter",
                },
                {
                  dataKey: "local_win_rate",
                  name: t("analysis.racerForm.legendLocal"),
                  stroke: "var(--brand-accent-secondary)",
                  type: "stepAfter",
                },
              ]}
            />
          ) : (
            <div className="empty-state">{t("analysis.racerTrendEmpty")}</div>
          )}
        </>
      )}

      <p className="table-note">{t("analysis.racerForm.note")}</p>
    </div>
  );
}

export default RacerFormChart;
