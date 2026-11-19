import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import BoatBadge from "../BoatBadge";
import { racerPagePath } from "../../../utils/racerPagePath";
import SlitShapeIcon from "./SlitShapeIcon";
import {
  fmtCount,
  fmtExhSt,
  fmtPct,
  fmtSt3,
} from "../../../utils/analogyFormat";
import { VENUE_FEW_RUNS, hintTableBest } from "../../../utils/analogyAggregate";
import { SLIT_EXAMPLE, hintToday } from "../../../utils/analogyScenario";

const k = "aiPredictionTab.analogy.scenario";

/** 表の1行（label=行見出し、dim=薄くするセル、bestSet=金枠の艇番） */
function hintTr(label, cells, dim, bestSet) {
  return (
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
}

/** 場コース別の行のセル（ST と走数） */
function venueCells(courseSt, t) {
  return (courseSt.venue ?? []).map((v, i) => (
    <>
      {fmtSt3(v)}
      <small>
        {courseSt.venue_n?.[i] !== undefined
          ? t(`${k}.runs`, { n: courseSt.venue_n[i] })
          : ""}
      </small>
    </>
  ));
}

/** 展示 ST の行のセル（フライングは赤） */
function exhCells(exhByBoat) {
  return exhByBoat.map((v) => (
    <span className={v !== null && v < 0 ? "af-fst" : undefined}>
      {fmtExhSt(v)}
    </span>
  ));
}

/** 選手ページの「STの推移」へ直接移る行（BOA-879、2026-10-15 オーナー依頼・ファン4人の議論） */
function StTrendRow({ racerIds }) {
  const { t } = useTranslation();
  return (
    <tr className="af-hint-link-row">
      <th scope="row">{t(`${k}.hintStTrend`)}</th>
      {racerIds.map((id, i) => (
        <td key={i}>
          {id && (
            <Link
              to={racerPagePath(id, "stTrend")}
              className="af-hint-link"
              aria-label={t(`${k}.hintStTrendLink`, {
                boat: i + 1,
              })}
            >
              ›
            </Link>
          )}
        </td>
      ))}
    </tr>
  );
}

/** 折りたたみの中の表（艇ごとの平均 ST） */
function HintTable({ courseSt, exhByBoat, players, vName }) {
  const { t } = useTranslation();
  // 列は艇番。出走表の選手の登録番号（無い艇は null）
  const racerIds = [1, 2, 3, 4, 5, 6].map(
    (b) => players?.find((p) => Number(p.number) === b)?.racerId ?? null,
  );
  // 行ごとの6艇で一番良い値に金枠（出走表と同じ決まり、BOA-814）
  const best = hintTableBest(courseSt, exhByBoat);
  return (
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
          {hintTr(
            t(`${k}.hintSrcs.course`),
            (courseSt.course_filled ?? []).map(fmtSt3),
            null,
            best.course,
          )}
          {hintTr(
            t(`${k}.hintSrcs.overall`),
            (courseSt.overall ?? []).map(fmtSt3),
            null,
            best.overall,
          )}
          {hintTr(
            t(`${k}.hintVenue`, { venue: vName }),
            venueCells(courseSt, t),
            (courseSt.venue_n ?? []).map((n) => n < VENUE_FEW_RUNS),
            best.venue,
          )}
          {hintTr(
            t(`${k}.hintVenueAll`, { venue: vName }),
            (courseSt.venue_course_all?.mean ?? []).map(fmtSt3),
          )}
          {exhByBoat &&
            hintTr(t(`${k}.hintExh`), exhCells(exhByBoat), null, best.exh)}
          {racerIds.some(Boolean) && <StTrendRow racerIds={racerIds} />}
        </tbody>
      </table>
    </div>
  );
}

/** 今日の値の1つ（艇の丸と「4コース」と平均ST。和なら「4〜6コースの和」。丸だけでは号艇かコースか分からないため。案B） */
function TodaySide({ side }) {
  const { t } = useTranslation();
  const v = <b className="af-num">{fmtSt3(side.v / 1000)}</b>;
  if (!side.sum)
    return (
      <>
        <BoatBadge n={side.boats[0]} size="xs" />
        {t(`${k}.hintTodayCourse`, { n: side.boats[0] })} {v}
      </>
    );
  return (
    <>
      {t(`${k}.hintTodaySum`, {
        from: side.boats[0],
        to: side.boats[side.boats.length - 1],
      })}{" "}
      {v}
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
          <SlitShapeIcon st={SLIT_EXAMPLE[form]} height={110} compact />
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

export { HintTable, HintCard };
