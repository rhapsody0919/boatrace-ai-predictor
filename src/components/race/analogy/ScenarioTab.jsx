import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ScenarioScopeHeader,
  ScenarioSteps,
  ScenarioResultSection,
} from "./ScenarioTabSections";
import { scopeName } from "../../../utils/analogyFormat";
import {
  hintBadgeByForm,
  hintRows,
  minRanks,
} from "../../../utils/analogyScenario";
import { scopeKind } from "../../../utils/analogyFacts";
import { trifectaList } from "../../../utils/analogyAggregate";
import { wilsonInterval } from "../../../utils/wilson";
import { k } from "./scenario/consts";
import { useRacePick } from "./scenario/useRacePick";
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
