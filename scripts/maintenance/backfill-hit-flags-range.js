/**
 * 指定した日付範囲の predictions の的中フラグ欠落を手動修復する。
 *
 * 通常は scrape-results.js の日次実行内で自動的に直近10日分が
 * 自己修復されるが、それより古い欠落や緊急の手動修復にはこちらを使う。
 *
 * 使い方:
 *   node scripts/maintenance/backfill-hit-flags-range.js 2026-09-01
 *   node scripts/maintenance/backfill-hit-flags-range.js 2026-09-01 2026-09-05
 */
import { isSupabaseEnabled } from "../lib/supabaseClient.js";
import { fixMissingHitFlags } from "../daily/scrape-results.js";

async function main() {
  if (!isSupabaseEnabled()) {
    console.error("❌ Supabaseが設定されていません");
    process.exit(1);
  }

  const [startDate, endDate] = process.argv.slice(2);
  if (!startDate) {
    console.error(
      "Usage: node scripts/maintenance/backfill-hit-flags-range.js <startDate> [endDate]",
    );
    process.exit(1);
  }

  console.log(`🔧 的中フラグ欠落修復: ${startDate}〜${endDate || startDate}`);
  await fixMissingHitFlags(startDate, endDate || startDate);
  console.log("✅ 完了");
}

main();
