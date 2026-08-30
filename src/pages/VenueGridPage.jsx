/**
 * VenueGridPage - 開催場一覧ページ
 * 本日（`/`）と過去日付（`/races/:date`）の両方で使う。
 * 24会場を固定グリッドで表示し、各会場カードから会場別レース一覧へ遷移する。
 */
import { useState, useEffect, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import Header from "../components/Header";
import Footer from "../components/Footer";
import Breadcrumb from "../components/Breadcrumb";
import UpdateStatus from "../components/UpdateStatus";
import IntroBanner from "../components/IntroBanner";
import LoadingScreen from "../components/LoadingScreen";
import { VenueGrid } from "../components/race";
import { dataService } from "../services/dataService";
import { useDatePredictions } from "../hooks/useDatePredictions";
import { useLocalizedPath } from "../hooks/useLocalizedPath";
import { useNowHHMM } from "../hooks/useNowHHMM";
import { getLanguage, localizePath } from "../config/languages";
import { getFeaturedPosts, getLatestPosts } from "../data/blogPosts";
import { WEEKDAYS } from "../constants";
import { formatDate } from "../utils/formatters";
import { formatDateJP } from "../utils/dateUtils";
import "./VenueGridPage.css";
// 過去日付ビューのレイアウト（.race-detail-page/.page-header/.back-link等）は
// 旧RaceDetail.jsxのスタイルを流用する
import "./RaceDetail.css";

function getTodayDateShort() {
  const today = new Date();
  return `${today.getMonth() + 1}/${today.getDate()}(${WEEKDAYS[today.getDay()]})`;
}

// getPredictions系レスポンス（フラットなraces配列）を会場別にグループ化する
function groupRacesByVenue(races) {
  const venueMap = new Map();
  for (const race of races || []) {
    if (!venueMap.has(race.venueCode)) {
      venueMap.set(race.venueCode, {
        placeCd: race.venueCode,
        placeName: race.venue,
        races: [],
      });
    }
    venueMap.get(race.venueCode).races.push({
      raceNo: race.raceNumber,
      startTime: race.startTime,
      raceGrade: race.raceGrade,
      raceTitle: race.raceTitle ?? null,
    });
  }
  const venues = [...venueMap.values()];
  venues.forEach((v) => v.races.sort((a, b) => a.raceNo - b.raceNo));
  return venues.sort((a, b) => a.placeCd - b.placeCd);
}

// 本日用: dataService.getRaces() で会場別データを取得
function useTodayVenues() {
  const [venuesData, setVenuesData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await dataService.getRaces();
      if (!result.success || !result.data) {
        throw new Error("有効なデータが取得できませんでした");
      }
      setVenuesData(result.data);
      if (result.scrapedAt) setLastUpdated(result.scrapedAt);
    } catch (err) {
      console.error("API取得エラー:", err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      dataService.clearCache();
      await fetchData();
    } finally {
      setIsRefreshing(false);
    }
  }, [fetchData]);

  return {
    venuesData,
    loading,
    error,
    lastUpdated,
    isRefreshing,
    handleRefresh,
  };
}

// 過去日付用: getPredictionsを会場別にグループ化
function usePastVenues(date) {
  const { races, loading, error } = useDatePredictions(date);
  return { venuesData: groupRacesByVenue(races), loading, error };
}

function TodayVenueGridPage() {
  const { t, i18n } = useTranslation();
  const localize = useLocalizedPath();
  const nowHHMM = useNowHHMM(true);
  const {
    venuesData,
    loading,
    error,
    lastUpdated,
    isRefreshing,
    handleRefresh,
  } = useTodayVenues();

  return (
    <div className="app">
      <title>{t("meta.title")}</title>
      <meta name="description" content={t("meta.description")} />
      <meta
        property="og:locale"
        content={getLanguage(i18n.resolvedLanguage).ogLocale}
      />
      <link
        rel="canonical"
        href={`https://www.boat-ai.jp${localizePath("/", i18n.resolvedLanguage)}`}
      />
      <Header />

      <div className="container">
        <main className="main-content">
          <section className="race-list-section">
            <h2>
              🏁 {t("home.todayRaces")} {getTodayDateShort()}
            </h2>
            <UpdateStatus
              lastUpdated={lastUpdated}
              dataType={t("home.dataType")}
              onRefresh={handleRefresh}
              isRefreshing={isRefreshing}
            />
            <IntroBanner />

            {loading ? (
              <LoadingScreen
                title={t("home.loadingTitle")}
                description={t("home.loadingDesc")}
              />
            ) : (
              <>
                {error && (
                  <div className="venue-grid-page__error">
                    <p className="venue-grid-page__error-title">
                      ⚠️ {t("home.fetchErrorTitle")}
                    </p>
                    <p>{error}</p>
                    <p>{t("home.fetchErrorDesc")}</p>
                    <button
                      onClick={() => window.location.reload()}
                      className="venue-grid-page__error-reload"
                    >
                      {t("home.reload")}
                    </button>
                  </div>
                )}
                <VenueGrid
                  venuesData={venuesData}
                  getVenueLink={(code) => localize(`/venue/${code}`)}
                  nowHHMM={nowHHMM}
                />
              </>
            )}
          </section>

          {/* ブログ記事セクション */}
          <section className="blog-preview-section">
            <h2>📝 {t("home.blogTitle")}</h2>
            <p className="blog-preview-lead">{t("home.blogDesc")}</p>
            <div className="blog-preview-grid">
              {getFeaturedPosts()
                .slice(0, 5)
                .map((post) => (
                  <Link
                    to={localize(`/blog/${post.id}`)}
                    key={post.id}
                    className="blog-preview-card"
                  >
                    <span className="blog-preview-category">
                      {post.category}
                    </span>
                    <h3 className="blog-preview-title">{post.title}</h3>
                    <p className="blog-preview-desc">{post.description}</p>
                    <div className="blog-preview-meta">
                      <span>{post.readTime}</span>
                    </div>
                  </Link>
                ))}
            </div>
            <div className="blog-preview-cta">
              <Link to={localize("/blog")} className="blog-preview-btn">
                {t("home.viewAllPosts")}
              </Link>
            </div>
          </section>
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

function PastVenueGridPage({ date }) {
  const { venuesData, loading, error } = usePastVenues(date);

  const breadcrumbItems = [
    { name: "ホーム", url: "/" },
    { name: "過去の予想", url: "/races" },
    { name: formatDate(date), url: `/races/${date}` },
  ];

  return (
    <>
      <title>{`${formatDate(date)}のAI予想データ - 龍神レーダー`}</title>
      <meta
        name="description"
        content={`${formatDate(date)}のボートレースAI予想データと的中実績。各レース場の予想結果を確認できます。`}
      />
      <link rel="canonical" href={`https://www.boat-ai.jp/races/${date}`} />
      <Header />

      <div className="race-detail-page">
        <Breadcrumb items={breadcrumbItems} />
        <div className="race-detail-container">
          <header className="page-header">
            <h1>📅 {formatDate(date)}</h1>
            <Link to="/races" className="back-link">
              ← 日付一覧に戻る
            </Link>
          </header>

          {loading ? (
            <div className="loading-container">
              <div className="spinner"></div>
              <p>データを読み込み中...</p>
            </div>
          ) : error ? (
            <div className="error-container">
              <h3>エラー</h3>
              <p>{error === "no-data" ? "データが見つかりません" : error}</p>
              <Link to="/races" className="btn-primary">
                日付一覧に戻る
              </Link>
            </div>
          ) : (
            <VenueGrid
              venuesData={venuesData}
              getVenueLink={(code) => `/races/${date}/${code}`}
              nowHHMM={null}
            />
          )}
        </div>
      </div>
    </>
  );
}

function VenueGridPage() {
  const { date } = useParams();
  if (date) {
    return <PastVenueGridPage date={date} />;
  }
  return <TodayVenueGridPage />;
}

export default VenueGridPage;
