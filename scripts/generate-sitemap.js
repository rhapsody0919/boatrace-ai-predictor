import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import matter from "gray-matter";
import {
  SUPPORTED_LANGUAGES,
  DEFAULT_LANGUAGE,
  localizePath,
} from "../src/config/languages.js";
import { VENUE_GUIDES_EN } from "../src/data/venueGuidesEn.js";
import { VENUE_REGIONS } from "../src/data/venueRegions.js";
import { VENUE_GUIDES_ZH_TW } from "../src/data/venueGuidesZhTw.js";
import { VENUE_GUIDES_KO } from "../src/data/venueGuidesKo.js";
import { blogPostsEn } from "../src/data/blogPostsEn.js";
import { blogPostsZhTw } from "../src/data/blogPostsZhTw.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SITE_URL = "https://www.boat-ai.jp";
const PUBLIC_DIR = path.join(__dirname, "../public");
const BLOG_DIR = path.join(PUBLIC_DIR, "blog");

// 静的ページの定義
const staticPages = [
  {
    loc: "/",
    lastmod: new Date().toISOString().split("T")[0],
    changefreq: "daily",
    priority: "1.0",
  },
  {
    loc: "/accuracy",
    lastmod: new Date().toISOString().split("T")[0],
    changefreq: "daily",
    priority: "0.9",
  },
  {
    loc: "/hit-races",
    lastmod: new Date().toISOString().split("T")[0],
    changefreq: "daily",
    priority: "0.9",
  },
  {
    loc: "/about",
    lastmod: new Date().toISOString().split("T")[0],
    changefreq: "monthly",
    priority: "0.8",
  },
  {
    loc: "/faq",
    lastmod: new Date().toISOString().split("T")[0],
    changefreq: "monthly",
    priority: "0.8",
  },
  {
    loc: "/how-to-use",
    lastmod: new Date().toISOString().split("T")[0],
    changefreq: "monthly",
    priority: "0.9",
  },
  {
    loc: "/privacy",
    lastmod: new Date().toISOString().split("T")[0],
    changefreq: "yearly",
    priority: "0.3",
  },
  {
    loc: "/terms",
    lastmod: new Date().toISOString().split("T")[0],
    changefreq: "yearly",
    priority: "0.3",
  },
  {
    loc: "/contact",
    lastmod: new Date().toISOString().split("T")[0],
    changefreq: "monthly",
    priority: "0.5",
  },
  {
    loc: "/blog",
    lastmod: new Date().toISOString().split("T")[0],
    changefreq: "weekly",
    priority: "0.7",
  },
  {
    loc: "/races",
    lastmod: new Date().toISOString().split("T")[0],
    changefreq: "daily",
    priority: "0.9",
  },
  {
    loc: "/guide",
    lastmod: new Date().toISOString().split("T")[0],
    changefreq: "monthly",
    priority: "0.8",
  },
  {
    loc: "/responsible-gambling",
    lastmod: new Date().toISOString().split("T")[0],
    changefreq: "yearly",
    priority: "0.5",
  },
  {
    loc: "/profile",
    lastmod: new Date().toISOString().split("T")[0],
    changefreq: "monthly",
    priority: "0.5",
  },
  {
    loc: "/accuracy/history",
    lastmod: new Date().toISOString().split("T")[0],
    changefreq: "daily",
    priority: "0.8",
  },
  {
    loc: "/winning-technique",
    lastmod: new Date().toISOString().split("T")[0],
    changefreq: "daily",
    priority: "0.8",
  },
];

// 全言語で翻訳提供済みのページ（デフォルト言語以外の各言語 URL を登録。未翻訳の blog 等は含めない）
const LOCALIZED_PAGES = [
  { basePath: "/", changefreq: "daily", priority: "0.9" },
  { basePath: "/guide", changefreq: "monthly", priority: "0.8" },
  { basePath: "/winning-technique", changefreq: "daily", priority: "0.8" },
];

// blogPostsXx.js にエントリはあるが対応する -{suffix}.md が存在しない場合、sitemapが
// 実体の無いURLを配信してしまう（code-reviewで発見: エントリ追加と-en.md作成が
// 別PRになるケースを想定した検知）。生成時に警告のみ出し、処理は止めない
const BLOG_TRANSLATION_CHECKS = [
  { label: "blogPostsEn.js", posts: blogPostsEn, mdSuffix: "-en" },
  { label: "blogPostsZhTw.js", posts: blogPostsZhTw, mdSuffix: "-zh-tw" },
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
    },
    ...blogPostsEn.map((post) => ({
      basePath: `/blog/${post.id}`,
      changefreq: "monthly",
      priority: "0.6",
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
          { basePath: "/blog", changefreq: "weekly", priority: "0.6" },
          ...blogPostsZhTw.map((post) => ({
            basePath: `/blog/${post.id}`,
            changefreq: "monthly",
            priority: "0.6",
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
  ],
};

// デフォルト言語以外の言語別ページを生成
const localizedPages = SUPPORTED_LANGUAGES.filter(
  ({ code }) => code !== DEFAULT_LANGUAGE,
).flatMap(({ code }) =>
  [...LOCALIZED_PAGES, ...(LANGUAGE_ONLY_PAGES[code] ?? [])].map(
    ({ basePath, changefreq, priority }) => ({
      loc: localizePath(basePath, code),
      lastmod: new Date().toISOString().split("T")[0],
      changefreq,
      priority,
    }),
  ),
);

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

    const filePath = path.join(BLOG_DIR, file);
    const content = fs.readFileSync(filePath, "utf-8");
    const { data } = matter(content);

    const slug = file.replace(".md", "");
    const stats = fs.statSync(filePath);

    // frontmatterのdateフィールドまたはファイルの更新日時を使用
    let lastmod = data.date || data.publishedAt || stats.mtime;
    if (lastmod instanceof Date) {
      lastmod = lastmod.toISOString().split("T")[0];
    } else if (typeof lastmod === "string") {
      lastmod = new Date(lastmod).toISOString().split("T")[0];
    } else {
      lastmod = new Date().toISOString().split("T")[0];
    }

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
      .select("race_date")
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

    console.log(
      `📊 Supabase から直近7日分のレースデータを取得（${uniqueDates.length}日分）`,
    );
  } catch (err) {
    console.error("レースページ取得エラー:", err.message);
  }

  return racePages;
}

// sitemap.xmlの生成
async function generateSitemap() {
  const blogPosts = getBlogPosts();
  const racePages = await getRacePages();
  const allPages = [
    ...staticPages,
    ...localizedPages,
    ...blogPosts,
    ...racePages,
  ];

  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

  allPages.forEach((page) => {
    xml += "  <url>\n";
    xml += `    <loc>${SITE_URL}${page.loc}</loc>\n`;
    xml += `    <lastmod>${page.lastmod}</lastmod>\n`;
    xml += `    <changefreq>${page.changefreq}</changefreq>\n`;
    xml += `    <priority>${page.priority}</priority>\n`;
    xml += "  </url>\n";
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
