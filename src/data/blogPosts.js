import {
  blogPostsEn,
  getEnglishOverride,
  isEnglishAvailable,
} from "./blogPostsEn.js";
import {
  blogPostsZhTw,
  getZhTwOverride,
  isZhTwAvailable,
} from "./blogPostsZhTw.js";
import {
  blogPostsKo,
  getKoreanOverride,
  isKoreanAvailable,
} from "./blogPostsKo.js";

// 言語別ブログ翻訳データの設定。新言語追加時はここに1エントリ足すだけで良い
// （BlogPost.jsx/Blog.jsxはこのマップ経由でのみ言語別データにアクセスする）
const BLOG_LANG_CONFIG = {
  en: {
    posts: blogPostsEn,
    getOverride: getEnglishOverride,
    isAvailable: isEnglishAvailable,
    mdSuffix: "-en",
  },
  "zh-TW": {
    posts: blogPostsZhTw,
    getOverride: getZhTwOverride,
    isAvailable: isZhTwAvailable,
    mdSuffix: "-zh-tw",
  },
  ko: {
    posts: blogPostsKo,
    getOverride: getKoreanOverride,
    isAvailable: isKoreanAvailable,
    mdSuffix: "-ko",
  },
};

// 記事メタデータは1記事1ファイル（src/data/blog-posts/{id}.json）に置く（BOA-247）。
// 1つの配列に追記する方式だと、記事を足すPRが同時に開くたびに同じ行でコンフリクトしたため。
// 新しい記事は JSON を1つ足すだけでよく、このファイルは触らない。
// 読み込みは Vite（画面）では import.meta.glob、Node のスクリプト（sitemap・llms.txt 等）では fs。
// Node 側は process.getBuiltinModule（同期）を使い、画面のバンドルに fs やトップレベル await を持ち込まない
function readPostFilesInNode() {
  const getBuiltin = globalThis.process?.getBuiltinModule;
  if (!getBuiltin) {
    throw new Error(
      "blogPosts.js: Node で読むには process.getBuiltinModule（Node 20.16+ / 22.3+）が必要です",
    );
  }
  const fs = getBuiltin("node:fs");
  // 画面のバンドルでは通らない分岐（Vite が実行時解決の警告を出さないよう無視させる）
  const dir = new URL(/* @vite-ignore */ "./blog-posts/", import.meta.url);
  return Object.fromEntries(
    fs
      .readdirSync(dir)
      .filter((name) => name.endsWith(".json"))
      .map((name) => [
        name,
        JSON.parse(fs.readFileSync(new URL(name, dir), "utf8")),
      ]),
  );
}

const postFiles = import.meta.env
  ? import.meta.glob("./blog-posts/*.json", { eager: true, import: "default" })
  : readPostFilesInNode();

// 新しい順。同じ日付は id 順（ファイルの並びに依存させない）
export const blogPosts = Object.values(postFiles).sort(
  (a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id),
);

// featured の並び（トップの「人気記事」等）は featuredRank の昇順。日付順ではなく手で決めた順
const byFeaturedRank = (a, b) =>
  (a.featuredRank ?? Infinity) - (b.featuredRank ?? Infinity);

// Get featured posts
// lang を渡すと、その言語で読める記事（翻訳版のメタデータ）から選ぶ（BOA-653）
export const getFeaturedPosts = (lang = "ja") =>
  getPostsForLang(lang)
    .filter((post) => post.featured)
    .sort(byFeaturedRank);

// 指定言語で読める記事（翻訳版のメタデータを重ねたもの）。ja は全記事。
// 翻訳版は、その言語のデータがある記事だけ（未翻訳記事は一覧に出さない）
export const getPostsForLang = (lang) => {
  const config = BLOG_LANG_CONFIG[lang];
  if (!config) return blogPosts;
  return blogPosts
    .filter((post) => config.isAvailable(post.id))
    .map((post) => ({ ...post, ...config.getOverride(post.id) }));
};

// Get posts by category
export const getPostsByCategory = (category) =>
  blogPosts.filter((post) => post.category === category);

// Get post by ID
export const getPostById = (id) => blogPosts.find((post) => post.id === id);

// Get latest posts
export const getLatestPosts = (limit = 5, lang = "ja") =>
  [...getPostsForLang(lang)]
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, limit);

// タグ重複度→日付降順で候補記事をランク付けする共通ロジック
// （getRelatedPosts/getRelatedPostsEn で共有。タイブレーク条件の変更漏れを防ぐ）
function rankRelatedPosts(currentPost, candidates, limit) {
  return candidates
    .map((post) => ({
      post,
      sharedTags: post.tags.filter((tag) => currentPost.tags.includes(tag))
        .length,
    }))
    .sort((a, b) => {
      if (b.sharedTags !== a.sharedTags) return b.sharedTags - a.sharedTags;
      return new Date(b.post.date) - new Date(a.post.date);
    })
    .slice(0, limit)
    .map(({ post }) => post);
}

// Get related posts by shared tags (falls back to latest when no tag overlap exists)
export const getRelatedPosts = (postId, limit = 3) => {
  const currentPost = getPostById(postId);
  if (!currentPost) return getLatestPosts(limit);

  const candidates = blogPosts.filter((post) => post.id !== postId);
  return rankRelatedPosts(currentPost, candidates, limit);
};

// 指定言語版の記事が存在するか（BLOG_LANG_CONFIGに未登録の言語コードはfalse）
export const isBlogLangAvailable = (id, lang) =>
  BLOG_LANG_CONFIG[lang]?.isAvailable(id) ?? false;

// 指定言語版のメタデータ上書き分を取得
export const getBlogOverride = (id, lang) =>
  BLOG_LANG_CONFIG[lang]?.getOverride(id);

// 指定言語版のMarkdownファイル名サフィックス（例: en → "-en"）
export const getBlogMdSuffix = (lang) => BLOG_LANG_CONFIG[lang]?.mdSuffix ?? "";

// 同じ言語版が存在する記事同士でのみ関連記事を返す（未翻訳記事へのリンクを避けるため）
// タグの重複度計算は日本語版タグを使用（翻訳版タグは表示専用の翻訳ラベルのため）
export const getRelatedPostsForLang = (postId, lang, limit = 3) => {
  const currentPost = getPostById(postId);
  const config = BLOG_LANG_CONFIG[lang];
  if (!currentPost || !config) return [];

  const availableIds = new Set(config.posts.map((post) => post.id));
  const candidates = blogPosts.filter(
    (post) => post.id !== postId && availableIds.has(post.id),
  );
  return rankRelatedPosts(currentPost, candidates, limit).map((post) => ({
    ...post,
    ...config.getOverride(post.id),
  }));
};
