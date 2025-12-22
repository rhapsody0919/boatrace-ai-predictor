import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { blogPosts, categories, getFeaturedPosts } from '../data/blogPosts';
import './Blog.css';

export default function Blog() {
  const [selectedCategory, setSelectedCategory] = useState('all');
  const featuredPosts = getFeaturedPosts();

  const filteredPosts = selectedCategory === 'all'
    ? blogPosts
    : blogPosts.filter(post => post.category === selectedCategory);

  const sortedPosts = [...filteredPosts].sort((a, b) =>
    new Date(b.date) - new Date(a.date)
  );

  return (
    <div className="blog-container">
      <Helmet>
        <title>ブログ | BoatAI - 競艇予想・データ分析・戦略情報</title>
        <meta name="description" content="競艇予想、データ分析、舟券戦略に関する最新情報を発信。初心者向けの基本知識から、上級者向けの高度な戦略まで幅広くカバーしています。" />
        <meta name="keywords" content="競艇ブログ,予想戦略,データ分析,舟券購入,AI予想,勝ち方" />
        <link rel="canonical" href="https://boat-ai.jp/blog" />

        {/* OGP Tags */}
        <meta property="og:type" content="website" />
        <meta property="og:title" content="BoatAI ブログ | 競艇予想・戦略情報" />
        <meta property="og:description" content="競艇予想、データ分析、舟券戦略に関する最新情報を発信中。" />
        <meta property="og:url" content="https://boat-ai.jp/blog" />
        <meta property="og:image" content="https://boat-ai.jp/ogp-image.png" />

        {/* BreadcrumbList */}
        <script type="application/ld+json">
          {JSON.stringify({
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            "itemListElement": [
              {
                "@type": "ListItem",
                "position": 1,
                "name": "ホーム",
                "item": "https://boat-ai.jp/"
              },
              {
                "@type": "ListItem",
                "position": 2,
                "name": "ブログ",
                "item": "https://boat-ai.jp/blog"
              }
            ]
          })}
        </script>
      </Helmet>

      <div className="blog-header">
        <h1>📚 BoatAI ブログ</h1>
        <p>競艇予想・データ分析・戦略に関する情報を発信しています</p>
      </div>

      {/* Featured Posts */}
      {selectedCategory === 'all' && featuredPosts.length > 0 && (
        <section className="featured-section">
          <h2>🌟 注目記事</h2>
          <div className="featured-grid">
            {featuredPosts.map(post => (
              <Link
                key={post.id}
                to={`/blog/${post.id}`}
                className="featured-card"
              >
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
          className={selectedCategory === 'all' ? 'active' : ''}
          onClick={() => setSelectedCategory('all')}
        >
          すべて
        </button>
        {categories.map(category => (
          <button
            key={category}
            className={selectedCategory === category ? 'active' : ''}
            onClick={() => setSelectedCategory(category)}
          >
            {category}
          </button>
        ))}
      </div>

      {/* Blog Posts Grid */}
      <div className="blog-grid">
        {sortedPosts.map(post => (
          <Link
            key={post.id}
            to={`/blog/${post.id}`}
            className="blog-card"
          >
            <div className="blog-card-content">
              <span className="category-badge">{post.category}</span>
              <h3>{post.title}</h3>
              <p className="description">{post.description}</p>
              <div className="meta">
                <span className="date">{post.date}</span>
                <span className="read-time">📖 {post.readTime}</span>
              </div>
              <div className="tags">
                {post.tags.map(tag => (
                  <span key={tag} className="tag">#{tag}</span>
                ))}
              </div>
            </div>
          </Link>
        ))}
      </div>

      {filteredPosts.length === 0 && (
        <div className="no-posts">
          <p>このカテゴリの記事はまだありません。</p>
        </div>
      )}
    </div>
  );
}
