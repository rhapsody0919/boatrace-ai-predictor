import BottomSheet from "./BottomSheet";
import BetSummary from "./BetSummary";
import BetTypeTabs from "./BetTypeTabs";
import BoatBadge from "../BoatBadge";
import { assistBetType } from "../../../utils/assistModel";
import { ASSIST_COPY } from "../../../data/thinkingAssistCopy";

/**
 * マークシート（screens S-1a）: 1着・2着・3着 × 1〜6 のマス。押すと候補に入る／外れる。
 * 欠場の艇のマスは出さない（D-38）。下に配分（BetSummary）。
 * 上に券種のタブ（BOA-990、承認モック 画面2・3）。2連単は3着の段を薄く残して押せなくする（入れた候補は残す）。
 * 近道「選んだ艇でボックス」と、押した直後の「元に戻す」
 */
export default function MarkSheet({
  bets,
  absentBoats,
  onToggle,
  onClose,
  points,
  removedNote,
  onBetType,
  onBox,
  onUndoBox,
  canUndoBox = false,
  ...summary
}) {
  const type = assistBetType(summary.betType);
  const typeLabel = ASSIST_COPY.betTypeLabels[type.id];
  const picked = new Set(
    [1, 2, 3].slice(0, type.legs).flatMap((k) => [...bets[k]]),
  );
  return (
    <BottomSheet title={ASSIST_COPY.sheetTitle} onClose={onClose}>
      <BetTypeTabs betType={type.id} onBetType={onBetType} />
      <div className="ta-ms">
        {[1, 2, 3].map((k) => {
          const unused = k > type.legs;
          return (
            <div
              key={k}
              className={unused ? "ta-ms-row is-unused" : "ta-ms-row"}
              style={{ display: "contents" }}
            >
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
                    disabled={unused}
                    onClick={() => onToggle(k, n)}
                  >
                    <BoatBadge n={n} size="sm" />
                  </button>
                ),
              )}
            </div>
          );
        })}
      </div>
      {type.legs < 3 && (
        <p className="ta-note">{ASSIST_COPY.legUnused(typeLabel)}</p>
      )}
      <div className="ta-box-short">
        <button type="button" disabled={picked.size < 2} onClick={onBox}>
          {ASSIST_COPY.boxButton}
        </button>
        {canUndoBox && (
          <button type="button" onClick={onUndoBox}>
            {ASSIST_COPY.boxUndo}
          </button>
        )}
      </div>
      <p className="ta-note">{ASSIST_COPY.boxNote}</p>
      <p className="ta-sheet-sub ta-num">{points}点</p>
      {removedNote && <p className="ta-warn">{removedNote}</p>}
      <BetSummary {...summary} />
    </BottomSheet>
  );
}
