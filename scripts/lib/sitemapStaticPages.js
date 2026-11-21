// generate-sitemap.js から字のまま移した、静的ページの表（日本語の URL・lastmod の出所・changefreq・priority）。読むだけ。
// verify-sitemap-coverage.js が AppRouter.jsx の静的ルートと突き合わせる（generate-sitemap.js が同じ名で re-export する）

// 静的ページの定義
export const staticPages = [
  {
    loc: "/",
    lastmodFrom: "raceData",
    changefreq: "daily",
    priority: "1.0",
  },
  {
    loc: "/accuracy",
    lastmodFrom: "raceData",
    changefreq: "daily",
    priority: "0.9",
  },
  {
    loc: "/hit-races",
    lastmodFrom: "raceData",
    changefreq: "daily",
    priority: "0.9",
  },
  {
    loc: "/about",
    changefreq: "monthly",
    priority: "0.8",
  },
  {
    loc: "/faq",
    changefreq: "monthly",
    priority: "0.8",
  },
  {
    loc: "/how-to-use",
    changefreq: "monthly",
    priority: "0.9",
  },
  {
    loc: "/privacy",
    changefreq: "yearly",
    priority: "0.3",
  },
  {
    loc: "/terms",
    changefreq: "yearly",
    priority: "0.3",
  },
  {
    loc: "/contact",
    changefreq: "monthly",
    priority: "0.5",
  },
  {
    loc: "/blog",
    lastmodFrom: "blogIndex",
    changefreq: "weekly",
    priority: "0.7",
  },
  {
    loc: "/races",
    lastmodFrom: "raceData",
    changefreq: "daily",
    priority: "0.9",
  },
  {
    loc: "/guide",
    changefreq: "monthly",
    priority: "0.8",
  },
  {
    loc: "/responsible-gambling",
    changefreq: "yearly",
    priority: "0.5",
  },
  {
    loc: "/profile",
    changefreq: "monthly",
    priority: "0.5",
  },
  {
    loc: "/accuracy/history",
    lastmodFrom: "raceData",
    changefreq: "daily",
    priority: "0.8",
  },
  {
    loc: "/winning-technique",
    lastmodFrom: "raceData",
    changefreq: "daily",
    priority: "0.8",
  },
  {
    // 「本日のデータ一覧」（BOA-402）。単一URLで毎日中身を差し替える。
    // 日付別URL（/today/YYYY-MM-DD）は発行しない（ADR-0070の背景・spec §3）
    loc: "/today",
    lastmodFrom: "raceData",
    changefreq: "daily",
    priority: "0.8",
  },
  {
    loc: "/racers",
    changefreq: "weekly",
    priority: "0.7",
  },
  // 会場別レース一覧（本日、/venue/1〜24。venue-list-redesign）
  ...Array.from({ length: 24 }, (_, i) => ({
    loc: `/venue/${i + 1}`,
    lastmodFrom: "venueRaceData",
    venueCode: i + 1,
    changefreq: "daily",
    priority: "0.7",
  })),
];
