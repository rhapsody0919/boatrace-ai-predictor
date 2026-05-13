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

async function analyzeOutcomePatterns(venueCode) {
  const venueName = VENUE_NAMES[venueCode] || "不明";
  console.log(
    "\n=== " + venueName + "(" + venueCode + ") 出目パターン分析 ===",
  );

  // 会場別のレース結果取得
  const venuePad = String(venueCode).padStart(2, "0");
  const pattern = "%-" + venuePad + "-%";

  const { data: raceResults, error } = await supabase
    .from("race_results")
    .select("race_id, rank1, rank2, rank3")
    .like("race_id", pattern)
    .order("race_id", { ascending: false })
    .limit(5000);

  if (error) {
    console.error("エラー: " + venueName + " のレース結果取得に失敗", error);
    return null;
  }

  console.log("取得したレース: " + (raceResults?.length || 0) + "件");

  if (!raceResults || raceResults.length === 0) {
    console.log("データなし");
    return null;
  }

  // 1着別の2着パターン分析
  const second_after_first = {};
  for (let i = 1; i <= 6; i++) {
    second_after_first[i] = {};
    for (let j = 1; j <= 6; j++) {
      if (i !== j) {
        second_after_first[i][j] = 0;
      }
    }
  }

  // 3連単パターン分析
  const trifecta_patterns = {};

  // データ集計
  raceResults.forEach((result) => {
    const rank1 = result.rank1;
    const rank2 = result.rank2;
    const rank3 = result.rank3;

    if (rank1 && rank2 && rank3) {
      // 1着→2着の遷移
      if (
        second_after_first[rank1] &&
        second_after_first[rank1][rank2] !== undefined
      ) {
        second_after_first[rank1][rank2]++;
      }

      // 3連単パターン
      const pattern = rank1 + "-" + rank2 + "-" + rank3;
      trifecta_patterns[pattern] = (trifecta_patterns[pattern] || 0) + 1;
    }
  });

  // 1着別の2着パターンを出現率で整理
  const second_analysis = {};
  for (let i = 1; i <= 6; i++) {
    const total = Object.values(second_after_first[i]).reduce(
      (a, b) => a + b,
      0,
    );
    const percentages = {};

    for (let j = 1; j <= 6; j++) {
      if (i !== j) {
        percentages[j] =
          total > 0
            ? ((second_after_first[i][j] / total) * 100).toFixed(1)
            : "0.0";
      }
    }

    // 出現率が高い順にソート
    const sorted = Object.entries(percentages)
      .sort((a, b) => parseFloat(b[1]) - parseFloat(a[1]))
      .map(([boat, rate]) => ({
        boat: parseInt(boat),
        rate: parseFloat(rate),
        count: second_after_first[i][parseInt(boat)],
      }));

    second_analysis[i] = {
      total_occurrences: total,
      pattern: sorted,
    };
  }

  // 3連単パターンを出現率で整理
  const total_races = raceResults.length;
  const trifecta_analysis = Object.entries(trifecta_patterns)
    .map(([pattern, count]) => ({
      pattern,
      count,
      rate: ((count / total_races) * 100).toFixed(2),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  const analysis = {
    venue_code: venueCode,
    venue_name: venueName,
    analysis_date: new Date().toISOString().split("T")[0],
    total_races_analyzed: total_races,
    second_place_by_first: second_analysis,
    top_trifecta_patterns: trifecta_analysis,
  };

  // 結果をコンソール出力
  console.log("\n【1着別の2着パターン】");
  for (let i = 1; i <= 6; i++) {
    const data = second_analysis[i];
    console.log(
      "\n" + i + "着の後の2着パターン(" + data.total_occurrences + "回中):",
    );
    data.pattern.forEach((p) => {
      console.log("  " + p.boat + "着: " + p.count + "回 (" + p.rate + "%)");
    });
  }

  console.log("\n【3連単パターン（上位20）】");
  trifecta_analysis.slice(0, 10).forEach((p) => {
    console.log("  " + p.pattern + ": " + p.count + "回 (" + p.rate + "%)");
  });
  if (trifecta_analysis.length > 10) {
    console.log("  ... 他 " + (trifecta_analysis.length - 10) + "パターン");
  }

  // ファイルに保存
  const dir = path.join(
    __dirname,
    "../../data/analysis",
    "venue-" + String(venueCode).padStart(2, "0"),
  );
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const outputPath = path.join(dir, "outcome-patterns.json");
  fs.writeFileSync(outputPath, JSON.stringify(analysis, null, 2));
  console.log("\n結果を保存: " + outputPath);

  return analysis;
}

async function main() {
  const venueCode = process.argv[2];

  if (!venueCode) {
    console.log("全会場の出目パターンを分析中...\n");
    for (let i = 1; i <= 24; i++) {
      const code = String(i).padStart(2, "0");
      try {
        await analyzeOutcomePatterns(code);
      } catch (err) {
        console.error(VENUE_NAMES[code] + " の分析に失敗:", err.message);
      }
    }
  } else {
    try {
      await analyzeOutcomePatterns(venueCode.padStart(2, "0"));
    } catch (err) {
      console.error("エラー:", err.message);
      process.exit(1);
    }
  }
}

main().catch(console.error);
