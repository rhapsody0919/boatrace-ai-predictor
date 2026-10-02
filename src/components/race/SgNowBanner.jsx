import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { getSgNowVenues } from "../../utils/sgNowVenues";
import { useLocalizedPath } from "../../hooks/useLocalizedPath";
import { GRADE_CONFIG } from "../../constants/gradeConfig";
import "./SgNowBanner.css";

/**
 * トップの「SG開催中」帯（集客レーン、2026-10-02。ユーザー承認: SGダービー期間中の導線）。
 *
 * その日に SG を開催している会場があるときだけ出す。ダービーに限らず、SG 全般に効く。
 * 「{会場}競艇予想 ai」は SG 開催週に跳ねる（桐生SGの週に1週1,489表示）ため、トップから
 * 開催場の会場ページへ1タップで行けるようにする。
 */
function SgNowBanner({ venuesData }) {
  const { t } = useTranslation();
  const localize = useLocalizedPath();
  const venues = getSgNowVenues(venuesData);
  if (venues.length === 0) return null;

  return (
    <div
      className="sg-now-banner"
      role="region"
      aria-label={t("home.sgNow.region")}
    >
      {venues.map(({ venueCode, seriesTitle }) => (
        <Link
          key={venueCode}
          to={localize(`/venue/${venueCode}`)}
          className="sg-now-banner__link"
        >
          <span
            className="sg-now-banner__grade"
            style={{ backgroundColor: GRADE_CONFIG.SG.color }}
            translate="no"
          >
            SG
          </span>
          <span className="sg-now-banner__text">
            {seriesTitle
              ? t("home.sgNow.withTitle", {
                  series: seriesTitle,
                  venue: t(`venues.${venueCode}`),
                })
              : t("home.sgNow.withoutTitle", {
                  venue: t(`venues.${venueCode}`),
                })}
          </span>
          <span className="sg-now-banner__cta">{t("home.sgNow.cta")}</span>
        </Link>
      ))}
    </div>
  );
}

export default SgNowBanner;
