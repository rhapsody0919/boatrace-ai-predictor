import BaseBar from "./BaseBar";
import Bars6 from "./Bars6";
import BetSummary from "./BetSummary";
import ClassLineup from "./ClassLineup";
import Fold from "./Fold";
import ScopeTable from "./ScopeTable";
import BoatBadge from "../BoatBadge";
import {
  bestBoats,
  classLineup,
  restClassCounts,
  sameClassLabel,
} from "../../../utils/assistModel";
import {
  axisWhyKinds,
  b1Usual,
  attackTech,
  descending,
  entrySummary,
  exhBands,
  exhToday,
  originalBest,
  powerWinners,
  exhibitionTable,
  factsEntry,
  factsScopeLabel,
  formSummary,
  partsChangedBoats,
} from "../../../utils/assistSummary";
import { MIN_SCENARIO, entryType } from "../../../utils/analogyScenario";
import { ASSIST_COPY as C, GLOSSARY } from "../../../data/thinkingAssistCopy";
import { TermButton, TheoryButton } from "./SheetButtons";
import WinFollowers, { ComboList } from "./WinFollowers";

const pct = (k, n) => (n ? (k / n) * 100 : 0);
const p0 = (k, n) => Math.round(pct(k, n));
const p1 = (k, n) => pct(k, n).toFixed(1);
const comma = (n) => n.toLocaleString("ja-JP");
const f2 = (v) => (v == null ? "—" : v.toFixed(2));
const st2 = (v, fly) =>
  v == null
    ? "—"
    : `${fly ? "F" : ""}.${String(Math.round(Math.abs(v) * 100)).padStart(2, "0")}`;

function AxisSummary({ m }) {
  const {
    scope,
    chips,
    venue,
    headerScope,
    vaFacts,
    vaCell,
    classes,
    onFacts,
  } = m;
  // 軸は1着だけ（2着以内・3着以内は相手レンズ。spec D-46）
  const u = b1Usual(scope, 1);
  const entry = factsEntry(chips);
  if (!u) return null;
  const va = vaFacts ? b1Usual({ facts: vaFacts }) : null;
  const why = axisWhyKinds({
    kind: scope.kind,
    fellBack: scope.fellBack,
    venue,
    win: true,
    venueRefund: Boolean(va && vaCell?.n > 0),
  });
  const label = factsScopeLabel(scope, venue, 1, classes?.[0]);
  const counts = restClassCounts(classes, 1);
  const hc = headerScope?.cell;
  return (
    <>
      <section className="ta-box" data-guide="axis">
        <h3 className="ta-h3-row">
          {C.axisHeading(1)}
          {venue && (
            <TheoryButton id="TC-V1" name={C.theoryVenueTitle(venue)} />
          )}
        </h3>
        {/* 大きい数字の横に件数の札。同じ範囲の棒は出さず、比べる相手（会場の全レース）の棒だけ（2026-10-09 ユーザー決定 B） */}
        <div className="ta-big">
          <span className="ta-big-pct ta-num">{p1(u.k, u.n)}%</span>
          <span className="ta-big-cnt ta-num">{C.races(u.k, u.n)}</span>
          <span className="ta-scopechip ta-num">{C.scopeChip(label, u.n)}</span>
        </div>
        <ClassLineup lineup={classLineup(classes, 1)} />
        {counts && (
          <p className="ta-note">
            {C.classNote(1, classes[0], counts, factsScopeLabel(scope, venue))}
            <TermButton
              term={
                scope.kind === "VC" && venue
                  ? C.scopeVenue(venue)
                  : "全国・級の並びが同じ"
              }
            />
          </p>
        )}
        {va && venue && (
          <BaseBar label={C.venueAllN(venue, va.n)} k={va.k} n={va.n} />
        )}
        {/* 上の枠と数字が違う理由は畳まずに出す（同じ「1号艇の1着」が 58% と 54.6% に見える。デザイナーのレビュー P1-3） */}
        {hc && headerScope.kind === scope.kind && (
          <p className="ta-note ta-num">
            {C.whyRefund(
              comma(u.n),
              p1(u.k, u.n),
              comma(hc.n),
              p1(hc.b1_win, hc.n),
            )}
          </p>
        )}
        {why.length > 0 && (
          <Fold title={C.whyToggle}>
            <ul className="ta-list">
              {why.includes("venueScope") && <li>{C.whyVenueScope(venue)}</li>}
              {why.includes("venueRefund") && (
                <li className="ta-num">
                  {C.whyVenueRefund(
                    venue,
                    comma(va.n),
                    p1(va.k, va.n),
                    comma(vaCell.n),
                    p1(vaCell.b1_win, vaCell.n),
                  )}
                </li>
              )}
              {why.includes("fellBack") && (
                <li className="ta-num">
                  {C.whyFellBack(venue, scope.vcCount)}
                </li>
              )}
            </ul>
          </Fold>
        )}
        {entry && (
          // 差がつく材料は深掘り（1号艇）の1か所に出し、ここは入口1行だけ（2026-10-11 ユーザー決定 案D）。
          // ▲が無い日は深掘りの「全部の材料」を開いて渡す
          <button
            type="button"
            className="ta-facts-entry"
            onClick={() => onFacts(entry.hits === 0)}
          >
            <span>
              <b>
                {entry.hits > 0
                  ? C.factsEntry(1, entry.hits)
                  : C.factsEntryNone(1)}
              </b>
              {entry.hits > 0 && (
                <span className="ta-facts-entry-names">
                  {C.factsEntryNames(
                    entry.keys.map((k) => C.factNames[k]),
                    entry.rest,
                  )}
                </span>
              )}
            </span>
            <span aria-hidden="true">›</span>
          </button>
        )}
      </section>
    </>
  );
}

/**
 * 展開レンズの図の上の結論（spec D-47 (3)、承認モック v2）: 本番のスタートの形の見立てと基準、展示後は今日の展示1行。
 * 今日の展示は攻める艇の展示タイムの順位の区分で、その形のときの攻める艇の1着（枠なりのレース）。展示の進入が
 * 枠なりでないと分かった日は、攻める艇のコースが変わるので出さない
 */
export function FlowConclusion({ m }) {
  const {
    scenario,
    post,
    v16Exhibition,
    courseByBoat,
    reflecting,
    round,
    exhRanks,
    hint: top,
    forms = [],
    onForm,
    basis,
  } = m;
  if (!scenario) return null;
  const formName = top ? C.formNames[top.form] : null;
  const exhForm =
    post && top && v16Exhibition?.forms?.includes?.(top.form) ? true : false;
  const entry = entryType(courseByBoat ?? []);
  const ex =
    post && top && (!entry || entry === "waku")
      ? exhToday(scenario, top.form, exhRanks)
      : null;
  const hitP = top ? p0(top.hit[0], top.hit[1]) : null;
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
        <>
          {forms.length > 1 ? (
            // 形が2つ以上当てはまるときは同じ形式で並べ、選んだ形で下の「もし」「今日の展示」が変わる（承認モック v2 ④）
            <div
              className="ta-form-pick"
              role="group"
              aria-label={C.flowFormPick}
            >
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
          ) : (
            <div className="ta-big">
              <b>{formName}</b>
              <span className="ta-big-cnt">{C.flowShapeRow}</span>
              <span className="ta-big-pct ta-num">{hitP}%</span>
              <span className="ta-big-cnt ta-num">
                （{comma(top.hit[0])}/{comma(top.hit[1])}）
              </span>
            </div>
          )}
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
      ) : (
        <p className="ta-note">{C.flowNoHint}</p>
      )}
      {ex && (
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
      )}
      {post && reflecting && <p className="ta-note">{C.stateReflecting}</p>}
    </section>
  );
}

/** 区分ごとの1行（今日の区分は札「今日」と塗り。30件未満は棒を出さず件数だけ） */
function BandRows({ side }) {
  return (
    <div className="ta-band">
      {side.rows.map((r) => {
        const today = r.band === side.today;
        return (
          <div
            key={r.band}
            className={`ta-band-row ta-num${today ? " ta-band-today" : ""}`}
          >
            <span className="ta-band-tag" aria-hidden={!today}>
              {today ? C.exhTodayTag : ""}
            </span>
            <span>{C.exhBand[r.band]}</span>
            {r.n < MIN_SCENARIO ? (
              <span className="ta-band-few">{C.exhFew(r.n)}</span>
            ) : (
              <>
                <span className="ta-tech-trk" aria-hidden="true">
                  <i style={{ width: `${pct(r.k, r.n)}%` }} />
                </span>
                <span className="ta-nowrap">
                  {p0(r.k, r.n)}% <small>({r.k}/{r.n})</small>
                </span>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

const natPcts = (nat) => nat.map((v) => Math.round(v * 100));

/**
 * 今日の展示を入れると（spec D-47 (5)、承認モック v2）。攻める艇の1着と1号艇の逃げを展示タイムの順位の区分ごとに、
 * 範囲の件数つきで。全国の値を1行添える（範囲の区分の差は件数が少なく分かれにくいので、全国の差を主な根拠にする）。展示前は「展示の後に分かる」
 */
function ExhBandsBox({ post, bands, formLabel }) {
  if (!post)
    return (
      <section className="ta-box">
        <h3>{C.exhHeading}</h3>
        <p className="ta-note">{C.exhPending}</p>
      </section>
    );
  if (!bands) return null;
  const { att, b1 } = bands;
  // att は攻める艇の1着の行（「順位が上ほど1着が多い」「3〜4位は差が出にくい」を付ける）。1号艇の逃げの行は値だけ
  const natLine = (side, att) =>
    side.nat && side.nat.every((v) => v != null) ? (
      <p className="ta-note ta-num ta-band-nat">
        {C.exhNat(natPcts(side.nat))}
        {att && descending(side.nat) && C.exhNatDesc}
        {att && side.today === "mid" && C.exhNatMid}
      </p>
    ) : null;
  return (
    <section className="ta-box">
      <h3>{C.exhHeading}</h3>
      <div className="ta-legend">
        <span className="ta-scopechip ta-num">{formLabel}</span>
      </div>
      {att && (
        <>
          <p className="ta-note">
            <b>{C.exhAttTitle(att.boat, att.rank)}</b>
          </p>
          <BandRows side={att} />
          {natLine(att, true)}
        </>
      )}
      {b1 && (
        <>
          <p className="ta-note">
            <b>{C.exhB1Title(b1.rank)}</b>
          </p>
          <BandRows side={b1} />
          {natLine(b1, false)}
          <p className="ta-note">{C.exhB1Note}</p>
        </>
      )}
    </section>
  );
}

function FlowSummary({ m }) {
  const {
    scenario,
    national,
    post,
    courseByBoat,
    similar,
    racecardStage,
    round,
    exhRanks,
    hint: top,
    original,
    racers,
    venue,
    onPower,
  } = m;
  const formName = top ? C.formNames[top.form] : null;
  const form = top ? formSummary(scenario, top.form) : null;
  const tech = top ? attackTech(scenario, top.form) : null;
  const bands =
    top && post ? exhBands(scenario, national, top.form, exhRanks) : null;
  const scopeText = form
    ? C.flowFormScope(C.flowScopeLabel(Boolean(round)), form.n)
    : null;
  const entry = post ? entrySummary(scenario, courseByBoat) : null;
  const best = post ? originalBest(original, racers) : [];
  const bothBest =
    best.length === 2 && best[0].boats.join() === best[1].boats.join();
  const simLabel = similar
    ? C.similarLabel(similar.n, similar.allInLayer)
    : null;
  return (
    <>
      {form && (
        <section className="ta-box">
          <h3 className="ta-h3-row">
            {C.flowIfHeading(formName)}
            <TheoryButton id={`TC-S:${form.form}`} name={formName} />
          </h3>
          <div className="ta-legend">
            <span className="ta-scopechip ta-num">
              {scopeText}
            </span>
          </div>
          {form.few ? (
            <p className="ta-note">{C.flowFew}</p>
          ) : (
            <>
              {tech && (
                // 攻める艇が1着のときの決まり手（spec D-47 (4)）。1着の艇の前に置く
                <div className="ta-tech">
                  <p className="ta-note">
                    {C.flowTechHeading(tech.att, tech.w)}
                  </p>
                  {tech.rows.map(([t, k]) => (
                    <div key={t} className="ta-tech-row ta-num">
                      <span>{C.flowTechNames[t]}</span>
                      <span className="ta-tech-trk" aria-hidden="true">
                        <i style={{ width: `${pct(k, tech.w)}%` }} />
                      </span>
                      <span className="ta-nowrap">
                        {C.flowTechVal(p0(k, tech.w), k)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <p className="ta-note">{C.flowFirstBoat}</p>
              <Bars6 values={form.first.map((k) => k / form.n)} />
              {form.topExacta.length > 0 && (
                <p className="ta-note ta-num">
                  {C.flowExactaOf(formName)}:{" "}
                  <ComboList rows={form.topExacta} />
                </p>
              )}
            </>
          )}
          {form.attacker === 3 && (
            <TheoryButton id="TC-T7" name={C.sujiChip[0]} className="ta-chip">
              <span>{C.sujiChip[0]} ›</span>
              <b>{C.sujiChip[1]}</b>
            </TheoryButton>
          )}
          {/* 3連単は展開から外し、買い目レンズへ（spec D-47 (4)） */}
          <p className="ta-note">{C.flowTrifectaToBet}</p>
        </section>
      )}
      {form && <ExhBandsBox post={post} bands={bands} formLabel={scopeText} />}
      {(entry || !post) && (
        <section className="ta-box">
          <h3 className="ta-h3-row">
            {C.entryHeading}
            <TheoryButton
              id={`TC-E:${entry?.group ?? "waku"}`}
              name={
                C.entryNames[
                  entry?.group === "mae" ? "maeOther" : (entry?.group ?? "waku")
                ]
              }
            />
          </h3>
          {entry ? (
            <>
              <div className="ta-chk">
                <span>✓ {C.entryToday(C.entryNames[entry.type])}</span>
                {entry.type === "waku" && <TermButton term="枠なり" />}
              </div>
              {entry.type === "waku" && (
                // 展示の進入が本番も続くか（全国の値。範囲ごとは件数が足りない。spec D-47 (6)）
                <p className="ta-note ta-num">
                  {C.entryNatWaku}{" "}
                  <b>{p0(C.entryNatWakuK, C.entryNatWakuN)}%</b>（
                  {comma(C.entryNatWakuK)}/{comma(C.entryNatWakuN)}）
                </p>
              )}
              {entry.n > 0 ? (
                <>
                  {/* 集めた範囲と件数を書く（上の枠の準優勝戦の値と比べられるように。ファン評価 PR4 1周目 指摘1） */}
                  <div className="ta-legend">
                    <span className="ta-scopechip ta-num">
                      {C.scopeChipWhy(
                        C.flowScopeLabel(Boolean(round)),
                        entry.n,
                        C.scopeWhy.entry,
                      )}
                    </span>
                  </div>
                  <BaseBar
                    label={C.entryB1(C.entryNames[entry.group])}
                    k={entry.k}
                    n={entry.n}
                  />
                </>
              ) : (
                // v16 の保存が無いと0件。0% の棒は「1号艇が1着になっていない」と読めるので出さない（BOA-808 6）
                <p className="ta-note">{C.entryNoPast}</p>
              )}
            </>
          ) : (
            <p className="ta-note">{C.entryPre}</p>
          )}
        </section>
      )}
      {best.length > 0 && (
        // オリジナル展示（spec D-47 (7)）: 一周・まわり足の「6艇で一番」と全体の効き目だけ。直線・秒数・形ごとは出さない
        <section className="ta-box">
          <h3>
            {C.orgHeading(
              venue,
              best.map((b) => b.kind),
            )}
          </h3>
          {bothBest ? (
            <p className="ta-org-best">
              {best[0].boats.map((b) => (
                <BoatBadge key={b} n={b} size="sm" />
              ))}{" "}
              {C.orgBothBest(best[0].boats)}
            </p>
          ) : (
            best.map((b) => (
              <p key={b.kind} className="ta-org-best">
                {b.boats.map((n) => (
                  <BoatBadge key={n} n={n} size="sm" />
                ))}{" "}
                {C.orgBest(b.kind, b.boats)}
              </p>
            ))
          )}
          <p className="ta-note ta-num">{C.orgEffect}</p>
          <p className="ta-note">
            {C.orgVenueNote}
            <button type="button" className="ta-link-btn" onClick={onPower}>
              {C.orgToPower} ›
            </button>
          </p>
        </section>
      )}
      {similar && similar.n > 0 && (
        <section className="ta-box">
          <h3 className="ta-h3-row">
            {C.simTechHeading(simLabel)}
            <TermButton term="類似レース" />
          </h3>
          {Object.entries(similar.tech)
            .sort((a, b) => b[1] - a[1])
            .map(([t, k]) => (
              <BaseBar
                key={t}
                label={`${t} ${k}件`}
                k={k}
                n={similar.n}
                labelRate={false}
              />
            ))}
          <p className="ta-note ta-num">
            {C.simB1(similar.win[0], p0(similar.win[0], similar.n))}
          </p>
          {racecardStage && <p className="ta-note">{C.similarRacecardStage}</p>}
        </section>
      )}
    </>
  );
}

function PowerSummary({ m }) {
  const { post, racers, maintenance, original, venue, motorChip } = m;
  const table = post
    ? exhibitionTable({ racers, maintenance, original })
    : null;
  const parts = post && maintenance ? partsChangedBoats(maintenance) : null;
  const motorBest = bestBoats(
    "motor_2",
    racers.map((r) => ({ boat: r.boat, value: r.motor2 })),
  );
  const conclusion = C.powerConclusion(
    powerWinners({
      table,
      motor: {
        best: motorBest,
        valueOf: (boat) => racers[boat - 1]?.motor2 ?? null,
      },
    }),
  );
  return (
    <>
      {conclusion && <p className="ta-power-answer">{conclusion}</p>}
      <section className="ta-box" data-guide="power">
        {table ? (
          <>
            <h3 className="ta-h3-row">
              {C.powerExhHeading(venue ?? "", table.kinds)}
              <TheoryButton id="TC-T10" name={C.theoryExhGap} />
            </h3>
            <div className="ta-scroll">
              <table className="ta-table ta-table-ex">
                <thead>
                  <tr>
                    <th scope="col">{C.colBoat}</th>
                    <th scope="col">{C.colExh}</th>
                    {table.kinds.map((k) => (
                      <th key={k} scope="col">
                        {k}
                      </th>
                    ))}
                    <th scope="col">{C.colExhSt}</th>
                    <th scope="col">{C.colWeight}</th>
                    <th scope="col">{C.colTilt}</th>
                  </tr>
                </thead>
                <tbody>
                  {table.rows.map((r) => (
                    <tr key={r.boat}>
                      <td>
                        <BoatBadge n={r.boat} size="sm" />
                      </td>
                      {r.absent ? (
                        <td colSpan={4 + table.kinds.length}>{C.absent}</td>
                      ) : (
                        <>
                          <td
                            className={`ta-num${table.best.exh.has(r.boat) ? " ind-best" : ""}`}
                          >
                            {f2(r.exh)}
                          </td>
                          {r.ox.map((v, i) => (
                            <td
                              key={table.kinds[i]}
                              className={`ta-num${table.best.ox[i].has(r.boat) ? " ind-best" : ""}`}
                            >
                              {f2(v)}
                            </td>
                          ))}
                          <td
                            className={`ta-num${table.best.exhSt.has(r.boat) ? " ind-best" : ""}`}
                          >
                            {st2(r.exhSt, r.exhFlying)}
                          </td>
                          <td className="ta-num">
                            {r.weight == null ? "—" : r.weight.toFixed(1)}
                            {r.light ? ` ${C.weightLight}` : ""}
                          </td>
                          <td className="ta-num">{r.tilt ?? "—"}</td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="ta-legend">
              <span>{C.powerLegendBest}</span>
              <span>{C.powerLegendNone}</span>
            </div>
            {/* 用語の「?」は表の見出しに入れると 375px で表がはみ出すので、表の下に並べる（ファン評価 PR5 1周目 指摘4） */}
            <p className="ta-note">
              {[...table.kinds.filter((k) => GLOSSARY[k]), "展示ST"].map(
                (k) => (
                  <span key={k} className="ta-term-item">
                    {k}
                    <TermButton term={k} />
                  </span>
                ),
              )}
            </p>
            <div className="ta-feat">
              <TheoryButton
                id="TC-X1"
                name={C.powerTheory.x1}
                className="ta-tag"
              >
                {C.powerTheory.x1} ›
              </TheoryButton>
              <TheoryButton
                id="TC-T5"
                name={C.powerTheory.tilt}
                className="ta-tag"
              >
                {C.powerTheory.tilt} {C.trend}
              </TheoryButton>
              {parts && (
                <TheoryButton
                  id="TC-T6"
                  name={C.partsTheory}
                  className="ta-tag"
                >
                  {parts.length ? C.partsBoats(parts) : C.partsNone} ›
                </TheoryButton>
              )}
              <TheoryButton
                id="TC-T9"
                name={C.powerTheory.weight}
                className="ta-tag"
              >
                {C.powerTheory.weight} {C.trend}
              </TheoryButton>
            </div>
          </>
        ) : (
          <>
            <h3>{C.colExh}</h3>
            <p className="ta-note">{C.powerPre}</p>
          </>
        )}
      </section>
      <section className="ta-box">
        <h3>{C.motorHeading}</h3>
        <Bars6
          values={racers.map((r) => r.motor2)}
          raw
          digits={1}
          best={motorBest}
        />
        {motorChip && (
          <div className="ta-chip ta-chip-hit">
            <span className="ta-num">
              {C.motorChip(1, motorChip.top, motorChip.value.toFixed(1))}
            </span>
            <b className="ta-num">
              {C.motorChipRate(motorChip.top, motorChip.rate, motorChip.base)}
            </b>
            <span className="ta-scopechip ta-num">{motorChip.scope}</span>
          </div>
        )}
      </section>
    </>
  );
}

function BetLensSummary({ m }) {
  const { bet, scope, national, similar, venueAll, venue, classes, sim } = m;
  const lineup = classLineup(classes, 1);
  const simLabel = similar
    ? C.similarLabel(similar.n, similar.allInLayer)
    : null;
  const baseM = national ? national.manshu / national.payout_known : null;
  const refM =
    venueAll?.payout_known && venue
      ? venueAll.manshu / venueAll.payout_known
      : null;
  return (
    <>
      <section className="ta-box">
        <h3 className="ta-h3-row">
          {C.betBoxHeading(bet.points)}
          <TermButton term="合成オッズ" />
        </h3>
        <BetSummary
          {...bet.summary}
          similarTri={similar?.tri ?? null}
          similarN={similar?.n ?? null}
        />
      </section>
      {scope && baseM != null && (
        <section className="ta-box">
          <h3 className="ta-h3-row">
            {C.manshuHeading}
            <TermButton term="万舟" />
          </h3>
          <p className="ta-note">
            {refM != null ? C.baseLegendRef(venue) : C.baseLegend}
          </p>
          <ScopeTable
            scope={scope}
            similarN={similar?.n ?? null}
            similarConditions={sim?.conditions ?? null}
            classes={classes}
            lineup={lineup}
          />
          <BaseBar
            label={`${sameClassLabel(scope)} ${comma(scope.cell.n)}件${scope.few ? `・${C.roughFew}` : ""}`}
            k={scope.cell.manshu}
            n={scope.cell.payout_known}
            base={baseM}
            refRate={refM}
            few={scope.few}
          />
          {similar && (
            <BaseBar
              label={simLabel}
              k={similar.manshu.k}
              n={similar.manshu.n}
              base={baseM}
              refRate={refM}
            />
          )}
        </section>
      )}
      {similar && similar.topTrifecta.length > 0 && (
        <section className="ta-box">
          <h3 className="ta-h3-row">
            {C.simTopHeading(simLabel)}
            <TermButton term="類似レース" />
          </h3>
          {/* 件数は過去、オッズ・人気は今日の値（BOA-808 P3） */}
          <p className="ta-note ta-num">
            {C.simTopNote(similar.n, bet.oddsAt, bet.finished)}
          </p>
          <table className="ta-table">
            <thead>
              <tr>
                <th scope="col">{C.colTicket}</th>
                <th scope="col">{C.colCount}</th>
                <th scope="col">{C.colOdds}</th>
                <th scope="col">{C.colPopularity}</th>
              </tr>
            </thead>
            <tbody>
              {similar.topTrifecta.map(([x, k]) => {
                const key = x.join("-");
                const odds = bet.summary.trifecta?.[key];
                const rank = bet.ranks.get(key);
                return (
                  <tr key={key}>
                    <td className="ta-num">{key}</td>
                    <td className="ta-num">
                      {k}/{similar.n}
                    </td>
                    <td className="ta-num">
                      {odds == null ? "—" : C.oddsTimes(odds)}
                    </td>
                    <td className="ta-num">
                      {rank ? C.popularity(rank) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}

/**
 * レンズの要約（FR-4、screens S-1 D）。レースの全体に関わる値をレンズごとに並べる（承認モック v7 の renderSum）。
 * 6艇の値の最良は金枠だけで示す（隠し文字は図の数字の側だけ）
 * @param {{lens: string, axis: object|null, flow: object, power: object, place: object|null, bet: object}} props 各レンズの材料
 */
export default function LensSummary({ lens, axis, flow, power, place, bet }) {
  return (
    <div className="ta-sum">
      {lens === "axis" && axis && <AxisSummary m={axis} />}
      {lens === "flow" && <FlowSummary m={flow} />}
      {lens === "power" && <PowerSummary m={power} />}
      {lens === "place" && place?.follow && (
        // 相手レンズ（spec D-46）: 1号艇を軸にしたときの2着・3着
        <WinFollowers
          f={place.follow}
          label={place.label}
          axisK={place.axisK}
          axisN={place.axisN}
          above={false}
        />
      )}
      {lens === "bet" && <BetLensSummary m={bet} />}
    </div>
  );
}
