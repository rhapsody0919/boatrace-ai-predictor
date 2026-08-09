/**
 * ExhibitionTimeTrendChart - 選手別展示タイム推移（BOA-164）
 * 本日開催中の会場・レースを選ぶと、そのレースに出走する6選手について
 * 展示タイム（周回タイム）が過去90日間でどう推移しているかを表示する。
 * 「展示タイム最速艇の1着転換率」（会場・枠番単位）とは異なり、選手個人単位の推移を見る機能。
 */
import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { supabaseDataService } from "../../services/supabaseDataService";
import "./MotorConditionChart.css";

const VENUE_NAMES = {
  1: "桐生",
  2: "戸田",
  3: "江戸川",
  4: "平和島",
  5: "多摩川",
  6: "浜名湖",
  7: "蒲郡",
  8: "常滑",
  9: "津",
  10: "三国",
  11: "びわこ",
  12: "住之江",
  13: "尼崎",
  14: "鳴門",
  15: "丸亀",
  16: "児島",
  17: "宮島",
  18: "徳山",
  19: "下関",
  20: "若松",
  21: "芦屋",
  22: "福岡",
  23: "唐津",
  24: "大村",
};

function ExhibitionTimeTrendChart({
  initialVenueCode = null,
  initialRaceId = null,
}) {
  const { t } = useTranslation();
  const [venues, setVenues] = useState([]);
  const [selectedVenue, setSelectedVenue] = useState(initialVenueCode);
  const [races, setRaces] = useState([]);
  const [selectedRace, setSelectedRace] = useState(initialRaceId);
  const [breakdown, setBreakdown] = useState([]);
  const [drillDownRacer, setDrillDownRacer] = useState(null);
  const [trendData, setTrendData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const pendingInitialRaceId = useRef(initialRaceId);

  useEffect(() => {
    const loadVenues = async () => {
      try {
        setLoading(true);
        setError(null);
        const list = await supabaseDataService.getVenuesWithTodaysRaces();
        setVenues(list);
        const preferred =
          initialVenueCode !== null && list.includes(initialVenueCode)
            ? initialVenueCode
            : (list[0] ?? null);
        setSelectedVenue(preferred);
      } catch (err) {
        setError(err.message || t("analysis.dataLoadError"));
        console.error("Failed to load venues with today's races:", err);
      } finally {
        setLoading(false);
      }
    };
    loadVenues();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selectedVenue === null) {
      setRaces([]);
      return;
    }
    const loadRaces = async () => {
      try {
        setLoading(true);
        setError(null);
        const list =
          await supabaseDataService.getTodaysRacesForVenue(selectedVenue);
        setRaces(list);

        const pending = pendingInitialRaceId.current;
        const pendingExists =
          pending !== null && list.some((r) => r.race_id === pending);
        setSelectedRace(pendingExists ? pending : (list[0]?.race_id ?? null));
        pendingInitialRaceId.current = null;
      } catch (err) {
        setError(err.message || t("analysis.dataLoadError"));
        console.error("Failed to load today's races:", err);
      } finally {
        setLoading(false);
      }
    };
    loadRaces();
  }, [selectedVenue]);

  useEffect(() => {
    if (selectedRace === null) return;
    const loadBreakdown = async () => {
      try {
        setLoading(true);
        setError(null);
        setDrillDownRacer(null);
        const data =
          await supabaseDataService.getRaceExhibitionTimeBreakdown(
            selectedRace,
          );
        setBreakdown(data);
      } catch (err) {
        setError(err.message || t("analysis.dataLoadError"));
        console.error("Failed to load race exhibition time breakdown:", err);
      } finally {
        setLoading(false);
      }
    };
    loadBreakdown();
  }, [selectedRace]);

  useEffect(() => {
    if (drillDownRacer === null) return;
    const loadTrend = async () => {
      try {
        setLoading(true);
        setError(null);
        const data =
          await supabaseDataService.getExhibitionTimeTrend(drillDownRacer);
        setTrendData(data);
      } catch (err) {
        setError(err.message || t("analysis.dataLoadError"));
        console.error("Failed to load exhibition time trend:", err);
      } finally {
        setLoading(false);
      }
    };
    loadTrend();
  }, [drillDownRacer]);

  const bestAvgTime =
    breakdown.filter((r) => r.avg_exhibition_time !== null).length > 0
      ? Math.min(
          ...breakdown
            .filter((r) => r.avg_exhibition_time !== null)
            .map((r) => r.avg_exhibition_time),
        )
      : null;

  const chartData = (trendData?.trend ?? []).map((row) => ({
    date: row.date.slice(5),
    exhibition_time: row.avg_exhibition_time,
  }));

  const drillDownRacerName = breakdown.find(
    (r) => r.racer_id === drillDownRacer,
  )?.player_name;

  return (
    <div className="motor-condition-container">
      <h2>{t("analysis.exTrend.title")}</h2>
      <p className="section-description">{t("analysis.exTrend.description")}</p>

      {venues.length === 0 && !loading ? (
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
                  <tr
                    key={row.boat_number}
                    className={`motor-ranking-row ${row.racer_id === null ? "non-clickable-row" : ""} ${row.avg_exhibition_time === bestAvgTime && bestAvgTime !== null ? "best-motor" : ""}`}
                    onClick={() =>
                      row.racer_id !== null && setDrillDownRacer(row.racer_id)
                    }
                  >
                    <td className="rank">{row.boat_number}</td>
                    <td translate="no">
                      {row.player_name?.replace(/\s+/g, "")}
                    </td>
                    <td className="rate">
                      {row.exhibition_time !== null
                        ? row.exhibition_time.toFixed(2)
                        : t("analysis.notMeasured")}
                    </td>
                    <td className="rate">
                      {row.avg_exhibition_time !== null
                        ? row.avg_exhibition_time.toFixed(2)
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
          <button
            className="back-to-ranking-btn"
            onClick={() => setDrillDownRacer(null)}
          >
            {t("analysis.backToList")}
          </button>
          <h3 className="selected-motor-heading" translate="no">
            {t("analysis.racerTrendHeading", {
              name: drillDownRacerName?.replace(/\s+/g, ""),
            })}
          </h3>

          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart
                data={chartData}
                margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis
                  label={{
                    value: t("analysis.exTrend.yAxis"),
                    angle: -90,
                    position: "insideLeft",
                  }}
                  domain={["dataMin - 0.1", "dataMax + 0.1"]}
                />
                <Tooltip formatter={(value) => value.toFixed(2)} />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="exhibition_time"
                  name={t("analysis.exTrend.legend")}
                  stroke="#0ea5e9"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="empty-state">{t("analysis.racerTrendEmpty")}</div>
          )}
        </>
      )}

      <p className="table-note">{t("analysis.exTrend.note")}</p>
    </div>
  );
}

export default ExhibitionTimeTrendChart;
