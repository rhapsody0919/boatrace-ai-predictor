import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import NoteList from "./NoteList";
import ScenarioFold from "./ScenarioFold";
import BoatBadge from "../BoatBadge";
import SlitShapeIcon from "./SlitShapeIcon";
import {
  fmtCount,
  fmtExhSt,
  fmtPct,
  fmtSt3,
  venueLabel,
} from "../../../utils/analogyFormat";
import { VENUE_FEW_RUNS, hintTableBest } from "../../../utils/analogyAggregate";
import { SLIT_EXAMPLE, hintToday } from "../../../utils/analogyScenario";

const k = "aiPredictionTab.analogy.scenario";

/**
 * 今日のスタートの手がかり（spec C-2、承認モック mock-scenario-v1）。①が枠なり（かどの進入でも）のときの手がかり。
 * 枠なり以外を選ぶと注意を出す。当てはまる条件は棒2本と「②で…を選ぶ」のボタン。見方・注意・割合の出し方は
 * 一番下の折りたたみ（SlitHintNotes）に出す
 * @param {{courseSt: object, version: "course"|"overall", onVersion: (v: string) => void, rows: object[],
 *   exhibition: object|null, exhibitionStage: boolean, venue: number, selectedForm: string,
 *   onForm: (f: string) => void, waku: boolean}} props
 */
export default function SlitHint({
  courseSt,
  version,
  onVersion,
  rows,
  exhibition,
  exhibitionStage,
  venue,
  selectedForm,
  onForm,
  waku,
}) {
  const { t } = useTranslation();
  const lbl = useId();
  const [tip, setTip] = useState(false);
  const vals = version === "course" ? courseSt.course_filled : courseSt.overall;
  const ref =
    version === "course" ? (courseSt.venue_course_all?.mean ?? null) : null;
  const vName = venueLabel(venue, t);
  const exhByBoat =
    exhibitionStage && exhibition?.course_by_boat
      ? exhibition.course_by_boat.map((c) =>
          c ? exhibition.st_by_course[c - 1] : null,
        )
      : null;
  // 行ごとの6艇で一番良い値に金枠（出走表と同じ決まり、BOA-814）
  const best = hintTableBest(courseSt, exhByBoat);
  const tr = (label, cells, dim, bestSet) => (
    <tr>
      <th scope="row">{label}</th>
      {cells.map((c, i) => (
        <td
          key={i}
          className={
            [dim?.[i] && "is-dim", bestSet?.has(i + 1) && "ind-best"]
              .filter(Boolean)
              .join(" ") || undefined
          }
        >
          {c}
        </td>
      ))}
    </tr>
  );
  // 同じ形の条件は1枚にまとめ、段階ごとの棒にする（カド一撃: ①〜③より早い／0.02秒以上早い。承認モック）
  const groups = rows.reduce((gs, r) => {
    const g = gs.find((x) => x.form === r.form);
    if (g) g.rows.push(r);
    else gs.push({ form: r.form, rows: [r] });
    return gs;
  }, []);
  return (
    <div className="af-hint">
      <div className="af-hint-h">
        <h4 className="af-h4">{t(`${k}.hintHeading`)}</h4>
        <span className="af-hint-tags">
          <span className="af-info-tag">{t(`${k}.hintTagPast`)}</span>
          <span className="af-info-tag">{t(`${k}.hintTagWaku`)}</span>
        </span>
      </div>
      {!waku && <p className="af-warn">{t(`${k}.hintOther`)}</p>}
      <div className="af-hint-pic">
        <SlitShapeIcon
          st={vals}
          height={150}
          reference={ref}
          refLabel={t(`${k}.hintRefShort`, { venue: vName })}
        />
      </div>
      <div className="af-ctl-row">
        <span className="af-lbl" id={lbl}>
          {t(`${k}.hintSrc`)}
        </span>
        <div
          className="af-seg"
          role="group"
          aria-labelledby={lbl}
          data-af-control="slit_version"
        >
          {["course", "overall"].map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={version === v}
              onClick={() => onVersion(v)}
            >
              {t(`${k}.hintSrcs.${v}`)}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="af-ibtn"
          aria-expanded={tip}
          aria-label={t(`${k}.hintSrcAria`)}
          onClick={() => setTip((v) => !v)}
        >
          <span aria-hidden="true">i</span>
        </button>
      </div>
      {/* 選んでいる方の説明だけ1行。もう一方は (i)（UI/UX レビュー） */}
      <p className="af-foot">{t(`${k}.hintSrcDef.${version}`)}</p>
      {tip && (
        <p className="af-scn-tip">
          {t(`${k}.hintSrcDef.${version === "course" ? "overall" : "course"}`)}
        </p>
      )}
      {/* 結論（当てはまる条件）は図の直下。今日の値・形の絵・全体の点線で見せる（BOA-814、承認モック mock-hint-cards-v1）。
          見方・表・割合の出し方は折りたたみ */}
      <h4 className="af-h4">
        {t(`${k}.hintConds`, { src: t(`${k}.hintSrcs.${version}`) })}
      </h4>
      {groups.length > 0 && (
        <p className="af-foot">{t(`${k}.hintCondsNote`)}</p>
      )}
      <div className="af-hintcs" data-af-control="slit_form">
        {groups.length ? (
          groups.map(({ form, rows: rs }) => (
            <HintCard
              key={form}
              form={form}
              rows={rs}
              vals={vals}
              selected={selectedForm === form}
              onForm={onForm}
            />
          ))
        ) : (
          <p className="af-foot">{t(`${k}.hintNone`)}</p>
        )}
      </div>
      <ScenarioFold
        title={t(`${k}.hintTable`)}
        preview={t(`${k}.hintTablePreview`)}
      >
        <div className="af-tbl">
          <table className="af-hint-t">
            <thead>
              <tr>
                <th scope="col">{t(`${k}.hintRowHead`)}</th>
                {[1, 2, 3, 4, 5, 6].map((b) => (
                  <th key={b} scope="col">
                    <BoatBadge n={b} size="xs" />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tr(
                t(`${k}.hintSrcs.course`),
                (courseSt.course_filled ?? []).map(fmtSt3),
                null,
                best.course,
              )}
              {tr(
                t(`${k}.hintSrcs.overall`),
                (courseSt.overall ?? []).map(fmtSt3),
                null,
                best.overall,
              )}
              {tr(
                t(`${k}.hintVenue`, { venue: vName }),
                (courseSt.venue ?? []).map((v, i) => (
                  <>
                    {fmtSt3(v)}
                    <small>
                      {courseSt.venue_n?.[i] !== undefined
                        ? t(`${k}.runs`, { n: courseSt.venue_n[i] })
                        : ""}
                    </small>
                  </>
                )),
                (courseSt.venue_n ?? []).map((n) => n < VENUE_FEW_RUNS),
                best.venue,
              )}
              {tr(
                t(`${k}.hintVenueAll`, { venue: vName }),
                (courseSt.venue_course_all?.mean ?? []).map(fmtSt3),
              )}
              {exhByBoat &&
                tr(
                  t(`${k}.hintExh`),
                  exhByBoat.map((v) => (
                    <span
                      className={v !== null && v < 0 ? "af-fst" : undefined}
                    >
                      {fmtExhSt(v)}
                    </span>
                  )),
                  null,
                  best.exh,
                )}
            </tbody>
          </table>
        </div>
      </ScenarioFold>
    </div>
  );
}

/**
 * 手がかりの見方・注意・割合の出し方（一番下の「割合の出し方・注意」の折りたたみの中。同じ名前の折りたたみが
 * 2つあったのを1つにまとめた。承認モック mock-scenario-v1）
 */
export function SlitHintNotes({
  courseSt,
  version,
  exhibitionStage,
  venue,
  scope,
  baseN,
  allA1 = false,
}) {
  const { t } = useTranslation();
  const vName = venueLabel(venue, t);
  const fewVenue = (courseSt.venue_n ?? [])
    .map((n, i) => (n !== null && n < VENUE_FEW_RUNS ? i + 1 : null))
    .filter(Boolean);
  const filled = (courseSt.course_n ?? [])
    .map((n, i) => (n < 5 ? i + 1 : null))
    .filter(Boolean);
  return (
    <>
      <NoteList
        title={t(`aiPredictionTab.analogy.notes.howToRead`)}
        texts={[
          version === "course"
            ? t(`${k}.hintPicCourse`, { venue: vName }) +
              (allA1 ? t(`${k}.hintPicA1`) : "") +
              t(`${k}.hintPicTail`)
            : t(`${k}.hintPicOverall`),
          version === "course" &&
            filled.length > 0 &&
            t(`${k}.hintFilled`, {
              boats: filled.join(t("aiPredictionTab.analogy.listSeparator")),
            }),
        ]}
      />
      <NoteList
        title={t(`aiPredictionTab.analogy.notes.caution`)}
        texts={[
          t(`${k}.hintVenueFoot`, { venue: vName }),
          fewVenue.length > 0 &&
            t(`${k}.hintFewVenue`, {
              boats: fewVenue.join(t("aiPredictionTab.analogy.listSeparator")),
            }),
          exhibitionStage ? t(`${k}.hintExhPost`) : t(`${k}.hintExhPre`),
        ]}
      />
      <NoteList
        title={t(`aiPredictionTab.analogy.notes.counting`)}
        texts={[
          t(`${k}.hintFoot`, {
            scope,
            n: fmtCount(baseN),
            few: baseN < 3000 ? t(`${k}.hintFew`) : "",
          }),
        ]}
      />
    </>
  );
}

/** 今日の値の1つ（艇番の丸と平均ST。和なら「④〜⑥の和」） */
function TodaySide({ side }) {
  const { t } = useTranslation();
  const v = <b className="af-num">{fmtSt3(side.v / 1000)}</b>;
  if (!side.sum)
    return (
      <>
        <BoatBadge n={side.boats[0]} size="xs" /> {v}
      </>
    );
  return (
    <>
      <BoatBadge n={side.boats[0]} size="xs" />〜
      <BoatBadge n={side.boats[side.boats.length - 1]} size="xs" />
      {t(`${k}.hintTodaySum`)} {v}
    </>
  );
}

/**
 * 当てはまる条件のカード1枚（形ごと。BOA-814、承認モック mock-hint-cards-v1）。形の小さな絵と名前、「✓ 今日あてはまる」、
 * 今日の値と差、段階ごとの棒（0〜100%、全体の割合を点線）、③④へ進むボタン
 * @param {{form: string, rows: object[], vals: (number|null)[], selected: boolean, onForm: (f: string) => void}} props
 */
function HintCard({ form, rows, vals, selected, onForm }) {
  const { t } = useTranslation();
  const name = t(`${k}.forms.${form}.name`);
  const today = hintToday(rows[0].id, vals);
  const all = rows[0].pall;
  return (
    <div className="af-hintc" data-testid="analogy-hint-card">
      <div className="af-hintc-h">
        <span className="af-hintc-ico" aria-hidden="true">
          <SlitShapeIcon st={SLIT_EXAMPLE[form]} height={40} compact />
        </span>
        <b className="af-hintc-name">{name}</b>
        <span className="af-hintc-ok">{t(`${k}.hintTodayOk`)}</span>
      </div>
      {today && (
        <p className="af-hintc-today">
          {t(`${k}.hintTodayLead`)}{" "}
          {today.dir === "spread" && <>{t(`${k}.hintTodaySpreadPre`)} </>}
          <TodaySide side={today.a} /> {t(`${k}.hintTodayMid.${rows[0].id}`)}{" "}
          <TodaySide side={today.b} />{" "}
          <b>
            {t(`${k}.hintTodayDiff.${today.dir}`, {
              d: (today.diff / 1000).toFixed(3),
            })}
          </b>
        </p>
      )}
      {rows.map((r) => (
        <div key={r.id} className="af-hintc-row">
          <div className="af-hintc-lb">
            <span title={t(`${k}.hints.${r.id}`)}>
              {t(`${k}.hintStage.${r.id}`)}
            </span>
            {r.kind === "down" && (
              <span className="af-info-tag">{t(`${k}.hintDownTag`)}</span>
            )}
            <b className="af-num">
              {fmtPct(r.ph)}{" "}
              <small>
                {t(`${k}.hintFrac`, {
                  x: fmtCount(r.hit[0]),
                  n: fmtCount(r.hit[1]),
                })}
              </small>
            </b>
          </div>
          <span className="af-hintc-trk">
            <i style={{ width: `${(r.ph ?? 0) * 100}%` }} />
            {all !== null && (
              <s style={{ left: `${all * 100}%` }} aria-hidden="true" />
            )}
          </span>
        </div>
      ))}
      {all !== null && (
        <p className="af-hintc-all">
          <i aria-hidden="true" />
          {t(`${k}.hintAll`, { p: fmtPct(all) })}
        </p>
      )}
      <button
        type="button"
        className="af-go"
        aria-pressed={selected}
        onClick={() => onForm(form)}
      >
        {t(`${k}.hintGo`, { form: name })}
      </button>
    </div>
  );
}
