import { useState } from 'react';
import { Link } from 'react-router-dom';
import { getCookieConsent, setCookieConsent, initGA, initAdSense, trackPageView } from '../utils/analytics';
import './CookieConsent.css';

export default function CookieConsent() {
  const [visible, setVisible] = useState(() => getCookieConsent() === null);

  if (!visible) return null;

  const handleAccept = () => {
    setCookieConsent('accepted');
    initGA();
    // 同意前に表示したページは gtag が無く送れていないため、ここで1回送る
    trackPageView(`${window.location.pathname}${window.location.search}`);
    initAdSense();
    setVisible(false);
  };

  const handleReject = () => {
    setCookieConsent('rejected');
    setVisible(false);
  };

  return (
    <div className="cookie-consent">
      <div className="cookie-consent__inner">
        <p className="cookie-consent__text">
          当サイトでは、サービス向上のためにCookieを使用しています。
          詳しくは<Link to="/privacy" className="cookie-consent__link">プライバシーポリシー</Link>をご確認ください。
        </p>
        <div className="cookie-consent__actions">
          <button className="cookie-consent__accept" onClick={handleAccept}>
            同意する
          </button>
          <button className="cookie-consent__reject" onClick={handleReject}>
            拒否する
          </button>
        </div>
      </div>
    </div>
  );
}
