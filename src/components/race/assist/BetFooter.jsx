import { betForm, compositeText } from "../../../utils/assistModel";
import { ASSIST_COPY } from "../../../data/thinkingAssistCopy";

/**
 * 固定フッター（FR-7、screens S-1 F）。買い目の要約・点数・合成オッズ（理論値）。押すとマークシート
 * ガイドの①〜④の間は隠す（光らせた場所に重ならないように。screens S-1c）
 * @param {{bets: object, points: number, composite: number|null, oddsNote: string, removedNote: string|null, onOpen: () => void, hidden?: boolean}} props
 */
export default function BetFooter({
  bets,
  points,
  composite,
  oddsNote,
  removedNote,
  onOpen,
  hidden = false,
}) {
  const c = compositeText(composite);
  return (
    <section
      className="ta-foot"
      aria-label={ASSIST_COPY.betRegion}
      data-guide="foot"
      style={hidden ? { visibility: "hidden" } : undefined}
    >
      <div className="ta-foot-text">
        <b className="ta-num">{ASSIST_COPY.betLabel(betForm(bets), points)}</b>
        <span className="ta-num">
          {points === 0
            ? ASSIST_COPY.betEmpty
            : c
              ? ASSIST_COPY.composite(c)
              : oddsNote}
        </span>
        {removedNote && <span className="ta-warn">{removedNote}</span>}
      </div>
      <button type="button" onClick={onOpen}>
        {ASSIST_COPY.openSheet}
      </button>
    </section>
  );
}
