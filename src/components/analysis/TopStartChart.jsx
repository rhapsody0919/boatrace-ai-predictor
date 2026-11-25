/**
 * TopStartChart - 枠番別トップスタート分析（BOA-154）
 * 会場別・枠番別に「そのレースで最速STを記録した確率」と
 * 「トップスタート時に実際に1着になった確率」を可視化する
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
import BandWrapAxisTick from "../BandWrapAxisTick";
import AnalysisVenueSelect from "./AnalysisVenueSelect";
import { STADIUM_NAMES } from "../../constants/index.js";
import { getTopStartStats } from "../../services/venueQueries2.js";
import "./WinningTechniqueChart.css";

const BOATS = [1, 2, 3, 4, 5, 6];

function StateBox({ className, children }) {
  return (
    <div className="winning-technique-container">
      <div className={className}>{children}</div>
    </div>
  );
}

function TopStartSummary({ venueLabel, data, t }) {
  return (
    <div className="summary-info">
      <p>
        <strong>{venueLabel}</strong> - {t("analysis.topStart.summary")}
        {data[0]?.last_updated && (
          <span className="update-date">
            {t("analysis.lastUpdated", { date: data[0].last_updated })}
          </span>
        )}
      </p>
    </div>
  );
}

function TopStartBarChart({ chartData, t }) {
  return (
    <ResponsiveContainer width="100%" height={360}>
      <BarChart
        data={chartData}
        margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
      >
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis
          dataKey="boat_number"
          interval={0}
          tick={(props) => <BandWrapAxisTick {...props} fontSize={11} />}
        />
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
          dataKey="top_start_rate"
          name={t("analysis.topStart.topStartRate")}
          fill="var(--brand-accent-primary)"
        />
        <Bar
          dataKey="win_when_top_start"
          name={t("analysis.topStart.winWhenTopStart")}
          fill="var(--brand-accent-secondary)"
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

function TopStartTable({ data, t }) {
  return (
    <div className="table-wrapper">
      <table className="winning-technique-table">
        <thead>
          <tr>
            <th>{t("analysis.laneHeader")}</th>
            <th>{t("analysis.topStart.participationsHeader")}</th>
            <th>{t("analysis.topStart.topStartCountHeader")}</th>
            <th>{t("analysis.topStart.topStartRateHeader")}</th>
            <th>{t("analysis.topStart.winWhenTopStartHeader")}</th>
          </tr>
        </thead>
        <tbody>
          {BOATS.map((boatNumber) =>
            data.find((row) => row.boat_number === boatNumber),
          )
            .filter(Boolean)
            .map((row) => (
              <tr key={row.boat_number}>
                <td className="boat-num">
                  {t("analysis.boatN", { n: row.boat_number })}
                </td>
                <td className="count">{row.race_count}</td>
                <td className="count">{row.top_start_count}</td>
                <td className="percentage">{row.top_start_rate.toFixed(2)}%</td>
                <td className="percentage">
                  {row.win_rate_when_top_start.toFixed(2)}%
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}

function TopStartChart({ initialVenueCode = null }) {
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
        const data = await getTopStartStats(venueCode);
        setStatsData(data);
      } catch (err) {
        setError(err.message || t("analysis.dataLoadError"));
        console.error("Failed to load top start stats:", err);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [selectedVenue]);

  if (loading) {
    return (
      <StateBox className="loading-state">{t("analysis.loading")}</StateBox>
    );
  }

  if (error) {
    return (
      <StateBox className="error-state">
        {t("analysis.error", { message: error })}
      </StateBox>
    );
  }

  if (!statsData || !statsData.data || statsData.data.length === 0) {
    return (
      <StateBox className="empty-state">
        {t("analysis.topStart.empty")}
      </StateBox>
    );
  }

  const { data } = statsData;
  const venueName = STADIUM_NAMES[parseInt(selectedVenue, 10)];
  const venueLabel = t(`venues.${parseInt(selectedVenue, 10)}`, venueName);

  const chartData = BOATS.map((boatNumber) =>
    data.find((row) => row.boat_number === boatNumber),
  )
    .filter(Boolean)
    .map((row) => ({
      boat_number: t("analysis.boatN", { n: row.boat_number }),
      top_start_rate: row.top_start_rate,
      win_when_top_start: row.win_rate_when_top_start,
    }));

  return (
    <div className="winning-technique-container">
      <h2>{t("analysis.topStart.title")}</h2>
      <p className="section-description">
        {t("analysis.topStart.description")}
      </p>

      <AnalysisVenueSelect
        id="top-start-venue-select"
        value={selectedVenue}
        onChange={setSelectedVenue}
        t={t}
      />

      {venueName && (
        <TopStartSummary venueLabel={venueLabel} data={data} t={t} />
      )}

      <TopStartBarChart chartData={chartData} t={t} />

      <TopStartTable data={data} t={t} />

      <p className="table-note">{t("analysis.topStart.note")}</p>
    </div>
  );
}

export default TopStartChart;
