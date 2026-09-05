// YouTube投稿実績レポート
//
// X/TikTokと異なりYouTubeはAPI経由で自動投稿されるため、投稿状況は
// data/analysis/配下のJSONログではなくsns_draftsテーブルに既に記録
// されている（status='posted'、posted_at列）。このスクリプトは
// 別途ログファイルを新設する代わりに、既存の記録をそのまま可視化する
// （2026-09-05、4チャネルアルゴリズム調査監査でYouTubeの投稿実績が
// 一切確認できない状態だったと判明したための対応）。
//
// 使用方法:
//   node scripts/analysis/youtube-posts-report.js [直近日数（デフォルト30）]

import { supabase } from "../lib/supabaseClient.js";

const days = parseInt(process.argv[2], 10) || 30;

async function main() {
  const since = new Date();
  since.setDate(since.getDate() - days);

  const { data, error } = await supabase
    .from("sns_drafts")
    .select("id, status, title, created_at, posted_at, archived_at")
    .eq("platform", "youtube")
    .gte("created_at", since.toISOString())
    .order("created_at", { ascending: false });

  if (error) {
    console.error("❌ sns_drafts取得エラー:", error.message);
    process.exit(1);
  }

  console.log(`=== YouTube投稿実績レポート（直近${days}日） ===\n`);

  if (data.length === 0) {
    console.log("該当期間にYouTube向けの下書きが1件も生成されていません。");
    return;
  }

  const byStatus = {};
  for (const row of data) {
    byStatus[row.status] = (byStatus[row.status] || 0) + 1;
  }
  console.log("ステータス別件数:", byStatus);

  const posted = data.filter((r) => r.status === "posted");
  console.log(`\n実際に投稿済み: ${posted.length}件`);
  posted.forEach((r) => {
    console.log(`  ${r.posted_at?.slice(0, 10) ?? "?"}: ${r.title}`);
  });

  const pending = data.filter((r) => r.status === "pending_review");
  if (pending.length > 0) {
    console.log(`\n承認待ち: ${pending.length}件`);
    pending.forEach((r) => {
      console.log(`  ${r.created_at.slice(0, 10)}: ${r.title}`);
    });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
