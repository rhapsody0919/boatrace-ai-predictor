import { useState, useEffect, useRef } from "react";
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
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef(null);

  // resolvedLanguage は 'en-US' → 'en' のように正規化済み
  const currentLang = i18n.resolvedLanguage || DEFAULT_LANGUAGE;
  const currentLangConfig = SUPPORTED_LANGUAGES.find(
    (lang) => lang.code === currentLang,
  );

  // 現在のページが提供されていない言語はボタンを無効化する（例: /venues は ja/ko 非対応）
  const { basePath } = parseLangFromPath(pathname);
  const availableLangCodes = getAvailableLanguages(basePath).map((l) => l.code);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, [isOpen]);

  // 言語切替時は URL も言語プレフィックスに同期させる（SEO: 言語別 URL）
  const handleChange = (code) => {
    setIsOpen(false);
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
    <div className="language-switcher" ref={rootRef}>
      <button
        type="button"
        className="language-switcher-trigger"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-label={t("language.switchLabel")}
        aria-expanded={isOpen}
      >
        <span aria-hidden="true">🌐</span>
        <span className="language-switcher-current">
          {currentLangConfig?.shortLabel ?? currentLang.toUpperCase()}
        </span>
      </button>
      {isOpen && (
        <div className="language-switcher-dropdown" role="menu">
          {SUPPORTED_LANGUAGES.map((lang) => {
            const isAvailable = availableLangCodes.includes(lang.code);
            return (
              <button
                key={lang.code}
                type="button"
                role="menuitemradio"
                className={`language-switcher-option ${currentLang === lang.code ? "active" : ""} ${isAvailable ? "" : "unavailable"}`}
                onClick={() => isAvailable && handleChange(lang.code)}
                aria-checked={currentLang === lang.code}
                aria-disabled={!isAvailable}
                title={
                  isAvailable
                    ? lang.label
                    : t("language.notAvailable", { lang: lang.label })
                }
              >
                {lang.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default LanguageSwitcher;
