import { useState } from "react";
import BoatBadge from "../BoatBadge";
import ClassLineup from "./ClassLineup";
import RunsTable from "./RunsTable";
import FactChips from "./FactChips";
import {
  METRICS,
  classLineup,
  restClassCounts,
  stText,
} from "../../../utils/assistModel";
import {
  b1Usual,
  courseWins,
  factsScopeLabel,
  featChips,
  finishClass,
  monthDay,
  finishOf,
  meetRuns,
  priorRuns,
} from "../../../utils/assistSummary";
import { ASSIST_COPY as C } from "../../../data/thinkingAssistCopy";

/** 値のボタン（押すと6艇比較）。深掘りの1艇の値には金枠を付けない（FR-3a「付けない所」） */
function Val({ metric, racer, onMetric }) {
  const def = METRICS[metric];
  const v = def.value(racer);
  const text = v == null ? C.noRecord : def.text(v, racer);
  return (
    <button
      type="button"
      className="ta-kv-btn ta-num"
      aria-label={C.compareAria(
        def.label,
        v == null ? C.noRecord : def.aria(v, racer),
      )}
      onClick={() => onMetric(metric, racer.boat)}
    >
      {text}
    </button>
  );
}

/** 成績から付けた札（D-41）。押すと付けた理由を1行で出す */
function Feat({ chip, venue }) {
  const [open, setOpen] = useState(false);
  const label =
    chip.id === "locTop"
      ? C.feat.locTop(venue)
      : chip.id === "tech"
        ? C.feat.tech(chip.technique)
        : C.feat[chip.id];
  const why =
    chip.id === "tech"
      ? C.featWhy.tech(chip.wins, chip.technique, chip.count)
      : C.featWhy[chip.id];
  return (
    <span className="ta-feat-item">
      <button
        type="button"
        className="ta-tag ta-tag-hit"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {label}
      </button>
      {open && <span className="ta-note">{why}</span>}
    </span>
  );
}

/**
 * 深掘り（FR-5、screens S-1 E）。艇の丸を押すと開き、「閉じる」で戻る。数字を押すと図が6艇比較になる（2段目）。
 * 今節の走・今節より前の5走は開いたときに取る（3段目）。優勝戦・準優勝戦の日は今節の点の順位・「今節好調」を出さない
 * @param {{boat: number, racer: object, venue: string, raceId: string, today: object|null, post: boolean,
 *   finalRound: boolean, round: string|null, scope: object|null, chips: object[], runs: {status: string, data: object[]|null},
 *   technique: object|null, pretest: object|null, weight: number|null, course: number,
 *   onMetric: (metric: string, boat: number) => void, onClose: () => void}} props
 */
export default function BoatDeepDive({
  boat,
  racer,
  venue,
  raceId,
  today,
  post,
  finalRound,
  round,
  scope,
  chips,
  runs,
  technique,
  pretest,
  weight,
  course,
  onMetric,
  onClose,
}) {
  const [runsOpen, setRunsOpen] = useState(false);
  const i = boat - 1;
  const feats = featChips({ boat, today, finalRound, technique });
  const recent = today?.items?.recent_win30?.values?.[i];
  const seriesPos = today?.items?.series_score?.positions?.[i]?.[0] ?? null;
  const cst = today?.course_st;
  const ready = runs.status === "ready" && Array.isArray(runs.data);
  const meet = ready ? meetRuns(runs.data, raceId) : null;
  const prior = ready
    ? priorRuns(runs.data, raceId, [...meet.past, ...meet.today])
    : [];
  const cw = ready ? courseWins(runs.data, raceId, course) : null;
  const counts = restClassCounts(today?.classes, boat);
  const u = b1Usual(scope, boat);
  const techTotal = technique?.win_count ?? 0;

  return (
    <section className="ta-deep" aria-label={C.deepRegion(boat)}>
      <div className="ta-deep-head">
        <BoatBadge n={boat} />
        <h3>
          <span translate="no">{racer.name}</span>{" "}
          <span className="ta-note ta-num">
            {C.deepMeta(racer.cls, racer.age, weight)}
          </span>
        </h3>
        <button type="button" className="ta-close" onClick={onClose}>
          {C.close}
        </button>
      </div>
      {feats.length > 0 && (
        <div className="ta-feat" aria-label={C.featTitle} role="group">
          {feats.map((f) => (
            <Feat key={f.id} chip={f} venue={venue} />
          ))}
        </div>
      )}
      <dl className="ta-kv">
        <dt>{C.factNames.nat_win}</dt>
        <dd>
          <Val metric="nat_win" racer={racer} onMetric={onMetric} />
        </dd>
        <dt>{C.factNames.loc_win}</dt>
        <dd>
          <Val metric="loc_win" racer={racer} onMetric={onMetric} />
        </dd>
        {recent != null && (
          <>
            <dt>{C.factNames.recent_win30}</dt>
            <dd className="ta-num">{(recent * 100).toFixed(1)}%</dd>
          </>
        )}
        <dt>{C.kvCourse(course)}</dt>
        <dd>
          {cw ? (
            <span className="ta-num">{C.courseWin(cw.k, cw.n)}</span>
          ) : runs.status === "error" || runs.status === "none" ? (
            C.noRunsData
          ) : (
            C.loading
          )}{" "}
          <span className="ta-scopechip">{C.courseNote}</span>
        </dd>
        <dt>{C.kvSt}</dt>
        <dd>
          <Val metric="st_mean30" racer={racer} onMetric={onMetric} />{" "}
          {cst?.course?.[i] != null && (
            <span className="ta-scopechip ta-num">
              {C.stCourseChip(stText(cst.course[i]))}
            </span>
          )}{" "}
          {cst?.venue?.[i] != null && venue && (
            <span className="ta-scopechip ta-num">
              {C.stVenueChip(venue, stText(cst.venue[i]))}
            </span>
          )}
        </dd>
        <dt>{C.factNames.series_score}</dt>
        <dd>
          <Val metric="series_score" racer={racer} onMetric={onMetric} />
          {!finalRound && seriesPos && (
            <span className="ta-num"> （{C.seriesRank(seriesPos)}）</span>
          )}{" "}
          <span className="ta-scopechip">{C.beforeToday}</span>
          <div className="ta-finline ta-num">
            {meet ? (
              <>
                {meet.byDay.map((d, k) => (
                  <span key={d.date}>
                    {k > 0 && "／"}
                    {monthDay(d.date)}{" "}
                    {d.finishes.map((f, j) => (
                      <span key={j}>
                        {j > 0 && "・"}
                        <span className={finishClass(f).trim()}>
                          {f ?? "—"}
                        </span>
                      </span>
                    ))}
                  </span>
                ))}
                {meet.today.map((r) => (
                  <span key={r.raceId} className="ta-run-today">
                    {" "}
                    {C.todayRun(Number(r.raceId.slice(14, 16)), finishOf(r))}
                  </span>
                ))}
              </>
            ) : runs.status === "error" ? (
              C.partFailed(C.captionMeet(venue))
            ) : runs.status === "none" ? (
              C.noRunsData
            ) : (
              C.loading
            )}
          </div>
          {meet && (
            <button
              type="button"
              className="ta-linkish"
              aria-expanded={runsOpen}
              onClick={() => setRunsOpen((o) => !o)}
            >
              {C.runsToggle}{" "}
              <span aria-hidden="true">{runsOpen ? "▲" : "›"}</span>
            </button>
          )}
        </dd>
        <dt>{C.factNames.motor_2}</dt>
        <dd>
          <Val metric="motor_2" racer={racer} onMetric={onMetric} />
        </dd>
        {pretest?.pretest_time != null && (
          <>
            <dt>{C.kvPretest}</dt>
            <dd className="ta-num">
              {C.pretest(
                Number(pretest.pretest_time).toFixed(2),
                pretest.pretest_rank,
              )}
            </dd>
          </>
        )}
        {technique && (
          <>
            <dt>{C.kvTech}</dt>
            <dd className="ta-num">
              {techTotal > 0
                ? C.techLine(techTotal) +
                  technique.techniques
                    .map((t) => `${t.technique}${t.count}`)
                    .join("・")
                : C.techNone}
            </dd>
          </>
        )}
        {post && (
          <>
            <dt>{C.colExh}</dt>
            <dd>
              <Val metric="exh_time" racer={racer} onMetric={onMetric} />{" "}
              {racer.exhSt != null && (
                <span className="ta-scopechip ta-num">
                  {C.exhStChip(METRICS.exh_st.text(racer.exhSt, racer))}
                </span>
              )}{" "}
              {racer.tilt != null && (
                <span className="ta-scopechip ta-num">
                  {C.tiltChip(racer.tilt)}
                </span>
              )}
            </dd>
          </>
        )}
        {racer.fCount > 0 && (
          <>
            <dt>F</dt>
            <dd>
              <span className="ta-tag ta-tag-warn">F{racer.fCount}</span>
            </dd>
          </>
        )}
      </dl>
      {runsOpen && meet && (
        <RunsTable
          meet={meet}
          prior={prior}
          venue={venue}
          raceId={raceId}
          boat={boat}
        />
      )}
      {scope && chips.length > 0 && (
        <div className="ta-deep-facts">
          <div className="ta-legend">
            <b>{C.factsHeading(boat)}</b>
            <span>{C.factsLegend}</span>
          </div>
          <ClassLineup lineup={classLineup(today?.classes, boat)} />
          {counts && (
            <p className="ta-note">
              {C.classNote(boat, today.classes[i], counts)}
            </p>
          )}
          <span className="ta-scopechip ta-num">
            {C.scopeChip(factsScopeLabel(scope, venue), scope.n)}
          </span>
          <FactChips
            chips={chips}
            base={u ? Math.round((u.k / u.n) * 100) : 0}
            round={round}
          />
          <p className="ta-note">{C.factsNotCause}</p>
        </div>
      )}
    </section>
  );
}
