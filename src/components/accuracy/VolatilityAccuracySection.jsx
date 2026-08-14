/**
 * VolatilityAccuracySection - イン崩れ予測精度セクション
 *
 * 2026-08-15: CSSを自己完結させるためAccuracyDashboard.css依存から
 * 専用のVolatilityAccuracySection.cssに切り出した（BOA-177対応で
 * /winning-technique側からも再利用するため）。同対応で/winning-technique
 * （4言語対応済み）から使われるようになったため、ハードコードされていた
 * 日本語文言をすべてi18nキー（volatilityAccuracy.*）に置き換えた
 */
import { useTranslation } from "react-i18next";
import "./VolatilityAccuracySection.css";

const LEVEL_ICONS = { low: "🎯", medium: "⚖️", high: "🌪️" };
const LEVEL_COLORS = {
  low: { color: "#4caf50", bg: "#e8f5e9" },
  medium: { color: "#2196f3", bg: "#e3f2fd" },
  high: { color: "#ff9800", bg: "#fff3e0" },
};

const GRADE_COLORS = {
  SG: "#7c3aed",
  G1: "#dc2626",
  G2: "#2563eb",
  G3: "#059669",
  ippan: "#64748b",
};

function LevelBar({ t, level, data, baseline }) {
  if (!data) return null;
  const cfg = LEVEL_COLORS[level];
  const BAR_MAX = 80;
  const barWidth = Math.min(100, (data.upsetRate / BAR_MAX) * 100);
  const baselinePos = Math.min(100, (baseline.upsetRate / BAR_MAX) * 100);

  return (
    <div className="vas-row">
      <div className="vas-label">
        {LEVEL_ICONS[level]} {t(`volatilityAccuracy.level.${level}`)}
      </div>
      <div className="vas-bar-wrap">
        <div className="vas-bar-track">
          <div
            className="vas-bar-fill"
            style={{ width: `${barWidth}%`, background: cfg.color }}
          />
          <div
            className="vas-baseline-marker"
            style={{ left: `${baselinePos}%` }}
            title={t("volatilityAccuracy.baselineTitle", {
              rate: baseline.upsetRate.toFixed(1),
            })}
          />
        </div>
        <div className="vas-rate" style={{ color: cfg.color }}>
          {data.upsetRate.toFixed(1)}%
        </div>
      </div>
    </div>
  );
}

function GradeTable({ t, byGrade }) {
  if (!byGrade || Object.keys(byGrade).length === 0) return null;
  const grades = ["SG", "G1", "G2", "G3", "ippan"].filter((g) => byGrade[g]);

  return (
    <details className="vas-grade-details">
      <summary>{t("volatilityAccuracy.gradeDetailsSummary")}</summary>
      <div className="table-wrapper">
        <table className="volatility-grade-table">
          <thead>
            <tr>
              <th>{t("volatilityAccuracy.gradeHeader")}</th>
              <th>{t("volatilityAccuracy.highUpsetRateHeader")}</th>
              <th>{t("volatilityAccuracy.baselineRateHeader")}</th>
              <th>{t("volatilityAccuracy.countHeader")}</th>
            </tr>
          </thead>
          <tbody>
            {grades.map((grade) => {
              const d = byGrade[grade];
              const isRef = d.highRaceCount < 30;
              return (
                <tr key={grade}>
                  <td style={{ fontWeight: 700, color: GRADE_COLORS[grade] }}>
                    {grade === "ippan"
                      ? t("volatilityAccuracy.gradeIppan")
                      : grade}
                  </td>
                  <td style={{ fontWeight: 600, color: "#ff9800" }}>
                    {d.highUpsetRate != null
                      ? `${d.highUpsetRate.toFixed(1)}%`
                      : "-"}
                    {isRef && <span className="vas-ref-note"> ※</span>}
                  </td>
                  <td>{d.upsetRate.toFixed(1)}%</td>
                  <td>{d.highRaceCount}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="vas-ref-desc">{t("volatilityAccuracy.gradeRefNote")}</p>
      </div>
    </details>
  );
}

function VolatilityAccuracySection({ stats }) {
  const { t } = useTranslation();
  if (!stats) return null;
  const { baseline, byLevel, byVenue, byGrade } = stats;
  if (!baseline || !byLevel) return null;

  const highData = byLevel.high;

  return (
    <div className="volatility-accuracy-section">
      <h3>{t("volatilityAccuracy.title")}</h3>

      {/* ひと言サマリー */}
      {highData && (
        <p className="vas-summary">
          {t("volatilityAccuracy.summaryPrefix")}{" "}
          <strong style={{ color: "#ff9800", fontSize: "1.1em" }}>
            {highData.upsetRate.toFixed(1)}%
          </strong>{" "}
          {t("volatilityAccuracy.summarySuffix")}
          <span className="vas-summary-sub">
            {t("volatilityAccuracy.summaryBaseline", {
              rate: baseline.upsetRate.toFixed(1),
            })}
          </span>
        </p>
      )}

      {/* ラベル別バー */}
      <div className="vas-bars">
        {["low", "medium", "high"].map((level) => (
          <LevelBar
            key={level}
            t={t}
            level={level}
            data={byLevel[level]}
            baseline={baseline}
          />
        ))}
      </div>
      <div className="vas-legend">
        <span className="vas-legend-marker" />
        {t("volatilityAccuracy.legendBaseline", {
          rate: baseline.upsetRate.toFixed(1),
        })}
        <span className="vas-legend-count">
          {t("volatilityAccuracy.legendCount", {
            count: baseline.raceCount.toLocaleString(),
          })}
        </span>
      </div>

      {/* グレード別テーブル */}
      <GradeTable t={t} byGrade={byGrade} />

      {/* 会場別テーブル（折りたたみ気味に小さく） */}
      {byVenue && byVenue.length > 0 && (
        <details className="vas-venue-details">
          <summary>{t("volatilityAccuracy.venueDetailsSummary")}</summary>
          <div className="table-wrapper">
            <table className="volatility-venue-table">
              <thead>
                <tr>
                  <th>{t("volatilityAccuracy.venueHeader")}</th>
                  <th>{t("volatilityAccuracy.highUpsetRateHeader")}</th>
                  <th>{t("volatilityAccuracy.baselineRateHeader")}</th>
                  <th>{t("volatilityAccuracy.countHeader")}</th>
                </tr>
              </thead>
              <tbody>
                {byVenue.map((v) => (
                  <tr
                    key={v.venueCode}
                    style={{ opacity: v.isReliable ? 1 : 0.7 }}
                  >
                    <td className="volatility-venue-table__name">
                      {v.venueName}
                    </td>
                    <td style={{ fontWeight: 600, color: "#ff9800" }}>
                      {v.highUpsetRate.toFixed(1)}%
                      {!v.isReliable && (
                        <span className="vas-ref-note"> ※</span>
                      )}
                    </td>
                    <td>{v.baselineUpsetRate.toFixed(1)}%</td>
                    <td>{v.highRaceCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="vas-ref-desc">
              {t("volatilityAccuracy.venueRefNote")}
            </p>
          </div>
        </details>
      )}
    </div>
  );
}

export default VolatilityAccuracySection;
