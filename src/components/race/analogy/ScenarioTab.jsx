import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import NoteList, { NotesFold } from "./NoteList";
import ScenarioFold from "./ScenarioFold";
import ScopeCombo from "./ScopeCombo";
import EntryPatternPicker from "./EntryPatternPicker";
import SlitHint, { SlitHintNotes } from "./SlitHint";
import SlitShapePicker, { SlitChosen } from "./SlitShapePicker";
import AttackTable from "./AttackTable";
import ScenarioRaceList from "./ScenarioRaceList";
import FinishSankey from "./FinishSankey";
import AnalogySplit from "./AnalogySplit";
import TrifectaList from "./TrifectaList";
import { BoatBars, TechniqueBars } from "./OutcomeBars";
import BoatBadge from "../BoatBadge";
import {
  fmtCount,
  fmtDate,
  fmtPct,
  scopeName,
  venueLabel,
} from "../../../utils/analogyFormat";
import {
  MIN_SCENARIO,
  boatCells,
  boatCountsDiffer,
  hintBadgeByForm,
  hintRows,
  minRanks,
} from "../../../utils/analogyScenario";
import { agreementVerdict, scopeKind } from "../../../utils/analogyFacts";
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
  // 着順の流れで押した帯（よく出た3連単をその帯の内訳に絞る。BOA-816）
  const [band, setBand] = useState(null);
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
  const pick = (setter) => (v) => {
    setter(v);
    setFirst(null);
  };
  const chooseEntry = (e) => {
    setEntry(e);
    setSlit("any");
    setFirst(null);
  };
  // ②の見出しへ戻し、押したボタンが消えても次に押す所へフォーカスを移す（畳む・開くで画面の位置が跳ばないように。
  // ③が②のすぐ下に来る。レビュー指摘: 押したボタンごと消えてフォーカスが失われていた）
  const toSlit = (focusId) =>
    requestAnimationFrame(() => {
      document
        .getElementById("af-scn-s2")
        ?.scrollIntoView({ block: "start", behavior: "smooth" });
      document.getElementById(focusId)?.focus({ preventScroll: true });
    });
  const chooseForm = (f) => {
    setSlit(f);
    setFirst(null);
    setSlitOpen(false);
    // 「どの形でも」は畳まないので、画面を動かさない
    if (f !== "any") toSlit("af-slit-change");
  };
  const openSlit = () => {
    setSlitOpen(true);
    toSlit(`af-pat-${slit}`);
  };
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
          // 展開シナリオは返還（F・L・欠場）のレースを除いて数えるので、差がつく材料の件数と合わない。ここで明記する
          t(`${k}.shareOfNoRefund`, {
            of: allOf(scope),
            p: fmtPct(whole.n ? c.n / whole.n : null),
          }),
        ]
      : []),
  ];
  const head = E || sl ? t(`${k}.headIn`, { scope, core }) : core;
  const baseName =
    sl && E
      ? t(`${k}.entryWhole`, { entry: t(`${k}.entryShort.${E}`) })
      : allOf(scope);
  const share = (x, n) => (n ? x / n : null);
  // 2〜6号艇はその艇の級をそろえた範囲の値（BOA-806）。比べる点線も同じ艇の範囲の「形を問わない」値
  const cur = boatCells(cells, data.boats, entry, slit);
  const ref =
    slit !== "any"
      ? boatCells(cells, data.boats, entry, "any")
      : boatCells(cells, data.boats, "all", "any");
  const perBoat = boatCountsDiffer(cur);
  const boatN = perBoat ? cur.map((r) => r[0]) : c.n;
  const top3 = (r) => r[1] + r[2] + r[3];

  const cls = today?.classes ?? [];
  // ④の範囲の札（どのレースから出した数字か）。級をそろえない範囲（VA・VG・NA）は件数だけ
  const classScope = !["VA", "VG", "NA"].includes(scopeKind(scopeKey));
  const scopeTag = (b, n) => (
    <span className="af-scope-tag">
      {classScope && <BoatBadge n={b} size="xs" />}
      {classScope
        ? t(`${k}.atk.scopeTag`, { cls: cls[b - 1] ?? "—", n: fmtCount(n) })
        : t(`${k}.scopeTagAll`, { n: fmtCount(n) })}
    </span>
  );
  // 棒の左の札: 級・件数（艇ごとの範囲が無い・級をそろえない範囲は、1号艇の範囲の件数）
  // その艇の級でそろえた値が無い艇（朝のバッチの前の版など）は、1号艇の範囲の値に戻るので、その艇の級を書かない
  // （レビュー指摘: 札と中身が食い違っていた）
  const ownScope = [1, 2, 3, 4, 5, 6].map(
    (b) => b === 1 || Boolean(data.boats?.[b]?.data?.cells?.[entry]?.[slit]),
  );
  const boatTags = cur.map((r, i) =>
    classScope && ownScope[i]
      ? t(`${k}.boatTag`, { cls: cls[i] ?? "—", n: fmtCount(r[0]) })
      : t(`${k}.boatTagAll`, { n: fmtCount(r[0]) }),
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

  let result;
  if (!c.n) result = <p className="af-warn">{t(`${k}.none`, { head })}</p>;
  else if (c.n < MIN_SCENARIO)
    result = (
      <>
        <div className="af-scn-tagrow">
          {scopeTag(1, c.n)}
          <span className="af-foot">{t(`${k}.fewList`, { head })}</span>
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
        <div className="af-scn-tagrow">
          {scopeTag(1, c.n)}
          {parens.length > 0 && (
            <span className="af-foot">
              {parens.join(t("aiPredictionTab.analogy.listComma"))}
            </span>
          )}
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
          <span>{t(`${k}.keyThin`, { n: MIN_SCENARIO })}</span>
        </div>
        {/* PC では1着｜3着以内、決まり手｜万舟を左右に（BOA-813） */}
        <div className="af-pair">
          <div className="af-scn-blk">
            <h4 className="af-h4">{t(`${k}.firstBoat`)}</h4>
            {perBoat && <p className="af-foot">{t(`${k}.boatScopeLine`)}</p>}
            <BoatBars
              counts={cur.map((r) => r[1])}
              n={boatN}
              reference={ref.map((r) => share(r[1], r[0]))}
              fewBelow={MIN_SCENARIO}
              tags={boatTags}
              colored
            />
          </div>
          <div className="af-scn-blk">
            <h4 className="af-h4">{t(`${k}.top3Boat`)}</h4>
            <BoatBars
              counts={cur.map(top3)}
              n={boatN}
              reference={ref.map((r) => share(top3(r), r[0]))}
              fewBelow={MIN_SCENARIO}
              tags={boatTags}
              colored
            />
          </div>
        </div>
        <div className="af-pair">
          <div className="af-scn-blk">
            <h4 className="af-h4">{t(`${k}.techHeadingShort`)}</h4>
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
          </div>
          <div className="af-scn-blk">
            <h4 className="af-h4">{t(`${k}.manshu`)}</h4>
            {bar2(t(`${k}.keyScenario`), share(c.manshu, c.payout_known))}
            {bar2(baseName, share(base.manshu, base.payout_known))}
            <p className="af-foot">
              {t(`${k}.manshuCount`, {
                hits: fmtCount(c.manshu),
                n: fmtCount(c.payout_known),
              })}
            </p>
          </div>
        </div>
        {/* PC では着順の流れを左、よく出た3連単を右に（BOA-813） */}
        <AnalogySplit
          fig={
            <div className="af-scn-blk">
              <h4 className="af-h4">
                {t("aiPredictionTab.analogy.flow.heading")}
              </h4>
              <FinishSankey
                tri={c.tri}
                first={first}
                onFirst={setFirst}
                not1={not1}
                onNot1={setNot1}
                band={band}
                onBand={setBand}
                scenario
              />
            </div>
          }
        >
          <div className="af-scn-blk">
            <h4 className="af-h4">
              {t("aiPredictionTab.analogy.similar.triHeading")}
            </h4>
            <TrifectaList
              tri={c.tri}
              first={first}
              not1={not1}
              band={band}
              scenario
            />
          </div>
        </AnalogySplit>
      </>
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
      <section className="af-scn-sec" id="af-scn-s1">
        <h3 className="af-h3 af-scn-h">
          <span className="af-stepn">1</span>
          {t(`${k}.entryHeading`)}
        </h3>
        <EntryPatternPicker
          cells={cells}
          entry={entry}
          onEntry={chooseEntry}
          todayEntry={todayEntry}
        />
        {exhibitionStage && todayEntry && entryAgree?.[1] && (
          <div className="af-scn-blk">
            {bar2(
              t(`${k}.entryAgreeBar`, {
                entry: t(`${k}.entryShort.${todayEntry}`),
              }),
              entryAgree[0] / entryAgree[1],
            )}
            <p className="af-foot">
              {t(`${k}.agreeSource`, {
                since: fmtDate(String(agreement.period?.[0] ?? "").slice(0, 7)),
                n: fmtCount(entryAgree[1]),
              })}
            </p>
          </div>
        )}
        <ScenarioFold
          title={t(`${k}.entryHowTo`)}
          preview={t(`${k}.entryHowToPreview`)}
        >
          <ul className="af-notes-ul">
            <li>{t(`${k}.entryFootShare`, { name: allOf(scope) })}</li>
            <li>{t(`${k}.entryFootMae`)}</li>
            <li>{t(`${k}.entryFootDash`)}</li>
            <li>{t(`${k}.entryFootFew`, { n: MIN_SCENARIO })}</li>
            {!exhibitionStage && <li>{t(`${k}.entryPre`)}</li>}
          </ul>
        </ScenarioFold>
      </section>
      <section className="af-scn-sec" id="af-scn-s2">
        <h3 className="af-h3 af-scn-h">
          <span className="af-stepn">2</span>
          {t(`${k}.slitHeadingShort`)}
        </h3>
        {slitCollapsed ? (
          <SlitChosen
            forms={cells[entry].forms}
            slit={slit}
            onChange={openSlit}
          />
        ) : (
          <>
            <SlitHint
              courseSt={data.course_st}
              version={version}
              onVersion={pick(setVersion)}
              rows={rows}
              exhibition={exhibition}
              exhibitionStage={exhibitionStage}
              venue={Number(String(raceId).split("-")[3])}
              selectedForm={slit}
              onForm={chooseForm}
              waku={waku}
            />
            <SlitShapePicker
              forms={cells[entry].forms}
              slit={slit}
              onSlit={chooseForm}
              badges={badges}
              todayForms={
                exhibitionStage && !exhibition?.forms_excluded ? exhForms : []
              }
            />
            {exhibitionStage && (
              <div className="af-scn-blk">
                <h4 className="af-h4">
                  {t(`aiPredictionTab.analogy.notes.today`)}
                </h4>
                {/* 展示が2つ以上の形に当たるときは、形ごとに展示→本番の一致を出す（ファン評価: 先頭の形しか出ていなかった） */}
                {exhForms.map((f) => {
                  const ag = agreement?.forms?.[f];
                  if (!ag?.hit?.[1]) return null;
                  const verdict = agreementVerdict(ag.hit, ag.miss);
                  return (
                    <div key={f} className="af-scn-blk">
                      {bar2(
                        t(`${k}.slitAgreeHit`, { form: formName(f) }),
                        ag.hit[0] / ag.hit[1],
                      )}
                      {ag.miss?.[1]
                        ? bar2(
                            t(`${k}.slitAgreeMiss`, { form: formName(f) }),
                            ag.miss[0] / ag.miss[1],
                          )
                        : null}
                      {verdict && (
                        <p className="af-foot">
                          <span className="af-info-tag">
                            {t(`${k}.agreeVerdict.${verdict}`)}
                          </span>
                        </p>
                      )}
                    </div>
                  );
                })}
                {exhForms.some((f) => agreement?.forms?.[f]?.hit?.[1]) && (
                  <p className="af-foot">
                    {t(`${k}.agreeSource`, {
                      since: fmtDate(
                        String(agreement.period?.[0] ?? "").slice(0, 7),
                      ),
                      n: fmtCount(agreement.forms_n),
                    })}
                  </p>
                )}
                <p className="af-foot">
                  {exhibition?.forms_excluded
                    ? t(`${k}.slitDeepFly`)
                    : exhForms.length
                      ? t(
                          `${k}.${exhForms.length > 1 ? "slitTodayTagMany" : "slitTodayTagOne"}`,
                          {
                            forms: exhForms
                              .map(formName)
                              .join(t("aiPredictionTab.analogy.listSeparator")),
                            count: exhForms.length,
                          },
                        ) +
                        (flyBoats.length
                          ? t(`${k}.slitFlyShallow`, {
                              boats: flyBoats.join(
                                t("aiPredictionTab.analogy.listSeparator"),
                              ),
                            })
                          : "")
                      : t(`${k}.slitToday`, { forms: t(`${k}.noForm`) })}
                </p>
              </div>
            )}
            {!exhibitionStage && <p className="af-foot">{t(`${k}.slitPre`)}</p>}
            <ScenarioFold
              title={t(`${k}.termsFold`)}
              preview={t(`${k}.termsPreview`)}
            >
              <ul className="af-notes-ul">
                <li>{t(`${k}.termKado`)}</li>
                <li>{t(`${k}.termPic`)}</li>
                {["flat", "wall", "d2", "d3", "kado", "d1", "dash"].map((f) => (
                  <li key={f}>
                    {t(`${k}.slitDef`, {
                      form: formName(f),
                      def: t(`${k}.forms.${f}.def`),
                    })}
                  </li>
                ))}
                <li>{t(`${k}.termOverlap`)}</li>
                <li>{t(`${k}.termShare`)}</li>
              </ul>
            </ScenarioFold>
          </>
        )}
      </section>
      <section className="af-scn-sec" id="af-scn-s3">
        <h3 className="af-h3 af-scn-h">
          <span className="af-stepn">3</span>
          {t(`${k}.attackHeading`)}
        </h3>
        {slit !== "any" && (
          <div className="af-scn-tagrow">
            <button type="button" className="af-ctx-tag" onClick={openSlit}>
              {ctx} ✎
            </button>
            <span className="af-info-tag">{scope}</span>
          </div>
        )}
        <AttackTable
          attack={sc.attack}
          refAttack={data.reference?.attack ?? null}
          refName={
            data.reference
              ? scopeName(data.reference.scope, t, { short: true })
              : null
          }
          slit={slit}
          waku={waku}
          exhibitionStage={exhibitionStage}
          exhRank={exhibition?.exh_time_rank ?? null}
          motorRank={motorRank}
          classes={cls}
          boats={data.boats ?? null}
          classScope={classScope}
          scenarioN={c.n}
        />
      </section>
      <section className="af-scn-sec" id="af-scn-s4">
        <h3 className="af-h3 af-scn-h">
          <span className="af-stepn">4</span>
          {t(`${k}.resultHeadingShort`)}
        </h3>
        {result}
      </section>
      {feedback}
      <NotesFold title={t("aiPredictionTab.analogy.notes.methodCaution")}>
        {/* 級をそろえない範囲（会場の全レース等）では、どの数字も同じ集めたレースなので対応の表を出さない */}
        {classScope && (
          <>
            <h4 className="af-h4">{t(`${k}.scopeMapHeading`)}</h4>
            <div className="af-tbl">
              <table className="af-mk-t af-scope-map">
                <thead>
                  <tr>
                    <th scope="col">{t(`${k}.scopeMapPart`)}</th>
                    <th scope="col">{t(`${k}.scopeMapB1`)}</th>
                    <th scope="col">{t(`${k}.scopeMapOwn`)}</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["attOwn", false],
                    ["attB1", true],
                    ["barB1", true],
                    ["barOwn", false],
                    ["rest", true],
                  ].map(([id, b1]) => (
                    <tr key={id}>
                      <th scope="row">{t(`${k}.scopeMap.${id}`)}</th>
                      <td>{b1 ? "○" : ""}</td>
                      <td>{b1 ? "" : "○"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        <NoteList
          title={t(`aiPredictionTab.analogy.notes.caution`)}
          texts={[
            t(`${k}.foot`, { n: fmtCount(sc.n_refund_excluded ?? 0) }),
            t(`${k}.resultNotSplit`),
          ]}
        />
        <h4 className="af-h4">{t(`${k}.notesHintHeading`)}</h4>
        <SlitHintNotes
          courseSt={data.course_st}
          version={version}
          exhibitionStage={exhibitionStage}
          venue={Number(String(raceId).split("-")[3])}
          scope={scope}
          baseN={baseN}
          allA1={(today?.classes ?? []).every((x) => x === "A1")}
        />
      </NotesFold>
    </div>
  );
}
