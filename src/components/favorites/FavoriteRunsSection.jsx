import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useFavorites } from "../../hooks/useFavorites";
import { useLocalizedPath } from "../../hooks/useLocalizedPath";
import { buildFavoriteRuns } from "../../pure/favoriteRuns";
import { racerPagePath } from "../../utils/racerPagePath";
import { trackEvent } from "../../utils/analytics";
import { isAnalogyFinderEnabled } from "../../config/featureFlags";
import { GRADE_CONFIG } from "../../constants/gradeConfig";
import BoatBadge from "../race/BoatBadge";
import "./FavoriteRunsSection.css";

export default function FavoriteRunsSection({ venuesData, nowHHMM }) {
  const { t, i18n } = useTranslation();
  const localize = useLocalizedPath();
  const { racers } = useFavorites();
  const [showMore, setShowMore] = useState(false);
  const [showPast, setShowPast] = useState(false);
  const { upcoming, past, runningRacerCount, raceCount } =
    buildFavoriteRuns(venuesData, racers, nowHHMM);
  if (upcoming.length + past.length === 0) return null;

  const renderRow = (row, state, index) => {
    const grade = ["SG", "G1"].includes(row.raceGrade) ? GRADE_CONFIG[row.raceGrade] : null;
    const links = [
      ["racer_page", racerPagePath(row.racerId), "linkRacer"],
      ...(isAnalogyFinderEnabled() ? [["sonar", localize(`/race/${row.raceId}?tab=sonar`), "linkSonar"]] : []),
      ...(i18n.resolvedLanguage === "ja" ? [["assist", `/race/${row.raceId}/assist`, "linkAssist"]] : []),
    ];
    return (
      <li key={`${row.raceId}-${row.racerId}`}
        className={`favorite-runs__row${state === "upcoming" && index >= 4 && !showMore ? " favorite-runs__extra" : ""}`}>
        <span className="favorite-runs__deadline"><strong>{row.startTime}</strong> {t("favorites.section.deadline")}</span>
        <span className="favorite-runs__race">
          {grade && <span className="favorite-runs__grade" style={{ backgroundColor: grade.color }}>{grade.label}</span>}
          {t(`venues.${row.venueCode}`)} {row.raceNumber}R
        </span>
        <span className="favorite-runs__racer"><BoatBadge n={row.boat} />
          <strong translate="no">{row.name}</strong> <span>{row.grade}</span>
        </span>
        <span className="favorite-runs__links">
          {links.map(([row_link, path, label]) => <Link key={row_link} to={path}
            onClick={() => trackEvent("today_row_click", {
              row_kind: "run", row_link, row_state: state, fav_state: "runs",
            })}>{t(`favorites.section.${label}`)}</Link>)}
        </span>
      </li>
    );
  };

  return (
    <section className="favorite-runs" data-testid="favorite-runs" aria-labelledby="favorite-runs-title">
      <h2 id="favorite-runs-title">{t("favorites.section.title")}</h2>
      <p>{t("favorites.section.lead", { racers: racers.length, running: runningRacerCount, races: raceCount })}</p>
      {i18n.resolvedLanguage !== "ja" && <p>{t("home.jstNote")}</p>}
      <ul className="favorite-runs__list">{upcoming.map((row, index) => renderRow(row, "upcoming", index))}</ul>
      {upcoming.length > 4 && <button type="button" className="favorite-runs__more"
        aria-expanded={showMore} onClick={() => setShowMore(!showMore)}>
        {t("favorites.section.showMore", { count: upcoming.length - 4 })}
      </button>}
      {past.length > 0 && <>
        <button type="button" aria-expanded={showPast} onClick={() => setShowPast(!showPast)}>
          {t("favorites.section.pastRuns", { count: past.length })}
        </button>
        {showPast && <ul className="favorite-runs__list">{past.map((row, index) => renderRow(row, "past", index))}</ul>}
      </>}
      <p className="favorite-runs__note">{t("favorites.section.note")}</p>
    </section>
  );
}
