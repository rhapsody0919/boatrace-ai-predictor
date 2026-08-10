/**
 * ブログ記事の英語版メタデータ。
 * 本文は public/blog/{id}-en.md、日本語版メタデータは blogPosts.js の該当 id と対応する。
 * date/image 等、翻訳不要なフィールドは blogPosts.js 側の値をそのまま使う想定のため持たない。
 * 詳細: docs/design/blog-i18n/spec.md, docs/adr/0006-blog-english-metadata-storage.md
 */
export const blogPostsEn = [
  {
    id: "odds-expected-value-guide",
    title: "How Odds Work in Boat Racing — Choosing Bets by Expected Value",
    description:
      "How boat racing odds work and how to think in expected value, explained with data — the overpopularity trap, targeting odds distortions, and break-even odds by bet type.",
    category: "Data Analysis",
    tags: [
      "Odds",
      "ExpectedValue",
      "Overpopularity",
      "BettingStrategy",
      "DataAnalysis",
    ],
    readTime: "9 min",
  },
];

export function getEnglishOverride(id) {
  return blogPostsEn.find((post) => post.id === id);
}

export function isEnglishAvailable(id) {
  return blogPostsEn.some((post) => post.id === id);
}
