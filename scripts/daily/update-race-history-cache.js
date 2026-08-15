// Race History Cache Update Script
// predictions（unified）テーブルから過去90日の日別・展開予測的中統計を集計し、
// race_history_cache に保存する
//
// BOA-178（unified一本化）対応: 旧3モデル別の単勝/複勝/3連複/3連単集計を廃止し、
// unifiedモデルの展開予測的中（predictions.is_hit_turn、ADR 0013）のみを
// 日別に集計するシンプルな構造に変更。マイグレーション033
// （predictions.is_hit_turn追加）の適用が前提。

import { supabase, isSupabaseEnabled } from "../lib/supabaseClient.js";

const MODEL_ID = "unified";

// JST 日付文字列を生成
function jstDateStr(date) {
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().split("T")[0];
}

// predictions（unified）から指定範囲を全件取得（ページネーション付き）
async function fetchUnifiedPredictionsRange(startDate) {
  let allData = [];
  let from = 0;
  const pageSize = 1000;

  while (true) {
    const { data: page, error } = await supabase
      .from("predictions")
      .select("race_id, is_hit_turn")
      .eq("model_id", MODEL_ID)
      .gte("race_id", startDate)
      .range(from, from + pageSize - 1);

    if (error) {
      console.error("  fetchUnifiedPredictionsRange error:", error.message);
      break;
    }
    if (!page || page.length === 0) break;
    allData = allData.concat(page);
    if (page.length < pageSize) break;
    from += pageSize;
  }

  return allData;
}

// race_history_cache を構築・更新
async function updateRaceHistoryCache() {
  const now = new Date();

  // 過去90日
  const ninetyDaysAgoStr = jstDateStr(
    new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000),
  );

  console.log("\n📊 レース履歴キャッシュ用データ取得中...");

  // unified予測を取得（ページネーション付き）
  const predictions = await fetchUnifiedPredictionsRange(ninetyDaysAgoStr);
  console.log(`  取得したunified予測: ${predictions.length}件`);

  // race_id ごとの レース情報を取得（total を計数）
  let allRaces = [];
  let from = 0;
  const pageSize = 1000;
  while (true) {
    const { data: page, error } = await supabase
      .from("races")
      .select("race_id")
      .gte("race_id", ninetyDaysAgoStr)
      .range(from, from + pageSize - 1);

    if (error) {
      console.error("  races テーブル取得エラー:", error.message);
      break;
    }
    if (!page || page.length === 0) break;
    allRaces = allRaces.concat(page);
    if (page.length < pageSize) break;
    from += pageSize;
  }

  // 日付別に集計
  const dayMap = new Map(); // date -> { totalRaces, finishedRaces, turnRaces, turnHits }

  // ステップ 1: 全レース数を日付別に集計
  for (const race of allRaces) {
    const date = race.race_id.substring(0, 10);
    if (!dayMap.has(date)) {
      dayMap.set(date, {
        date,
        totalRaces: 0,
        finishedRaces: 0,
        turnRaces: 0,
        turnHits: 0,
      });
    }
    dayMap.get(date).totalRaces++;
  }

  // ステップ 2: unified予測を日付別に集計
  // is_hit_turn: true=的中, false=不的中, null=結果未確定 or turnPredictionなし
  const processedRaceIds = new Set();
  for (const pred of predictions) {
    const date = pred.race_id.substring(0, 10);

    if (!dayMap.has(date)) {
      dayMap.set(date, {
        date,
        totalRaces: 0,
        finishedRaces: 0,
        turnRaces: 0,
        turnHits: 0,
      });
    }
    const dayData = dayMap.get(date);

    // finishedRaces: is_hit_turnが確定している（null以外）レースをカウント
    // （レース単位で1回のみ、unifiedはrace_idごとに1レコードのため実質不要だが念のため）
    if (pred.is_hit_turn !== null && !processedRaceIds.has(pred.race_id)) {
      dayData.finishedRaces++;
      processedRaceIds.add(pred.race_id);
    }

    if (pred.is_hit_turn !== null) {
      dayData.turnRaces++;
      if (pred.is_hit_turn) dayData.turnHits++;
    }
  }

  // ステップ 3: dayMap を days 配列に変換
  const days = Array.from(dayMap.values())
    .map((day) => ({
      date: day.date,
      totalRaces: day.totalRaces,
      finishedRaces: day.finishedRaces,
      turnRaces: day.turnRaces,
      turnHits: day.turnHits,
      turnHitRate:
        day.turnRaces > 0
          ? parseFloat(((day.turnHits / day.turnRaces) * 100).toFixed(1))
          : null,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  console.log(`  日別集計: ${days.length}日分`);

  // ステップ 4: race_history_cache に upsert
  const cacheData = { days };

  const { error: upsertError } = await supabase
    .from("race_history_cache")
    .upsert({
      key: "race_history_summary_90",
      data: cacheData,
      updated_at: new Date().toISOString(),
    });

  if (upsertError) {
    console.error(
      "  ❌ race_history_cache UPSERT エラー:",
      upsertError.message,
    );
    return false;
  }

  console.log("  ✅ race_history_cache 更新完了（90日分、展開予測的中率）");
  return true;
}

// Main
async function main() {
  if (!isSupabaseEnabled()) {
    console.error("❌ Supabaseが設定されていません");
    process.exit(1);
  }

  console.log("🚀 レース履歴キャッシュ更新を開始します");

  const success = await updateRaceHistoryCache();

  if (success) {
    console.log("\n✅ 更新完了");
    process.exit(0);
  } else {
    console.error("\n❌ 更新失敗");
    process.exit(1);
  }
}

main();
