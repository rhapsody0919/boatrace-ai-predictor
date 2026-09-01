/**
 * DataRaceTable - データ出走表（BOA-168）
 * 出走6選手×分析指標の転置マトリクス（行=指標、列=艇番）。
 * レースページの主役としてAI予想ブロック群より上に表示する。
 * 指標の定義（値レンダリング・最良艇判定）はraceIndicators.jsxで
 * RaceReview（振り返り）と共通化している。
 * 色分けはレース内相対順位ベース（行ごとに最良セルをハイライト）で、
 * 恣意的な絶対閾値は使わない。全艇同値の指標はハイライトしない。
 */
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { BOAT_COLORS } from "../../utils/colors";
import { useRaceAnalysisData } from "../../hooks/useRaceAnalysisData";
import { buildIndicatorRows } from "./raceIndicators";
import { trackEvent } from "../../utils/analytics";
import TermHintButton from "./TermHintButton";
import "./DataRaceTable.css";

function DataRaceTable({ raceId, prediction, venueCode }) {
  const { t, i18n } = useTranslation();
  const analysis = useRaceAnalysisData(raceId);

  const players = [...(prediction?.allPlayers ?? [])].sort(
    (a, b) => a.number - b.number,
  );
  if (players.length === 0) return null;

  const rows = buildIndicatorRows({
    t,
    players,
    analysis,
    pending: analysis.pending,
  });

  const deepLink = (tab) =>
    venueCode && raceId
      ? `/winning-technique?venue_code=${venueCode}&race_id=${raceId}&tab=${tab}`
      : `/winning-technique?tab=${tab}`;

  const cellClass = (boat, best) =>
    `drt-cell ${best !== null && boat === best ? "drt-best" : ""}`;

  return (
    <div className="data-race-table" id="data-race-table">
      <h3 className="drt-title">
        📋 {t("dataTable.title")}
        {analysis.loading && (
          <span className="drt-loading-chip">{t("dataTable.loading")}</span>
        )}
      </h3>
      <p className="drt-subtitle">{t("dataTable.subtitle")}</p>

      <div className="drt-table-wrapper">
        <table className="drt-table">
          <thead>
            <tr>
              <th className="drt-label-th"></th>
              {players.map((p) => {
                const color = BOAT_COLORS[p.number] || {};
                return (
                  <th
                    key={p.number}
                    className="drt-boat-th"
                    style={{ background: color.bg, color: color.text }}
                  >
                    {p.number}
                  </th>
                );
              })}
            </tr>
            <tr>
              <th className="drt-label-th"></th>
              {players.map((p) => (
                <th key={p.number} className="drt-name-th">
                  {p.racerId ? (
                    <Link to={`/racer/${p.racerId}`} translate="no">
                      {p.name?.replace(/\s+/g, "")}
                    </Link>
                  ) : (
                    <span translate="no">{p.name?.replace(/\s+/g, "")}</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <td className="drt-label-cell">
                  {row.tab ? (
                    <Link
                      to={deepLink(row.tab)}
                      className="drt-label-link"
                      onClick={() =>
                        trackEvent("deep_link_click", {
                          tab: row.tab,
                          source: "data_race_table",
                        })
                      }
                    >
                      <span className="drt-label-full">{row.label}</span>
                      <span className="drt-label-short">{row.shortLabel}</span>
                      <span className="drt-link-arrow">›</span>
                    </Link>
                  ) : (
                    <>
                      <span className="drt-label-full">{row.label}</span>
                      <span className="drt-label-short">{row.shortLabel}</span>
                    </>
                  )}
                  <TermHintButton termKey={row.key} />
                  {row.note && (
                    <span className="drt-label-note">{row.note}</span>
                  )}
                </td>
                {players.map((p) => (
                  <td key={p.number} className={cellClass(p.number, row.best)}>
                    {row.render(p)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="drt-note">💡 {t("dataTable.note")}</p>
      {i18n.language === "ja" && (
        <Link to="/blog/data-race-table-guide" className="drt-guide-link">
          📖 {t("dataTable.guideLink")} →
        </Link>
      )}
    </div>
  );
}

export default DataRaceTable;
