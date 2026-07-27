import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import {
  SUPPORTED_LANGUAGES,
  DEFAULT_LANGUAGE,
  LANGUAGE_STORAGE_KEY,
  localizePath,
  parseLangFromPath,
  getAvailableLanguages,
} from "../config/languages";
import { trackLanguageSwitch } from "../utils/analytics";
import "./LanguageSwitcher.css";

function LanguageSwitcher() {
  const { i18n, t } = useTranslation();
  const { pathname, search } = useLocation();
  const navigate = useNavigate();

  // resolvedLanguage は 'en-US' → 'en' のように正規化済み
  const currentLang = i18n.resolvedLanguage || DEFAULT_LANGUAGE;

  // 現在のページが提供されていない言語はボタンを無効化する（例: /venues は ja/ko 非対応）
  const { basePath } = parseLangFromPath(pathname);
  const availableLangCodes = getAvailableLanguages(basePath).map((l) => l.code);

  // 言語切替時は URL も言語プレフィックスに同期させる（SEO: 言語別 URL）
  const handleChange = (code) => {
    if (code === currentLang) return;
    trackLanguageSwitch(currentLang, code);

    // changeLanguage は非同期のため、Layout のリダイレクト判定が参照する
    // localStorage を先に確定させる（競合すると切替前の言語 URL に戻されてしまう）
    localStorage.setItem(LANGUAGE_STORAGE_KEY, code);
    i18n.changeLanguage(code);

    const target = localizePath(pathname, code);
    if (target !== pathname) {
      navigate(`${target}${search}`, { replace: true });
    }
  };

  return (
    <div
      className="language-switcher"
      role="group"
      aria-label={t("language.switchLabel")}
    >
      <span className="language-switcher-icon" aria-hidden="true">
        🌐
      </span>
      {SUPPORTED_LANGUAGES.map((lang) => {
        const isAvailable = availableLangCodes.includes(lang.code);
        return (
          <button
            key={lang.code}
            className={`language-switcher-btn ${currentLang === lang.code ? "active" : ""} ${isAvailable ? "" : "unavailable"}`}
            onClick={() => isAvailable && handleChange(lang.code)}
            aria-pressed={currentLang === lang.code}
            aria-disabled={!isAvailable}
            title={
              isAvailable
                ? lang.label
                : t("language.notAvailable", { lang: lang.label })
            }
            aria-label={
              isAvailable
                ? lang.label
                : `${lang.label}: ${t("language.notAvailable", { lang: lang.label })}`
            }
          >
            {lang.shortLabel ?? lang.code.toUpperCase()}
          </button>
        );
      })}
    </div>
  );
}

export default LanguageSwitcher;
