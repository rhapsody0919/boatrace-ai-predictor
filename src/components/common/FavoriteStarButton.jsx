import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useFavorites } from "../../hooks/useFavorites.js";
import { RACER_LIMIT } from "../../pure/favorites.js";
import { trackEvent } from "../../utils/analytics.js";
import Toast, { useToast } from "../Toast.jsx";
import "./FavoriteStarButton.css";

export default function FavoriteStarButton({ type, id, name, entry, withLabel = false }) {
  const { t } = useTranslation();
  const favorites = useFavorites();
  const { toast, showToast } = useToast();
  const isRacer = type === "racer";
  const active = isRacer ? favorites.isRacerFavorite(id) : favorites.isVenueFavorite(id);

  const toggle = () => {
    const result = isRacer ? favorites.toggleRacer(id) : favorites.toggleVenue(id);
    const params = { fav_type: type, fav_entry: entry };
    if (result === "limit") {
      trackEvent("favorite_limit", params);
      showToast(t("favorites.toast.racerLimit", { max: RACER_LIMIT }), "error", { duration: 6000 });
    } else if (result === "save_failed") {
      showToast(t("favorites.toast.saveFailed"), "error");
    } else {
      const count = (isRacer ? favorites.racers : favorites.venues).length;
      trackEvent(result === "added" ? "favorite_add" : "favorite_remove", {
        ...params, fav_count: count + (result === "added" ? 1 : -1),
      });
      showToast(t(result === "removed" ? "favorites.toast.removed" :
        isRacer ? "favorites.toast.addedRacer" : "favorites.toast.addedVenue"));
    }
  };

  return (
    <>
      <button type="button" className="favorite-star-button" aria-pressed={active}
        aria-label={t(active ? "favorites.star.ariaRemove" : "favorites.star.ariaAdd", { name })}
        onClick={toggle}>
        <span className="favorite-star-button__icon" aria-hidden="true">{active ? "★" : "☆"}</span>
        {withLabel && <span>{t(active ? "favorites.star.added" : "favorites.star.add")}</span>}
      </button>
      {/* 固定位置のトーストが sticky な親（出走表の見出し等）の重なり順に閉じ込められ、
          下部ナビ（z-index 1500）に隠れないよう body に出す */}
      {createPortal(
        <Toast {...toast} message={<span className="favorite-star-button__notice">{toast.message}</span>} />,
        document.body,
      )}
    </>
  );
}
