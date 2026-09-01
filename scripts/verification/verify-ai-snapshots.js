/**
 * AIクローラー向け静的スナップショット配信の技術検証（ADR 0032）
 * 対象URL全件に対しボットUser-Agentを付与したfetchを行い、
 * レスポンスHTMLに実コンテンツが含まれているかを機械的に確認する。
 *
 * 使い方: node scripts/verification/verify-ai-snapshots.js [baseUrl]
 * 例: node scripts/verification/verify-ai-snapshots.js https://www.boat-ai.jp
 *     node scripts/verification/verify-ai-snapshots.js http://localhost:5173
 */
import { blogPosts } from "../../src/data/blogPosts.js";
import { AI_CRAWLER_USER_AGENTS } from "../../src/config/aiCrawlerBots.js";

const baseUrl = process.argv[2] || "http://localhost:5173";
const BOT_UA = AI_CRAWLER_USER_AGENTS[0]; // GPTBot、代表として1つ使う
const NORMAL_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

async function checkPage(pathName, expectedText) {
  const url = `${baseUrl}${pathName}`;

  const botRes = await fetch(url, { headers: { "User-Agent": BOT_UA } });
  const botHtml = await botRes.text();
  const botOk = botRes.ok && botHtml.includes(expectedText);

  const normalRes = await fetch(url, { headers: { "User-Agent": NORMAL_UA } });
  const normalHtml = await normalRes.text();
  // 通常UAは従来通りSPAのシェル（<div id="root">）が返るべきで、
  // スナップショットの実コンテンツ文字列は含まれないはず
  const normalUnaffected =
    normalRes.ok && normalHtml.includes('<div id="root">');

  return { pathName, botOk, normalUnaffected, botStatus: botRes.status };
}

async function main() {
  console.log(`検証対象: ${baseUrl}\n`);

  const targets = [
    {
      pathName: "/winning-technique",
      expectedText: "データ分析ツール",
    },
    ...blogPosts.slice(0, 5).map((post) => ({
      pathName: `/blog/${post.id}`,
      expectedText: post.title,
    })),
  ];

  const results = [];
  for (const target of targets) {
    try {
      results.push(await checkPage(target.pathName, target.expectedText));
    } catch (err) {
      results.push({
        pathName: target.pathName,
        botOk: false,
        normalUnaffected: false,
        error: err.message,
      });
    }
  }

  let hasFailure = false;
  for (const r of results) {
    const status =
      r.botOk && r.normalUnaffected
        ? "✓"
        : r.error
          ? `✗ (${r.error})`
          : `✗ (bot=${r.botOk ? "ok" : "NG"}, normal=${r.normalUnaffected ? "ok" : "NG"})`;
    console.log(`${status} ${r.pathName}`);
    if (!(r.botOk && r.normalUnaffected)) hasFailure = true;
  }

  if (hasFailure) {
    console.error("\n検証に失敗した項目があります。");
    process.exit(1);
  }
  console.log("\nすべての検証項目が成功しました。");
}

main().catch((err) => {
  console.error("検証中にエラーが発生しました:", err);
  process.exit(1);
});
