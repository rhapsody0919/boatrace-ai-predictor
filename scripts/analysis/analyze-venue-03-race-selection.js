/**
 * 江戸川 レース厳選分析スクリプト
 * 複数条件を組み合わせて最適なレース選択を探る
 */

import { supabase, isSupabaseEnabled } from "../lib/supabaseClient.js";

const VENUE_CODE = 3;
const VENUE_NAME = "江戸川";

function calcStats(data) {
  if (data.length === 0) return null;
  const total = data.length;
  const hits = data.filter((d) => d.hit).length;
  const payoutSum = data.reduce((a, d) => a + (d.payout || 0), 0);
  const recoveryRate = (payoutSum / (total * 100)) * 100;
  return {
    total,
    hits,
    hitRate: ((hits / total) * 100).toFixed(1),
    recoveryRate: recoveryRate.toFixed(1),
    profit: payoutSum - total * 100,
    avgPayout: hits > 0 ? Math.round(payoutSum / hits) : 0,
  };
}

async function analyzeRaceSelection() {
  if (!isSupabaseEnabled()) {
    console.error("❌ Supabase環境変数が未設定です");
    process.exit(1);
  }

  console.log("=".repeat(80));
  console.log(`🎯 ${VENUE_NAME} レース厳選分析`);
  console.log("=".repeat(80));

  const venueCodeStr = String(VENUE_CODE).padStart(2, "0");

  // データ取得
  const { data: predictions } = await supabase
    .from("predictions")
    .select("race_id, model_id, top_pick, top_2nd, top_3rd, confidence")
    .like("race_id", `%-${venueCodeStr}-%`)
    .eq("model_id", "standard");

  const raceIds = [...new Set(predictions.map((p) => p.race_id))];

  const { data: results } = await supabase
    .from("race_results")
    .select("*")
    .in("race_id", raceIds);

  const { data: entries } = await supabase
    .from("race_entries")
    .select("race_id, boat_number, grade, win_rate, motor_2rate")
    .in("race_id", raceIds);

  // マップ化
  const resultsMap = {};
  results?.forEach((r) => {
    resultsMap[r.race_id] = r;
  });

  const entriesMap = {};
  entries?.forEach((e) => {
    if (!entriesMap[e.race_id]) entriesMap[e.race_id] = {};
    entriesMap[e.race_id][e.boat_number] = e;
  });

  console.log(`\n📊 総データ: ${raceIds.length} レース\n`);

  // レースごとの属性を計算
  const raceData = [];

  for (const pred of predictions) {
    const result = resultsMap[pred.race_id];
    if (!result) continue;

    const raceEntries = entriesMap[pred.race_id] || {};
    const raceNo = parseInt(pred.race_id.split("-")[4]);
    const conf = pred.confidence || 50;

    const predTop3 = [pred.top_pick, pred.top_2nd, pred.top_3rd].filter(
      Boolean,
    );
    if (predTop3.length !== 3) continue;

    const predSorted = [...predTop3].sort((a, b) => a - b).join("-");
    const resultSorted = [result.rank1, result.rank2, result.rank3]
      .sort((a, b) => a - b)
      .join("-");
    const trioHit = predSorted === resultSorted;
    const trioPayout = trioHit ? result.payout_trio : 0;

    // 1号艇の属性
    const boat1 = raceEntries[1];
    const boat1Grade = boat1?.grade || "Unknown";
    const boat1Motor = boat1?.motor_2rate;

    // 予測艇の属性
    const topPickBoat = raceEntries[pred.top_pick];
    const topPickMotor = topPickBoat?.motor_2rate;

    raceData.push({
      race_id: pred.race_id,
      raceNo,
      conf,
      predSorted,
      has1: predTop3.includes(1),
      boat1Grade,
      boat1Motor,
      topPick: pred.top_pick,
      topPickMotor,
      trioHit,
      trioPayout,
      // 複勝用
      placeHit:
        result.rank1 === pred.top_pick || result.rank2 === pred.top_pick,
      placePayout:
        result.rank1 === pred.top_pick
          ? result.payout_place_1
          : result.rank2 === pred.top_pick
            ? result.payout_place_2
            : 0,
    });
  }

  // ===== 分析1: 3連複のレース厳選 =====
  console.log("─".repeat(80));
  console.log("📊 分析1: 3連複 レース厳選条件");
  console.log("─".repeat(80));

  // ベースライン
  const baselineTrio = raceData.filter((r) => r.predSorted === "1-2-4");
  const baselineStats = calcStats(
    baselineTrio.map((r) => ({ hit: r.trioHit, payout: r.trioPayout })),
  );
  console.log(`\n【ベースライン: 1-2-4組み合わせ】`);
  console.log(
    `  全体: ${baselineStats.total}R | 回収${baselineStats.recoveryRate}%\n`,
  );

  // 条件組み合わせ
  const trioFilters = [
    // 信頼度
    { name: "信頼度80↑", filter: (r) => r.conf >= 80 },
    { name: "信頼度70-79", filter: (r) => r.conf >= 70 && r.conf < 80 },
    { name: "信頼度85↑", filter: (r) => r.conf >= 85 },

    // レース番号
    { name: "後半(9-12R)", filter: (r) => r.raceNo >= 9 },
    { name: "中盤(5-8R)", filter: (r) => r.raceNo >= 5 && r.raceNo <= 8 },
    { name: "前半(1-4R)", filter: (r) => r.raceNo <= 4 },
    { name: "10-12R", filter: (r) => r.raceNo >= 10 },

    // 組み合わせ
    { name: "信頼度80↑ × 後半", filter: (r) => r.conf >= 80 && r.raceNo >= 9 },
    {
      name: "信頼度80↑ × 中盤",
      filter: (r) => r.conf >= 80 && r.raceNo >= 5 && r.raceNo <= 8,
    },
    { name: "信頼度85↑ × 後半", filter: (r) => r.conf >= 85 && r.raceNo >= 9 },
    {
      name: "信頼度70-79 × 後半",
      filter: (r) => r.conf >= 70 && r.conf < 80 && r.raceNo >= 9,
    },

    // 1号艇の状態
    { name: "1号艇 非A1", filter: (r) => r.boat1Grade !== "A1" },
    { name: "1号艇 B級", filter: (r) => ["B1", "B2"].includes(r.boat1Grade) },

    // 複合
    {
      name: "信頼度80↑ × 後半 × 非A1",
      filter: (r) => r.conf >= 80 && r.raceNo >= 9 && r.boat1Grade !== "A1",
    },
    {
      name: "10-12R × 信頼度80↑",
      filter: (r) => r.raceNo >= 10 && r.conf >= 80,
    },
  ];

  console.log("【1-2-4 に追加条件を加えた場合】");
  const trioResults = [];

  for (const { name, filter } of trioFilters) {
    const filtered = baselineTrio.filter(filter);
    if (filtered.length >= 5) {
      const stats = calcStats(
        filtered.map((r) => ({ hit: r.trioHit, payout: r.trioPayout })),
      );
      trioResults.push({ name, ...stats });
    }
  }

  trioResults.sort(
    (a, b) => parseFloat(b.recoveryRate) - parseFloat(a.recoveryRate),
  );

  for (const r of trioResults) {
    const diff = (
      parseFloat(r.recoveryRate) - parseFloat(baselineStats.recoveryRate)
    ).toFixed(1);
    const marker =
      parseFloat(r.recoveryRate) > parseFloat(baselineStats.recoveryRate)
        ? "🔥"
        : "  ";
    console.log(
      `${marker} ${r.name.padEnd(30)} | ${r.total.toString().padStart(3)}R | 回収${r.recoveryRate.padStart(7)}% | 差${diff > 0 ? "+" : ""}${diff}%`,
    );
  }

  // ===== 分析2: 1号艇含む（汎用）のレース厳選 =====
  console.log("\n" + "─".repeat(80));
  console.log("📊 分析2: 1号艇含む（汎用）レース厳選条件");
  console.log("─".repeat(80));

  const baselineWith1 = raceData.filter((r) => r.has1);
  const baselineWith1Stats = calcStats(
    baselineWith1.map((r) => ({ hit: r.trioHit, payout: r.trioPayout })),
  );
  console.log(`\n【ベースライン: 1号艇含む予測】`);
  console.log(
    `  全体: ${baselineWith1Stats.total}R | 回収${baselineWith1Stats.recoveryRate}%\n`,
  );

  console.log("【1号艇含む に追加条件を加えた場合】");
  const with1Results = [];

  for (const { name, filter } of trioFilters) {
    const filtered = baselineWith1.filter(filter);
    if (filtered.length >= 10) {
      const stats = calcStats(
        filtered.map((r) => ({ hit: r.trioHit, payout: r.trioPayout })),
      );
      with1Results.push({ name, ...stats });
    }
  }

  with1Results.sort(
    (a, b) => parseFloat(b.recoveryRate) - parseFloat(a.recoveryRate),
  );

  for (const r of with1Results) {
    const diff = (
      parseFloat(r.recoveryRate) - parseFloat(baselineWith1Stats.recoveryRate)
    ).toFixed(1);
    const marker =
      parseFloat(r.recoveryRate) > parseFloat(baselineWith1Stats.recoveryRate)
        ? "🔥"
        : "  ";
    console.log(
      `${marker} ${r.name.padEnd(30)} | ${r.total.toString().padStart(3)}R | 回収${r.recoveryRate.padStart(7)}% | 差${diff > 0 ? "+" : ""}${diff}%`,
    );
  }

  // ===== 分析3: 複勝のレース厳選 =====
  console.log("\n" + "─".repeat(80));
  console.log("📊 分析3: 複勝（1号艇×後半）レース厳選条件");
  console.log("─".repeat(80));

  const baselinePlace = raceData.filter(
    (r) => r.topPick === 1 && r.raceNo >= 9,
  );
  const basePlaceStats = calcStats(
    baselinePlace.map((r) => ({ hit: r.placeHit, payout: r.placePayout })),
  );
  console.log(`\n【ベースライン: 1号艇×後半】`);
  console.log(
    `  全体: ${basePlaceStats.total}R | 回収${basePlaceStats.recoveryRate}%\n`,
  );

  const placeFilters = [
    { name: "信頼度80↑", filter: (r) => r.conf >= 80 },
    { name: "信頼度85↑", filter: (r) => r.conf >= 85 },
    { name: "信頼度90↑", filter: (r) => r.conf >= 90 },
    { name: "10-12R", filter: (r) => r.raceNo >= 10 },
    { name: "11-12R", filter: (r) => r.raceNo >= 11 },
    { name: "12R", filter: (r) => r.raceNo === 12 },
    {
      name: "信頼度85↑ × 10-12R",
      filter: (r) => r.conf >= 85 && r.raceNo >= 10,
    },
    {
      name: "信頼度80↑ × 11-12R",
      filter: (r) => r.conf >= 80 && r.raceNo >= 11,
    },
  ];

  console.log("【1号艇×後半 に追加条件を加えた場合】");
  const placeResults = [];

  for (const { name, filter } of placeFilters) {
    const filtered = baselinePlace.filter(filter);
    if (filtered.length >= 5) {
      const stats = calcStats(
        filtered.map((r) => ({ hit: r.placeHit, payout: r.placePayout })),
      );
      placeResults.push({ name, ...stats });
    }
  }

  placeResults.sort(
    (a, b) => parseFloat(b.recoveryRate) - parseFloat(a.recoveryRate),
  );

  for (const r of placeResults) {
    const diff = (
      parseFloat(r.recoveryRate) - parseFloat(basePlaceStats.recoveryRate)
    ).toFixed(1);
    const marker =
      parseFloat(r.recoveryRate) > parseFloat(basePlaceStats.recoveryRate)
        ? "🔥"
        : "  ";
    console.log(
      `${marker} ${r.name.padEnd(30)} | ${r.total.toString().padStart(3)}R | 回収${r.recoveryRate.padStart(7)}% | 差${diff > 0 ? "+" : ""}${diff}%`,
    );
  }

  // ===== 分析4: 最適な組み合わせを探索 =====
  console.log("\n" + "─".repeat(80));
  console.log("📊 分析4: 高回収率条件の探索（3連複全体）");
  console.log("─".repeat(80));

  const allTrioFilters = [
    // 組み合わせ × 条件
    {
      name: "1-2-4 × 後半 × 信頼度80↑",
      filter: (r) => r.predSorted === "1-2-4" && r.raceNo >= 9 && r.conf >= 80,
    },
    {
      name: "1-2-3 × 後半 × 信頼度80↑",
      filter: (r) => r.predSorted === "1-2-3" && r.raceNo >= 9 && r.conf >= 80,
    },
    {
      name: "1-2-4 × 10-12R",
      filter: (r) => r.predSorted === "1-2-4" && r.raceNo >= 10,
    },
    {
      name: "1-2-3 × 10-12R",
      filter: (r) => r.predSorted === "1-2-3" && r.raceNo >= 10,
    },
    {
      name: "1-2-4 × 中盤 × 信頼度85↑",
      filter: (r) =>
        r.predSorted === "1-2-4" &&
        r.raceNo >= 5 &&
        r.raceNo <= 8 &&
        r.conf >= 85,
    },

    // 1号艇含む × 条件
    {
      name: "1号艇含む × 後半 × 信頼度80↑",
      filter: (r) => r.has1 && r.raceNo >= 9 && r.conf >= 80,
    },
    {
      name: "1号艇含む × 10-12R × 信頼度80↑",
      filter: (r) => r.has1 && r.raceNo >= 10 && r.conf >= 80,
    },
    {
      name: "1号艇含む × 後半 × 非A1",
      filter: (r) => r.has1 && r.raceNo >= 9 && r.boat1Grade !== "A1",
    },
    {
      name: "1号艇含む × 中盤後半 × 信頼度85↑",
      filter: (r) => r.has1 && r.raceNo >= 5 && r.conf >= 85,
    },

    // 特殊条件
    {
      name: "1-2-4 or 1-2-3 × 後半",
      filter: (r) => ["1-2-4", "1-2-3"].includes(r.predSorted) && r.raceNo >= 9,
    },
    {
      name: "1-2-4 or 1-2-3 × 後半 × 信頼度80↑",
      filter: (r) =>
        ["1-2-4", "1-2-3"].includes(r.predSorted) &&
        r.raceNo >= 9 &&
        r.conf >= 80,
    },
    { name: "1号艇含む × 信頼度85↑", filter: (r) => r.has1 && r.conf >= 85 },
    { name: "1号艇含む × 信頼度90↑", filter: (r) => r.has1 && r.conf >= 90 },
  ];

  console.log("\n【高回収率条件一覧】");
  const allTrioResults = [];

  for (const { name, filter } of allTrioFilters) {
    const filtered = raceData.filter(filter);
    if (filtered.length >= 5) {
      const stats = calcStats(
        filtered.map((r) => ({ hit: r.trioHit, payout: r.trioPayout })),
      );
      allTrioResults.push({ name, ...stats });
    }
  }

  allTrioResults.sort(
    (a, b) => parseFloat(b.recoveryRate) - parseFloat(a.recoveryRate),
  );

  for (const r of allTrioResults) {
    const marker =
      parseFloat(r.recoveryRate) >= 500
        ? "⭐"
        : parseFloat(r.recoveryRate) >= 400
          ? "🔥"
          : "  ";
    console.log(
      `${marker} ${r.name.padEnd(40)} | ${r.total.toString().padStart(3)}R | 回収${r.recoveryRate.padStart(7)}% | 的中${r.hitRate}%`,
    );
  }

  // ===== サマリー =====
  console.log("\n" + "=".repeat(80));
  console.log("📊 レース厳選サマリー");
  console.log("=".repeat(80));

  console.log("\n【厳選によるトレードオフ】");
  console.log("  厳選強化 → 回収率UP、レース数DOWN");
  console.log("  厳選緩和 → 回収率DOWN、レース数UP");

  console.log("\n【推奨厳選ルール】");

  // 最も効率的な条件を抽出
  const efficient = allTrioResults.filter(
    (r) => parseFloat(r.recoveryRate) >= 500 && r.total >= 10,
  );

  if (efficient.length > 0) {
    console.log("\n  ⭐ 高効率（回収率500%↑ & 10R以上）:");
    for (const r of efficient) {
      console.log(`     ${r.name}: ${r.recoveryRate}% (${r.total}R)`);
    }
  }

  const balanced = allTrioResults.filter(
    (r) => parseFloat(r.recoveryRate) >= 400 && r.total >= 20,
  );

  if (balanced.length > 0) {
    console.log("\n  🔥 バランス型（回収率400%↑ & 20R以上）:");
    for (const r of balanced) {
      console.log(`     ${r.name}: ${r.recoveryRate}% (${r.total}R)`);
    }
  }

  console.log("\n" + "=".repeat(80));
  console.log("分析完了");
  console.log("=".repeat(80));
}

analyzeRaceSelection().catch(console.error);
