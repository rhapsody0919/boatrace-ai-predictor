/**
 * VenueTendencyPanel - この会場の枠番別傾向（race-detail-analysis-integration FR-2）
 * 会場×枠番の過去傾向（決まり手/トップスタート率/負け決まり手/展示最速転換率）を
 * 6艇分並べて表示する。DataRaceTable（選手個人×当該レース）とは主語が異なるため
 * 別コンポーネントとして分離し、見出しで明示する。
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useVenueTendencyStats } from "../../hooks/useVenueTendencyStats";
import TermHintButton from "./TermHintButton";
import VenueTendencyPanelTable from "./VenueTendencyPanelTable";
import InlineFetchError from "../InlineFetchError";
import "./VenueTendencyPanel.css";

function indexStats(stats) {
  return {
    techniqueByBoat: stats.technique?.data ?? {},
    losingByBoat: stats.losing?.data ?? {},
    topStartByBoat: new Map(
      (stats.topStart?.data ?? []).map((row) => [row.boat_number, row]),
    ),
    exhibitionTopByBoat: new Map(
      (stats.exhibitionTop?.data ?? []).map((row) => [row.boat_number, row]),
    ),
  };
}

function pickLastUpdated(stats) {
  return (
    stats.technique?.last_updated ??
    stats.topStart?.last_updated ??
    stats.losing?.last_updated ??
    stats.exhibitionTop?.last_updated ??
    null
  );
}

function VenueTendencyPanel({ venueCode, raceId }) {
  const { t, i18n } = useTranslation();
  const [expanded, setExpanded] = useState(true);
  const stats = useVenueTendencyStats(venueCode);

  if (!venueCode) return null;

  const { techniqueByBoat, losingByBoat, topStartByBoat, exhibitionTopByBoat } =
    indexStats(stats);
  const lastUpdated = pickLastUpdated(stats);

  return (
    <div className="venue-tendency-panel">
      <div className="vtp-header">
        <button
          className="vtp-header-toggle"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          <span className="vtp-chevron">{expanded ? "▼" : "▶"}</span>
          <h3 className="vtp-title">📍 {t("venueTendency.title")}</h3>
        </button>
        <TermHintButton termKey="venueTendency" />
      </div>

      {expanded && (
        <div className="vtp-content">
          <p className="vtp-note">{t("venueTendency.note")}</p>

          {/* 取得失敗を「—」「データ不足」に化けさせない（BOA-359） */}
          {stats.hasFailure && <InlineFetchError onRetry={stats.reload} />}

          <VenueTendencyPanelTable
            venueCode={venueCode}
            raceId={raceId}
            techniqueByBoat={techniqueByBoat}
            losingByBoat={losingByBoat}
            topStartByBoat={topStartByBoat}
            exhibitionTopByBoat={exhibitionTopByBoat}
          />

          {lastUpdated && (
            <p className="vtp-updated">
              {t("venueTendency.lastUpdated", {
                // last_updated は集計の時刻（timestamptz）。日本の暦日で出す。端末の
                // タイムゾーンで読むと、JST より西の端末で前日になる（BOA-1092）
                date: new Date(lastUpdated).toLocaleDateString(
                  i18n.language === "ja" ? "ja-JP" : i18n.language,
                  { timeZone: "Asia/Tokyo" },
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
