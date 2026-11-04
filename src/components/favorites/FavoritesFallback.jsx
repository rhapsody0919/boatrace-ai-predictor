/**
 * 区画「お気に入り選手の出走」の代わりの表示と☆の会場の行（GS04-8、BOA-1274、モックの案A）。
 * 中身は buildFavoritesFallback（src/pure/favoriteRuns.js）の結果をそのまま描く。
 *
 * - favState "runs": 出走の行の下に「お気に入りの会場」（☆の会場が0件なら出さない）
 * - favState "no_runs": ☆の選手はいるが今日の出走なし → ☆の会場 → 今日の SG・G1（無ければ開催場の数）
 * - favState "no_favorites": ☆の選手0人 → ☆の会場 → SG・G1（無ければ開催場の数）→ ☆の付け方
 */
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useLocalizedPath } from "../../hooks/useLocalizedPath";
import { trackEvent } from "../../utils/analytics";
import { GRADE_CONFIG } from "../../constants/gradeConfig";
import { RACER_LIMIT } from "../../pure/favorites";

const track = (rowKind, rowLink, favState) =>
  trackEvent("today_row_click", {
    row_kind: rowKind,
    row_link: rowLink,
    row_state: "none",
    fav_state: favState,
  });

function useVenueStateText() {
  const { t } = useTranslation();
  return (venue) => {
    if (venue.state === "open")
      return t("favorites.venues.open", {
        race: venue.nextRaceNumber,
        time: `${venue.nextStartTime}${t("home.jstNote")}`,
      });
    return t(
      venue.state === "finished"
        ? "favorites.venues.finished"
        : "favorites.venues.closed",
    );
  };
}

/** 出走ありのときの、区画の下の「お気に入りの会場」 */
export function FavoriteVenueChips({ favVenues }) {
  const { t } = useTranslation();
  const localize = useLocalizedPath();
  const stateText = useVenueStateText();
  if (favVenues.length === 0) return null;
  return (
    <div className="favorite-runs__venues" data-testid="favorite-venues">
      <h4 className="favorite-runs__venues-title">
        {t("favorites.venues.title")}
      </h4>
      <div className="favorite-runs__chips">
        {favVenues.map((venue) => (
          <Link
            key={venue.venueCode}
            to={localize(`/venue/${venue.venueCode}`)}
            className="favorite-runs__chip"
            onClick={() => track("fav_venue", "venue_page", "runs")}
          >
            {t(`venues.${venue.venueCode}`)}
            <small>{stateText(venue)}</small>
          </Link>
        ))}
      </div>
    </div>
  );
}

/** 出走が無いとき（☆0件・今日の出走なし）の中身 */
export default function FavoritesFallback({ fallback, favState, racerCount }) {
  const { t } = useTranslation();
  const localize = useLocalizedPath();
  const stateText = useVenueStateText();
  const { favVenues, gradeVenues, openVenueCount } = fallback;
  const hasGrades = gradeVenues.length > 0;
  const message =
    favState === "no_runs"
      ? t("favorites.fallback.noRuns", { count: racerCount })
      : t(
          hasGrades
            ? "favorites.fallback.noFavorites"
            : "favorites.fallback.noFavoritesPlain",
        );

  return (
    <>
      <p className="favorite-runs__message">{message}</p>
      {(favVenues.length > 0 || hasGrades) && (
        <ul className="favorite-runs__alt-list">
          {favVenues.map((venue) => (
            <li key={`fav-${venue.venueCode}`} className="favorite-runs__alt">
              <span className="favorite-runs__alt-label favorite-runs__alt-label--fav">
                {t("favorites.venues.badge")}
              </span>
              <span className="favorite-runs__alt-body">
                <span className="favorite-runs__alt-venue">
                  {t(`venues.${venue.venueCode}`)}
                </span>
                <span className="favorite-runs__alt-text">
                  {stateText(venue)}
                </span>
              </span>
              <Link
                to={localize(`/venue/${venue.venueCode}`)}
                className="favorite-runs__link favorite-runs__alt-link"
                onClick={() => track("fav_venue", "venue_page", favState)}
              >
                {t("favorites.fallback.venuePage")}
              </Link>
            </li>
          ))}
          {gradeVenues.map((venue) => (
            <li key={`grade-${venue.venueCode}`} className="favorite-runs__alt">
              <span
                className="favorite-runs__alt-label"
                style={{ backgroundColor: GRADE_CONFIG[venue.grade].color }}
              >
                {GRADE_CONFIG[venue.grade].label}
              </span>
              <span className="favorite-runs__alt-body">
                <span className="favorite-runs__alt-venue">
                  {t(`venues.${venue.venueCode}`)}
                </span>
                {venue.seriesDay != null && venue.finalStartTime && (
                  <span className="favorite-runs__alt-text">
                    {t("favorites.fallback.gradeLine", {
                      day: venue.seriesDay,
                      time: `${venue.finalStartTime}${t("home.jstNote")}`,
                    })}
                  </span>
                )}
              </span>
              <Link
                to={localize(`/venue/${venue.venueCode}`)}
                className="favorite-runs__link favorite-runs__alt-link"
                onClick={() => track("grade_venue", "venue_page", favState)}
              >
                {t("favorites.fallback.venuePage")}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {!hasGrades && openVenueCount > 0 && (
        <a
          href="#today-venues"
          className="favorite-runs__toggle favorite-runs__venue-count"
          onClick={(event) => {
            track("grade_venue", "venue_list", favState);
            // #today-venues はこの区画を含む外側の枠なので、飛ぶと上の見出しに戻る。会場の一覧へ送る
            const grid = document.querySelector(".venue-grid");
            if (grid) {
              event.preventDefault();
              // 固定のヘッダーの下に隠れないよう、その高さだけ上に余白を取る
              const header = document.querySelector(".app-header");
              window.scrollTo({
                top:
                  grid.getBoundingClientRect().top +
                  window.scrollY -
                  (header?.offsetHeight ?? 0) -
                  8,
                behavior: "smooth",
              });
            }
          }}
        >
          {t("favorites.fallback.venueCount", { count: openVenueCount })}
        </a>
      )}
      {favState === "no_favorites" && (
        <p className="favorite-runs__howto">
          {t("favorites.fallback.howTo", { max: RACER_LIMIT })}
        </p>
      )}
    </>
  );
}
