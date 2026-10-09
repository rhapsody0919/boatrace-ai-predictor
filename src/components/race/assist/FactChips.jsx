import { ROUND_LABEL } from "../../../utils/assistModel";
import { ASSIST_COPY as C } from "../../../data/thinkingAssistCopy";
import { TheoryButton } from "./SheetButtons";

/**
 * 差がつく材料の札（1着。▲＝今日6艇で一番上か一番下）。押すとセオリーカード（TC-F）で、
 * 一番良いとき・一番悪いときの割合と件数が出る。札には件数と差の大きさを添える（BOA-808 の3）
 */
export default function FactChips({ chips, base, round, boat }) {
  return (
    <div className="ta-chips">
      {chips.map((c) => {
        const word = C.factWords[c.bucket === 6 ? c.bad : c.good];
        return (
          <TheoryButton
            key={c.key}
            id={`TC-F:${boat}:${c.key}`}
            name={C.theoryFactTitle(C.factNames[c.key], boat)}
            boat={boat}
            className={`ta-chip${c.hit ? " ta-chip-hit" : " ta-chip-off"}`}
          >
            <b>{C.factNames[c.key]}</b>
            <span className="ta-num">
              {c.hit
                ? C.factHit(word, Math.round(c.rate * 100), c.pair[1], base)
                : c.off
                  ? C.factFinalOff(ROUND_LABEL[round] ?? "")
                  : c.bucket
                    ? C.factRank(c.bucket)
                    : "—"}
            </span>
            {C.factLevel[c.level] && (
              <span className="ta-chip-level">{C.factLevel[c.level]} ›</span>
            )}
          </TheoryButton>
        );
      })}
    </div>
  );
}
