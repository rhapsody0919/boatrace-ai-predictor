import { Link } from "react-router-dom";
import Footer from "../components/Footer";
import UpdateStatus from "../components/UpdateStatus";
import IntroBanner from "../components/IntroBanner";
import FavoriteRunsSection from "../components/favorites/FavoriteRunsSection";
import FirstVisitGuideCard from "../components/FirstVisitGuideCard";
import UpcomingDeadlineRaces from "../components/UpcomingDeadlineRaces";
import {
  VenueGrid,
  VenueGridSkeleton,
  TodaysVolatilityHighlights,
  SgNowBanner,
} from "../components/race";
import DataFetchError from "../components/DataFetchError";
import { FETCH_FAILED_ERROR } from "../hooks/useDatePredictions";
import { getHomeBlogPosts, getLatestPosts } from "../data/blogPosts";
import { getTodayJST } from "../utils/dateUtils";
import {
  formatDateShortLocalized,
  formatDateLongLocalized,
} from "../utils/formatters";

// 本日の会場グリッドのセクション（見出し・更新表示・導入・グリッド）
function TodayVenuesSection({
  t,
  i18n,
  localize,
  nowHHMM,
  isFirstVisit,
  venuesData,
  loading,
  error,
  lastUpdated,
  isRefreshing,
  handleRefresh,
  nextOpenDates,
}) {
  return (
          <section className="race-list-section" id="today-venues">
            <h2>
              🏁 {t("home.todayRaces")}{" "}
              {formatDateShortLocalized(getTodayJST(), i18n.resolvedLanguage)}
            </h2>
            <p className="free-access-notice">
              ✅ <strong>{t("home.freeAccessNoticeStrong")}</strong>{" "}
              {t("home.freeAccessNoticeRest")}
            </p>
            <UpdateStatus
              lastUpdated={lastUpdated}
              dataType={t("home.dataType")}
              onRefresh={handleRefresh}
              isRefreshing={isRefreshing}
            />
            {/* まもなく締切のレース（PV09 T1・案 B、BOA-1690）。初めての人の案内のカードより上に置き、
                最初の画面にレースの中身を出す。取得に失敗したときは出さない（エラーは下の DataFetchError） */}
            {!error && (
              <UpcomingDeadlineRaces
                venuesData={venuesData}
                nowHHMM={nowHHMM}
                loading={loading}
              />
            )}
            {isFirstVisit && i18n.language === "ja" ? (
              <FirstVisitGuideCard />
            ) : (
              <IntroBanner />
            )}

            {loading ? (
              <VenueGridSkeleton />
            ) : (
              <>
                {/* 取得に失敗したら会場グリッドを出さない。出すと venuesData が空のため
                    24会場すべてが「本日開催なし」になり、エラー表示と矛盾する（BOA-668）。
                    「本日開催なし」は取得に成功して0件だったときだけ出す */}
                {error ? (
                  <DataFetchError
                    detail={error === FETCH_FAILED_ERROR ? null : error}
                  />
                ) : (
                  <>
                    {/* ☆の選手の今日の出走（GS04-6〜8）。出走の行は予測の応答を自分で読む
                        （venuesData は racerId を持たない）。venuesData は代わりの表示
                        （☆の会場・今日の SG・G1）だけに使う */}
                    <FavoriteRunsSection
                      nextOpenDates={nextOpenDates}
                      venuesData={venuesData}
                      nowHHMM={nowHHMM}
                    />
                    {/* SG開催中の会場への導線（集客レーン。SG の日だけ出る） */}
                    <SgNowBanner venuesData={venuesData} />
                    <TodaysVolatilityHighlights
                      venuesData={venuesData}
                      nowHHMM={nowHHMM}
                    />
                  </>
                )}
                {/* 本日のデータ一覧（BOA-402）への導線。高さを固定してCLSを出さない。
                    /today は ja専用なので、ヘッダーと同じく ja のときだけ出す（BOA-653） */}
                {/* i18n-allow-start: ja のときだけ出す導線（遷移先が ja専用ページ） */}
                {i18n.language === "ja" && (
                  <Link to="/today" className="home-digest-link">
                    <span className="home-digest-link__label">
                      📋 本日のデータ一覧
                    </span>
                    <span className="home-digest-link__desc">
                      逃げが堅い選手・まくりが利く選手・昨日のフライング
                    </span>
                  </Link>
                )}
                {/* i18n-allow-end */}
                {!error && (
                  <VenueGrid
                    venuesData={venuesData}
                    getVenueLink={(code) => localize(`/venue/${code}`)}
                    nowHHMM={nowHHMM}
                    nextOpenDates={nextOpenDates}
                  />
                )}
              </>
            )}
          </section>
  );
}

// ブログ記事セクション
function HomeBlogSection({ t, i18n, localize }) {
  return (
          <section className="blog-preview-section">
            <h2>📝 {t("home.blogTitle")}</h2>
            <p className="blog-preview-lead">{t("home.blogDesc")}</p>

            {(() => {
              // 記事の選び方はボット向け HTML（botPageModel.js）と共有する
              const { popularPosts, newPosts } = getHomeBlogPosts(
                i18n.resolvedLanguage,
              );

              const renderCard = (post) => (
                <Link
                  to={localize(`/blog/${post.id}`)}
                  key={post.id}
                  className="blog-preview-card"
                >
                  <span className="blog-preview-category">{post.category}</span>
                  <h3 className="blog-preview-title">{post.title}</h3>
                  <p className="blog-preview-desc">{post.description}</p>
                  <div className="blog-preview-meta">
                    <span>{post.readTime}</span>
                  </div>
                </Link>
              );

              return (
                <>
                  <h3 className="blog-preview-subheading">
                    🌟 {t("home.popularArticles")}
                  </h3>
                  <div className="blog-preview-grid">
                    {popularPosts.map(renderCard)}
                  </div>

                  <h3 className="blog-preview-subheading">
                    🆕 {t("home.newArticles")}
                  </h3>
                  <div className="blog-preview-grid">
                    {newPosts.map(renderCard)}
                  </div>
                </>
              );
            })()}

            <div className="blog-preview-cta">
              <Link to={localize("/blog")} className="blog-preview-btn">
                {t("home.viewAllPosts")}
              </Link>
            </div>
          </section>
  );
}

// ページ下部のフッター（リンク・免責・最新記事の更新日）
function TodayVenueFooter({ t, i18n }) {
  return (
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
  );
}

export { TodayVenuesSection, HomeBlogSection, TodayVenueFooter };
