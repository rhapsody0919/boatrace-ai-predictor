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
    id: "ai-prediction-accuracy-review",
    title:
      "Does Boat Racing AI Prediction Really Hit? — Results from 3 Months and 15,000 Races",
    description:
      "We audited AI prediction hit rate and return rate across 15,000 races. An honest look at each model's strengths and weaknesses, how BoatAI differs from other services, and where AI prediction falls short.",
    category: "Data Analysis",
    tags: [
      "AIPrediction",
      "HitRate",
      "ReturnRate",
      "Verification",
      "Transparency",
    ],
    readTime: "10 min",
  },
  {
    id: "night-race-strategy",
    title:
      "Night Race Strategy — 5 Differences from Daytime Races, Backed by Data",
    description:
      "Data-driven breakdown of 5 defining features of night races — temperature changes, stable water, rising inside win rate — plus strategy tips for each night-race venue.",
    category: "Strategy",
    tags: ["NightRace", "Strategy", "Gamagori", "Marugame", "Omura", "Motor"],
    readTime: "9 min",
  },
  {
    id: "sg-race-guide-2026",
    title:
      "The Complete 2026 SG Race Guide — Each Race's Character and Betting Strategy",
    description:
      "A breakdown of all 8 SG races in 2026 — their character and betting strategy, from the Prime Minister's Cup to the Grand Prix, plus what makes predicting SG races different and how to use BoatAI for them.",
    category: "Advanced",
    tags: ["SG", "GrandPrix", "AllStar", "GradeRaces", "2026"],
    readTime: "10 min",
  },
  {
    id: "how-to-predict-races",
    title:
      "The Complete Guide to Predicting Boat Races — Raise Your Hit Rate with Data and AI",
    description:
      "The 6 key factors in boat race prediction, explained with data from over 10,000 races. A beginner-friendly guide to reading racer win rate, motors, lanes, ST, exhibition runs, and weather — plus how to use AI prediction.",
    category: "Beginner",
    tags: [
      "Predictions",
      "Tips",
      "HitRate",
      "Beginner",
      "AIPrediction",
      "DataAnalysis",
    ],
    readTime: "12 min",
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
