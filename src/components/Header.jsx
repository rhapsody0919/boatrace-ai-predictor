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

// パス（言語プレフィックス除去後）が完全一致でタブ名になるもの（タブ名はパスの先頭の / を除いた形）
const EXACT_TABS = new Set([
  "hit-races",
  "accuracy",
  "winning-technique",
  "today",
  "picks",
  "racers",
  "how-to-use",
  "guide",
  "faq",
  "about",
  "profile",
]);

// 前方一致でタブ名になるもの
const PREFIX_TABS = [
  ["/races", "past-races"],
  ["/venues", "venues"],
  ["/blog", "blog"],
];

// 現在のページ/タブを判定（言語プレフィックスを除いて比較）
const getActiveTab = (location) => {
  const { basePath: pathname } = parseLangFromPath(location.pathname);
  if (pathname === "/") {
    // ホームページの場合はハッシュを確認
    const hash = location.hash.slice(1);
    return hash || "races";
  }
  // その他のページ
  if (EXACT_TABS.has(pathname.slice(1)) && pathname.startsWith("/")) {
    return pathname.slice(1);
  }
  const prefixed = PREFIX_TABS.find(([prefix]) => pathname.startsWith(prefix));
  return prefixed ? prefixed[1] : "races";
};

// メニュー外クリック検出
const useClickOutside = (menuRef, isMenuOpen, setIsMenuOpen) => {
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
    // menuRef と setIsMenuOpen は描画をまたいで同じ物なので、旧の [isMenuOpen] と同じ回数で動く
  }, [isMenuOpen, menuRef, setIsMenuOpen]);
};

// スクロール検出：デスクトップのみ圧縮
// 圧縮と復帰の閾値を分ける（BOA-459）。ヘッダーは sticky で文書の流れの中にあり、
// 圧縮で約22px縮むと、ブラウザのスクロールアンカーがその分 scrollY を戻す。
// 閾値が1つ（100px）だと、101〜122pxに止めた瞬間に
// 「圧縮→scrollYが100未満に戻る→復帰→scrollYが100超に戻る→圧縮」が毎フレーム続き、
// ヘッダーと下の内容が揺れ続けていた（E2Eでは要素が stable にならずクリックできない）。
// 2つの閾値の差を縮む量より大きく取れば、どちらの状態でも反対側の閾値を跨がない
const useScrollCompress = (setIsCompressed) => {
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
    // setIsCompressed は描画をまたいで同じ物なので、旧の [] と同じく1回だけ登録する
  }, [setIsCompressed]);
};

// サブメニューのボタン項目（クリックでタブ遷移してメニューを閉じる）
function SubmenuButton({ tab, activeTab, onTab, onClose, children }) {
  return (
    <button
      className={`submenu-item submenu-item-button ${activeTab === tab ? "active" : ""}`}
      onClick={() => {
        onTab(tab);
        onClose();
      }}
    >
      {children}
    </button>
  );
}

// サブメニューのリンク項目
function SubmenuLink({ to, tab, activeTab, onClose, children }) {
  return (
    <Link
      to={to}
      className={`submenu-item ${activeTab === tab ? "active" : ""}`}
      onClick={onClose}
    >
      {children}
    </Link>
  );
}

// サブメニュー本体
function Submenu({ activeTab, currentLng, showVenues, onTab, onClose }) {
  const { t } = useTranslation();
  const localize = useLocalizedPath();
  const link = { activeTab, onClose };
  return (
    <div className="submenu">
      <div className="submenu-settings-row">
        <LanguageSwitcher />
        {THEME_SWITCHING_ENABLED && <ThemeToggle />}
      </div>
      <SubmenuButton
        tab="races"
        activeTab={activeTab}
        onTab={onTab}
        onClose={onClose}
      >
        {t("nav.predictions")}
      </SubmenuButton>
      <SubmenuLink
        to={localize("/winning-technique")}
        tab="winning-technique"
        {...link}
      >
        {t("nav.winningTechnique")}
      </SubmenuLink>
      {/* 本日のデータ一覧（/today）は ja専用のため、選手一覧と同じく ja でのみ出す */}
      {/* i18n-allow-start: ja のときだけ出すリンク（遷移先が ja専用ページ） */}
      {currentLng === "ja" && (
        <SubmenuLink to="/today" tab="today" {...link}>
          本日のデータ一覧
        </SubmenuLink>
      )}
      {/* i18n-allow-end */}
      <SubmenuButton
        tab="hit-races"
        activeTab={activeTab}
        onTab={onTab}
        onClose={onClose}
      >
        {t("nav.hits")}
      </SubmenuButton>
      <SubmenuLink to={localize("/accuracy")} tab="accuracy" {...link}>
        {t("nav.accuracy")}
      </SubmenuLink>
      <SubmenuLink to={localize("/races")} tab="past-races" {...link}>
        {t("nav.pastRaces")}
      </SubmenuLink>
      {/* i18n-allow-start: ja のときだけ出すリンク（遷移先が ja専用ページ） */}
      {currentLng === "ja" && (
        <SubmenuLink to="/racers" tab="racers" {...link}>
          選手一覧
        </SubmenuLink>
      )}
      {/* i18n-allow-end */}
      <SubmenuLink to={localize("/how-to-use")} tab="how-to-use" {...link}>
        {t("nav.howToUse")}
      </SubmenuLink>
      <SubmenuLink to={localize("/guide")} tab="guide" {...link}>
        {t("nav.guide")}
      </SubmenuLink>
      {showVenues && (
        <SubmenuLink to={localize("/venues")} tab="venues" {...link}>
          {t("nav.venues")}
        </SubmenuLink>
      )}
      <SubmenuLink to={localize("/blog")} tab="blog" {...link}>
        {t("nav.blog")}
      </SubmenuLink>
      <SubmenuLink to={localize("/faq")} tab="faq" {...link}>
        {t("nav.faq")}
      </SubmenuLink>
      <SubmenuLink to={localize("/about")} tab="about" {...link}>
        {t("nav.about")}
      </SubmenuLink>
      <SubmenuLink to={localize("/profile")} tab="profile" {...link}>
        {t("nav.profile")}
      </SubmenuLink>
    </div>
  );
}

// ヘッダー上部のナビ
function HeaderNav({
  activeTab,
  currentLng,
  isMenuOpen,
  setIsMenuOpen,
  onTab,
}) {
  const { t } = useTranslation();
  const localize = useLocalizedPath();
  return (
    <nav className="nav">
      <Link
        to={localize("/winning-technique")}
        className={`nav-btn nav-btn-primary ${activeTab === "winning-technique" ? "active" : ""}`}
      >
        <span className="nav-btn-label-full">{t("nav.winningTechnique")}</span>
        <span className="nav-btn-label-short">
          {t("nav.winningTechniqueShort")}
        </span>
      </Link>
      <button
        className={`nav-btn ${activeTab === "races" ? "active" : ""}`}
        onClick={() => onTab("races")}
      >
        {t("nav.predictions")}
      </button>
      <button
        className={`nav-btn ${activeTab === "hit-races" ? "active" : ""}`}
        onClick={() => onTab("hit-races")}
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
  );
}

function Header() {
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const localize = useLocalizedPath();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isCompressed, setIsCompressed] = useState(false);
  const menuRef = useRef(null);

  const activeTab = getActiveTab(location);

  // 会場別ビジターガイドは対応言語（config の LANGUAGE_ONLY_PATHS）のみメニューに表示する
  const { lng: currentLng } = parseLangFromPath(location.pathname);
  const showVenues = getAvailableLanguages("/venues").some(
    (l) => l.code === currentLng,
  );

  useClickOutside(menuRef, isMenuOpen, setIsMenuOpen);
  useScrollCompress(setIsCompressed);

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
        <HeaderNav
          activeTab={activeTab}
          currentLng={currentLng}
          isMenuOpen={isMenuOpen}
          setIsMenuOpen={setIsMenuOpen}
          onTab={handleTabClick}
        />
        {/* サブメニュー - navの外に配置してoverflowの影響を受けないようにする */}
        {isMenuOpen && (
          <div className="menu-overlay" onClick={() => setIsMenuOpen(false)} />
        )}
        {isMenuOpen && (
          <Submenu
            activeTab={activeTab}
            currentLng={currentLng}
            showVenues={showVenues}
            onTab={handleTabClick}
            onClose={() => setIsMenuOpen(false)}
          />
        )}
      </div>
    </header>
  );
}

export default Header;
