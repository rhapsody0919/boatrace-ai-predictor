/**
 * 新規ブログ記事公開時のXツイート下書き生成スクリプト
 *
 * note-articles/X_CONTENT_STRATEGY.md の「4. note記事シェア」パターンに準拠。
 * 実際の投稿はユーザーが手動で行う（Xへの投稿を自動化する公開APIはあるが
 * このプロジェクトでは未設定・かつ都度承認が必要なため、下書き生成のみ自動化）。
 *
 * 使い方: node scripts/generate-tweet-draft.js <blog-post-id>
 * 出力: note-articles/tweet-drafts.md に追記
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { blogPosts } from "../src/data/blogPosts.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.join(__dirname, "../note-articles/tweet-drafts.md");
const SITE_URL = "https://www.boat-ai.jp";

function buildTweetDraft(post) {
  const highlights = post.tags
    .slice(0, 3)
    .map((tag) => `・${tag}`)
    .join("\n");
  return `📝 新しい記事を公開しました

【${post.title}】

${highlights}

👉 ${SITE_URL}/blog/${post.id}

#ボートレース #データ分析 #龍神レーダー`;
}

function main() {
  const postId = process.argv[2];
  if (!postId) {
    console.error(
      "使用方法: node scripts/generate-tweet-draft.js <blog-post-id>",
    );
    process.exit(1);
  }

  const post = blogPosts.find((p) => p.id === postId);
  if (!post) {
    console.error(`❌ 記事が見つかりません: ${postId}`);
    process.exit(1);
  }

  const draft = buildTweetDraft(post);
  const entry = `## ${post.date} ${post.title}\n\n\`\`\`\n${draft}\n\`\`\`\n\n---\n\n`;

  fs.appendFileSync(OUTPUT_PATH, entry, "utf-8");
  console.log(`✅ ツイート下書きを追記しました: ${OUTPUT_PATH}`);
  console.log("\n--- 下書き ---");
  console.log(draft);
}

main();
