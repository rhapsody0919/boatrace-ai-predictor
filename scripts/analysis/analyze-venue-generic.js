import { supabase } from "../lib/supabaseClient.js";
import fs from "fs";

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

async function analyzeVenue(venueCode) {
  const venueName = VENUE_NAMES[venueCode] || "不明";

  // 1. 予測データ取得
  const { data: predictions, error } = await supabase
    .from("predictions")
    .select("race_id, model_id, top_pick, top_2nd, top_3rd, confidence")
    .like("race_id", `%-${venueCode}-%`);

  if (error) throw error;

  // 2. 結果データ取得
  const raceIds = [...new Set(predictions.map((p) => p.race_id))];
  const { data: raceResults, error: resultsError } = await supabase
    .from("race_results")
    .select("*")
    .in("race_id", raceIds);

  if (resultsError) throw resultsError;

  // マップ化
  const resultsMap = {};
  raceResults?.forEach((r) => {
    resultsMap[r.race_id] = r;
  });

  // race_idから日付を抽出する関数
  const extractDate = (raceId) => {
    // race_id format: YYYY-MM-DD-XX-NN
    const parts = raceId.split("-");
    if (parts.length >= 3) {
      return `${parts[0]}-${parts[1]}-${parts[2]}`;
    }
    return null;
  };

  // race_idからレース番号を抽出
  const extractRaceNumber = (raceId) => {
    const parts = raceId.split("-");
    return parts.length >= 5 ? parseInt(parts[4]) : null;
  };

  // standardモデルのみで分析
  const standardPreds = predictions
    .filter((p) => p.model_id === "standard")
    .map((p) => {
      const r = resultsMap[p.race_id];
      const raceDate = extractDate(p.race_id);
      return {
        ...p,
        race_date: raceDate,
        race_number: extractRaceNumber(p.race_id),
        result_1st: r?.rank1,
        result_2nd: r?.rank2,
        result_3rd: r?.rank3,
        win_odds: r?.payout_win ? r.payout_win / 100 : 0,
        place_odds_1: r?.payout_place_1 ? r.payout_place_1 / 100 : 0,
        place_odds_2: r?.payout_place_2 ? r.payout_place_2 / 100 : 0,
        trio_odds: r?.payout_trio ? r.payout_trio / 100 : 0,
      };
    })
    .filter((p) => p.race_date && p.race_date >= "2025-12-04" && p.result_1st)
    .sort((a, b) => a.race_date.localeCompare(b.race_date));

  console.log(`\n=== ${venueName}(${venueCode}) 詳細分析 ===`);
  console.log(`サンプル数: ${standardPreds.length}レース`);
  console.log(
    `期間: ${standardPreds[0]?.race_date} 〜 ${standardPreds[standardPreds.length - 1]?.race_date}`,
  );

  const conditions = [];

  for (const pred of standardPreds) {
    const top3 = [pred.top_pick, pred.top_2nd, pred.top_3rd];
    const conf = pred.confidence || 0;
    const raceNo = pred.race_number;
    const has1 = top3.includes(1);
    const has2 = top3.includes(2);
    const has3 = top3.includes(3);
    const has4 = top3.includes(4);
    const has5 = top3.includes(5);
    const has6 = top3.includes(6);

    conditions.push({
      ...pred,
      top3,
      conf,
      raceNo,
      has1,
      has2,
      has3,
      has4,
      has5,
      has6,
      isLate: raceNo >= 10,
    });
  }

  const patterns = [
    // 単勝パターン
    { name: "1号艇1着", betType: "win", filter: (p) => p.top_pick === 1 },
    { name: "2号艇1着", betType: "win", filter: (p) => p.top_pick === 2 },
    { name: "3号艇1着", betType: "win", filter: (p) => p.top_pick === 3 },
    { name: "4号艇1着", betType: "win", filter: (p) => p.top_pick === 4 },
    { name: "5号艇1着", betType: "win", filter: (p) => p.top_pick === 5 },
    { name: "6号艇1着", betType: "win", filter: (p) => p.top_pick === 6 },
    {
      name: "1号艇1着+2号艇含む",
      betType: "win",
      filter: (p) => p.top_pick === 1 && p.has2,
    },
    {
      name: "1号艇1着+3号艇含む",
      betType: "win",
      filter: (p) => p.top_pick === 1 && p.has3,
    },
    {
      name: "1号艇1着+4号艇含む",
      betType: "win",
      filter: (p) => p.top_pick === 1 && p.has4,
    },
    {
      name: "1号艇1着+5号艇含む",
      betType: "win",
      filter: (p) => p.top_pick === 1 && p.has5,
    },
    {
      name: "1号艇1着+6号艇含む",
      betType: "win",
      filter: (p) => p.top_pick === 1 && p.has6,
    },
    {
      name: "2号艇1着+1号艇含む",
      betType: "win",
      filter: (p) => p.top_pick === 2 && p.has1,
    },
    {
      name: "2号艇1着+3号艇含む",
      betType: "win",
      filter: (p) => p.top_pick === 2 && p.has3,
    },
    {
      name: "2号艇1着+4号艇含む",
      betType: "win",
      filter: (p) => p.top_pick === 2 && p.has4,
    },
    {
      name: "2号艇1着+5号艇含む",
      betType: "win",
      filter: (p) => p.top_pick === 2 && p.has5,
    },
    {
      name: "2号艇1着+6号艇含む",
      betType: "win",
      filter: (p) => p.top_pick === 2 && p.has6,
    },
    {
      name: "3号艇1着+1号艇含む",
      betType: "win",
      filter: (p) => p.top_pick === 3 && p.has1,
    },
    {
      name: "3号艇1着+2号艇含む",
      betType: "win",
      filter: (p) => p.top_pick === 3 && p.has2,
    },
    {
      name: "3号艇1着+4号艇含む",
      betType: "win",
      filter: (p) => p.top_pick === 3 && p.has4,
    },
    {
      name: "3号艇1着+5号艇含む",
      betType: "win",
      filter: (p) => p.top_pick === 3 && p.has5,
    },
    {
      name: "3号艇1着+6号艇含む",
      betType: "win",
      filter: (p) => p.top_pick === 3 && p.has6,
    },
    {
      name: "4号艇1着+1号艇含む",
      betType: "win",
      filter: (p) => p.top_pick === 4 && p.has1,
    },
    {
      name: "4号艇1着+2号艇含む",
      betType: "win",
      filter: (p) => p.top_pick === 4 && p.has2,
    },
    {
      name: "4号艇1着+3号艇含む",
      betType: "win",
      filter: (p) => p.top_pick === 4 && p.has3,
    },
    {
      name: "4号艇1着+5号艇含む",
      betType: "win",
      filter: (p) => p.top_pick === 4 && p.has5,
    },
    {
      name: "4号艇1着+6号艇含む",
      betType: "win",
      filter: (p) => p.top_pick === 4 && p.has6,
    },
    {
      name: "5号艇1着+1号艇含む",
      betType: "win",
      filter: (p) => p.top_pick === 5 && p.has1,
    },
    {
      name: "5号艇1着+2号艇含む",
      betType: "win",
      filter: (p) => p.top_pick === 5 && p.has2,
    },
    {
      name: "5号艇1着+3号艇含む",
      betType: "win",
      filter: (p) => p.top_pick === 5 && p.has3,
    },
    {
      name: "5号艇1着+4号艇含む",
      betType: "win",
      filter: (p) => p.top_pick === 5 && p.has4,
    },
    {
      name: "5号艇1着+6号艇含む",
      betType: "win",
      filter: (p) => p.top_pick === 5 && p.has6,
    },
    {
      name: "6号艇1着+1号艇含む",
      betType: "win",
      filter: (p) => p.top_pick === 6 && p.has1,
    },
    {
      name: "6号艇1着+2号艇含む",
      betType: "win",
      filter: (p) => p.top_pick === 6 && p.has2,
    },
    {
      name: "6号艇1着+3号艇含む",
      betType: "win",
      filter: (p) => p.top_pick === 6 && p.has3,
    },
    {
      name: "6号艇1着+4号艇含む",
      betType: "win",
      filter: (p) => p.top_pick === 6 && p.has4,
    },
    {
      name: "6号艇1着+5号艇含む",
      betType: "win",
      filter: (p) => p.top_pick === 6 && p.has5,
    },
    {
      name: "1号艇1着×conf80+",
      betType: "win",
      filter: (p) => p.top_pick === 1 && p.conf >= 80,
    },
    {
      name: "2号艇1着×conf80+",
      betType: "win",
      filter: (p) => p.top_pick === 2 && p.conf >= 80,
    },
    {
      name: "3号艇1着×conf80+",
      betType: "win",
      filter: (p) => p.top_pick === 3 && p.conf >= 80,
    },
    {
      name: "4号艇1着×conf80+",
      betType: "win",
      filter: (p) => p.top_pick === 4 && p.conf >= 80,
    },
    {
      name: "5号艇1着×conf80+",
      betType: "win",
      filter: (p) => p.top_pick === 5 && p.conf >= 80,
    },
    {
      name: "6号艇1着×conf80+",
      betType: "win",
      filter: (p) => p.top_pick === 6 && p.conf >= 80,
    },
    { name: "後半R(10R〜)単勝", betType: "win", filter: (p) => p.isLate },
    {
      name: "1号艇1着×後半R",
      betType: "win",
      filter: (p) => p.top_pick === 1 && p.isLate,
    },
    // 複勝パターン
    {
      name: "1号艇1着(複勝)",
      betType: "place",
      filter: (p) => p.top_pick === 1,
    },
    {
      name: "2号艇1着(複勝)",
      betType: "place",
      filter: (p) => p.top_pick === 2,
    },
    {
      name: "3号艇1着(複勝)",
      betType: "place",
      filter: (p) => p.top_pick === 3,
    },
    {
      name: "4号艇1着(複勝)",
      betType: "place",
      filter: (p) => p.top_pick === 4,
    },
    {
      name: "5号艇1着(複勝)",
      betType: "place",
      filter: (p) => p.top_pick === 5,
    },
    {
      name: "6号艇1着(複勝)",
      betType: "place",
      filter: (p) => p.top_pick === 6,
    },
    {
      name: "2号艇1着+1号艇含む(複勝)",
      betType: "place",
      filter: (p) => p.top_pick === 2 && p.has1,
    },
    {
      name: "3号艇1着+1号艇含む(複勝)",
      betType: "place",
      filter: (p) => p.top_pick === 3 && p.has1,
    },
    {
      name: "4号艇1着+1号艇含む(複勝)",
      betType: "place",
      filter: (p) => p.top_pick === 4 && p.has1,
    },
    {
      name: "4号艇1着+2号艇含む(複勝)",
      betType: "place",
      filter: (p) => p.top_pick === 4 && p.has2,
    },
    {
      name: "4号艇1着+3号艇含む(複勝)",
      betType: "place",
      filter: (p) => p.top_pick === 4 && p.has3,
    },
    {
      name: "4号艇1着+5号艇含む(複勝)",
      betType: "place",
      filter: (p) => p.top_pick === 4 && p.has5,
    },
    {
      name: "4号艇1着+6号艇含む(複勝)",
      betType: "place",
      filter: (p) => p.top_pick === 4 && p.has6,
    },
    {
      name: "5号艇1着+1号艇含む(複勝)",
      betType: "place",
      filter: (p) => p.top_pick === 5 && p.has1,
    },
    {
      name: "5号艇1着+2号艇含む(複勝)",
      betType: "place",
      filter: (p) => p.top_pick === 5 && p.has2,
    },
    {
      name: "5号艇1着+3号艇含む(複勝)",
      betType: "place",
      filter: (p) => p.top_pick === 5 && p.has3,
    },
    {
      name: "5号艇1着+4号艇含む(複勝)",
      betType: "place",
      filter: (p) => p.top_pick === 5 && p.has4,
    },
    {
      name: "5号艇1着+6号艇含む(複勝)",
      betType: "place",
      filter: (p) => p.top_pick === 5 && p.has6,
    },
    {
      name: "6号艇1着+1号艇含む(複勝)",
      betType: "place",
      filter: (p) => p.top_pick === 6 && p.has1,
    },
    {
      name: "6号艇1着+2号艇含む(複勝)",
      betType: "place",
      filter: (p) => p.top_pick === 6 && p.has2,
    },
    {
      name: "6号艇1着+3号艇含む(複勝)",
      betType: "place",
      filter: (p) => p.top_pick === 6 && p.has3,
    },
    {
      name: "6号艇1着+4号艇含む(複勝)",
      betType: "place",
      filter: (p) => p.top_pick === 6 && p.has4,
    },
    {
      name: "6号艇1着+5号艇含む(複勝)",
      betType: "place",
      filter: (p) => p.top_pick === 6 && p.has5,
    },
    {
      name: "2号艇1着×conf80+(複勝)",
      betType: "place",
      filter: (p) => p.top_pick === 2 && p.conf >= 80,
    },
    {
      name: "3号艇1着×conf80+(複勝)",
      betType: "place",
      filter: (p) => p.top_pick === 3 && p.conf >= 80,
    },
    {
      name: "4号艇1着×conf80+(複勝)",
      betType: "place",
      filter: (p) => p.top_pick === 4 && p.conf >= 80,
    },
    {
      name: "5号艇1着×conf80+(複勝)",
      betType: "place",
      filter: (p) => p.top_pick === 5 && p.conf >= 80,
    },
    {
      name: "6号艇1着×conf80+(複勝)",
      betType: "place",
      filter: (p) => p.top_pick === 6 && p.conf >= 80,
    },
    { name: "後半R(10R〜)複勝", betType: "place", filter: (p) => p.isLate },
    // 3連複パターン
    { name: "1,2号艇含む", betType: "trio", filter: (p) => p.has1 && p.has2 },
    { name: "1,3号艇含む", betType: "trio", filter: (p) => p.has1 && p.has3 },
    { name: "1,4号艇含む", betType: "trio", filter: (p) => p.has1 && p.has4 },
    { name: "1,5号艇含む", betType: "trio", filter: (p) => p.has1 && p.has5 },
    { name: "1,6号艇含む", betType: "trio", filter: (p) => p.has1 && p.has6 },
    { name: "2,3号艇含む", betType: "trio", filter: (p) => p.has2 && p.has3 },
    { name: "2,4号艇含む", betType: "trio", filter: (p) => p.has2 && p.has4 },
    { name: "2,5号艇含む", betType: "trio", filter: (p) => p.has2 && p.has5 },
    { name: "2,6号艇含む", betType: "trio", filter: (p) => p.has2 && p.has6 },
    { name: "3,4号艇含む", betType: "trio", filter: (p) => p.has3 && p.has4 },
    { name: "3,5号艇含む", betType: "trio", filter: (p) => p.has3 && p.has5 },
    { name: "3,6号艇含む", betType: "trio", filter: (p) => p.has3 && p.has6 },
    { name: "4,5号艇含む", betType: "trio", filter: (p) => p.has4 && p.has5 },
    { name: "4,6号艇含む", betType: "trio", filter: (p) => p.has4 && p.has6 },
    { name: "5,6号艇含む", betType: "trio", filter: (p) => p.has5 && p.has6 },
    {
      name: "1,2,3号艇",
      betType: "trio",
      filter: (p) => p.has1 && p.has2 && p.has3,
    },
    {
      name: "1,2,4号艇",
      betType: "trio",
      filter: (p) => p.has1 && p.has2 && p.has4,
    },
    {
      name: "1,2,5号艇",
      betType: "trio",
      filter: (p) => p.has1 && p.has2 && p.has5,
    },
    {
      name: "1,2,6号艇",
      betType: "trio",
      filter: (p) => p.has1 && p.has2 && p.has6,
    },
    {
      name: "1,3,4号艇",
      betType: "trio",
      filter: (p) => p.has1 && p.has3 && p.has4,
    },
    {
      name: "1,3,5号艇",
      betType: "trio",
      filter: (p) => p.has1 && p.has3 && p.has5,
    },
    {
      name: "1,3,6号艇",
      betType: "trio",
      filter: (p) => p.has1 && p.has3 && p.has6,
    },
    {
      name: "1,4,5号艇",
      betType: "trio",
      filter: (p) => p.has1 && p.has4 && p.has5,
    },
    {
      name: "1,4,6号艇",
      betType: "trio",
      filter: (p) => p.has1 && p.has4 && p.has6,
    },
    {
      name: "1,5,6号艇",
      betType: "trio",
      filter: (p) => p.has1 && p.has5 && p.has6,
    },
    {
      name: "2,3,4号艇",
      betType: "trio",
      filter: (p) => p.has2 && p.has3 && p.has4,
    },
    {
      name: "2,3,5号艇",
      betType: "trio",
      filter: (p) => p.has2 && p.has3 && p.has5,
    },
    {
      name: "2,3,6号艇",
      betType: "trio",
      filter: (p) => p.has2 && p.has3 && p.has6,
    },
    {
      name: "2,4,5号艇",
      betType: "trio",
      filter: (p) => p.has2 && p.has4 && p.has5,
    },
    {
      name: "2,4,6号艇",
      betType: "trio",
      filter: (p) => p.has2 && p.has4 && p.has6,
    },
    {
      name: "2,5,6号艇",
      betType: "trio",
      filter: (p) => p.has2 && p.has5 && p.has6,
    },
    {
      name: "3,4,5号艇",
      betType: "trio",
      filter: (p) => p.has3 && p.has4 && p.has5,
    },
    {
      name: "3,4,6号艇",
      betType: "trio",
      filter: (p) => p.has3 && p.has4 && p.has6,
    },
    {
      name: "3,5,6号艇",
      betType: "trio",
      filter: (p) => p.has3 && p.has5 && p.has6,
    },
    {
      name: "4,5,6号艇",
      betType: "trio",
      filter: (p) => p.has4 && p.has5 && p.has6,
    },
    { name: "1号艇含まない", betType: "trio", filter: (p) => !p.has1 },
    {
      name: "1号艇含まない×conf80+",
      betType: "trio",
      filter: (p) => !p.has1 && p.conf >= 80,
    },
    {
      name: "1号艇含む×conf80+",
      betType: "trio",
      filter: (p) => p.has1 && p.conf >= 80,
    },
    { name: "後半R(10R〜)", betType: "trio", filter: (p) => p.isLate },
    {
      name: "後半R×1号艇含む",
      betType: "trio",
      filter: (p) => p.isLate && p.has1,
    },
    {
      name: "後半R×1号艇含まない",
      betType: "trio",
      filter: (p) => p.isLate && !p.has1,
    },
  ];

  const results = { win: [], place: [], trio: [] };

  for (const pattern of patterns) {
    const filtered = conditions.filter(pattern.filter);
    if (filtered.length < 10) continue;

    let totalBet = 0;
    let totalReturn = 0;
    let hits = 0;

    for (const p of filtered) {
      totalBet += 100;

      if (pattern.betType === "win") {
        const isHit = p.result_1st === p.top_pick;
        if (isHit) {
          hits++;
          totalReturn += (p.win_odds || 0) * 100;
        }
      } else if (pattern.betType === "place") {
        const topInTop3 = [p.result_1st, p.result_2nd, p.result_3rd].includes(
          p.top_pick,
        );
        if (topInTop3) {
          hits++;
          const placeOdds = [p.place_odds_1, p.place_odds_2, p.place_odds_3];
          const idx = [p.result_1st, p.result_2nd, p.result_3rd].indexOf(
            p.top_pick,
          );
          totalReturn += (placeOdds[idx] || 0) * 100;
        }
      } else if (pattern.betType === "trio") {
        const predSet = new Set(p.top3);
        const resultSet = new Set([p.result_1st, p.result_2nd, p.result_3rd]);
        const isHit = [...predSet].every((x) => resultSet.has(x));
        if (isHit) {
          hits++;
          totalReturn += (p.trio_odds || 0) * 100;
        }
      }
    }

    const recovery =
      totalBet > 0 ? Math.round((totalReturn / totalBet) * 100) : 0;
    const hitRate = ((hits / filtered.length) * 100).toFixed(1);

    if (recovery >= 100 && filtered.length >= 10) {
      results[pattern.betType].push({
        name: pattern.name,
        samples: filtered.length,
        hits,
        hitRate,
        recovery,
      });
    }
  }

  console.log("\n### 単勝ルール（回収率100%↑）");
  if (results.win.length === 0) {
    console.log("  該当なし");
  } else {
    results.win
      .sort((a, b) => b.recovery - a.recovery)
      .slice(0, 10)
      .forEach((r) => {
        console.log(
          `  ${r.name}: ${r.recovery}% (${r.samples}R, 的中${r.hitRate}%)`,
        );
      });
  }

  console.log("\n### 複勝ルール（回収率100%↑）");
  if (results.place.length === 0) {
    console.log("  該当なし");
  } else {
    results.place
      .sort((a, b) => b.recovery - a.recovery)
      .slice(0, 10)
      .forEach((r) => {
        console.log(
          `  ${r.name}: ${r.recovery}% (${r.samples}R, 的中${r.hitRate}%)`,
        );
      });
  }

  console.log("\n### 3連複ルール（回収率100%↑）");
  if (results.trio.length === 0) {
    console.log("  該当なし");
  } else {
    results.trio
      .sort((a, b) => b.recovery - a.recovery)
      .slice(0, 10)
      .forEach((r) => {
        console.log(
          `  ${r.name}: ${r.recovery}% (${r.samples}R, 的中${r.hitRate}%)`,
        );
      });
  }

  // JSONファイルに保存
  const outputDir = `data/analysis/venue-${venueCode}`;
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const outputData = {
    venue_code: venueCode,
    venue_name: venueName,
    analysis_date: new Date().toISOString().split("T")[0],
    sample_size: standardPreds.length,
    period: {
      start: standardPreds[0]?.race_date,
      end: standardPreds[standardPreds.length - 1]?.race_date,
    },
    win_rules: results.win.sort((a, b) => b.recovery - a.recovery),
    place_rules: results.place.sort((a, b) => b.recovery - a.recovery),
    trio_rules: results.trio.sort((a, b) => b.recovery - a.recovery),
  };

  fs.writeFileSync(
    `${outputDir}/rules.json`,
    JSON.stringify(outputData, null, 2),
  );
  console.log(`\n結果を ${outputDir}/rules.json に保存しました`);

  return results;
}

// メイン
const venueCode = process.argv[2];
if (!venueCode) {
  console.log("使用法: node analyze-venue-generic.js <会場コード>");
  console.log("例: node analyze-venue-generic.js 21");
  process.exit(1);
}

analyzeVenue(venueCode.padStart(2, "0")).catch(console.error);
