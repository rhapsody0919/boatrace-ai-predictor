import React, { useState, useEffect } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { getPostById, getRelatedPosts } from "../data/blogPosts";
import Header from "../components/Header";
import { useSocialMeta } from "../hooks/useSocialMeta";
import { extractFaqItems, buildFaqPageSchema } from "../utils/blogFaqSchema";
import "./BlogPost.css";

export default function BlogPost() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const post = getPostById(id);
  const relatedPosts = getRelatedPosts(id, 3);

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
