import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  SUPPORTED_LANGUAGES,
  DEFAULT_LANGUAGE,
  localizePath,
  parseLangFromPath,
  getAvailableLanguages,
} from "../src/config/languages.js";
import { VENUE_GUIDES_EN } from "../src/data/venueGuidesEn.js";
import {
  isRacerIndexable,
  RACER_INDEX_ACTIVE_DAYS,
} from "../src/utils/racerIndexPolicy.js";
import { getDaysAgoJST } from "../src/utils/dateUtils.js";
import { VENUE_REGIONS } from "../src/data/venueRegions.js";
import { VENUE_GUIDES_ZH_TW } from "../src/data/venueGuidesZhTw.js";
import { VENUE_GUIDES_KO } from "../src/data/venueGuidesKo.js";
import { blogPostsEn } from "../src/data/blogPostsEn.js";
import { blogPostsZhTw } from "../src/data/blogPostsZhTw.js";
import { blogPostsKo } from "../src/data/blogPostsKo.js";
import { blogPosts as blogPostsJa } from "../src/data/blogPosts.js";
import {
  gitLastCommitDate,
  laterDate,
  renderUrlEntry,
} from "./lib/sitemapLastmod.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SITE_URL = "https://www.boat-ai.jp";
const PUBLIC_DIR = path.join(__dirname, "../public");
const BLOG_DIR = path.join(PUBLIC_DIR, "blog");

// 静的ページの定義
const staticPages = [
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
  // 個別レース詳細（/race/:raceId）は1日最大288件の細粒度動的ページで
  // 検索需要が見込めず、クロールバジェット浪費（BOA-84の教訓）を避けるため
  // sitemap非対象とする（docs/adr/0026参照）
  ...Array.from({ length: 24 }, (_, i) => ({
    loc: `/venue/${i + 1}`,
    lastmodFrom: "venueRaceData",
    venueCode: i + 1,
    changefreq: "daily",
    priority: "0.7",
  })),
];

// 全言語で翻訳提供済みのページ（デフォルト言語以外の各言語 URL を登録。未翻訳の blog 等は含めない）
const LOCALIZED_PAGES = [
  {
    basePath: "/",
    changefreq: "daily",
    priority: "0.9",
    lastmodFrom: "raceData",
  },
  { basePath: "/guide", changefreq: "monthly", priority: "0.8" },
  {
    basePath: "/winning-technique",
    changefreq: "daily",
    priority: "0.8",
    lastmodFrom: "raceData",
  },
  // 会場別レース一覧（本日）は4言語対応（venue-list-redesign）
  ...Array.from({ length: 24 }, (_, i) => ({
    basePath: `/venue/${i + 1}`,
    changefreq: "daily",
    priority: "0.6",
    lastmodFrom: "venueRaceData",
    venueCode: i + 1,
  })),
];

// blogPostsXx.js にエントリはあるが対応する -{suffix}.md が存在しない場合、sitemapが
// 実体の無いURLを配信してしまう（code-reviewで発見: エントリ追加と-en.md作成が
// 別PRになるケースを想定した検知）。生成時に警告のみ出し、処理は止めない
const BLOG_TRANSLATION_CHECKS = [
  { label: "blogPostsEn.js", posts: blogPostsEn, mdSuffix: "-en" },
  { label: "blogPostsZhTw.js", posts: blogPostsZhTw, mdSuffix: "-zh-tw" },
  { label: "blogPostsKo.js", posts: blogPostsKo, mdSuffix: "-ko" },
];
BLOG_TRANSLATION_CHECKS.forEach(({ label, posts, mdSuffix }) => {
  posts.forEach((post) => {
    const mdPath = path.join(BLOG_DIR, `${post.id}${mdSuffix}.md`);
    if (!fs.existsSync(mdPath)) {
      console.warn(
        `⚠️ ${label} に "${post.id}" のエントリがありますが public/blog/${post.id}${mdSuffix}.md が見つかりません`,
      );
    }
  });
});

// 特定言語にのみ存在するページ（会場別ビジターガイド: 英語版 BOA-133 / 繁体字版 BOA-134）
const LANGUAGE_ONLY_PAGES = {
  en: [
    ...["", ...VENUE_GUIDES_EN.map((v) => v.slug)].map((slug) => ({
      basePath: slug ? `/venues/${slug}` : "/venues",
      changefreq: "monthly",
      priority: "0.7",
    })),
    // 会場が1件も無い地域ハブは実際には/venuesへリダイレクトされるため、sitemapには含めない
    ...VENUE_REGIONS.filter((r) =>
      VENUE_GUIDES_EN.some((v) => v.regionGroup === r.slug),
    ).map((r) => ({
      basePath: `/venues/region/${r.slug}`,
      changefreq: "monthly",
      priority: "0.6",
    })),
    // ブログはja専用が原則だが、featured記事の一部のみ英語版を用意している
    // （languages.js の PARTIALLY_TRANSLATED_PATHS 参照）。記事リストは
    // blogPostsEn.js から動的に生成し、新規記事追加時の登録漏れを防ぐ
    {
      basePath: "/blog",
      changefreq: "weekly",
      priority: "0.6",
      lastmodFrom: "blogIndex",
    },
    ...blogPostsEn.map((post) => ({
      basePath: `/blog/${post.id}`,
      changefreq: "monthly",
      priority: "0.6",
      lastmodFrom: "blogPost",
      postId: post.id,
    })),
  ],
  "zh-TW": [
    ...["", ...VENUE_GUIDES_ZH_TW.map((v) => v.slug)].map((slug) => ({
      basePath: slug ? `/venues/${slug}` : "/venues",
      changefreq: "monthly",
      priority: "0.7",
    })),
    // 会場が1件も無い地域ハブは実際には/venuesへリダイレクトされるため、sitemapには含めない
    ...VENUE_REGIONS.filter((r) =>
      VENUE_GUIDES_ZH_TW.some((v) => v.regionGroup === r.slug),
    ).map((r) => ({
      basePath: `/venues/region/${r.slug}`,
      changefreq: "monthly",
      priority: "0.6",
    })),
    // ブログはfeatured記事の一部のみzh-TW版を展開中。languages.jsの
    // getAvailableLanguages("/blog")は記事が1件も無い言語では一覧ページ自体を
    // 未提供と判定するため、それと矛盾しないよう記事0件の間は一覧ページも含めない
    ...(blogPostsZhTw.length > 0
      ? [
          {
            basePath: "/blog",
            changefreq: "weekly",
            priority: "0.6",
            lastmodFrom: "blogIndex",
          },
          ...blogPostsZhTw.map((post) => ({
            basePath: `/blog/${post.id}`,
            changefreq: "monthly",
            priority: "0.6",
            lastmodFrom: "blogPost",
            postId: post.id,
          })),
        ]
      : []),
  ],
  ko: [
    ...["", ...VENUE_GUIDES_KO.map((v) => v.slug)].map((slug) => ({
      basePath: slug ? `/venues/${slug}` : "/venues",
      changefreq: "monthly",
      priority: "0.7",
    })),
    // 会場が1件も無い地域ハブは実際には/venuesへリダイレクトされるため、sitemapには含めない
    ...VENUE_REGIONS.filter((r) =>
      VENUE_GUIDES_KO.some((v) => v.regionGroup === r.slug),
    ).map((r) => ({
      basePath: `/venues/region/${r.slug}`,
      changefreq: "monthly",
      priority: "0.6",
    })),
    // ブログはfeatured記事の一部のみko版を展開中。languages.jsの
    // getAvailableLanguages("/blog")は記事が1件も無い言語では一覧ページ自体を
    // 未提供と判定するため、それと矛盾しないよう記事0件の間は一覧ページも含めない
    ...(blogPostsKo.length > 0
      ? [
          {
            basePath: "/blog",
            changefreq: "weekly",
            priority: "0.6",
            lastmodFrom: "blogIndex",
          },
          ...blogPostsKo.map((post) => ({
            basePath: `/blog/${post.id}`,
            changefreq: "monthly",
            priority: "0.6",
            lastmodFrom: "blogPost",
            postId: post.id,
          })),
        ]
      : []),
  ],
};

// デフォルト言語以外の言語別ページを生成
const localizedPages = SUPPORTED_LANGUAGES.filter(
  ({ code }) => code !== DEFAULT_LANGUAGE,
).flatMap(({ code }) =>
  [...LOCALIZED_PAGES, ...(LANGUAGE_ONLY_PAGES[code] ?? [])].map(
    ({ basePath, ...rest }) => ({
      ...rest,
      loc: localizePath(basePath, code),
      lang: code,
    }),
  ),
);

const JA_POST_DATE = new Map(blogPostsJa.map((p) => [p.id, p.date ?? null]));
const BLOG_MD_SUFFIX = { en: "-en", "zh-TW": "-zh-tw", ko: "-ko" };

// 記事の lastmod。md の最終コミット日（本文の修正を拾う）と、記事データの日付
// （公開日）の新しいほう。md は frontmatter を持たず、以前は mtime を使っていたため、
// CI の checkout 時刻＝毎日の生成日になっていた（BOA-599）
function blogLastmod(id, mdSuffix) {
  return laterDate(
    gitLastCommitDate(path.join(BLOG_DIR, `${id}${mdSuffix}.md`)),
    JA_POST_DATE.get(id) ?? null,
  );
}

// ブログ記事のスキャン
function getBlogPosts() {
  const blogPosts = [];

  if (!fs.existsSync(BLOG_DIR)) {
    console.warn("Blog directory not found:", BLOG_DIR);
    return blogPosts;
  }

  const files = fs.readdirSync(BLOG_DIR);

  files.forEach((file) => {
    if (!file.endsWith(".md")) return;
    // 英語版・zh-TW版等の言語別mdファイルはja版sitemapの対象外（LANGUAGE_ONLY_PAGESで別途登録する）
    const isTranslatedBlogFile = BLOG_TRANSLATION_CHECKS.some(({ mdSuffix }) =>
      file.endsWith(`${mdSuffix}.md`),
    );
    if (isTranslatedBlogFile) return;

    const slug = file.replace(".md", "");
    const lastmod = blogLastmod(slug, "");
    // 週次レポートは優先度を下げる
    const isWeeklyReport = slug.startsWith("weekly-report-");
    const priority = isWeeklyReport ? "0.5" : "0.6";

    blogPosts.push({
      loc: `/blog/${slug}`,
      lastmod,
      changefreq: "monthly",
      priority,
    });
  });

  return blogPosts;
}

// 直近7日分のレースページをSupabaseから取得
// 過去の日別レースページ（/races/YYYY-MM-DD）は検索需要がほぼゼロで大半が未インデックスのまま
// クロールバジェットを消費していたため、直近7日分のみに限定する（BOA-84）
async function getRacePages() {
  const racePages = [];

  try {
    const { supabase, isSupabaseEnabled } =
      await import("./lib/supabaseClient.js");
    if (!isSupabaseEnabled()) {
      console.warn("⚠️ Supabase未設定のため、レースページはスキップします");
      return racePages;
    }

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 7);
    const cutoffStr = cutoff.toISOString().split("T")[0];

    const { data, error } = await supabase
      .from("races")
      .select("race_date, venue_code")
      .gte("race_date", cutoffStr)
      .order("race_date", { ascending: false });
    if (error) throw new Error(error.message);

    const uniqueDates = [...new Set((data ?? []).map((r) => r.race_date))];

    for (const dateStr of uniqueDates) {
      racePages.push({
        loc: `/races/${dateStr}`,
        lastmod: dateStr,
        changefreq: "weekly",
        priority: "0.8",
      });
    }

    // 会場別レース一覧（過去日付、/races/:date/:venueCode）も日付と同じ
    // 直近7日ウィンドウで登録する（venue-list-redesign、docs/adr/0026参照）
    const dateVenuePairs = [
      ...new Set((data ?? []).map((r) => `${r.race_date}/${r.venue_code}`)),
    ];
    for (const pair of dateVenuePairs) {
      const [dateStr] = pair.split("/");
      racePages.push({
        loc: `/races/${pair}`,
        lastmod: dateStr,
        changefreq: "weekly",
        priority: "0.6",
      });
    }

    console.log(
      `📊 Supabase から直近7日分のレースデータを取得（${uniqueDates.length}日分・会場別${dateVenuePairs.length}件）`,
    );
  } catch (err) {
    console.error("レースページ取得エラー:", err.message);
  }

  return racePages;
}

// 選手個別ページ（/racer/:racerId）を取得
// 対象はページ側の noindex 判定（RacerProfile.jsx）と同じ isRacerIndexable（src/utils/racerIndexPolicy.js）:
// ニュースがある選手、または現役の A1 選手（最新の出走が A1 で直近30日以内。集客レーン、2026-10-02）。
// lastmod は、ニュースの最新日と最新の出走日の新しい方（ページの中身が変わった日）
async function getRacerPages() {
  const racerPages = [];

  try {
    const { supabase, isSupabaseEnabled } =
      await import("./lib/supabaseClient.js");
    if (!isSupabaseEnabled()) {
      console.warn("⚠️ Supabase未設定のため、選手ページはスキップします");
      return racerPages;
    }

    const { fetchAll } = await import("./lib/supabaseClient.js");
    const activeSince = getDaysAgoJST(RACER_INDEX_ACTIVE_DAYS);

    const { data, error } = await supabase
      .from("racer_news")
      .select("racer_id, created_at");
    if (error) throw new Error(error.message);
    const newsDateByRacerId = new Map();
    for (const row of data ?? []) {
      const date = row.created_at.slice(0, 10);
      const current = newsDateByRacerId.get(row.racer_id);
      if (!current || date > current) newsDateByRacerId.set(row.racer_id, date);
    }

    // 直近の出走（race_id は YYYY-MM-DD-VV-RR なので、文字列の比較で日付の範囲を絞れる）。
    // 選手ごとに最新の出走の級と開催日を取る（ページ側の getLatestEntry と同じ「最新の出走」）
    const entries = await fetchAll(
      "race_entries",
      "racer_id, grade, race_id",
      (q) =>
        q
          .gte("race_id", activeSince)
          .not("racer_id", "is", null)
          .order("race_id")
          .order("boat_number"),
    );
    const latestByRacerId = new Map();
    for (const row of entries) {
      const current = latestByRacerId.get(row.racer_id);
      if (!current || row.race_id > current.race_id) {
        latestByRacerId.set(row.racer_id, row);
      }
    }

    const racerIds = new Set([
      ...newsDateByRacerId.keys(),
      ...latestByRacerId.keys(),
    ]);
    let byNews = 0;
    let byGrade = 0;
    for (const racerId of racerIds) {
      const latest = latestByRacerId.get(racerId);
      const latestRaceDate = latest ? latest.race_id.slice(0, 10) : null;
      const hasNews = newsDateByRacerId.has(racerId);
      if (
        !isRacerIndexable({
          hasNews,
          latestGrade: latest?.grade ?? null,
          latestRaceDate,
          activeSince,
        })
      ) {
        continue;
      }
      if (hasNews) byNews += 1;
      else byGrade += 1;
      const lastmod = [newsDateByRacerId.get(racerId), latestRaceDate]
        .filter(Boolean)
        .sort()
        .at(-1);
      racerPages.push({
        loc: `/racer/${racerId}`,
        lastmod,
        changefreq: "weekly",
        priority: "0.5",
      });
    }
    racerPages.sort((a, b) => a.loc.localeCompare(b.loc));

    console.log(
      `📊 Supabase から選手ページを取得（${racerPages.length}人: ニュース掲載 ${byNews}人・現役A1 ${byGrade}人）`,
    );
  } catch (err) {
    console.error("選手ページ取得エラー:", err.message);
  }

  return racerPages;
}

// 開催日（JSTの今日以前で最新）。全体と会場別。取れなければ null（lastmod を出さない）
async function getLatestRaceDates() {
  const result = { overall: null, byVenue: new Map() };
  try {
    const { supabase, isSupabaseEnabled } =
      await import("./lib/supabaseClient.js");
    if (!isSupabaseEnabled()) return result;
    const todayJst = new Date(Date.now() + 9 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    // 会場は24。1会場1行だけ取る（全行を取ると1000行の上限に当たる）
    const rows = await Promise.all(
      Array.from({ length: 24 }, (_, i) =>
        supabase
          .from("races")
          .select("race_date")
          .eq("venue_code", i + 1)
          .lte("race_date", todayJst)
          .order("race_date", { ascending: false })
          .limit(1)
          .then(({ data, error }) => {
            if (error) throw new Error(error.message);
            return [i + 1, data?.[0]?.race_date ?? null];
          }),
      ),
    );
    for (const [venue, date] of rows) {
      result.byVenue.set(venue, date);
      result.overall = laterDate(result.overall, date);
    }
  } catch (err) {
    console.error("開催日の取得エラー:", err.message);
  }
  return result;
}

// 言語版の組（hreflang）。画面の HreflangTags と同じ getAvailableLanguages で決める。
// 画面の hreflang は JS 実行後にしか無く、日本語の検索に /en/・/ko/ が出ていた（BOA-560）。
// 1言語しか無いページは出さない（画面も出さない）
function alternatesFor(loc) {
  const { basePath } = parseLangFromPath(loc);
  const languages = getAvailableLanguages(basePath);
  if (languages.length < 2) return [];
  const urlFor = (code) => `${SITE_URL}${localizePath(basePath, code)}`;
  return [
    ...languages.map(({ code, hreflang }) => ({
      hreflang,
      href: urlFor(code),
    })),
    ...(languages.some(({ code }) => code === DEFAULT_LANGUAGE)
      ? [{ hreflang: "x-default", href: urlFor(DEFAULT_LANGUAGE) }]
      : []),
  ];
}

// sitemap.xmlの生成
async function generateSitemap() {
  const blogPosts = getBlogPosts();
  const racePages = await getRacePages();
  const racerPages = await getRacerPages();
  const latest = await getLatestRaceDates();
  const blogIndexLastmod = (lang) => {
    const posts =
      lang === "en"
        ? blogPostsEn
        : lang === "zh-TW"
          ? blogPostsZhTw
          : lang === "ko"
            ? blogPostsKo
            : blogPostsJa;
    return posts.reduce(
      (acc, post) =>
        laterDate(acc, blogLastmod(post.id, BLOG_MD_SUFFIX[lang] ?? "")),
      null,
    );
  };
  const resolveLastmod = (page) => {
    switch (page.lastmodFrom) {
      case "raceData":
        return latest.overall;
      case "venueRaceData":
        return latest.byVenue.get(page.venueCode) ?? null;
      case "blogIndex":
        return blogIndexLastmod(page.lang);
      case "blogPost":
        return blogLastmod(page.postId, BLOG_MD_SUFFIX[page.lang] ?? "");
      default:
        return page.lastmod ?? null;
    }
  };

  const allPages = [
    ...staticPages,
    ...localizedPages,
    ...blogPosts,
    ...racePages,
    ...racerPages,
  ];

  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml +=
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n';

  allPages.forEach((page) => {
    xml += renderUrlEntry(SITE_URL, {
      ...page,
      lastmod: resolveLastmod(page),
      alternates: alternatesFor(page.loc),
    });
  });

  xml += "</urlset>\n";

  return xml;
}

// メイン処理
async function main() {
  try {
    console.log("Generating sitemap.xml...");

    const sitemap = await generateSitemap();
    const sitemapPath = path.join(PUBLIC_DIR, "sitemap.xml");

    fs.writeFileSync(sitemapPath, sitemap, "utf-8");

    // URL数をカウント
    const urlCount = sitemap.split("<url>").length - 1;
    console.log(`✅ Sitemap generated: ${sitemapPath} (${urlCount} URLs)`);
  } catch (error) {
    console.error("❌ Error generating sitemap:", error);
    process.exit(1);
  }
}

main();
