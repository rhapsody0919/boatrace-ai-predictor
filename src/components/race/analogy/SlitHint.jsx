import { useId } from "react";
import { useTranslation } from "react-i18next";
import NoteList from "./NoteList";
import BoatBadge from "../BoatBadge";
import SlitShapeIcon from "./SlitShapeIcon";
import {
  fmtCount,
  fmtExhSt,
  fmtPct,
  fmtSt3,
  venueLabel,
} from "../../../utils/analogyFormat";

const k = "aiPredictionTab.analogy.scenario";

/**
 * 今日のスタートの手がかり（spec C-2）。①が枠なり（かどの進入でも）のときの手がかり。枠なり以外を選ぶと注意を出す
 * @param {{courseSt: object, version: "course"|"overall", onVersion: (v: string) => void, rows: object[],
 *   exhibition: object|null, exhibitionStage: boolean, venue: number, scope: string, selectedForm: string,
 *   onForm: (f: string) => void, waku: boolean, baseN: number}} props
 */
export default function SlitHint({
  courseSt,
  version,
  onVersion,
  rows,
  exhibition,
  exhibitionStage,
  venue,
  scope,
  selectedForm,
  onForm,
  waku,
  baseN,
  allA1 = false,
}) {
  const { t } = useTranslation();
  const lbl = useId();
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
  const fewVenue = (courseSt.venue_n ?? [])
    .map((n, i) => (n !== null && n < 10 ? i + 1 : null))
    .filter(Boolean);
  const filled = (courseSt.course_n ?? [])
    .map((n, i) => (n < 5 ? i + 1 : null))
    .filter(Boolean);
  const tr = (label, cells, dim) => (
    <tr>
      <th scope="row">{label}</th>
      {cells.map((c, i) => (
        <td key={i} className={dim?.[i] ? "is-dim" : undefined}>
          {c}
        </td>
      ))}
    </tr>
  );
  const formName = (f) => t(`${k}.forms.${f}.name`);
  return (
    <div className="af-hint">
      <div className="af-hint-h">
        <h4 className="af-h4">{t(`${k}.hintHeading`)}</h4>
        <span className="af-sub">{t(`${k}.hintSub`)}</span>
      </div>
      {!waku && <p className="af-warn">{t(`${k}.hintOther`)}</p>}
      <div className="af-ctl-row">
        <span className="af-lbl" id={lbl}>
          {t(`${k}.hintSrc`)}
        </span>
        <div className="af-seg" role="group" aria-labelledby={lbl}>
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
      </div>
      <p className="af-foot">{t(`${k}.hintSrcFoot`)}</p>
      <div className="af-hint-pic">
        <SlitShapeIcon st={vals} height={132} reference={ref} />
      </div>
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
      <div className="af-tbl">
        <table className="af-hint-t">
          <thead>
            <tr>
              <th scope="col">
                <span className="af-sr">{t(`${k}.hintRowHead`)}</span>
              </th>
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
            )}
            {tr(
              t(`${k}.hintSrcs.overall`),
              (courseSt.overall ?? []).map(fmtSt3),
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
              (courseSt.venue_n ?? []).map((n) => n < 10),
            )}
            {tr(
              t(`${k}.hintVenueAll`, { venue: vName }),
              (courseSt.venue_course_all?.mean ?? []).map(fmtSt3),
            )}
            {exhByBoat &&
              tr(
                t(`${k}.hintExh`),
                exhByBoat.map((v) => (
                  <span className={v !== null && v < 0 ? "af-fst" : undefined}>
                    {fmtExhSt(v)}
                  </span>
                )),
              )}
          </tbody>
        </table>
      </div>
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
      <h4 className="af-h4">
        {t(`${k}.hintConds`, { src: t(`${k}.hintSrcs.${version}`) })}
      </h4>
      <div className="af-hintcs">
        {rows.length ? (
          rows.map((r) => (
            <button
              key={r.id}
              type="button"
              className="af-hintc"
              aria-pressed={selectedForm === r.form}
              onClick={() => onForm(r.form)}
            >
              <span>{t(`${k}.hints.${r.id}`)}</span>
              <span className="af-hint-r">
                {" → "}
                {r.kind === "down"
                  ? t(`${k}.hintDown`, {
                      form: formName(r.form),
                      ph: fmtPct(r.ph),
                      pm: fmtPct(r.pm),
                    })
                  : t(`${k}.hintUp`, {
                      form: formName(r.form),
                      ph: fmtPct(r.ph),
                      pm: fmtPct(r.pm),
                    })}
                <small>
                  {t(`${k}.hintCount`, {
                    n: fmtCount(r.hit[1]),
                    form: formName(r.form),
                    def: t(`${k}.forms.${r.form}.def`),
                  })}
                </small>
              </span>
            </button>
          ))
        ) : (
          <p className="af-foot">{t(`${k}.hintNone`)}</p>
        )}
      </div>
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
    </div>
  );
}
