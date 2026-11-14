import BottomSheet from "./BottomSheet";
import RoughSheetIntro from "./RoughSheetIntro";
import { RoughSheetB1Section, RoughSheetManshuSection } from "./RoughSheetBars";
import { sameClassLabel } from "../../../utils/assistModel";
import { ASSIST_COPY } from "../../../data/thinkingAssistCopy";

/**
 * 堅い？荒れる？の材料のシート（TC-R1、FW-22）。1号艇の1着と万舟を、全国・級の並びが同じと類似レースで、
 * 全国の全レースと比べる（基準つきバー、D-21）。決めつけない
 * 会場の全レースは参考の細い点線と末尾の1行（FR-2、承認モック v7 の rough()）
 * BOA-822: inCaution（機能フラグの側だけ渡す）があれば、1号艇の1着の1本目を勝率差が同じくらいのレースにする
 * @param {{scope: object, national: object, similar: object|null, similarFailed: boolean, venueAll: object|null, venueName: string|null, racecardStage: boolean, lineup: object[]|null, classes: string[]|null, inCaution?: object|null, onClose: () => void}} props
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
  inCaution = null,
  onClose,
}) {
  const c = scope.cell;
  // BOA-822（機能フラグの側、FR-4）: 1着の1本目は勝率差が同じくらいのレース（注意度の裏返し）。
  // 基準の点線も注意度の基準の裏返しにし、カードの1着のバーと同じ物差しにする
  const ic =
    typeof inCaution?.pct === "number" && inCaution.n ? inCaution : null;
  const baseB1 = ic ? (100 - ic.basePct) / 100 : national.b1_win / national.n;
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
      <RoughSheetIntro
        scope={scope}
        similar={similar}
        venue={venue}
        lineup={lineup}
        classes={classes}
        similarConditions={similarConditions}
        ic={ic}
      />
      <RoughSheetB1Section
        scope={scope}
        similar={similar}
        similarFailed={similarFailed}
        ic={ic}
        scopeLabel={scopeLabel}
        simLabel={simLabel}
        baseB1={baseB1}
        refB1={refB1}
      />
      <RoughSheetManshuSection
        scope={scope}
        similar={similar}
        racecardStage={racecardStage}
        venue={venue}
        scopeLabel={scopeLabel}
        simLabel={simLabel}
        baseM={baseM}
        refB1={refB1}
        refM={refM}
      />
      <p className="ta-note">{ASSIST_COPY.roughNoPick}</p>
    </BottomSheet>
  );
}
