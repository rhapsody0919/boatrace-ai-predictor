import BaseBar from "./BaseBar";
import BetSummary from "./BetSummary";
import BetTypeCompare from "./BetTypeCompare";
import BetTypeTabs from "./BetTypeTabs";
import ScopeTable from "./ScopeTable";
import { classLineup, sameClassLabel } from "../../../utils/assistModel";
import { ASSIST_COPY as C } from "../../../data/thinkingAssistCopy";
import { TermButton } from "./SheetButtons";
import { comma } from "./lensSummaryFormat";

export function BetLensSummary({ m }) {
  const { bet, scope, national, similar, venueAll, venue, classes } = m;
  const lineup = classLineup(classes, 1);
  const simLabel = similar
    ? C.similarLabel(similar.n, similar.allInLayer)
    : null;
  const baseM = national ? national.manshu / national.payout_known : null;
  const refM =
    venueAll?.payout_known && venue
      ? venueAll.manshu / venueAll.payout_known
      : null;
  return (
    <>
      {/* 券種で比べる（同じ候補）と券種のタブ（BOA-990、承認モック 画面1） */}
      <BetTypeCompare
        rows={bet.compare}
        betType={bet.summary.betType}
        onBetType={(id) => bet.onBetType(id, "compare")}
      />
      <section className="ta-box">
        <div className="ta-bettype-side">
          <BetTypeTabs
            betType={bet.summary.betType}
            onBetType={(id) => bet.onBetType(id, "tab")}
          />
        </div>
        <h3 className="ta-h3-row">
          {C.betBoxHeading(bet.points)}
          <TermButton term="合成オッズ" />
        </h3>
        <BetSummary
          {...bet.summary}
          similarTri={similar?.tri ?? null}
          similarN={similar?.n ?? null}
        />
      </section>
      {scope && baseM != null && (
        <BetManshuSection
          m={m}
          lineup={lineup}
          simLabel={simLabel}
          baseM={baseM}
          refM={refM}
        />
      )}
      {similar && similar.topTrifecta.length > 0 && (
        <BetSimTopSection bet={bet} similar={similar} simLabel={simLabel} />
      )}
    </>
  );
}

function BetManshuSection({ m, lineup, simLabel, baseM, refM }) {
  const { scope, similar, venue, classes, sim } = m;
  return (
    <section className="ta-box">
      <h3 className="ta-h3-row">
        {C.manshuHeading}
        <TermButton term="万舟" />
      </h3>
      <p className="ta-note">
        {refM != null ? C.baseLegendRef(venue) : C.baseLegend}
      </p>
      <ScopeTable
        scope={scope}
        similarN={similar?.n ?? null}
        similarConditions={sim?.conditions ?? null}
        classes={classes}
        lineup={lineup}
      />
      <BaseBar
        label={`${sameClassLabel(scope)} ${comma(scope.cell.n)}件${scope.few ? `・${C.roughFew}` : ""}`}
        k={scope.cell.manshu}
        n={scope.cell.payout_known}
        base={baseM}
        refRate={refM}
        few={scope.few}
      />
      {similar && (
        <BaseBar
          label={simLabel}
          k={similar.manshu.k}
          n={similar.manshu.n}
          base={baseM}
          refRate={refM}
        />
      )}
    </section>
  );
}

function BetSimTopSection({ bet, similar, simLabel }) {
  return (
    <section className="ta-box">
      <h3 className="ta-h3-row">
        {C.simTopHeading(simLabel)}
        <TermButton term="類似レース" />
      </h3>
      {/* 件数は過去、オッズ・人気は今日の値（BOA-808 P3） */}
      <p className="ta-note ta-num">
        {C.simTopNote(similar.n, bet.oddsAt, bet.finished, bet.trifectaFinal)}
      </p>
      <table className="ta-table">
        <thead>
          <tr>
            <th scope="col">{C.colTicket}</th>
            <th scope="col">{C.colCount}</th>
            <th scope="col">{C.colOdds}</th>
            <th scope="col">{C.colPopularity}</th>
          </tr>
        </thead>
        <tbody>
          {similar.topTrifecta.map(([x, k]) => {
            const key = x.join("-");
            const odds = bet.trifecta?.[key];
            const rank = bet.ranks.get(key);
            return (
              <tr key={key}>
                <td className="ta-num">{key}</td>
                <td className="ta-num">
                  {k}/{similar.n}
                </td>
                <td className="ta-num">
                  {odds == null ? "—" : C.oddsTimes(odds)}
                </td>
                <td className="ta-num">{rank ? C.popularity(rank) : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
