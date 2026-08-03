import React, { useState, useEffect } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { getPostById, getLatestPosts } from "../data/blogPosts";
import Header from "../components/Header";
import "./BlogPost.css";

// index.htmlに静的定義されているデフォルト値。
// og:title等はReactの宣言的な<meta>ではJS実行後にしか反映されず、
// index.htmlの静的タグと重複／競合するため、DOMを直接書き換えて対応する。
// (description/canonicalは静的定義が無いため宣言的なJSXで問題ない)
const DEFAULT_META = {
  'meta[name="keywords"]':
    "ボートレース,AI分析,予測精度,データサイエンス,無料,データ分析,モーター性能,選手データ,BoatAI",
  'meta[property="og:title"]':
    "BoatAI - AIボートレース予想 | 完全無料・実績公開中",
  'meta[property="og:description"]':
    "45項目のデータをAIが分析するボートレース予測サービス。高精度なレース展開分析を完全無料・登録不要で今すぐ使えます。",
  'meta[property="og:url"]': "https://www.boat-ai.jp/",
  'meta[property="og:image"]': "https://www.boat-ai.jp/ogp-image.png",
  'meta[name="twitter:title"]':
    "BoatAI - AIボートレース予想 | 完全無料・実績公開中",
  'meta[name="twitter:description"]':
    "45項目のデータをAIが分析するボートレース予測サービス。高精度なレース展開分析を完全無料で提供。",
  'meta[name="twitter:image"]': "https://www.boat-ai.jp/ogp-image.png",
};

export default function BlogPost() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const post = getPostById(id);
  const relatedPosts = getLatestPosts(4)
    .filter((p) => p.id !== id)
    .slice(0, 3);

  const postUrl = post ? `https://www.boat-ai.jp/blog/${id}` : null;
  const postImageUrl = post
    ? post.image
      ? `https://www.boat-ai.jp${post.image}`
      : "https://www.boat-ai.jp/ogp-image.png"
    : null;

  useEffect(() => {
    if (!post) {
      setError("記事が見つかりません");
      setLoading(false);
      return;
    }

    // Load markdown content
    fetch(`/blog/${id}.md`)
      .then((response) => {
        if (!response.ok) {
          throw new Error("記事の読み込みに失敗しました");
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
  }, [id, post]);

  // 記事固有のOGP/Twitterカード/keywordsを反映（index.htmlの静的タグを直接書き換え）。
  // アンマウント時はデフォルト値に戻す。
  useEffect(() => {
    if (!post) return;

    const values = {
      'meta[name="keywords"]': post.tags.join(", "),
      'meta[property="og:title"]': post.title,
      'meta[property="og:description"]': post.description,
      'meta[property="og:url"]': postUrl,
      'meta[property="og:image"]': postImageUrl,
      'meta[name="twitter:title"]': post.title,
      'meta[name="twitter:description"]': post.description,
      'meta[name="twitter:image"]': postImageUrl,
    };

    Object.entries(values).forEach(([selector, value]) => {
      document.querySelector(selector)?.setAttribute("content", value);
    });

    return () => {
      Object.entries(DEFAULT_META).forEach(([selector, value]) => {
        document.querySelector(selector)?.setAttribute("content", value);
      });
    };
  }, [post, postUrl, postImageUrl]);

  if (loading) {
    return (
      <div className="blog-post-container">
        <div className="loading">
          <div className="spinner"></div>
          <p>記事を読み込み中...</p>
        </div>
      </div>
    );
  }

  if (error || !post) {
    return (
      <div className="blog-post-container">
        <div className="error">
          <h2>エラー</h2>
          <p>{error || "記事が見つかりません"}</p>
          <Link to="/blog" className="back-button">
            ← ブログ一覧に戻る
          </Link>
        </div>
      </div>
    );
  }

  const url = postUrl;
  const imageUrl = postImageUrl;

  return (
    <>
      {/* Basic Meta Tags */}
      {/* keywords/OGP/Twitterカードはindex.htmlの静的タグをuseEffectで直接書き換えている（DEFAULT_META参照） */}
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

      {/* BreadcrumbList Structured Data */}
      <script type="application/ld+json">
        {JSON.stringify({
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [
            {
              "@type": "ListItem",
              position: 1,
              name: "ホーム",
              item: "https://www.boat-ai.jp/",
            },
            {
              "@type": "ListItem",
              position: 2,
              name: "ブログ",
              item: "https://www.boat-ai.jp/blog",
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
          <Link to="/blog" className="back-link">
            ← ブログ一覧に戻る
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
            <h2>📌 関連記事</h2>
            <div className="related-grid">
              {relatedPosts.map((relatedPost) => (
                <Link
                  key={relatedPost.id}
                  to={`/blog/${relatedPost.id}`}
                  className="related-card"
                >
                  <span className="category-badge">{relatedPost.category}</span>
                  <h3>{relatedPost.title}</h3>
                  <p>{relatedPost.description}</p>
                  <span className="read-more">続きを読む →</span>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* CTA */}
        <div className="post-cta">
          <h3>🚀 今すぐBoatAI予想を試してみる</h3>
          <p>完全無料でAI予想を確認できます</p>
          <button onClick={() => navigate("/")} className="cta-button">
            AI予想を見る
          </button>
        </div>
      </div>
    </>
  );
}
