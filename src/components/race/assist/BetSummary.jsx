import { useId } from "react";
import { allocateStakes, popularityRanks } from "../../../utils/oddsMath";
import { assistBetType, hasPricedTicket } from "../../../utils/assistModel";
import BetSummaryControls from "./BetSummaryControls";
import BetSummaryTable from "./BetSummaryTable";
import {
  BetSummaryLeadNotes,
  BetSummaryOddsNotes,
  BetSummaryResultNotes,
} from "./BetSummaryNotes";
import { ASSIST_COPY } from "../../../data/thinkingAssistCopy";

// 拡連複: 3艇が3着以内のとき、その3艇の中の組んだ組はすべて当たる。組んだ組が2つ以上入る3艇組ごとに
// 払戻（下限）の和を取り、最小〜最大を返す。該当が無ければ null
function simultaneousPayoutRange(rows) {
  const sums = new Map();
  const boats = [...new Set(rows.flatMap((r) => r.ticket.split("-")))];
  for (const r of rows) {
    const pair = r.ticket.split("-");
    for (const c of boats) {
      if (pair.includes(c)) continue;
      const key = [...pair, c].sort().join("-");
      const s = sums.get(key) ?? { n: new Set(), sum: 0 };
      if (!s.n.has(r.ticket)) {
        s.n.add(r.ticket);
        s.sum += r.payout;
      }
      sums.set(key, s);
    }
  }
  const vals = [...sums.values()]
    .filter((s) => s.n.size >= 2)
    .map((s) => s.sum);
  return vals.length
    ? { min: Math.min(...vals), max: Math.max(...vals) }
    : null;
}

function shouldShowSimilar(type, similarTri, similarN) {
  return type.id === "trifecta" && similarTri != null && similarN > 0;
}

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
  const showSimilar = shouldShowSimilar(type, similarTri, similarN);
  const budgetId = useId();
  const ranks = popularityRanks(odds);
  // オッズの付いた組が無い（発売前）ときは配分を出さない（screens「状態」）
  const priced = hasPricedTicket(tickets, odds);
  const result = priced
    ? allocateStakes({ tickets, odds, budget: Number(budget), mode })
    : null;
  const wide = type.range === true;
  const settled = Boolean(result) && !result.insufficient;
  // 拡連複は同じレースで最大3組が当たるので、合成オッズの式（どれか1組だけ当たる前提）が当てはまらない
  const composite = settled && !wide ? result.composite : null;
  const simul = wide && settled ? simultaneousPayoutRange(result.rows) : null;
  return (
    <div className="ta-bar">
      <BetSummaryControls
        budgetId={budgetId}
        budget={budget}
        mode={mode}
        onBudget={onBudget}
        onMode={onMode}
      />
      <BetSummaryLeadNotes
        tickets={tickets}
        type={type}
        priced={priced}
        oddsNote={oddsNote}
        result={result}
        composite={composite}
      />
      {settled && (
        <BetSummaryTable
          result={result}
          type={type}
          ranks={ranks}
          wide={wide}
          showSimilar={showSimilar}
          similarTri={similarTri}
          similarN={similarN}
          oddsRange={oddsRange}
        />
      )}
      <BetSummaryResultNotes
        result={result}
        settled={settled}
        type={type}
        typeLabel={typeLabel}
        wide={wide}
        simul={simul}
        showSimilar={showSimilar}
        similarN={similarN}
      />
      <BetSummaryOddsNotes
        composite={composite}
        oddsFinalFailed={oddsFinalFailed}
        finished={finished}
        oddsFinal={oddsFinal}
        oddsAt={oddsAt}
      />
    </div>
  );
}
