// generate-sitemap.js から字のまま移した、ブログ記事の sitemap の行（public/blog/*.md の走査）と、翻訳の JSON に対する md の有無の警告。
// 記事の lastmod（md の最終コミット日と公開日の新しい方）は generate-sitemap.js の blogLastmod を受け取る（verify が git の部品を差し替えるため、呼び手に置く）。DB には触らない
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { blogPostsEn } from "../../src/data/blogPostsEn.js";
import { blogPostsZhTw } from "../../src/data/blogPostsZhTw.js";
import { blogPostsKo } from "../../src/data/blogPostsKo.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const BLOG_DIR = path.join(__dirname, "../../public/blog");

// 翻訳版の JSON（src/data/blog-posts/{lang}/{id}.json）はあるが対応する -{suffix}.md が存在しない場合、sitemapが
// 実体の無いURLを配信してしまう（code-reviewで発見: エントリ追加と-en.md作成が
// 別PRになるケースを想定した検知）。生成時に警告のみ出し、処理は止めない
const BLOG_TRANSLATION_CHECKS = [
  { label: "blog-posts/en/*.json", posts: blogPostsEn, mdSuffix: "-en" },
  { label: "blog-posts/zh-TW/*.json", posts: blogPostsZhTw, mdSuffix: "-zh-tw" },
  { label: "blog-posts/ko/*.json", posts: blogPostsKo, mdSuffix: "-ko" },
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

// ブログ記事のスキャン
export function getBlogPosts(blogLastmod) {
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
