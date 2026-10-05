/**
 * StPredictabilityChart - 展示ST/本番STのズレ（BOA-153）
 * 本日開催中の会場・レースを選ぶと、そのレースに出走する6選手について
 * 展示STと本番STがどれくらいズレる傾向にあるか（過去実績）を表示する。
 * ズレが小さいほど「展示STが本番の参考になる=安定」という指標。
 * 気になる選手は節を問わず過去レースごとのズレ推移にドリルダウンできる。
 */
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { supabaseDataService } from "../../services/supabaseDataService";
import { STADIUM_NAMES as VENUE_NAMES } from "../../constants";
import { useVenueRaceSelector } from "../../hooks/useVenueRaceSelector";
import TrendLineChart from "./TrendLineChart";
import { bestOf } from "../../utils/bestOf";
import { formatExhibitionSt } from "../../utils/formatters";
import DrillDownHeader from "./DrillDownHeader";
import "./MotorConditionChart.css";

function StPredictabilityChart({
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
          await supabaseDataService.getRaceStPredictabilityBreakdown(
            selectedRace,
          );
        setBreakdown(data);
      } catch (err) {
        setError(err.message || t("analysis.dataLoadError"));
        console.error("Failed to load race ST predictability breakdown:", err);
      } finally {
        setLoading(false);
      }
    };
    loadBreakdown();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRace]);

  useEffect(() => {
    if (drillDownRacer === null) return;
    const loadTrend = async () => {
      try {
        setLoading(true);
        setError(null);
        const data =
          await supabaseDataService.getStDeviationTrend(drillDownRacer);
        setTrendData(data);
      } catch (err) {
        setError(err.message || t("analysis.dataLoadError"));
        console.error("Failed to load ST deviation trend:", err);
      } finally {
        setLoading(false);
      }
    };
    loadTrend();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drillDownRacer]);

  // ズレが最も小さい艇（同値は全部）。表示と同じ小数3桁で比べる（R1）
  const bestDeviationBoats = bestOf(
    breakdown.map((r) => ({ boat: r.boat_number, value: r.avg_deviation })),
    "min",
    { digits: 3 },
  );

  const chartData = (trendData?.trend ?? []).map((row) => ({
    date: row.date.slice(5),
    deviation: row.avg_deviation,
  }));

  const drillDownRacerName = breakdown.find(
    (r) => r.racer_id === drillDownRacer,
  )?.player_name;

  return (
    <div className="motor-condition-container">
      {!embedded && (
        <>
          <h2>{t("analysis.st.title")}</h2>
          <p className="section-description">{t("analysis.st.description")}</p>
        </>
      )}

      {!embedded &&
        (venues.length === 0 && !loading ? (
          <div className="empty-state">{t("analysis.noRacesToday")}</div>
        ) : (
          <div className="controls-section">
            <label htmlFor="st-venue-select">
              {t("analysis.venueSelectTodayLabel")}
            </label>
            <select
              id="st-venue-select"
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
                <label htmlFor="st-race-select">
                  {t("analysis.raceSelectLabel")}
                </label>
                <select
                  id="st-race-select"
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
                  <th>{t("analysis.st.todayStHeader")}</th>
                  <th>{t("analysis.st.avgDevHeader")}</th>
                  <th>{t("analysis.sampleCountHeader")}</th>
                </tr>
              </thead>
              <tbody>
                {breakdown.map((row) => (
                  <tr
                    key={row.boat_number}
                    className={`motor-ranking-row ${row.racer_id === null ? "non-clickable-row" : ""}`}
                    onClick={() =>
                      row.racer_id !== null && setDrillDownRacer(row.racer_id)
                    }
                  >
                    <td className="rank">{row.boat_number}</td>
                    <td translate="no">
                      {row.player_name?.replace(/\s+/g, "")}
                    </td>
                    <td className="rate">
                      {/* 展示のフライング・出遅れは公式の表記（F.01 等）で出す（BOA-759） */}
                      {formatExhibitionSt(
                        row.exhibition_st,
                        row.exhibition_start_flag,
                      ) ?? t("analysis.notMeasured")}
                    </td>
                    {/* 最良は行全体ではなく、比べている値（平均ズレ）のセルに金枠（R1） */}
                    <td
                      className={`rate${bestDeviationBoats.has(row.boat_number) ? " ind-best" : ""}`}
                    >
                      {row.avg_deviation !== null
                        ? row.avg_deviation.toFixed(3)
                        : t("analysis.noData")}
                    </td>
                    <td className="rate">{row.sample_count}</td>
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
            heading={t("analysis.st.trendHeading", {
              name: drillDownRacerName?.replace(/\s+/g, ""),
            })}
            racerId={drillDownRacer}
            racerLinkLabel={t("analysis.racerPageLink")}
          />

          {chartData.length > 0 ? (
            <TrendLineChart
              data={chartData}
              yAxisLabel={t("analysis.st.yAxis")}
              tooltipFormatter={(value) => value.toFixed(3)}
              series={[
                {
                  dataKey: "deviation",
                  name: t("analysis.st.legend"),
                  stroke: "var(--brand-accent-primary)",
                },
              ]}
            />
          ) : (
            <div className="empty-state">{t("analysis.racerTrendEmpty")}</div>
          )}
        </>
      )}

      <p className="table-note">{t("analysis.st.note")}</p>
    </div>
  );
}

export default StPredictabilityChart;
