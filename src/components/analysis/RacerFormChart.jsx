/**
 * RacerFormChart - 選手勝率上昇/下降（BOA-152）
 * 本日開催中の会場・レースを選ぶと、そのレースに出走する6選手の
 * 現在の全国勝率と約90日前時点の全国勝率を比較し、調子の変化を示す。
 * 気になる選手は節ごとの推移グラフにドリルダウンできる。
 */
import { useState, useEffect, useRef } from "react";
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

function RacerFormChart({ initialVenueCode = null, initialRaceId = null }) {
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
        setError(err.message || "会場一覧の取得に失敗しました");
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
        setError(err.message || "レース一覧の取得に失敗しました");
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
        setError(err.message || "選手調子の取得に失敗しました");
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
        setError(err.message || "選手推移の取得に失敗しました");
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
    全国勝率: row.win_rate,
    当地勝率: row.local_win_rate,
  }));

  const drillDownRacerName = breakdown.find(
    (r) => r.racer_id === drillDownRacer,
  )?.player_name;

  return (
    <div className="motor-condition-container">
      <h2>📈 選手調子</h2>
      <p className="section-description">
        本日開催中のレースを選ぶと、各選手の現在の全国勝率と約90日前時点の全国勝率を比較し、調子が上昇/下降しているかがわかります。
      </p>

      {venues.length === 0 && !loading ? (
        <div className="empty-state">本日開催しているレースがありません</div>
      ) : (
        <div className="controls-section">
          <label htmlFor="racer-venue-select">
            ボートレース場（本日開催中）:
          </label>
          <select
            id="racer-venue-select"
            value={selectedVenue ?? ""}
            onChange={(e) => setSelectedVenue(parseInt(e.target.value, 10))}
            className="venue-select"
          >
            {venues.map((v) => (
              <option key={v} value={v}>
                {VENUE_NAMES[v] || v}
              </option>
            ))}
          </select>

          {races.length > 0 && (
            <>
              <label htmlFor="racer-race-select">レース:</label>
              <select
                id="racer-race-select"
                value={selectedRace ?? ""}
                onChange={(e) => setSelectedRace(e.target.value)}
                className="venue-select"
              >
                {races.map((r) => (
                  <option key={r.race_id} value={r.race_id}>
                    {r.race_number}R（{r.start_time?.slice(0, 5)}〜）
                  </option>
                ))}
              </select>
            </>
          )}
        </div>
      )}

      {loading && <div className="loading-state">データを読み込み中...</div>}
      {error && <div className="error-state">エラー: {error}</div>}

      {!loading &&
        !error &&
        drillDownRacer === null &&
        breakdown.length > 0 && (
          <div className="table-wrapper">
            <table className="motor-ranking-table">
              <thead>
                <tr>
                  <th>枠番</th>
                  <th>選手名</th>
                  <th>現在の全国勝率</th>
                  <th>約90日前</th>
                  <th>変化</th>
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
                    <td translate="no">{row.player_name?.replace(/\s+/g, "")}</td>
                    <td className="rate">{row.win_rate?.toFixed(2)}</td>
                    <td className="rate">
                      {row.past_win_rate !== null
                        ? row.past_win_rate.toFixed(2)
                        : "データなし"}
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
            ← レースの一覧に戻る
          </button>
          <h3 className="selected-motor-heading">
            {drillDownRacerName?.replace(/\s+/g, "")}選手の推移
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
                    value: "勝率",
                    angle: -90,
                    position: "insideLeft",
                  }}
                />
                <Tooltip formatter={(value) => value.toFixed(2)} />
                <Legend />
                <Line
                  type="stepAfter"
                  dataKey="全国勝率"
                  stroke="#0ea5e9"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
                <Line
                  type="stepAfter"
                  dataKey="当地勝率"
                  stroke="#10b981"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="empty-state">
              この選手の推移データが見つかりません
            </div>
          )}
        </>
      )}

      <p className="table-note">
        💡
        表の行をクリックするとその選手の節ごとの全国勝率・当地勝率の推移が見られます。「約90日前」は当該時期にデータが存在する場合のみ表示されます。データなしの選手は新人選手・移籍直後等が考えられます。
      </p>
    </div>
  );
}

export default RacerFormChart;
