import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useLocalizedPath } from "../hooks/useLocalizedPath";
import "./IntroBanner.css";

const DISMISS_KEY = "boatai:intro-banner-dismissed";

function IntroBanner() {
  const { t } = useTranslation();
  const localize = useLocalizedPath();
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(DISMISS_KEY) === "true",
  );

  if (dismissed) return null;

  const handleDismiss = () => {
    localStorage.setItem(DISMISS_KEY, "true");
    setDismissed(true);
  };

  return (
    <div className="intro-banner">
      <Link to={localize("/about")} className="intro-banner-link">
        {t("home.introBannerText")}
      </Link>
      <button
        type="button"
        className="intro-banner-close"
        onClick={handleDismiss}
        aria-label={t("home.introBannerClose")}
      >
        ×
      </button>
    </div>
  );
}

export default IntroBanner;
