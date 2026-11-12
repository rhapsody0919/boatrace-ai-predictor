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
  neighborCounts,
  similarSlice,
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

/** 比べる相手（点線）の名前（同じ条件・級をそろえない・準優勝戦以外も含めた） */
function compareName(sim, t) {
  const cmp = sim.compare;
  const cmpKind = layerKind(cmp?.conditions, t);
  return cmp?.name === "grade"
    ? t(`${k}.cmpGrade`, { kind: cmpKind ?? "" })
    : cmp?.name === "round"
      ? t(`${k}.cmpRound`, {
          round: sim.conditions?.round
            ? t(`aiPredictionTab.analogy.rounds.${sim.conditions.round}`)
            : "",
        })
      : t(`${k}.cmpSame`);
}

/**
 * どの艇が勝った？（着順 target の棒。見出し・凡例・6艇の棒）。タブと撮影用の頁（src/snsCapture、完全版 f01 の撮影）が同じ部品を描く
 * @param {{sim: object, ag: ReturnType<import("../../../utils/analogyAggregate").aggregateNeighbors>, target: 1|2|3,
 *   boat?: number|null, onSelect?: (boat: number) => void}} props sim は similar の応答の similar
 */
export function SimilarWinBars({ sim, ag, target, boat = null, onSelect }) {
  const { t } = useTranslation();
  const cmp = sim.compare;
  const cmpName = compareName(sim, t);
  const cmpRate = (arr, b) => (cmp?.n ? arr[b - 1] / cmp.n : null);
  const tk = TARGET[target];
  return (
    <>
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
        onSelect={onSelect}
      />
    </>
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

/** 画面の状態（スライダー位置・選んだ艇・開いた近傍・1号艇以外・着順の流れの帯・比較の展開） */
function useSimilarControls() {
  const [stepIdx, setStepIdx] = useState(null);
  const [boat, setBoat] = useState(null);
  const [open, setOpen] = useState(null);
  const [not1, setNot1] = useState(false);
  // 着順の流れで押した帯（よく出た3連単をその帯の内訳に絞る。BOA-816）
  const [band, setBand] = useState(null);
  const [cmpExpanded, setCmpExpanded] = useState(false);
  const selectBoat = (b) => {
    const next = boat === b ? null : b;
    setBoat(next);
    // 1号艇を選んだら「1号艇以外が勝ったレース」を外す（両立しないので0件になっていた。ユーザー指摘 2026-10-10）
    if (next === 1 && not1) setNot1(false);
  };
  const pick = (id) => {
    setOpen(id);
    setCmpExpanded(true);
    requestAnimationFrame(() =>
      document
        .getElementById(`af-nb-${id}`)
        ?.scrollIntoView({ block: "nearest", behavior: "smooth" }),
    );
  };
  return {
    stepIdx,
    setStepIdx,
    boat,
    setBoat,
    open,
    setOpen,
    not1,
    setNot1,
    band,
    setBand,
    cmpExpanded,
    setCmpExpanded,
    selectBoat,
    pick,
  };
}

/** 選んだ艇のひとことの文（全国・比べる相手の率つき）。艇が無ければ null */
function boatTipText({ t, sim, ag, target, boat }) {
  if (!boat) return null;
  const cmp = sim.compare;
  const cmpName = compareName(sim, t);
  const cmpRate = (arr, b) => (cmp?.n ? arr[b - 1] / cmp.n : null);
  const tk = TARGET[target];
  const natRate = (b) =>
    sim.national?.n ? sim.national[tk]?.[b - 1] / sim.national.n : null;
  return boatTip(t, boat, ag.hit[target][boat - 1], ag.n, [
    t(`${k}.tipNational`, { p: fmtPct(natRate(boat)) }),
    ...(cmp?.n && cmp[tk]
      ? [`${cmpName}${fmtPct(cmpRate(cmp[tk], boat))}`]
      : []),
  ]);
}

/** 決まり方の比べる相手の率（無ければ null） */
function techReference(cmp) {
  return cmp?.technique && cmp.n
    ? Object.fromEntries(
        Object.entries(cmp.technique).map(([kk, v]) => [kk, v / cmp.n]),
      )
    : null;
}

/** 見出しの下の並べ方の1行と、全文の折りたたみ */
function SimilarLede({ sim, count }) {
  const { t } = useTranslation();
  return (
    <>
      {/* 並べ方は1行に縮め、全文は折りたたみに（承認モック sonar-tab v3） */}
      <p className="af-sub">
        {layerKind(sim.conditions, t)
          ? t(`${k}.ledeShortKind`, {
              kind: layerKind(sim.conditions, t),
              n: fmtCount(count),
            })
          : t(`${k}.ledeShort`, { n: fmtCount(count) })}
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
    </>
  );
}

/** 件数のスライダー（ソナーの図の上） */
function SimilarSlider({ N, steps, idx, farC, onStep }) {
  const { t } = useTranslation();
  return (
    <>
      <div className="af-slider">
        <div className="af-ctl-row af-between">
          <label className="af-lbl" htmlFor="af-sim-slider">
            {t(`${k}.sliderLabel`)}
          </label>
          <span className="af-sv">
            <b>{t("aiPredictionTab.analogy.count", { n: fmtCount(N) })}</b>
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
          onChange={(e) => onStep(Number(e.target.value))}
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
  );
}

/** 件数が少ない・全件のときの注意の行 */
function FewNote({ N, allShown }) {
  const { t } = useTranslation();
  if (N < FEW_SIMILAR)
    return (
      <p className="af-warn">
        {t(`${k}.few`, { n: fmtCount(N) })}
        {allShown ? t(`${k}.allShownAfterFew`) : ""}
      </p>
    );
  return allShown ? <p className="af-foot">{t(`${k}.allShown`)}</p> : null;
}

/** 結果（件数の見出し・どの艇が勝った・ひとこと・決まり方・ほかの艇） */
function SimilarResults({ sim, nb, ag, target, ctl, N, allShown }) {
  const { t } = useTranslation();
  const { boat, selectBoat } = ctl;
  const tip = boatTipText({ t, sim, ag, target, boat });
  return (
    <>
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
      <SimilarWinBars
        sim={sim}
        ag={ag}
        target={target}
        boat={boat}
        onSelect={selectBoat}
      />
      <p className="af-tip" role="status">
        {tip ?? ""}
      </p>
      <FewNote N={N} allShown={allShown} />
      <h4 className="af-h4">{t(`${k}.techHeading`)}</h4>
      <TechniqueBars
        counts={ag.tech}
        n={ag.n}
        reference={techReference(sim.compare)}
      />
      <OtherBoats neighbors={nb} boat={boat} />
    </>
  );
}

/** ソナーの中身（似ている点・近傍の比較・結果） */
function SimilarBody({ sim, view, ctl, target, exhibitionStage }) {
  const { nb, ag, N, items, today } = view;
  return (
    <>
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
        open={ctl.open}
        onOpen={ctl.setOpen}
        expanded={ctl.cmpExpanded}
        onExpanded={ctl.setCmpExpanded}
      />
      <SimilarResults
        sim={sim}
        nb={nb}
        ag={ag}
        target={target}
        ctl={ctl}
        N={N}
        allShown={view.allShown}
      />
    </>
  );
}

/** 着順の流れ（左）とよく出た3連単（右）。PC では横並び（BOA-813） */
function SimilarFlow({ ag, ctl }) {
  const { t } = useTranslation();
  return (
    <AnalogySplit
      fig={
        <>
          <h4 className="af-h4">{t("aiPredictionTab.analogy.flow.heading")}</h4>
          <FinishSankey
            tri={ag.tri}
            first={ctl.boat}
            onFirst={ctl.setBoat}
            not1={ctl.not1}
            onNot1={ctl.setNot1}
            band={ctl.band}
            onBand={ctl.setBand}
          />
        </>
      }
    >
      <h4 className="af-h4">{t(`${k}.triHeading`)}</h4>
      <TrifectaList
        tri={ag.tri}
        first={ctl.boat}
        not1={ctl.not1}
        band={ctl.band}
      />
    </AnalogySplit>
  );
}

/** 表示する近傍・集計・今日の値をまとめる */
function similarView(sim, stepIdx, exhibitionStage, exhibition) {
  const slice = similarSlice(sim.neighbors, stepIdx);
  const far = slice.nb[slice.nb.length - 1];
  return {
    ...slice,
    items: visibleItems(exhibitionStage),
    today: todayDisplay(
      sim.today_display ?? null,
      exhibitionStage ? exhibition : null,
    ),
    farC: far ? neighborCounts(far, exhibitionStage) : null,
    allShown: slice.N >= sim.n_layer,
  };
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
  const ctl = useSimilarControls();
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

  const view = similarView(sim, ctl.stepIdx, exhibitionStage, exhibition);
  const { all, steps, idx, N, nb, farC } = view;
  const [, , , venueCode, raceNumber] = String(sim.race_id ?? "").split("-");

  return (
    <div className="af-tab-similar">
      <h3 className="af-h3">{t(`${k}.heading`)}</h3>
      <SimilarLede sim={sim} count={sim.n_layer ?? all.length} />
      {/* 件数のスライダーは見出し・並べ方の説明の後（UI/UX レビュー: 操作がどのまとまりのものか分かるように） */}
      <SimilarSonar
        neighbors={nb}
        selectedBoat={ctl.boat}
        onBoat={ctl.selectBoat}
        picked={ctl.open}
        onPick={ctl.pick}
        todayLabel={t(`${k}.todayLabel`, {
          venue: venueLabel(Number(venueCode), t),
          r: Number(raceNumber),
        })}
        legend={<SonarLegend />}
        figTop={
          <SimilarSlider
            N={N}
            steps={steps}
            idx={idx}
            farC={farC}
            onStep={(i) => {
              ctl.setStepIdx(i);
              ctl.setBoat(null);
            }}
          />
        }
      >
        <SimilarBody
          sim={sim}
          view={view}
          ctl={ctl}
          target={target}
          exhibitionStage={exhibitionStage}
        />
      </SimilarSonar>
      <SimilarFlow ag={view.ag} ctl={ctl} />
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
