import BottomSheet from "./BottomSheet";
import BaseBar from "./BaseBar";
import ScopeTable from "./ScopeTable";
import ClassLineup from "./ClassLineup";
import { sameClassLabel } from "../../../utils/assistModel";
import { ASSIST_COPY } from "../../../data/thinkingAssistCopy";

/**
 * 堅い？荒れる？の材料のシート（TC-R1、FW-22）。1号艇の1着と万舟を、全国・級の並びが同じと類似レースで、
 * 全国の全レースと比べる（基準つきバー、D-21）。決めつけない
 * @param {{scope: object, national: object, similar: object|null, similarAll: boolean, racecardStage: boolean, lineup: object[]|null, classes: string[]|null, onClose: () => void}} props
 */
export default function RoughSheet({
  scope,
  national,
  similar,
  racecardStage,
  lineup,
  classes,
  onClose,
}) {
  const c = scope.cell;
  const baseB1 = national.b1_win / national.n;
  const baseM = national.manshu / national.payout_known;
  const scopeLabel = `${sameClassLabel(scope)} ${c.n.toLocaleString("ja-JP")}件${scope.few ? `・${ASSIST_COPY.roughFew}` : ""}`;
  const simLabel = similar
    ? ASSIST_COPY.similarLabel(similar.n, similar.allInLayer)
    : null;
  return (
    <BottomSheet title={ASSIST_COPY.roughTitle} onClose={onClose}>
      <p className="ta-sheet-sub">{ASSIST_COPY.roughSheetLead}</p>
      <p className="ta-note">{ASSIST_COPY.baseLegend}</p>
      <ClassLineup lineup={lineup} />
      <ScopeTable
        scope={scope}
        similarN={similar?.n ?? null}
        classes={classes}
      />
      <h3 className="ta-sheet-sub">{ASSIST_COPY.roughB1}</h3>
      <BaseBar
        label={scopeLabel}
        k={c.b1_win}
        n={c.n}
        base={baseB1}
        few={scope.few}
      />
      {similar && (
        <BaseBar
          label={simLabel}
          k={similar.win[0]}
          n={similar.n}
          base={baseB1}
        />
      )}
      <h3 className="ta-sheet-sub">
        {ASSIST_COPY.roughManshu}（3連単1万円以上）
      </h3>
      <BaseBar
        label={scopeLabel}
        k={c.manshu}
        n={c.payout_known}
        base={baseM}
        few={scope.few}
      />
      {similar && (
        <BaseBar
          label={simLabel}
          k={similar.manshu.k}
          n={similar.manshu.n}
          base={baseM}
        />
      )}
      {similar && racecardStage && (
        <p className="ta-note">{ASSIST_COPY.similarRacecardStage}</p>
      )}
      <p className="ta-note">{ASSIST_COPY.roughNoPick}</p>
    </BottomSheet>
  );
}
