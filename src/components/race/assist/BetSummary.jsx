import { useId } from "react";
import {
  STAKE_UNIT,
  allocateStakes,
  formatOdds,
  popularityRanks,
} from "../../../utils/oddsMath";
import {
  assistBetType,
  compositeText,
  hasPricedTicket,
  ticketLabel,
} from "../../../utils/assistModel";
import { ASSIST_COPY } from "../../../data/thinkingAssistCopy";

const yen = (n) => n.toLocaleString("ja-JP");

/**
 * 組んだ買い目の配分（FR-8、screens S-1a）: 予算・均等／均等払戻・組ごとのオッズ・人気・金額・払戻、
 * 最下行に合計・残り・丸めた後の倍率の幅。予算が 100円×点数 に足りなければ最低額だけを出す（F05）。
 * 類似レースがあれば組ごとの件数の列「類似」を並べる（FW-19。オッズと掛け合わせない）。類似の列は3連単だけ
 * （BOA-990。ほかの券種は BOA-1171 の答えまで出さない）。オッズ・人気は選んでいる券種の値（odds）。
 * 拡連複（BOA-990 ③、承認モック 画面2）は odds が下限の表、oddsRange が公式の幅。オッズの列は「下限〜上限」、
 * 払戻・トリガミ・人気・倍率は下限で「その組だけ当たったとき」。合成オッズとその1行は出さない
 */
export default function BetSummary({
  tickets,
  odds,
  oddsRange = null,
  betType = "trifecta",
  oddsFinal = false,
  oddsFinalFailed = false,
  budget,
  mode,
  oddsAt,
  oddsNote,
  finished,
  onBudget,
  onMode,
  similarTri = null,
  similarN = null,
}) {
  const type = assistBetType(betType);
  const typeLabel = ASSIST_COPY.betTypeLabels[type.id];
  const showSimilar =
    type.id === "trifecta" && similarTri != null && similarN > 0;
  const budgetId = useId();
  const ranks = popularityRanks(odds);
  // オッズの付いた組が無い（発売前）ときは配分を出さない（screens「状態」）
  const priced = hasPricedTicket(tickets, odds);
  const result = priced
    ? allocateStakes({ tickets, odds, budget: Number(budget), mode })
    : null;
  const wide = type.range === true;
  // 拡連複は同じレースで最大3組が当たるので、合成オッズの式（どれか1組だけ当たる前提）が当てはまらない
  const composite =
    result && !result.insufficient && !wide ? result.composite : null;
  const oddsCell = (r) => {
    const w = wide ? oddsRange?.[r.ticket] : null;
    return w?.high != null
      ? ASSIST_COPY.oddsRange(formatOdds(w.low), formatOdds(w.high))
      : r.odds;
  };
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
      {!tickets.length && (
        <p className="ta-note">
          {ASSIST_COPY.betEmptyFor(type.legs, type.ordered)}
        </p>
      )}
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
              {showSimilar && <th scope="col">{ASSIST_COPY.colSimilar}</th>}
              <th scope="col">{ASSIST_COPY.colStake}</th>
              <th scope="col">
                {wide ? ASSIST_COPY.colPayoutLow : ASSIST_COPY.colPayout}
              </th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map((r) => {
              const tg = r.payout < result.total;
              return (
                <tr key={r.ticket}>
                  <td className="ta-num">
                    {ticketLabel(r.ticket, type.ordered)}
                  </td>
                  <td className="ta-num">{oddsCell(r)}</td>
                  <td className="ta-num">
                    {ASSIST_COPY.popularity(ranks.get(r.ticket))}
                  </td>
                  {showSimilar && (
                    <td className="ta-num">
                      {similarTri[r.ticket] ?? 0}/{similarN}
                    </td>
                  )}
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
                colSpan={showSimilar ? 6 : 5}
                className="ta-num"
                style={{ textAlign: "left", whiteSpace: "normal" }}
              >
                <b>
                  {ASSIST_COPY.totalLine(
                    result.total,
                    result.remainder,
                    result.multiplier.min.toFixed(2),
                    result.multiplier.max.toFixed(2),
                    wide,
                  )}
                </b>
              </td>
            </tr>
          </tbody>
        </table>
      )}
      {result?.topped && <p className="ta-note">{ASSIST_COPY.toppedNote}</p>}
      {result?.missing.length > 0 && (
        <p className="ta-note">
          {ASSIST_COPY.missingOdds(
            result.missing.length,
            result.missing.map((t) => ticketLabel(t, type.ordered)),
            wide,
          )}
        </p>
      )}
      {wide && result && !result.insufficient && (
        <>
          <p className="ta-note">{ASSIST_COPY.wideCalcNote}</p>
          <p className="ta-note">{ASSIST_COPY.wideMultiNote}</p>
        </>
      )}
      {result && !result.insufficient && (
        <p className="ta-note">
          {wide
            ? ASSIST_COPY.popularityNoteWide(type.combos)
            : ASSIST_COPY.popularityNote(typeLabel, type.combos)}
        </p>
      )}
      {showSimilar && result && !result.insufficient && (
        <p className="ta-note">{ASSIST_COPY.similarColNote(similarN)}</p>
      )}
      {composite != null && (
        <p className="ta-note ta-num">
          {ASSIST_COPY.composite(compositeText(composite))}（
          {ASSIST_COPY.compositeNote}）
        </p>
      )}
      {oddsFinalFailed && finished && (
        <p className="ta-note">{ASSIST_COPY.oddsFinalFailed}</p>
      )}
      {oddsFinal ? (
        <p className="ta-note">{ASSIST_COPY.oddsFinal}</p>
      ) : (
        oddsAt && (
          <p className="ta-note">
            {finished
              ? ASSIST_COPY.oddsCautionFinished(oddsAt)
              : ASSIST_COPY.oddsCaution(oddsAt)}
          </p>
        )
      )}
    </div>
  );
}
