/**
 * ExhibitionTimeTopChart - 展示タイム最速艇の1着転換率分析（BOA-160）
 * 会場別・枠番別に「そのレースで展示タイムが最速だった確率」と
 * 「展示タイム最速時に実際に1着になれた確率」を可視化する
 */
import { useState, useEffect } from "react";
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

function ExhibitionTimeTopChart({ initialVenueCode = null }) {
  const { t } = useTranslation();
  const [selectedVenue, setSelectedVenue] = useState(
    initialVenueCode !== null
      ? String(initialVenueCode).padStart(2, "0")
      : "03",
  );
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
          await supabaseDataService.getExhibitionTimeTopStats(venueCode);
        setStatsData(data);
      } catch (err) {
        setError(err.message || t("analysis.dataLoadError"));
        console.error("Failed to load exhibition time top stats:", err);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [selectedVenue]);

  if (loading) {
    return (
      <div className="winning-technique-container">
        <div className="loading-state">{t("analysis.loading")}</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="winning-technique-container">
        <div className="error-state">
          {t("analysis.error", { message: error })}
        </div>
      </div>
    );
  }

  if (!statsData || !statsData.data || statsData.data.length === 0) {
    return (
      <div className="winning-technique-container">
        <div className="empty-state">{t("analysis.exTop.empty")}</div>
      </div>
    );
  }

  const { data } = statsData;
  const venueName = VENUES.find((v) => v.code === selectedVenue)?.name;
  const venueLabel = t(`venues.${parseInt(selectedVenue, 10)}`, venueName);

  const chartData = [1, 2, 3, 4, 5, 6]
    .map((boatNumber) => data.find((row) => row.boat_number === boatNumber))
    .filter(Boolean)
    .map((row) => ({
      boat_number: t("analysis.boatN", { n: row.boat_number }),
      fastest_rate: row.fastest_rate,
      win_when_fastest: row.win_rate_when_fastest,
    }));

  return (
    <div className="winning-technique-container">
      <h2>{t("analysis.exTop.title")}</h2>
      <p className="section-description">{t("analysis.exTop.description")}</p>

      <div className="controls-section">
        <label htmlFor="exhibition-time-venue-select">
          {t("analysis.venueSelectLabel")}
        </label>
        <select
          id="exhibition-time-venue-select"
          value={selectedVenue}
          onChange={(e) => setSelectedVenue(e.target.value)}
          className="venue-select"
        >
          {VENUES.map((venue) => (
            <option key={venue.code} value={venue.code}>
              {t(`venues.${parseInt(venue.code, 10)}`, venue.name)}
            </option>
          ))}
        </select>
      </div>

      {venueName && (
        <div className="summary-info">
          <p>
            <strong>{venueLabel}</strong> - {t("analysis.exTop.summary")}
            {data[0]?.last_updated && (
              <span className="update-date">
                {t("analysis.lastUpdated", { date: data[0].last_updated })}
              </span>
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
              value: t("analysis.probabilityYAxis"),
              angle: -90,
              position: "insideLeft",
            }}
            domain={[0, 100]}
            ticks={[0, 20, 40, 60, 80, 100]}
          />
          <Tooltip formatter={(value) => `${value.toFixed(1)}%`} />
          <Legend />
          <Bar
            dataKey="fastest_rate"
            name={t("analysis.exTop.fastestRate")}
            fill="var(--brand-accent-primary)"
          />
          <Bar
            dataKey="win_when_fastest"
            name={t("analysis.exTop.winWhenFastest")}
            fill="var(--brand-accent-secondary)"
          />
        </BarChart>
      </ResponsiveContainer>

      <div className="table-wrapper">
        <table className="winning-technique-table">
          <thead>
            <tr>
              <th>{t("analysis.laneHeader")}</th>
              <th>{t("analysis.exTop.participationsHeader")}</th>
              <th>{t("analysis.exTop.fastestCountHeader")}</th>
              <th>{t("analysis.exTop.fastestRateHeader")}</th>
              <th>{t("analysis.exTop.winWhenFastestHeader")}</th>
            </tr>
          </thead>
          <tbody>
            {[1, 2, 3, 4, 5, 6]
              .map((boatNumber) =>
                data.find((row) => row.boat_number === boatNumber),
              )
              .filter(Boolean)
              .map((row) => (
                <tr key={row.boat_number}>
                  <td className="boat-num">
                    {t("analysis.boatN", { n: row.boat_number })}
                  </td>
                  <td className="count">{row.race_count}</td>
                  <td className="count">{row.fastest_count}</td>
                  <td className="percentage">{row.fastest_rate.toFixed(2)}%</td>
                  <td className="percentage">
                    {row.win_rate_when_fastest.toFixed(2)}%
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <p className="table-note">{t("analysis.exTop.note")}</p>
    </div>
  );
}

export default ExhibitionTimeTopChart;
