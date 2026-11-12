/**
 * RaceResult の払戻の節（見出し・払戻表・注記）。
 * RaceResult.jsx から移しただけで、描く DOM・文言は変えない。表そのもの（PayoutRowsTable）は
 * 循環 import を避けるため children で受け取る。
 */
import { PAYOUT_BET_TYPES, PAYOUT_STATUS } from "../../utils/raceOutcome";

function PartialVoidNote({ partialVoid, t }) {
  return (
    <p className="rr-note rr-payout-void-note">
      {t(
        partialVoid.kind === "starters"
          ? "result.partialVoidByStarters"
          : "result.partialVoidByFinishers",
        {
          count: partialVoid.count,
          types: partialVoid.betTypes
            .map((betType) =>
              t(
                `result.payoutType.${PAYOUT_BET_TYPES.find((b) => b.betType === betType).typeKey}`,
              ),
            )
            .join(t("result.noRace.boatSeparator")),
        },
      )}
    </p>
  );
}

export function RaceResultPayoutSection({
  payoutRows,
  partialVoid,
  hasFinalOddsPopularity,
  t,
  children,
}) {
  return (
    <>
      <div className="rr-section-title">{t("result.payoutSectionTitle")}</div>
      {children}
      {/* 一部の勝式だけ不成立になった理由を、事実だけ1行で書く。払戻明細の不成立が
          正常スタート・完走の艇数から決まる表と一致するときだけ出す（BOA-558） */}
      {partialVoid && <PartialVoidNote partialVoid={partialVoid} t={t} />}
      {/* 単勝・複勝の人気だけは公式の発表でなく締切時オッズから出しているため、その旨を書く */}
      {hasFinalOddsPopularity && (
        <p
          className="rr-note rr-payout-popularity-note"
          data-testid="payout-popularity-note"
        >
          {t("result.popularityFromFinalOddsNote")}
        </p>
      )}
      {/* 「—」の意味は title だけだとスマホで読めないので、表の下にも書く（#1074 ファン評価1周目） */}
      {payoutRows.some((row) => row.status === PAYOUT_STATUS.NO_AMOUNT) && (
        <p className="rr-note rr-payout-no-amount-note">
          {t("result.payoutNoAmountNote")}
        </p>
      )}
    </>
  );
}
