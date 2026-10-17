import BottomSheet from "./BottomSheet";
import BaseBar from "./BaseBar";
import ScopeTable from "./ScopeTable";
import ClassLineup from "./ClassLineup";
import {
  ROUND_LABEL,
  restClassCounts,
  sameClassLabel,
} from "../../../utils/assistModel";
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
      <h3 className="ta-sheet-sub">{ASSIST_COPY.roughB1}</h3>
      {ic ? (
        <BaseBar
          label={`${ASSIST_COPY.roughScopeInCaution(ic.n, ROUND_LABEL[ic.round] ?? null)}${ic.lowSample ? `・${ASSIST_COPY.roughFew}` : ""}`}
          k={ic.n - ic.nonWin}
          n={ic.n}
          base={baseB1}
          refRate={refB1}
          showBase
          few={Boolean(ic.lowSample)}
        />
      ) : (
        <BaseBar
          label={scopeLabel}
          k={c.b1_win}
          n={c.n}
          base={baseB1}
          refRate={refB1}
          showBase
          few={scope.few}
        />
      )}
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
