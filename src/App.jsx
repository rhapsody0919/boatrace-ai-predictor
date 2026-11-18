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
import { clearCache } from "./services/core.js";
import { getRaces } from "./services/scheduleQueries.js";
import { fetchWithRetry, renderFooterExtra } from "./AppParts.jsx";

// タブ・データ更新時刻・再読込の状態
function useAppTabState(tab) {
  const [activeTab, setActiveTab] = useState(tab);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // propsのtabが変わったらactiveTabを更新
  useEffect(() => {
    setActiveTab(tab);
  }, [tab]);

  // データ更新時刻の取得（HitRacesのUpdateStatus表示用）
  useEffect(() => {
    if (activeTab !== "hit-races") return;
    getRaces().then((result) => {
      if (result?.scrapedAt) setLastUpdated(result.scrapedAt);
    });
  }, [activeTab]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      clearCache();
      const result = await getRaces();
      if (result?.scrapedAt) setLastUpdated(result.scrapedAt);
    } finally {
      setIsRefreshing(false);
    }
  };

  return { activeTab, lastUpdated, isRefreshing, handleRefresh };
}

function renderTabContent(
  activeTab,
  { lastUpdated, isRefreshing, handleRefresh },
) {
  switch (activeTab) {
    case "privacy":
      return <PrivacyPolicy />;
    case "terms":
      return <Terms />;
    case "contact":
      return <Contact />;
    case "accuracy":
      return (
        <AccuracyDashboard
          onRefresh={handleRefresh}
          isRefreshing={isRefreshing}
        />
      );
    case "hit-races":
      return (
        <HitRaces
          fetchWithRetry={fetchWithRetry}
          lastUpdated={lastUpdated}
          onRefresh={handleRefresh}
          isRefreshing={isRefreshing}
        />
      );
    default:
      return null;
  }
}

// タブページ（/hit-races・/accuracy・/privacy・/terms・/contact）のシェル。
// トップ（/）の開催場一覧はVenueGridPage、レース詳細は/race/:raceIdに分離済み
// （docs/design/venue-list-redesign/参照）
function App({ tab }) {
  const { t, i18n } = useTranslation();
  const state = useAppTabState(tab);

  return (
    <div className="app">
      <Header />

      <div className="container">
        <main className="main-content">
          {renderTabContent(state.activeTab, state)}
        </main>
      </div>

      <Footer
        links={getSiteFooterLinks(t)}
        extra={renderFooterExtra(t, i18n)}
      />
    </div>
  );
}

export default App;
