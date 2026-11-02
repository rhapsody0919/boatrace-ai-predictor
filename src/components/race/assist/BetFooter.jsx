import {
  assistBetType,
  betForm,
  compositeText,
} from "../../../utils/assistModel";
import { ASSIST_COPY } from "../../../data/thinkingAssistCopy";
import { useCookieBannerHeight } from "../../../hooks/useCookieBannerHeight";

/**
 * 固定フッター（FR-7、screens S-1 F）。買い目の要約（頭に券種の名前。BOA-990）・点数・合成オッズ（理論値）。押すとマークシート
 * ガイドの①〜④の間は隠す（光らせた場所に重ならないように。screens S-1c）
 * @param {{bets: object, betType?: string, points: number, composite: number|null, oddsNote: string, removedNote: string|null, onOpen: () => void, hidden?: boolean}} props
 */
export default function BetFooter({
  bets,
  betType = "trifecta",
  points,
  priced = points,
  composite,
  oddsNote,
  removedNote,
  onOpen,
  hidden = false,
}) {
  // 未同意の利用者では、サイト共通の Cookie の同意バナーがフッターを覆うのでその上に出す
  const bannerHeight = useCookieBannerHeight();
  const c = compositeText(composite);
  const type = assistBetType(betType);
  return (
    <section
      className="ta-foot"
      aria-label={ASSIST_COPY.betRegion}
      data-guide="foot"
      style={{
        bottom: bannerHeight,
        ...(hidden ? { visibility: "hidden" } : null),
      }}
    >
      <div className="ta-foot-text">
        {/* 「（9点）」を折らない（375px で数字と単位が別の行に分かれた。ファン評価1周目 指摘3） */}
        <b className="ta-num">
          {`${ASSIST_COPY.betTypeLabels[type.id]} ${betForm(bets, type.legs, type.ordered)}`}
          <span className="ta-nowrap">
            {priced < points
              ? `（${points}点・オッズあり${priced}点）`
              : `（${points}点）`}
          </span>
        </b>
        <span className="ta-num">
          {points === 0
            ? ASSIST_COPY.betEmptyFor(type.legs, type.ordered)
            : c
              ? ASSIST_COPY.composite(c)
              : type.range && priced > 0
                ? ASSIST_COPY.wideFoot
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
