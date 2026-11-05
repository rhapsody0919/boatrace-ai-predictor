import { useTranslation } from "react-i18next";
import BoatBadge from "./BoatBadge";
import { buildSixBoatLocalRows } from "./sixBoatCourseStats.js";
import "./SixBoatCourseTable.css";

const rate = (value) => (value == null ? "—" : value.toFixed(1));
const slash = (date) => date.replaceAll("-", "/");
const SIX_BOAT_PERIODS = ["recent3", "local"];

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
  const { status, rows: recentRows, baseline } = stats;
  const isLocal = period === "local";
  const text = (key, options) => t(`wakuInfo.sixBoat.${key}`, options);
  const rows =
    isLocal && status === "ready"
      ? buildSixBoatLocalRows({
          players,
          scopedByRacer: scopedBefore,
          venueCode,
          now: periodAnchor,
          baseline,
        })
      : recentRows;
  const terms = baseline?.terms ?? [];
  const range = isLocal
    ? baseline?.venue?.from && baseline?.venue?.to
      ? { from: slash(baseline.venue.from), to: slash(baseline.venue.to) }
      : null
    : terms.length > 0
      ? { from: slash(terms[0].calc_from), to: slash(terms.at(-1).calc_to) }
      : null;
  const diffTitle = text(isLocal ? "colDiffLocal" : "colDiff");
  const notes = isLocal
    ? ["noteLocal", "noteSample"]
    : ["noteDiff", "noteSample", "notePeriod"];
  return (
    <section className="six-boat-course">
      <h3>{text("title")}</h3>
      <p>{text("sub")}</p>
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
              {rows.map((row) => {
                const player = players.find(
                  (p) => Number(p.number) === row.boat,
                );
                const pending =
                  row.reliability === "loading" || row.reliability === "error";
                return (
                  <tr
                    key={row.boat}
                    tabIndex={0}
                    aria-selected={focusedBoat === row.boat}
                    className={`${row.reliability !== "ok" ? "is-muted" : ""}${focusedBoat === row.boat ? " is-focused" : ""}`}
                    onClick={() => onFocusBoat(row.boat)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onFocusBoat(row.boat);
                      }
                    }}
                  >
                    <th scope="row">
                      <BoatBadge n={row.boat} size="xs" />{" "}
                      <span translate="no">
                        {player?.name?.replace(/\s+/g, "")}
                      </span>
                      <small>{player?.grade}</small>
                    </th>
                    {row.reliability === "loading" ? (
                      <td
                        colSpan={4}
                        className="six-boat-course-pending rwit-loading"
                      >
                        {t("wakuInfo.loading")}
                      </td>
                    ) : row.reliability === "error" ? (
                      <td colSpan={4} className="six-boat-course-pending">
                        — <small>{text("localFetchError")}</small>
                      </td>
                    ) : null}
                    {!pending && (
                      <>
                        <td>
                          <span className="six-boat-course-rate">
                            {rate(row.winRate)}
                          </span>
                          <small
                            className="six-boat-course-diff"
                            title={diffTitle}
                          >
                            {row.diff == null
                              ? "—"
                              : text("diff", {
                                  value: `${row.diff >= 0 ? "+" : ""}${row.diff.toFixed(1)}`,
                                })}
                          </small>
                          <small>{text("avg", { value: rate(row.avg) })}</small>
                        </td>
                        <td className="six-boat-course-rate">
                          {rate(row.top2Rate)}
                        </td>
                        <td className="six-boat-course-rate">
                          {rate(row.top3Rate)}
                        </td>
                        <td>
                          {row.entries}
                          {row.reliability !== "ok" && (
                            <span title={text("smallSampleTitle")}> ⚠</span>
                          )}
                          {!row.contiguous && (
                            <small>{text("skippedPeriod")}</small>
                          )}
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
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
