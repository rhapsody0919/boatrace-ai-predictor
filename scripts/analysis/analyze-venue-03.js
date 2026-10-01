/**
 * 江戸川（会場コード: 03）詳細分析スクリプト
 *
 * 目的: 回収率100%超えの条件を詳細に分析し、ベッティングルールを確立する
 */

import { supabase, isSupabaseEnabled } from "../lib/supabaseClient.js";

const VENUE_CODE = 3;
const VENUE_NAME = "江戸川";

// ===== ユーティリティ関数 =====

function categorizeWinRate(winRate) {
  if (winRate >= 7.0) return "7.0↑";
  if (winRate >= 6.5) return "6.5-6.9";
  if (winRate >= 6.0) return "6.0-6.4";
  if (winRate >= 5.5) return "5.5-5.9";
  if (winRate >= 5.0) return "5.0-5.4";
  if (winRate >= 4.5) return "4.5-4.9";
  return "4.5↓";
}

function categorizeMotor(motor2rate) {
  if (motor2rate >= 50) return "50↑";
  if (motor2rate >= 45) return "45-49";
  if (motor2rate >= 40) return "40-44";
  if (motor2rate >= 35) return "35-39";
  if (motor2rate >= 30) return "30-34";
  return "30↓";
}

function categorizeConfidence(conf) {
  if (conf >= 80) return "80↑";
  if (conf >= 70) return "70-79";
  if (conf >= 60) return "60-69";
  if (conf >= 50) return "50-59";
  return "50↓";
}

function calcStats(data) {
  if (data.length === 0) return null;
  const total = data.length;
  const hits = data.filter((d) => d.hit).length;
  const hitRate = hits / total;
  const payoutSum = data.reduce((a, d) => a + (d.payout || 0), 0);
  const recoveryRate = (payoutSum / (total * 100)) * 100;
  const avgPayout = hits > 0 ? payoutSum / hits : 0;

  return {
    total,
    hits,
    hitRate: (hitRate * 100).toFixed(1),
    recoveryRate: recoveryRate.toFixed(1),
    avgPayout: avgPayout.toFixed(0),
    profit: (payoutSum - total * 100).toFixed(0),
  };
}

// ===== メイン分析 =====

async function analyzeEdogawa() {
  if (!isSupabaseEnabled()) {
    console.error("❌ Supabase環境変数が未設定です");
    process.exit(1);
  }

  console.log("=".repeat(70));
  console.log(
    `🏟️  ${VENUE_NAME}（会場コード: ${String(VENUE_CODE).padStart(2, "0")}）詳細分析`,
  );
  console.log("=".repeat(70));

  const venueCodeStr = String(VENUE_CODE).padStart(2, "0");

  // 1. 予測データ取得
  const { data: predictions, error: predError } = await supabase
    .from("predictions")
    .select("race_id, model_id, top_pick, top_2nd, top_3rd, confidence")
    .like("race_id", `%-${venueCodeStr}-%`)
    .eq("model_id", "standard");

  if (predError) {
    console.error("予測データ取得エラー:", predError.message);
    return;
  }

  const raceIds = [...new Set(predictions.map((p) => p.race_id))];
  console.log(
    `\n📊 データ概要: ${raceIds.length} レース, ${predictions.length} 予測\n`,
  );

  // 2. 結果データ取得
  const { data: results, error: resError } = await supabase
    .from("race_results")
    .select("*")
    .in("race_id", raceIds);

  if (resError) {
    console.error("結果データ取得エラー:", resError.message);
    return;
  }

  // 3. 出走情報取得
  const { data: entries, error: entError } = await supabase
    .from("race_entries")
    .select(
      "race_id, boat_number, grade, win_rate, local_win_rate, motor_2rate, boat_2rate",
    )
    .in("race_id", raceIds);

  if (entError) {
    console.error("出走情報取得エラー:", entError.message);
    return;
  }

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

  // ===== 分析用データ構造 =====

  // 単勝分析
  const winByPickBoat = {}; // 予測1着艇番別
  const winByPickGrade = {}; // 予測1着の級別
  const winByPickWinRate = {}; // 予測1着の勝率帯
  const winByPickMotor = {}; // 予測1着のモーター
  const winByConfidence = {}; // 信頼度別
  const winByPick12 = {}; // 予測1-2着組み合わせ
  const winByPickGradeMotor = {}; // 艇番×級別×モーター

  // 複勝分析
  const placeByPickBoat = {};
  const placeByPickGrade = {};

  // 3連複分析
  const trioByPick123 = {}; // 予測1-2-3着組み合わせ

  // 3連単分析
  const trifectaByPick123 = {};

  // 複合条件（詳細）
  const winByBoatGradeWinRate = {}; // 艇番×級別×勝率帯
  const winByBoatConfMotor = {}; // 艇番×信頼度×モーター
  const winBy1stBoatGrade = {}; // 1号艇の級別（参考）
  const winBy2ndBoatGrade = {}; // 2号艇の級別（敵の強さ）

  // 日付別（期間分析用）
  const dateStats = {};

  // ===== データ収集 =====

  for (const pred of predictions) {
    const result = resultsMap[pred.race_id];
    if (!result) continue;

    const raceEntries = entriesMap[pred.race_id] || {};
    const pickBoat = raceEntries[pred.top_pick];
    const boat1 = raceEntries[1];
    const boat2 = raceEntries[2];

    const pickGrade = pickBoat?.grade || "Unknown";
    const pickWinRate = pickBoat?.win_rate || 0;
    const pickMotor = pickBoat?.motor_2rate || 0;
    const conf = pred.confidence || 50;

    const date = pred.race_id.substring(0, 10);

    // 単勝判定
    const winHit = pred.top_pick === result.rank1;
    const winPayout = winHit ? result.payout_win : 0;

    // 複勝判定
    const placeHit =
      pred.top_pick === result.rank1 || pred.top_pick === result.rank2;
    let placePayout = 0;
    if (placeHit) {
      placePayout =
        pred.top_pick === result.rank1
          ? result.payout_place_1
          : result.payout_place_2;
    }

    // 3連複判定
    const predTop3Sorted = [pred.top_pick, pred.top_2nd, pred.top_3rd]
      .filter(Boolean)
      .sort()
      .join("-");
    const resultTop3Sorted = [result.rank1, result.rank2, result.rank3]
      .sort()
      .join("-");
    const trioHit = predTop3Sorted === resultTop3Sorted;
    const trioPayout = trioHit ? result.payout_trio : 0;

    // 3連単判定
    const predTop3 = [pred.top_pick, pred.top_2nd, pred.top_3rd]
      .filter(Boolean)
      .join("-");
    const resultTop3 = [result.rank1, result.rank2, result.rank3].join("-");
    const trifectaHit = predTop3 === resultTop3;
    const trifectaPayout = trifectaHit ? result.payout_trifecta : 0;

    // ----- 単勝データ収集 -----

    // 予測1着艇番別
    const keyBoat = `${pred.top_pick}号艇`;
    if (!winByPickBoat[keyBoat]) winByPickBoat[keyBoat] = [];
    winByPickBoat[keyBoat].push({ hit: winHit, payout: winPayout });

    // 予測1着の級別
    const keyGrade = `${pred.top_pick}号艇_${pickGrade}`;
    if (!winByPickGrade[keyGrade]) winByPickGrade[keyGrade] = [];
    winByPickGrade[keyGrade].push({ hit: winHit, payout: winPayout });

    // 予測1着の勝率帯
    const keyWinRate = `${pred.top_pick}号艇_勝率${categorizeWinRate(pickWinRate)}`;
    if (!winByPickWinRate[keyWinRate]) winByPickWinRate[keyWinRate] = [];
    winByPickWinRate[keyWinRate].push({ hit: winHit, payout: winPayout });

    // 予測1着のモーター
    const keyMotor = `${pred.top_pick}号艇_M${categorizeMotor(pickMotor)}`;
    if (!winByPickMotor[keyMotor]) winByPickMotor[keyMotor] = [];
    winByPickMotor[keyMotor].push({ hit: winHit, payout: winPayout });

    // 信頼度別
    const keyConf = `信頼度${categorizeConfidence(conf)}`;
    if (!winByConfidence[keyConf]) winByConfidence[keyConf] = [];
    winByConfidence[keyConf].push({ hit: winHit, payout: winPayout });

    // 予測1-2着組み合わせ
    const key12 = `${pred.top_pick}-${pred.top_2nd}`;
    if (!winByPick12[key12]) winByPick12[key12] = [];
    winByPick12[key12].push({ hit: winHit, payout: winPayout });

    // 艇番×級別×モーター
    const keyGradeMotor = `${pred.top_pick}号艇_${pickGrade}_M${categorizeMotor(pickMotor)}`;
    if (!winByPickGradeMotor[keyGradeMotor])
      winByPickGradeMotor[keyGradeMotor] = [];
    winByPickGradeMotor[keyGradeMotor].push({ hit: winHit, payout: winPayout });

    // 艇番×級別×勝率帯
    const keyBoatGradeWR = `${pred.top_pick}号艇_${pickGrade}_勝率${categorizeWinRate(pickWinRate)}`;
    if (!winByBoatGradeWinRate[keyBoatGradeWR])
      winByBoatGradeWinRate[keyBoatGradeWR] = [];
    winByBoatGradeWinRate[keyBoatGradeWR].push({
      hit: winHit,
      payout: winPayout,
    });

    // 艇番×信頼度×モーター
    const keyConfMotor = `${pred.top_pick}号艇_信頼度${categorizeConfidence(conf)}_M${categorizeMotor(pickMotor)}`;
    if (!winByBoatConfMotor[keyConfMotor])
      winByBoatConfMotor[keyConfMotor] = [];
    winByBoatConfMotor[keyConfMotor].push({ hit: winHit, payout: winPayout });

    // 1号艇の級別（レース特性）
    const key1stGrade = `1号艇=${boat1?.grade || "Unknown"}`;
    if (!winBy1stBoatGrade[key1stGrade]) winBy1stBoatGrade[key1stGrade] = [];
    winBy1stBoatGrade[key1stGrade].push({ hit: winHit, payout: winPayout });

    // 2号艇の級別（敵の強さ）
    const key2ndGrade = `2号艇=${boat2?.grade || "Unknown"}`;
    if (!winBy2ndBoatGrade[key2ndGrade]) winBy2ndBoatGrade[key2ndGrade] = [];
    winBy2ndBoatGrade[key2ndGrade].push({ hit: winHit, payout: winPayout });

    // ----- 複勝データ収集 -----
    const keyPlaceBoat = `${pred.top_pick}号艇`;
    if (!placeByPickBoat[keyPlaceBoat]) placeByPickBoat[keyPlaceBoat] = [];
    placeByPickBoat[keyPlaceBoat].push({ hit: placeHit, payout: placePayout });

    const keyPlaceGrade = `${pred.top_pick}号艇_${pickGrade}`;
    if (!placeByPickGrade[keyPlaceGrade]) placeByPickGrade[keyPlaceGrade] = [];
    placeByPickGrade[keyPlaceGrade].push({
      hit: placeHit,
      payout: placePayout,
    });

    // ----- 3連複データ収集 -----
    const key123Sorted = predTop3Sorted;
    if (!trioByPick123[key123Sorted]) trioByPick123[key123Sorted] = [];
    trioByPick123[key123Sorted].push({ hit: trioHit, payout: trioPayout });

    // ----- 3連単データ収集 -----
    if (!trifectaByPick123[predTop3]) trifectaByPick123[predTop3] = [];
    trifectaByPick123[predTop3].push({
      hit: trifectaHit,
      payout: trifectaPayout,
    });

    // ----- 日付別 -----
    if (!dateStats[date])
      dateStats[date] = { win: [], place: [], trio: [], trifecta: [] };
    dateStats[date].win.push({ hit: winHit, payout: winPayout });
    dateStats[date].place.push({ hit: placeHit, payout: placePayout });
    dateStats[date].trio.push({ hit: trioHit, payout: trioPayout });
    dateStats[date].trifecta.push({ hit: trifectaHit, payout: trifectaPayout });
  }

  // ===== 結果出力 =====

  console.log("─".repeat(70));
  console.log("📈 単勝分析");
  console.log("─".repeat(70));

  // ヘルパー関数
  function printStats(title, dataMap, minSample = 10) {
    console.log(`\n【${title}】`);
    const results = [];
    for (const [key, data] of Object.entries(dataMap)) {
      if (data.length >= minSample) {
        const stats = calcStats(data);
        if (stats) {
          results.push({ key, ...stats });
        }
      }
    }
    results.sort(
      (a, b) => parseFloat(b.recoveryRate) - parseFloat(a.recoveryRate),
    );

    for (const r of results) {
      const marker = parseFloat(r.recoveryRate) >= 100 ? "🔥" : "  ";
      console.log(
        `${marker} ${r.key.padEnd(35)} | ${r.total.toString().padStart(3)}R | 的中${r.hitRate.padStart(5)}% | 回収${r.recoveryRate.padStart(6)}% | 損益${r.profit.padStart(6)}円`,
      );
    }

    return results.filter((r) => parseFloat(r.recoveryRate) >= 100);
  }

  const profitable1 = printStats("予測1着艇番別", winByPickBoat, 10);
  const profitable2 = printStats("予測1着×級別", winByPickGrade, 10);
  const profitable3 = printStats("予測1着×勝率帯", winByPickWinRate, 10);
  const profitable4 = printStats("予測1着×モーター", winByPickMotor, 10);
  const profitable5 = printStats("信頼度別", winByConfidence, 10);
  const profitable6 = printStats("予測1-2着組み合わせ", winByPick12, 10);
  const profitable7 = printStats("艇番×級別×モーター", winByPickGradeMotor, 8);
  const profitable8 = printStats("艇番×級別×勝率帯", winByBoatGradeWinRate, 8);
  const profitable9 = printStats("艇番×信頼度×モーター", winByBoatConfMotor, 8);
  const profitable10 = printStats("1号艇の級別", winBy1stBoatGrade, 10);
  const profitable11 = printStats(
    "2号艇の級別（敵の強さ）",
    winBy2ndBoatGrade,
    10,
  );

  console.log("\n" + "─".repeat(70));
  console.log("📈 複勝分析");
  console.log("─".repeat(70));

  const profitablePlace1 = printStats("予測1着艇番別", placeByPickBoat, 10);
  const profitablePlace2 = printStats("予測1着×級別", placeByPickGrade, 10);

  console.log("\n" + "─".repeat(70));
  console.log("📈 3連複分析");
  console.log("─".repeat(70));

  const profitableTrio = printStats(
    "予測1-2-3着組み合わせ（順不同）",
    trioByPick123,
    5,
  );

  console.log("\n" + "─".repeat(70));
  console.log("📈 3連単分析");
  console.log("─".repeat(70));

  const profitableTrifecta = printStats(
    "予測1-2-3着組み合わせ",
    trifectaByPick123,
    5,
  );

  // ===== 期間別推移 =====
  console.log("\n" + "─".repeat(70));
  console.log("📅 日別回収率推移（単勝）");
  console.log("─".repeat(70));

  const dates = Object.keys(dateStats).sort();
  let cumulative = 0;
  let cumulativeRaces = 0;

  for (const date of dates) {
    const dayStats = calcStats(dateStats[date].win);
    if (dayStats) {
      cumulativeRaces += parseInt(dayStats.total);
      cumulative += parseInt(dayStats.profit);
      const cumulativeRecovery = (
        ((cumulative + cumulativeRaces * 100) / (cumulativeRaces * 100)) *
        100
      ).toFixed(1);
      const marker = parseFloat(dayStats.recoveryRate) >= 100 ? "🔥" : "  ";
      console.log(
        `${marker} ${date} | ${dayStats.total.toString().padStart(2)}R | 回収${dayStats.recoveryRate.padStart(6)}% | 累計${cumulativeRecovery.padStart(6)}%`,
      );
    }
  }

  // ===== サマリー =====
  console.log("\n" + "=".repeat(70));
  console.log("🎯 回収率100%超え条件サマリー");
  console.log("=".repeat(70));

  const allProfitable = [
    ...profitable1.map((p) => ({ ...p, category: "艇番別" })),
    ...profitable2.map((p) => ({ ...p, category: "艇番×級別" })),
    ...profitable3.map((p) => ({ ...p, category: "艇番×勝率帯" })),
    ...profitable4.map((p) => ({ ...p, category: "艇番×モーター" })),
    ...profitable5.map((p) => ({ ...p, category: "信頼度" })),
    ...profitable6.map((p) => ({ ...p, category: "1-2着予測" })),
    ...profitable7.map((p) => ({ ...p, category: "艇番×級別×モーター" })),
    ...profitable8.map((p) => ({ ...p, category: "艇番×級別×勝率帯" })),
    ...profitable9.map((p) => ({ ...p, category: "艇番×信頼度×モーター" })),
    ...profitable10.map((p) => ({ ...p, category: "1号艇の級別" })),
    ...profitable11.map((p) => ({ ...p, category: "2号艇の級別" })),
  ];

  allProfitable.sort(
    (a, b) => parseFloat(b.recoveryRate) - parseFloat(a.recoveryRate),
  );

  console.log("\n【単勝】");
  for (const p of allProfitable.slice(0, 20)) {
    console.log(
      `  ${p.category.padEnd(15)} | ${p.key.padEnd(30)} | ${p.total}R | 回収${p.recoveryRate}%`,
    );
  }

  const allProfitablePlace = [
    ...profitablePlace1.map((p) => ({ ...p, category: "艇番別" })),
    ...profitablePlace2.map((p) => ({ ...p, category: "艇番×級別" })),
  ];

  if (allProfitablePlace.length > 0) {
    console.log("\n【複勝】");
    for (const p of allProfitablePlace) {
      console.log(
        `  ${p.category.padEnd(15)} | ${p.key.padEnd(30)} | ${p.total}R | 回収${p.recoveryRate}%`,
      );
    }
  }

  if (profitableTrio.length > 0) {
    console.log("\n【3連複】");
    for (const p of profitableTrio.slice(0, 10)) {
      console.log(
        `  予測: ${p.key.padEnd(10)} | ${p.total}R | 回収${p.recoveryRate}%`,
      );
    }
  }

  // ===== 推奨ルール =====
  console.log("\n" + "=".repeat(70));
  console.log("💡 推奨ベッティングルール（江戸川）");
  console.log("=".repeat(70));

  // 信頼性の高い条件（サンプル数20以上、回収率110%以上）
  const reliableRules = allProfitable.filter(
    (p) => p.total >= 15 && parseFloat(p.recoveryRate) >= 105,
  );

  console.log("\n【信頼性の高いルール（n≥15, 回収率≥105%）】");
  if (reliableRules.length > 0) {
    for (const r of reliableRules) {
      console.log(`  ✅ ${r.key}: 回収率${r.recoveryRate}% (${r.total}レース)`);
    }
  } else {
    console.log("  該当なし - 条件を緩和して再検証が必要");
  }

  // 高リターンルール（回収率150%以上）
  const highReturnRules = allProfitable.filter(
    (p) => p.total >= 10 && parseFloat(p.recoveryRate) >= 150,
  );

  console.log("\n【高リターンルール（n≥10, 回収率≥150%）】");
  if (highReturnRules.length > 0) {
    for (const r of highReturnRules) {
      console.log(`  ⚡ ${r.key}: 回収率${r.recoveryRate}% (${r.total}レース)`);
    }
  } else {
    console.log("  該当なし");
  }

  console.log("\n" + "=".repeat(70));
  console.log("分析完了");
  console.log("=".repeat(70));
}

analyzeEdogawa().catch(console.error);
