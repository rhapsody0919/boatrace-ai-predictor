import { useTranslation } from "react-i18next";
import SixBoatCourseTableRow from "./SixBoatCourseTableRow";
import { buildSixBoatLocalRows } from "./sixBoatCourseStats.js";
import "./SixBoatCourseTable.css";

const slash = (date) => date.replaceAll("-", "/");
const SIX_BOAT_PERIODS = ["recent3", "local"];

const periodRange = (isLocal, baseline) => {
  if (isLocal) {
    const { from, to } = baseline?.venue ?? {};
    return from && to ? { from: slash(from), to: slash(to) } : null;
  }
  const terms = baseline?.terms ?? [];
  return terms.length > 0
    ? { from: slash(terms[0].calc_from), to: slash(terms.at(-1).calc_to) }
    : null;
};

function PeriodSwitch({ period, onPeriodChange, range, text }) {
  return (
    <div
      className="six-boat-course-period"
      role="group"
      aria-label={text("periodLabel")}
    >
      {SIX_BOAT_PERIODS.map((key) => (
        <button
          key={key}
          type="button"
          aria-pressed={period === key}
          className={`rwit-chip${period === key ? " is-active" : ""}`}
          onClick={() => onPeriodChange(key)}
        >
          {text(key === "local" ? "periodLocal" : "periodRecent3")}
        </button>
      ))}
      {range && (
        <span className="six-boat-course-range">
          {text("periodRange", range)}
        </span>
      )}
    </div>
  );
}

/**
 * stats: useSixBoatCourseStats の戻り値（直近3期の行と平均。親の RaceWakuInfoTab が1艇ずつの表と共有する）。
 * period は親（PredictionPanel）の state。タブを移っても選んだ期間を保つ（BOA-1294）。
 * 当地の行は scopedBefore（レースより前の当社データ、選手ごと。undefined＝取得中・null＝失敗）から作る。
 */
export default function SixBoatCourseTable({
  stats,
  players,
  venueCode,
  scopedBefore,
  periodAnchor,
  period = "recent3",
  onPeriodChange,
  focusedBoat,
  onFocusBoat,
}) {
  const { t } = useTranslation();
  const { status: recentStatus, rows: recentRows, baseline } = stats;
  const isLocal = period === "local";
  const text = (key, options) => t(`wakuInfo.sixBoat.${key}`, options);
  // 当地の行は選手ごとの当社データ（scopedBefore）から作り、直近3期の取得を待たない（取得中・失敗は行ごとに出す）。
  // 直近3期の取得（会場の平均を含む）が済んでいなければ、平均と差は「—」のまま
  const status = isLocal ? "ready" : recentStatus;
  const rows = isLocal
    ? buildSixBoatLocalRows({
        players,
        scopedByRacer: scopedBefore,
        venueCode,
        now: periodAnchor,
        baseline,
      })
    : recentRows;
  const range = periodRange(isLocal, baseline);
  const diffTitle = text(isLocal ? "colDiffLocal" : "colDiff");
  const notes = isLocal
    ? ["noteLocal", "noteSample"]
    : ["noteDiff", "noteSample", "notePeriod"];
  return (
    <section className="six-boat-course">
      <h3>{text("title")}</h3>
      <p>{text("sub")}</p>
      <PeriodSwitch
        period={period}
        onPeriodChange={onPeriodChange}
        range={range}
        text={text}
      />
      {status === "loading" ? (
        <p className="rwit-loading">{t("wakuInfo.loading")}</p>
      ) : status === "error" ? (
        <p role="alert">{text("fetchError")}</p>
      ) : (
        <>
          <table>
            <thead>
              <tr>
                {["colBoat", "colWin", "colTop2", "colTop3", "colEntries"].map(
                  (key) => (
                    <th key={key} scope="col">
                      {text(key)}
                      {key === "colWin" && (
                        <small className="six-boat-course-diff-head">
                          {diffTitle}
                        </small>
                      )}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <SixBoatCourseTableRow
                  key={row.boat}
                  row={row}
                  player={players.find((p) => Number(p.number) === row.boat)}
                  text={text}
                  diffTitle={diffTitle}
                  focusedBoat={focusedBoat}
                  onFocusBoat={onFocusBoat}
                />
              ))}
            </tbody>
          </table>
          <div className="six-boat-course-notes">
            {notes.map((key) => (
              <p key={key}>{text(key)}</p>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
