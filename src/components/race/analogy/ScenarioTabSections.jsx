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
import { k, SCOPES } from "./scenario/consts";
import { scenarioHandlers } from "./scenario/scenarioHandlers";
import { racePanelTitle } from "./scenario/racePanelTitle";
import ScenarioResult from "./scenario/ScenarioResult";
import ScenarioEntryStep from "./scenario/ScenarioEntryStep";
import ScenarioSlitStep from "./scenario/ScenarioSlitStep";
import ScenarioAttackStep from "./scenario/ScenarioAttackStep";

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

export { ScenarioScopeHeader, ScenarioSteps, ScenarioResultSection };
