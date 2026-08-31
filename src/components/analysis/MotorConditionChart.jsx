/**
 * MotorConditionChart - モーター調子（BOA-151）
 * 本日開催中の会場・レースを選ぶと、そのレースの枠番別モーター調子
 * （2連率/3連率）を一覧表示する。「このレースのどの艇のモーターが
 * 調子いいか」を直接示すことで、賭ける判断にそのまま使えるようにする。
 * 気になるモーターは節ごとの推移グラフにドリルダウンできる。
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

function MotorConditionChart({
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
  const [drillDownMotor, setDrillDownMotor] = useState(null);
  const [trendData, setTrendData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // RaceDetail等からのディープリンク用: 初回のみ指定のレースを優先する
  const pendingInitialRaceId = useRef(initialRaceId);

  // 本日開催中の会場一覧を取得
  // embedded時（レース詳細への埋め込み）は過去日・確定済みレースも対象になり得るため、
  // 「本日開催」一覧に無い場合のフォールバック選択を行わず、渡されたinitialVenueCode/
  // initialRaceIdをそのまま使う（selectedVenue/selectedRaceは既にその初期値のまま）
  useEffect(() => {
    if (embedded) return;
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

  // 会場変更時: 本日のレース一覧を取得（embedded時はスキップ、理由は上記コメント参照）
  useEffect(() => {
    if (embedded) return;
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
  }, [selectedVenue, embedded]);

  // レース選択時: 枠番別モーター調子を取得
  useEffect(() => {
    if (selectedRace === null) return;
    const loadBreakdown = async () => {
      try {
        setLoading(true);
        setError(null);
        setDrillDownMotor(null);
        const data =
          await supabaseDataService.getRaceMotorBreakdown(selectedRace);
        setBreakdown(data);
      } catch (err) {
        setError(err.message || t("analysis.dataLoadError"));
        console.error("Failed to load race motor breakdown:", err);
      } finally {
        setLoading(false);
      }
    };
    loadBreakdown();
  }, [selectedRace]);

  // モーター選択時: 節ごとの推移を取得
  useEffect(() => {
    if (drillDownMotor === null || selectedVenue === null) return;
    const loadTrend = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await supabaseDataService.getMotorConditionTrend(
          selectedVenue,
          drillDownMotor,
        );
        setTrendData(data);
      } catch (err) {
        setError(err.message || t("analysis.dataLoadError"));
        console.error("Failed to load motor condition trend:", err);
      } finally {
        setLoading(false);
      }
    };
    loadTrend();
  }, [selectedVenue, drillDownMotor]);

  const chartData = (trendData?.trend ?? []).map((row) => ({
    date: row.date.slice(5),
    motor_2rate: row.motor_2rate,
    motor_3rate: row.motor_3rate,
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

      {!loading && !error && drillDownMotor !== null && (
        <>
          <button
            className="back-to-ranking-btn"
            onClick={() => setDrillDownMotor(null)}
          >
            {t("analysis.backToList")}
          </button>
          <h3 className="selected-motor-heading">
            {t("analysis.motor.trendHeading", { n: drillDownMotor })}
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
                    value: t("analysis.motor.yAxis"),
                    angle: -90,
                    position: "insideLeft",
                  }}
                />
                <Tooltip formatter={(value) => `${value.toFixed(1)}%`} />
                <Legend />
                <Line
                  type="stepAfter"
                  dataKey="motor_2rate"
                  name={t("analysis.motor.legend2")}
                  stroke="var(--brand-accent-primary)"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
                <Line
                  type="stepAfter"
                  dataKey="motor_3rate"
                  name={t("analysis.motor.legend3")}
                  stroke="var(--brand-accent-secondary)"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="empty-state">{t("analysis.motor.trendEmpty")}</div>
          )}
        </>
      )}

      <p className="table-note">{t("analysis.motor.note")}</p>
    </div>
  );
}

export default MotorConditionChart;
