/**
 * VenueGridSkeleton - VenueGridのローディング用プレースホルダー
 * 実データ表示時と同じグリッド/カードCSS（venue-grid / venue-grid-card）を
 * そのまま流用することで高さを一致させ、ロード完了時のレイアウトシフト（CLS）を防ぐ
 */
import { useTranslation } from "react-i18next";
import "./VenueGrid.css";
import "./VenueGridCard.css";
import "./VenueGridSkeleton.css";

const PLACEHOLDER_COUNT = 24;

function VenueGridSkeleton() {
  const { t } = useTranslation();

  return (
    <div
      className="venue-grid"
      role="status"
      aria-label={t("home.loadingTitle")}
    >
      {Array.from({ length: PLACEHOLDER_COUNT }, (_, i) => (
        <div
          key={i}
          className="venue-grid-card venue-grid-skeleton-card"
          aria-hidden="true"
        >
          <div className="venue-grid-skeleton-bar venue-grid-skeleton-bar--name" />
          <div className="venue-grid-skeleton-bar venue-grid-skeleton-bar--status" />
        </div>
      ))}
    </div>
  );
}

export default VenueGridSkeleton;
