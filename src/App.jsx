import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import "./App.css";
import Header from "./components/Header";
import Footer from "./components/Footer";
import { getSiteFooterLinks } from "./components/siteFooterLinks";
import AccuracyDashboard from "./components/AccuracyDashboard";
import PrivacyPolicy from "./components/PrivacyPolicy";
import Terms from "./components/Terms";
import Contact from "./components/Contact";
import HitRaces from "./components/HitRaces";
import { getLatestPosts } from "./data/blogPosts";
import { dataService } from "./services/dataService";
import { formatDateLongLocalized } from "./utils/formatters";

// タブページ（/hit-races・/accuracy・/privacy・/terms・/contact）のシェル。
// トップ（/）の開催場一覧はVenueGridPage、レース詳細は/race/:raceIdに分離済み
// （docs/design/venue-list-redesign/参照）
function App({ tab }) {
  const { t, i18n } = useTranslation();
  const [activeTab, setActiveTab] = useState(tab);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // propsのtabが変わったらactiveTabを更新
  useEffect(() => {
    setActiveTab(tab);
  }, [tab]);

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
        links={getSiteFooterLinks(t)}
        extra={
          <>
            <p>{t("home.disclaimer")}</p>
            <p className="site-footer-updated">
              {(() => {
                const latestPost = getLatestPosts(1, i18n.resolvedLanguage)[0];
                return latestPost
                  ? t("home.blogLastUpdated", {
                      date: formatDateLongLocalized(
                        latestPost.date,
                        i18n.resolvedLanguage,
                      ),
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
