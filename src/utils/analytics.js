// Cookie同意管理
const CONSENT_KEY = "boatai:cookie-consent";

export const getCookieConsent = () => localStorage.getItem(CONSENT_KEY);
export const setCookieConsent = (value) =>
  localStorage.setItem(CONSENT_KEY, value);

// AdSense動的ロード
export const initAdSense = () => {
  if (document.querySelector('script[src*="adsbygoogle"]')) return;
  const script = document.createElement("script");
  script.async = true;
  script.src =
    "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-4942038531343866";
  script.crossOrigin = "anonymous";
  document.head.appendChild(script);
};

// 同意済みならGA+AdSenseを初期化
export const initTrackingIfConsented = () => {
  if (getCookieConsent() === "accepted") {
    initGA();
    initAdSense();
  }
};

// Google Analytics utility
export const initGA = () => {
  const GA_MEASUREMENT_ID = import.meta.env.VITE_GA_MEASUREMENT_ID;

  // 開発環境またはGA IDが設定されていない場合はスキップ
  if (!GA_MEASUREMENT_ID || import.meta.env.DEV) {
    console.log("Google Analytics is disabled in development mode");
    return;
  }

  // 管理画面から開いたときは gtag 自体を読み込まない。page_view を止めるだけでは、
  // session_start・user_engagement・scroll が /admin のURLで送られ続けるため（BOA-531）
  if (isExcludedFromPageView(window.location.pathname)) return;

  // GA4スクリプトを動的に読み込み
  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;
  document.head.appendChild(script);

  // dataLayerとgtagを初期化
  window.dataLayer = window.dataLayer || [];
  window.gtag = function () {
    window.dataLayer.push(arguments);
  };
  window.gtag("js", new Date());
  // page_view は trackPageView の1経路だけで送る（BOA-531）。
  // config の自動送信を残すと、初回表示を AppRouter の PageViewTracker と二重に数える
  window.gtag("config", GA_MEASUREMENT_ID, { send_page_view: false });
};

// 運営者の管理画面は計測しない（/admin/sns-hub だけで30日104PVが実需に混ざっていた）。
// 言語プレフィックス付き（/en/admin/...）も対象にする
export const isExcludedFromPageView = (pathname) =>
  /^(\/[a-z]{2}(-[A-Za-z]{2})?)?\/admin(\/|$)/.test(pathname);

let lastPageLocation = null;

// ページビューを送信する。GA4 への page_view はこの関数だけが送る（BOA-531）。
// - 以前は gtag('config', id, { page_path }) を再送していたが、GA4 は URL が変わらない
//   config の再送では何も送らず、SPA の page_view は拡張計測「ブラウザの履歴イベント」任せに
//   なっていた。その結果、会場・レース詳細の閲覧が page_location="/" で記録され、
//   トップ（/）のPVに混ざっていた（9/20〜28 の "/" 8,854PV のうち、トップのタイトルは2,324件）
// - page_location を明示し、AdSense の vignette 広告が付ける #google_vignette 等の
//   ハッシュは含めない。page_title は渡さず、gtag が送信時点の document.title を使う
// - GA4 管理画面で拡張計測の「ブラウザの履歴イベントに基づくページの変更」をOFFにすること。
//   ONのままだと、この関数と履歴イベントで二重に数える
export const trackPageView = (pathWithSearch) => {
  if (!window.gtag) return;
  const pathname = pathWithSearch.split("?")[0];
  if (isExcludedFromPageView(pathname)) return;

  if (lastPageLocation === null) trackAnalogyReturnVisit();
  const pageLocation = `${window.location.origin}${pathWithSearch}`;
  window.gtag("event", "page_view", {
    page_location: pageLocation,
    // 初回は document.referrer（外部の流入元）をそのまま使わせる
    ...(lastPageLocation ? { page_referrer: lastPageLocation } : {}),
  });
  lastPageLocation = pageLocation;
};

// イベントをトラッキング
export const trackEvent = (eventName, eventParams = {}) => {
  if (window.gtag) {
    window.gtag("event", eventName, eventParams);
  }
};

// 龍神ソナー（BOA-271）を最後に画面で見た時刻。ソナーを見た人の7日以内の再訪を数えるのに使う。
// キャッシュ全削除（boatai: 接頭辞を消す）で消えないよう boatai-user: にする
const ANALOGY_LAST_SEEN_KEY = "boatai-user:analogy-last-seen";
const ANALOGY_RETURN_SENT_KEY = "boatai-user:analogy-return-sent";
const DAY_MS = 24 * 60 * 60 * 1000;
export const ANALOGY_RETURN_DAYS = 7;
// 見てから30分（GA4 のセッションの区切りと同じ）以内は同じ来訪とみなす。
// 見た直後に別のレースを新しいタブで開いただけで「再訪」にしない
const ANALOGY_SAME_VISIT_MS = 30 * 60 * 1000;

export const markAnalogySeen = (now = Date.now()) => {
  try {
    localStorage.setItem(ANALOGY_LAST_SEEN_KEY, String(now));
  } catch {
    // 保存できない環境（プライベートブラウズ等）では再訪を数えないだけ
  }
};

/**
 * 前回ソナーを見てから何日目の来訪か。30分以内（同じ来訪）・7日より後なら null。
 * 純関数にしてテストで境界を固定する
 */
export const analogyReturnDays = (lastSeen, now) => {
  if (!Number.isFinite(lastSeen) || now - lastSeen < ANALOGY_SAME_VISIT_MS)
    return null;
  const days = Math.floor((now - lastSeen) / DAY_MS);
  return days <= ANALOGY_RETURN_DAYS ? days : null;
};

// ページを開いた最初の page_view で、前回ソナーを見たのが7日以内なら1回送る。
// 同じタブの再読み込みでは送らない（sessionStorage）。新しいタブは新しい来訪として数える
const trackAnalogyReturnVisit = () => {
  try {
    if (sessionStorage.getItem(ANALOGY_RETURN_SENT_KEY)) return;
    sessionStorage.setItem(ANALOGY_RETURN_SENT_KEY, "1");
    const days = analogyReturnDays(
      Number(localStorage.getItem(ANALOGY_LAST_SEEN_KEY)),
      Date.now(),
    );
    if (days !== null)
      trackEvent("analogy_return_visit", { analogy_days_since: days });
  } catch {
    // ストレージが使えない環境では送らない
  }
};

// 表示言語をユーザープロパティとして設定（i18n の languageChanged から呼ばれる）
// GA4 側でカスタムディメンション「app_language」として登録すると言語別分析が可能
export const trackLanguage = (lng) => {
  if (window.gtag) {
    window.gtag("set", "user_properties", { app_language: lng });
  }
};

// 言語切替イベント（LanguageSwitcher から呼ばれる）
export const trackLanguageSwitch = (fromLng, toLng) => {
  trackEvent("language_change", {
    from_language: fromLng,
    to_language: toLng,
  });
};

// SPA ルート変更時にAuto Adsを再スキャン
export const refreshAdsOnRouteChange = () => {
  try {
    const adsbygoogle = window.adsbygoogle || [];
    adsbygoogle.push({});
  } catch (e) {
    // AdSense未読み込み時は無視
  }
};
