import { useState } from "react";
import { useTranslation } from "react-i18next";
import SimilarCompareRow from "./SimilarCompareRow";

const k = "aiPredictionTab.analogy.similar";
const FIRST_ROWS = 20;

/**
 * 1件ずつ見比べる（spec B-7）。行を押すと今日と全項目を並べる。open・onOpen は親が持つ（ソナーの点から開くため）
 */
export default function SimilarCompareList({
  neighbors,
  items,
  exhibitionStage,
  today,
  open,
  onOpen,
  expanded,
  onExpanded,
}) {
  const { t } = useTranslation();
  const [all, setAll] = useState(false);
  const shownAll =
    all || neighbors.findIndex((x) => x.race_id === open) >= FIRST_ROWS;
  const shown = shownAll ? neighbors : neighbors.slice(0, FIRST_ROWS);
  return (
    <details
      className="af-details"
      open={expanded}
      onToggle={(e) => onExpanded(e.currentTarget.open)}
    >
      <summary>{t(`${k}.cmpSummary`)}</summary>
      <p className="af-sub">{t(`${k}.cmpLede`)}</p>
      <div className="af-nb-list">
        {shown.map((x, i) => (
          <SimilarCompareRow
            key={x.race_id}
            x={x}
            i={i}
            items={items}
            exhibitionStage={exhibitionStage}
            today={today}
            open={open}
            onOpen={onOpen}
            t={t}
          />
        ))}
      </div>
      {neighbors.length > FIRST_ROWS && (
        <button
          type="button"
          className="af-btn"
          onClick={() => setAll(!shownAll)}
        >
          {shownAll
            ? t(`${k}.cmpLess`, { n: FIRST_ROWS })
            : t(`${k}.cmpMore`, { n: neighbors.length - FIRST_ROWS })}
        </button>
      )}
    </details>
  );
}
