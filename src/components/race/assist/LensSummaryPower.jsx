import Bars6 from "./Bars6";
import BoatBadge from "../BoatBadge";
import { bestBoats } from "../../../utils/assistModel";
import {
  powerWinners,
  exhibitionTable,
  partsChangedBoats,
} from "../../../utils/assistSummary";
import { ASSIST_COPY as C, GLOSSARY } from "../../../data/thinkingAssistCopy";
import { TermButton, TheoryButton } from "./SheetButtons";
import { f2, st2 } from "./lensSummaryFormat";

function PowerExhRow({ r, table }) {
  return (
    <tr>
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
  );
}

function PowerExhSection({ table, venue, parts }) {
  return (
    <>
      <section className="ta-box" data-guide="power">
        {table ? (
          <>
            <h3 className="ta-h3-row">
              {C.powerExhHeading(venue ?? "", table.kinds)}
              <TheoryButton id="TC-T10" name={C.theoryExhGap} />
            </h3>
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
                    <PowerExhRow key={r.boat} r={r} table={table} />
                  ))}
                </tbody>
              </table>
            </div>
            <div className="ta-legend">
              <span>{C.powerLegendBest}</span>
              <span>{C.powerLegendNone}</span>
            </div>
            {/* 用語の「?」は表の見出しに入れると 375px で表がはみ出すので、表の下に並べる（ファン評価 PR5 1周目 指摘4） */}
            <p className="ta-note">
              {[...table.kinds.filter((k) => GLOSSARY[k]), "展示ST"].map(
                (k) => (
                  <span key={k} className="ta-term-item">
                    {k}
                    <TermButton term={k} />
                  </span>
                ),
              )}
            </p>
            <div className="ta-feat">
              <TheoryButton
                id="TC-X1"
                name={C.powerTheory.x1}
                className="ta-tag"
              >
                {C.powerTheory.x1} ›
              </TheoryButton>
              <TheoryButton
                id="TC-T5"
                name={C.powerTheory.tilt}
                className="ta-tag"
              >
                {C.powerTheory.tilt} {C.trend}
              </TheoryButton>
              {parts && (
                <TheoryButton
                  id="TC-T6"
                  name={C.partsTheory}
                  className="ta-tag"
                >
                  {parts.length ? C.partsBoats(parts) : C.partsNone} ›
                </TheoryButton>
              )}
              <TheoryButton
                id="TC-T9"
                name={C.powerTheory.weight}
                className="ta-tag"
              >
                {C.powerTheory.weight} {C.trend}
              </TheoryButton>
            </div>
          </>
        ) : (
          <>
            <h3>{C.colExh}</h3>
            <p className="ta-note">{C.powerPre}</p>
          </>
        )}
      </section>
    </>
  );
}

export function PowerSummary({ m }) {
  const { post, racers, maintenance, original, venue, motorChip } = m;
  const table = post
    ? exhibitionTable({ racers, maintenance, original })
    : null;
  const parts = post && maintenance ? partsChangedBoats(maintenance) : null;
  const motorBest = bestBoats(
    "motor_2",
    racers.map((r) => ({ boat: r.boat, value: r.motor2 })),
  );
  const conclusion = C.powerConclusion(
    powerWinners({
      table,
      motor: {
        best: motorBest,
        valueOf: (boat) => racers[boat - 1]?.motor2 ?? null,
      },
    }),
  );
  return (
    <>
      {conclusion && <p className="ta-power-answer">{conclusion}</p>}
      <PowerExhSection table={table} venue={venue} parts={parts} />
      <PowerMotorSection
        racers={racers}
        motorBest={motorBest}
        motorChip={motorChip}
      />
    </>
  );
}

function PowerMotorSection({ racers, motorBest, motorChip }) {
  return (
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
          <span className="ta-scopechip ta-num">{motorChip.scope}</span>
        </div>
      )}
    </section>
  );
}
