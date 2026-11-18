import BaseBar from "./BaseBar";
import Bars6 from "./Bars6";
import BoatBadge from "../BoatBadge";
import { descending } from "../../../utils/assistSummary";
import { MIN_SCENARIO, clearDiff } from "../../../utils/analogyScenario";
import { ASSIST_COPY as C } from "../../../data/thinkingAssistCopy";
import { TermButton, TheoryButton } from "./SheetButtons";
import { ComboList } from "./WinFollowers";
import { pct, p0, comma } from "./lensSummaryFormat";

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
                  {p0(r.k, r.n)}%{" "}
                  <small>
                    （{r.k}/{r.n}）
                  </small>
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
export function ExhBandsBox({ post, bands, formLabel, notWaku }) {
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
      </p>
    ) : null;
  // 範囲の区分の差（上位と下位）が分かれないとき、または今日が3〜4位のときは全国の値を目安にと書く
  const unclear = (side) => {
    const pair = (b) => {
      const r = side.rows.find((x) => x.band === b);
      return r ? [r.k, r.n] : null;
    };
    return side.today === "mid" || !clearDiff(pair("top"), pair("low"));
  };
  return (
    <section className="ta-box">
      <h3>{C.exhHeading}</h3>
      <div className="ta-legend">
        <span className="ta-scopechip ta-num">{formLabel}</span>
      </div>
      {notWaku && <p className="ta-note">{notWaku}</p>}
      {att && (
        <>
          <p className="ta-note">
            <b>{C.exhAttTitle(att.boat, att.rank)}</b>
          </p>
          <BandRows side={att} />
          {natLine(att, true)}
          {unclear(att) && <p className="ta-note">{C.exhUnclear}</p>}
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

/** 「もし」の箱: 攻める艇が1着のときの決まり手・1着の艇・2連単の上位 */
export function FlowIfBox({ view, onBet }) {
  const { formName, form, tech, scopeText } = view;
  return (
    <>
      {form && (
        <section className="ta-box">
          <h3 className="ta-h3-row">
            {C.flowIfHeading(formName)}
            <TheoryButton id={`TC-S:${form.form}`} name={formName} />
          </h3>
          <div className="ta-legend">
            <span className="ta-scopechip ta-num">{scopeText}</span>
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
                  {/* 境目と同じ件数の組が上限の外に残るとき（BOA-838）。区切りは ComboList と同じ全角空白 */}
                  {form.exactaTies && (
                    <span className="ta-nowrap">
                      {"\u3000"}
                      {C.comboTiesMore(form.exactaTies)}
                    </span>
                  )}
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
          <button type="button" className="ta-link-btn" onClick={onBet}>
            {C.flowTrifectaToBet} ›
          </button>
        </section>
      )}
    </>
  );
}

/** 進入の箱: 展示の進入と、その進入のときの1号艇の1着 */
export function FlowEntryBox({ entry, post, round }) {
  return (
    <>
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
    </>
  );
}

/** オリジナル展示の箱 */
export function OrgBestBox({ best, venue, onPower }) {
  const bothBest =
    best.length === 2 && best[0].boats.join() === best[1].boats.join();
  return (
    <>
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
    </>
  );
}

/** 似たレースの決まり手の箱 */
export function SimilarTechBox({ similar, racecardStage }) {
  const simLabel = similar
    ? C.similarLabel(similar.n, similar.allInLayer)
    : null;
  return (
    <>
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
