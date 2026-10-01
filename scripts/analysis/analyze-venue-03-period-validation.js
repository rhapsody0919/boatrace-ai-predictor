/**
 * 江戸川 期間分割検証スクリプト
 * 100レースずつに分割してルールの再現性を確認
 */

import { supabase, isSupabaseEnabled } from "../lib/supabaseClient.js";

const VENUE_CODE = 3;
const VENUE_NAME = "江戸川";
const CHUNK_SIZE = 100;

function catConf(c) {
  if (c >= 80) return "信80↑";
  if (c >= 70) return "信70-79";
  return "信70↓";
}

function catRaceNo(rno) {
  if (rno <= 4) return "前半(1-4R)";
  if (rno <= 8) return "中盤(5-8R)";
  return "後半(9-12R)";
}

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
  };
}

// ルール適用関数
const RULES = {
  // === 単勝ルール ===
  "E03-W001: 2号艇×信頼度70-79×M35↓": (pred, entries, result) => {
    if (pred.top_pick !== 2) return null;
    const conf = pred.confidence || 50;
    if (conf < 70 || conf >= 80) return null;
    const boat = entries[pred.top_pick];
    if (!boat || boat.motor_2rate === null || boat.motor_2rate > 35)
      return null;
    const hit = result.rank1 === pred.top_pick;
    return { hit, payout: hit ? result.payout_win : 0 };
  },

  "E03-W002: 2号艇×前半レース": (pred, entries, result, raceNo) => {
    if (pred.top_pick !== 2) return null;
    if (raceNo > 4) return null;
    const hit = result.rank1 === pred.top_pick;
    return { hit, payout: hit ? result.payout_win : 0 };
  },

  "E03-W003: 3-1予測×信頼度70↑": (pred, entries, result) => {
    if (pred.top_pick !== 3 || pred.top_2nd !== 1) return null;
    const conf = pred.confidence || 50;
    if (conf < 70) return null;
    const hit = result.rank1 === pred.top_pick;
    return { hit, payout: hit ? result.payout_win : 0 };
  },

  "E03-W004: 1号艇B級×2号艇予測": (pred, entries, result) => {
    if (pred.top_pick !== 2) return null;
    const boat1 = entries[1];
    if (!boat1 || !["B1", "B2"].includes(boat1.grade)) return null;
    const hit = result.rank1 === pred.top_pick;
    return { hit, payout: hit ? result.payout_win : 0 };
  },

  "E03-W006: 1号艇非A1×信頼度70-79": (pred, entries, result) => {
    const conf = pred.confidence || 50;
    if (conf < 70 || conf >= 80) return null;
    const boat1 = entries[1];
    if (boat1?.grade === "A1") return null;
    const hit = result.rank1 === pred.top_pick;
    return { hit, payout: hit ? result.payout_win : 0 };
  },

  // === 複勝ルール ===
  "E03-P001: 1号艇予測（複勝）": (pred, entries, result) => {
    if (pred.top_pick !== 1) return null;
    let payout = 0;
    if (result.rank1 === pred.top_pick) {
      payout = result.payout_place_1 || 0;
    } else if (result.rank2 === pred.top_pick) {
      payout = result.payout_place_2 || 0;
    }
    const hit = payout > 0;
    return { hit, payout };
  },

  "E03-P002: 1号艇×後半レース（複勝）": (pred, entries, result, raceNo) => {
    if (pred.top_pick !== 1) return null;
    if (raceNo < 9) return null;
    let payout = 0;
    if (result.rank1 === pred.top_pick) {
      payout = result.payout_place_1 || 0;
    } else if (result.rank2 === pred.top_pick) {
      payout = result.payout_place_2 || 0;
    }
    const hit = payout > 0;
    return { hit, payout };
  },

  // === 3連複ルール ===
  "E03-T001: 1-2-4組み合わせ": (pred, entries, result) => {
    const predTop3 = [pred.top_pick, pred.top_2nd, pred.top_3rd].filter(
      Boolean,
    );
    if (predTop3.length !== 3) return null;
    const predSorted = [...predTop3].sort((a, b) => a - b).join("-");
    if (predSorted !== "1-2-4") return null;
    const resultSorted = [result.rank1, result.rank2, result.rank3]
      .sort((a, b) => a - b)
      .join("-");
    const hit = predSorted === resultSorted;
    // payout_trio=3連単・payout_trifecta=3連複（is_hit_* も同じ。列名と中身が逆。079、BOA-536）
    return { hit, payout: hit ? result.payout_trifecta : 0 };
  },

  "E03-T002: 1-2-3組み合わせ": (pred, entries, result) => {
    const predTop3 = [pred.top_pick, pred.top_2nd, pred.top_3rd].filter(
      Boolean,
    );
    if (predTop3.length !== 3) return null;
    const predSorted = [...predTop3].sort((a, b) => a - b).join("-");
    if (predSorted !== "1-2-3") return null;
    const resultSorted = [result.rank1, result.rank2, result.rank3]
      .sort((a, b) => a - b)
      .join("-");
    const hit = predSorted === resultSorted;
    return { hit, payout: hit ? result.payout_trifecta : 0 };
  },

  "E03-T003: 1-2-4×後半レース": (pred, entries, result, raceNo) => {
    if (raceNo < 9) return null;
    const predTop3 = [pred.top_pick, pred.top_2nd, pred.top_3rd].filter(
      Boolean,
    );
    if (predTop3.length !== 3) return null;
    const predSorted = [...predTop3].sort((a, b) => a - b).join("-");
    if (predSorted !== "1-2-4") return null;
    const resultSorted = [result.rank1, result.rank2, result.rank3]
      .sort((a, b) => a - b)
      .join("-");
    const hit = predSorted === resultSorted;
    return { hit, payout: hit ? result.payout_trifecta : 0 };
  },

  "E03-T004: 1号艇含む予測（3連複）": (pred, entries, result) => {
    const predTop3 = [pred.top_pick, pred.top_2nd, pred.top_3rd].filter(
      Boolean,
    );
    if (predTop3.length !== 3) return null;
    if (!predTop3.includes(1)) return null;
    const predSorted = [...predTop3].sort((a, b) => a - b).join("-");
    const resultSorted = [result.rank1, result.rank2, result.rank3]
      .sort((a, b) => a - b)
      .join("-");
    const hit = predSorted === resultSorted;
    return { hit, payout: hit ? result.payout_trifecta : 0 };
  },
};

async function validatePeriods() {
  if (!isSupabaseEnabled()) {
    console.error("❌ Supabase環境変数が未設定です");
    process.exit(1);
  }

  console.log("=".repeat(80));
  console.log(`📊 ${VENUE_NAME} 期間分割検証（${CHUNK_SIZE}レースずつ）`);
  console.log("=".repeat(80));

  const venueCodeStr = String(VENUE_CODE).padStart(2, "0");

  // データ取得
  const { data: predictions } = await supabase
    .from("predictions")
    .select("race_id, model_id, top_pick, top_2nd, top_3rd, confidence")
    .like("race_id", `%-${venueCodeStr}-%`)
    .eq("model_id", "standard")
    .order("race_id", { ascending: true });

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

  // レースIDでソート（日付順）
  const sortedRaceIds = raceIds.sort();

  // チャンクに分割
  const chunks = [];
  for (let i = 0; i < sortedRaceIds.length; i += CHUNK_SIZE) {
    chunks.push(sortedRaceIds.slice(i, i + CHUNK_SIZE));
  }

  console.log(`\n総レース数: ${sortedRaceIds.length}`);
  console.log(`チャンク数: ${chunks.length}（各${CHUNK_SIZE}レース）`);
  console.log(
    `期間: ${sortedRaceIds[0]} 〜 ${sortedRaceIds[sortedRaceIds.length - 1]}\n`,
  );

  // 各チャンクの期間を表示
  console.log("【チャンク期間】");
  chunks.forEach((chunk, i) => {
    const start = chunk[0].split("-").slice(0, 3).join("-");
    const end = chunk[chunk.length - 1].split("-").slice(0, 3).join("-");
    console.log(`  Period ${i + 1}: ${start} 〜 ${end} (${chunk.length}R)`);
  });

  // 各ルールの期間別検証
  console.log("\n" + "─".repeat(80));
  console.log("📊 ルール別 期間分割検証");
  console.log("─".repeat(80));

  const ruleResults = {};

  for (const [ruleName, ruleFunc] of Object.entries(RULES)) {
    ruleResults[ruleName] = {
      periods: [],
      overall: { data: [] },
    };

    // 各期間で検証
    for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx++) {
      const chunkRaceIds = chunks[chunkIdx];
      const periodData = [];

      for (const raceId of chunkRaceIds) {
        const pred = predictions.find((p) => p.race_id === raceId);
        if (!pred) continue;

        const result = resultsMap[raceId];
        if (!result) continue;

        const raceEntries = entriesMap[raceId] || {};
        const raceNo = parseInt(raceId.split("-")[4]);

        const ruleResult = ruleFunc(pred, raceEntries, result, raceNo);
        if (ruleResult) {
          periodData.push(ruleResult);
          ruleResults[ruleName].overall.data.push(ruleResult);
        }
      }

      ruleResults[ruleName].periods.push({
        index: chunkIdx + 1,
        data: periodData,
      });
    }
  }

  // 結果出力
  for (const [ruleName, data] of Object.entries(ruleResults)) {
    const overallStats = calcStats(data.overall.data);
    if (!overallStats || overallStats.total < 5) continue;

    console.log(`\n【${ruleName}】`);
    console.log(
      `  全体: ${overallStats.total}R | 的中${overallStats.hitRate}% | 回収${overallStats.recoveryRate}%`,
    );
    console.log("  ─────────────────────────────────────────────────────");

    // 期間別
    let profitablePeriods = 0;
    const periodRecoveries = [];

    for (const period of data.periods) {
      const stats = calcStats(period.data);
      if (!stats || stats.total === 0) {
        console.log(`  Period ${period.index}: データなし`);
        continue;
      }

      const recovery = parseFloat(stats.recoveryRate);
      periodRecoveries.push(recovery);
      const marker = recovery >= 100 ? "🔥" : "  ";
      if (recovery >= 100) profitablePeriods++;

      console.log(
        `${marker} Period ${period.index}: ${stats.total.toString().padStart(3)}R | 的中${stats.hitRate.padStart(5)}% | 回収${stats.recoveryRate.padStart(7)}%`,
      );
    }

    // 再現性評価
    const consistency = (profitablePeriods / data.periods.length) * 100;
    const avgRecovery =
      periodRecoveries.reduce((a, b) => a + b, 0) / periodRecoveries.length;
    const minRecovery = Math.min(...periodRecoveries);
    const maxRecovery = Math.max(...periodRecoveries);

    console.log("  ─────────────────────────────────────────────────────");
    console.log(
      `  再現率: ${profitablePeriods}/${data.periods.length} (${consistency.toFixed(0)}%)`,
    );
    console.log(
      `  回収率: 平均${avgRecovery.toFixed(1)}% | 最小${minRecovery.toFixed(1)}% | 最大${maxRecovery.toFixed(1)}%`,
    );

    // 判定
    let verdict;
    if (consistency >= 60 && avgRecovery >= 100) {
      verdict = "✅ 高信頼（再現率60%↑ & 平均100%↑）";
    } else if (consistency >= 40 && avgRecovery >= 100) {
      verdict = "⚠️ 中信頼（再現率40%↑ & 平均100%↑）";
    } else if (avgRecovery >= 100) {
      verdict = "⚠️ 要注意（平均100%↑だが再現率低）";
    } else {
      verdict = "❌ 非推奨（平均回収率100%未満）";
    }
    console.log(`  判定: ${verdict}`);
  }

  // ===== サマリー =====
  console.log("\n" + "=".repeat(80));
  console.log("📊 再現性サマリー");
  console.log("=".repeat(80));

  const summaryData = [];

  for (const [ruleName, data] of Object.entries(ruleResults)) {
    const overallStats = calcStats(data.overall.data);
    if (!overallStats || overallStats.total < 5) continue;

    let profitablePeriods = 0;
    const periodRecoveries = [];

    for (const period of data.periods) {
      const stats = calcStats(period.data);
      if (stats && stats.total > 0) {
        const recovery = parseFloat(stats.recoveryRate);
        periodRecoveries.push(recovery);
        if (recovery >= 100) profitablePeriods++;
      }
    }

    const consistency = (profitablePeriods / data.periods.length) * 100;
    const avgRecovery =
      periodRecoveries.length > 0
        ? periodRecoveries.reduce((a, b) => a + b, 0) / periodRecoveries.length
        : 0;

    summaryData.push({
      rule: ruleName,
      total: overallStats.total,
      overallRecovery: parseFloat(overallStats.recoveryRate),
      consistency,
      profitablePeriods,
      totalPeriods: data.periods.length,
      avgRecovery,
    });
  }

  // 再現率順でソート
  summaryData.sort((a, b) => b.consistency - a.consistency);

  console.log("\n【再現率順】");
  console.log(
    "ルール名                                    | 全体回収率 | 再現率 | 平均回収率",
  );
  console.log("─".repeat(80));

  for (const s of summaryData) {
    const shortName = s.rule.substring(0, 40).padEnd(40);
    const marker =
      s.consistency >= 60 && s.avgRecovery >= 100
        ? "⭐"
        : s.consistency >= 40 && s.avgRecovery >= 100
          ? "  "
          : "  ";
    console.log(
      `${marker} ${shortName} | ${s.overallRecovery.toFixed(1).padStart(7)}% | ${s.consistency.toFixed(0).padStart(3)}% (${s.profitablePeriods}/${s.totalPeriods}) | ${s.avgRecovery.toFixed(1)}%`,
    );
  }

  // 推奨ルール
  console.log("\n【信頼できるルール（再現率60%↑ & 平均100%↑）】");
  const reliable = summaryData.filter(
    (s) => s.consistency >= 60 && s.avgRecovery >= 100,
  );
  if (reliable.length > 0) {
    for (const s of reliable) {
      console.log(`  ⭐ ${s.rule}`);
      console.log(
        `     全体: ${s.overallRecovery.toFixed(1)}% | 再現率: ${s.consistency.toFixed(0)}% | 平均: ${s.avgRecovery.toFixed(1)}%`,
      );
    }
  } else {
    console.log("  該当なし");
  }

  console.log("\n【要検証ルール（再現率40%↑ & 平均100%↑）】");
  const tentative = summaryData.filter(
    (s) => s.consistency >= 40 && s.consistency < 60 && s.avgRecovery >= 100,
  );
  if (tentative.length > 0) {
    for (const s of tentative) {
      console.log(`  ⚠️ ${s.rule}`);
      console.log(
        `     全体: ${s.overallRecovery.toFixed(1)}% | 再現率: ${s.consistency.toFixed(0)}% | 平均: ${s.avgRecovery.toFixed(1)}%`,
      );
    }
  } else {
    console.log("  該当なし");
  }

  console.log("\n" + "=".repeat(80));
  console.log("検証完了");
  console.log("=".repeat(80));
}

validatePeriods().catch(console.error);
