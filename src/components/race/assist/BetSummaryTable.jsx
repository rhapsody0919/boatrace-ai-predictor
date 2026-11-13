import { formatOdds } from "../../../utils/oddsMath";
import { ticketLabel } from "../../../utils/assistModel";
import { ASSIST_COPY } from "../../../data/thinkingAssistCopy";

// 拡連複は odds が下限、oddsRange が公式の幅。上限が欠けた組は下限だけ（同じ桁の表記）
function oddsCell(r, wide, oddsRange) {
  if (!wide) return r.odds;
  const w = oddsRange?.[r.ticket];
  return w?.high != null
    ? ASSIST_COPY.oddsRange(formatOdds(w.low), formatOdds(w.high))
    : formatOdds(r.odds);
}

const yen = (n) => n.toLocaleString("ja-JP");

export default function BetSummaryTable({
  result,
  type,
  ranks,
  wide,
  showSimilar,
  similarTri,
  similarN,
  oddsRange,
}) {
  return (
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
              <td className="ta-num">{ticketLabel(r.ticket, type.ordered)}</td>
              <td className="ta-num">{oddsCell(r, wide, oddsRange)}</td>
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
  );
}
