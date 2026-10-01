import { useState, useEffect, useRef } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useLocalizedPath } from "../hooks/useLocalizedPath";
import { parseLangFromPath, getAvailableLanguages } from "../config/languages";
import LanguageSwitcher from "./LanguageSwitcher";
import ThemeToggle from "./ThemeToggle";
import RacerSearchBox from "./RacerSearchBox";
import { THEME_SWITCHING_ENABLED } from "../config/theme";
import "./Header.css";

function Header() {
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const localize = useLocalizedPath();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isCompressed, setIsCompressed] = useState(false);
  const menuRef = useRef(null);

  // 現在のページ/タブを判定（言語プレフィックスを除いて比較）
  const getActiveTab = () => {
    const { basePath: pathname } = parseLangFromPath(location.pathname);
    if (pathname === "/") {
      // ホームページの場合はハッシュを確認
      const hash = location.hash.slice(1);
      return hash || "races";
    }
    // その他のページ
    if (pathname === "/hit-races") return "hit-races";
    if (pathname === "/accuracy") return "accuracy";
    if (pathname === "/winning-technique") return "winning-technique";
    if (pathname === "/today") return "today";
    if (pathname === "/picks") return "picks";
    if (pathname.startsWith("/races")) return "past-races";
    if (pathname === "/racers") return "racers";
    if (pathname === "/how-to-use") return "how-to-use";
    if (pathname === "/guide") return "guide";
    if (pathname.startsWith("/venues")) return "venues";
    if (pathname.startsWith("/blog")) return "blog";
    if (pathname === "/faq") return "faq";
    if (pathname === "/about") return "about";
    if (pathname === "/profile") return "profile";
    return "races";
  };

  const activeTab = getActiveTab();

  // 会場別ビジターガイドは対応言語（config の LANGUAGE_ONLY_PATHS）のみメニューに表示する
  const { lng: currentLng } = parseLangFromPath(location.pathname);
  const showVenues = getAvailableLanguages("/venues").some(
    (l) => l.code === currentLng,
  );

  // メニュー外クリック検出
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setIsMenuOpen(false);
      }
    };

    if (isMenuOpen) {
      document.addEventListener("click", handleClickOutside);
      return () => document.removeEventListener("click", handleClickOutside);
    }
  }, [isMenuOpen]);

  // スクロール検出：デスクトップのみ圧縮
  // 圧縮と復帰の閾値を分ける（BOA-459）。ヘッダーは sticky で文書の流れの中にあり、
  // 圧縮で約22px縮むと、ブラウザのスクロールアンカーがその分 scrollY を戻す。
  // 閾値が1つ（100px）だと、101〜122pxに止めた瞬間に
  // 「圧縮→scrollYが100未満に戻る→復帰→scrollYが100超に戻る→圧縮」が毎フレーム続き、
  // ヘッダーと下の内容が揺れ続けていた（E2Eでは要素が stable にならずクリックできない）。
  // 2つの閾値の差を縮む量より大きく取れば、どちらの状態でも反対側の閾値を跨がない
  useEffect(() => {
    const COMPRESS_ABOVE = 100;
    const EXPAND_BELOW = 50;
    const handleScroll = () => {
      const isMobile = window.innerWidth <= 768;
      if (isMobile) {
        setIsCompressed(false);
        return;
      }
      const currentScrollY = window.scrollY;
      setIsCompressed((compressed) =>
        compressed
          ? currentScrollY >= EXPAND_BELOW
          : currentScrollY > COMPRESS_ABOVE,
      );
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // ロゴクリック時の処理
  const handleLogoClick = () => {
    navigate(localize("/"));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // タブクリック時の処理（パスベースナビゲーション、言語プレフィックス維持）
  const handleTabClick = (tab) => {
    const path = tab === "races" ? "/" : `/${tab}`;
    navigate(localize(path));
  };

  return (
    <header className={`app-header ${isCompressed ? "compressed" : ""}`}>
      <div className="header-content" ref={menuRef}>
        <button
          className="logo"
          onClick={handleLogoClick}
          aria-label={t("nav.logoLabel")}
        >
          <img
            className="logo-mark"
            src="/logo-light.png"
            alt=""
            aria-hidden="true"
          />
          <span className="logo-text-group">
            <h1>{t("nav.logoText")}</h1>
            <span className="logo-tagline">{t("nav.logoTagline")}</span>
          </span>
        </button>
        <nav className="nav">
          <Link
            to={localize("/winning-technique")}
            className={`nav-btn nav-btn-primary ${activeTab === "winning-technique" ? "active" : ""}`}
          >
            <span className="nav-btn-label-full">
              {t("nav.winningTechnique")}
            </span>
            <span className="nav-btn-label-short">
              {t("nav.winningTechniqueShort")}
            </span>
          </Link>
          <button
            className={`nav-btn ${activeTab === "races" ? "active" : ""}`}
            onClick={() => handleTabClick("races")}
          >
            {t("nav.predictions")}
          </button>
          <button
            className={`nav-btn ${activeTab === "hit-races" ? "active" : ""}`}
            onClick={() => handleTabClick("hit-races")}
          >
            {t("nav.hits")}
          </button>
          {currentLng === "ja" && <RacerSearchBox />}
          <button
            className="nav-btn menu-btn"
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            aria-label={t("nav.menuLabel")}
            aria-expanded={isMenuOpen}
          >
            ☰
          </button>
        </nav>
        {/* サブメニュー - navの外に配置してoverflowの影響を受けないようにする */}
        {isMenuOpen && (
          <div className="menu-overlay" onClick={() => setIsMenuOpen(false)} />
        )}
        {isMenuOpen && (
          <div className="submenu">
            <div className="submenu-settings-row">
              <LanguageSwitcher />
              {THEME_SWITCHING_ENABLED && <ThemeToggle />}
            </div>
            <button
              className={`submenu-item submenu-item-button ${activeTab === "races" ? "active" : ""}`}
              onClick={() => {
                handleTabClick("races");
                setIsMenuOpen(false);
              }}
            >
              {t("nav.predictions")}
            </button>
            <Link
              to={localize("/winning-technique")}
              className={`submenu-item ${activeTab === "winning-technique" ? "active" : ""}`}
              onClick={() => setIsMenuOpen(false)}
            >
              {t("nav.winningTechnique")}
            </Link>
            {/* 本日のデータ一覧（/today）は ja専用のため、選手一覧と同じく ja でのみ出す */}
            {/* i18n-allow-start: ja のときだけ出すリンク（遷移先が ja専用ページ） */}
            {currentLng === "ja" && (
              <Link
                to="/today"
                className={`submenu-item ${activeTab === "today" ? "active" : ""}`}
                onClick={() => setIsMenuOpen(false)}
              >
                本日のデータ一覧
              </Link>
            )}
            {/* i18n-allow-end */}
            <button
              className={`submenu-item submenu-item-button ${activeTab === "hit-races" ? "active" : ""}`}
              onClick={() => {
                handleTabClick("hit-races");
                setIsMenuOpen(false);
              }}
            >
              {t("nav.hits")}
            </button>
            <Link
              to={localize("/accuracy")}
              className={`submenu-item ${activeTab === "accuracy" ? "active" : ""}`}
              onClick={() => setIsMenuOpen(false)}
            >
              {t("nav.accuracy")}
            </Link>
            <Link
              to={localize("/races")}
              className={`submenu-item ${activeTab === "past-races" ? "active" : ""}`}
              onClick={() => setIsMenuOpen(false)}
            >
              {t("nav.pastRaces")}
            </Link>
            {/* i18n-allow-start: ja のときだけ出すリンク（遷移先が ja専用ページ） */}
            {currentLng === "ja" && (
              <Link
                to="/racers"
                className={`submenu-item ${activeTab === "racers" ? "active" : ""}`}
                onClick={() => setIsMenuOpen(false)}
              >
                選手一覧
              </Link>
            )}
            {/* i18n-allow-end */}
            <Link
              to={localize("/how-to-use")}
              className={`submenu-item ${activeTab === "how-to-use" ? "active" : ""}`}
              onClick={() => setIsMenuOpen(false)}
            >
              {t("nav.howToUse")}
            </Link>
            <Link
              to={localize("/guide")}
              className={`submenu-item ${activeTab === "guide" ? "active" : ""}`}
              onClick={() => setIsMenuOpen(false)}
            >
              {t("nav.guide")}
            </Link>
            {showVenues && (
              <Link
                to={localize("/venues")}
                className={`submenu-item ${activeTab === "venues" ? "active" : ""}`}
                onClick={() => setIsMenuOpen(false)}
              >
                {t("nav.venues")}
              </Link>
            )}
            <Link
              to={localize("/blog")}
              className={`submenu-item ${activeTab === "blog" ? "active" : ""}`}
              onClick={() => setIsMenuOpen(false)}
            >
              {t("nav.blog")}
            </Link>
            <Link
              to={localize("/faq")}
              className={`submenu-item ${activeTab === "faq" ? "active" : ""}`}
              onClick={() => setIsMenuOpen(false)}
            >
              {t("nav.faq")}
            </Link>
            <Link
              to={localize("/about")}
              className={`submenu-item ${activeTab === "about" ? "active" : ""}`}
              onClick={() => setIsMenuOpen(false)}
            >
              {t("nav.about")}
            </Link>
            <Link
              to={localize("/profile")}
              className={`submenu-item ${activeTab === "profile" ? "active" : ""}`}
              onClick={() => setIsMenuOpen(false)}
            >
              {t("nav.profile")}
            </Link>
          </div>
        )}
      </div>
    </header>
  );
}

export default Header;
