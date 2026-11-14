import BoatBadge from "../BoatBadge";
import { fmtDate, venueLabel } from "../../../utils/analogyFormat";
import { neighborCounts } from "../../../utils/analogyAggregate";
import SimilarCompareDetail from "./SimilarCompareDetail";

const k = "aiPredictionTab.analogy.similar";

export default function SimilarCompareRow({
  x,
  i,
  items,
  exhibitionStage,
  today,
  open,
  onOpen,
  t,
}) {
  const c = neighborCounts(x, exhibitionStage);
  const isOpen = open === x.race_id;
  return (
    <div
      key={x.race_id}
      className={`af-nbr${isOpen ? " is-open" : ""}`}
      id={`af-nb-${x.race_id}`}
    >
      <button
        type="button"
        className="af-nbh"
        aria-expanded={isOpen}
        onClick={() => onOpen(isOpen ? null : x.race_id)}
      >
        <span className="af-nb-rk">{i + 1}</span>
        <span className="af-nb-nm">
          {fmtDate(x.date)} {venueLabel(x.venue_code, t)}
          {x.race_number}R
          <small>
            {[
              x.grade
                ? t(`aiPredictionTab.analogy.grades.${x.grade}`, x.grade)
                : null,
              x.round
                ? t(`aiPredictionTab.analogy.outlook.roundNames.${x.round}`)
                : null,
            ]
              .filter(Boolean)
              .join(" ")}
          </small>
        </span>
        <span className="af-nb-sc">
          {t(`${k}.counts`, {
            same: c.same,
            near: c.near,
            diff: c.diff,
          })}
        </span>
        <span className="af-bnrow" aria-hidden="true">
          {(x.finish ?? []).map((b, j) => (
            <BoatBadge key={j} n={b} size="xs" />
          ))}
        </span>
      </button>
      {isOpen && (
        <SimilarCompareDetail
          x={x}
          items={items}
          exhibitionStage={exhibitionStage}
          today={today}
          t={t}
        />
      )}
    </div>
  );
}
