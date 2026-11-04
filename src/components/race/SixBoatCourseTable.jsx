import { useTranslation } from "react-i18next";
import { useSixBoatCourseStats } from "../../hooks/useSixBoatCourseStats";
import BoatBadge from "./BoatBadge";
import "./SixBoatCourseTable.css";

const rate = (value) => value == null ? "—" : value.toFixed(1);

export default function SixBoatCourseTable({ raceDate, venueCode, players, focusedBoat, onFocusBoat }) {
  const { t } = useTranslation();
  const { status, rows, baseline } = useSixBoatCourseStats({ raceDate, venueCode, players });
  const terms = baseline?.terms ?? [];
  const text = (key, options) => t(`wakuInfo.sixBoat.${key}`, options);
  return (
    <section className="six-boat-course">
      <h3>{text("title")}</h3>
      <p>{text("sub")}</p>
      <p>{text("periodRecent3")}{terms.length > 0 && <> · {text("periodRange", {
        from: terms[0].calc_from.replaceAll("-", "/"),
        to: terms.at(-1).calc_to.replaceAll("-", "/"),
      })}</>}</p>
      {status === "loading" ? <p className="rwit-loading">{t("wakuInfo.loading")}</p>
        : status === "error" ? <p role="alert">{text("fetchError")}</p> : <>
          <table>
            <thead><tr>{["colBoat", "colWin", "colTop2", "colTop3", "colEntries"].map((key) =>
              <th key={key} scope="col">{text(key)}</th>)} </tr></thead>
            <tbody>{rows.map((row) => {
              const player = players.find((p) => Number(p.number) === row.boat);
              return (
                <tr key={row.boat} tabIndex={0} aria-selected={focusedBoat === row.boat}
                  className={`${row.reliability !== "ok" ? "is-muted" : ""}${focusedBoat === row.boat ? " is-focused" : ""}`}
                  onClick={() => onFocusBoat(row.boat)} onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onFocusBoat(row.boat);
                    }
                  }}>
                  <th scope="row"><BoatBadge n={row.boat} size="xs" /> <span translate="no">{player?.name?.replace(/\s+/g, "")}</span><small>{player?.grade}</small></th>
                  <td><span className="six-boat-course-rate">{rate(row.winRate)}</span>
                    <small className="six-boat-course-diff" title={text("colDiff")}>{row.diff == null ? "—" : text("diff", { value: `${row.diff >= 0 ? "+" : ""}${row.diff.toFixed(1)}` })}</small>
                    <small>{text("avg", { value: rate(row.avg) })}</small></td>
                  <td className="six-boat-course-rate">{rate(row.top2Rate)}</td>
                  <td className="six-boat-course-rate">{rate(row.top3Rate)}</td>
                  <td>{row.entries}{row.reliability !== "ok" && <span title={text("smallSampleTitle")}> ⚠</span>}
                    {!row.contiguous && <small>{text("skippedPeriod")}</small>}</td>
                </tr>
              );
            })}</tbody>
          </table>
          <div className="six-boat-course-notes">{["noteDiff", "noteSample", "notePeriod"].map((key) => <p key={key}>{text(key)}</p>)}</div>
        </>}
    </section>
  );
}
