/**
 * WinningTechniqueChart - 決まり手データ分析チャート（BOA-150）
 * 会場別・枠番別の決まり手（逃げ/差し/まくり等）出現割合を可視化する
 */
import { useState, useEffect } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { supabaseDataService } from "../../services/supabaseDataService";
import "./WinningTechniqueChart.css";

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

const TECHNIQUE_COLORS = {
  逃げ: "#0ea5e9",
  差し: "#10b981",
  まくり: "#f59e0b",
  まくり差し: "#ef4444",
  抜き: "#8b5cf6",
  恵まれ: "#94a3b8",
};

function techniqueColor(technique, index) {
  const palette = [
    "#0ea5e9",
    "#10b981",
    "#f59e0b",
    "#ef4444",
    "#8b5cf6",
    "#94a3b8",
    "#ec4899",
  ];
  return TECHNIQUE_COLORS[technique] ?? palette[index % palette.length];
}

function WinningTechniqueChart() {
  const [selectedVenue, setSelectedVenue] = useState("03");
  const [statsData, setStatsData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        setError(null);
        const venueCode = parseInt(selectedVenue, 10);
        const data =
          await supabaseDataService.getWinningTechniqueStats(venueCode);
        setStatsData(data);
      } catch (err) {
        setError(err.message || "決まり手データの取得に失敗しました");
        console.error("Failed to load winning technique stats:", err);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [selectedVenue]);

  if (loading) {
    return (
      <div className="winning-technique-container">
        <div className="loading-state">データを読み込み中...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="winning-technique-container">
        <div className="error-state">エラー: {error}</div>
      </div>
    );
  }

  if (
    !statsData ||
    !statsData.data ||
    Object.keys(statsData.data).length === 0
  ) {
    return (
      <div className="winning-technique-container">
        <div className="empty-state">決まり手データが見つかりません</div>
      </div>
    );
  }

  const { venue_name, last_updated, data } = statsData;

  // 全枠番に登場する決まり手の種類を集める（凡例・積み上げバーの構成要素として使う）
  const allTechniques = [
    ...new Set(
      Object.values(data).flatMap((boat) =>
        boat.techniques.map((t) => t.technique),
      ),
    ),
  ];

  // recharts用データ: 枠番ごとに { boat_number, 逃げ: 62.3, 差し: 20.1, ... }
  const chartData = [1, 2, 3, 4, 5, 6]
    .filter((boatNumber) => data[boatNumber])
    .map((boatNumber) => {
      const row = { boat_number: `${boatNumber}号艇` };
      allTechniques.forEach((technique) => {
        const match = data[boatNumber].techniques.find(
          (t) => t.technique === technique,
        );
        row[technique] = match ? match.percentage : 0;
      });
      return row;
    });

  return (
    <div className="winning-technique-container">
      <h2>🎯 決まり手データ分析</h2>
      <p className="section-description">
        過去90日間のレース結果から、各ボートレース場で「1着艇がどの決まり手（逃げ・差し・まくり等）で勝っているか」を枠番別に分析しています。
      </p>

      <div className="controls-section">
        <label htmlFor="venue-select">ボートレース場:</label>
        <select
          id="venue-select"
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

      {venue_name && (
        <div className="summary-info">
          <p>
            <strong>{venue_name}</strong> - 過去90日間の決まり手構成比
            {last_updated && (
              <span className="update-date">（最終更新: {last_updated}）</span>
            )}
          </p>
        </div>
      )}

      <ResponsiveContainer width="100%" height={360}>
        <BarChart
          data={chartData}
          margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="boat_number" />
          <YAxis
            label={{
              value: "出現割合 (%)",
              angle: -90,
              position: "insideLeft",
            }}
            domain={[0, 100]}
            ticks={[0, 20, 40, 60, 80, 100]}
          />
          <Tooltip formatter={(value) => `${value.toFixed(1)}%`} />
          <Legend />
          {allTechniques.map((technique, idx) => (
            <Bar
              key={technique}
              dataKey={technique}
              stackId="technique"
              fill={techniqueColor(technique, idx)}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>

      <div className="table-wrapper">
        <table className="winning-technique-table">
          <thead>
            <tr>
              <th>枠番</th>
              <th>決まり手</th>
              <th>出現回数</th>
              <th>出現割合 (%)</th>
            </tr>
          </thead>
          <tbody>
            {[1, 2, 3, 4, 5, 6]
              .filter((boatNumber) => data[boatNumber])
              .flatMap((boatNumber) =>
                data[boatNumber].techniques.map((t, idx) => (
                  <tr key={`${boatNumber}-${t.technique}`}>
                    {idx === 0 && (
                      <td
                        rowSpan={data[boatNumber].techniques.length}
                        className="boat-num"
                      >
                        {boatNumber}号艇
                      </td>
                    )}
                    <td>{t.technique}</td>
                    <td className="count">{t.count}</td>
                    <td className="percentage">{t.percentage.toFixed(2)}%</td>
                  </tr>
                )),
              )}
          </tbody>
        </table>
      </div>

      <p className="table-note">
        💡 出現割合はその枠番の1着レース内での構成比です。
      </p>
    </div>
  );
}

export default WinningTechniqueChart;
