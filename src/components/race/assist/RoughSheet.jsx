import BottomSheet from "./BottomSheet";
import BaseBar from "./BaseBar";
import ScopeTable from "./ScopeTable";
import ClassLineup from "./ClassLineup";
import { restClassCounts, sameClassLabel } from "../../../utils/assistModel";
import { ASSIST_COPY } from "../../../data/thinkingAssistCopy";

/**
 * 堅い？荒れる？の材料のシート（TC-R1、FW-22）。1号艇の1着と万舟を、全国・級の並びが同じと類似レースで、
 * 全国の全レースと比べる（基準つきバー、D-21）。決めつけない
 * 会場の全レースは参考の細い点線と末尾の1行（FR-2、承認モック v7 の rough()）
 * @param {{scope: object, national: object, similar: object|null, similarFailed: boolean, venueAll: object|null, venueName: string|null, racecardStage: boolean, lineup: object[]|null, classes: string[]|null, onClose: () => void}} props
 */
export default function RoughSheet({
  scope,
  national,
  similar,
  similarFailed,
  venueAll,
  venueName,
  racecardStage,
  lineup,
  classes,
  similarConditions = null,
  onClose,
}) {
  const c = scope.cell;
  const baseB1 = national.b1_win / national.n;
  const baseM = national.manshu / national.payout_known;
  const venue =
    venueAll?.n && venueAll.payout_known && venueName ? venueName : null;
  const refB1 = venue ? venueAll.b1_win / venueAll.n : null;
  const refM = venue ? venueAll.manshu / venueAll.payout_known : null;
  const scopeLabel = `${sameClassLabel(scope)} ${c.n.toLocaleString("ja-JP")}件${scope.few ? `・${ASSIST_COPY.roughFew}` : ""}`;
  const simLabel = similar
    ? ASSIST_COPY.similarLabel(similar.n, similar.allInLayer)
    : null;
  return (
    <BottomSheet title={ASSIST_COPY.roughTitle} onClose={onClose}>
      <p className="ta-sheet-sub">{ASSIST_COPY.roughSheetLead}</p>
      <p className="ta-note">
        {venue ? ASSIST_COPY.baseLegendRef(venue) : ASSIST_COPY.baseLegend}
        {/* 棒の中の2本の細い縦線（ぶれ幅）の説明（BOA-801 4。セオリーカードと同じ文） */}
        、{ASSIST_COPY.theoryBarLegend}
      </p>
      <ClassLineup lineup={lineup} />
      {restClassCounts(classes) && (
        <p className="ta-note">
          {ASSIST_COPY.classNote(1, classes[0], restClassCounts(classes))}
        </p>
      )}
      <ScopeTable
        scope={scope}
        similarN={similar?.n ?? null}
        similarConditions={similarConditions}
        classes={classes}
        lineup={lineup}
      />
      <h3 className="ta-sheet-sub">{ASSIST_COPY.roughB1}</h3>
      <BaseBar
        label={scopeLabel}
        k={c.b1_win}
        n={c.n}
        base={baseB1}
        refRate={refB1}
        showBase
        few={scope.few}
      />
      {similar && (
        <BaseBar
          label={simLabel}
          k={similar.win[0]}
          n={similar.n}
          base={baseB1}
          refRate={refB1}
          showBase
        />
      )}
      {similarFailed && (
        <p className="ta-note">
          {ASSIST_COPY.partFailed(ASSIST_COPY.partSimilar)}
        </p>
      )}
      <h3 className="ta-sheet-sub">
        {ASSIST_COPY.roughManshu}（3連単1万円以上）
      </h3>
      <BaseBar
        label={scopeLabel}
        k={c.manshu}
        n={c.payout_known}
        base={baseM}
        refRate={refM}
        showBase
        few={scope.few}
      />
      {similar && (
        <BaseBar
          label={simLabel}
          k={similar.manshu.k}
          n={similar.manshu.n}
          base={baseM}
          refRate={refM}
          showBase
        />
      )}
      {similar && racecardStage && (
        <p className="ta-note">{ASSIST_COPY.similarRacecardStage}</p>
      )}
      {venue && (
        <p className="ta-note ta-num">
          {ASSIST_COPY.venueAll(
            venue,
            Math.round(refB1 * 100),
            Math.round(refM * 100),
          )}
        </p>
      )}
      <p className="ta-note">{ASSIST_COPY.roughNoPick}</p>
    </BottomSheet>
  );
}
