/**
 * MotorConditionChart - モーター調子（BOA-151）
 * 本日開催中の会場・レースを選ぶと、そのレースの枠番別モーター調子
 * （2連率/3連率）を一覧表示する。「このレースのどの艇のモーターが
 * 調子いいか」を直接示すことで、賭ける判断にそのまま使えるようにする。
 * 気になるモーターは節ごとの推移グラフにドリルダウンできる。
 */
import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { supabaseDataService } from "../../services/supabaseDataService";
import { STADIUM_NAMES as VENUE_NAMES } from "../../constants";
import { useVenueRaceSelector } from "../../hooks/useVenueRaceSelector";
import TrendLineChart from "./TrendLineChart";
import DrillDownHeader from "./DrillDownHeader";
import "./MotorConditionChart.css";

function MotorConditionChart({
  initialVenueCode = null,
  initialRaceId = null,
  initialMotorNumber = null,
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
  const [drillDownMotor, setDrillDownMotor] = useState(null);
  const [trendData, setTrendData] = useState(null);

  const [powerIndex, setPowerIndex] = useState(null);
  const pendingInitialMotorNumber = useRef(initialMotorNumber);

  // レース選択時: 枠番別モーター調子を取得（機力指数はvenue確定後に別途取得）
  useEffect(() => {
    if (selectedRace === null) return;
    // StrictMode（開発時）の2回実行対策: 使い捨ての1回目でpendingを消費しきって
    // しまわないよう、cleanup側で未適用（cancelled）なら元に戻す
    const pendingSnapshot = pendingInitialMotorNumber.current;
    let cancelled = false;
    let applied = false;
    const loadBreakdown = async () => {
      try {
        setLoading(true);
        setError(null);
        setDrillDownMotor(null);
        const data = await supabaseDataService.getRaceMotorBreakdown(
          selectedRace,
          selectedVenue,
        );
        if (cancelled) return;
        setBreakdown(data);
        // 機力バッジ等からのディープリンク（?motor=）で指定されたモーターが
        // 今回のレースに実在すれば、そのままドリルダウン画面を開く
        const pendingExists =
          pendingSnapshot !== null &&
          data.some((r) => r.motor_number === pendingSnapshot);
        if (pendingExists) {
          setDrillDownMotor(pendingSnapshot);
          pendingInitialMotorNumber.current = null;
        }
        applied = true;
      } catch (err) {
        if (cancelled) return;
        setError(err.message || t("analysis.dataLoadError"));
        console.error("Failed to load race motor breakdown:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    loadBreakdown();
    return () => {
      cancelled = true;
      if (!applied) pendingInitialMotorNumber.current = pendingSnapshot;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRace, selectedVenue]);

  // モーター選択時: 節ごとの推移と機力指数を取得
  useEffect(() => {
    if (drillDownMotor === null || selectedVenue === null) return;
    const loadTrend = async () => {
      try {
        setLoading(true);
        setError(null);
        const [trend, power] = await Promise.all([
          supabaseDataService.getMotorConditionTrend(
            selectedVenue,
            drillDownMotor,
          ),
          supabaseDataService.getMotorPowerIndex(selectedVenue, drillDownMotor),
        ]);
        setTrendData(trend);
        setPowerIndex(power);
      } catch (err) {
        setError(err.message || t("analysis.dataLoadError"));
        console.error("Failed to load motor condition trend:", err);
      } finally {
        setLoading(false);
      }
    };
    loadTrend();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVenue, drillDownMotor]);

  const chartData = (trendData?.trend ?? []).map((row) => ({
    date: row.date.slice(5),
    motor_2rate: row.motor_2rate,
    motor_3rate: row.motor_3rate,
  }));

  const exhibitionChartData = (trendData?.trend ?? [])
    .filter((row) => row.exhibition_time !== null)
    .map((row) => ({
      date: row.date.slice(5),
      exhibition_time: row.exhibition_time,
    }));

  const bestMotor2Rate =
    breakdown.length > 0
      ? Math.max(...breakdown.map((r) => r.motor_2rate ?? 0))
      : null;

  return (
    <div className="motor-condition-container">
      {!embedded && (
        <>
          <h2>{t("analysis.motor.title")}</h2>
          <p className="section-description">
            {t("analysis.motor.description")}
          </p>
        </>
      )}

      {!embedded &&
        (venues.length === 0 && !loading ? (
          <div className="empty-state">{t("analysis.noRacesToday")}</div>
        ) : (
          <div className="controls-section">
            <label htmlFor="motor-venue-select">
              {t("analysis.venueSelectTodayLabel")}
            </label>
            <select
              id="motor-venue-select"
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
                <label htmlFor="motor-race-select">
                  {t("analysis.raceSelectLabel")}
                </label>
                <select
                  id="motor-race-select"
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
        drillDownMotor === null &&
        breakdown.length > 0 && (
          <div className="table-wrapper">
            <table className="motor-ranking-table">
              <thead>
                <tr>
                  <th>{t("analysis.laneHeader")}</th>
                  <th>{t("table.playerName")}</th>
                  <th>{t("analysis.motor.motorNumberHeader")}</th>
                  <th>{t("analysis.motor.rate2Header")}</th>
                  <th>{t("analysis.motor.rate3Header")}</th>
                  <th>{t("analysis.motor.powerIndexHeader")}</th>
                </tr>
              </thead>
              <tbody>
                {breakdown.map((row) => (
                  <tr
                    key={row.boat_number}
                    className={`motor-ranking-row ${row.motor_2rate === bestMotor2Rate ? "best-motor" : ""}`}
                    onClick={() => setDrillDownMotor(row.motor_number)}
                  >
                    <td className="rank">{row.boat_number}</td>
                    <td translate="no">
                      {row.player_name?.replace(/\s+/g, "")}
                    </td>
                    <td className="motor-num">
                      {t("analysis.motor.motorUnit", { n: row.motor_number })}
                    </td>
                    <td className="rate">{row.motor_2rate?.toFixed(2)}</td>
                    <td className="rate">{row.motor_3rate?.toFixed(2)}</td>
                    <td
                      className={`rate power-index ${
                        row.power_index > 0
                          ? "power-index-good"
                          : row.power_index < 0
                            ? "power-index-bad"
                            : ""
                      }`}
                    >
                      {row.power_index !== null && row.power_index !== undefined
                        ? `${row.power_index > 0 ? "+" : ""}${row.power_index.toFixed(1)}`
                        : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

      {!loading && !error && drillDownMotor !== null && (
        <>
          <DrillDownHeader
            onBack={() => setDrillDownMotor(null)}
            backLabel={t("analysis.backToList")}
            heading={t("analysis.motor.trendHeading", { n: drillDownMotor })}
          />

          {powerIndex?.power_index !== null &&
            powerIndex?.power_index !== undefined && (
              <p
                className={`power-index-summary ${
                  powerIndex.power_index > 0
                    ? "power-index-good"
                    : powerIndex.power_index < 0
                      ? "power-index-bad"
                      : ""
                }`}
              >
                {t("analysis.motor.powerIndexSummary", {
                  index: `${powerIndex.power_index > 0 ? "+" : ""}${powerIndex.power_index.toFixed(1)}`,
                  count: powerIndex.sample_count,
                })}
                {" — "}
                {powerIndex.power_index > 0
                  ? t("analysis.motor.powerIndexGood")
                  : powerIndex.power_index < 0
                    ? t("analysis.motor.powerIndexBad")
                    : ""}
              </p>
            )}

          {chartData.length > 0 ? (
            <TrendLineChart
              data={chartData}
              yAxisLabel={t("analysis.motor.yAxis")}
              tooltipFormatter={(value) => `${value.toFixed(1)}%`}
              series={[
                {
                  dataKey: "motor_2rate",
                  name: t("analysis.motor.legend2"),
                  stroke: "var(--brand-accent-primary)",
                  type: "stepAfter",
                },
                {
                  dataKey: "motor_3rate",
                  name: t("analysis.motor.legend3"),
                  stroke: "var(--brand-accent-secondary)",
                  type: "stepAfter",
                },
              ]}
            />
          ) : (
            <div className="empty-state">{t("analysis.motor.trendEmpty")}</div>
          )}

          <h3 className="selected-motor-heading">
            {t("analysis.motor.exhibitionTrendHeading")}
          </h3>
          {exhibitionChartData.length > 0 ? (
            <TrendLineChart
              data={exhibitionChartData}
              yAxisLabel={t("analysis.motor.exhibitionYAxis")}
              tooltipFormatter={(value) => value.toFixed(2)}
              series={[
                {
                  dataKey: "exhibition_time",
                  name: t("analysis.motor.exhibitionLegend"),
                  stroke: "var(--brand-accent-primary)",
                  type: "monotone",
                },
              ]}
            />
          ) : (
            <div className="empty-state">
              {t("analysis.motor.exhibitionTrendEmpty")}
            </div>
          )}
          <p className="table-note">
            {t("analysis.motor.exhibitionTrendNote")}
          </p>
        </>
      )}

      <p className="table-note">{t("analysis.motor.note")}</p>
      <p className="table-note">{t("analysis.motor.powerIndexNote")}</p>
    </div>
  );
}

export default MotorConditionChart;
