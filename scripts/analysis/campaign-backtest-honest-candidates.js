/**
 * 「龍神レーダーが実際にUI上で見せている予想」だけを根拠にした掛け方の検証。
 *
 * これまでのv3+フォーメーションは、boatStrengthsで6艇全体を無理やり順位付けし、
 * 実質「1号艇に賭け続ける」戦略になっていた（1号艇が実際に負けた30/47レースで
 * 回収率0%、という致命的な偏りが判明済み）。
 *
 * 本スクリプトは、展開予測UI（TodaysVolatilityHighlights / PredictionPanel）が
 * 実際に表示する「1着になりそうな艇の候補（最大3艇・確率順、turnPrediction.patterns
 * のwinnerCourseを重複排除・確率降順にしたもの）」だけを使い、その範囲内で
 * 完結する掛け方（単勝・複勝・3連複ボックス）を検証する。boatStrengthsによる
 * 4〜6位の水増しランキングは使わない＝UIの表示内容と完全に一致する候補だけを買う。
 *
 * ⚠️ DB列名の罠: 3連単の払戻はpayout_trio列、3連複の払戻はpayout_trifecta列
 * （campaign-backtest-score.js・payoutCalculator.js参照）。
 *
 * 使い方: node scripts/analysis/campaign-backtest-honest-candidates.js races-xxx-with-turnprediction.json
 */
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { supabase } from "../lib/supabaseClient.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(__dirname, "../../data/analysis/campaign-backtest");
const AMOUNT_PER_POINT = 300;

function getCandidates(turnPrediction) {
  const byBoat = new Map();
  for (const p of turnPrediction?.patterns || []) {
    byBoat.set(
      p.winnerCourse,
      (byBoat.get(p.winnerCourse) || 0) + p.probability,
    );
  }
  return [...byBoat.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([boat, prob]) => ({ boat, prob }));
}

function sortedKey(arr) {
  return [...arr].sort((a, b) => a - b).join("-");
}

async function main() {
  const inputFile = process.argv[2];
  if (!inputFile) {
    console.error(
      "使い方: node scripts/analysis/campaign-backtest-honest-candidates.js <races-*-with-turnprediction.json>",
    );
    process.exit(1);
  }
  const races = JSON.parse(
    await fs.readFile(path.join(DIR, inputFile), "utf-8"),
  );

  const raceIds = races.map((r) => r.raceId);
  const BATCH = 200;
  const resultByRaceId = new Map();
  for (let i = 0; i < raceIds.length; i += BATCH) {
    const batchIds = raceIds.slice(i, i + BATCH);
    const { data, error } = await supabase
      .from("race_results")
      .select(
        "race_id, rank1, rank2, rank3, payout_win, payout_place_1, payout_place_2, payout_trifecta",
      )
      .in("race_id", batchIds);
    if (error) throw new Error(`race_results取得エラー: ${error.message}`);
    for (const row of data) resultByRaceId.set(row.race_id, row);
  }

  const buckets = ["ge_99", "ge_100"];
  const stats = {};
  for (const b of buckets) {
    stats[b] = {
      win: { spend: 0, payout: 0, hits: 0, n: 0 },
      place: { spend: 0, payout: 0, hits: 0, n: 0 },
      trio2: { spend: 0, payout: 0, hits: 0, n: 0 }, // 候補2艇の3連複ボックス(3点)
      trio3: { spend: 0, payout: 0, hits: 0, n: 0 }, // 候補3艇の3連複ボックス(1点)
    };
  }

  // 1着候補が実際に勝ったか/負けたかで内訳も取る（前回の反省を踏まえた透明性チェック）
  const breakdown = {
    candidateWon: { n: 0, spend: 0, payout: 0 },
    candidateLost: { n: 0, spend: 0, payout: 0 },
  };

  for (const race of races) {
    const result = resultByRaceId.get(race.raceId);
    if (!result || result.rank1 == null) continue;
    const candidates = getCandidates(race.turnPrediction);
    if (candidates.length === 0) continue;
    const top = candidates[0].boat;
    const actualTop3 = new Set([result.rank1, result.rank2, result.rank3]);

    for (const bucket of race.buckets) {
      if (!buckets.includes(bucket)) continue;
      const s = stats[bucket];

      // 単勝: 候補1位が1着
      {
        const hit = result.rank1 === top;
        s.win.n++;
        s.win.spend += AMOUNT_PER_POINT;
        s.win.payout += hit
          ? Math.round((result.payout_win / 100) * AMOUNT_PER_POINT)
          : 0;
        s.win.hits += hit ? 1 : 0;
      }
      // 複勝: 候補1位が1着or2着
      {
        let payout = 0;
        if (result.rank1 === top) payout = result.payout_place_1;
        else if (result.rank2 === top) payout = result.payout_place_2;
        const hit = payout > 0;
        s.place.n++;
        s.place.spend += AMOUNT_PER_POINT;
        s.place.payout += hit
          ? Math.round((payout / 100) * AMOUNT_PER_POINT)
          : 0;
        s.place.hits += hit ? 1 : 0;
      }
      // 3連複ボックス: 候補上位2艇+実質3艇目（候補になければ2艇のみでは3連複不可のためスキップ）
      if (candidates.length >= 3) {
        const set3 = candidates.slice(0, 3).map((c) => c.boat);
        const hit = sortedKey(set3) === sortedKey([...actualTop3]);
        s.trio3.n++;
        s.trio3.spend += AMOUNT_PER_POINT;
        s.trio3.payout += hit
          ? Math.round((result.payout_trifecta / 100) * AMOUNT_PER_POINT)
          : 0;
        s.trio3.hits += hit ? 1 : 0;
      }
    }

    if (race.buckets.includes("ge_99")) {
      const group =
        result.rank1 === top ? breakdown.candidateWon : breakdown.candidateLost;
      group.n++;
      // 単勝の内訳で見る（最もシンプルな指標として）
      group.spend += AMOUNT_PER_POINT;
      group.payout +=
        result.rank1 === top
          ? Math.round((result.payout_win / 100) * AMOUNT_PER_POINT)
          : 0;
    }
  }

  for (const bucket of buckets) {
    console.log(`\n===== ${bucket} =====`);
    for (const [key, label] of [
      ["win", "単勝（候補1位）"],
      ["place", "複勝（候補1位）"],
      ["trio3", "3連複ボックス（候補上位3艇のみ・boatStrengths水増しなし）"],
    ]) {
      const s = stats[bucket][key];
      if (s.n === 0) continue;
      const recovery =
        s.spend > 0 ? ((s.payout / s.spend) * 100).toFixed(1) : "—";
      console.log(
        `${label.padEnd(46)} n=${String(s.n).padStart(3)}  的中率${((s.hits / s.n) * 100).toFixed(1)}%  購入${s.spend.toLocaleString()}円→払戻${s.payout.toLocaleString()}円  回収率${recovery}%`,
      );
    }
  }

  console.log(
    `\n===== 透明性チェック（ge_99、単勝ベース）: 候補1位が実際に勝ったか =====`,
  );
  for (const [key, label] of [
    ["candidateWon", "候補1位が実際に1着だった場合"],
    ["candidateLost", "候補1位が実際に負けた場合"],
  ]) {
    const g = breakdown[key];
    const recovery =
      g.spend > 0 ? ((g.payout / g.spend) * 100).toFixed(1) : "—";
    console.log(
      `${label}: n=${g.n}  購入${g.spend.toLocaleString()}円→払戻${g.payout.toLocaleString()}円  回収率${recovery}%`,
    );
  }
}

main().catch((error) => {
  console.error("❌ 実行中にエラーが発生しました:", error.message);
  process.exit(1);
});
