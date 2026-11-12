import { useEffect, useRef, useState } from "react";
import BoatBadge from "../BoatBadge";
import RunsTable from "./RunsTable";
import RacerLink from "./RacerLink";
import { restClassCounts } from "../../../utils/assistModel";
import {
  b1Usual,
  featChips,
  meetRuns,
  priorRuns,
} from "../../../utils/assistSummary";
import { ASSIST_COPY as C } from "../../../data/thinkingAssistCopy";
import { TermButton, TheoryButton } from "./SheetButtons";
import { Feat } from "./BoatDeepDiveParts";
import DeepKv from "./BoatDeepDiveKv";
import { AllFacts, TopFacts } from "./BoatDeepDiveFacts";
import { baseText, scopeLabelOf, topFactChips } from "./BoatDeepDiveModel";

/** 見出し（艇・名前・級・体重・閉じる） */
function DeepHead({ boat, racer, weight, onClose }) {
  return (
    <div className="ta-deep-head">
      <BoatBadge n={boat} />
      <h3>
        {/* フルネームは選手ページへのリンク（BOA-879 案B、2026-10-15 オーナー決定）。艇の行は深掘りを開くボタンのまま */}
        <RacerLink racerId={racer.racerId} className="ta-link">
          {racer.name}
          {racer.racerId ? " ›" : ""}
        </RacerLink>{" "}
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
  );
}

/** 開いたら深掘りの上端まで送る。図の下に開くので、送らないと押した結果が画面の外になる（デザイナーのレビュー P1-1）
 * 軸の要約の入口から▲の無い日に開いたときは、開いた「全部の材料」まで送る（2026-10-11 ユーザー決定 案D） */
function useDeepScroll(boat, openAll) {
  const ref = useRef(null);
  const allRef = useRef(null);
  useEffect(() => {
    const reduce = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    )?.matches;
    ((openAll && allRef.current) || ref.current)?.scrollIntoView?.({
      block: "start",
      behavior: reduce ? "auto" : "smooth",
    });
  }, [boat, openAll]);
  return { ref, allRef };
}

/** 走の取得結果から出す今節・前の走 */
function runsDerived(runs, raceId) {
  const ready = runs.status === "ready" && Array.isArray(runs.data);
  if (!ready) return { meet: null, prior: [] };
  const meet = meetRuns(runs.data, raceId);
  return {
    meet,
    prior: priorRuns(runs.data, raceId, [...meet.past, ...meet.today]),
  };
}

/**
 * 深掘り（FR-5、screens S-1 E）。艇の丸を押すと開き、「閉じる」で戻る。数字を押すと図が6艇比較になる（2段目）。
 * 今節の走・今節より前の5走は開いたときに取る（3段目）。優勝戦・準優勝戦の日は今節の点の順位・「今節好調」を出さない
 * @param {{boat: number, racer: object, venue: string, raceId: string, today: object|null, post: boolean,
 *   finalRound: boolean, round: string|null, scope: object|null, chips: object[], runs: {status: string, data: object[]|null},
 *   technique: object|null, pretest: object|null, weight: number|null, course: number,
 *   onMetric: (metric: string, boat: number) => void, onClose: () => void, openAll?: boolean}} props
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
  openAll = false,
  target = 1,
}) {
  const [runsOpen, setRunsOpen] = useState(false);
  const { ref, allRef } = useDeepScroll(boat, openAll);
  const i = boat - 1;
  const feats = featChips({ boat, today, finalRound, technique });
  const { meet, prior } = runsDerived(runs, raceId);
  const counts = restClassCounts(today?.classes, boat);
  const topChips = topFactChips(chips);
  const base = baseText(b1Usual(scope, boat, target));
  const scopeLabel = scopeLabelOf(scope, venue, boat, today?.classes?.[i]);

  return (
    <section ref={ref} className="ta-deep" aria-label={C.deepRegion(boat)}>
      <DeepHead boat={boat} racer={racer} weight={weight} onClose={onClose} />
      {scope && topChips.length > 0 && (
        <TopFacts
          boat={boat}
          topChips={topChips}
          scopeLabel={scopeLabel}
          base={base}
          round={round}
          target={target}
        />
      )}
      {feats.length > 0 && (
        <div className="ta-feat" aria-label={C.featTitle} role="group">
          {feats.map((f) => (
            <Feat key={f.id} chip={f} venue={venue} />
          ))}
          <TermButton term={C.featTitle} />
        </div>
      )}
      <DeepKv
        boat={boat}
        racer={racer}
        venue={venue}
        raceId={raceId}
        today={today}
        post={post}
        finalRound={finalRound}
        round={round}
        runs={runs}
        meet={meet}
        technique={technique}
        pretest={pretest}
        course={course}
        onMetric={onMetric}
        runsOpen={runsOpen}
        setRunsOpen={setRunsOpen}
      />
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
        <AllFacts
          boat={boat}
          chips={chips}
          today={today}
          scope={scope}
          venue={venue}
          post={post}
          counts={counts}
          i={i}
          scopeLabel={scopeLabel}
          base={base}
          round={round}
          target={target}
          openAll={openAll}
          allRef={allRef}
        />
      )}
    </section>
  );
}
