import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { supabase } from "../lib/supabaseClient.js";

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
  const since = new Date();
  since.setDate(since.getDate() - DAYS);
  const sinceStr = since.toISOString().split("T")[0];

  console.log(`🔬 会場別統計を更新中（直近${DAYS}日: ${sinceStr} 〜）`);

  // 1号艇勝率の集計（90日）
  const races = await fetchAll((from, to) =>
    supabase
      .from("races")
      .select("venue_code, race_results(rank1)")
      .gte("race_date", sinceStr)
      .range(from, to),
  );

  const venueStats = {};
  races.forEach((r) => {
    const venueCode = r.venue_code;
    const result = r.race_results;
    const rank1 = Array.isArray(result) ? result[0]?.rank1 : result?.rank1;
    if (rank1 === undefined) return;

    if (!venueStats[venueCode]) {
      venueStats[venueCode] = { total: 0, firstWins: 0 };
    }
    venueStats[venueCode].total++;
    if (rank1 === 1) venueStats[venueCode].firstWins++;
  });

  // venues テーブルを更新
  const now = new Date().toISOString();
  for (const [venueCode, stats] of Object.entries(venueStats)) {
    const winRate = stats.total > 0 ? stats.firstWins / stats.total : null;

    const { error } = await supabase
      .from("venues")
      .update({
        avg_first_win_rate: winRate,
        updated_at: now,
      })
      .eq("code", parseInt(venueCode));
    if (error)
      console.error(`❌ venues更新エラー (${venueCode}):`, error.message);
  }

  // 結果表示
  const { data: venues } = await supabase
    .from("venues")
    .select("code, name, avg_first_win_rate")
    .not("avg_first_win_rate", "is", null)
    .order("avg_first_win_rate", { ascending: false });

  console.log("✅ venues統計更新完了\n");
  console.log("会場別1コース勝率（直近90日）:");
  venues.forEach((v) => {
    const winRate = v.avg_first_win_rate
      ? (v.avg_first_win_rate * 100).toFixed(1) + "%"
      : "-";
    console.log(`  ${v.name}: 1コース勝率=${winRate}`);
  });
}

updateVenueStats().catch((e) => {
  console.error(e);
  process.exit(1);
});
