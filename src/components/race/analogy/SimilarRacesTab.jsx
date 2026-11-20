import { useState } from "react";
import { useTranslation } from "react-i18next";
import NoteList, { NotesFold } from "./NoteList";
import {
  SonarLegend,
  OtherBoats,
  SimilarLede,
  SimilarSlider,
  SimilarFlow,
} from "./SimilarRacesParts";
import SimilarSonar from "./SimilarSonar";
import SimilarityItems from "./SimilarityItems";
import SimilarCompareList from "./SimilarCompareList";
import { BoatBars, TechniqueBars } from "./OutcomeBars";
import { boatTip } from "../../../utils/analogyTips";
import {
  FEW_SIMILAR,
  neighborCounts,
  similarSlice,
  visibleItems,
} from "../../../utils/analogyAggregate";
import { layerKind } from "../../../utils/analogyLayer";
import { fmtCount, fmtPct, venueLabel } from "../../../utils/analogyFormat";
import { todayDisplay } from "../../../utils/analogySimilarDisplay";

const k = "aiPredictionTab.analogy.similar";
const TARGET = { 1: "winner", 2: "top2", 3: "top3" };

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
