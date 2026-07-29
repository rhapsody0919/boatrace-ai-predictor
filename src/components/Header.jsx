import { useState, useEffect, useRef } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useLocalizedPath } from "../hooks/useLocalizedPath";
import { parseLangFromPath, getAvailableLanguages } from "../config/languages";
import LanguageSwitcher from "./LanguageSwitcher";
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
    if (pathname === "/outcome-distribution") return "outcome-distribution";
    if (pathname === "/winning-technique") return "winning-technique";
    if (pathname === "/picks") return "picks";
    if (pathname.startsWith("/races")) return "past-races";
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
  useEffect(() => {
    const handleScroll = () => {
      const isMobile = window.innerWidth <= 768;
      if (isMobile) {
        setIsCompressed(false);
        return;
      }
      const currentScrollY = window.scrollY;
      setIsCompressed(currentScrollY > 100); // 100px以上スクロールで圧縮
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
          <span className="logo-icon">🚤</span>
          <h1>BoatAI</h1>
        </button>
        <nav className="nav">
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
          <LanguageSwitcher />
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
            <button
              className={`submenu-item submenu-item-button ${activeTab === "races" ? "active" : ""}`}
              onClick={() => {
                handleTabClick("races");
                setIsMenuOpen(false);
              }}
            >
              {t("nav.predictions")}
            </button>
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
              to={localize("/outcome-distribution")}
              className={`submenu-item ${activeTab === "outcome-distribution" ? "active" : ""}`}
              onClick={() => setIsMenuOpen(false)}
            >
              {t("nav.outcomeDistribution")}
            </Link>
            <Link
              to={localize("/winning-technique")}
              className={`submenu-item ${activeTab === "winning-technique" ? "active" : ""}`}
              onClick={() => setIsMenuOpen(false)}
            >
              {t("nav.winningTechnique")}
            </Link>
            <Link
              to={localize("/races")}
              className={`submenu-item ${activeTab === "past-races" ? "active" : ""}`}
              onClick={() => setIsMenuOpen(false)}
            >
              {t("nav.pastRaces")}
            </Link>
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
