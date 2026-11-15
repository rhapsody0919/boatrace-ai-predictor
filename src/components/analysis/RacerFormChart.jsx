/**
 * RacerFormChart - 選手勝率上昇/下降（BOA-152）
 * 本日開催中の会場・レースを選ぶと、そのレースに出走する6選手の
 * 現在の全国勝率と約90日前時点の全国勝率を比較し、調子の変化を示す。
 * 気になる選手は節ごとの推移グラフにドリルダウンできる。
 */
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { getRaceRacerFormBreakdown } from "../../services/raceQueries.js";
import { getRacerFormTrend } from "../../services/racerQueries.js";
import { STADIUM_NAMES as VENUE_NAMES } from "../../constants";
import { useVenueRaceSelector } from "../../hooks/useVenueRaceSelector";
import TrendLineChart from "./TrendLineChart";
import { bestOf } from "../../utils/bestOf";
import DrillDownHeader from "./DrillDownHeader";
import "./MotorConditionChart.css";


function RacerFormSelectors({
  t,
  venues,
  selectedVenue,
  setSelectedVenue,
  races,
  selectedRace,
  setSelectedRace,
}) {
  return (
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
  );
}

function RacerFormDeltaCell({ row, bestDeltaBoats }) {
  return (
    <td
      className={`rate${bestDeltaBoats.has(row.boat_number) && row.delta > 0 ? " ind-best" : ""}`}
    >
      {row.delta !== null ? (
        <span
          className={
            row.delta > 0 ? "delta-up" : row.delta < 0 ? "delta-down" : ""
          }
        >
          {row.delta > 0 ? "↑" : row.delta < 0 ? "↓" : "→"}{" "}
          {Math.abs(row.delta).toFixed(2)}
        </span>
      ) : (
        "-"
      )}
    </td>
  );
}

function RacerFormRow({ t, row, bestDeltaBoats, setDrillDownRacer }) {
  return (
    <tr
      className={`motor-ranking-row ${row.racer_id === null ? "non-clickable-row" : ""}`}
      onClick={() => row.racer_id !== null && setDrillDownRacer(row.racer_id)}
    >
      <td className="rank">{row.boat_number}</td>
      <td translate="no">{row.player_name?.replace(/\s+/g, "")}</td>
      <td className="rate">{row.win_rate?.toFixed(2)}</td>
      <td className="rate">
        {row.past_win_rate !== null
          ? row.past_win_rate.toFixed(2)
          : t("analysis.noData")}
      </td>
      {/* 最良は行全体ではなく、比べている値（Δ）のセルに金枠（race-detail-ui-unify R1） */}
      <RacerFormDeltaCell row={row} bestDeltaBoats={bestDeltaBoats} />
    </tr>
  );
}

function RacerFormTable({ t, breakdown, bestDeltaBoats, setDrillDownRacer }) {
  return (
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
            <RacerFormRow
              key={row.boat_number}
              t={t}
              row={row}
              bestDeltaBoats={bestDeltaBoats}
              setDrillDownRacer={setDrillDownRacer}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RacerFormTrend({
  t,
  breakdown,
  trendData,
  drillDownRacer,
  setDrillDownRacer,
}) {
  const chartData = toChartData(trendData);
  const drillDownRacerName = breakdown.find(
    (r) => r.racer_id === drillDownRacer,
  )?.player_name;
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
  );
}

function toChartData(trendData) {
  return (trendData?.trend ?? []).map((row) => ({
    date: row.date.slice(5),
    national_win_rate: row.win_rate,
    local_win_rate: row.local_win_rate,
  }));
}

function RacerFormTop({ t, embedded, loading, selectors }) {
  return (
    <>
      {!embedded && (
        <>
          <h2>{t("analysis.racerForm.title")}</h2>
          <p className="section-description">
            {t("analysis.racerForm.description")}
          </p>
        </>
      )}

      {!embedded &&
        (selectors.venues.length === 0 && !loading ? (
          <div className="empty-state">{t("analysis.noRacesToday")}</div>
        ) : (
          <RacerFormSelectors t={t} {...selectors} />
        ))}
    </>
  );
}

function RacerFormContent({
  t,
  loading,
  error,
  drillDownRacer,
  breakdown,
  bestDeltaBoats,
  setDrillDownRacer,
  trendData,
}) {
  return (
    <>
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
          <RacerFormTable
            t={t}
            breakdown={breakdown}
            bestDeltaBoats={bestDeltaBoats}
            setDrillDownRacer={setDrillDownRacer}
          />
        )}

      {!loading && !error && drillDownRacer !== null && (
        <RacerFormTrend
          t={t}
          breakdown={breakdown}
          trendData={trendData}
          drillDownRacer={drillDownRacer}
          setDrillDownRacer={setDrillDownRacer}
        />
      )}
    </>
  );
}

function RacerFormChart({
  initialVenueCode = null,
  initialRaceId = null,
  embedded = false,
}) {
  const { t } = useTranslation();
  const { loading, setLoading, error, setError, ...selectors } =
    useVenueRaceSelector({ initialVenueCode, initialRaceId, embedded, t });

  const [breakdown, setBreakdown] = useState([]);
  const [drillDownRacer, setDrillDownRacer] = useState(null);
  const [trendData, setTrendData] = useState(null);

  useEffect(() => {
    if (selectors.selectedRace === null) return;
    const loadBreakdown = async () => {
      try {
        setLoading(true);
        setError(null);
        setDrillDownRacer(null);
        const data = await getRaceRacerFormBreakdown(selectors.selectedRace);
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
  }, [selectors.selectedRace]);

  // 選手選択時: 節ごとの全国勝率推移を取得
  useEffect(() => {
    if (drillDownRacer === null) return;
    const loadTrend = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await getRacerFormTrend(drillDownRacer);
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

  // 調子（Δ）が最も上がった艇（同値は全部）。表示と同じ小数2桁で比べる（R1）。
  // 全員が下がっているときは強調しない（> 0 の条件は以前から）
  const bestDeltaBoats = bestOf(
    breakdown.map((r) => ({ boat: r.boat_number, value: r.delta })),
    "max",
    { digits: 2 },
  );

  return (
    <div className="motor-condition-container">
      <RacerFormTop
        t={t}
        embedded={embedded}
        loading={loading}
        selectors={selectors}
      />

      <RacerFormContent
        t={t}
        loading={loading}
        error={error}
        drillDownRacer={drillDownRacer}
        breakdown={breakdown}
        bestDeltaBoats={bestDeltaBoats}
        setDrillDownRacer={setDrillDownRacer}
        trendData={trendData}
      />

      <p className="table-note">{t("analysis.racerForm.note")}</p>
    </div>
  );
}

export default RacerFormChart;
