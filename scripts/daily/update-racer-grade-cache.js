// Racer Grade Cache Update Script
// 選手ごとの最新級別・勝率（race_entriesの最新行、ADR-0023準拠）を
// get_latest_racer_grades() RPC（docs/db-migration/055番）で一括取得し、
// racer_grade_cache に保存する（docs/design/racer-search-and-list/、ADR-0043）

import { supabase, isSupabaseEnabled } from "../lib/supabaseClient.js";

// Supabaseのデフォルトlimitは1000行のため、RPC呼び出しもページネーションが必要
async function fetchAllLatestRacerGrades() {
  let allData = [];
  let from = 0;
  const pageSize = 1000;

  while (true) {
    const { data: page, error } = await supabase
      .rpc("get_latest_racer_grades")
      .range(from, from + pageSize - 1);

    if (error) {
      console.error("  get_latest_racer_grades RPCエラー:", error.message);
      return null;
    }
    if (!page || page.length === 0) break;
    allData = allData.concat(page);
    if (page.length < pageSize) break;
    from += pageSize;
  }

  return allData;
}

async function updateRacerGradeCache() {
  console.log("\n📊 選手ごとの最新級別・勝率を取得中...");

  const data = await fetchAllLatestRacerGrades();

  if (data === null) {
    return false;
  }

  console.log(`  取得件数: ${data.length}件`);

  const { error: upsertError } = await supabase
    .from("racer_grade_cache")
    .upsert({
      key: "latest_grades",
      data: data ?? [],
      updated_at: new Date().toISOString(),
    });

  if (upsertError) {
    console.error("  ❌ racer_grade_cache UPSERTエラー:", upsertError.message);
    return false;
  }

  console.log("  ✅ racer_grade_cache 更新完了");
  return true;
}

async function main() {
  if (!isSupabaseEnabled()) {
    console.error("❌ Supabaseが設定されていません");
    process.exit(1);
  }

  console.log("🚀 選手級別・勝率キャッシュ更新を開始します");

  const success = await updateRacerGradeCache();

  if (success) {
    console.log("\n✅ 更新完了");
    process.exit(0);
  } else {
    console.error("\n❌ 更新失敗");
    process.exit(1);
  }
}

main();
