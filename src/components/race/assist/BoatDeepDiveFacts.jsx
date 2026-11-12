import ClassLineup from "./ClassLineup";
import FactChips from "./FactChips";
import Fold from "./Fold";
import { classLineup } from "../../../utils/assistModel";
import { factsScopeLabel } from "../../../utils/assistSummary";
import { ASSIST_COPY as C } from "../../../data/thinkingAssistCopy";
import { FACT_ITEMS } from "../../../utils/analogyFacts";
import { TermButton } from "./SheetButtons";

/** 全部の材料の並び（項目の決まった順。龍神ソナーの差がつく材料と同じ項目の順。BOA-804） */
const FACT_ORDER = FACT_ITEMS.map((it) => it.key);

/** 先頭の▲の材料 */
export function TopFacts({ boat, topChips, scopeLabel, base, round, target }) {
  return (
    <div className="ta-deep-facts">
      {/* 用語の「?」は軸の要約の箱から移した（案D） */}
      <div className="ta-h3-row">
        <h4>{C.factsHeading(boat)}</h4>
        <TermButton term="差がつく材料" />
      </div>
      <div className="ta-legend">
        <span className="ta-scopechip ta-num">{scopeLabel}</span>
        <span>{C.factsLegend}</span>
      </div>
      <FactChips
        chips={topChips}
        base={base}
        round={round}
        boat={boat}
        target={target}
      />
      <p className="ta-note">{C.factsNotCause}</p>
    </div>
  );
}

/** 残りの材料（全部）。畳む（ユーザー決定 A） */
export function AllFacts({
  boat,
  chips,
  today,
  scope,
  venue,
  post,
  counts,
  i,
  scopeLabel,
  base,
  round,
  target,
  openAll,
  allRef,
}) {
  return (
    <Fold title={C.factsAll(boat)} defaultOpen={openAll} ref={allRef}>
      <div className="ta-deep-facts">
        <ClassLineup lineup={classLineup(today?.classes, boat)} />
        {counts && (
          <p className="ta-note">
            {C.classNote(
              boat,
              today.classes[i],
              counts,
              factsScopeLabel(scope, venue),
            )}
          </p>
        )}
        <div className="ta-legend">
          <span className="ta-scopechip ta-num">{scopeLabel}</span>
          <span>{C.factsLegend}</span>
        </div>
        {/* 全部の材料は、どの艇でも同じ並び（項目の決まった順）。艇を切り替えて比べやすくする（BOA-804）。
            先頭の▲の材料は差の大きい順のまま（ユーザー決定 A） */}
        <FactChips
          chips={[...chips].sort(
            (a, b) => FACT_ORDER.indexOf(a.key) - FACT_ORDER.indexOf(b.key),
          )}
          base={base}
          round={round}
          boat={boat}
          target={target}
        />
        <p className="ta-note">{C.factsNotCause}</p>
        {/* 軸の要約の箱から移した注記（案D） */}
        {!post && <p className="ta-note">{C.factsPreExhibition}</p>}
      </div>
    </Fold>
  );
}
