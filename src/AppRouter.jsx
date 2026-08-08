import {
  Routes,
  Route,
  Navigate,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  SUPPORTED_LANGUAGES,
  DEFAULT_LANGUAGE,
  LANGUAGE_STORAGE_KEY,
  getAvailableLanguages,
  isPathTranslated,
} from "./config/languages";
import { refreshAdsOnRouteChange, trackPageView } from "./utils/analytics";
import App from "./App";
import Blog from "./pages/Blog";
import BlogPost from "./pages/BlogPost";
import About from "./pages/About";
import FAQ from "./pages/FAQ";
import HowToUse from "./pages/HowToUse";
import RaceHistory from "./pages/RaceHistory";
import RaceDetail from "./pages/RaceDetail";
import Profile from "./pages/Profile";
import AccuracyHistory from "./pages/AccuracyHistory";
import WinningTechniqueAnalysis from "./pages/WinningTechniqueAnalysis";
import Holmes from "./pages/Holmes";
import ContentHub from "./pages/ContentHub";
import EnglishGuide from "./pages/EnglishGuide";
import ZhTwGuide from "./pages/ZhTwGuide";
import KoGuide from "./pages/KoGuide";
import EnglishVenueGuide, {
  EnglishVenueGuides,
  EnglishVenueRegionHub,
} from "./pages/EnglishVenueGuide";
import ZhTwVenueGuide, { ZhTwVenueGuides } from "./pages/ZhTwVenueGuide";
import AdminRules from "./pages/admin/AdminRules";
import ResponsibleGambling from "./pages/ResponsibleGambling";
import Poirot from "./pages/Poirot";
import CookieConsent from "./components/CookieConsent";
import HreflangTags from "./components/HreflangTags";

// 旧ハッシュURLからのリダイレクトを処理するコンポーネント
function HashRedirect() {
  const location = useLocation();

  useEffect(() => {
    // ハッシュがある場合、対応するパスにリダイレクト
    if (location.hash) {
      const hash = location.hash.slice(1); // '#' を除去
      const validPaths = [
        "races",
        "hit-races",
        "accuracy",
        "picks",
        "privacy",
        "terms",
        "contact",
      ];
      if (validPaths.includes(hash)) {
        // ハッシュを削除してパスに変換
        const newPath = hash === "races" ? "/" : `/${hash}`;
        window.history.replaceState(null, "", newPath);
        window.location.reload();
      }
    }
  }, [location]);

  return null;
}

// 旧 /outcome-distribution はデータ分析ツールの1タブに統合済み（BOA-152）
// venue_code は維持しつつ tab=outcome を付与してリダイレクトする
function OutcomeDistributionRedirect() {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  params.set("tab", "outcome");
  return <Navigate to={`/winning-technique?${params.toString()}`} replace />;
}

// ルート変更時にAuto Adsを再スキャン
function AdRefresh() {
  const location = useLocation();

  useEffect(() => {
    refreshAdsOnRouteChange();
  }, [location.pathname]);

  return null;
}

// SPA のルート変更を GA4 のページビューとして送信
// （初期ロードは initGA の config が送信するため、パス変更時のみ）
function PageViewTracker() {
  const { pathname, search } = useLocation();
  const isFirst = useRef(true);

  useEffect(() => {
    if (isFirst.current) {
      isFirst.current = false;
      return;
    }
    trackPageView(`${pathname}${search}`);
  }, [pathname, search]);

  return null;
}

// 言語別の入門ガイド（日本語はコンテンツハブを表示）
const GUIDE_BY_LANG = {
  en: EnglishGuide,
  "zh-TW": ZhTwGuide,
  ko: KoGuide,
};

// 言語別の会場別ビジターガイド（対応言語は config の LANGUAGE_ONLY_PATHS と合わせて管理する）
// RegionHub は地域ハブページ（現状 en のみ対応、LANGUAGE_ONLY_PATHS["/venues/region"]）
const VENUE_GUIDE_BY_LANG = {
  en: {
    List: EnglishVenueGuides,
    Detail: EnglishVenueGuide,
    RegionHub: EnglishVenueRegionHub,
  },
  "zh-TW": { List: ZhTwVenueGuides, Detail: ZhTwVenueGuide },
};

// 言語別に共通のルート定義（言語プレフィックス配下でも相対パスで再利用）
function LocalizedRoutes({ lng = "ja" }) {
  const Guide = GUIDE_BY_LANG[lng] ?? ContentHub;
  const VenueGuide = VENUE_GUIDE_BY_LANG[lng];
  return (
    <Routes>
      {/* Main App - 予想ページ（トップ） */}
      <Route path="/" element={<App tab="races" />} />

      {/* タブページ（SEO対応: 個別URL） */}
      <Route path="hit-races" element={<App tab="hit-races" />} />
      <Route path="accuracy" element={<App tab="accuracy" />} />
      <Route path="picks" element={<App tab="picks" />} />
      <Route path="accuracy/history" element={<AccuracyHistory />} />
      <Route
        path="outcome-distribution"
        element={<OutcomeDistributionRedirect />}
      />
      <Route path="winning-technique" element={<WinningTechniqueAnalysis />} />
      <Route path="privacy" element={<App tab="privacy" />} />
      <Route path="terms" element={<App tab="terms" />} />
      <Route path="contact" element={<App tab="contact" />} />

      {/* Race History Routes */}
      <Route path="races" element={<RaceHistory />} />
      <Route path="races/:date" element={<RaceDetail />} />

      {/* Blog Routes */}
      <Route path="blog" element={<Blog />} />
      <Route path="blog/:id" element={<BlogPost />} />

      {/* Other Pages */}
      <Route path="about" element={<About />} />
      <Route path="faq" element={<FAQ />} />
      <Route path="how-to-use" element={<HowToUse />} />
      <Route path="profile" element={<Profile />} />
      {/* 言語別: 初心者向け入門ガイド（対応言語は GUIDE_BY_LANG）、日本語はコンテンツハブ */}
      <Route path="guide" element={<Guide />} />

      {/* 言語専用: 会場別ビジターガイド（インバウンド観光クエリ向け。対応言語は config の LANGUAGE_ONLY_PATHS） */}
      {getAvailableLanguages("/venues").some((l) => l.code === lng) &&
        VenueGuide && (
          <>
            <Route path="venues" element={<VenueGuide.List />} />
            <Route path="venues/:slug" element={<VenueGuide.Detail />} />
          </>
        )}
      {/* 言語専用: 地域別ビジターガイドハブ（対応言語は config の LANGUAGE_ONLY_PATHS） */}
      {getAvailableLanguages("/venues/region").some((l) => l.code === lng) &&
        VenueGuide?.RegionHub && (
          <Route
            path="venues/region/:regionSlug"
            element={<VenueGuide.RegionHub />}
          />
        )}
      <Route path="responsible-gambling" element={<ResponsibleGambling />} />

      {/* Admin Pages (Hidden) */}
      <Route path="admin/rules" element={<AdminRules />} />

      {/* α版・動線非公開ページ */}
      <Route path="holmes" element={<Holmes />} />
      <Route path="poirot" element={<Poirot />} />

      {/* Fallback: 不明なパスはトップへ */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

// URL プレフィックスと i18n の言語状態を同期（URL が唯一の情報源）
function LanguageSync({ lng }) {
  const { i18n } = useTranslation();

  useEffect(() => {
    if (i18n.resolvedLanguage !== lng) {
      i18n.changeLanguage(lng);
    }
  }, [i18n, lng]);

  return null;
}

// 初回ロード時のみ: 言語設定がデフォルト言語以外のユーザーがトップ（/）に来たら /{lng}/ へ誘導
// - トップページ限定: 深いURL（/guide 等）への直アクセスは URL をそのまま尊重する
// - セッション中は再実行しない = LanguageSwitcher でのデフォルト言語切替と競合しない
let initialRedirectDone = false;

function InitialLanguageRedirect() {
  const navigate = useNavigate();
  const { pathname, search } = useLocation();

  useEffect(() => {
    if (initialRedirectDone) return;
    initialRedirectDone = true;

    if (pathname !== "/") return;
    const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (
      stored &&
      stored !== DEFAULT_LANGUAGE &&
      SUPPORTED_LANGUAGES.some((l) => l.code === stored)
    ) {
      navigate(`/${stored}/${search}`, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 初回マウント時のみ実行
  }, []);

  return null;
}

// 言語別レイアウト: URL プレフィックスに応じた言語へ同期。
// コンテンツ未翻訳のパスへの /{lng}/ アクセスは ja 版へリダイレクトする
// （lang=en を宣言しながら日本語を配信するとブラウザ自動翻訳が発動せず、
// 検索エンジンにも矛盾シグナルを送るため。TRANSLATED_PATHS 参照）
function LocalizedLayout({ lng }) {
  const { pathname, search } = useLocation();

  if (lng !== DEFAULT_LANGUAGE) {
    const basePath = pathname.slice(lng.length + 1) || "/";
    if (!isPathTranslated(basePath)) {
      return <Navigate to={`${basePath}${search}`} replace />;
    }
  }

  return (
    <>
      <LanguageSync lng={lng} />
      <LocalizedRoutes lng={lng} />
    </>
  );
}

export default function AppRouter() {
  return (
    <>
      <HashRedirect />
      <AdRefresh />
      <PageViewTracker />
      <CookieConsent />
      <HreflangTags />
      <InitialLanguageRedirect />
      <Routes>
        {SUPPORTED_LANGUAGES.filter(
          ({ code }) => code !== DEFAULT_LANGUAGE,
        ).map(({ code }) => (
          <Route
            key={code}
            path={`/${code}/*`}
            element={<LocalizedLayout lng={code} />}
          />
        ))}
        <Route path="/*" element={<LocalizedLayout lng={DEFAULT_LANGUAGE} />} />
      </Routes>
    </>
  );
}
