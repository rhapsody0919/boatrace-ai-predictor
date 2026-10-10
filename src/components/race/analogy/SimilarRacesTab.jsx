import { useState } from "react";
import { useTranslation } from "react-i18next";
import NoteList, { NotesFold } from "./NoteList";
import BoatBadge from "../BoatBadge";
import SimilarSonar from "./SimilarSonar";
import SimilarityItems from "./SimilarityItems";
import SimilarCompareList from "./SimilarCompareList";
import FinishSankey from "./FinishSankey";
import AnalogySplit from "./AnalogySplit";
import TrifectaList from "./TrifectaList";
import { BoatBars, TechniqueBars } from "./OutcomeBars";
import { boatTip } from "../../../utils/analogyTips";
import {
  FEW_SIMILAR,
  aggregateNeighbors,
  defaultStepIndex,
  neighborCounts,
  normalizeNeighbor,
  sliderSteps,
  visibleItems,
} from "../../../utils/analogyAggregate";
import { describeAnalogyLayer, layerKind } from "../../../utils/analogyLayer";
import { fmtCount, fmtPct, venueLabel } from "../../../utils/analogyFormat";
import { todayDisplay } from "../../../utils/analogySimilarDisplay";
import { wilsonInterval } from "../../../utils/wilson";

const k = "aiPredictionTab.analogy.similar";
const TARGET = { 1: "winner", 2: "top2", 3: "top3" };

/** ソナーの図の見方を絵の凡例で（承認モック sonar-tab v3。以前は3行の箇条書き） */
function SonarLegend() {
  const { t } = useTranslation();
  const icon = (d) => (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      {d}
    </svg>
  );
  return (
    <div
      className="af-legend af-sonar-legend"
      data-testid="analogy-sonar-legend"
    >
      <span>
        {icon(
          <>
            <circle cx="9" cy="9" r="7" fill="none" stroke="#c9a227" />
            <circle cx="9" cy="9" r="2.5" fill="#c9a227" />
          </>,
        )}
        {t(`${k}.legendCenter`)}
      </span>
      <span>
        {icon(
          <path
            d="M9,9 L9,1 A8,8 0 0 1 16,5 Z"
            fill="#c9a227"
            fillOpacity=".5"
          />,
        )}
        {t(`${k}.legendSector`)}
      </span>
      <span>
        {icon(
          <>
            <circle
              cx="9"
              cy="9"
              r="7.5"
              fill="none"
              stroke="#c9a227"
              strokeDasharray="2 2"
            />
            <circle cx="9" cy="9" r="1.8" fill="#c9a227" />
          </>,
        )}
        {t(`${k}.legendTap`)}
      </span>
      <span>
        {icon(
          <>
            <rect
              x="2"
              y="2"
              width="14"
              height="9"
              rx="2"
              fill="none"
              stroke="#c9a227"
            />
            <circle cx="9" cy="15" r="2" fill="#c9a227" />
          </>,
        )}
        {t(`${k}.legendHold`)}
      </span>
    </div>
  );
}

/** その艇が勝ったとき、ほかの艇は？（承認版モックの renderOther） */
function OtherBoats({ neighbors, boat }) {
  const { t } = useTranslation();
  if (!boat) return <p className="af-card-note">{t(`${k}.otherHint`)}</p>;
  const ok = neighbors.filter((x) => x.finish?.length >= 3 && x.finish[0] >= 1);
  const hit = ok.filter((x) => x.finish[0] === boat);
  const base =
    boat === 1
      ? ok.filter((x) => x.finish[0] !== 1)
      : ok.filter((x) => x.finish[0] !== 1 && x.finish[0] !== boat);
  const course = (x, b) => x.course_by_boat?.[b - 1] ?? null;
  const st = (x, b) => {
    const c = course(x, b);
    return c ? (x.st_by_course?.[c - 1] ?? null) : null;
  };
  const stRank = (x, b) => {
    const v = st(x, b);
    if (v === null) return null;
    return (
      1 +
      [1, 2, 3, 4, 5, 6].filter((o) => st(x, o) !== null && st(x, o) < v).length
    );
  };
  const F = {
    b1d: (x) => !x.finish.slice(0, 3).includes(1),
    b1s: (x) => (stRank(x, 1) ?? 0) >= 4,
    st1: (x) => stRank(x, boat) === 1,
    md: (x) => (course(x, boat) ?? boat) < boat,
  };
  const keys = boat === 1 ? ["st1"] : ["b1d", "b1s", "st1", "md"];
  const pair = (rows, f, cls) => {
    const x = rows.filter(f).length;
    const n = rows.length;
    const ci = n ? wilsonInterval(x, n) : null;
    return (
      <div className="af-pr">
        <span className="af-trk" style={{ height: 9 }}>
          <span
            className={`af-trk-f ${cls}`}
            style={{ width: `${n ? (x / n) * 100 : 0}%` }}
          />
          {ci && (
            <span
              className="af-trk-w"
              style={{
                left: `${ci[0] * 100}%`,
                width: `${(ci[1] - ci[0]) * 100}%`,
              }}
            />
          )}
        </span>
        <span className="af-num">{`${x}/${n}`}</span>
      </div>
    );
  };
  return (
    <div className="af-other">
      <h4 className="af-h4">
        <BoatBadge n={boat} size="sm" />{" "}
        {t(`${k}.otherTitle`, { b: boat, n: hit.length })}
      </h4>
      <div className="af-key">
        <span>
          <i className="is-hit" />
          {t(`${k}.otherHit`, { b: boat })}
        </span>
        <span>
          <i className="is-base" />
          {t(`${k}.otherBase`, {
            name:
              boat === 1
                ? t(`${k}.otherBase1`)
                : t(`${k}.otherBaseK`, { b: boat }),
            n: base.length,
          })}
        </span>
      </div>
      {!hit.length ? (
        <p className="af-warn">
          {t(`${k}.otherNone`, { n: neighbors.length, b: boat })}
        </p>
      ) : (
        keys.map((q) => (
          <div key={q} className="af-ind">
            <span>{t(`${k}.other.${q}`, { b: boat })}</span>
            <div className="af-pair-bars">
              {pair(hit, F[q], "is-hit")}
              {pair(base, F[q], "is-base")}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

/**
 * 類似レース（タブ2、spec FR-B、screens S-1b）
 * @param {{data: object, stage: "racecard"|"exhibition", target: 1|2|3, exhibition: object|null}} props
 *   data は similar の応答、exhibition は facts の今日の展示（展示後の「今日: …」の値）
 */
export default function SimilarRacesTab({
  data,
  stage,
  target,
  exhibition,
  feedback,
}) {
  const { t } = useTranslation();
  const [stepIdx, setStepIdx] = useState(null);
  const [boat, setBoat] = useState(null);
  const [open, setOpen] = useState(null);
  const [not1, setNot1] = useState(false);
  const [cmpExpanded, setCmpExpanded] = useState(false);
  const exhibitionStage = stage === "exhibition";

  if (data.status === "empty_layer")
    return <p className="af-v16-line">{t(`${k}.emptyLayer`)}</p>;
  const sim = data.similar;
  if (!sim?.neighbors?.length)
    return (
      <p className="af-v16-line">
        {t("aiPredictionTab.analogy.states.notSaved")}
      </p>
    );

  const all = sim.neighbors.map(normalizeNeighbor);
  const steps = sliderSteps(all.length);
  const idx = Math.min(stepIdx ?? defaultStepIndex(steps), steps.length - 1);
  const N = steps[idx];
  const nb = all.slice(0, N);
  const items = visibleItems(exhibitionStage);
  const ag = aggregateNeighbors(nb);
  const today = todayDisplay(
    sim.today_display ?? null,
    exhibitionStage ? exhibition : null,
  );
  const far = nb[nb.length - 1];
  const farC = far ? neighborCounts(far, exhibitionStage) : null;
  const allShown = N >= sim.n_layer;
  const cmp = sim.compare;
  const cmpKind = layerKind(cmp?.conditions, t);
  const cmpName =
    cmp?.name === "grade"
      ? t(`${k}.cmpGrade`, { kind: cmpKind ?? "" })
      : cmp?.name === "round"
        ? t(`${k}.cmpRound`, {
            round: sim.conditions?.round
              ? t(`aiPredictionTab.analogy.rounds.${sim.conditions.round}`)
              : "",
          })
        : t(`${k}.cmpSame`);
  const cmpRate = (arr, b) => (cmp?.n ? arr[b - 1] / cmp.n : null);
  const tk = TARGET[target];
  const natRate = (b) =>
    sim.national?.n ? sim.national[tk]?.[b - 1] / sim.national.n : null;
  const tip = boat
    ? boatTip(t, boat, ag.hit[target][boat - 1], ag.n, [
        t(`${k}.tipNational`, { p: fmtPct(natRate(boat)) }),
        ...(cmp?.n && cmp[tk]
          ? [`${cmpName}${fmtPct(cmpRate(cmp[tk], boat))}`]
          : []),
      ])
    : null;
  const selectBoat = (b) => setBoat(boat === b ? null : b);
  const pick = (id) => {
    setOpen(id);
    setCmpExpanded(true);
    requestAnimationFrame(() =>
      document
        .getElementById(`af-nb-${id}`)
        ?.scrollIntoView({ block: "nearest", behavior: "smooth" }),
    );
  };
  const [, , , venueCode, raceNumber] = String(sim.race_id ?? "").split("-");
  const techRef =
    cmp?.technique && cmp.n
      ? Object.fromEntries(
          Object.entries(cmp.technique).map(([kk, v]) => [kk, v / cmp.n]),
        )
      : null;

  return (
    <div className="af-tab-similar">
      <h3 className="af-h3">{t(`${k}.heading`)}</h3>
      {/* 並べ方は1行に縮め、全文は折りたたみに（承認モック sonar-tab v3） */}
      <p className="af-sub">
        {layerKind(sim.conditions, t)
          ? t(`${k}.ledeShortKind`, {
              kind: layerKind(sim.conditions, t),
              n: fmtCount(sim.n_layer ?? all.length),
            })
          : t(`${k}.ledeShort`, { n: fmtCount(sim.n_layer ?? all.length) })}
      </p>
      <details className="af-details">
        <summary>{t(`${k}.ledeFull`)}</summary>
        <NoteList
          className="is-lede"
          texts={[
            `${describeAnalogyLayer(sim.conditions, t, { count: sim.n_layer })}${t(`${k}.ledeTail`)}`,
          ]}
        />
      </details>
      {/* 件数のスライダーは見出し・並べ方の説明の後（UI/UX レビュー: 操作がどのまとまりのものか分かるように） */}
      <SimilarSonar
        neighbors={nb}
        selectedBoat={boat}
        onBoat={selectBoat}
        picked={open}
        onPick={pick}
        todayLabel={t(`${k}.todayLabel`, {
          venue: venueLabel(Number(venueCode), t),
          r: Number(raceNumber),
        })}
        legend={<SonarLegend />}
        figTop={
          <>
            <div className="af-slider">
              <div className="af-ctl-row af-between">
                <label className="af-lbl" htmlFor="af-sim-slider">
                  {t(`${k}.sliderLabel`)}
                </label>
                <span className="af-sv">
                  <b>
                    {t("aiPredictionTab.analogy.count", { n: fmtCount(N) })}
                  </b>
                </span>
              </div>
              <p className="af-foot">{t(`${k}.outerIs`, { n: fmtCount(N) })}</p>
              <input
                id="af-sim-slider"
                data-af-control="similar_range"
                type="range"
                min={0}
                max={steps.length - 1}
                step={1}
                value={idx}
                aria-valuetext={t("aiPredictionTab.analogy.count", {
                  n: fmtCount(N),
                })}
                onChange={(e) => {
                  setStepIdx(Number(e.target.value));
                  setBoat(null);
                }}
              />
              <div className="af-ctl-row af-between">
                <span className="af-foot">{t(`${k}.fewer`)}</span>
                <span className="af-foot">{t(`${k}.more`)}</span>
              </div>
              <p className="af-foot">{t(`${k}.sliderZoom`)}</p>
              {farC && (
                <p className="af-foot">
                  {t(`${k}.farthest`, {
                    n: N,
                    total: farC.total,
                    same: farC.same,
                    near: farC.near,
                  })}
                </p>
              )}
            </div>
          </>
        }
      >
        <SimilarityItems
          neighbors={nb}
          items={items}
          exhibitionStage={exhibitionStage}
          conditions={sim.conditions}
          poolRate={sim.pool_rate}
          poolRateExhibition={sim.pool_rate_exhibition === true}
          today={today}
        />
        <SimilarCompareList
          neighbors={nb}
          items={items}
          exhibitionStage={exhibitionStage}
          today={today}
          open={open}
          onOpen={setOpen}
          expanded={cmpExpanded}
          onExpanded={setCmpExpanded}
        />

        <h3 className="af-h3">{t(`${k}.resHeading`)}</h3>
        <div className="af-hero">
          <span className="af-hero-n">
            {t("aiPredictionTab.analogy.count", { n: fmtCount(ag.n) })}
          </span>
          <span className="af-sub">
            {t(`${k}.resSub`, { n: fmtCount(ag.n) })}
            {/* 結果の無いレース（返還・不成立など）は決まり方の集計から外すので、スライダーの件数より少ないことがある */}
            {ag.n < nb.length &&
              t(`${k}.resExcluded`, { k: fmtCount(nb.length - ag.n) })}
          </span>
        </div>
        <h4 className="af-h4">
          {target === 1
            ? t(`${k}.winHeading`)
            : t(`${k}.hitHeading`, {
                finish: t(`aiPredictionTab.analogy.targets.${target}`),
              })}
        </h4>
        <div className="af-key">
          <span>
            <i className="is-bar" />
            {t(`${k}.keySimilar`)}
          </span>
          {cmp?.n > 0 && (
            <span>
              <i className="is-dot" />
              {t(`${k}.keyCompare`, { name: cmpName, n: fmtCount(cmp.n) })}
            </span>
          )}
          <span>
            <i className="is-err" />
            {t(`${k}.keyErr`)}
          </span>
        </div>
        <BoatBars
          counts={ag.hit[target]}
          n={ag.n}
          reference={[1, 2, 3, 4, 5, 6].map((b) =>
            cmp?.[tk] ? cmpRate(cmp[tk], b) : null,
          )}
          selected={boat}
          onSelect={selectBoat}
        />
        <p className="af-tip" role="status">
          {tip ?? ""}
        </p>
        {N < FEW_SIMILAR ? (
          <p className="af-warn">
            {t(`${k}.few`, { n: fmtCount(N) })}
            {allShown ? t(`${k}.allShownAfterFew`) : ""}
          </p>
        ) : allShown ? (
          <p className="af-foot">{t(`${k}.allShown`)}</p>
        ) : null}
        <h4 className="af-h4">{t(`${k}.techHeading`)}</h4>
        <TechniqueBars counts={ag.tech} n={ag.n} reference={techRef} />
        <OtherBoats neighbors={nb} boat={boat} />
      </SimilarSonar>
      {/* PC では着順の流れを左、よく出た3連単を右に（BOA-813） */}
      <AnalogySplit
        fig={
          <>
            <h4 className="af-h4">
              {t("aiPredictionTab.analogy.flow.heading")}
            </h4>
            <FinishSankey
              tri={ag.tri}
              first={boat}
              onFirst={setBoat}
              not1={not1}
              onNot1={setNot1}
            />
          </>
        }
      >
        <h4 className="af-h4">{t(`${k}.triHeading`)}</h4>
        <TrifectaList tri={ag.tri} first={boat} not1={not1} />
      </AnalogySplit>
      {feedback}
      <NotesFold title={t("aiPredictionTab.analogy.notes.methodCaution")}>
        <NoteList
          title={t(`aiPredictionTab.analogy.notes.caution`)}
          texts={[t(`${k}.foot`)]}
        />
      </NotesFold>
    </div>
  );
}
