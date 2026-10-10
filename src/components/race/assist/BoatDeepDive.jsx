import { useEffect, useRef, useState } from "react";
import BoatBadge from "../BoatBadge";
import ClassLineup from "./ClassLineup";
import RunsTable from "./RunsTable";
import FactChips from "./FactChips";
import Fold from "./Fold";
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
import { TermButton, TheoryButton } from "./SheetButtons";

/** 用語の「?」つきの見出し（dt） */
const Dt = ({ term, children }) => (
  <dt>
    {children ?? term}
    <TermButton term={term} />
  </dt>
);

/** 深掘りの先頭に出す▲の付いた材料の数（ユーザー決定 A） */
const TOP_FACTS = 3;

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
  // 開いたら深掘りの上端まで送る。図の下に開くので、送らないと押した結果が画面の外になる（デザイナーのレビュー P1-1）
  const ref = useRef(null);
  useEffect(() => {
    const reduce = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    )?.matches;
    ref.current?.scrollIntoView?.({
      block: "start",
      behavior: reduce ? "auto" : "smooth",
    });
  }, [boat]);
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
  // 先頭に出す結論: ▲（今日6艇で一番・一番下）の付いた材料を最大3件（2026-10-09 ユーザー決定 A）
  const topChips = chips.filter((c) => c.hit).slice(0, TOP_FACTS);
  const base = u ? Math.round((u.k / u.n) * 100) : 0;
  const scopeLabel = scope
    ? C.scopeChip(
        factsScopeLabel(scope, venue, boat, today?.classes?.[i]),
        scope.n,
      )
    : null;

  return (
    <section ref={ref} className="ta-deep" aria-label={C.deepRegion(boat)}>
      <div className="ta-deep-head">
        <BoatBadge n={boat} />
        <h3>
          <span translate="no">{racer.name}</span>{" "}
          <span className="ta-note ta-num">
            {C.deepMeta(racer.cls, racer.age, weight)}
          </span>
          <TermButton term="級" />
          <TheoryButton
            id="TC-T9"
            name={C.powerTheory.weight}
            boat={boat}
            className="ta-tag"
          >
            {C.powerTheory.weight} {C.trend}
          </TheoryButton>
        </h3>
        <button type="button" className="ta-close" onClick={onClose}>
          {C.close}
        </button>
      </div>
      {scope && topChips.length > 0 && (
        <div className="ta-deep-facts">
          <h4>{C.factsHeading(boat)}</h4>
          <div className="ta-legend">
            <span className="ta-scopechip ta-num">{scopeLabel}</span>
            <span>{C.factsLegend}</span>
          </div>
          <FactChips chips={topChips} base={base} round={round} boat={boat} />
          <p className="ta-note">{C.factsNotCause}</p>
        </div>
      )}
      {feats.length > 0 && (
        <div className="ta-feat" aria-label={C.featTitle} role="group">
          {feats.map((f) => (
            <Feat key={f.id} chip={f} venue={venue} />
          ))}
          <TermButton term={C.featTitle} />
        </div>
      )}
      <dl className="ta-kv">
        <Dt term={C.factNames.nat_win} />
        <dd>
          <Val metric="nat_win" racer={racer} onMetric={onMetric} />
        </dd>
        <Dt term={C.factNames.loc_win} />
        <dd>
          <Val metric="loc_win" racer={racer} onMetric={onMetric} />
        </dd>
        {recent != null && (
          <>
            <Dt term={C.factNames.recent_win30} />
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
        <Dt term={C.kvSt} />
        <dd>
          {today ? (
            <Val metric="st_mean30" racer={racer} onMetric={onMetric} />
          ) : (
            // v16 の保存が無いレースは、記録が無いのではなくデータが無い（ファン評価 PR4 1周目 指摘5）
            C.noRunsData
          )}{" "}
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
        <Dt term={C.factNames.series_score} />
        <dd>
          {racer.seriesScore == null && meet?.avg != null ? (
            // v16 の値が無いレース（保存なし等）は、今節の走から同じ定義で出す（F・失格は0点。ファン評価 PR4 1周目 指摘5）
            <span className="ta-num">{meet.avg.toFixed(2)}</span>
          ) : (
            <Val metric="series_score" racer={racer} onMetric={onMetric} />
          )}
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
        <Dt term={C.factNames.motor_2} />
        <dd>
          <Val metric="motor_2" racer={racer} onMetric={onMetric} />
        </dd>
        {pretest?.pretest_time != null && (
          <>
            <Dt term={C.kvPretest} />
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
            <Dt term={C.kvTech} />
            <dd className="ta-num">
              {techTotal > 0
                ? C.techLine(techTotal) +
                  technique.techniques
                    .map((t) => C.techItem(t.technique, t.count))
                    .join("・")
                : C.techNone}{" "}
              <span className="ta-scopechip">{C.techPeriod}</span>
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
            <Dt term="F" />
            <dd>
              <TheoryButton
                id="TC-T4"
                name={C.markName(`F${racer.fCount}`, boat)}
                boat={boat}
                className="ta-tag ta-tag-warn"
              >
                F{racer.fCount} ›
              </TheoryButton>
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
        // 残りの材料（全部）は畳む（ユーザー決定 A）
        <Fold title={C.factsAll(boat)}>
          <div className="ta-deep-facts">
            <ClassLineup lineup={classLineup(today?.classes, boat)} />
            {counts && (
              <p className="ta-note">
                {C.classNote(
                  boat,
                  today.classes[i],
                  counts,
                  factsScopeLabel(scope, venue),
                )}
              </p>
            )}
            <div className="ta-legend">
              <span className="ta-scopechip ta-num">{scopeLabel}</span>
              <span>{C.factsLegend}</span>
            </div>
            <FactChips chips={chips} base={base} round={round} boat={boat} />
            <p className="ta-note">{C.factsNotCause}</p>
          </div>
        </Fold>
      )}
    </section>
  );
}
