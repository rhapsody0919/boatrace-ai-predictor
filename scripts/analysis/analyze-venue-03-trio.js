/**
 * 江戸川 3連複詳細分析スクリプト
 */

import { supabase, isSupabaseEnabled } from "../lib/supabaseClient.js";

const VENUE_CODE = 3;
const VENUE_NAME = "江戸川";

function catConf(c) {
  if (c >= 80) return "信80↑";
  if (c >= 70) return "信70-79";
  if (c >= 60) return "信60-69";
  return "信60↓";
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
  const hitRate = hits / total;
  const payoutSum = data.reduce((a, d) => a + (d.payout || 0), 0);
  const recoveryRate = (payoutSum / (total * 100)) * 100;
  return {
    total,
    hits,
    hitRate: (hitRate * 100).toFixed(1),
    recoveryRate: recoveryRate.toFixed(1),
    profit: payoutSum - total * 100,
    avgPayout: hits > 0 ? Math.round(payoutSum / hits) : 0,
  };
}

async function analyzeTrio() {
  if (!isSupabaseEnabled()) {
    console.error("❌ Supabase環境変数が未設定です");
    process.exit(1);
  }

  console.log("=".repeat(70));
  console.log(`🎰 ${VENUE_NAME} 3連複詳細分析`);
  console.log("=".repeat(70));

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

  console.log(`\n📊 データ: ${raceIds.length} レース\n`);

  // ===== 分析用データ構造 =====

  // 組み合わせ別
  const byCombination = {};

  // 組み合わせ×信頼度
  const byCombConf = {};

  // 組み合わせ×レース番号
  const byCombRace = {};

  // 1号艇含む/含まない
  const byHas1 = { with_1: [], without_1: [] };

  // 含む艇番パターン
  const byPattern = {};

  // 1号艇級別×組み合わせ
  const by1stGradeComb = {};

  // 高配当分析（配当5000円以上）
  const highPayoutCases = [];

  // ===== データ収集 =====

  for (const pred of predictions) {
    const result = resultsMap[pred.race_id];
    if (!result) continue;

    const raceEntries = entriesMap[pred.race_id] || {};
    const boat1 = raceEntries[1];

    const conf = pred.confidence || 50;
    const raceNo = parseInt(pred.race_id.split("-")[4]);

    // 3連複判定
    const predTop3 = [pred.top_pick, pred.top_2nd, pred.top_3rd].filter(
      Boolean,
    );
    if (predTop3.length !== 3) continue;

    const predSorted = [...predTop3].sort((a, b) => a - b).join("-");
    const resultSorted = [result.rank1, result.rank2, result.rank3]
      .sort((a, b) => a - b)
      .join("-");
    const trioHit = predSorted === resultSorted;
    // payout_trio=3連単・payout_trifecta=3連複（is_hit_* も同じ。列名と中身が逆。079、BOA-536）
    const trioPayout = trioHit ? result.payout_trifecta : 0;

    const record = { hit: trioHit, payout: trioPayout };

    // 組み合わせ別
    if (!byCombination[predSorted]) byCombination[predSorted] = [];
    byCombination[predSorted].push(record);

    // 組み合わせ×信頼度
    const keyCombConf = `${predSorted}_${catConf(conf)}`;
    if (!byCombConf[keyCombConf]) byCombConf[keyCombConf] = [];
    byCombConf[keyCombConf].push(record);

    // 組み合わせ×レース番号
    const keyCombRace = `${predSorted}_${catRaceNo(raceNo)}`;
    if (!byCombRace[keyCombRace]) byCombRace[keyCombRace] = [];
    byCombRace[keyCombRace].push(record);

    // 1号艇含む/含まない
    if (predTop3.includes(1)) {
      byHas1["with_1"].push(record);
    } else {
      byHas1["without_1"].push(record);
    }

    // 含む艇番パターン
    for (const boat of predTop3) {
      const keyPattern = `${boat}号艇含む`;
      if (!byPattern[keyPattern]) byPattern[keyPattern] = [];
      byPattern[keyPattern].push(record);
    }

    // 1号艇の級別×組み合わせ
    const boat1Grade = boat1?.grade || "Unknown";
    const key1stComb = `1号艇=${boat1Grade}_${predSorted}`;
    if (!by1stGradeComb[key1stComb]) by1stGradeComb[key1stComb] = [];
    by1stGradeComb[key1stComb].push(record);

    // 高配当分析
    if (trioHit && trioPayout >= 5000) {
      highPayoutCases.push({
        race_id: pred.race_id,
        combination: predSorted,
        payout: trioPayout,
        confidence: conf,
        race_no: raceNo,
        boat1_grade: boat1Grade,
      });
    }
  }

  // ===== 結果出力 =====

  function printAnalysis(title, dataMap, minSample = 5) {
    console.log(`\n【${title}】`);
    const results = [];
    for (const [key, data] of Object.entries(dataMap)) {
      if (data.length >= minSample) {
        const stats = calcStats(data);
        if (stats) results.push({ key, ...stats });
      }
    }
    results.sort(
      (a, b) => parseFloat(b.recoveryRate) - parseFloat(a.recoveryRate),
    );

    if (results.length === 0) {
      console.log("  データなし");
      return [];
    }

    for (const r of results.slice(0, 20)) {
      const marker = parseFloat(r.recoveryRate) >= 100 ? "🔥" : "  ";
      console.log(
        `${marker} ${r.key.padEnd(30)} | ${r.total.toString().padStart(3)}R | 的中${r.hitRate.padStart(5)}% | 回収${r.recoveryRate.padStart(7)}% | 平均配当${r.avgPayout}円`,
      );
    }

    return results.filter((r) => parseFloat(r.recoveryRate) >= 100);
  }

  console.log("\n" + "─".repeat(70));
  console.log("🎰 3連複 組み合わせ別分析");
  console.log("─".repeat(70));

  const p1 = printAnalysis("組み合わせ別（回収率順）", byCombination);

  console.log("\n" + "─".repeat(70));
  console.log("🎰 3連複 条件別分析");
  console.log("─".repeat(70));

  const p2 = printAnalysis("1号艇含む/含まない", byHas1);
  const p3 = printAnalysis("含む艇番パターン", byPattern);

  console.log("\n" + "─".repeat(70));
  console.log("🎰 3連複 組み合わせ×信頼度");
  console.log("─".repeat(70));

  const p4 = printAnalysis("組み合わせ×信頼度", byCombConf, 3);

  console.log("\n" + "─".repeat(70));
  console.log("🎰 3連複 組み合わせ×レース番号");
  console.log("─".repeat(70));

  const p5 = printAnalysis("組み合わせ×レース番号", byCombRace, 3);

  console.log("\n" + "─".repeat(70));
  console.log("🎰 3連複 1号艇の級別×組み合わせ");
  console.log("─".repeat(70));

  const p6 = printAnalysis("1号艇の級別×組み合わせ", by1stGradeComb, 3);

  // 高配当分析
  console.log("\n" + "─".repeat(70));
  console.log("💰 高配当的中（5000円以上）");
  console.log("─".repeat(70));

  if (highPayoutCases.length > 0) {
    highPayoutCases.sort((a, b) => b.payout - a.payout);
    for (const c of highPayoutCases.slice(0, 15)) {
      console.log(
        `  ${c.race_id} | ${c.combination} | ${c.payout.toLocaleString()}円 | 信頼度${c.confidence} | ${c.race_no}R | 1号艇=${c.boat1_grade}`,
      );
    }

    // 高配当の傾向分析
    console.log("\n【高配当的中の傾向】");
    const confDist = {};
    const combDist = {};
    for (const c of highPayoutCases) {
      const confCat = catConf(c.confidence);
      confDist[confCat] = (confDist[confCat] || 0) + 1;
      combDist[c.combination] = (combDist[c.combination] || 0) + 1;
    }
    console.log("  信頼度分布:", confDist);
    console.log("  組み合わせ分布:", combDist);
  } else {
    console.log("  該当なし");
  }

  // ===== サマリー =====
  console.log("\n" + "=".repeat(70));
  console.log("📊 3連複分析サマリー");
  console.log("=".repeat(70));

  const allProfitable = [
    ...p1.map((p) => ({ ...p, cat: "組み合わせ" })),
    ...p2.map((p) => ({ ...p, cat: "1号艇有無" })),
    ...p3.map((p) => ({ ...p, cat: "艇番パターン" })),
    ...p4.map((p) => ({ ...p, cat: "組み合わせ×信頼度" })),
    ...p5.map((p) => ({ ...p, cat: "組み合わせ×レースNo" })),
    ...p6.map((p) => ({ ...p, cat: "1号艇級別×組み合わせ" })),
  ];

  allProfitable.sort((a, b) => b.total - a.total);

  console.log("\n【回収率100%超え条件（サンプル数順）】");
  for (const p of allProfitable.filter((x) => x.total >= 10).slice(0, 20)) {
    console.log(
      `  ${p.cat.padEnd(18)} | ${p.key.padEnd(25)} | ${p.total.toString().padStart(3)}R | 回収${p.recoveryRate}% | 平均${p.avgPayout}円`,
    );
  }

  // 推奨ルール
  console.log("\n【3連複 推奨ルール】");
  const reliableRules = allProfitable.filter(
    (p) => p.total >= 15 && parseFloat(p.recoveryRate) >= 200,
  );
  if (reliableRules.length > 0) {
    for (const r of reliableRules) {
      console.log(
        `  ✅ ${r.key}: 回収率${r.recoveryRate}% (${r.total}R, 平均配当${r.avgPayout}円)`,
      );
    }
  } else {
    console.log("  n≥15かつ回収率200%以上の条件はなし");
    console.log("  → 条件を緩和して確認:");
    const relaxed = allProfitable.filter(
      (p) => p.total >= 10 && parseFloat(p.recoveryRate) >= 150,
    );
    for (const r of relaxed.slice(0, 5)) {
      console.log(`     ${r.key}: 回収率${r.recoveryRate}% (${r.total}R)`);
    }
  }

  console.log("\n" + "=".repeat(70));
  console.log("分析完了");
  console.log("=".repeat(70));
}

analyzeTrio().catch(console.error);
