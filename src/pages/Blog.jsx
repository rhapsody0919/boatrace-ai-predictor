import React, { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import Header from "../components/Header";
import { blogPosts } from "../data/blogPosts";
import { getEnglishOverride, isEnglishAvailable } from "../data/blogPostsEn";
import { parseLangFromPath, localizePath } from "../config/languages";
import { isWithinDays } from "../utils/dateUtils";
import { useSocialMeta } from "../hooks/useSocialMeta";
import "./Blog.css";

const UI_TEXT = {
  ja: {
    title: "ブログ | BoatAI - ボートレース予想・データ分析・戦略情報",
    description:
      "ボートレース予想、データ分析、舟券戦略に関する最新情報を発信。初心者向けの基本知識から、上級者向けの高度な戦略まで幅広くカバーしています。",
    keywords: "ボートレースブログ,予想戦略,データ分析,舟券購入,AI予想,勝ち方",
    heading: "📚 BoatAI ブログ",
    subheading:
      "ボートレース予想・データ分析・戦略に関する情報を発信しています",
    featuredHeading: "🌟 注目記事",
    allButton: "すべて",
    noPosts: "このカテゴリの記事はまだありません。",
    home: "ホーム",
    blogLabel: "ブログ",
  },
  en: {
    title: "Blog | BoatAI - Boat Racing Predictions, Data Analysis & Strategy",
    description:
      "The latest on boat racing predictions, data analysis, and betting strategy — from beginner basics to advanced techniques.",
    keywords: "boat racing blog,betting strategy,data analysis,AI predictions",
    heading: "📚 BoatAI Blog",
    subheading: "Boat racing predictions, data analysis, and strategy insights",
    featuredHeading: "🌟 Featured Articles",
    allButton: "All",
    noPosts: "No articles in this category yet.",
    home: "Home",
    blogLabel: "Blog",
  },
};

export default function Blog() {
  const { pathname } = useLocation();
  const [selectedCategory, setSelectedCategory] = useState("all");

  const { lng } = parseLangFromPath(pathname);
  const isEnglish = lng === "en";
  const t = UI_TEXT[isEnglish ? "en" : "ja"];

  // 英語版は英語版データが存在する記事のみを対象にする（未翻訳記事は一覧に出さない）
  const basePosts = isEnglish
    ? blogPosts
        .filter((post) => isEnglishAvailable(post.id))
        .map((post) => ({ ...post, ...getEnglishOverride(post.id) }))
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

  const blogHref = localizePath("/blog", isEnglish ? "en" : "ja");
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
              item: `https://www.boat-ai.jp${localizePath("/", isEnglish ? "en" : "ja")}`,
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
                  to={localizePath(`/blog/${post.id}`, isEnglish ? "en" : "ja")}
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
              to={localizePath(`/blog/${post.id}`, isEnglish ? "en" : "ja")}
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
