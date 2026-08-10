import React, { useState, useEffect } from "react";
import { useParams, useLocation, Link, useNavigate } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import {
  getPostById,
  getRelatedPosts,
  getRelatedPostsEn,
} from "../data/blogPosts";
import { getEnglishOverride, isEnglishAvailable } from "../data/blogPostsEn";
import { parseLangFromPath, localizePath } from "../config/languages";
import Header from "../components/Header";
import { useSocialMeta } from "../hooks/useSocialMeta";
import { extractFaqItems, buildFaqPageSchema } from "../utils/blogFaqSchema";
import "./BlogPost.css";

const UI_TEXT = {
  ja: {
    backToBlog: "← ブログ一覧に戻る",
    backHref: "/blog",
    loading: "記事を読み込み中...",
    errorTitle: "エラー",
    notFound: "記事が見つかりません",
    loadError: "記事の読み込みに失敗しました",
    relatedPosts: "📌 関連記事",
    readMore: "続きを読む →",
    ctaTitle: "🚀 今すぐBoatAI予想を試してみる",
    ctaDesc: "完全無料でAI予想を確認できます",
    ctaButton: "AI予想を見る",
    home: "ホーム",
    blogLabel: "ブログ",
    homeHref: "/",
  },
  en: {
    backToBlog: "← Back to blog list",
    backHref: "/en/blog",
    loading: "Loading article...",
    errorTitle: "Error",
    notFound: "Article not found",
    loadError: "Failed to load article",
    relatedPosts: "📌 Related articles",
    readMore: "Read more →",
    ctaTitle: "🚀 Try BoatAI predictions now",
    ctaDesc: "Check AI predictions completely free",
    ctaButton: "View AI Predictions",
    home: "Home",
    blogLabel: "Blog",
    homeHref: "/en/",
  },
};

export default function BlogPost() {
  const { id } = useParams();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const { lng } = parseLangFromPath(pathname);
  const isEnglish = lng === "en" && isEnglishAvailable(id);
  const t = UI_TEXT[isEnglish ? "en" : "ja"];

  const basePost = getPostById(id);
  const post =
    isEnglish && basePost
      ? { ...basePost, ...getEnglishOverride(id) }
      : basePost;
  const relatedPosts = isEnglish
    ? getRelatedPostsEn(id, 3)
    : getRelatedPosts(id, 3);
  const mdPath = isEnglish ? `/blog/${id}-en.md` : `/blog/${id}.md`;

  const postUrl = post
    ? `https://www.boat-ai.jp${localizePath(`/blog/${id}`, isEnglish ? "en" : "ja")}`
    : null;
  const postImageUrl = post
    ? post.image
      ? `https://www.boat-ai.jp${post.image}`
      : "https://www.boat-ai.jp/ogp-image.png"
    : null;

  useEffect(() => {
    if (!basePost) {
      setError(t.notFound);
      setLoading(false);
      return;
    }

    // Load markdown content
    fetch(mdPath)
      .then((response) => {
        if (!response.ok) {
          throw new Error(t.loadError);
        }
        return response.text();
      })
      .then((text) => {
        setContent(text);
        setLoading(false);
      })
      .catch((err) => {
        console.error("Error loading blog post:", err);
        setError(err.message);
        setLoading(false);
      });

    // Scroll to top
    window.scrollTo(0, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mdPath/t は id/isEnglish から導出される
  }, [id, basePost, mdPath]);

  useSocialMeta({
    title: post?.title,
    description: post?.description,
    url: postUrl,
    image: postImageUrl,
    keywords: post?.tags.join(", "),
  });

  if (loading) {
    return (
      <div className="blog-post-container">
        <div className="loading">
          <div className="spinner"></div>
          <p>{t.loading}</p>
        </div>
      </div>
    );
  }

  if (error || !post) {
    return (
      <div className="blog-post-container">
        <div className="error">
          <h2>{t.errorTitle}</h2>
          <p>{error || t.notFound}</p>
          <Link to={t.backHref} className="back-button">
            {t.backToBlog}
          </Link>
        </div>
      </div>
    );
  }

  const url = postUrl;
  const imageUrl = postImageUrl;
  const faqItems = extractFaqItems(content);

  return (
    <>
      {/* Basic Meta Tags */}
      {/* keywords/OGP/Twitterカードはindex.htmlの静的タグをuseSocialMetaで直接書き換えている */}
      <title>{`${post.title} | BoatAI`}</title>
      <meta name="description" content={post.description} />
      <link rel="canonical" href={url} />

      <meta property="article:published_time" content={post.date} />
      <meta property="article:author" content="BoatAI" />
      <meta property="article:section" content={post.category} />
      {post.tags.map((tag) => (
        <meta key={tag} property="article:tag" content={tag} />
      ))}

      {/* Article Structured Data */}
      <script type="application/ld+json">
        {JSON.stringify({
          "@context": "https://schema.org",
          "@type": "BlogPosting",
          headline: post.title,
          description: post.description,
          image: imageUrl,
          datePublished: post.date,
          dateModified: post.date,
          author: {
            "@type": "Organization",
            name: "BoatAI",
            url: "https://www.boat-ai.jp",
          },
          publisher: {
            "@type": "Organization",
            name: "BoatAI",
            logo: {
              "@type": "ImageObject",
              url: "https://www.boat-ai.jp/logo.png",
            },
          },
          mainEntityOfPage: {
            "@type": "WebPage",
            "@id": url,
          },
          keywords: post.tags.join(", "),
          articleSection: post.category,
          wordCount: content.split(" ").length,
        })}
      </script>

      {/* FAQPage Structured Data（記事本文に「よくある質問」セクションがある場合のみ） */}
      {faqItems.length > 0 && (
        <script type="application/ld+json">
          {JSON.stringify(buildFaqPageSchema(faqItems))}
        </script>
      )}

      {/* BreadcrumbList Structured Data */}
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
              item: `https://www.boat-ai.jp${localizePath("/blog", isEnglish ? "en" : "ja")}`,
            },
            {
              "@type": "ListItem",
              position: 3,
              name: post.title,
              item: url,
            },
          ],
        })}
      </script>

      <Header />

      <div className="blog-post-container">
        <div className="blog-post-header">
          <Link to={t.backHref} className="back-link">
            {t.backToBlog}
          </Link>
          <span className="category-badge">{post.category}</span>
          <h1>{post.title}</h1>
          <div className="post-meta">
            <span className="date">📅 {post.date}</span>
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

        <article className="blog-post-content">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeRaw]}
            components={{
              // Custom link renderer to open external links in new tab
              a: ({ node, ...props }) => {
                const isExternal = props.href?.startsWith("http");
                return (
                  <a
                    {...props}
                    target={isExternal ? "_blank" : undefined}
                    rel={isExternal ? "noopener noreferrer" : undefined}
                  />
                );
              },
            }}
          >
            {content}
          </ReactMarkdown>
        </article>

        {/* Related Posts */}
        {relatedPosts.length > 0 && (
          <div className="related-posts">
            <h2>{t.relatedPosts}</h2>
            <div className="related-grid">
              {relatedPosts.map((relatedPost) => (
                <Link
                  key={relatedPost.id}
                  to={localizePath(
                    `/blog/${relatedPost.id}`,
                    isEnglish ? "en" : "ja",
                  )}
                  className="related-card"
                >
                  <span className="category-badge">{relatedPost.category}</span>
                  <h3>{relatedPost.title}</h3>
                  <p>{relatedPost.description}</p>
                  <span className="read-more">{t.readMore}</span>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* CTA */}
        <div className="post-cta">
          <h3>{t.ctaTitle}</h3>
          <p>{t.ctaDesc}</p>
          <button onClick={() => navigate(t.homeHref)} className="cta-button">
            {t.ctaButton}
          </button>
        </div>
      </div>
    </>
  );
}
