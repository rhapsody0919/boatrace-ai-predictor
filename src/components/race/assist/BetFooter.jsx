import { betForm, compositeText } from "../../../utils/assistModel";
import { ASSIST_COPY } from "../../../data/thinkingAssistCopy";

/**
 * 固定フッター（FR-7、screens S-1 F）。買い目の要約・点数・合成オッズ（理論値）。押すとマークシート
 * @param {{bets: object, points: number, composite: number|null, hidden?: boolean, onOpen: () => void}} props
 */
export default function BetFooter({ bets, points, composite, onOpen }) {
  const c = compositeText(composite);
  return (
    <section className="ta-foot" aria-label={ASSIST_COPY.betRegion}>
      <div className="ta-foot-text">
        <b className="ta-num">{ASSIST_COPY.betLabel(betForm(bets), points)}</b>
        <span className="ta-num">
          {points === 0
            ? ASSIST_COPY.betEmpty
            : c
              ? ASSIST_COPY.composite(c)
              : ASSIST_COPY.oddsNone}
        </span>
      </div>
      <button type="button" onClick={onOpen}>
        {ASSIST_COPY.openSheet}
      </button>
    </section>
  );
}
