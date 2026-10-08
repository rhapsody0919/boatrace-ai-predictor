import { useId } from "react";
import {
  STAKE_UNIT,
  allocateStakes,
  popularityRanks,
} from "../../../utils/oddsMath";
import { compositeText, hasPricedTicket } from "../../../utils/assistModel";
import { ASSIST_COPY } from "../../../data/thinkingAssistCopy";

const yen = (n) => n.toLocaleString("ja-JP");

/**
 * 組んだ買い目の配分（FR-8、screens S-1a）: 予算・均等／均等払戻・組ごとのオッズ・人気・金額・払戻、
 * 最下行に合計・残り・丸めた後の倍率の幅。予算が 100円×点数 に足りなければ最低額だけを出す（F05）
 */
export default function BetSummary({
  tickets,
  trifecta,
  budget,
  mode,
  oddsAt,
  oddsNote,
  onBudget,
  onMode,
}) {
  const budgetId = useId();
  const ranks = popularityRanks(trifecta);
  // オッズの付いた組が無い（発売前）ときは配分を出さない（screens「状態」）
  const priced = hasPricedTicket(tickets, trifecta);
  const result = priced
    ? allocateStakes({ tickets, trifecta, budget: Number(budget), mode })
    : null;
  const composite = result && !result.insufficient ? result.composite : null;
  return (
    <div className="ta-bar">
      <div className="ta-calc">
        <label htmlFor={budgetId}>{ASSIST_COPY.budget}（円）</label>
        <input
          id={budgetId}
          type="number"
          inputMode="numeric"
          min="100"
          step="100"
          value={budget}
          onChange={(e) => onBudget(e.target.value)}
        />
        <span
          className="ta-radio"
          role="radiogroup"
          aria-label={ASSIST_COPY.allocation}
        >
          {[
            ["equalPayout", ASSIST_COPY.modeEqualPayout],
            ["equal", ASSIST_COPY.modeEqual],
          ].map(([value, label]) => (
            <label key={value}>
              <input
                type="radio"
                name={`${budgetId}-mode`}
                value={value}
                checked={mode === value}
                onChange={() => onMode(value)}
              />
              {label}
            </label>
          ))}
        </span>
      </div>
      {!tickets.length && <p className="ta-note">{ASSIST_COPY.betEmpty}</p>}
      {tickets.length > 0 && !priced && <p className="ta-note">{oddsNote}</p>}
      {result?.insufficient && (
        <p className="ta-warn">
          {ASSIST_COPY.minimum(result.minimum / STAKE_UNIT, result.minimum)}
        </p>
      )}
      {composite != null && composite < 1 && (
        <p className="ta-warn">{ASSIST_COPY.trigamiLine}</p>
      )}
      {result && !result.insufficient && (
        <table className="ta-table">
          <thead>
            <tr>
              <th scope="col">{ASSIST_COPY.colTicket}</th>
              <th scope="col">{ASSIST_COPY.colOdds}</th>
              <th scope="col">{ASSIST_COPY.colPopularity}</th>
              <th scope="col">{ASSIST_COPY.colStake}</th>
              <th scope="col">{ASSIST_COPY.colPayout}</th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map((r) => {
              const tg = r.payout < result.total;
              return (
                <tr key={r.ticket}>
                  <td className="ta-num">{r.ticket}</td>
                  <td className="ta-num">{r.odds}</td>
                  <td className="ta-num">
                    {ASSIST_COPY.popularity(ranks.get(r.ticket))}
                  </td>
                  <td className="ta-num">{yen(r.stake)}</td>
                  <td className={`ta-num${tg ? " ta-warn" : ""}`}>
                    {yen(r.payout)}
                    {tg ? ` ${ASSIST_COPY.trigami}` : ""}
                  </td>
                </tr>
              );
            })}
            <tr>
              <td
                colSpan={5}
                className="ta-num"
                style={{ textAlign: "left", whiteSpace: "normal" }}
              >
                <b>
                  {ASSIST_COPY.totalLine(
                    result.total,
                    result.remainder,
                    result.multiplier.min.toFixed(2),
                    result.multiplier.max.toFixed(2),
                  )}
                </b>
              </td>
            </tr>
          </tbody>
        </table>
      )}
      {result?.missing.length > 0 && (
        <p className="ta-note">
          {ASSIST_COPY.missingOdds(result.missing.length)}
        </p>
      )}
      {composite != null && (
        <p className="ta-note ta-num">
          {ASSIST_COPY.composite(compositeText(composite))}（
          {ASSIST_COPY.compositeNote}）
        </p>
      )}
      {oddsAt && <p className="ta-note">{ASSIST_COPY.oddsCaution(oddsAt)}</p>}
    </div>
  );
}
