/**
 * ブログ記事の英語版メタデータ。
 * 本文は public/blog/{id}-en.md、日本語版メタデータは blogPosts.js の該当 id と対応する。
 * date/image 等、翻訳不要なフィールドは blogPosts.js 側の値をそのまま使う想定のため持たない。
 * 詳細: docs/design/blog-i18n/spec.md, docs/adr/0006-blog-english-metadata-storage.md
 */
export const blogPostsEn = [
  {
    id: "winning-technique-analysis-guide",
    title:
      "What Is Winning-Technique Analysis? A New Way to See Win Patterns by Venue and Lane",
    description:
      "A new feature analyzing which winning technique (wire-to-wire, inside pass, outside overtake, etc.) led to 1st place, broken down by venue and lane, using 90 days of race data. Learn how to use it as evidence for picks or exclusions.",
    category: "Data Analysis",
    tags: [
      "WinningTechnique",
      "NewFeature",
      "DataAnalysis",
      "Evidence",
      "ByVenue",
    ],
    readTime: "7 min",
  },
  {
    id: "motor-condition-guide",
    title:
      "What Is Motor Condition? A New Way to See Today's 2nd-Place Rate by Lane",
    description:
      "A new feature showing each boat's motor 2nd- and 3rd-place rate for today's races, just by selecting the race. Designed to be directly usable for real betting decisions, not just an abstract motor ranking.",
    category: "Data Analysis",
    tags: [
      "Motor",
      "NewFeature",
      "DataAnalysis",
      "Evidence",
      "SecondPlaceRate",
    ],
    readTime: "7 min",
  },
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
