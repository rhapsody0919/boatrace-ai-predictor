/**
 * 掛け方（買い目の組み方）自体を変えた場合にどうなるかを検証する。
 *
 * これまでの検証は「上位3艇の3連単3点（同一3艇の順列）」という固定の買い方だけを
 * 試してきたが、実際の舟券には他にも定石の買い方がある:
 *   - ボックス買い（対象艇の全順列/全組み合わせ）
 *   - フォーメーション（着順ごとに別々の候補艇集合を指定）
 *   - ながし（軸を1艇固定し、相手を広く流す）
 * 艇のランキング（picks-v2-*.json 等のrankingフィールド、[最有力,...,最弱]の6艇順）を
 * 入力に、複数の買い方パターンで同時にスコアリングし、回収率を比較する。
 *
 * ⚠️ DB列名の罠: 3連単の払戻はpayout_trio列、3連複の払戻はpayout_trifecta列
 * （scripts/lib/payoutCalculator.js参照、campaign-backtest-score.jsと同じ扱い）。
 *
 * 使い方: node scripts/analysis/campaign-backtest-betting-patterns.js <ranking-source picks-*.json>
 */
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { supabase } from "../lib/supabaseClient.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(__dirname, "../../data/analysis/campaign-backtest");
const AMOUNT_PER_POINT = 300;
const ALL_BUCKETS = [
  "ge_90",
  "ge_95",
  "ge_99",
  "ge_100",
  "le_10",
  "le_5",
  "le_1",
  "le_0",
];

function perms3(arr) {
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    for (let j = 0; j < arr.length; j++) {
      if (j === i) continue;
      for (let k = 0; k < arr.length; k++) {
        if (k === i || k === j) continue;
        out.push([arr[i], arr[j], arr[k]]);
      }
    }
  }
  return out;
}

function combos3(arr) {
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    for (let j = i + 1; j < arr.length; j++) {
      for (let k = j + 1; k < arr.length; k++) {
        out.push([arr[i], arr[j], arr[k]]);
      }
    }
  }
  return out;
}

// パターン定義: rankingは[最有力,...,最弱]の6艇順
const PATTERNS = [
  {
    key: "baseline_trifecta_3pt",
    label: "現行: 3連単3点（同一3艇の順列）",
    betType: "trifecta",
    combos: (r) => [
      [r[0], r[1], r[2]],
      [r[0], r[2], r[1]],
      [r[1], r[0], r[2]],
    ],
  },
  {
    key: "box3_trifecta_6pt",
    label: "3連単ボックス（上位3艇・6点）",
    betType: "trifecta",
    combos: (r) => perms3([r[0], r[1], r[2]]),
  },
  {
    key: "formation_1fix_2-3from234_4pt",
    label: "フォーメーション: 1着r1固定・2-3着はr2,r3,r4（4点）",
    betType: "trifecta",
    combos: (r) => {
      const rest = [r[1], r[2], r[3]];
      const out = [];
      for (const b of rest) {
        for (const c of rest) {
          if (b === c) continue;
          out.push([r[0], b, c]);
        }
      }
      return out;
    },
  },
  {
    key: "formation_12fix_3from345_3pt",
    label: "フォーメーション: 1-2着r1-r2固定・3着はr3,r4,r5（3点）",
    betType: "trifecta",
    combos: (r) => [r[2], r[3], r[4]].map((c) => [r[0], r[1], c]),
  },
  {
    key: "nagashi_1fix_all5_20pt",
    label: "1着r1ながし・2-3着は残り5艇総流し（20点）",
    betType: "trifecta",
    combos: (r) => perms3(r.slice(1)).map(([b, c]) => [r[0], b, c]),
  },
  {
    key: "trio_box3_1pt",
    label: "3連複ボックス（上位3艇・1点）",
    betType: "trio",
    combos: (r) => [[r[0], r[1], r[2]]],
  },
  {
    key: "trio_box4_4pt",
    label: "3連複ボックス（上位4艇・4点）",
    betType: "trio",
    combos: (r) => combos3([r[0], r[1], r[2], r[3]]),
  },
];

function sortedKey(arr) {
  return [...arr].sort((a, b) => a - b).join("-");
}

async function main() {
  const inputFile = process.argv[2];
  if (!inputFile) {
    console.error(
      "使い方: node scripts/analysis/campaign-backtest-betting-patterns.js <ranking-source picks-*.json>",
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
      .select("race_id, rank1, rank2, rank3, payout_trifecta, payout_trio")
      .in("race_id", batchIds);
    if (error) throw new Error(`race_results取得エラー: ${error.message}`);
    for (const row of data) resultByRaceId.set(row.race_id, row);
  }

  const summary = {};
  for (const pattern of PATTERNS) {
    summary[pattern.key] = {};
    for (const bucket of ALL_BUCKETS)
      summary[pattern.key][bucket] = { spend: 0, payout: 0, hits: 0, n: 0 };
  }

  for (const race of races) {
    const result = resultByRaceId.get(race.raceId);
    if (!result || result.rank1 == null) continue;
    const ranking = race.ranking;
    if (!ranking || ranking.length < 6) continue;
    const actualOrdered = [result.rank1, result.rank2, result.rank3];
    const actualSet = sortedKey(actualOrdered);
    const actualOrderedKey = actualOrdered.join("-");

    for (const pattern of PATTERNS) {
      const combos = pattern.combos(ranking);
      const spend = combos.length * AMOUNT_PER_POINT;
      let hit = false;
      if (pattern.betType === "trifecta") {
        hit = combos.some((c) => c.join("-") === actualOrderedKey);
      } else {
        const uniqueSets = new Set(combos.map(sortedKey));
        hit = uniqueSets.has(actualSet);
      }
      // 実態逆転: 3連単はpayout_trio、3連複はpayout_trifecta
      const payoutCol =
        pattern.betType === "trifecta"
          ? result.payout_trio
          : result.payout_trifecta;
      const payout = hit ? Math.round((payoutCol / 100) * AMOUNT_PER_POINT) : 0;

      for (const bucket of race.buckets) {
        if (!ALL_BUCKETS.includes(bucket)) continue;
        const s = summary[pattern.key][bucket];
        s.spend += spend;
        s.payout += payout;
        s.hits += hit ? 1 : 0;
        s.n += 1;
      }
    }
  }

  for (const bucket of ["ge_99", "ge_100"]) {
    console.log(`\n===== ${bucket} =====`);
    for (const pattern of PATTERNS) {
      const s = summary[pattern.key][bucket];
      if (!s || s.n === 0) continue;
      const recovery =
        s.spend > 0 ? ((s.payout / s.spend) * 100).toFixed(1) : "—";
      const hitRate = ((s.hits / s.n) * 100).toFixed(1);
      console.log(
        `${pattern.label.padEnd(42)} n=${String(s.n).padStart(3)}  的中率${hitRate}%  購入${s.spend.toLocaleString()}円→払戻${s.payout.toLocaleString()}円  回収率${recovery}%`,
      );
    }
  }

  const outPath = path.join(
    DIR,
    `betting-patterns-${inputFile.replace(/^picks-/, "")}`,
  );
  await fs.writeFile(outPath, JSON.stringify(summary, null, 2) + "\n");
  console.log(`\n詳細を書き出した: ${outPath}`);
}

main().catch((error) => {
  console.error("❌ 実行中にエラーが発生しました:", error.message);
  process.exit(1);
});
