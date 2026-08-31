/**
 * VenueTendencyPanel - この会場の枠番別傾向（race-detail-analysis-integration FR-2）
 * 会場×枠番の過去傾向（決まり手/トップスタート率/負け決まり手/展示最速転換率）を
 * 6艇分並べて表示する。DataRaceTable（選手個人×当該レース）とは主語が異なるため
 * 別コンポーネントとして分離し、見出しで明示する。
 *
 * カテゴリ分割指標（決まり手/負け決まり手）はセルごとのサンプル数が薄くなりやすいため、
 * n未満（MIN_CATEGORY_SAMPLE）は「データ不足」表示にし数値を隠す。
 * 2値指標（トップスタート率/展示最速転換率）はn数併記のみで常に表示する。
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { BOAT_COLORS } from "../../utils/colors";
import { useVenueTendencyStats } from "../../hooks/useVenueTendencyStats";
import { translateTechnique } from "./raceIndicators";
import { trackEvent } from "../../utils/analytics";
import "./VenueTendencyPanel.css";

const MIN_CATEGORY_SAMPLE = 20;
const BOATS = [1, 2, 3, 4, 5, 6];

function pickTopTechnique(entry) {
  if (!entry || !entry.techniques || entry.techniques.length === 0) return null;
  return entry.techniques[0];
}

function VenueTendencyPanel({ venueCode, raceId }) {
  const { t, i18n } = useTranslation();
  const [expanded, setExpanded] = useState(true);
  const stats = useVenueTendencyStats(venueCode);

  if (!venueCode) return null;

  const deepLink = (tab) =>
    venueCode && raceId
      ? `/winning-technique?venue_code=${venueCode}&race_id=${raceId}&tab=${tab}`
      : `/winning-technique?venue_code=${venueCode}&tab=${tab}`;

  const onLinkClick = (tab) => () =>
    trackEvent("deep_link_click", { tab, source: "venue_tendency_panel" });

  const techniqueByBoat = stats.technique?.data ?? {};
  const losingByBoat = stats.losing?.data ?? {};
  const topStartByBoat = new Map(
    (stats.topStart?.data ?? []).map((row) => [row.boat_number, row]),
  );
  const exhibitionTopByBoat = new Map(
    (stats.exhibitionTop?.data ?? []).map((row) => [row.boat_number, row]),
  );

  const lastUpdated =
    stats.technique?.last_updated ??
    stats.topStart?.last_updated ??
    stats.losing?.last_updated ??
    stats.exhibitionTop?.last_updated ??
    null;

  const renderCategoryCell = (byBoat, boat) => {
    const top = pickTopTechnique(byBoat[boat]);
    if (!top) return <span className="vtp-empty">—</span>;
    if (top.count < MIN_CATEGORY_SAMPLE) {
      return (
        <span className="vtp-value">
          <span className="vtp-insufficient">
            {t("venueTendency.insufficientData")}
          </span>
          <span className="vtp-n">
            {t("venueTendency.sampleCount", { n: top.count })}
          </span>
        </span>
      );
    }
    return (
      <span className="vtp-value">
        <span className="vtp-main">
          {translateTechnique(t, top.technique)} {Math.round(top.percentage)}%
        </span>
        <span className="vtp-n">
          {t("venueTendency.sampleCount", { n: top.count })}
        </span>
      </span>
    );
  };

  const renderTopStartCell = (boat) => {
    const row = topStartByBoat.get(boat);
    if (!row || !row.race_count) return <span className="vtp-empty">—</span>;
    return (
      <span className="vtp-value">
        <span className="vtp-main">{Math.round(row.top_start_rate)}%</span>
        <span className="vtp-n">
          {t("venueTendency.sampleCount", { n: row.race_count })}
        </span>
      </span>
    );
  };

  const renderExhibitionTopCell = (boat) => {
    const row = exhibitionTopByBoat.get(boat);
    if (!row || !row.fastest_count) return <span className="vtp-empty">—</span>;
    return (
      <span className="vtp-value">
        <span className="vtp-main">
          {Math.round(row.win_rate_when_fastest)}%
        </span>
        <span className="vtp-n">
          {t("venueTendency.sampleCount", { n: row.fastest_count })}
        </span>
      </span>
    );
  };

  return (
    <div className="venue-tendency-panel">
      <button
        className="vtp-header"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className="vtp-chevron">{expanded ? "▼" : "▶"}</span>
        <h3 className="vtp-title">📍 {t("venueTendency.title")}</h3>
      </button>

      {expanded && (
        <div className="vtp-content">
          <p className="vtp-note">{t("venueTendency.note")}</p>

          <div className="vtp-table-wrapper">
            <table className="vtp-table">
              <thead>
                <tr>
                  <th className="vtp-label-th"></th>
                  {BOATS.map((boat) => {
                    const color = BOAT_COLORS[boat] || {};
                    return (
                      <th
                        key={boat}
                        className="vtp-boat-th"
                        style={{ background: color.bg, color: color.text }}
                      >
                        {t("venueTendency.boatLabel", { n: boat })}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="vtp-label-cell">
                    <Link
                      to={deepLink("technique")}
                      className="vtp-label-link"
                      onClick={onLinkClick("technique")}
                    >
                      <span className="vtp-label-full">
                        {t("venueTendency.rowTechnique")}
                      </span>
                      <span className="vtp-label-short">
                        {t("venueTendency.rowTechniqueShort")}
                      </span>
                    </Link>
                    <Link
                      to={deepLink("nige")}
                      className="vtp-nige-link"
                      onClick={onLinkClick("nige")}
                    >
                      <span className="vtp-label-full">
                        {t("venueTendency.nigeLink")}
                      </span>
                      <span className="vtp-label-short">
                        {t("venueTendency.nigeLinkShort")}
                      </span>
                    </Link>
                  </td>
                  {BOATS.map((boat) => (
                    <td key={boat} className="vtp-cell">
                      {renderCategoryCell(techniqueByBoat, boat)}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="vtp-label-cell">
                    <Link
                      to={deepLink("topstart")}
                      className="vtp-label-link"
                      onClick={onLinkClick("topstart")}
                    >
                      <span className="vtp-label-full">
                        {t("venueTendency.rowTopStart")}
                      </span>
                      <span className="vtp-label-short">
                        {t("venueTendency.rowTopStartShort")}
                      </span>
                    </Link>
                  </td>
                  {BOATS.map((boat) => (
                    <td key={boat} className="vtp-cell">
                      {renderTopStartCell(boat)}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="vtp-label-cell">
                    <Link
                      to={deepLink("losing")}
                      className="vtp-label-link"
                      onClick={onLinkClick("losing")}
                    >
                      <span className="vtp-label-full">
                        {t("venueTendency.rowLosing")}
                      </span>
                      <span className="vtp-label-short">
                        {t("venueTendency.rowLosingShort")}
                      </span>
                    </Link>
                  </td>
                  {BOATS.map((boat) => (
                    <td key={boat} className="vtp-cell">
                      {renderCategoryCell(losingByBoat, boat)}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="vtp-label-cell">
                    <Link
                      to={deepLink("extime")}
                      className="vtp-label-link"
                      onClick={onLinkClick("extime")}
                    >
                      <span className="vtp-label-full">
                        {t("venueTendency.rowExhibitionTop")}
                      </span>
                      <span className="vtp-label-short">
                        {t("venueTendency.rowExhibitionTopShort")}
                      </span>
                    </Link>
                  </td>
                  {BOATS.map((boat) => (
                    <td key={boat} className="vtp-cell">
                      {renderExhibitionTopCell(boat)}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>

          {lastUpdated && (
            <p className="vtp-updated">
              {t("venueTendency.lastUpdated", {
                date: new Date(lastUpdated).toLocaleDateString(
                  i18n.language === "ja" ? "ja-JP" : i18n.language,
                ),
              })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default VenueTendencyPanel;
