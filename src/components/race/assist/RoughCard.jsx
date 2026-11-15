import { useId } from "react";
import RoughCardButton from "./RoughCardButton";
import RoughCardNotes from "./RoughCardNotes";
import { ROUND_LABEL, restClassCounts } from "../../../utils/assistModel";
import { ASSIST_COPY } from "../../../data/thinkingAssistCopy";
import { trackEvent } from "../../../utils/analytics";
import { useVisibleOnce } from "../../../hooks/useVisibleOnce";
import { cautionVisibleEvent } from "../../../utils/cautionEvents";

/**
 * 「このレースは堅い？荒れる？」の枠（FW-22、screens S-1 A）。2本の小さいバー（1号艇の1着・万舟）と
 * 級の並びの絵＋件数。押すと材料のシート（TC-R1）
 * 枠の下に、呼び名「全国・級の並びが同じ」の今日の値の例と注記（2026-10-08 ユーザー決定）
 * BOA-822（inCautionMode、機能フラグの側）: 1着のバーはイン崩れ注意度の裏返し（rough.inCaution、roughWithInCaution）。
 * 1着と万舟で数えた範囲が違うので、件数は行ごとに範囲の名前と並べ、枠の下に裏返しの1行（承認モック mock/4-assist-375.png (a)）
 * @param {{rough: object|null, scope: object|null, lineup: object[]|null, classes: string[]|null, status: string, onOpen: () => void, inCautionMode?: boolean}} props
 */
export default function RoughCard({
  rough,
  scope,
  lineup,
  classes,
  status,
  onOpen,
  inCautionMode = false,
  raceId = null,
}) {
  const counts = restClassCounts(classes);
  const titleId = useId();
  const round = scope?.kind === "NCR" ? ROUND_LABEL[scope.round] : null;
  const classScope =
    rough &&
    ASSIST_COPY.roughScopeClass(scope.cell.n, round);
  const ic = rough?.inCaution ?? null;
  // 注意度の裏返しの1着のバーが画面に入ったら、レースごとに1回 caution_visible（BOA-822 task 27、assist_rough）
  const visibleRef = useVisibleOnce(
    inCautionMode && ic && raceId ? `assist_rough|${raceId}` : null,
    () => {
      const ev = cautionVisibleEvent({
        surface: "assist_rough",
        raceId,
        inCaution: ic,
      });
      if (ev) trackEvent(ev.name, ev.params);
    },
  );
  const b1Scope = ic
    ? `${ic.lowSample ? `${ASSIST_COPY.roughFew}・` : ""}${ASSIST_COPY.roughScopeInCaution(ic.n, ic.round)}`
    : classScope;
  return (
    <section
      className="ta-rough"
      aria-labelledby={titleId}
      data-guide="rough"
      ref={visibleRef}
    >
      <h2 className="ta-rough-title" id={titleId}>
        {ASSIST_COPY.roughTitle}
      </h2>
      {rough && (
        <RoughCardButton
          rough={rough}
          scope={scope}
          lineup={lineup}
          round={round}
          onOpen={onOpen}
          inCautionMode={inCautionMode}
          b1Scope={b1Scope}
          classScope={classScope}
        />
      )}
      <RoughCardNotes
        rough={rough}
        scope={scope}
        classes={classes}
        counts={counts}
        status={status}
        inCautionMode={inCautionMode}
        ic={ic}
      />
    </section>
  );
}
