import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  getCookieConsent,
  setCookieConsent,
  initGA,
  initAdSense,
  trackPageView,
} from "../utils/analytics";
import "./CookieConsent.css";

export default function CookieConsent() {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(() => getCookieConsent() === null);

  if (!visible) return null;

  const handleAccept = () => {
    setCookieConsent("accepted");
    initGA();
    // 同意前に表示したページは gtag が無く送れていないため、ここで1回送る
    trackPageView(`${window.location.pathname}${window.location.search}`);
    initAdSense();
    setVisible(false);
  };

  const handleReject = () => {
    setCookieConsent("rejected");
    setVisible(false);
  };

  // プライバシーポリシーは ja 専用（TRANSLATED_PATHS 未登録）のため、どの言語でも
  // プレフィックス無しの /privacy を指す。/en/privacy は LocalizedLayout が
  // /privacy へ location.replace するので、その往復を避けて直接リンクする
  return (
    <div className="cookie-consent">
      <div className="cookie-consent__inner">
        <p className="cookie-consent__text">
          {t("cookieConsent.textBeforeLink")}
          <Link to="/privacy" hrefLang="ja" className="cookie-consent__link">
            {t("cookieConsent.privacyLink")}
          </Link>
          {t("cookieConsent.textAfterLink")}
        </p>
        <div className="cookie-consent__actions">
          <button className="cookie-consent__accept" onClick={handleAccept}>
            {t("cookieConsent.accept")}
          </button>
          <button className="cookie-consent__reject" onClick={handleReject}>
            {t("cookieConsent.reject")}
          </button>
        </div>
      </div>
    </div>
  );
}
