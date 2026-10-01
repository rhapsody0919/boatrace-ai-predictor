/**
 * 江戸川 3連単 深掘り分析スクリプト
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

function catMotor(m) {
  if (m === null || m === undefined) return "M不明";
  if (m >= 40) return "M40↑";
  if (m >= 35) return "M35-39";
  if (m >= 30) return "M30-34";
  return "M30↓";
}

function catGrade(g) {
  if (!g || g === "Unknown") return "級不明";
  return g;
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

async function analyzeDeep() {
  if (!isSupabaseEnabled()) {
    console.error("❌ Supabase環境変数が未設定です");
    process.exit(1);
  }

  console.log("=".repeat(70));
  console.log(`🔬 ${VENUE_NAME} 3連単 深掘り分析`);
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

  // ===== 分析1: 順番入れ替えパターン =====
  console.log("─".repeat(70));
  console.log("📊 分析1: 順番入れ替えパターン（3連複的中時）");
  console.log("─".repeat(70));

  const swapPatterns = {};
  let trioHitCount = 0;
  let trifectaHitInTrioCount = 0;

  for (const pred of predictions) {
    const result = resultsMap[pred.race_id];
    if (!result) continue;

    const predTop3 = [pred.top_pick, pred.top_2nd, pred.top_3rd].filter(
      Boolean,
    );
    if (predTop3.length !== 3) continue;

    const predSorted = [...predTop3].sort((a, b) => a - b).join("-");
    const resultSorted = [result.rank1, result.rank2, result.rank3]
      .sort((a, b) => a - b)
      .join("-");
    const trioHit = predSorted === resultSorted;

    if (trioHit) {
      trioHitCount++;
      const predOrder = predTop3.join("-");
      const resultOrder = `${result.rank1}-${result.rank2}-${result.rank3}`;

      if (predOrder === resultOrder) {
        trifectaHitInTrioCount++;
      }

      // 入れ替えパターンを記録
      const pattern = `予測${predOrder}→実際${resultOrder}`;
      if (!swapPatterns[pattern])
        swapPatterns[pattern] = { count: 0, payouts: [] };
      swapPatterns[pattern].count++;
      // payout_trio=3連単・payout_trifecta=3連複（is_hit_* も同じ。列名と中身が逆。079、BOA-536）
      swapPatterns[pattern].payouts.push(result.payout_trio);
    }
  }

  console.log(
    `\n3連複的中時の3連単的中率: ${trifectaHitInTrioCount}/${trioHitCount} = ${((trifectaHitInTrioCount / trioHitCount) * 100).toFixed(1)}%\n`,
  );

  console.log("【頻出入れ替えパターン（3連複的中時）】");
  const sortedPatterns = Object.entries(swapPatterns)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 20);

  for (const [pattern, data] of sortedPatterns) {
    const isExact =
      pattern.split("→")[0].replace("予測", "") ===
      pattern.split("→")[1].replace("実際", "");
    const marker = isExact ? "✅" : "  ";
    const avgPayout = Math.round(
      data.payouts.reduce((a, b) => a + b, 0) / data.count,
    );
    console.log(
      `${marker} ${pattern.padEnd(25)} | ${data.count}回 | 平均配当${avgPayout}円`,
    );
  }

  // ===== 分析2: 1着固定時の2-3着入れ替え =====
  console.log("\n" + "─".repeat(70));
  console.log("📊 分析2: 1着的中時の2-3着分析");
  console.log("─".repeat(70));

  const first1stHit = { total: 0, order23Hit: 0, cases: [] };

  for (const pred of predictions) {
    const result = resultsMap[pred.race_id];
    if (!result) continue;

    const predTop3 = [pred.top_pick, pred.top_2nd, pred.top_3rd].filter(
      Boolean,
    );
    if (predTop3.length !== 3) continue;

    // 1着が的中している場合
    if (pred.top_pick === result.rank1) {
      first1stHit.total++;

      // 2-3着も順番通りか
      if (pred.top_2nd === result.rank2 && pred.top_3rd === result.rank3) {
        first1stHit.order23Hit++;
      }

      first1stHit.cases.push({
        race_id: pred.race_id,
        pred: predTop3.join("-"),
        result: `${result.rank1}-${result.rank2}-${result.rank3}`,
        trifectaHit:
          pred.top_2nd === result.rank2 && pred.top_3rd === result.rank3,
        payout: result.payout_trio,
      });
    }
  }

  console.log(`\n1着的中時: ${first1stHit.total}レース`);
  console.log(
    `2-3着も順番的中: ${first1stHit.order23Hit}レース (${((first1stHit.order23Hit / first1stHit.total) * 100).toFixed(1)}%)`,
  );

  // 1着的中時の3連単回収率
  const first1stStats = calcStats(
    first1stHit.cases.map((c) => ({
      hit: c.trifectaHit,
      payout: c.trifectaHit ? c.payout : 0,
    })),
  );
  console.log(`1着的中時の3連単回収率: ${first1stStats?.recoveryRate}%`);

  // ===== 分析3: 艇の属性組み合わせ =====
  console.log("\n" + "─".repeat(70));
  console.log("📊 分析3: 予測艇の属性組み合わせ");
  console.log("─".repeat(70));

  // 1着予測艇の属性別
  const by1stGrade = {};
  const by1stMotor = {};
  const by1st2ndGrade = {};
  const by123GradePattern = {};
  const byTopPickMotor = {};

  for (const pred of predictions) {
    const result = resultsMap[pred.race_id];
    if (!result) continue;

    const raceEntries = entriesMap[pred.race_id] || {};
    const predTop3 = [pred.top_pick, pred.top_2nd, pred.top_3rd].filter(
      Boolean,
    );
    if (predTop3.length !== 3) continue;

    const boat1st = raceEntries[pred.top_pick];
    const boat2nd = raceEntries[pred.top_2nd];
    const boat3rd = raceEntries[pred.top_3rd];

    const predOrder = predTop3.join("-");
    const resultOrder = `${result.rank1}-${result.rank2}-${result.rank3}`;
    const trifectaHit = predOrder === resultOrder;
    const payout = trifectaHit ? result.payout_trio : 0;
    const record = { hit: trifectaHit, payout };

    // 1着予測艇の級別
    const grade1st = catGrade(boat1st?.grade);
    if (!by1stGrade[grade1st]) by1stGrade[grade1st] = [];
    by1stGrade[grade1st].push(record);

    // 1着予測艇のモーター
    const motor1st = catMotor(boat1st?.motor_2rate);
    if (!by1stMotor[motor1st]) by1stMotor[motor1st] = [];
    by1stMotor[motor1st].push(record);

    // 1着×2着の級別組み合わせ
    const grade12 = `${catGrade(boat1st?.grade)}-${catGrade(boat2nd?.grade)}`;
    if (!by1st2ndGrade[grade12]) by1st2ndGrade[grade12] = [];
    by1st2ndGrade[grade12].push(record);

    // 1-2-3の級別パターン
    const grade123 = `${catGrade(boat1st?.grade)}/${catGrade(boat2nd?.grade)}/${catGrade(boat3rd?.grade)}`;
    if (!by123GradePattern[grade123]) by123GradePattern[grade123] = [];
    by123GradePattern[grade123].push(record);

    // 1着予測艇のモーター×艇番
    const motorBoat = `${pred.top_pick}号艇_${motor1st}`;
    if (!byTopPickMotor[motorBoat]) byTopPickMotor[motorBoat] = [];
    byTopPickMotor[motorBoat].push(record);
  }

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

    for (const r of results.slice(0, 15)) {
      const marker = parseFloat(r.recoveryRate) >= 100 ? "🔥" : "  ";
      console.log(
        `${marker} ${r.key.padEnd(35)} | ${r.total.toString().padStart(3)}R | 的中${r.hitRate.padStart(5)}% | 回収${r.recoveryRate.padStart(7)}%`,
      );
    }

    return results.filter((r) => parseFloat(r.recoveryRate) >= 100);
  }

  const p1 = printAnalysis("1着予測艇の級別", by1stGrade);
  const p2 = printAnalysis("1着予測艇のモーター", by1stMotor);
  const p3 = printAnalysis("1着×2着の級別", by1st2ndGrade, 3);
  const p4 = printAnalysis("1-2-3の級別パターン", by123GradePattern, 3);
  const p5 = printAnalysis("1着艇番×モーター", byTopPickMotor, 3);

  // ===== 分析4: 高配当条件の探索 =====
  console.log("\n" + "─".repeat(70));
  console.log("📊 分析4: 高配当が出やすい条件");
  console.log("─".repeat(70));

  // 配当別の条件分析
  const highPayoutConditions = [];

  for (const pred of predictions) {
    const result = resultsMap[pred.race_id];
    if (!result) continue;

    const raceEntries = entriesMap[pred.race_id] || {};
    const predTop3 = [pred.top_pick, pred.top_2nd, pred.top_3rd].filter(
      Boolean,
    );
    if (predTop3.length !== 3) continue;

    const predOrder = predTop3.join("-");
    const resultOrder = `${result.rank1}-${result.rank2}-${result.rank3}`;
    const trifectaHit = predOrder === resultOrder;

    if (trifectaHit && result.payout_trio >= 3000) {
      const boat1st = raceEntries[pred.top_pick];
      const raceNo = parseInt(pred.race_id.split("-")[4]);

      highPayoutConditions.push({
        race_id: pred.race_id,
        order: predOrder,
        payout: result.payout_trio,
        confidence: pred.confidence,
        race_no: raceNo,
        first_grade: boat1st?.grade || "Unknown",
        first_motor: boat1st?.motor_2rate,
      });
    }
  }

  console.log(`\n高配当的中（3000円以上）: ${highPayoutConditions.length}件\n`);

  if (highPayoutConditions.length > 0) {
    highPayoutConditions.sort((a, b) => b.payout - a.payout);
    console.log("【高配当的中リスト】");
    for (const c of highPayoutConditions.slice(0, 15)) {
      console.log(
        `  ${c.order} | ${c.payout.toLocaleString()}円 | 信頼度${c.confidence} | ${c.race_no}R | 1着=${c.first_grade} M=${c.first_motor || "?"}`,
      );
    }

    // 高配当の傾向
    console.log("\n【高配当の傾向分析】");
    const confDist = {};
    const orderDist = {};
    const gradeDist = {};
    for (const c of highPayoutConditions) {
      const confCat = catConf(c.confidence);
      confDist[confCat] = (confDist[confCat] || 0) + 1;
      orderDist[c.order] = (orderDist[c.order] || 0) + 1;
      gradeDist[c.first_grade] = (gradeDist[c.first_grade] || 0) + 1;
    }
    console.log("  信頼度:", confDist);
    console.log("  順番:", orderDist);
    console.log("  1着級別:", gradeDist);
  }

  // ===== 分析5: 条件絞り込み =====
  console.log("\n" + "─".repeat(70));
  console.log("📊 分析5: 複合条件での絞り込み");
  console.log("─".repeat(70));

  const byComplex = {};

  for (const pred of predictions) {
    const result = resultsMap[pred.race_id];
    if (!result) continue;

    const raceEntries = entriesMap[pred.race_id] || {};
    const predTop3 = [pred.top_pick, pred.top_2nd, pred.top_3rd].filter(
      Boolean,
    );
    if (predTop3.length !== 3) continue;

    const boat1st = raceEntries[pred.top_pick];
    const conf = pred.confidence || 50;
    const raceNo = parseInt(pred.race_id.split("-")[4]);

    const predOrder = predTop3.join("-");
    const resultOrder = `${result.rank1}-${result.rank2}-${result.rank3}`;
    const trifectaHit = predOrder === resultOrder;
    const payout = trifectaHit ? result.payout_trio : 0;
    const record = { hit: trifectaHit, payout };

    // 1号艇1着×信頼度
    if (pred.top_pick === 1) {
      const key1 = `1号艇1着_${catConf(conf)}`;
      if (!byComplex[key1]) byComplex[key1] = [];
      byComplex[key1].push(record);
    }

    // 1号艇1着×レース番号
    if (pred.top_pick === 1) {
      const key2 = `1号艇1着_${catRaceNo(raceNo)}`;
      if (!byComplex[key2]) byComplex[key2] = [];
      byComplex[key2].push(record);
    }

    // 順番×モーター
    const motor1st = catMotor(boat1st?.motor_2rate);
    const key3 = `${predOrder}_${motor1st}`;
    if (!byComplex[key3]) byComplex[key3] = [];
    byComplex[key3].push(record);

    // 1-2着固定×信頼度
    const top12 = `${pred.top_pick}-${pred.top_2nd}`;
    const key4 = `${top12}固定_${catConf(conf)}`;
    if (!byComplex[key4]) byComplex[key4] = [];
    byComplex[key4].push(record);

    // 1-2着固定×レース番号
    const key5 = `${top12}固定_${catRaceNo(raceNo)}`;
    if (!byComplex[key5]) byComplex[key5] = [];
    byComplex[key5].push(record);

    // 1号艇非1着×信頼度
    if (pred.top_pick !== 1) {
      const key6 = `非1号艇1着_${catConf(conf)}`;
      if (!byComplex[key6]) byComplex[key6] = [];
      byComplex[key6].push(record);
    }

    // 特定順番×信頼度×レース番号
    const key7 = `${predOrder}_${catConf(conf)}_${catRaceNo(raceNo)}`;
    if (!byComplex[key7]) byComplex[key7] = [];
    byComplex[key7].push(record);
  }

  const p6 = printAnalysis("複合条件", byComplex, 3);

  // ===== サマリー =====
  console.log("\n" + "=".repeat(70));
  console.log("📊 3連単 深掘り分析サマリー");
  console.log("=".repeat(70));

  const allProfitable = [
    ...p1.map((p) => ({ ...p, cat: "1着級別" })),
    ...p2.map((p) => ({ ...p, cat: "1着モーター" })),
    ...p3.map((p) => ({ ...p, cat: "1着×2着級別" })),
    ...p4.map((p) => ({ ...p, cat: "123級別パターン" })),
    ...p5.map((p) => ({ ...p, cat: "艇番×モーター" })),
    ...p6.map((p) => ({ ...p, cat: "複合条件" })),
  ];

  if (allProfitable.length > 0) {
    console.log("\n【回収率100%超え条件】");
    allProfitable.sort(
      (a, b) => parseFloat(b.recoveryRate) - parseFloat(a.recoveryRate),
    );
    for (const p of allProfitable.slice(0, 20)) {
      const marker = p.total >= 10 ? "⭐" : "  ";
      console.log(
        `${marker} ${p.cat.padEnd(15)} | ${p.key.padEnd(30)} | ${p.total.toString().padStart(3)}R | 回収${p.recoveryRate}%`,
      );
    }
  } else {
    console.log("\n回収率100%超えの条件なし");
  }

  // 結論
  console.log("\n【結論】");
  console.log(
    `  3連複的中時の3連単的中率: ${((trifectaHitInTrioCount / trioHitCount) * 100).toFixed(1)}%`,
  );
  console.log(
    `  1着的中時の2-3着順番的中率: ${((first1stHit.order23Hit / first1stHit.total) * 100).toFixed(1)}%`,
  );
  console.log(`  高配当(3000円↑)的中数: ${highPayoutConditions.length}件`);

  console.log("\n" + "=".repeat(70));
  console.log("分析完了");
  console.log("=".repeat(70));
}

analyzeDeep().catch(console.error);
