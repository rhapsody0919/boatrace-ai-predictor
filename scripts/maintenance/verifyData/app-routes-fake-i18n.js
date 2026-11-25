/**
 * app-routes-fake-i18n.js - react-i18next と、ルートの表に関わらない部品（CookieConsent・HreflangTags・SiteFeedback）の偽
 * （app-routes.js が src/AppRouter.jsx からの import だけをここへ向ける。verify ではない）。
 */
const i18n = { resolvedLanguage: null, changeLanguage: () => Promise.resolve() };
export const useTranslation = () => ({ t: (key) => key, i18n });
export default function Nothing() {
  return null;
}
