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
      "We audited AI prediction hit rate and return rate across 15,000 races. An honest look at its strengths and weaknesses, how BoatAI differs from other services, and where AI prediction falls short.",
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
    id: "trifecta-betting-guide",
    title:
      "The Complete Guide to Trifecta Betting — From Narrowing Combinations to Allocating Your Bankroll",
    description:
      "How to raise your Trifecta return rate: picking your anchor, choosing between formation and box betting, return-rate data by combination count, and how to think about bankroll allocation.",
    category: "Strategy",
    tags: [
      "Trifecta",
      "HowToBet",
      "Formation",
      "BankrollManagement",
      "BettingTickets",
    ],
    readTime: "10 min",
    image: "/images/blog/trifecta-formation-matrix-en.jpg",
  },
  {
    id: "improve-recovery-rate",
    title:
      "How to Push Your Boat Racing Return Rate Above 100% — The Reality Shown by 10,000+ Races",
    description:
      "5 data-backed strategies for clearing the 25% deduction wall — race selection, bet-type choice, combination discipline, bankroll management, and using AI. Includes BoatAI's real 104% return rate results.",
    category: "Strategy",
    tags: [
      "ReturnRate",
      "HowToWin",
      "BankrollManagement",
      "DataAnalysis",
      "DeductionRate",
    ],
    readTime: "10 min",
  },
  {
    id: "beginners-start-guide",
    title:
      "The Beginner's Guide to Getting Started with Boat Racing — From Buying a Ticket to Using AI Predictions",
    description:
      "A complete guide for anyone wanting to start boat racing — basic rules, all 7 bet types explained, how to register for TELEBOAT, beginner-friendly betting approaches, and how to think about your budget.",
    category: "Beginner",
    tags: [
      "Beginner",
      "GettingStarted",
      "BettingTickets",
      "TELEBOAT",
      "Introduction",
    ],
    readTime: "10 min",
  },
  {
    id: "first-mark-prediction-guide",
    title:
      "What Are First-Mark Turn Predictions? How AI Reads the Way a Race Unfolds",
    description:
      "A full breakdown of BoatAI's turn prediction feature — how it statistically forecasts the first-mark turn from each racer's winning-technique distribution, ST, and motor performance, and how to use it in your betting strategy.",
    category: "How-To",
    tags: [
      "TurnPrediction",
      "FirstMark",
      "WinningTechnique",
      "AIPrediction",
      "HowTo",
    ],
    readTime: "10 min",
    image: "/images/blog/first-mark-kimarite-donut-en.jpg",
  },
  {
    id: "picks-performance-report",
    title:
      '"Today\'s Picks" Hits a 104% Return Rate — Real Results from 2,577 Races',
    description:
      "BoatAI's \"Today's Picks\" feature recorded a 104% return rate across 2,577 races. An honest look at how it overcomes the 25% deduction rate to stay net-positive — including its real limitations.",
    category: "Track Record",
    tags: ["TodaysPicks", "ReturnRate", "DataMining", "TrackRecord"],
    readTime: "7 min",
  },
  {
    id: "venue-visit-guide",
    title:
      "The Complete Guide to Enjoying a Boat Racing Venue — Get 120% Out of Your First Visit",
    description:
      "Boat racing venues are more than just betting windows — ¥100 admission, local food specialties, night races, even a good date spot. A complete guide covering what to bring, budgeting, and beginner tips for a 120% on-site experience.",
    category: "Beginner",
    tags: [
      "BoatRacingVenue",
      "HowToEnjoy",
      "Beginner",
      "Food",
      "NightRace",
      "VisitGuide",
    ],
    readTime: "12 min",
    image: "/images/blog/venue-visit-timeline-en.jpg",
  },
  {
    id: "picks-guide",
    title:
      'How to Use "Today\'s Picks" — High-Return Races Selected by Data Mining',
    description:
      "A full breakdown of BoatAI's \"Today's Picks\" feature — how data mining across 15 venues and 34 patterns automatically surfaces races with a 100%+ return rate, how to read the screen, and how to use it by bet type.",
    category: "How-To",
    tags: [
      "TodaysPicks",
      "DataMining",
      "ReturnRate",
      "HowTo",
      "PatternMatching",
    ],
    readTime: "8 min",
  },
  {
    id: "10000-races-analysis",
    title:
      "BoatAI Passes 10,000 Races — What the Data Says About AI Prediction's Strengths and Limits",
    description:
      "BoatAI's cumulative analyzed race count passed 10,000. An honest look at what 12,324 races reveal — a 47.4% Win hit rate, an 18.0% Trio hit rate, and the real challenges around return rate.",
    category: "Track Record",
    tags: [
      "10000Races",
      "TrackRecordAnalysis",
      "HitRate",
      "ReturnRate",
      "Trio",
      "DataDisclosure",
    ],
    readTime: "10 min",
  },
  {
    id: "suji-funaken-guide",
    title:
      'What Is a "Suji" Bet? A Quick-Reference Guide to Venue-Specific Patterns',
    description:
      "A quick-reference guide to basic suji betting patterns — inside wire-to-wire, overtake, and inside-pass combinations, how to spot against-the-suji results, and venue tendencies from Omura and Ashiya to Toda and Edogawa.",
    category: "Strategy",
    tags: [
      "SujiBetting",
      "BettingStrategy",
      "RaceDevelopment",
      "Overtake",
      "InsidePass",
      "WireToWire",
    ],
    readTime: "12 min",
  },
  {
    id: "sg-g1-race-strategy",
    title: "Strategy for Winning SG and G1 Races [Cracking Grade Races]",
    description:
      "SG and G1 grade races are a different game from regular races. How to bet differently in qualifying vs. the final, how to use the points average, and how to target the Dream Race.",
    category: "Advanced",
    tags: ["SG", "G1", "GradeRaces", "Strategy", "PointsAverage"],
    readTime: "12 min",
  },
  {
    id: "special-planned-races",
    title:
      'What Are "Planned Races"? Why They\'re Great for Beginners [How to Spot a Solid Race]',
    description:
      "Planned races, like a lane-1-Class-A-fixed lineup, are easy for beginners to predict. A detailed guide to the types of planned races, how to spot them, and how to bet on them.",
    category: "Beginner",
    tags: ["PlannedRaces", "Beginner", "Lane1", "ClassA", "SolidRace"],
    readTime: "9 min",
  },
  {
    id: "venue-ashiya",
    title:
      "Ashiya Boat Race Venue Strategy Guide — One of Japan's Strongest Inside-Favoring Venues",
    description:
      "Ashiya boat racing venue's character and strategy, with BoatAI track record data. One of Japan's strongest inside-favoring venues.",
    category: "Venue Strategy",
    tags: ["Ashiya", "BoatRacingVenue", "Strategy", "StrongInside"],
    readTime: "5 min",
  },
  {
    id: "how-we-measure-accuracy",
    title:
      "Is BoatAI's Track Record Real? A Full Breakdown of How We Measure It and Why It's Transparent",
    description:
      "How does BoatAI actually measure its hit rate and return rate? Why does it publish all the data? A full breakdown of the reliability and transparency behind BoatAI's track record.",
    category: "Data Analysis",
    tags: [
      "TrackRecord",
      "HitRate",
      "ReturnRate",
      "Transparency",
      "Measurement",
    ],
    readTime: "12 min",
  },
  {
    id: "ai-vs-human",
    title:
      "AI vs. Human Predictions — A 1-Month Head-to-Head Test [Data Published]",
    description:
      "Which hits more — AI-picked tickets or human-picked tickets? We ran a real head-to-head test throughout December 2025 to find out.",
    category: "Data Analysis",
    tags: ["AIPrediction", "Verification", "Data", "Comparison"],
    readTime: "11 min",
  },
  {
    id: "rough-race-signals",
    title:
      "5 Signals That Predict a Volatile Boat Race — Discovered by AI Across 1,899 Races",
    description:
      "Being able to sense a volatile race changes your betting strategy. BoatAI analyzed 1,899 races and found 5 signals shared by races that turn volatile.",
    category: "Beginner",
    tags: ["VolatileRace", "Prediction", "Signals", "HowToSpot"],
    readTime: "10 min",
  },
  {
    id: "stadium-strategy-guide",
    title:
      "The Venue-by-Venue Strategy Guide — All 24 Venues' Character and What to Target",
    description:
      "Winning patterns differ completely from venue to venue. A complete guide to all 24 boat racing venues' character, lane-1 win rate, and which favor the inside vs. the outside.",
    category: "Strategy",
    tags: ["BoatRacingVenue", "Strategy", "Character", "Lane1WinRate"],
    readTime: "15 min",
  },
  {
    id: "monthly-50k-roadmap",
    title:
      "A Roadmap to Earning ¥50,000/Month in Side Income from Boat Racing [Built for Repeatability]",
    description:
      "A bankroll-management approach for targeting ¥50,000/month, and how to use BoatAI's data analysis to guide your betting.",
    category: "Strategy",
    tags: ["BoatRacing", "BankrollManagement", "50KPerMonth", "UsingData"],
    readTime: "12 min",
  },
  {
    id: "why-you-lose",
    title:
      "5 Traits Shared by People Who Lose at Boat Racing — And How AI Prediction Fixes Them",
    description:
      "Why can't you win at boat racing? The losing patterns revealed by analyzing 1,899 races, and how AI prediction fixes them.",
    category: "Beginner",
    tags: ["BoatRacing", "AIPrediction", "CantWin", "LosingPattern"],
    readTime: "10 min",
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
    image: "/images/blog/odds-expected-value-matrix-en.jpg",
  },
];

export function getEnglishOverride(id) {
  return blogPostsEn.find((post) => post.id === id);
}

export function isEnglishAvailable(id) {
  return blogPostsEn.some((post) => post.id === id);
}
