import BaseBar from "./BaseBar";
import { ROUND_LABEL } from "../../../utils/assistModel";
import { ASSIST_COPY } from "../../../data/thinkingAssistCopy";

/** RoughSheet の1号艇の1着の節。出力は元の RoughSheet のまま */
export function RoughSheetB1Section({
  scope,
  similar,
  similarFailed,
  ic,
  scopeLabel,
  simLabel,
  baseB1,
  refB1,
}) {
  const c = scope.cell;
  return (
    <>
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
      {ic?.round && ROUND_LABEL[ic.round] && (
        <p className="ta-note" data-testid="rough-sheet-in-caution-round">
          {ASSIST_COPY.roughRoundBaseNote(ROUND_LABEL[ic.round])}
        </p>
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
    </>
  );
}

/** RoughSheet の万舟の節と末尾の注記。出力は元の RoughSheet のまま */
export function RoughSheetManshuSection({
  scope,
  similar,
  racecardStage,
  venue,
  scopeLabel,
  simLabel,
  baseM,
  refB1,
  refM,
}) {
  const c = scope.cell;
  return (
    <>
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
    </>
  );
}
