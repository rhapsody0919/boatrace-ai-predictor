/**
 * ExhibitionTimeTrendChart - 選手別展示タイム推移（BOA-164）
 * 本日開催中の会場・レースを選ぶと、そのレースに出走する6選手について
 * 展示タイム（周回展示の2周目の150mのタイム）が過去90日間でどう推移しているかを表示する。
 * 「展示タイム最速艇の1着転換率」（会場・枠番単位）とは異なり、選手個人単位の推移を見る機能。
 */
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { getRaceExhibitionTimeBreakdown } from "../../services/raceQueries2.js";
import { getExhibitionTimeTrend } from "../../services/racerQueries3.js";
import { STADIUM_NAMES as VENUE_NAMES } from "../../constants";
import { useVenueRaceSelector } from "../../hooks/useVenueRaceSelector";
import TrendLineChart from "./TrendLineChart";
import { bestOf } from "../../utils/bestOf";
import DrillDownHeader from "./DrillDownHeader";
import "./MotorConditionChart.css";

function ExTrendVenueRaceControls({
  venues,
  loading,
  selectedVenue,
  setSelectedVenue,
  races,
  selectedRace,
  setSelectedRace,
  t,
}) {
  return venues.length === 0 && !loading ? (
    <div className="empty-state">{t("analysis.noRacesToday")}</div>
  ) : (
    <div className="controls-section">
      <label htmlFor="extrend-venue-select">
        {t("analysis.venueSelectTodayLabel")}
      </label>
      <select
        id="extrend-venue-select"
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
          <label htmlFor="extrend-race-select">
            {t("analysis.raceSelectLabel")}
          </label>
          <select
            id="extrend-race-select"
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
  );
}

function ExTrendBreakdownRow({ row, bestAvgTimeBoats, setDrillDownRacer, t }) {
  return (
    <tr
      className={`motor-ranking-row ${row.racer_id === null ? "non-clickable-row" : ""}`}
      onClick={() =>
        row.racer_id !== null && setDrillDownRacer(row.racer_id)
      }
    >
      <td className="rank">{row.boat_number}</td>
      <td translate="no">{row.player_name?.replace(/\s+/g, "")}</td>
      <td className="rate">
        {row.exhibition_time !== null
          ? row.exhibition_time.toFixed(2)
          : t("analysis.notMeasured")}
      </td>
      {/* 最良は行全体ではなく、比べている値（平均展示）のセルに金枠（R1） */}
      <td
        className={`rate${bestAvgTimeBoats.has(row.boat_number) ? " ind-best" : ""}`}
      >
        {row.avg_exhibition_time !== null
          ? row.avg_exhibition_time.toFixed(2)
          : t("analysis.noData")}
      </td>
      <td className="rate">{row.sample_count}</td>
    </tr>
  );
}

function ExTrendBreakdownTable({
  breakdown,
  bestAvgTimeBoats,
  setDrillDownRacer,
  t,
}) {
  return (
    <div className="table-wrapper">
      <table className="motor-ranking-table">
        <thead>
          <tr>
            <th>{t("analysis.laneHeader")}</th>
            <th>{t("table.playerName")}</th>
            <th>{t("analysis.exTrend.todayTimeHeader")}</th>
            <th>{t("analysis.exTrend.avgTimeHeader")}</th>
            <th>{t("analysis.sampleCountHeader")}</th>
          </tr>
        </thead>
        <tbody>
          {breakdown.map((row) => (
            <ExTrendBreakdownRow
              key={row.boat_number}
              row={row}
              bestAvgTimeBoats={bestAvgTimeBoats}
              setDrillDownRacer={setDrillDownRacer}
              t={t}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ExTrendDrillDown({
  drillDownRacer,
  drillDownRacerName,
  setDrillDownRacer,
  chartData,
  t,
}) {
  return (
    <>
      <DrillDownHeader
        onBack={() => setDrillDownRacer(null)}
        backLabel={t("analysis.backToList")}
        heading={t("analysis.racerTrendHeading", {
          name: drillDownRacerName?.replace(/\s+/g, ""),
        })}
        racerId={drillDownRacer}
        racerLinkLabel={t("analysis.racerPageLink")}
      />

      {chartData.length > 0 ? (
        <TrendLineChart
          data={chartData}
          yAxisLabel={t("analysis.exTrend.yAxis")}
          yAxisDomain={["dataMin - 0.1", "dataMax + 0.1"]}
          tooltipFormatter={(value) => value.toFixed(2)}
          series={[
            {
              dataKey: "exhibition_time",
              name: t("analysis.exTrend.legend"),
              stroke: "var(--brand-accent-primary)",
            },
          ]}
        />
      ) : (
        <div className="empty-state">{t("analysis.racerTrendEmpty")}</div>
      )}
    </>
  );
}

async function loadBreakdown({
  selectedRace,
  setLoading,
  setError,
  setDrillDownRacer,
  setBreakdown,
  t,
}) {
  try {
    setLoading(true);
    setError(null);
    setDrillDownRacer(null);
    const data = await getRaceExhibitionTimeBreakdown(selectedRace);
    setBreakdown(data);
  } catch (err) {
    setError(err.message || t("analysis.dataLoadError"));
    console.error("Failed to load race exhibition time breakdown:", err);
  } finally {
    setLoading(false);
  }
}

async function loadTrend({
  drillDownRacer,
  setLoading,
  setError,
  setTrendData,
  t,
}) {
  try {
    setLoading(true);
    setError(null);
    const data = await getExhibitionTimeTrend(drillDownRacer);
    setTrendData(data);
  } catch (err) {
    setError(err.message || t("analysis.dataLoadError"));
    console.error("Failed to load exhibition time trend:", err);
  } finally {
    setLoading(false);
  }
}

// 平均展示が最も速い艇（同値は全部）。表示と同じ小数2桁で比べる（R1）
function bestBoatsOf(breakdown) {
  return bestOf(
    breakdown.map((r) => ({
      boat: r.boat_number,
      value: r.avg_exhibition_time,
    })),
    "min",
    { digits: 2 },
  );
}

function chartDataOf(trendData) {
  return (trendData?.trend ?? []).map((row) => ({
    date: row.date.slice(5),
    exhibition_time: row.avg_exhibition_time,
  }));
}

function racerNameOf(breakdown, drillDownRacer) {
  return breakdown.find((r) => r.racer_id === drillDownRacer)?.player_name;
}

function ExTrendHeading({ t }) {
  return (
    <>
      <h2>{t("analysis.exTrend.title")}</h2>
      <p className="section-description">
        {t("analysis.exTrend.description")}
      </p>
    </>
  );
}

function ExhibitionTimeTrendChart({
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
    loadBreakdown({
      selectedRace,
      setLoading,
      setError,
      setDrillDownRacer,
      setBreakdown,
      t,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRace]);

  useEffect(() => {
    if (drillDownRacer === null) return;
    loadTrend({ drillDownRacer, setLoading, setError, setTrendData, t });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drillDownRacer]);

  const bestAvgTimeBoats = bestBoatsOf(breakdown);

  const chartData = chartDataOf(trendData);

  const drillDownRacerName = racerNameOf(breakdown, drillDownRacer);

  return (
    <div className="motor-condition-container">
      {!embedded && <ExTrendHeading t={t} />}

      {!embedded && (
        <ExTrendVenueRaceControls
          venues={venues}
          loading={loading}
          selectedVenue={selectedVenue}
          setSelectedVenue={setSelectedVenue}
          races={races}
          selectedRace={selectedRace}
          setSelectedRace={setSelectedRace}
          t={t}
        />
      )}

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
          <ExTrendBreakdownTable
            breakdown={breakdown}
            bestAvgTimeBoats={bestAvgTimeBoats}
            setDrillDownRacer={setDrillDownRacer}
            t={t}
          />
        )}

      {!loading && !error && drillDownRacer !== null && (
        <ExTrendDrillDown
          drillDownRacer={drillDownRacer}
          drillDownRacerName={drillDownRacerName}
          setDrillDownRacer={setDrillDownRacer}
          chartData={chartData}
          t={t}
        />
      )}

      <p className="table-note">{t("analysis.exTrend.note")}</p>
    </div>
  );
}

export default ExhibitionTimeTrendChart;
