import BottomSheet from "./BottomSheet";
import BetSummary from "./BetSummary";
import BoatBadge from "../BoatBadge";
import { ASSIST_COPY } from "../../../data/thinkingAssistCopy";

/**
 * マークシート（screens S-1a）: 1着・2着・3着 × 1〜6 のマス。押すと候補に入る／外れる。
 * 欠場の艇のマスは出さない（D-38）。下に配分（BetSummary）
 */
export default function MarkSheet({
  bets,
  absentBoats,
  onToggle,
  onClose,
  points,
  removedNote,
  ...summary
}) {
  return (
    <BottomSheet title={ASSIST_COPY.sheetTitle} onClose={onClose}>
      <div className="ta-ms">
        {[1, 2, 3].map((k) => (
          <div key={k} style={{ display: "contents" }}>
            <span className="ta-ms-h">{ASSIST_COPY.candidateLabel(k)}</span>
            {[1, 2, 3, 4, 5, 6].map((n) =>
              absentBoats.includes(n) ? (
                <span key={n} className="ta-ms-h">
                  {ASSIST_COPY.absent}
                </span>
              ) : (
                <button
                  key={n}
                  type="button"
                  aria-label={ASSIST_COPY.candidateAria(n, k)}
                  aria-pressed={bets[k].has(n)}
                  onClick={() => onToggle(k, n)}
                >
                  <BoatBadge n={n} size="sm" />
                </button>
              ),
            )}
          </div>
        ))}
      </div>
      <p className="ta-sheet-sub ta-num">{points}点</p>
      {removedNote && <p className="ta-warn">{removedNote}</p>}
      <BetSummary {...summary} />
    </BottomSheet>
  );
}
