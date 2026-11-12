/**
 * RacerTechniqueProfileChart - 選手別決まり手傾向（BOA-165）
 * 本日開催中の会場・レースを選ぶと、そのレースに出走する6選手について
 * 過去90日間で勝った時にどの決まり手で勝っているか（勝ちパターン）を表示する。
 * 会場・枠番単位の「決まり手データ分析」（BOA-150）とは異なり、選手個人単位の傾向を見る機能。
 */
import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
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
import { useVenueRaceSelector } from "../../hooks/useVenueRaceSelector";
import { getRaceTechniqueProfileBreakdown } from "../../services/raceQueries3.js";
import { translateTechnique } from "../race/raceIndicators";
import "./MotorConditionChart.css";
import { techniqueColor, sortTechniquesOfficial } from "../../utils/techniqueColors";

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

// dataKeyはDB値（日本語）のまま保つ。凡例・ツールチップの翻訳表示はBar側のname propで行う
function buildChartData(breakdown, allTechniques) {
  return breakdown.map((row) => {
    const item = {
      boat_number: `${row.boat_number} ${row.player_name?.replace(/\s+/g, "") ?? ""}`,
    };
    allTechniques.forEach((technique) => {
      const match = row.techniques.find((tech) => tech.technique === technique);
      item[technique] = match ? match.percentage : 0;
    });
    return item;
  });
}

function ProfileHeading({ t }) {
  return (
    <>
      <h2>{t("analysis.techProfile.title")}</h2>
      <p className="section-description">
        {t("analysis.techProfile.description")}
      </p>
    </>
  );
}

function TechniqueResults({
  chartData,
  allTechniques,
  breakdown,
  techniqueLabel,
  t,
}) {
  return (
    <>
      <TechniqueStackedChart
        chartData={chartData}
        allTechniques={allTechniques}
        techniqueLabel={techniqueLabel}
        t={t}
      />

      <TechniqueBreakdownTable
        breakdown={breakdown}
        techniqueLabel={techniqueLabel}
        t={t}
      />
    </>
  );
}

function RacerTechniqueProfileChart({
  initialVenueCode = null,
  initialRaceId = null,
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

  useEffect(() => {
    if (selectedRace === null) return;
    const loadBreakdown = async () => {
      try {
        setLoading(true);
        setError(null);
        const data =
          await getRaceTechniqueProfileBreakdown(
            selectedRace,
          );
        setBreakdown(data);
      } catch (err) {
        setError(err.message || t("analysis.dataLoadError"));
        console.error("Failed to load race technique profile breakdown:", err);
      } finally {
        setLoading(false);
      }
    };
    loadBreakdown();
  }, [selectedRace]);

  // 決まり手はDB値（日本語）のまま集計し、表示時のみ翻訳する
  const techniqueLabel = (name) => translateTechnique(t, name);

  const allTechniques = sortTechniquesOfficial([
    ...new Set(
      breakdown.flatMap((row) => row.techniques.map((tech) => tech.technique)),
    ),
  ]);

  const chartData = buildChartData(breakdown, allTechniques);

  return (
    <div className="motor-condition-container">
      {!embedded && <ProfileHeading t={t} />}

      {!embedded &&
        (venues.length === 0 && !loading ? (
          <div className="empty-state">{t("analysis.noRacesToday")}</div>
        ) : (
          <VenueRaceControls
            venues={venues}
            selectedVenue={selectedVenue}
            setSelectedVenue={setSelectedVenue}
            races={races}
            selectedRace={selectedRace}
            setSelectedRace={setSelectedRace}
            t={t}
          />
        ))}

      {loading && <div className="loading-state">{t("analysis.loading")}</div>}
      {error && (
        <div className="error-state">
          {t("analysis.error", { message: error })}
        </div>
      )}

      {!loading && !error && breakdown.length > 0 && (
        <TechniqueResults
          chartData={chartData}
          allTechniques={allTechniques}
          breakdown={breakdown}
          techniqueLabel={techniqueLabel}
          t={t}
        />
      )}

      <p className="table-note">{t("analysis.techProfile.note")}</p>
    </div>
  );
}

function VenueRaceControls({
  venues,
  selectedVenue,
  setSelectedVenue,
  races,
  selectedRace,
  setSelectedRace,
  t,
}) {
  return (
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
          <label htmlFor="technique-profile-race-select">
            {t("analysis.raceSelectLabel")}
          </label>
          <select
            id="technique-profile-race-select"
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
  );
}

function TechniqueStackedChart({ chartData, allTechniques, techniqueLabel, t }) {
  return (
    <div translate="no">
      <ResponsiveContainer width="100%" height={360}>
        <BarChart
          data={chartData}
          margin={{ top: 5, right: 30, left: 20, bottom: 40 }}
        >
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            dataKey="boat_number"
            interval={0}
            tick={{ fontSize: 11 }}
            angle={-35}
            textAnchor="end"
            height={60}
          />
          <YAxis
            label={{
              value: t("analysis.techProfile.yAxis"),
              angle: -90,
              position: "insideLeft",
            }}
            domain={[0, 100]}
            ticks={[0, 20, 40, 60, 80, 100]}
          />
          <Tooltip formatter={(value) => `${value.toFixed(1)}%`} />
          <Legend
            // 凡例の文字は本文色にし、色は横の四角で示す。系列の色（橙・灰）の文字は
            // ライトで約2〜2.5:1 と読みにくかった（BOA-711）
            formatter={(value) => (
              <span style={{ color: "var(--text-primary)" }}>
                {value}
              </span>
            )}
          />
          {allTechniques.map((technique, idx) => (
            <Bar
              key={technique}
              dataKey={technique}
              name={techniqueLabel(technique)}
              stackId="technique"
              fill={techniqueColor(technique, idx)}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function TechniqueBreakdownTable({ breakdown, techniqueLabel, t }) {
  return (
    <div className="table-wrapper">
      <table className="motor-ranking-table">
        <thead>
          <tr>
            <th>{t("analysis.laneHeader")}</th>
            <th>{t("table.playerName")}</th>
            <th>{t("analysis.techProfile.winCountHeader")}</th>
            <th>{t("analysis.techProfile.compositionHeader")}</th>
          </tr>
        </thead>
        <tbody>
          {breakdown.map((row) => (
            <tr
              key={row.boat_number}
              className="motor-ranking-row non-clickable-row"
            >
              <td className="rank">{row.boat_number}</td>
              <td>
                <Link to={`/racer/${row.racer_id}`} translate="no">
                  {row.player_name?.replace(/\s+/g, "")}
                </Link>
              </td>
              <td className="rate">{row.win_count}</td>
              <td className="rate">
                {row.techniques.length > 0
                  ? row.techniques
                      .map(
                        (tech) =>
                          `${techniqueLabel(tech.technique)} ${tech.percentage.toFixed(0)}%`,
                      )
                      .join(" / ")
                  : t("analysis.noData")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default RacerTechniqueProfileChart;
