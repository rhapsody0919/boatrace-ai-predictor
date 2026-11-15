import { useTranslation } from "react-i18next";
import BoatBadge from "./BoatBadge";

const rate = (value) => (value == null ? "—" : value.toFixed(1));
// 10走未満（reliability "none"）は率を出さない（spec §1.2）。直近3期は純関数が null にしているが、
// 当地の行は1艇ずつの表と同じ率を持つので、ここで外す
const shown = (row, key) => (row.reliability === "none" ? null : row[key]);

function PendingCell({ reliability, text }) {
  const { t } = useTranslation();
  if (reliability === "loading") {
    return (
      <td colSpan={4} className="six-boat-course-pending rwit-loading">
        {t("wakuInfo.loading")}
      </td>
    );
  }
  return (
    <td colSpan={4} className="six-boat-course-pending">
      — <small>{text("localFetchError")}</small>
    </td>
  );
}

function RateCells({ row, text, diffTitle }) {
  return (
    <>
      <td>
        <span className="six-boat-course-rate">
          {rate(shown(row, "winRate"))}
        </span>
        <small className="six-boat-course-diff" title={diffTitle}>
          {row.diff == null
            ? "—"
            : text("diff", {
                value: `${row.diff >= 0 ? "+" : ""}${row.diff.toFixed(1)}`,
              })}
        </small>
        <small>{text("avg", { value: rate(row.avg) })}</small>
      </td>
      <td className="six-boat-course-rate">{rate(shown(row, "top2Rate"))}</td>
      <td className="six-boat-course-rate">{rate(shown(row, "top3Rate"))}</td>
      <td>
        {row.entries}
        {row.reliability !== "ok" && (
          <span title={text("smallSampleTitle")}> ⚠</span>
        )}
        {!row.contiguous && <small>{text("skippedPeriod")}</small>}
      </td>
    </>
  );
}

export default function SixBoatCourseTableRow({
  row,
  player,
  text,
  diffTitle,
  focusedBoat,
  onFocusBoat,
}) {
  const pending = row.reliability === "loading" || row.reliability === "error";
  return (
    <tr
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
        <span translate="no">{player?.name?.replace(/\s+/g, "")}</span>
        <small>{player?.grade}</small>
      </th>
      {pending ? (
        <PendingCell reliability={row.reliability} text={text} />
      ) : (
        <RateCells row={row} text={text} diffTitle={diffTitle} />
      )}
    </tr>
  );
}
