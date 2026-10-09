import { ROUND_LABEL } from "../../../utils/assistModel";
import { ASSIST_COPY as C } from "../../../data/thinkingAssistCopy";

/** 差がつく材料の札（1着。▲＝今日6艇で一番良い／悪い） */
export default function FactChips({ chips, base, round }) {
  return (
    <div className="ta-chips">
      {chips.map((c) => {
        const word = C.factWords[c.bucket === 6 ? c.bad : c.good];
        return (
          <div
            key={c.key}
            className={`ta-chip${c.hit ? " ta-chip-hit" : " ta-chip-off"}`}
          >
            <b>{C.factNames[c.key]}</b>
            <span className="ta-num">
              {c.hit
                ? C.factHit(word, Math.round(c.rate * 100), base)
                : c.off
                  ? C.factFinalOff(ROUND_LABEL[round] ?? "")
                  : c.bucket
                    ? C.factRank(c.bucket)
                    : "—"}
            </span>
          </div>
        );
      })}
    </div>
  );
}
