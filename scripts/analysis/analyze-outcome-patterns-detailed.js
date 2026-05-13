import { supabase } from "../lib/supabaseClient.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const VENUE_NAMES = {
  "01": "桐生",
  "02": "戸田",
  "03": "江戸川",
  "04": "平和島",
  "05": "多摩川",
  "06": "浜名湖",
  "07": "蒲郡",
  "08": "常滑",
  "09": "津",
  10: "三国",
  11: "びわこ",
  12: "住之江",
  13: "尼崎",
  14: "鳴門",
  15: "丸亀",
  16: "児島",
  17: "宮島",
  18: "徳山",
  19: "下関",
  20: "若松",
  21: "芦屋",
  22: "福岡",
  23: "唐津",
  24: "大村",
};

async function analyzeDetailedPatterns(venueCode) {
  const venueName = VENUE_NAMES[venueCode] || "不明";
  console.log("\n=== " + venueName + "(" + venueCode + ") 詳細出目分析 ===");

  const venuePad = String(venueCode).padStart(2, "0");
  const pattern = "%-" + venuePad + "-%";

  // レース結果取得
  const { data: raceResults, error } = await supabase
    .from("race_results")
    .select("race_id, rank1, rank2, rank3, payout_trifecta")
    .like("race_id", pattern)
    .order("race_id", { ascending: false })
    .limit(5000);

  if (error || !raceResults || raceResults.length === 0) {
    console.log("データなし");
    return null;
  }

  console.log("取得したレース: " + raceResults.length + "件");

  // race_id から日付とレース番号を抽出
  const extractInfo = (raceId) => {
    const parts = raceId.split("-");
    return {
      date: parts[0] + "-" + parts[1] + "-" + parts[2],
      raceNum: parseInt(parts[4]) || 0,
    };
  };

  // 予測データ取得（イン崩れ指数を取得するため）
  const raceIds = raceResults.map((r) => r.race_id);
  let volatilityMap = {};

  // ページネーションで取得
  for (let i = 0; i < raceIds.length; i += 1000) {
    const batch = raceIds.slice(i, i + 1000);
    const { data: volatilityData } = await supabase
      .from("volatility")
      .select("race_id, score")
      .in("race_id", batch);

    if (volatilityData) {
      volatilityData.forEach((v) => {
        volatilityMap[v.race_id] = v.score || 0;
      });
    }
  }

  // データ拡張
  const enrichedResults = raceResults.map((r) => ({
    ...r,
    volatility: volatilityMap[r.race_id] || 0,
    info: extractInfo(r.race_id),
  }));

  // ===== 分析1: 全体パターン =====
  console.log("\n【分析1】全体の出目パターン");
  const allPatterns = {};
  const allSecond = {};

  enrichedResults.forEach((r) => {
    if (r.rank1 && r.rank2 && r.rank3) {
      const pat = r.rank1 + "-" + r.rank2 + "-" + r.rank3;
      allPatterns[pat] = (allPatterns[pat] || 0) + 1;

      const sec = r.rank1 + "-" + r.rank2;
      allSecond[sec] = (allSecond[sec] || 0) + 1;
    }
  });

  const topPatterns = Object.entries(allPatterns)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([pat, count]) => ({
      pattern: pat,
      count,
      rate: ((count / enrichedResults.length) * 100).toFixed(2),
    }));

  console.log("上位15の3連単パターン:");
  topPatterns.forEach((p, i) => {
    console.log(
      "  " +
        (i + 1) +
        ". " +
        p.pattern +
        ": " +
        p.count +
        "回 (" +
        p.rate +
        "%)",
    );
  });

  // ===== 分析2: 高荒れ時（イン崩れ指数51-100）のパターン =====
  console.log("\n【分析2】高荒れ時（イン崩れ指数51-100）の出目パターン");
  const highVolatilityResults = enrichedResults.filter(
    (r) => r.volatility >= 51,
  );
  console.log("該当レース: " + highVolatilityResults.length + "件");

  const highVolPatterns = {};
  const highVolSecond = {};

  highVolatilityResults.forEach((r) => {
    if (r.rank1 && r.rank2 && r.rank3) {
      const pat = r.rank1 + "-" + r.rank2 + "-" + r.rank3;
      highVolPatterns[pat] = (highVolPatterns[pat] || 0) + 1;

      const sec = r.rank1 + "-" + r.rank2;
      highVolSecond[sec] = (highVolSecond[sec] || 0) + 1;
    }
  });

  const topHighVolPatterns = Object.entries(highVolPatterns)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([pat, count]) => ({
      pattern: pat,
      count,
      rate: ((count / highVolatilityResults.length) * 100).toFixed(2),
    }));

  if (topHighVolPatterns.length > 0) {
    console.log("高荒れ時の上位10パターン:");
    topHighVolPatterns.forEach((p, i) => {
      console.log(
        "  " +
          (i + 1) +
          ". " +
          p.pattern +
          ": " +
          p.count +
          "回 (" +
          p.rate +
          "%)",
      );
    });
  } else {
    console.log("該当データなし");
  }

  // ===== 分析3: 配当別パターン（回収率） =====
  console.log("\n【分析3】配当を加味したパターン分析（3連単）");
  const payoutPatterns = {};

  enrichedResults.forEach((r) => {
    if (r.rank1 && r.rank2 && r.rank3 && r.payout_trifecta) {
      const pat = r.rank1 + "-" + r.rank2 + "-" + r.rank3;
      if (!payoutPatterns[pat]) {
        payoutPatterns[pat] = { count: 0, totalPayout: 0, avgPayout: 0 };
      }
      payoutPatterns[pat].count++;
      payoutPatterns[pat].totalPayout += r.payout_trifecta;
    }
  });

  const payoutAnalysis = Object.entries(payoutPatterns)
    .map(([pat, data]) => ({
      pattern: pat,
      count: data.count,
      avgPayout: (data.totalPayout / data.count / 100).toFixed(0), // 100倍を戻す
      expectedValue: (
        (data.totalPayout / data.count / 100) *
        (data.count / enrichedResults.length)
      ).toFixed(1),
    }))
    .filter((p) => p.count >= 3) // 最低3回以上
    .sort((a, b) => parseFloat(b.avgPayout) - parseFloat(a.avgPayout))
    .slice(0, 10);

  console.log("平均配当が高いパターン（最低3回以上）:");
  payoutAnalysis.forEach((p, i) => {
    console.log(
      "  " +
        (i + 1) +
        ". " +
        p.pattern +
        ": " +
        p.count +
        "回, 平均" +
        p.avgPayout +
        "円",
    );
  });

  // ===== 分析4: 朝（1-6R）vs 夜（10-12R）のパターン =====
  console.log("\n【分析4】レース番号別パターン");
  const morningRaces = enrichedResults.filter(
    (r) => r.info.raceNum >= 1 && r.info.raceNum <= 6,
  );
  const nightRaces = enrichedResults.filter(
    (r) => r.info.raceNum >= 10 && r.info.raceNum <= 12,
  );

  const analyzeTimeOfDay = (races, label) => {
    const patterns = {};
    races.forEach((r) => {
      if (r.rank1 && r.rank2 && r.rank3) {
        const pat = r.rank1 + "-" + r.rank2 + "-" + r.rank3;
        patterns[pat] = (patterns[pat] || 0) + 1;
      }
    });

    const top = Object.entries(patterns)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([pat, count]) => ({
        pattern: pat,
        count,
        rate: ((count / races.length) * 100).toFixed(2),
      }));

    console.log("\n" + label + "（" + races.length + "件）の上位5パターン:");
    if (top.length === 0) {
      console.log("  データなし");
    } else {
      top.forEach((p, i) => {
        console.log(
          "  " +
            (i + 1) +
            ". " +
            p.pattern +
            ": " +
            p.count +
            "回 (" +
            p.rate +
            "%)",
        );
      });
    }
  };

  analyzeTimeOfDay(morningRaces, "朝のレース（1-6R）");
  analyzeTimeOfDay(nightRaces, "夜のレース（10-12R）");

  // ===== 分析5: 1着別の2着出現率（詳細版） =====
  console.log("\n【分析5】1着別2着パターン（詳細版）");
  const secondByFirst = {};
  for (let i = 1; i <= 6; i++) {
    secondByFirst[i] = {};
    for (let j = 1; j <= 6; j++) {
      if (i !== j) secondByFirst[i][j] = 0;
    }
  }

  enrichedResults.forEach((r) => {
    if (r.rank1 && r.rank2) {
      if (secondByFirst[r.rank1]) {
        secondByFirst[r.rank1][r.rank2]++;
      }
    }
  });

  for (let i = 1; i <= 6; i++) {
    const total = Object.values(secondByFirst[i]).reduce((a, b) => a + b, 0);
    const sorted = Object.entries(secondByFirst[i])
      .sort((a, b) => b[1] - a[1])
      .map(([boat, count]) => ({
        boat: parseInt(boat),
        count,
        rate: ((count / total) * 100).toFixed(1),
      }));

    console.log("\n" + i + "着の後（" + total + "回中）:");
    sorted.forEach((s) => {
      console.log("  " + s.boat + "着: " + s.count + "回 (" + s.rate + "%)");
    });
  }

  // ===== 結果を JSON で保存 =====
  const analysis = {
    venue_code: venueCode,
    venue_name: venueName,
    analysis_date: new Date().toISOString().split("T")[0],
    total_races: enrichedResults.length,

    all_patterns: {
      top_15: topPatterns,
      total_unique: Object.keys(allPatterns).length,
    },

    high_volatility: {
      races_count: highVolatilityResults.length,
      top_10: topHighVolPatterns,
    },

    payout_analysis: payoutAnalysis,

    time_of_day: {
      morning: morningRaces.length,
      night: nightRaces.length,
    },

    second_by_first: secondByFirst,
  };

  const dir = path.join(
    __dirname,
    "../../data/analysis",
    "venue-" + String(venueCode).padStart(2, "0"),
  );
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const outputPath = path.join(dir, "outcome-patterns-detailed.json");
  fs.writeFileSync(outputPath, JSON.stringify(analysis, null, 2));
  console.log("\n結果を保存: " + outputPath);

  return analysis;
}

async function main() {
  const venueCode = process.argv[2];

  if (!venueCode) {
    console.log("全会場の詳細出目分析中...\n");
    for (let i = 1; i <= 24; i++) {
      const code = String(i).padStart(2, "0");
      try {
        await analyzeDetailedPatterns(code);
      } catch (err) {
        console.error(VENUE_NAMES[code] + " の分析に失敗:", err.message);
      }
    }
  } else {
    try {
      await analyzeDetailedPatterns(venueCode.padStart(2, "0"));
    } catch (err) {
      console.error("エラー:", err.message);
      process.exit(1);
    }
  }
}

main().catch(console.error);
