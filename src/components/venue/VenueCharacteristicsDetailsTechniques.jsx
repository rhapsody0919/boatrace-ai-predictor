import { translateTechnique } from "../race/raceIndicators";
import Lane from "./VenueCharacteristicsDetailsLane";
import {
  BOATS,
  TECHNIQUE_SLUG,
  buildTechniqueRow,
  slugOf,
} from "./VenueCharacteristicsDetailsLogic";

function TechniqueRow({ t, row }) {
  const { boat, total, items, itemLabels, label, isSmall } = row;
  return (
    <div
      className="venue-details__technique-row"
      data-testid={`venue-details-technique-${boat}`}
    >
      <Lane boat={boat} />
      <span className="venue-details__stack" role="img" aria-label={label}>
        {items.map((x) => (
          <span
            key={x.technique}
            className={`venue-details__swatch is-${slugOf(x.technique)}`}
            style={{ width: `${x.share}%` }}
          />
        ))}
      </span>
      <span
        className={`venue-details__count${isSmall ? " is-small-sample" : ""}`}
      >
        {t("venueCharacteristics.details.winCount", {
          count: total,
        })}
      </span>
      <span className="venue-details__breakdown">
        {items.map((x, index) => (
          <span key={x.technique}>
            {index > 0 ? t("listSeparator") : null}
            <span className="venue-details__breakdown-item">
              {itemLabels[index]}
            </span>
          </span>
        ))}
      </span>
    </div>
  );
}

export default function TechniqueSection({ t, techniqueData }) {
  return (
    <section>
      <h3>{t("venueCharacteristics.details.techniqueTitle")}</h3>
      <p className="venue-details__sub">
        {t("venueCharacteristics.details.techniqueNote")}
      </p>
      <ul className="venue-details__legend" aria-hidden="true">
        {Object.entries(TECHNIQUE_SLUG).map(([name, slug]) => (
          <li key={slug}>
            <i className={`venue-details__swatch is-${slug}`} />
            {translateTechnique(t, name)}
          </li>
        ))}
      </ul>
      <div className="venue-details__techniques">
        {BOATS.map((boat) => {
          const row = buildTechniqueRow(boat, techniqueData, t);
          return row ? <TechniqueRow key={boat} t={t} row={row} /> : null;
        })}
      </div>
      <p className="venue-details__sub">
        {t("venueCharacteristics.details.smallSampleNote")}
      </p>
    </section>
  );
}
