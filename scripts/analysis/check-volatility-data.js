/**
 * イン崩れ指数（volatility_score）の蓄積状況を確認
 */

import { supabase } from "../lib/supabaseClient.js";

async function checkVolatility() {
  console.log("📊 イン崩れ指数（volatility_score）データ蓄積状況\n");

  // 1. 総レース数と volatility_score がある件数
  const { count: totalCount } = await supabase
    .from("races")
    .select("*", { count: "exact", head: true });

  const { count: withVolatility } = await supabase
    .from("races")
    .select("*", { count: "exact", head: true })
    .not("volatility_score", "is", null);

  console.log(`📈 総レース数: ${totalCount?.toLocaleString()}`);
  console.log(
    `✅ volatility_score が設定されたレース: ${withVolatility?.toLocaleString()}`,
  );
  if (totalCount) {
    const pct = ((withVolatility / totalCount) * 100).toFixed(1);
    console.log(`📊 カバー率: ${pct}%\n`);
  }

  // 2. 直近30日の日付別蓄積
  console.log("📅 日付別の蓄積状況（直近30日）：");
  const { data: races } = await supabase
    .from("races")
    .select("race_id, volatility_score")
    .order("race_id", { ascending: false })
    .limit(3000);

  if (races && races.length > 0) {
    const grouped = {};
    races.forEach((r) => {
      const date = r.race_id.split("-").slice(0, 3).join("-");
      if (!grouped[date]) {
        grouped[date] = { total: 0, withV: 0, first: r.volatility_score };
      }
      grouped[date].total++;
      if (r.volatility_score !== null) grouped[date].withV++;
    });

    const sortedDates = Object.keys(grouped).sort().reverse();
    sortedDates.slice(0, 30).forEach((date) => {
      const { total, withV } = grouped[date];
      const pct = ((withV / total) * 100).toFixed(0);
      const status = withV === total ? "✅" : withV > 0 ? "🟨" : "❌";
      console.log(
        `  ${status} ${date}: ${total} レース中 ${withV} 件 (${pct}%)`,
      );
    });

    // 最新の日付
    const latestDate = sortedDates[0];
    const latest = grouped[latestDate];
    console.log(
      `\n🔴 最新日: ${latestDate} (${latest.total} レース中 ${latest.withV} 件 蓄積中)`,
    );
  }

  // 3. volatility_score の分布
  console.log("\n📊 volatility_score の統計：");
  const { data: distribution } = await supabase
    .from("races")
    .select("volatility_score")
    .not("volatility_score", "is", null)
    .limit(50000);

  if (distribution && distribution.length > 0) {
    const scores = distribution
      .map((r) => r.volatility_score)
      .filter((s) => typeof s === "number");
    if (scores.length > 0) {
      const min = Math.min(...scores);
      const max = Math.max(...scores);
      const avg = (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(
        2,
      );
      const mid = scores.sort((a, b) => a - b)[Math.floor(scores.length / 2)];

      console.log(`  最小値: ${min}`);
      console.log(`  中央値: ${mid}`);
      console.log(`  平均値: ${avg}`);
      console.log(`  最大値: ${max}`);

      // 分布（volatility_score は 0-100 スケール）
      const buckets = { low: 0, mid: 0, high: 0 };
      scores.forEach((s) => {
        if (s < 33) buckets.low++;
        else if (s < 67) buckets.mid++;
        else buckets.high++;
      });
      console.log(`\n  分布:`);
      console.log(
        `    Low  (0-33): ${buckets.low} 件 (${((buckets.low / scores.length) * 100).toFixed(1)}%)`,
      );
      console.log(
        `    Mid  (33-67): ${buckets.mid} 件 (${((buckets.mid / scores.length) * 100).toFixed(1)}%)`,
      );
      console.log(
        `    High (67-100): ${buckets.high} 件 (${((buckets.high / scores.length) * 100).toFixed(1)}%)`,
      );
    }
  }
}

checkVolatility().catch(console.error);
