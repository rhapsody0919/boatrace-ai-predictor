import ScopeTable from "./ScopeTable";
import ClassLineup from "./ClassLineup";
import { ROUND_LABEL, restClassCounts } from "../../../utils/assistModel";
import { ASSIST_COPY } from "../../../data/thinkingAssistCopy";

/** RoughSheet の導入部（説明・級の並び・範囲の表）。出力は元の RoughSheet のまま */
export default function RoughSheetIntro({
  scope,
  similar,
  venue,
  lineup,
  classes,
  similarConditions,
  ic,
}) {
  return (
    <>
      <p className="ta-sheet-sub">{ASSIST_COPY.roughSheetLead}</p>
      <p className="ta-note">
        {venue ? ASSIST_COPY.baseLegendRef(venue) : ASSIST_COPY.baseLegend}
        {/* 棒の中の2本の細い縦線（ぶれ幅）の説明（BOA-801 4。セオリーカードと同じ文） */}
        、{ASSIST_COPY.theoryBarLegend}
      </p>
      {/* BOA-822: 級の並びの絵は万舟の範囲（1着は勝率差で集める）。枠と同じ名前を付ける（#1604 ファン評価3周目 P2） */}
      {ic && (
        <span className="ta-rough-scope">{ASSIST_COPY.roughManshuScope}</span>
      )}
      <ClassLineup lineup={lineup} />
      {restClassCounts(classes) && (
        <p className="ta-note">
          {ASSIST_COPY.classNote(1, classes[0], restClassCounts(classes))}
        </p>
      )}
      {ic && (
        <p
          className="ta-note ta-num"
          data-testid="rough-sheet-in-caution-scope"
        >
          {ASSIST_COPY.roughInCautionScopeNote(
            ic.n,
            ROUND_LABEL[ic.round] ?? null,
          )}
        </p>
      )}
      <ScopeTable
        scope={scope}
        hideB1={Boolean(ic)}
        similarN={similar?.n ?? null}
        similarConditions={similarConditions}
        classes={classes}
        lineup={lineup}
      />
    </>
  );
}
