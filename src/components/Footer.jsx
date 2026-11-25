import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useLocalizedPath } from "../hooks/useLocalizedPath";
import { isFeedbackHiddenPath } from "../pure/siteFeedback";
import { OPEN_SITE_FEEDBACK_EVENT } from "./siteFeedback/openEvent";
import "./Footer.css";

function Footer({ links = [], extra = null, copyrightText }) {
  const { t } = useTranslation();
  const localize = useLocalizedPath();
  const { pathname } = useLocation();
  // 右下のボタンに気づかなかった人のための、もう1つの入口（同じパネルを開く）
  const openFeedback = (e) =>
    window.dispatchEvent(
      new CustomEvent(OPEN_SITE_FEEDBACK_EVENT, {
        detail: { opener: e.currentTarget },
      }),
    );

  return (
    <footer className="site-footer">
      {extra}
      {links.length > 0 && (
        <div className="site-footer-links">
          {links.map((link) => (
            <Link key={link.to} to={localize(link.to)}>
              {link.label}
            </Link>
          ))}
          {!isFeedbackHiddenPath(pathname) && (
            <button
              type="button"
              className="site-footer-feedback"
              data-testid="site-feedback-footer"
              onClick={openFeedback}
            >
              {t("siteFeedback.footer")}
            </button>
          )}
        </div>
      )}
      <p className="site-footer-copyright">
        {copyrightText ?? t("footer.copyright")}
      </p>
    </footer>
  );
}

export default Footer;
