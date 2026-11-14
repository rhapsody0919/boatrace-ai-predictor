/**
 * OutcomePatternPreview - レース詳細ページ内の出現パターンプレビュー
 * AIデータ予想の下に、モデルが予測した1着コースの出現パターンを表示
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useFirstBoat, useOutcomeData } from "./OutcomePatternPreviewHooks.jsx";
import OutcomePatternPreviewTable from "./OutcomePatternPreviewTable.jsx";
import "./OutcomePatternPreview.css";

function OutcomePatternPreview({
  venueCode,
  venueName,
  prediction,
  selectedModel,
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const firstBoat = useFirstBoat(prediction, selectedModel);
  const { outcomeData, boatTotalRaces, loading, error } = useOutcomeData(
    expanded,
    venueCode,
    firstBoat,
  );

  // firstBoat がない場合は表示しない
  if (firstBoat === null) {
    return null;
  }

  const patterns = outcomeData?.data?.[firstBoat] || [];
  const topPatterns = patterns.slice(0, 10);

  return (
    <div className="outcome-pattern-preview">
      <button className="expand-button" onClick={() => setExpanded(!expanded)}>
        <span className="chevron">{expanded ? "▼" : "▶"}</span>
        <h3>📊 {t("outcomePreview.title", { boat: firstBoat })}</h3>
      </button>

      {expanded && (
        <div className="preview-content">
          {loading && (
            <div className="loading">{t("outcomePreview.loading")}</div>
          )}

          {error && (
            <div className="error">
              {t("outcomePreview.error", { message: error })}
            </div>
          )}

          {!loading && !error && topPatterns.length > 0 && (
            <OutcomePatternPreviewTable
              topPatterns={topPatterns}
              firstBoat={firstBoat}
              boatTotalRaces={boatTotalRaces}
              venueCode={venueCode}
              venueName={venueName}
            />
          )}

          {!loading && !error && topPatterns.length === 0 && (
            <div className="no-data">{t("outcomePreview.noData")}</div>
          )}
        </div>
      )}
    </div>
  );
}

export default OutcomePatternPreview;
