/**
 * MotorConditionChart - モーター調子トレンド（BOA-151）
 * 会場×モーター番号別の2連率/3連率の節ごとの推移を可視化する
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
  const [motorNumbers, setMotorNumbers] = useState([]);
  const [selectedMotor, setSelectedMotor] = useState(null);
  const [trendData, setTrendData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // 会場変更時: その会場のモーター番号一覧を取得
  useEffect(() => {
    const loadMotorNumbers = async () => {
      try {
        setLoading(true);
        setError(null);
        const venueCode = parseInt(selectedVenue, 10);
        const numbers =
          await supabaseDataService.getMotorNumbersForVenue(venueCode);
        setMotorNumbers(numbers);
        setSelectedMotor(numbers.length > 0 ? numbers[0] : null);
      } catch (err) {
        setError(err.message || "モーター番号一覧の取得に失敗しました");
        console.error("Failed to load motor numbers:", err);
        setLoading(false);
      }
    };

    loadMotorNumbers();
  }, [selectedVenue]);

  // モーター番号選択時: 推移データを取得
  useEffect(() => {
    if (selectedMotor === null) {
      setLoading(false);
      return;
    }

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

  if (loading) {
    return (
      <div className="motor-condition-container">
        <div className="loading-state">データを読み込み中...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="motor-condition-container">
        <div className="error-state">エラー: {error}</div>
      </div>
    );
  }

  if (motorNumbers.length === 0) {
    return (
      <div className="motor-condition-container">
        <div className="empty-state">
          この会場のモーターデータが見つかりません
        </div>
      </div>
    );
  }

  const chartData = (trendData?.trend ?? []).map((row) => ({
    date: row.date.slice(5), // MM-DDのみ表示
    "2連率": row.motor_2rate,
    "3連率": row.motor_3rate,
  }));

  return (
    <div className="motor-condition-container">
      <h2>🔧 モーター調子トレンド</h2>
      <p className="section-description">
        過去90日間のデータから、同一モーターの2連率/3連率が節（開催）をまたいでどう推移しているかを表示しています。
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

        <label htmlFor="motor-select">モーター番号:</label>
        <select
          id="motor-select"
          value={selectedMotor ?? ""}
          onChange={(e) => setSelectedMotor(parseInt(e.target.value, 10))}
          className="venue-select"
        >
          {motorNumbers.map((num) => (
            <option key={num} value={num}>
              {num}号機
            </option>
          ))}
        </select>
      </div>

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
        <div className="empty-state">このモーターのデータが見つかりません</div>
      )}

      <p className="table-note">
        💡
        モーターの成績は節（開催）単位でのみ更新されるため、階段状のグラフになります。
      </p>
    </div>
  );
}

export default MotorConditionChart;
