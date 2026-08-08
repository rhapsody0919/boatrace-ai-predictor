/**
 * RacerTechniqueProfileChart - 選手別決まり手傾向（BOA-165）
 * 本日開催中の会場・レースを選ぶと、そのレースに出走する6選手について
 * 過去90日間で勝った時にどの決まり手で勝っているか（勝ちパターン）を表示する。
 * 会場・枠番単位の「決まり手データ分析」（BOA-150）とは異なり、選手個人単位の傾向を見る機能。
 */
import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
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

function RacerTechniqueProfileChart({
  initialVenueCode = null,
  initialRaceId = null,
}) {
  const { t } = useTranslation();
  const [venues, setVenues] = useState([]);
  const [selectedVenue, setSelectedVenue] = useState(initialVenueCode);
  const [races, setRaces] = useState([]);
  const [selectedRace, setSelectedRace] = useState(initialRaceId);
  const [breakdown, setBreakdown] = useState([]);
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
        const data =
          await supabaseDataService.getRaceTechniqueProfileBreakdown(
            selectedRace,
          );
        setBreakdown(data);
      } catch (err) {
        setError(err.message || "決まり手傾向の取得に失敗しました");
        console.error("Failed to load race technique profile breakdown:", err);
      } finally {
        setLoading(false);
      }
    };
    loadBreakdown();
  }, [selectedRace]);

  const allTechniques = [
    ...new Set(
      breakdown.flatMap((row) => row.techniques.map((t) => t.technique)),
    ),
  ];

  const chartData = breakdown.map((row) => {
    const item = {
      boat_number: `${row.boat_number} ${row.player_name?.replace(/\s+/g, "") ?? ""}`,
    };
    allTechniques.forEach((technique) => {
      const match = row.techniques.find((t) => t.technique === technique);
      item[technique] = match ? match.percentage : 0;
    });
    return item;
  });

  return (
    <div className="motor-condition-container">
      <h2>🏆 選手別決まり手傾向</h2>
      <p className="section-description">
        本日開催中のレースを選ぶと、出走する6選手それぞれについて、過去90日間で勝った時にどの決まり手（逃げ・差し・まくり等）で勝っているかがわかります。会場・枠番単位の「決まり手」タブとは異なり、選手個人の勝ちパターンを見る機能です。
      </p>

      {venues.length === 0 && !loading ? (
        <div className="empty-state">{t("analysis.noRacesToday")}</div>
      ) : (
        <div className="controls-section">
          <label htmlFor="technique-profile-venue-select">
            {t("analysis.venueSelectTodayLabel")}
          </label>
          <select
            id="technique-profile-venue-select"
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
              <label htmlFor="technique-profile-race-select">{t("analysis.raceSelectLabel")}</label>
              <select
                id="technique-profile-race-select"
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

      {loading && <div className="loading-state">{t("analysis.loading")}</div>}
      {error && <div className="error-state">{t("analysis.error", { message: error })}</div>}

      {!loading && !error && breakdown.length > 0 && (
        <>
          <ResponsiveContainer width="100%" height={360}>
            <BarChart
              data={chartData}
              margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="boat_number" />
              <YAxis
                label={{
                  value: "勝利時の構成比 (%)",
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
            <table className="motor-ranking-table">
              <thead>
                <tr>
                  <th>枠番</th>
                  <th>選手名</th>
                  <th>勝利数（90日）</th>
                  <th>決まり手構成</th>
                </tr>
              </thead>
              <tbody>
                {breakdown.map((row) => (
                  <tr
                    key={row.boat_number}
                    className="motor-ranking-row non-clickable-row"
                  >
                    <td className="rank">{row.boat_number}</td>
                    <td translate="no">{row.player_name?.replace(/\s+/g, "")}</td>
                    <td className="rate">{row.win_count}</td>
                    <td className="rate">
                      {row.techniques.length > 0
                        ? row.techniques
                            .map(
                              (t) =>
                                `${t.technique} ${t.percentage.toFixed(0)}%`,
                            )
                            .join(" / ")
                        : "データなし"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <p className="table-note">
        💡
        決まり手の構成比は、その選手が過去90日間で勝ったレースの中での割合です。勝利数が少ない選手は、傾向の信頼度が低くなる点にご注意ください。
      </p>
    </div>
  );
}

export default RacerTechniqueProfileChart;
