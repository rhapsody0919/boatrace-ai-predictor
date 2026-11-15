import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import ScopeCombo from "./ScopeCombo";
import ScenarioRacePanel from "./ScenarioRacePanel";
import BoatBadge from "../BoatBadge";
import {
  fmtCount,
  fmtPct,
  scopeName,
  venueLabel,
} from "../../../utils/analogyFormat";
import {
  hintBadgeByForm,
  hintRows,
  minRanks,
} from "../../../utils/analogyScenario";
import { scopeKind } from "../../../utils/analogyFacts";
import { trifectaList } from "../../../utils/analogyAggregate";
import { wilsonInterval } from "../../../utils/wilson";
import { k, SCOPES } from "./scenario/consts";
import { useRacePick } from "./scenario/useRacePick";
import { scenarioHandlers } from "./scenario/scenarioHandlers";
import { racePanelTitle } from "./scenario/racePanelTitle";
import ScenarioResult from "./scenario/ScenarioResult";
import ScenarioEntryStep from "./scenario/ScenarioEntryStep";
import ScenarioSlitStep from "./scenario/ScenarioSlitStep";
import ScenarioAttackStep from "./scenario/ScenarioAttackStep";
import ScenarioNotes from "./scenario/ScenarioNotes";

/** 状態（hooks の呼ぶ順は元のまま） */
function useScenarioState({
  data,
  stage,
  raceId,
  initialFirst,
  onInitialFirstUsed,
}) {
  const [entry, setEntry] = useState("waku");
  const [slit, setSlit] = useState("any");
  const [version, setVersion] = useState("course");
  // 初期のセル（枠なり・形は問わない）でその艇の1着が0件なら使わない。流れが空になり、
  // 1着の四角も消えて選択を外せなくなるため
  const [first, setFirst] = useState(() =>
    initialFirst !== null &&
    trifectaList(data.scenario?.cells?.waku?.forms?.any?.tri, {
      first: initialFirst,
    }).length > 0
      ? initialFirst
      : null,
  );
  // 初期値は描画できたときに使い切る。内部タブを戻しても再選択しない
  useEffect(() => {
    onInitialFirstUsed?.();
  }, [onInitialFirstUsed]);
  const [not1, setNot1] = useState(false);
  // 着順の流れで押した帯（よく出た3連単をその帯の内訳に絞る。BOA-816）
  const [band, setBand] = useState(null);
  const pickState = useRacePick({
    data,
    entry,
    slit,
    first,
    not1,
    band,
    raceId,
    stage,
  });
  // ②は形を選んだら1行に畳む（承認モック mock-scenario-v1）。「変える」・③の文脈の札で開く
  const [slitOpen, setSlitOpen] = useState(false);
  return {
    entry,
    setEntry,
    slit,
    setSlit,
    version,
    setVersion,
    first,
    setFirst,
    not1,
    setNot1,
    band,
    setBand,
    slitOpen,
    setSlitOpen,
    ...pickState,
  };
}

/** セル・ヒント・件数の派生値 */
function deriveCells(data, entry, slit, version) {
  const sc = data.scenario;
  const cells = sc.cells;
  const whole = cells.all.forms.any;
  const waku = entry === "all" || entry === "waku";
  const rows = hintRows(
    sc.hints,
    data.hints?.[version],
    version,
    wilsonInterval,
  );
  const any = sc.hints?.[version]?.kado4?.any;
  return {
    sc,
    cells,
    whole,
    c: cells[entry].forms[slit],
    base: slit !== "any" ? cells[entry].forms.any : whole,
    waku,
    rows,
    badges: waku ? hintBadgeByForm(rows) : {},
    baseN: any ? any.hit[1] + any.miss[1] : 0,
  };
}

/** フライングの艇（展示のコース別 ST が負） */
function flyBoatsOf(exhibition) {
  return exhibition?.course_by_boat
    ? exhibition.course_by_boat
        .map((cr, i) =>
          cr && exhibition.st_by_course[cr - 1] < 0 ? i + 1 : null,
        )
        .filter(Boolean)
    : [];
}

function deriveAgreement(today, exhibition) {
  const agreement = today?.exh_agreement ?? null;
  const todayEntry = exhibition?.entry_type ?? null;
  return {
    agreement,
    todayEntry,
    entryAgree: todayEntry ? agreement?.entry?.[todayEntry] : null,
  };
}

/** 展示・今日の値の派生値 */
function deriveToday(data, today, stage) {
  const exhibition = stage === "exhibition" ? data.exhibition : null;
  const { agreement, todayEntry, entryAgree } = deriveAgreement(
    today,
    exhibition,
  );
  return {
    exhibition,
    agreement,
    todayEntry,
    entryAgree,
    exhForms: exhibition?.forms ?? [],
    flyBoats: flyBoatsOf(exhibition),
    motorRank: minRanks(today?.items?.motor_2?.values ?? [], true),
    cls: today?.classes ?? [],
  };
}

const bar2 = (label, p) => (
  <div className="af-hint-bar af-num">
    <span>{label}</span>
    <span className="af-atk-trk">
      <i style={{ width: `${(p ?? 0) * 100}%` }} />
    </span>
    <b>{fmtPct(p)}</b>
  </div>
);

/** ④の範囲の札（どのレースから出した数字か）。級をそろえない範囲（VA・VG・NA）は件数だけ */
const makeScopeTag = (classScope, cls, t) =>
  function scopeTag(b, n) {
    return (
      <span className="af-scope-tag">
        {classScope && <BoatBadge n={b} size="xs" />}
        {classScope
          ? t(`${k}.atk.scopeTag`, {
              b,
              cls: cls[b - 1] ?? "—",
              n: fmtCount(n),
            })
          : t(`${k}.scopeTagAll`, { n: fmtCount(n) })}
      </span>
    );
  };

function makeRacePanel(st, t, formName) {
  const { racePick, racesRes, entry, slit, first, not1, boatMissing } = st;
  return (group) => {
    if (racePick?.group !== group) return null;
    const title = racePanelTitle(racePick, t);
    return (
      <ScenarioRacePanel
        key={JSON.stringify(racePick)}
        res={racesRes}
        pick={racePick}
        filter={{ entry, form: slit, first, not1 }}
        title={title}
        cond={[t(`${k}.entry.${entry}`), formName(slit)].join(
          t("aiPredictionTab.analogy.listSeparator"),
        )}
        // その艇の範囲の一覧がまだ無い朝の版だけ、1号艇の範囲の一覧で代えて断る（BOA-833）
        otherScope={boatMissing}
        onClose={() => st.setPicked(null)}
      />
    );
  };
}

/** 範囲の切替・範囲チップ・全国に替えた理由 */
function ScenarioScopeHeader({ data, raceId, onScope, setFirst, scopeLbl }) {
  const { t } = useTranslation();
  const keys = data.scope_keys ?? {};
  const scopeKey = data.scope;
  return (
    <>
      <p className="af-sub">{t(`${k}.ledeShort`)}</p>
      <div className="af-ctl-row">
        <span className="af-lbl" id={scopeLbl}>
          {t("aiPredictionTab.analogy.facts.scopeLabel")}
        </span>
        <div
          className="af-seg af-seg-44"
          role="group"
          aria-labelledby={scopeLbl}
          data-af-control="scenario_scope"
        >
          {SCOPES.filter((s) => keys[s]).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={keys[s] === scopeKey}
              onClick={() => {
                onScope(keys[s]);
                setFirst(null);
              }}
            >
              {scopeName(keys[s], t, { short: true })}
            </button>
          ))}
        </div>
      </div>
      <ScopeCombo scopeKey={scopeKey} chips />
      {/* 既定で全国に替えたときの理由（spec「数えるレース」。タブ1と同じ1行。範囲を選び直したら API が付けない） */}
      {data.vc_fell_back !== null && data.vc_fell_back !== undefined && (
        <p className="af-sub">
          {t(`${k}.fellBack`, {
            venue: venueLabel(Number(String(raceId).split("-")[3]), t),
            n: fmtCount(data.vc_fell_back),
          })}
        </p>
      )}
    </>
  );
}

/**
 * 展開シナリオ（タブ3、spec FR-C、screens S-1c）
 * @param {{data: object, stage: "racecard"|"exhibition", onScope: (key: string) => void, today: object|null,
 *   raceId: string, players?: object[]|null}} props data は scenario の応答、today は facts の today（平均ST・モーター・展示→本番の一致）
 */
export default function ScenarioTab({
  data,
  stage,
  onScope,
  today,
  raceId,
  players = null,
  feedback,
  initialFirst = null,
  onInitialFirstUsed,
  onOpenMeetForm = null,
}) {
  const { t } = useTranslation();
  const scopeLbl = useId();
  const st = useScenarioState({
    data,
    stage,
    raceId,
    initialFirst,
    onInitialFirstUsed,
  });
  if (!data.scenario?.cells)
    return (
      <p className="af-v16-line">
        {t("aiPredictionTab.analogy.states.notSaved")}
      </p>
    );
  return (
    <ScenarioTabBody
      {...{ data, stage, onScope, today, raceId, players, feedback }}
      onOpenMeetForm={onOpenMeetForm}
      st={st}
      scopeLbl={scopeLbl}
    />
  );
}

function ctxOf(st, formName, t) {
  const { entry, slit } = st;
  return [
    entry !== "all" ? t(`${k}.entryShort.${entry}`) : t(`${k}.entry.all`),
    slit !== "any" ? formName(slit) : null,
  ]
    .filter(Boolean)
    .join(" × ");
}

/** ①入り方・②形・③攻め方 */
function ScenarioSteps({
  st,
  data,
  players,
  raceId,
  onOpenMeetForm,
  td,
  cells,
  c,
  rows,
  badges,
  waku,
  sc,
  allOf,
  scope,
  formName,
  classScope,
  exhibitionStage,
  ctx,
}) {
  const { entry, slit, version, slitOpen } = st;
  const { exhibition, agreement, cls } = td;
  const { pick, chooseEntry, chooseForm, openSlit } = scenarioHandlers({
    setEntry: st.setEntry,
    setSlit: st.setSlit,
    setFirst: st.setFirst,
    setSlitOpen: st.setSlitOpen,
    slit,
  });
  return (
    <>
      <ScenarioEntryStep
        cells={cells}
        entry={entry}
        chooseEntry={chooseEntry}
        todayEntry={td.todayEntry}
        exhibitionStage={exhibitionStage}
        entryAgree={td.entryAgree}
        agreement={agreement}
        bar2={bar2}
        allOf={allOf}
        scope={scope}
      />
      <ScenarioSlitStep
        data={data}
        players={players}
        cells={cells}
        entry={entry}
        slit={slit}
        version={version}
        setVersion={st.setVersion}
        pick={pick}
        rows={rows}
        badges={badges}
        exhibition={exhibition}
        exhibitionStage={exhibitionStage}
        exhForms={td.exhForms}
        flyBoats={td.flyBoats}
        agreement={agreement}
        raceId={raceId}
        waku={waku}
        slitCollapsed={slit !== "any" && !slitOpen}
        openSlit={openSlit}
        chooseForm={chooseForm}
        bar2={bar2}
        formName={formName}
        onOpenMeetForm={onOpenMeetForm}
      />
      <ScenarioAttackStep
        slit={slit}
        openSlit={openSlit}
        ctx={ctx}
        scope={scope}
        sc={sc}
        data={data}
        waku={waku}
        exhibitionStage={exhibitionStage}
        exhibition={exhibition}
        motorRank={td.motorRank}
        cls={cls}
        classScope={classScope}
        c={c}
      />
    </>
  );
}

/** ④結果 */
function ScenarioResultSection({
  st,
  t,
  data,
  cells,
  c,
  base,
  whole,
  E,
  scope,
  allOf,
  formName,
  cls,
  classScope,
}) {
  return (
    <section className="af-scn-sec" id="af-scn-s4">
      <h3 className="af-h3 af-scn-h">
        <span className="af-stepn">{t(`${k}.stepLabel`, { n: 4 })}</span>
        {t(`${k}.resultHeadingShort`)}
      </h3>
      <ScenarioResult
        c={c}
        base={base}
        whole={whole}
        E={E}
        sl={st.slit !== "any"}
        slit={st.slit}
        scope={scope}
        allOf={allOf}
        formName={formName}
        scopeTag={makeScopeTag(classScope, cls, t)}
        bar2={bar2}
        racePick={st.racePick}
        racePanel={makeRacePanel(st, t, formName)}
        togglePick={st.togglePick}
        data={data}
        entry={st.entry}
        cells={cells}
        cls={cls}
        classScope={classScope}
        first={st.first}
        setFirst={st.setFirst}
        not1={st.not1}
        setNot1={st.setNot1}
        band={st.band}
        setBand={st.setBand}
      />
    </section>
  );
}

function ScenarioTabBody({
  data,
  stage,
  onScope,
  today,
  raceId,
  players,
  feedback,
  onOpenMeetForm,
  st,
  scopeLbl,
}) {
  const { t } = useTranslation();
  const { entry, slit, version, setFirst } = st;
  const scopeKey = data.scope;
  const exhibitionStage = stage === "exhibition";
  const scope = scopeName(scopeKey, t, { short: true });
  const { sc, cells, whole, c, base, waku, rows, badges, baseN } = deriveCells(
    data,
    entry,
    slit,
    version,
  );
  const td = deriveToday(data, today, stage);
  const { cls } = td;
  const allOf = (name) =>
    scopeKind(scopeKey) === "VA" || scopeKind(scopeKey) === "NA"
      ? name
      : t(`${k}.allOf`, { name });
  const E = entry !== "all" ? entry : null;
  const formName = (f) => t(`${k}.forms.${f}.name`);
  const classScope = !["VA", "VG", "NA"].includes(scopeKind(scopeKey));
  return (
    <div className="af-tab-scenario">
      <ScenarioScopeHeader
        data={data}
        raceId={raceId}
        onScope={onScope}
        setFirst={setFirst}
        scopeLbl={scopeLbl}
      />
      <ScenarioSteps
        {...{ st, data, players, raceId, onOpenMeetForm, td, cells }}
        {...{ c, rows, badges, waku, sc, allOf, scope, formName }}
        {...{ classScope, exhibitionStage, ctx: ctxOf(st, formName, t) }}
      />
      <ScenarioResultSection
        st={st}
        t={t}
        data={data}
        cells={cells}
        c={c}
        base={base}
        whole={whole}
        E={E}
        scope={scope}
        allOf={allOf}
        formName={formName}
        cls={cls}
        classScope={classScope}
      />
      {feedback}
      <ScenarioNotes
        classScope={classScope}
        sc={sc}
        data={data}
        version={version}
        exhibitionStage={exhibitionStage}
        raceId={raceId}
        scope={scope}
        baseN={baseN}
        today={today}
      />
    </div>
  );
}
