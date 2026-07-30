/**
 * MotorConditionChart - モーター調子トレンド（BOA-151）
 * デフォルトで会場全モーターの最新2連率ランキングを表示し、
 * 気になるモーターをクリックすると節ごとの推移グラフにドリルダウンする
 */
import { useState, useEffect } from "react";
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

const VENUES = [
  { code: "01", name: "桐生" },
  { code: "02", name: "戸田" },
  { code: "03", name: "江戸川" },
  { code: "04", name: "平和島" },
  { code: "05", name: "多摩川" },
  { code: "06", name: "浜名湖" },
  { code: "07", name: "蒲郡" },
  { code: "08", name: "常滑" },
  { code: "09", name: "津" },
  { code: "10", name: "三国" },
  { code: "11", name: "びわこ" },
  { code: "12", name: "住之江" },
  { code: "13", name: "尼崎" },
  { code: "14", name: "鳴門" },
  { code: "15", name: "丸亀" },
  { code: "16", name: "児島" },
  { code: "17", name: "宮島" },
  { code: "18", name: "徳山" },
  { code: "19", name: "下関" },
  { code: "20", name: "若松" },
  { code: "21", name: "芦屋" },
  { code: "22", name: "福岡" },
  { code: "23", name: "唐津" },
  { code: "24", name: "大村" },
];

function MotorConditionChart() {
  const [selectedVenue, setSelectedVenue] = useState("03");
  const [ranking, setRanking] = useState([]);
  const [selectedMotor, setSelectedMotor] = useState(null);
  const [trendData, setTrendData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // 会場変更時: ランキングを取得し、詳細表示は閉じる
  useEffect(() => {
    const loadRanking = async () => {
      try {
        setLoading(true);
        setError(null);
        setSelectedMotor(null);
        const venueCode = parseInt(selectedVenue, 10);
        const result =
          await supabaseDataService.getMotorRankingForVenue(venueCode);
        setRanking(result.ranking);
      } catch (err) {
        setError(err.message || "モーターランキングの取得に失敗しました");
        console.error("Failed to load motor ranking:", err);
      } finally {
        setLoading(false);
      }
    };

    loadRanking();
  }, [selectedVenue]);

  // モーター選択時: 推移データを取得
  useEffect(() => {
    if (selectedMotor === null) return;

    const loadTrend = async () => {
      try {
        setLoading(true);
        setError(null);
        const venueCode = parseInt(selectedVenue, 10);
        const data = await supabaseDataService.getMotorConditionTrend(
          venueCode,
          selectedMotor,
        );
        setTrendData(data);
      } catch (err) {
        setError(err.message || "モーター調子データの取得に失敗しました");
        console.error("Failed to load motor condition trend:", err);
      } finally {
        setLoading(false);
      }
    };

    loadTrend();
  }, [selectedVenue, selectedMotor]);

  const chartData = (trendData?.trend ?? []).map((row) => ({
    date: row.date.slice(5),
    "2連率": row.motor_2rate,
    "3連率": row.motor_3rate,
  }));

  return (
    <div className="motor-condition-container">
      <h2>🔧 モーター調子トレンド</h2>
      <p className="section-description">
        {selectedMotor === null
          ? "過去90日間のデータから、現在の2連率が高い順にモーターを一覧表示しています。気になるモーターをクリックすると、節（開催）をまたいだ推移が見られます。"
          : "過去90日間のデータから、同一モーターの2連率/3連率が節（開催）をまたいでどう推移しているかを表示しています。"}
      </p>

      <div className="controls-section">
        <label htmlFor="motor-venue-select">ボートレース場:</label>
        <select
          id="motor-venue-select"
          value={selectedVenue}
          onChange={(e) => setSelectedVenue(e.target.value)}
          className="venue-select"
        >
          {VENUES.map((venue) => (
            <option key={venue.code} value={venue.code}>
              {venue.name}
            </option>
          ))}
        </select>
      </div>

      {loading && <div className="loading-state">データを読み込み中...</div>}
      {error && <div className="error-state">エラー: {error}</div>}

      {!loading && !error && selectedMotor === null && (
        <>
          {ranking.length === 0 ? (
            <div className="empty-state">
              この会場のモーターデータが見つかりません
            </div>
          ) : (
            <div className="table-wrapper">
              <table className="motor-ranking-table">
                <thead>
                  <tr>
                    <th>順位</th>
                    <th>モーター番号</th>
                    <th>2連率 (%)</th>
                    <th>3連率 (%)</th>
                  </tr>
                </thead>
                <tbody>
                  {ranking.map((row, idx) => (
                    <tr
                      key={row.motor_number}
                      className="motor-ranking-row"
                      onClick={() => setSelectedMotor(row.motor_number)}
                    >
                      <td className="rank">{idx + 1}</td>
                      <td className="motor-num">{row.motor_number}号機</td>
                      <td className="rate">{row.motor_2rate?.toFixed(2)}</td>
                      <td className="rate">{row.motor_3rate?.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {!loading && !error && selectedMotor !== null && (
        <>
          <button
            className="back-to-ranking-btn"
            onClick={() => setSelectedMotor(null)}
          >
            ← ランキングに戻る
          </button>
          <h3 className="selected-motor-heading">{selectedMotor}号機の推移</h3>

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
                    value: "出現率 (%)",
                    angle: -90,
                    position: "insideLeft",
                  }}
                />
                <Tooltip formatter={(value) => `${value.toFixed(1)}%`} />
                <Legend />
                <Line
                  type="stepAfter"
                  dataKey="2連率"
                  stroke="#0ea5e9"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
                <Line
                  type="stepAfter"
                  dataKey="3連率"
                  stroke="#10b981"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="empty-state">
              このモーターのデータが見つかりません
            </div>
          )}
        </>
      )}

      <p className="table-note">
        💡
        モーターの成績は節（開催）単位でのみ更新されるため、階段状のグラフになります。
      </p>
    </div>
  );
}

export default MotorConditionChart;
