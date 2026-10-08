import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import NoteList, { NotesFold } from "./NoteList";
import ScopeCombo from "./ScopeCombo";
import EntryPatternPicker from "./EntryPatternPicker";
import SlitHint from "./SlitHint";
import SlitShapePicker from "./SlitShapePicker";
import AttackTable from "./AttackTable";
import ScenarioRaceList from "./ScenarioRaceList";
import FinishSankey from "./FinishSankey";
import TrifectaList from "./TrifectaList";
import { BoatBars, TechniqueBars } from "./OutcomeBars";
import {
  fmtCount,
  fmtDate,
  fmtPct,
  scopeName,
  venueLabel,
} from "../../../utils/analogyFormat";
import {
  MIN_SCENARIO,
  hintBadgeByForm,
  hintRows,
  minRanks,
} from "../../../utils/analogyScenario";
import { scopeKind } from "../../../utils/analogyFacts";
import { wilsonInterval } from "../../../utils/wilson";

const k = "aiPredictionTab.analogy.scenario";
const SCOPES = ["VC", "NC", "NCR", "VA", "VG", "NA"];

/**
 * 展開シナリオ（タブ3、spec FR-C、screens S-1c）
 * @param {{data: object, stage: "racecard"|"exhibition", onScope: (key: string) => void, today: object|null,
 *   raceId: string}} props data は scenario の応答、today は facts の today（平均ST・モーター・展示→本番の一致）
 */
export default function ScenarioTab({
  data,
  stage,
  onScope,
  today,
  raceId,
  feedback,
}) {
  const { t } = useTranslation();
  const scopeLbl = useId();
  const [entry, setEntry] = useState("waku");
  const [slit, setSlit] = useState("any");
  const [version, setVersion] = useState("course");
  const [first, setFirst] = useState(null);
  const [not1, setNot1] = useState(false);
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
  const pick = (setter) => (v) => {
    setter(v);
    setFirst(null);
  };
  const chooseEntry = (e) => {
    setEntry(e);
    setSlit("any");
    setFirst(null);
  };
  const chooseForm = (f) => {
    setSlit(f);
    setFirst(null);
    requestAnimationFrame(() =>
      document
        .getElementById(`af-pat-${f}`)
        ?.scrollIntoView({ block: "center", behavior: "smooth" }),
    );
  };
  const agreement = today?.exh_agreement ?? null;
  const todayEntry = exhibition?.entry_type ?? null;
  const entryAgree = todayEntry ? agreement?.entry?.[todayEntry] : null;
  const exhForms = exhibition?.forms ?? [];
  const formAgree = exhForms.length ? agreement?.forms?.[exhForms[0]] : null;
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
  const core = E
    ? sl
      ? t(`${k}.coreEntryForm`, {
          entry: t(`${k}.ephConj.${E}`),
          form: formName(slit),
        })
      : t(`${k}.coreEntry`, { entry: t(`${k}.eph.${E}`) })
    : sl
      ? t(`${k}.coreForm`, { form: formName(slit) })
      : allOf(scope);
  const parens = [
    ...(E === "mae" ? [t(`${k}.maeNote`)] : []),
    ...(E && sl
      ? [
          t(`${k}.shareOf`, {
            of: t(`${k}.ephRaces.${E}`),
            p: fmtPct(base.n ? c.n / base.n : null),
          }),
        ]
      : []),
    ...(E || sl
      ? [
          t(`${k}.shareOf`, {
            of: allOf(scope),
            p: fmtPct(whole.n ? c.n / whole.n : null),
          }),
        ]
      : []),
  ];
  const heroT = parens.length
    ? t(`${k}.withParen`, {
        core,
        paren: parens.join(t("aiPredictionTab.analogy.listComma")),
      })
    : core;
  const head = E || sl ? t(`${k}.headIn`, { scope, core }) : core;
  const baseName =
    sl && E
      ? t(`${k}.entryWhole`, { entry: t(`${k}.entryShort.${E}`) })
      : allOf(scope);
  const share = (x, n) => (n ? x / n : null);
  const hit3 = (b, cell) =>
    cell.first_boat[b - 1] + cell.second_boat[b - 1] + cell.third_boat[b - 1];

  let result;
  if (!c.n) result = <p className="af-warn">{t(`${k}.none`, { head })}</p>;
  else if (c.n < MIN_SCENARIO)
    result = (
      <>
        <div className="af-hero">
          <span className="af-hero-n">
            {t("aiPredictionTab.analogy.count", { n: fmtCount(c.n) })}
          </span>
          <span className="af-sub">{t(`${k}.fewList`, { head })}</span>
        </div>
        <p className="af-sub">
          {t(`${k}.fewSummary`, {
            first: c.first_boat
              .map((v, i) =>
                v ? t(`${k}.boatCount`, { b: i + 1, n: v }) : null,
              )
              .filter(Boolean)
              .join(t("aiPredictionTab.analogy.listSeparator")),
            manshu: c.manshu,
          })}
        </p>
        <ScenarioRaceList races={c.races ?? []} />
      </>
    );
  else
    result = (
      <>
        <div className="af-hero">
          <span className="af-hero-n">
            {t("aiPredictionTab.analogy.count", { n: fmtCount(c.n) })}
          </span>
          <span className="af-sub">{heroT}</span>
        </div>
        <div className="af-key">
          <span>
            <i className="is-bar" />
            {t(`${k}.keyScenario`)}
          </span>
          <span>
            <i className="is-dot" />
            {baseName}
          </span>
          <span>
            <i className="is-err" />
            {t("aiPredictionTab.analogy.similar.keyErrShort")}
          </span>
        </div>
        <h4 className="af-h4">{t(`${k}.firstBoat`)}</h4>
        <BoatBars
          counts={c.first_boat}
          n={c.n}
          reference={base.first_boat.map((v) => share(v, base.n))}
          colored
        />
        <h4 className="af-h4">{t(`${k}.top3Boat`)}</h4>
        <BoatBars
          counts={[1, 2, 3, 4, 5, 6].map((b) => hit3(b, c))}
          n={c.n}
          reference={[1, 2, 3, 4, 5, 6].map((b) =>
            share(hit3(b, base), base.n),
          )}
          colored
        />
        <h4 className="af-h4">{t(`${k}.techHeading`)}</h4>
        <TechniqueBars
          counts={c.technique}
          n={c.n}
          reference={Object.fromEntries(
            Object.entries(base.technique).map(([kk, v]) => [
              kk,
              share(v, base.n),
            ]),
          )}
        />
        <div className="af-big">
          <span>{t(`${k}.manshu`)}</span>
          <b>{fmtPct(share(c.manshu, c.payout_known))}</b>
          <small>
            {t(`${k}.manshuSub`, {
              hits: fmtCount(c.manshu),
              n: fmtCount(c.payout_known),
              base: baseName,
              p: fmtPct(share(base.manshu, base.payout_known)),
            })}
          </small>
        </div>
        <h4 className="af-h4">{t("aiPredictionTab.analogy.flow.heading")}</h4>
        <FinishSankey
          tri={c.tri}
          first={first}
          onFirst={setFirst}
          not1={not1}
          onNot1={setNot1}
        />
        <h4 className="af-h4">
          {t("aiPredictionTab.analogy.similar.triHeading")}
        </h4>
        <TrifectaList tri={c.tri} first={first} not1={not1} />
      </>
    );

  return (
    <div className="af-tab-scenario">
      <p className="af-sub">{t(`${k}.lede`)}</p>
      <div className="af-ctl-row">
        <span className="af-lbl" id={scopeLbl}>
          {t("aiPredictionTab.analogy.facts.scopeLabel")}
        </span>
        <div
          className="af-seg"
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
      <ScopeCombo scopeKey={scopeKey} />
      {/* 既定で全国に替えたときの理由（spec「数えるレース」。タブ1と同じ1行。範囲を選び直したら API が付けない） */}
      {data.vc_fell_back !== null && data.vc_fell_back !== undefined && (
        <p className="af-sub">
          {t("aiPredictionTab.analogy.facts.fellBack", {
            venue: venueLabel(Number(String(raceId).split("-")[3]), t),
            n: fmtCount(data.vc_fell_back),
          })}
        </p>
      )}
      <h4 className="af-h4">
        <span className="af-stepn">1</span>
        {t(`${k}.entryHeading`)}
      </h4>
      <EntryPatternPicker
        cells={cells}
        entry={entry}
        onEntry={chooseEntry}
        todayEntry={todayEntry}
      />
      {exhibitionStage && todayEntry && entryAgree?.[1] && (
        <p className="af-sub">
          {t(`${k}.entryAgree`, {
            today: t(`${k}.todayEntry.${todayEntry}`),
            entry: t(`${k}.entryShort.${todayEntry}`),
            p: fmtPct(entryAgree[0] / entryAgree[1]),
            since: fmtDate(String(agreement.period?.[0] ?? "").slice(0, 7)),
            n: fmtCount(entryAgree[1]),
          })}
        </p>
      )}
      {/* 進入の見方は折りたたみ（承認モック sonar-tab v3） */}
      <details className="af-details">
        <summary>{t(`${k}.entryHowTo`)}</summary>
        <NoteList
          texts={[
            !exhibitionStage && t(`${k}.entryPre`),
            t(`${k}.entryFoot`, { name: allOf(scope) }),
          ]}
        />
      </details>
      <SlitHint
        courseSt={data.course_st}
        version={version}
        onVersion={pick(setVersion)}
        rows={rows}
        exhibition={exhibition}
        exhibitionStage={exhibitionStage}
        venue={Number(String(raceId).split("-")[3])}
        scope={scope}
        selectedForm={slit}
        onForm={chooseForm}
        waku={waku}
        baseN={baseN}
        allA1={(today?.classes ?? []).every((c) => c === "A1")}
      />
      <h4 className="af-h4">
        <span className="af-stepn">2</span>
        {t(`${k}.slitHeading`)}
      </h4>
      <SlitShapePicker
        forms={cells[entry].forms}
        slit={slit}
        onSlit={pick(setSlit)}
        badges={badges}
      />
      <details className="af-details">
        <summary>{t(`${k}.termsFold`)}</summary>
        <NoteList
          title={t(`aiPredictionTab.analogy.notes.terms`)}
          texts={[t(`${k}.slitFoot1`)]}
        />
        <NoteList
          title={t(`aiPredictionTab.analogy.notes.counting`)}
          texts={[
            sl &&
              t(`${k}.slitDef`, {
                form: formName(slit),
                def: t(`${k}.forms.${slit}.def`),
              }),
            t(`${k}.slitFoot2`),
          ]}
        />
      </details>
      <NoteList
        title={t(`aiPredictionTab.analogy.notes.today`)}
        texts={[
          formAgree?.hit?.[1] &&
            exhibitionStage &&
            t(`${k}.slitAgree`, {
              form: formName(exhForms[0]),
              p: fmtPct(formAgree.hit[0] / formAgree.hit[1]),
              q: fmtPct(
                formAgree.miss[1]
                  ? formAgree.miss[0] / formAgree.miss[1]
                  : null,
              ),
              since: fmtDate(String(agreement.period?.[0] ?? "").slice(0, 7)),
              n: fmtCount(agreement.forms_n),
            }),
          exhibitionStage && exhibition?.forms_excluded
            ? t(`${k}.slitDeepFly`)
            : exhibitionStage
              ? t(`${k}.slitToday`, {
                  forms: exhForms.length
                    ? exhForms
                        .map(formName)
                        .join(t("aiPredictionTab.analogy.listSeparator"))
                    : t(`${k}.noForm`),
                }) +
                (flyBoats.length
                  ? t(`${k}.slitFlyShallow`, {
                      boats: flyBoats.join(
                        t("aiPredictionTab.analogy.listSeparator"),
                      ),
                    })
                  : "")
              : t(`${k}.slitPre`),
        ]}
      />
      <AttackTable
        attack={sc.attack}
        refAttack={data.reference?.attack ?? null}
        refName={data.reference ? scopeName(data.reference.scope, t) : null}
        slit={slit}
        waku={waku}
        exhibitionStage={exhibitionStage}
        exhRank={exhibition?.exh_time_rank ?? null}
        exhTime={exhibition?.exh_time ?? null}
        motor={motor}
        motorRank={motorRank}
        scope={scope}
      />
      <h4 className="af-h4">
        <span className="af-stepn">4</span>
        {t(`${k}.resultHeading`)}
      </h4>
      {result}
      {feedback}
      <NotesFold title={t("aiPredictionTab.analogy.notes.methodCaution")}>
        <NoteList
          title={t(`aiPredictionTab.analogy.notes.caution`)}
          texts={[t(`${k}.foot`, { n: fmtCount(sc.n_refund_excluded ?? 0) })]}
        />
      </NotesFold>
    </div>
  );
}
