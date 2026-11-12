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
  const { racePick, togglePick, setPicked, racesRes, boatMissing } =
    useRacePick({
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
  const exhibitionStage = stage === "exhibition";
  const exhibition = exhibitionStage ? data.exhibition : null;
  const keys = data.scope_keys ?? {};
  const scopeKey = data.scope;
  const sc = data.scenario;
  if (!sc?.cells)
    return (
      <p className="af-v16-line">
        {t("aiPredictionTab.analogy.states.notSaved")}
      </p>
    );
  const scope = scopeName(scopeKey, t, { short: true });
  const cells = sc.cells;
  const whole = cells.all.forms.any;
  const c = cells[entry].forms[slit];
  const base = slit !== "any" ? cells[entry].forms.any : whole;
  const waku = entry === "all" || entry === "waku";
  const rows = hintRows(
    sc.hints,
    data.hints?.[version],
    version,
    wilsonInterval,
  );
  const badges = waku ? hintBadgeByForm(rows) : {};
  const baseN = (() => {
    const any = sc.hints?.[version]?.kado4?.any;
    return any ? any.hit[1] + any.miss[1] : 0;
  })();
  const { pick, chooseEntry, chooseForm, openSlit } = scenarioHandlers({
    setEntry,
    setSlit,
    setFirst,
    setSlitOpen,
    slit,
  });
  const agreement = today?.exh_agreement ?? null;
  const todayEntry = exhibition?.entry_type ?? null;
  const entryAgree = todayEntry ? agreement?.entry?.[todayEntry] : null;
  const exhForms = exhibition?.forms ?? [];
  const flyBoats = exhibition?.course_by_boat
    ? exhibition.course_by_boat
        .map((cr, i) =>
          cr && exhibition.st_by_course[cr - 1] < 0 ? i + 1 : null,
        )
        .filter(Boolean)
    : [];
  const motor = today?.items?.motor_2?.values ?? [];
  const motorRank = minRanks(motor, true);
  const allOf = (name) =>
    scopeKind(scopeKey) === "VA" || scopeKind(scopeKey) === "NA"
      ? name
      : t(`${k}.allOf`, { name });
  const E = entry !== "all" ? entry : null;
  const sl = slit !== "any";
  const formName = (f) => t(`${k}.forms.${f}.name`);
  const racePanel = (group) => {
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
        onClose={() => setPicked(null)}
      />
    );
  };
  const cls = today?.classes ?? [];
  // ④の範囲の札（どのレースから出した数字か）。級をそろえない範囲（VA・VG・NA）は件数だけ
  const classScope = !["VA", "VG", "NA"].includes(scopeKind(scopeKey));
  const scopeTag = (b, n) => (
    <span className="af-scope-tag">
      {classScope && <BoatBadge n={b} size="xs" />}
      {classScope
        ? t(`${k}.atk.scopeTag`, { b, cls: cls[b - 1] ?? "—", n: fmtCount(n) })
        : t(`${k}.scopeTagAll`, { n: fmtCount(n) })}
    </span>
  );
  const bar2 = (label, p) => (
    <div className="af-hint-bar af-num">
      <span>{label}</span>
      <span className="af-atk-trk">
        <i style={{ width: `${(p ?? 0) * 100}%` }} />
      </span>
      <b>{fmtPct(p)}</b>
    </div>
  );

  const slitCollapsed = slit !== "any" && !slitOpen;
  const ctx = [
    E ? t(`${k}.entryShort.${E}`) : t(`${k}.entry.all`),
    slit !== "any" ? formName(slit) : null,
  ]
    .filter(Boolean)
    .join(" × ");

  return (
    <div className="af-tab-scenario">
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
      <ScenarioEntryStep
        cells={cells}
        entry={entry}
        chooseEntry={chooseEntry}
        todayEntry={todayEntry}
        exhibitionStage={exhibitionStage}
        entryAgree={entryAgree}
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
        setVersion={setVersion}
        pick={pick}
        rows={rows}
        badges={badges}
        exhibition={exhibition}
        exhibitionStage={exhibitionStage}
        exhForms={exhForms}
        flyBoats={flyBoats}
        agreement={agreement}
        raceId={raceId}
        waku={waku}
        slitCollapsed={slitCollapsed}
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
        motorRank={motorRank}
        cls={cls}
        classScope={classScope}
        c={c}
      />
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
          sl={sl}
          slit={slit}
          scope={scope}
          allOf={allOf}
          formName={formName}
          scopeTag={scopeTag}
          bar2={bar2}
          racePick={racePick}
          racePanel={racePanel}
          togglePick={togglePick}
          data={data}
          entry={entry}
          cells={cells}
          cls={cls}
          classScope={classScope}
          first={first}
          setFirst={setFirst}
          not1={not1}
          setNot1={setNot1}
          band={band}
          setBand={setBand}
        />
      </section>
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
