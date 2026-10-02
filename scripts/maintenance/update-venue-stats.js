import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { supabase } from "../lib/supabaseClient.js";
import { aggregateFirstWinRate } from "../lib/venueFirstWinRate.js";
import { getDaysAgoJST } from "../../src/utils/dateUtils.js";

const DAYS = 90;

async function fetchAll(query) {
  const PAGE = 1000;
  let all = [];
  let from = 0;
  while (true) {
    const { data, error } = await query(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    all = all.concat(data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

async function updateVenueStats() {
  const sinceStr = getDaysAgoJST(DAYS);

  console.log(`🔬 会場別統計を更新中（直近${DAYS}日: ${sinceStr} 〜）`);

  // 1号艇勝率と母数（90日）。分析ツールの「1号艇勝率ランキング」と
  // 他機能の venueWinRate はこの保存値を読む（BOA-303。除外の基準は scripts/lib/venueFirstWinRate.js）
  const races = await fetchAll((from, to) =>
    supabase
      .from("races")
      .select("venue_code, race_results(rank1, race_status)")
      .gte("race_date", sinceStr)
      .order("race_id")
      .range(from, to),
  );

  const venueStats = aggregateFirstWinRate(races);

  // venues テーブルを更新。1会場でも失敗したら終了コードを非0にする（以前はログだけで成功扱いだった）
  const now = new Date().toISOString();
  const failures = [];
  for (const [venueCode, stats] of venueStats) {
    const { error } = await supabase
      .from("venues")
      .update({
        avg_first_win_rate: stats.firstWins / stats.raceCount,
        avg_first_win_rate_race_count: stats.raceCount,
        updated_at: now,
      })
      .eq("code", venueCode);
    if (error) failures.push(`${venueCode}: ${error.message}`);
  }
  if (failures.length > 0) {
    throw new Error(
      `venues の更新に失敗（${failures.length}会場）: ${failures.join(" / ")}`,
    );
  }

  // 結果表示
  const { data: venues } = await supabase
    .from("venues")
    .select("code, name, avg_first_win_rate, avg_first_win_rate_race_count")
    .not("avg_first_win_rate", "is", null)
    .order("avg_first_win_rate", { ascending: false });

  console.log("✅ venues統計更新完了\n");
  console.log("会場別1コース勝率（直近90日）:");
  venues.forEach((v) => {
    const winRate = v.avg_first_win_rate
      ? (v.avg_first_win_rate * 100).toFixed(1) + "%"
      : "-";
    console.log(
      `  ${v.name}: 1コース勝率=${winRate}（${v.avg_first_win_rate_race_count ?? "-"}レース）`,
    );
  });
}

updateVenueStats().catch((e) => {
  console.error(e);
  process.exit(1);
});
