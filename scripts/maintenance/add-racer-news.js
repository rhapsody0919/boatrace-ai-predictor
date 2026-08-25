// 選手ニュース掲載スクリプト（承認フローの最終ステップ）
// docs/adr/0022-racer-news-approval-flow.md 参照
// Claudeがチャットで候補提示 → ユーザー承認 → 本スクリプトで racer_news に1件INSERTする
//
// 使用方法:
//   node scripts/maintenance/add-racer-news.js \
//     --racer-id=4327 --title="見出し" --summary="要約文" \
//     --source-url="https://example.com/article" --source-name="出典名" \
//     --published-at=2026-08-25

import { supabase } from "../lib/supabaseClient.js";

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {};
  for (const arg of args) {
    const match = arg.match(/^--([a-z-]+)=(.*)$/s);
    if (match) options[match[1]] = match[2];
  }
  return options;
}

function requireArg(options, key) {
  if (!options[key]) {
    console.error(`エラー: --${key} は必須です`);
    process.exit(1);
  }
  return options[key];
}

async function main() {
  const options = parseArgs();

  const racerId = parseInt(requireArg(options, "racer-id"), 10);
  const title = requireArg(options, "title");
  const summary = requireArg(options, "summary");
  const sourceUrl = requireArg(options, "source-url");
  const sourceName = options["source-name"] || null;
  const publishedAt = options["published-at"] || null;

  console.log("=== 選手ニュース掲載 ===");
  console.log(`racer_id: ${racerId}`);
  console.log(`見出し: ${title}`);
  console.log(`要約: ${summary}`);
  console.log(`出典: ${sourceUrl}${sourceName ? ` (${sourceName})` : ""}`);
  console.log("");

  const { data, error } = await supabase
    .from("racer_news")
    .insert({
      racer_id: racerId,
      title,
      summary,
      source_url: sourceUrl,
      source_name: sourceName,
      published_at: publishedAt,
    })
    .select();

  if (error) {
    console.error("掲載エラー:", error.message);
    process.exit(1);
  }

  console.log("掲載完了:", data[0]);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
