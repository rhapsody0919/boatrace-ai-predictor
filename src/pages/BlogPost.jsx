import React, { useState, useEffect, useMemo, useRef } from "react";
import { useParams, useLocation, Link } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import {
  getPostById,
  getRelatedPosts,
  getRelatedPostsForLang,
  isBlogLangAvailable,
  getBlogOverride,
  getBlogMdSuffix,
} from "../data/blogPosts";
import { parseLangFromPath, localizePath } from "../config/languages";
import Header from "../components/Header";
import { useSocialMeta } from "../hooks/useSocialMeta";
import { extractFaqItems, buildFaqPageSchema } from "../utils/blogFaqSchema";
import { BLOG_IMAGE_DIMENSIONS } from "../data/blogImageDimensions";
import "./BlogPost.css";

const UI_TEXT = {
  ja: {
    brandName: "龍神レーダー",
    backToBlog: "← ブログ一覧に戻る",
    backHref: "/blog",
    loading: "記事を読み込み中...",
    errorTitle: "エラー",
    notFound: "記事が見つかりません",
    loadError: "記事の読み込みに失敗しました",
    relatedPosts: "📌 関連記事",
    readMore: "続きを読む →",
    ctaTitle: "🚀 今すぐ龍神レーダー予想を試してみる",
    ctaDesc: "完全無料でAI予想を確認できます",
    ctaButton: "AI予想を見る",
    home: "ホーム",
    blogLabel: "ブログ",
    homeHref: "/",
    tocTitle: "目次",
    backToTop: "ページ上部に戻る",
  },
  en: {
    brandName: "Ryujin Radar",
    backToBlog: "← Back to blog list",
    backHref: "/en/blog",
    loading: "Loading article...",
    errorTitle: "Error",
    notFound: "Article not found",
    loadError: "Failed to load article",
    relatedPosts: "📌 Related articles",
    readMore: "Read more →",
    ctaTitle: "🚀 Try Ryujin Radar predictions now",
    ctaDesc: "Check AI predictions completely free",
    ctaButton: "View AI Predictions",
    home: "Home",
    blogLabel: "Blog",
    homeHref: "/en/",
    tocTitle: "Table of Contents",
    backToTop: "Back to top",
  },
  "zh-TW": {
    brandName: "龍神雷達",
    backToBlog: "← 返回文章列表",
    backHref: "/zh-TW/blog",
    loading: "文章載入中...",
    errorTitle: "錯誤",
    notFound: "找不到文章",
    loadError: "文章載入失敗",
    relatedPosts: "📌 相關文章",
    readMore: "繼續閱讀 →",
    ctaTitle: "🚀 立即試用龍神雷達預測",
    ctaDesc: "完全免費查看AI預測",
    ctaButton: "查看AI預測",
    home: "首頁",
    blogLabel: "部落格",
    homeHref: "/zh-TW/",
    tocTitle: "目錄",
    backToTop: "回到頂部",
  },
  ko: {
    brandName: "용신 레이더",
    backToBlog: "← 블로그 목록으로 돌아가기",
    backHref: "/ko/blog",
    loading: "기사를 불러오는 중...",
    errorTitle: "오류",
    notFound: "기사를 찾을 수 없습니다",
    loadError: "기사를 불러오지 못했습니다",
    relatedPosts: "📌 관련 기사",
    readMore: "더 읽기 →",
    ctaTitle: "🚀 지금 바로 용신 레이더 예측을 체험해보세요",
    ctaDesc: "완전 무료로 AI 예측을 확인할 수 있습니다",
    ctaButton: "AI 예측 보기",
    home: "홈",
    blogLabel: "블로그",
    homeHref: "/ko/",
    tocTitle: "목차",
    backToTop: "위로 이동",
  },
};

export default function BlogPost() {
  const { id } = useParams();
  const { pathname } = useLocation();
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [readProgress, setReadProgress] = useState(0);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [headings, setHeadings] = useState([]);
  const articleRef = useRef(null);

  const { lng } = parseLangFromPath(pathname);
  const isTranslated = lng !== "ja" && isBlogLangAvailable(id, lng);
  const t = UI_TEXT[isTranslated ? lng : "ja"];

  const basePost = getPostById(id);
  const post =
    isTranslated && basePost
      ? { ...basePost, ...getBlogOverride(id, lng) }
      : basePost;
  const relatedPosts = isTranslated
    ? getRelatedPostsForLang(id, lng, 3)
    : getRelatedPosts(id, 3);
  const mdPath = isTranslated
    ? `/blog/${id}${getBlogMdSuffix(lng)}.md`
    : `/blog/${id}.md`;

  const postUrl = post
    ? `https://www.boat-ai.jp${localizePath(`/blog/${id}`, isTranslated ? lng : "ja")}`
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mdPath/t は id/isTranslated から導出される
  }, [id, basePost, mdPath]);

  useEffect(() => {
    // rAFで間引き、フリングスクロール中に毎イベントscrollHeight（強制リフロー）や
    // setStateを連発しないようにする
    let rafId = null;
    const handleScroll = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        const scrollTop = window.scrollY;
        const docHeight =
          document.documentElement.scrollHeight - window.innerHeight;
        setReadProgress(
          docHeight > 0
            ? Math.max(0, Math.min(100, (scrollTop / docHeight) * 100))
            : 0,
        );
        setShowBackToTop(scrollTop > 600);
      });
    };
    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", handleScroll);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [id]);

  // 目次のid/テキストは、実際にDOMへレンダーされたh2/h3から収集する（見出しテキストの
  // 一致判定に頼らないため、同名見出しの重複やMarkdownリンクを含む見出しでもズレない）
  useEffect(() => {
    if (!articleRef.current) {
      setHeadings([]);
      return;
    }
    const elements = Array.from(articleRef.current.querySelectorAll("h2, h3"));
    setHeadings(
      elements.map((el, i) => {
        const headingId = `toc-heading-${i}`;
        el.id = headingId;
        return {
          level: el.tagName === "H2" ? 2 : 3,
          text: el.textContent,
          id: headingId,
        };
      }),
    );
  }, [content]);

  const faqItems = useMemo(() => extractFaqItems(content), [content]);

  const articleContent = useMemo(
    () => (
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
          // 実寸法をwidth/height属性で渡し、ブラウザに事前スペースを確保させる
          // （CLS対策）。一律のaspect-ratio指定は使わない — 記事画像は比率が
          // 様々でトリミングにより画像が欠ける実害があったため撤回された経緯がある
          // （2026-09-07 PR#559）。実寸法ベースなら自然な比率のままCLSも防げる
          img: ({ node, ...props }) => (
            <img
              {...props}
              loading="lazy"
              decoding="async"
              width={BLOG_IMAGE_DIMENSIONS[props.src]?.width}
              height={BLOG_IMAGE_DIMENSIONS[props.src]?.height}
            />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    ),
    // contentが変わらない限りReactMarkdown要素を再生成しない。読了進捗バーの
    // scroll起因の再レンダーのたびに記事全文を再パースしていた問題への対処
    [content],
  );

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
  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <>
      {/* Basic Meta Tags */}
      {/* keywords/OGP/Twitterカードはindex.htmlの静的タグをuseSocialMetaで直接書き換えている */}
      <title>{`${post.title} | ${t.brandName}`}</title>
      <meta name="description" content={post.description} />
      <link rel="canonical" href={url} />

      <meta property="article:published_time" content={post.date} />
      <meta property="article:author" content={t.brandName} />
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
            name: t.brandName,
            url: "https://www.boat-ai.jp",
          },
          publisher: {
            "@type": "Organization",
            name: t.brandName,
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
              item: `https://www.boat-ai.jp${localizePath("/", isTranslated ? lng : "ja")}`,
            },
            {
              "@type": "ListItem",
              position: 2,
              name: t.blogLabel,
              item: `https://www.boat-ai.jp${localizePath("/blog", isTranslated ? lng : "ja")}`,
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

      <div
        className="reading-progress-bar"
        style={{ width: `${readProgress}%` }}
      />

      {showBackToTop && (
        <button
          type="button"
          className="back-to-top-button"
          onClick={scrollToTop}
          aria-label={t.backToTop}
        >
          ↑
        </button>
      )}

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

        {headings.length > 0 && (
          <details className="toc-section">
            <summary className="toc-summary">
              📑 {t.tocTitle} ({headings.length})
            </summary>
            <nav className="toc-list" aria-label={t.tocTitle}>
              {headings.map((h) => (
                <a
                  key={h.id}
                  href={`#${h.id}`}
                  className={`toc-link toc-link-level-${h.level}`}
                >
                  {h.text}
                </a>
              ))}
            </nav>
          </details>
        )}

        <article className="blog-post-content" ref={articleRef}>
          {articleContent}
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
                    isTranslated ? lng : "ja",
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
          <Link to={t.homeHref} className="cta-button">
            {t.ctaButton}
          </Link>
        </div>
      </div>
    </>
  );
}
