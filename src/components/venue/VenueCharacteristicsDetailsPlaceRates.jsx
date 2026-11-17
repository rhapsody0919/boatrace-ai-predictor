import Lane from "./VenueCharacteristicsDetailsLane";
import { formatPct } from "./VenueCharacteristicsDetailsLogic";

export default function PlaceRatesSection({ t, outcomeData, rates }) {
  return (
    <section>
      <h3>{t("venueCharacteristics.details.placeRatesTitle")}</h3>
      <p className="venue-details__sub">
        {t("venueCharacteristics.details.placeRatesNote", {
          count: outcomeData.total_races,
        })}
      </p>
      <table className="venue-details__table">
        <thead>
          <tr>
            <th scope="col">{t("venueCharacteristics.details.boat")}</th>
            <th scope="col">
              {t("venueCharacteristics.details.top2Rate")}
            </th>
            <th scope="col">
              {t("venueCharacteristics.details.top3Rate")}
            </th>
          </tr>
        </thead>
        <tbody>
          {rates.map((r) => (
            <tr key={r.boat}>
              <td>
                <Lane boat={r.boat} />
              </td>
              <td>{formatPct(r.top2Rate)}</td>
              <td>{formatPct(r.top3Rate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
