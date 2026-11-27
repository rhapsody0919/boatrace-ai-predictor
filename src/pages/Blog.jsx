import { useState } from "react";
import { countCategories, filterBlogPosts } from "../pure/blogListFilter.js";
import { Link, useLocation } from "react-router-dom";
import Header from "../components/Header";
import { getFeaturedPosts, getPostsForLang } from "../data/blogPosts";
import { parseLangFromPath, localizePath } from "../config/languages";
import { isWithinDays } from "../utils/dateUtils";
import { useSocialMeta } from "../hooks/useSocialMeta";
import "./Blog.css";

const UI_TEXT = {
  ja: {
    title: "ブログ | 龍神レーダー - ボートレース予想・データ分析・戦略情報",
    description:
      "ボートレース予想、データ分析、舟券戦略に関する最新情報を発信。初心者向けの基本知識から、上級者向けの高度な戦略まで幅広くカバーしています。",
    keywords: "ボートレースブログ,予想戦略,データ分析,舟券購入,AI予想,勝ち方",
    heading: "📚 龍神レーダー ブログ",
    subheading:
      "ボートレース予想・データ分析・戦略に関する情報を発信しています",
    featuredHeading: "🌟 注目記事",
    allButton: "すべて",
    noPosts: "このカテゴリの記事はまだありません。",
    home: "ホーム",
    blogLabel: "ブログ",
    sortNewest: "新着順",
    sortOldest: "古い順",
    searchPlaceholder: "記事を探す（例: 多摩川・決まり手・風）",
    searchLabel: "記事を探す",
    featuredMore: (n) => `注目記事をすべて見る（${n}本）`,
    featuredLess: "注目記事を閉じる",
    showMore: (n) => `さらに表示（残り${n}本）`,
    resultCount: (n) => `${n}本`,
  },
  en: {
    title:
      "Blog | Ryujin Radar - Boat Racing Predictions, Data Analysis & Strategy",
    description:
      "The latest on boat racing predictions, data analysis, and betting strategy — from beginner basics to advanced techniques.",
    keywords: "boat racing blog,betting strategy,data analysis,AI predictions",
    heading: "📚 Ryujin Radar Blog",
    subheading: "Boat racing predictions, data analysis, and strategy insights",
    featuredHeading: "🌟 Featured Articles",
    allButton: "All",
    noPosts: "No articles in this category yet.",
    home: "Home",
    blogLabel: "Blog",
    sortNewest: "Newest",
    sortOldest: "Oldest",
    searchPlaceholder: "Search articles",
    searchLabel: "Search articles",
    featuredMore: (n) => `Show all featured (${n})`,
    featuredLess: "Show fewer featured",
    showMore: (n) => `Show more (${n} left)`,
    resultCount: (n) => `${n} articles`,
  },
  "zh-TW": {
    title: "部落格 | 龍神雷達 - 賽艇預測・數據分析・戰略資訊",
    description:
      "發布賽艇預測、數據分析、投注策略的最新資訊。從初學者的基礎知識到進階戰略，內容廣泛涵蓋。",
    keywords: "賽艇部落格,預測策略,數據分析,購買船票,AI預測,獲勝方法",
    heading: "📚 龍神雷達 部落格",
    subheading: "發布賽艇預測、數據分析、戰略相關資訊",
    featuredHeading: "🌟 精選文章",
    allButton: "全部",
    noPosts: "此分類目前尚無文章。",
    home: "首頁",
    blogLabel: "部落格",
    sortNewest: "最新排序",
    sortOldest: "最舊排序",
    searchPlaceholder: "搜尋文章",
    searchLabel: "搜尋文章",
    featuredMore: (n) => `顯示全部精選文章（${n}篇）`,
    featuredLess: "收起精選文章",
    showMore: (n) => `顯示更多（剩餘${n}篇）`,
    resultCount: (n) => `${n}篇`,
  },
  ko: {
    title: "블로그 | 용신 레이더 - 경정 예측・데이터 분석・전략 정보",
    description:
      "경정 예측, 데이터 분석, 마권 전략에 관한 최신 정보를 발신합니다. 초보자를 위한 기초 지식부터 상급자를 위한 고급 전략까지 폭넓게 다룹니다.",
    keywords: "경정블로그,예측전략,데이터분석,마권구매,AI예측,승리법",
    heading: "📚 용신 레이더 블로그",
    subheading: "경정 예측・데이터 분석・전략에 관한 정보를 발신합니다",
    featuredHeading: "🌟 주목 기사",
    allButton: "전체",
    noPosts: "이 카테고리의 기사는 아직 없습니다.",
    home: "홈",
    blogLabel: "블로그",
    sortNewest: "최신순",
    sortOldest: "오래된순",
    searchPlaceholder: "기사 검색",
    searchLabel: "기사 검색",
    featuredMore: (n) => `주목 기사 모두 보기 (${n}개)`,
    featuredLess: "주목 기사 접기",
    showMore: (n) => `더 보기 (남은 ${n}개)`,
    resultCount: (n) => `${n}개`,
  },
};

function buildBreadcrumbJsonLd(t, langKey, canonicalUrl) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: t.home,
        item: `https://www.boat-ai.jp${localizePath("/", langKey)}`,
      },
      {
        "@type": "ListItem",
        position: 2,
        name: t.blogLabel,
        item: canonicalUrl,
      },
    ],
  };
}

// 注目記事は先頭の3本だけを出し、残りは「すべて見る」で開く（32本が何画面も続き新着に届かなかった）
const FEATURED_FIRST = 3;

function BlogFeaturedSection({ t, featuredPosts, langKey }) {
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? featuredPosts : featuredPosts.slice(0, FEATURED_FIRST);
  return (
    <section className="featured-section">
      <h2>{t.featuredHeading}</h2>
      <div className="featured-grid">
        {shown.map((post) => (
          <Link
            key={post.id}
            to={localizePath(`/blog/${post.id}`, langKey)}
            className="featured-card"
          >
            {isWithinDays(post.date, 7) && (
              <span className="new-badge">NEW</span>
            )}
            <div className="featured-content">
              <span className="category-badge">{post.category}</span>
              <h3>{post.title}</h3>
              <p className="description">{post.description}</p>
              <div className="meta">
                <span className="date">{post.date}</span>
                <span className="read-time">📖 {post.readTime}</span>
              </div>
            </div>
          </Link>
        ))}
      </div>
      {featuredPosts.length > FEATURED_FIRST && (
        <button
          type="button"
          className="blog-featured-toggle"
          aria-expanded={showAll}
          onClick={() => setShowAll((v) => !v)}
        >
          {showAll ? t.featuredLess : t.featuredMore(featuredPosts.length)}
        </button>
      )}
    </section>
  );
}

function BlogCategoryFilter({
  t,
  availableCategories,
  categoryCounts,
  totalCount,
  selectedCategory,
  setSelectedCategory,
}) {
  return (
    <div className="category-filter">
      <button
        className={selectedCategory === "all" ? "active" : ""}
        onClick={() => setSelectedCategory("all")}
      >
        {t.allButton}
        <span className="blog-category-count">{totalCount}</span>
      </button>
      {availableCategories.map((category) => (
        <button
          key={category}
          className={selectedCategory === category ? "active" : ""}
          onClick={() => setSelectedCategory(category)}
        >
          {category}
          <span className="blog-category-count">{categoryCounts[category]}</span>
        </button>
      ))}
    </div>
  );
}

function BlogSortFilter({ t, sortOrder, setSortOrder }) {
  return (
    <div className="sort-filter">
      <button
        className={sortOrder === "newest" ? "active" : ""}
        onClick={() => setSortOrder("newest")}
      >
        {t.sortNewest}
      </button>
      <button
        className={sortOrder === "oldest" ? "active" : ""}
        onClick={() => setSortOrder("oldest")}
      >
        {t.sortOldest}
      </button>
    </div>
  );
}

function BlogPostGrid({ sortedPosts, langKey }) {
  return (
    <div className="blog-grid">
      {sortedPosts.map((post) => (
        <Link
          key={post.id}
          to={localizePath(`/blog/${post.id}`, langKey)}
          className="blog-card"
        >
          {isWithinDays(post.date, 7) && <span className="new-badge">NEW</span>}
          <div className="blog-card-content">
            <span className="category-badge">{post.category}</span>
            <h3>{post.title}</h3>
            <p className="description">{post.description}</p>
            <div className="meta">
              <span className="date">{post.date}</span>
              <span className="read-time">📖 {post.readTime}</span>
            </div>
            <div className="tags">
              {post.tags.map((tag) => (
                <span key={tag} className="tag">
                  #{tag}
                </span>
              ))}
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}

// 一覧は20本ずつ出し、「さらに表示」で足す（163本を1ページに並べてスマホで約3.9万pxあった）
const PAGE_SIZE = 20;

// 分類・探す語・並び・出す本数の状態と、それで絞って並べた記事。絞り方を変えたら出す本数を20に戻す
function useBlogListView(basePosts) {
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [sortOrder, setSortOrder] = useState("newest");
  const [query, setQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const { categoryCounts, categories } = countCategories(basePosts);
  const sortedPosts = filterBlogPosts(basePosts, {
    category: selectedCategory,
    query,
  }).sort((a, b) =>
    sortOrder === "oldest"
      ? new Date(a.date) - new Date(b.date)
      : new Date(b.date) - new Date(a.date),
  );
  return {
    selectedCategory,
    selectCategory: (c) => {
      setSelectedCategory(c);
      setVisibleCount(PAGE_SIZE);
    },
    sortOrder,
    setSortOrder,
    query,
    changeQuery: (q) => {
      setQuery(q);
      setVisibleCount(PAGE_SIZE);
    },
    visibleCount,
    showMore: () => setVisibleCount((n) => n + PAGE_SIZE),
    categoryCounts,
    categories,
    sortedPosts,
  };
}

function BlogListResults({ t, view, langKey }) {
  const { sortedPosts, visibleCount, showMore } = view;
  return (
    <>
      <p className="blog-result-count">{t.resultCount(sortedPosts.length)}</p>
      <BlogPostGrid
        sortedPosts={sortedPosts.slice(0, visibleCount)}
        langKey={langKey}
      />
      {sortedPosts.length > visibleCount && (
        <button type="button" className="blog-show-more" onClick={showMore}>
          {t.showMore(sortedPosts.length - visibleCount)}
        </button>
      )}
      {sortedPosts.length === 0 && (
        <div className="no-posts">
          <p>{t.noPosts}</p>
        </div>
      )}
    </>
  );
}

export default function Blog() {
  const { pathname } = useLocation();

  const { lng } = parseLangFromPath(pathname);
  const isTranslated = lng !== "ja" && Boolean(UI_TEXT[lng]);
  const t = UI_TEXT[isTranslated ? lng : "ja"];

  // 翻訳版はその言語のデータが存在する記事のみを対象にする（未翻訳記事は一覧に出さない）
  const langKey = isTranslated ? lng : "ja";
  const basePosts = getPostsForLang(langKey);
  const featuredPosts = getFeaturedPosts(langKey);
  const view = useBlogListView(basePosts);

  const blogHref = localizePath("/blog", langKey);
  const canonicalUrl = `https://www.boat-ai.jp${blogHref}`;

  useSocialMeta({
    title: t.title,
    description: t.description,
    url: canonicalUrl,
    keywords: t.keywords,
  });

  return (
    <>
      <title>{t.title}</title>
      <meta name="description" content={t.description} />
      <link rel="canonical" href={canonicalUrl} />

      {/* BreadcrumbList */}
      <script type="application/ld+json">
        {JSON.stringify(buildBreadcrumbJsonLd(t, langKey, canonicalUrl))}
      </script>

      <Header />

      <div className="blog-container">
        <div className="blog-header">
          <h1>{t.heading}</h1>
          <p>{t.subheading}</p>
        </div>

        <input
          type="search"
          className="blog-search-input"
          placeholder={t.searchPlaceholder}
          aria-label={t.searchLabel}
          value={view.query}
          onChange={(e) => view.changeQuery(e.target.value)}
        />

        {/* Featured Posts（分類で絞った時・探している時は出さない） */}
        {view.selectedCategory === "all" &&
          view.query === "" &&
          featuredPosts.length > 0 && (
            <BlogFeaturedSection
              t={t}
              featuredPosts={featuredPosts}
              langKey={langKey}
            />
          )}

        <BlogCategoryFilter
          t={t}
          availableCategories={view.categories}
          categoryCounts={view.categoryCounts}
          totalCount={basePosts.length}
          selectedCategory={view.selectedCategory}
          setSelectedCategory={view.selectCategory}
        />

        <BlogSortFilter
          t={t}
          sortOrder={view.sortOrder}
          setSortOrder={view.setSortOrder}
        />

        <BlogListResults t={t} view={view} langKey={langKey} />
      </div>
    </>
  );
}
