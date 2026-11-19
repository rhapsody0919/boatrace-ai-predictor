/**
 * RaceResult の配当の表の行（RaceResult.jsx から字のまま移した。越えの単位を割るため）
 */

import { BoatChip } from "./RaceResultTable";

import {
  PAYOUT_STATUS,
  isPayoutAmountCountable,
} from "../../utils/raceOutcome";

function PayoutCombo({ note, boats, separator }) {
  return (
    <span className="rr-combo">
      {note ? (
        <span className="rr-payout-note">{note}</span>
      ) : (
        boats.map((boat, index) => (
          <span className="rr-combo-item" key={`${boat}-${index}`}>
            {index > 0 && <span className="sep">{separator}</span>}
            <BoatChip number={boat} />
          </span>
        ))
      )}
    </span>
  );
}

function PayoutAmount({ amount, noAmount, t }) {
  return (
    <span
      className="rr-amount num"
      title={noAmount ? t("result.payoutNoAmount") : undefined}
    >
      {typeof amount === "number"
        ? `¥${amount.toLocaleString()}`
        : noAmount
          ? "—"
          : ""}
    </span>
  );
}

function PayoutPopularity({ popularity, popularityTo, popularityMarked, t }) {
  return (
    <span className="rr-pop">
      {popularity
        ? popularityTo
          ? t("result.popularityRange", {
              from: popularity,
              to: popularityTo,
            })
          : t("result.popularity", { rank: popularity })
        : ""}
      {popularity && popularityMarked && (
        <span className="rr-pop-mark" aria-hidden="true">
          ※
        </span>
      )}
    </span>
  );
}

function PayoutRow({
  typeLabel,
  boats,
  separator,
  amount,
  popularity,
  popularityTo = null,
  popularityMarked = false,
  isBest,
  note = null,
  isVoid = false,
  noAmount = false,
  t,
}) {
  return (
    <div
      className={`rr-payout-row${isBest ? " is-best" : ""}${isVoid ? " is-void" : ""}`}
    >
      <span className="rr-payout-type">{typeLabel}</span>
      <PayoutCombo note={note} boats={boats} separator={separator} />
      <PayoutAmount amount={amount} noAmount={noAmount} t={t} />
      <PayoutPopularity
        popularity={popularity}
        popularityTo={popularityTo}
        popularityMarked={popularityMarked}
        t={t}
      />
    </div>
  );
}

// 払戻明細（race_payouts）の行で払戻表を出す（BOA-543）。不成立は「不成立（返還）」とだけ書き、
// 金額（返還額の¥100）は出さない。特払は組番の位置に「特払」、金額なしは組番だけ。
// 最高配当の強調は、通常の払戻と特払だけで計算する
export function PayoutRowsTable({ rows, t }) {
  const amounts = rows.filter(isPayoutAmountCountable).map((row) => row.amount);
  // 最高額が ¥100（元返し）のときは強調しない。一部返還で単勝・2連単がともに ¥100 だった
  // レースで、¥100 の2行が「最高配当」として金色になっていた（BOA-558）
  const maxAmount =
    amounts.length && Math.max(...amounts) > 100 ? Math.max(...amounts) : null;
  return (
    <div className="rr-payout-table">
      {rows.map((row) => {
        const isNoRaceRow = row.status === PAYOUT_STATUS.NO_RACE;
        const isSpecial = row.status === PAYOUT_STATUS.SPECIAL;
        return (
          <PayoutRow
            key={`${row.betType}-${row.seq}`}
            typeLabel={t(`result.payoutType.${row.typeKey}`)}
            boats={row.boats}
            separator={row.separator}
            amount={isNoRaceRow ? null : row.amount}
            popularity={isNoRaceRow ? null : row.popularity}
            popularityTo={isNoRaceRow ? null : (row.popularityTo ?? null)}
            popularityMarked={!isNoRaceRow && !!row.popularityFromFinalOdds}
            isBest={
              isPayoutAmountCountable(row) &&
              maxAmount != null &&
              row.amount === maxAmount
            }
            note={
              isNoRaceRow
                ? t("result.payoutNoRace")
                : isSpecial && row.boats.length === 0
                  ? t("result.payoutSpecial")
                  : null
            }
            isVoid={isNoRaceRow}
            // 公式の払戻に金額が無い行（例: 津 2026-09-27 1R の複勝6）。空欄だとデータの
            // 欠けに見えるので「—」を出す（BOA-558）
            noAmount={row.status === PAYOUT_STATUS.NO_AMOUNT}
            t={t}
          />
        );
      })}
    </div>
  );
}
