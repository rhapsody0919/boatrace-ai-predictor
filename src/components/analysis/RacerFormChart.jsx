/**
 * RacerFormChart - 選手勝率上昇/下降（BOA-152）
 * 本日開催中の会場・レースを選ぶと、そのレースに出走する6選手の
 * 現在の全国勝率と約90日前時点の全国勝率を比較し、調子の変化を示す。
 * 気になる選手は節ごとの推移グラフにドリルダウンできる。
 */
import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
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

function RacerFormChart({
  initialVenueCode = null,
  initialRaceId = null,
  embedded = false,
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
          <Link to={`/racer/${drillDownRacer}`} className="racer-page-link">
            → 選手ページを見る
          </Link>

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
                    value: t("analysis.racerForm.yAxis"),
                    angle: -90,
                    position: "insideLeft",
                  }}
                />
                <Tooltip formatter={(value) => value.toFixed(2)} />
                <Legend />
                <Line
                  type="stepAfter"
                  dataKey="national_win_rate"
                  name={t("analysis.racerForm.legendNational")}
                  stroke="var(--brand-accent-primary)"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
                <Line
                  type="stepAfter"
                  dataKey="local_win_rate"
                  name={t("analysis.racerForm.legendLocal")}
                  stroke="var(--brand-accent-secondary)"
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

      <p className="table-note">{t("analysis.racerForm.note")}</p>
    </div>
  );
}

export default RacerFormChart;
