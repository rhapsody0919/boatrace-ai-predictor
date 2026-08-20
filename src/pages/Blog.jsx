import React, { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import Header from "../components/Header";
import {
  blogPosts,
  isBlogLangAvailable,
  getBlogOverride,
} from "../data/blogPosts";
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
  },
};

export default function Blog() {
  const { pathname } = useLocation();
  const [selectedCategory, setSelectedCategory] = useState("all");

  const { lng } = parseLangFromPath(pathname);
  const isTranslated = lng !== "ja" && Boolean(UI_TEXT[lng]);
  const t = UI_TEXT[isTranslated ? lng : "ja"];

  // 翻訳版はその言語のデータが存在する記事のみを対象にする（未翻訳記事は一覧に出さない）
  const basePosts = isTranslated
    ? blogPosts
        .filter((post) => isBlogLangAvailable(post.id, lng))
        .map((post) => ({ ...post, ...getBlogOverride(post.id, lng) }))
    : blogPosts;

  const featuredPosts = basePosts.filter((post) => post.featured);
  const availableCategories = [
    ...new Set(basePosts.map((post) => post.category)),
  ];

  const filteredPosts =
    selectedCategory === "all"
      ? basePosts
      : basePosts.filter((post) => post.category === selectedCategory);

  const sortedPosts = [...filteredPosts].sort(
    (a, b) => new Date(b.date) - new Date(a.date),
  );

  const blogHref = localizePath("/blog", isTranslated ? lng : "ja");
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
        {JSON.stringify({
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [
            {
              "@type": "ListItem",
              position: 1,
              name: t.home,
              item: `https://www.boat-ai.jp${localizePath("/", isTranslated ? lng : "ja")}`,
            },
            {
              "@type": "ListItem",
              position: 2,
              name: t.blogLabel,
              item: canonicalUrl,
            },
          ],
        })}
      </script>

      <Header />

      <div className="blog-container">
        <div className="blog-header">
          <h1>{t.heading}</h1>
          <p>{t.subheading}</p>
        </div>

        {/* Featured Posts */}
        {selectedCategory === "all" && featuredPosts.length > 0 && (
          <section className="featured-section">
            <h2>{t.featuredHeading}</h2>
            <div className="featured-grid">
              {featuredPosts.map((post) => (
                <Link
                  key={post.id}
                  to={localizePath(
                    `/blog/${post.id}`,
                    isTranslated ? lng : "ja",
                  )}
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
          </section>
        )}

        {/* Category Filter */}
        <div className="category-filter">
          <button
            className={selectedCategory === "all" ? "active" : ""}
            onClick={() => setSelectedCategory("all")}
          >
            {t.allButton}
          </button>
          {availableCategories.map((category) => (
            <button
              key={category}
              className={selectedCategory === category ? "active" : ""}
              onClick={() => setSelectedCategory(category)}
            >
              {category}
            </button>
          ))}
        </div>

        {/* Blog Posts Grid */}
        <div className="blog-grid">
          {sortedPosts.map((post) => (
            <Link
              key={post.id}
              to={localizePath(`/blog/${post.id}`, isTranslated ? lng : "ja")}
              className="blog-card"
            >
              {isWithinDays(post.date, 7) && (
                <span className="new-badge">NEW</span>
              )}
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

        {filteredPosts.length === 0 && (
          <div className="no-posts">
            <p>{t.noPosts}</p>
          </div>
        )}
      </div>
    </>
  );
}
