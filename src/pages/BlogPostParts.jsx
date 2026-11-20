/**
 * BlogPostParts - 記事の頁（BlogPost.jsx）の部品: head の meta と構造化データ・読み込み中と失敗の表示・上へ戻る・見出し・目次・関連記事・CTA
 */
import { Link } from "react-router-dom";
import { localizePath } from "../config/languages";
import { buildFaqPageSchema } from "../utils/blogFaqSchema";

function ArticleHeadMeta({
  post,
  t,
  metaTitle,
  metaDescription,
  url,
  imageUrl,
  content,
  faqItems,
  lang,
}) {
  return (
    <>
      {/* Basic Meta Tags */}
      {/* keywords/OGP/Twitterカードはindex.htmlの静的タグをuseSocialMetaで直接書き換えている */}
      <title>{`${metaTitle} | ${t.brandName}`}</title>
      <meta name="description" content={metaDescription} />
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
              item: `https://www.boat-ai.jp${localizePath("/", lang)}`,
            },
            {
              "@type": "ListItem",
              position: 2,
              name: t.blogLabel,
              item: `https://www.boat-ai.jp${localizePath("/blog", lang)}`,
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
    </>
  );
}

function LoadingView({ t }) {
    return (
      <div className="blog-post-container">
        <div className="loading">
          <div className="spinner"></div>
          <p>{t.loading}</p>
        </div>
      </div>
    );
}

function ErrorView({ t, error }) {
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

function BackToTopButton({ t }) {
  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  return (
    <button
      type="button"
      className="back-to-top-button"
      onClick={scrollToTop}
      aria-label={t.backToTop}
    >
      ↑
    </button>
  );
}

function PostHeader({ post, t }) {
  return (
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
  );
}

function TocSection({ headings, t }) {
  return (
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
  );
}

function RelatedPostsSection({ relatedPosts, t, lang }) {
  return (
    <div className="related-posts">
      <h2>{t.relatedPosts}</h2>
      <div className="related-grid">
        {relatedPosts.map((relatedPost) => (
          <Link
            key={relatedPost.id}
            to={localizePath(`/blog/${relatedPost.id}`, lang)}
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
  );
}

function PostCta({ t }) {
  return (
    <div className="post-cta">
      <h3>{t.ctaTitle}</h3>
      <p>{t.ctaDesc}</p>
      <Link to={t.homeHref} className="cta-button">
        {t.ctaButton}
      </Link>
    </div>
  );
}

export {
  ArticleHeadMeta,
  LoadingView,
  ErrorView,
  BackToTopButton,
  PostHeader,
  TocSection,
  RelatedPostsSection,
  PostCta,
};
