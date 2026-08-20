/**
 * VenueSelector - レース場選択ドロップダウン
 */
import { useTranslation } from "react-i18next";

function VenueSelector({ venuesData, selectedVenueId, onVenueChange }) {
  const { t } = useTranslation();

  if (!venuesData || venuesData.length === 0) {
    return null;
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "1rem",
        marginBottom: "2rem",
        padding: "1.5rem",
        background: "var(--surface-card)",
        border: "1px solid var(--border-hairline)",
        borderRadius: "16px",
      }}
    >
      <label
        htmlFor="venue-select"
        style={{
          marginBottom: "0",
          fontWeight: "bold",
          fontSize: "1.1rem",
          color: "var(--text-primary)",
        }}
      >
        {t("venueSelector.label")}
      </label>
      <select
        id="venue-select"
        value={selectedVenueId || ""}
        onChange={(e) => onVenueChange(parseInt(e.target.value))}
        style={{
          padding: "0.75rem 1rem",
          fontSize: "1rem",
          borderRadius: "8px",
          border: "1px solid var(--border-hairline)",
          backgroundColor: "var(--surface-page)",
          color: "var(--text-primary)",
          cursor: "pointer",
          minWidth: "250px",
          outline: "none",
        }}
      >
        {venuesData.map((venue) => (
          <option key={venue.placeCd} value={venue.placeCd}>
            {t(`venues.${venue.placeCd}`, venue.placeName)} (
            {t("venueSelector.raceCount", { count: venue.races.length })})
          </option>
        ))}
      </select>
    </div>
  );
}

export default VenueSelector;
