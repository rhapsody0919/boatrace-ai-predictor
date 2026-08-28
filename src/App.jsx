import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import "./App.css";
import Header from "./components/Header";
import Footer from "./components/Footer";
import AccuracyDashboard from "./components/AccuracyDashboard";
import PrivacyPolicy from "./components/PrivacyPolicy";
import Terms from "./components/Terms";
import Contact from "./components/Contact";
import HitRaces from "./components/HitRaces";
import { getLatestPosts } from "./data/blogPosts";
import { dataService } from "./services/dataService";
import { formatDateJP } from "./utils/dateUtils";

// タブページ（/hit-races・/accuracy・/privacy・/terms・/contact）のシェル。
// トップ（/）の開催場一覧はVenueGridPage、レース詳細は/race/:raceIdに分離済み
// （docs/design/venue-list-redesign/参照）
function App({ tab }) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState(tab);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // propsのtabが変わったらactiveTabを更新
  useEffect(() => {
    setActiveTab(tab);
  }, [tab]);

  // Google Analytics初期化
  useEffect(() => {
    const gaId = import.meta.env.VITE_GA_MEASUREMENT_ID;

    if (gaId && gaId !== "%VITE_GA_MEASUREMENT_ID%") {
      const script1 = document.createElement("script");
      script1.async = true;
      script1.src = `https://www.googletagmanager.com/gtag/js?id=${gaId}`;
      document.head.appendChild(script1);

      window.dataLayer = window.dataLayer || [];
      function gtag() {
        window.dataLayer.push(arguments);
      }
      gtag("js", new Date());
      gtag("config", gaId, {
        page_path: window.location.pathname,
      });

      window.gtag = gtag;

      console.log("Google Analytics initialized:", gaId);
    }
  }, []);

  // ページビュー追跡（タブ切り替え時）
  useEffect(() => {
    if (window.gtag) {
      window.gtag("event", "page_view", {
        page_title: activeTab,
        page_location: window.location.href,
        page_path: window.location.pathname,
      });
    }
  }, [activeTab]);

  // リトライ機能付きfetch関数（HitRacesが使用）
  const fetchWithRetry = async (url, maxRetries = 3, retryDelay = 2000) => {
    let lastError;

    for (let i = 0; i < maxRetries; i++) {
      try {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        return response;
      } catch (error) {
        lastError = error;
        console.warn(`取得失敗 (${i + 1}/${maxRetries}):`, error.message);

        if (i < maxRetries - 1) {
          await new Promise((resolve) => setTimeout(resolve, retryDelay));
        }
      }
    }

    throw lastError;
  };

  // データ更新時刻の取得（HitRacesのUpdateStatus表示用）
  useEffect(() => {
    if (activeTab !== "hit-races") return;
    dataService.getRaces().then((result) => {
      if (result?.scrapedAt) setLastUpdated(result.scrapedAt);
    });
  }, [activeTab]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      dataService.clearCache();
      const result = await dataService.getRaces();
      if (result?.scrapedAt) setLastUpdated(result.scrapedAt);
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <div className="app">
      <Header />

      <div className="container">
        <main className="main-content">
          {activeTab === "privacy" ? (
            <PrivacyPolicy />
          ) : activeTab === "terms" ? (
            <Terms />
          ) : activeTab === "contact" ? (
            <Contact />
          ) : activeTab === "accuracy" ? (
            <AccuracyDashboard
              onRefresh={handleRefresh}
              isRefreshing={isRefreshing}
            />
          ) : activeTab === "hit-races" ? (
            <HitRaces
              fetchWithRetry={fetchWithRetry}
              lastUpdated={lastUpdated}
              onRefresh={handleRefresh}
              isRefreshing={isRefreshing}
            />
          ) : null}
        </main>
      </div>

      <Footer
        links={[
          { to: "/blog", label: t("footer.blog") },
          { to: "/about", label: "About" },
          { to: "/profile", label: t("footer.operator") },
          { to: "/faq", label: "FAQ" },
          { to: "/privacy", label: t("footer.privacy") },
          { to: "/terms", label: t("footer.terms") },
          { to: "/contact", label: t("footer.contact") },
          {
            to: "/responsible-gambling",
            label: t("footer.responsibleGambling"),
          },
        ]}
        extra={
          <>
            <p>{t("home.disclaimer")}</p>
            <p className="site-footer-updated">
              {(() => {
                const latestPost = getLatestPosts(1)[0];
                return latestPost
                  ? t("home.blogLastUpdated", {
                      date: formatDateJP(latestPost.date),
                    })
                  : "";
              })()}
            </p>
          </>
        }
      />
    </div>
  );
}

export default App;
