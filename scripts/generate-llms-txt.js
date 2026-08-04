/**
 * llms.txt生成スクリプト
 *
 * AIアシスタント（ChatGPT/Perplexity/Gemini等）がサイト構成を把握しやすいよう、
 * llmstxt.org の慣習に沿ったサイト要約ファイルを public/llms.txt に出力する。
 * sitemap.xmlと同様、.github/workflows/update-sitemap.yml から日次実行される。
 *
 * 使い方: node scripts/generate-llms-txt.js
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { blogPosts } from "../src/data/blogPosts.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "../public");
const SITE_URL = "https://www.boat-ai.jp";

const CORE_PAGES = [
  {
    title: "トップページ（本日の予想）",
    path: "/",
    description:
      "本日開催中のレースのAI予想（本命狙い・スタンダード・穴狙いの3モデル）を無料・登録不要で表示",
  },
  {
    title: "データ分析ツール",
    path: "/winning-technique",
    description:
      "出目分布・決まり手・モーター調子・選手調子・STのズレ・トップスタート・負け決まり手・逃げ成功時分布・展示タイムの9機能。会場・レースごとの傾向を確認できる分析ツール",
  },
  {
    title: "使い方ガイド",
    path: "/how-to-use",
    description: "BoatAIの使い方を6ステップで解説",
  },
  {
    title: "よくある質問",
    path: "/faq",
    description: "BoatAIの料金・精度・使い方に関するFAQ",
  },
  {
    title: "予測実績",
    path: "/accuracy",
    description: "AI予想の的中率・回収率の実績データを公開",
  },
  {
    title: "BoatAIについて",
    path: "/about",
    description: "BoatAIのサービス概要",
  },
];

function buildLlmsTxt() {
  const lines = [];
  lines.push("# BoatAI");
  lines.push("");
  lines.push(
    "> 45項目以上のデータをAIが分析するボートレース予想・データ分析サービス。全24ボートレース場に対応し、完全無料・登録不要で利用できる。的中率・回収率の実績を包み隠さず公開している。",
  );
  lines.push("");
  lines.push("## 主要ページ");
  lines.push("");
  for (const page of CORE_PAGES) {
    lines.push(
      `- [${page.title}](${SITE_URL}${page.path}): ${page.description}`,
    );
  }
  lines.push("");
  lines.push("## ブログ記事");
  lines.push("");

  const sortedPosts = [...blogPosts].sort(
    (a, b) => new Date(b.date) - new Date(a.date),
  );
  for (const post of sortedPosts) {
    lines.push(
      `- [${post.title}](${SITE_URL}/blog/${post.id}): ${post.description}`,
    );
  }
  lines.push("");

  return lines.join("\n");
}

function main() {
  console.log("Generating llms.txt...");
  const content = buildLlmsTxt();
  const outputPath = path.join(PUBLIC_DIR, "llms.txt");
  fs.writeFileSync(outputPath, content, "utf-8");
  console.log(
    `✅ llms.txt generated: ${outputPath} (${blogPosts.length} blog posts)`,
  );
}

main();
