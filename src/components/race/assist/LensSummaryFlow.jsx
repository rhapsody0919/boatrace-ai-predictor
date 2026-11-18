import BaseBar from "./BaseBar";
import {
  attackTech,
  entrySummary,
  exhBands,
  exhToday,
  originalBest,
  formSummary,
} from "../../../utils/assistSummary";
import { entryType } from "../../../utils/analogyScenario";
import { ASSIST_COPY as C } from "../../../data/thinkingAssistCopy";
import { TheoryButton } from "./SheetButtons";
import { p0, comma } from "./lensSummaryFormat";
import {
  FlowIfBox,
  ExhBandsBox,
  FlowEntryBox,
  OrgBestBox,
  SimilarTechBox,
} from "./LensSummaryFlowBoxes";

/** FlowConclusion の表示用の値（形の名前・展示の形・今日の展示・当てはまる率）を m から求める */
function flowConclusionDerived(m) {
  const { scenario, post, v16Exhibition, courseByBoat, exhRanks } = m;
  const top = m.hint;
  const formName = top ? C.formNames[top.form] : null;
  const exhForm =
    post && top && v16Exhibition?.forms?.includes?.(top.form) ? true : false;
  const entry = entryType(courseByBoat ?? []);
  const ex =
    post && top && (!entry || entry === "waku")
      ? exhToday(scenario, top.form, exhRanks)
      : null;
  const hitP = top ? p0(top.hit[0], top.hit[1]) : null;
  return { formName, exhForm, ex, hitP };
}

/**
 * 展開レンズの図の上の結論（spec D-47 (3)、承認モック v2）: 本番のスタートの形の見立てと基準、展示後は今日の展示1行。
 * 今日の展示は攻める艇の展示タイムの順位の区分で、その形のときの攻める艇の1着（枠なりのレース）。展示の進入が
 * 枠なりでないと分かった日は、攻める艇のコースが変わるので出さない
 */
export function FlowConclusion({ m }) {
  const { scenario, post, reflecting, round, hint: top, forms = [] } = m;
  const { onForm, basis } = m;
  if (!scenario) return null;
  const { formName, exhForm, ex, hitP } = flowConclusionDerived(m);
  return (
    <section className="ta-box ta-flow-concl">
      <h3 className="ta-h3-row">
        {C.flowShapeHeading}
        {top && (
          <TheoryButton
            id={`TC-H:${top.id}`}
            name={C.theoryHintTitle(formName)}
            className="ta-th-hit"
          >
            {C.theoryHintButton}
          </TheoryButton>
        )}
      </h3>
      {top ? (
        <FlowHintBody
          top={top}
          forms={forms}
          onForm={onForm}
          formName={formName}
          hitP={hitP}
          round={round}
          exhForm={exhForm}
          basis={basis}
        />
      ) : (
        <p className="ta-note">{C.flowNoHint}</p>
      )}
      {ex && <FlowToday ex={ex} formName={formName} />}
      {post && reflecting && <p className="ta-note">{C.stateReflecting}</p>}
    </section>
  );
}

/** 結論の形の選択（2つ以上）または大きい数字（1つ） */
function FlowFormPick({ top, forms, onForm, formName, hitP }) {
  if (forms.length > 1) {
    // 形が2つ以上当てはまるときは同じ形式で並べ、選んだ形で下の「もし」「今日の展示」が変わる（承認モック v2 ④）
    return (
      <>
        <p className="ta-note">{C.flowFormPickNote(forms.length)}</p>
        <div className="ta-form-pick" role="group" aria-label={C.flowFormPick}>
          {forms.map((f) => (
            <button
              key={f.form}
              type="button"
              className="ta-form-opt"
              aria-pressed={f.form === top.form}
              onClick={() => f.form !== top.form && onForm(f.form)}
            >
              <b>{C.formNames[f.form]}</b>
              <span className="ta-big-cnt">{C.flowShapeRow}</span>
              <span className="ta-big-pct ta-num">
                {p0(f.hit[0], f.hit[1])}%
              </span>
              <span className="ta-big-cnt ta-num">
                （{comma(f.hit[0])}/{comma(f.hit[1])}）
              </span>
            </button>
          ))}
        </div>
      </>
    );
  }
  return (
    <div className="ta-big">
      <b>{formName}</b>
      <span className="ta-big-cnt">{C.flowShapeRow}</span>
      <span className="ta-big-pct ta-num">{hitP}%</span>
      <span className="ta-big-cnt ta-num">
        （{comma(top.hit[0])}/{comma(top.hit[1])}）
      </span>
    </div>
  );
}

/** 見立てがあるときの本体（形の選択・札・条件・比べる棒・注記） */
function FlowHintBody({
  top,
  forms,
  onForm,
  formName,
  hitP,
  round,
  exhForm,
  basis,
}) {
  return (
    <>
      <FlowFormPick
        top={top}
        forms={forms}
        onForm={onForm}
        formName={formName}
        hitP={hitP}
      />
      <div className="ta-legend">
        <span className="ta-scopechip ta-num">
          {/* 進入の札と件数が違う理由を添える（BOA-808 P3・BOA-809） */}
          {C.scopeChipWhy(
            C.flowScopeLabel(Boolean(round)),
            top.hit[1] + top.miss[1],
            C.scopeWhy.hint,
          )}
        </span>
      </div>
      <div className="ta-chk">
        <span>✓ {C.hintConds[top.id]}</span>
        {exhForm && <span>✓ {C.flowExhForm(formName)}</span>}
      </div>
      {/* 大きい数字と同じ「当てはまるとき」の棒は出さず、比べる相手（当てはまらないとき）の棒だけ（ユーザー決定 B） */}
      <BaseBar label={C.flowMissBar} k={top.miss[0]} n={top.miss[1]} />
      <p className="ta-note ta-num">
        {C.flowShapeBase(p0(top.miss[0], top.miss[1]), hitP)}
      </p>
      {basis === "overall" && <p className="ta-note">{C.flowHintBasis}</p>}
    </>
  );
}

/** 今日の展示1行 */
function FlowToday({ ex, formName }) {
  return (
    <p className="ta-flow-today ta-num">
      {C.flowToday(ex.att, ex.rank, C.exhBand[ex.band], formName)}
      {ex.few ? (
        C.flowTodayFew(ex.n)
      ) : (
        <>
          {C.flowTodayWin} <b>{p0(ex.k, ex.n)}%</b>（{ex.k}/{ex.n}）
        </>
      )}
    </p>
  );
}

/** 展開レンズの「もし」の箱の材料（形の名前・集計・決まり手・範囲の札） */
function flowIfView(m) {
  const { scenario, round, hint: top } = m;
  const formName = top ? C.formNames[top.form] : null;
  const form = top ? formSummary(scenario, top.form) : null;
  const tech = top ? attackTech(scenario, top.form) : null;
  const scopeText = form
    ? C.flowFormScope(C.flowScopeLabel(Boolean(round)), form.n)
    : null;
  return { formName, form, tech, scopeText };
}

/** 展示タイムの順位の区分の材料と、枠なりでないときの注記 */
function flowBandsView(m, entry) {
  const { scenario, national, post, exhRanks, hint: top } = m;
  const bands =
    top && post ? exhBands(scenario, national, top.form, exhRanks) : null;
  const notWaku =
    entry && entry.type !== "waku"
      ? C.flowNotWaku(C.entryNames[entry.type])
      : null;
  return { bands, notWaku };
}

export function FlowSummary({ m }) {
  const {
    scenario,
    post,
    courseByBoat,
    similar,
    racecardStage,
    round,
    original,
    racers,
    venue,
    onPower,
    onBet,
  } = m;
  const view = flowIfView(m);
  const entry = post ? entrySummary(scenario, courseByBoat) : null;
  const { bands, notWaku } = flowBandsView(m, entry);
  const best = post ? originalBest(original, racers) : [];
  return (
    <>
      <FlowIfBox view={view} onBet={onBet} />
      {view.form && (
        <ExhBandsBox
          post={post}
          bands={bands}
          formLabel={view.scopeText}
          notWaku={notWaku}
        />
      )}
      <FlowEntryBox entry={entry} post={post} round={round} />
      <OrgBestBox best={best} venue={venue} onPower={onPower} />
      <SimilarTechBox similar={similar} racecardStage={racecardStage} />
    </>
  );
}
