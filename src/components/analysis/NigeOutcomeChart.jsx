/**
 * NigeOutcomeChart - 逃げ成功時の複勝分布（BOA-158）
 * 会場別に「逃げ（先頭独走）で1着になった場合」の3連単出現パターンを1着別に表示する
 * 既存のOutcomeDistributionTableと同じ構成だが、winning_technique='逃げ'に絞り込んだ集計
 */
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { supabaseDataService } from "../../services/supabaseDataService";
import "./OutcomeDistributionTable.css";

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

function NigeOutcomeChart({ initialVenueCode = null }) {
  const { t } = useTranslation();
  const [selectedVenue, setSelectedVenue] = useState(initialVenueCode || "03");
  const [outcomeData, setOutcomeData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [topPatternsExpanded, setTopPatternsExpanded] = useState(true);
  const [topPatternLimit, setTopPatternLimit] = useState(10);

  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        setError(null);
        const venueCode = parseInt(selectedVenue, 10);
        const data =
          await supabaseDataService.getNigeOutcomeDistribution(venueCode);
        setOutcomeData(data);
      } catch (err) {
        setError(err.message || t("analysis.dataLoadError"));
        console.error("Failed to load nige outcome distribution:", err);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [selectedVenue]);

  if (loading) {
    return (
      <div className="outcome-distribution-container">
        <div className="loading-state">{t("analysis.loading")}</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="outcome-distribution-container">
        <div className="error-state">
          {t("analysis.error", { message: error })}
        </div>
      </div>
    );
  }

  if (!outcomeData || !outcomeData.data) {
    return (
      <div className="outcome-distribution-container">
        <div className="empty-state">{t("analysis.nige.empty")}</div>
      </div>
    );
  }

  const { venue_name, total_races, last_updated, data } = outcomeData;
  const venueLabel = t(`venues.${parseInt(selectedVenue, 10)}`, venue_name);

  return (
    <div className="outcome-distribution-container">
      <h2>{t("analysis.nige.title")}</h2>
      <p className="section-description">{t("analysis.nige.description")}</p>

      <div className="controls-section">
        <label htmlFor="nige-venue-select">
          {t("analysis.venueSelectLabel")}
        </label>
        <select
          id="nige-venue-select"
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

      {total_races > 0 && (
        <div className="summary-info">
          <p>
            <strong>{venueLabel}</strong> -{" "}
            {t("analysis.nige.summary", { count: total_races })}
            {last_updated && (
              <span className="update-date">
                {t("analysis.lastUpdated", { date: last_updated })}
              </span>
            )}
          </p>
        </div>
      )}

      <div className="top-patterns-section">
        <div className="top-patterns-header">
          <button
            className="expand-button"
            onClick={() => setTopPatternsExpanded(!topPatternsExpanded)}
          >
            <span className="chevron">{topPatternsExpanded ? "▼" : "▶"}</span>
            <h3>{t("analysis.rankingTitle")}</h3>
          </button>
          <div className="limit-controls">
            <label>{t("analysis.limitLabel")}</label>
            {[10, 20, 50].map((limit) => (
              <button
                key={limit}
                className={`limit-button ${topPatternLimit === limit ? "active" : ""}`}
                onClick={() => setTopPatternLimit(limit)}
              >
                Top {limit}
              </button>
            ))}
          </div>
        </div>

        {topPatternsExpanded && (
          <div className="table-wrapper">
            {(() => {
              const allPatterns = [];
              for (const firstBoat in data) {
                const patterns = data[firstBoat] || [];
                patterns.forEach((pattern) => {
                  allPatterns.push({
                    firstBoat: parseInt(firstBoat),
                    secondBoat: pattern.second_boat,
                    thirdBoat: pattern.third_boat,
                    count: pattern.count,
                    probability: pattern.probability,
                    avg_payout: pattern.avg_payout,
                  });
                });
              }
              allPatterns.sort((a, b) => b.probability - a.probability);
              const topPatterns = allPatterns.slice(0, topPatternLimit);

              return (
                <table className="top-patterns-table">
                  <thead>
                    <tr>
                      <th>{t("analysis.rankHeader")}</th>
                      <th>{t("analysis.trifectaHeader")}</th>
                      <th>{t("analysis.countHeader")}</th>
                      <th>{t("analysis.ratePctHeader")}</th>
                      <th>{t("analysis.avgPayoutHeader")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topPatterns.map((pattern, idx) => (
                      <tr key={idx}>
                        <td className="rank">{idx + 1}</td>
                        <td className="trifecta">
                          {pattern.firstBoat}-{pattern.secondBoat}-
                          {pattern.thirdBoat}
                        </td>
                        <td className="count">{pattern.count}</td>
                        <td className="probability">
                          {pattern.probability.toFixed(2)}%
                        </td>
                        <td className="payout">
                          {pattern.avg_payout
                            ? `¥${pattern.avg_payout.toLocaleString()}`
                            : "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              );
            })()}
          </div>
        )}
      </div>

      <div className="tabs-container">
        {[1, 2, 3, 4, 5, 6].map((firstBoat) => {
          const patterns = data[firstBoat] || [];

          return (
            <div key={firstBoat} className="outcome-tab">
              <div className="tab-header">
                <h3>{t("analysis.nige.firstHeading", { n: firstBoat })}</h3>
                <span className="pattern-count">
                  {t("analysis.patternCount", { n: patterns.length })}
                </span>
              </div>

              {patterns.length > 0 ? (
                <div className="table-wrapper">
                  <table className="outcome-table">
                    <thead>
                      <tr>
                        <th>{t("analysis.secondHeader")}</th>
                        <th>{t("analysis.thirdHeader")}</th>
                        <th>{t("analysis.countHeader")}</th>
                        <th>{t("analysis.ratePctHeader")}</th>
                        <th>{t("analysis.avgPayoutHeader")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {patterns.map((pattern, idx) => (
                        <tr key={idx}>
                          <td className="boat-num">{pattern.second_boat}</td>
                          <td className="boat-num">{pattern.third_boat}</td>
                          <td className="count">{pattern.count}</td>
                          <td className="probability">
                            {pattern.probability.toFixed(2)}%
                          </td>
                          <td className="payout">
                            {pattern.avg_payout
                              ? `¥${pattern.avg_payout.toLocaleString()}`
                              : "-"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="no-patterns">{t("analysis.noData")}</div>
              )}
            </div>
          );
        })}
      </div>

      <p className="table-note">{t("analysis.nige.note")}</p>
    </div>
  );
}

export default NigeOutcomeChart;
