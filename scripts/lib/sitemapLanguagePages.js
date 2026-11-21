// generate-sitemap.js から字のまま移した、言語別ページの表（全言語で翻訳済みのページと、特定の言語にだけあるページ）。読むだけ
import {
  SUPPORTED_LANGUAGES,
  DEFAULT_LANGUAGE,
  localizePath,
} from "../../src/config/languages.js";
import { VENUE_GUIDES_EN } from "../../src/data/venueGuidesEn.js";
import { VENUE_REGIONS } from "../../src/data/venueRegions.js";
import { VENUE_GUIDES_ZH_TW } from "../../src/data/venueGuidesZhTw.js";
import { VENUE_GUIDES_KO } from "../../src/data/venueGuidesKo.js";
import { blogPostsEn } from "../../src/data/blogPostsEn.js";
import { blogPostsZhTw } from "../../src/data/blogPostsZhTw.js";
import { blogPostsKo } from "../../src/data/blogPostsKo.js";

// 全言語で翻訳提供済みのページ（デフォルト言語以外の各言語 URL を登録。未翻訳の blog 等は含めない）
export const LOCALIZED_PAGES = [
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

// 特定言語にのみ存在するページ（会場別ビジターガイド: 英語版 BOA-133 / 繁体字版 BOA-134）
export const LANGUAGE_ONLY_PAGES = {
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
    // 英語版の JSON（blogPostsEn.js が読む）から動的に生成し、新規記事追加時の登録漏れを防ぐ
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
export const localizedPages = SUPPORTED_LANGUAGES.filter(
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
