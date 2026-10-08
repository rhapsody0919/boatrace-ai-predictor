import { useState } from "react";
import BaseBar from "./BaseBar";
import Bars6 from "./Bars6";
import BetSummary from "./BetSummary";
import ClassLineup from "./ClassLineup";
import FactChips from "./FactChips";
import ScopeTable from "./ScopeTable";
import BoatBadge from "../BoatBadge";
import {
  bestBoats,
  classLineup,
  restClassCounts,
  sameClassLabel,
} from "../../../utils/assistModel";
import {
  axisFactChips,
  b1Usual,
  entrySummary,
  exhibitionTable,
  factsScopeLabel,
  formSummary,
  hintSummary,
  partsChangedBoats,
} from "../../../utils/assistSummary";
import { ASSIST_COPY as C } from "../../../data/thinkingAssistCopy";

const pct = (k, n) => (n ? (k / n) * 100 : 0);
const p0 = (k, n) => Math.round(pct(k, n));
const p1 = (k, n) => pct(k, n).toFixed(1);
const comma = (n) => n.toLocaleString("ja-JP");
const f2 = (v) => (v == null ? "—" : v.toFixed(2));
const st2 = (v, fly) =>
  v == null
    ? "—"
    : `${fly ? "F" : ""}.${String(Math.round(Math.abs(v) * 100)).padStart(2, "0")}`;

/** 畳んだ説明（押すと開く） */
function Fold({ title, children }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="ta-fold">
      <button
        type="button"
        className="ta-scope-toggle"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {title} ›
      </button>
      {open && children}
    </div>
  );
}

function AxisSummary({ m }) {
  const { scope, chips, venue, headerScope, vaFacts, vaCell, classes, round } =
    m;
  const u = b1Usual(scope);
  if (!u) return null;
  const va = vaFacts ? b1Usual({ facts: vaFacts }) : null;
  const label = factsScopeLabel(scope, venue);
  const counts = restClassCounts(classes, 1);
  const hc = headerScope?.cell;
  return (
    <>
      <section className="ta-box">
        <h3>{C.axisHeading(1)}</h3>
        <div className="ta-big">
          <span className="ta-big-pct ta-num">{p1(u.k, u.n)}%</span>
          <span className="ta-big-cnt ta-num">{C.races(u.k, u.n)}</span>
        </div>
        <ClassLineup lineup={classLineup(classes, 1)} />
        {counts && (
          <p className="ta-note">{C.classNote(1, classes[0], counts)}</p>
        )}
        <BaseBar label={C.scopeChip(label, u.n)} k={u.k} n={u.n} />
        {va && venue && (
          <BaseBar label={C.venueAllN(venue, va.n)} k={va.k} n={va.n} />
        )}
        <Fold title={C.whyToggle}>
          <ul className="ta-list">
            {hc && headerScope.kind === scope.kind && (
              <li className="ta-num">
                {C.whyRefund(
                  comma(u.n),
                  p1(u.k, u.n),
                  comma(hc.n),
                  p1(hc.b1_win, hc.n),
                )}
              </li>
            )}
            {scope.kind === "VC" && venue && <li>{C.whyVenueScope(venue)}</li>}
            {va && vaCell?.n > 0 && venue && (
              <li className="ta-num">
                {C.whyVenueRefund(
                  venue,
                  comma(va.n),
                  p1(va.k, va.n),
                  comma(vaCell.n),
                  p1(vaCell.b1_win, vaCell.n),
                )}
              </li>
            )}
            {scope.fellBack && venue && (
              <li className="ta-num">{C.whyFellBack(venue, scope.vcCount)}</li>
            )}
          </ul>
        </Fold>
      </section>
      {chips.length > 0 && (
        <section className="ta-box">
          <h3>{C.factsHeading(1)}</h3>
          <div className="ta-legend">
            <span className="ta-scopechip ta-num">
              {C.scopeChip(label, scope.n)}
            </span>
            <span>{C.factsLegend}</span>
          </div>
          {axisFactChips(chips).length > 0 ? (
            <FactChips
              chips={axisFactChips(chips)}
              base={p0(u.k, u.n)}
              round={round}
            />
          ) : (
            // 件数の少ない範囲（準優勝戦だけ等）では差の大きい材料が無いことがある。空の枠にしない
            <p className="ta-note">{C.factsNoneLarge}</p>
          )}
          <p className="ta-note">{C.factsNotCause}</p>
        </section>
      )}
    </>
  );
}

function FlowSummary({ m }) {
  const {
    scenario,
    today,
    post,
    v16Exhibition,
    courseByBoat,
    similar,
    racecardStage,
    reflecting,
    round,
  } = m;
  const hs = scenario ? hintSummary(scenario, today) : null;
  const top = hs?.top ?? null;
  const formName = top ? C.formNames[top.form] : null;
  const form = top ? formSummary(scenario, top.form) : null;
  const entry = post ? entrySummary(scenario, courseByBoat) : null;
  const exhForm =
    post && top && v16Exhibition?.forms?.includes?.(top.form) ? true : false;
  const simLabel = similar
    ? C.similarLabel(similar.n, similar.allInLayer)
    : null;
  return (
    <>
      {hs && (
        <section className="ta-box">
          <h3>{C.flowShapeHeading}</h3>
          {top ? (
            <>
              <div className="ta-big">
                <span className="ta-big-cnt">{C.flowShapeLead(formName)}</span>
                <span className="ta-big-pct ta-num">
                  {p0(top.hit[0], top.hit[1])}%
                </span>
                <span className="ta-big-cnt ta-num">
                  {C.flowShapeMiss(p0(top.miss[0], top.miss[1]))}
                </span>
              </div>
              <div className="ta-chk">
                <span>✓ {C.hintConds[top.id]}</span>
                {exhForm && <span>✓ {C.flowExhForm(formName)}</span>}
              </div>
              <BaseBar
                label={C.flowHitBar(formName)}
                k={top.hit[0]}
                n={top.hit[1]}
              />
              <BaseBar label={C.flowMissBar} k={top.miss[0]} n={top.miss[1]} />
              <p className="ta-note">{C.flowHintSource}</p>
            </>
          ) : (
            <p className="ta-note">{C.flowNoHint}</p>
          )}
          {post && reflecting && <p className="ta-note">{C.stateReflecting}</p>}
        </section>
      )}
      {form && (
        <section className="ta-box">
          <h3>{C.flowIfHeading(formName)}</h3>
          <div className="ta-legend">
            <span className="ta-scopechip ta-num">
              {C.flowFormScope(C.flowScopeLabel(Boolean(round)), form.n)}
            </span>
            <span>{C.flowFirstBoat}</span>
          </div>
          {form.few ? (
            <p className="ta-note">{C.flowFew}</p>
          ) : (
            <>
              <Bars6 values={form.first.map((k) => k / form.n)} />
              {form.topTrifecta.length > 0 && (
                <p className="ta-note ta-num">
                  {C.flowTopTrifecta}:{" "}
                  {form.topTrifecta
                    .map(([x, k]) => C.trifectaCount(x.join("-"), k))
                    .join("　")}
                </p>
              )}
            </>
          )}
        </section>
      )}
      {(entry || !post) && (
        <section className="ta-box">
          <h3>{C.entryHeading}</h3>
          {entry ? (
            <>
              <div className="ta-chk">
                <span>✓ {C.entryToday(C.entryNames[entry.type])}</span>
              </div>
              {/* 集めた範囲と件数を書く（上の枠の準優勝戦の値と比べられるように。ファン評価 PR4 1周目 指摘1） */}
              <div className="ta-legend">
                <span className="ta-scopechip ta-num">
                  {C.scopeChip(C.flowScopeLabel(Boolean(round)), entry.n)}
                </span>
              </div>
              <BaseBar
                label={C.entryB1(C.entryNames[entry.group])}
                k={entry.k}
                n={entry.n}
              />
            </>
          ) : (
            <p className="ta-note">{C.entryPre}</p>
          )}
        </section>
      )}
      {similar && similar.n > 0 && (
        <section className="ta-box">
          <h3>{C.simTechHeading(simLabel)}</h3>
          {Object.entries(similar.tech)
            .sort((a, b) => b[1] - a[1])
            .map(([t, k]) => (
              <BaseBar
                key={t}
                label={`${t} ${k}件`}
                k={k}
                n={similar.n}
                labelRate={false}
              />
            ))}
          <p className="ta-note ta-num">
            {C.simB1(similar.win[0], p0(similar.win[0], similar.n))}
          </p>
          {racecardStage && <p className="ta-note">{C.similarRacecardStage}</p>}
        </section>
      )}
    </>
  );
}

function PowerSummary({ m }) {
  const { post, racers, maintenance, original, venue, motorChip } = m;
  const table = post
    ? exhibitionTable({ racers, maintenance, original })
    : null;
  const parts = post && maintenance ? partsChangedBoats(maintenance) : null;
  const motorBest = bestBoats(
    "motor_2",
    racers.map((r) => ({ boat: r.boat, value: r.motor2 })),
  );
  return (
    <>
      <section className="ta-box">
        {table ? (
          <>
            <h3>{C.powerExhHeading(venue ?? "", table.kinds)}</h3>
            <div className="ta-scroll">
              <table className="ta-table ta-table-ex">
                <thead>
                  <tr>
                    <th scope="col">{C.colBoat}</th>
                    <th scope="col">{C.colExh}</th>
                    {table.kinds.map((k) => (
                      <th key={k} scope="col">
                        {k}
                      </th>
                    ))}
                    <th scope="col">{C.colExhSt}</th>
                    <th scope="col">{C.colWeight}</th>
                    <th scope="col">{C.colTilt}</th>
                  </tr>
                </thead>
                <tbody>
                  {table.rows.map((r) => (
                    <tr key={r.boat}>
                      <td>
                        <BoatBadge n={r.boat} size="sm" />
                      </td>
                      {r.absent ? (
                        <td colSpan={4 + table.kinds.length}>{C.absent}</td>
                      ) : (
                        <>
                          <td
                            className={`ta-num${table.best.exh.has(r.boat) ? " ind-best" : ""}`}
                          >
                            {f2(r.exh)}
                          </td>
                          {r.ox.map((v, i) => (
                            <td
                              key={table.kinds[i]}
                              className={`ta-num${table.best.ox[i].has(r.boat) ? " ind-best" : ""}`}
                            >
                              {f2(v)}
                            </td>
                          ))}
                          <td
                            className={`ta-num${table.best.exhSt.has(r.boat) ? " ind-best" : ""}`}
                          >
                            {st2(r.exhSt, r.exhFlying)}
                          </td>
                          <td className="ta-num">
                            {r.weight == null ? "—" : r.weight.toFixed(1)}
                            {r.light ? ` ${C.weightLight}` : ""}
                          </td>
                          <td className="ta-num">{r.tilt ?? "—"}</td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="ta-legend">
              <span>{C.powerLegendBest}</span>
              <span>{C.powerLegendNone}</span>
            </div>
            {parts && (
              <p className="ta-note">
                {parts.length ? C.partsBoats(parts) : C.partsNone}
              </p>
            )}
          </>
        ) : (
          <>
            <h3>{C.colExh}</h3>
            <p className="ta-note">{C.powerPre}</p>
          </>
        )}
      </section>
      <section className="ta-box">
        <h3>{C.motorHeading}</h3>
        <Bars6
          values={racers.map((r) => r.motor2)}
          raw
          digits={1}
          best={motorBest}
        />
        {motorChip && (
          <div className="ta-chip ta-chip-hit">
            <span className="ta-num">
              {C.motorChip(1, motorChip.top, motorChip.value.toFixed(1))}
            </span>
            <b className="ta-num">
              {C.motorChipRate(motorChip.top, motorChip.rate, motorChip.base)}
            </b>
          </div>
        )}
      </section>
    </>
  );
}

function BetLensSummary({ m }) {
  const { bet, scope, national, similar, venueAll, venue, classes, sim } = m;
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
      <section className="ta-box">
        <h3>{C.betBoxHeading(bet.points)}</h3>
        <BetSummary
          {...bet.summary}
          similarTri={similar?.tri ?? null}
          similarN={similar?.n ?? null}
        />
      </section>
      {scope && baseM != null && (
        <section className="ta-box">
          <h3>{C.manshuHeading}</h3>
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
      )}
      {similar && similar.topTrifecta.length > 0 && (
        <section className="ta-box">
          <h3>{C.simTopHeading(simLabel)}</h3>
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
                const odds = bet.summary.trifecta?.[key];
                const rank = bet.ranks.get(key);
                return (
                  <tr key={key}>
                    <td className="ta-num">{key}</td>
                    <td className="ta-num">
                      {k}/{similar.n}
                    </td>
                    <td className="ta-num">{odds ?? "—"}</td>
                    <td className="ta-num">
                      {rank ? C.popularity(rank) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}

/**
 * レンズの要約（FR-4、screens S-1 D）。レースの全体に関わる値をレンズごとに並べる（承認モック v7 の renderSum）。
 * 6艇の値の最良は金枠だけで示す（隠し文字は図の数字の側だけ）
 * @param {{lens: string, axis: object|null, flow: object, power: object, bet: object}} props 各レンズの材料
 */
export default function LensSummary({ lens, axis, flow, power, bet }) {
  return (
    <div className="ta-sum">
      {lens === "axis" && axis && <AxisSummary m={axis} />}
      {lens === "flow" && <FlowSummary m={flow} />}
      {lens === "power" && <PowerSummary m={power} />}
      {lens === "bet" && <BetLensSummary m={bet} />}
    </div>
  );
}
