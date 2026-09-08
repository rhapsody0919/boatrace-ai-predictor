/**
 * v5モデル（出走表×展開予測・1号艇除外ランキング）に対して、
 * 複数の掛け方パターンを閾値バケット別に一括比較する。
 *
 * ⚠️ DB列名の罠: 3連単の払戻はpayout_trio列、3連複の払戻はpayout_trifecta列。
 *
 * 使い方: node scripts/analysis/campaign-backtest-v5-betting-patterns.js picks-v5-combined-exclude-boat1-xxx.json
 */
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { supabase } from "../lib/supabaseClient.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(__dirname, "../../data/analysis/campaign-backtest");
const AMOUNT_PER_POINT = 300;
const BUCKETS = ["ge_90", "ge_95", "ge_99", "ge_100"];

function perms3(arr) {
  const out = [];
  for (const i of arr)
    for (const j of arr)
      for (const k of arr) {
        if (i !== j && j !== k && i !== k) out.push([i, j, k]);
      }
  return out;
}
function combos3(arr) {
  const out = [];
  for (let i = 0; i < arr.length; i++)
    for (let j = i + 1; j < arr.length; j++)
      for (let k = j + 1; k < arr.length; k++)
        out.push([arr[i], arr[j], arr[k]]);
  return out;
}
function sortedKey(arr) {
  return [...arr].sort((a, b) => a - b).join("-");
}

const PATTERNS = [
  {
    key: "3pt",
    label: "現行: 3点（上位3艇の順列3通り）",
    betType: "trifecta",
    combos: (r) => [
      [r[0], r[1], r[2]],
      [r[0], r[2], r[1]],
      [r[1], r[0], r[2]],
    ],
  },
  {
    key: "5pt",
    label: "5点（上位3艇ボックスの6通りから最弱順1通りを除く）",
    betType: "trifecta",
    combos: (r) => perms3([r[0], r[1], r[2]]).slice(0, 5),
  },
  {
    key: "box6",
    label: "ボックス6点（上位3艇の全順列）",
    betType: "trifecta",
    combos: (r) => perms3([r[0], r[1], r[2]]),
  },
  {
    key: "formation_1fix_234",
    label: "フォーメーション: 1着r1固定・2-3着r2,r3,r4（4点）",
    betType: "trifecta",
    combos: (r) => {
      const rest = [r[1], r[2], r[3]];
      const out = [];
      for (const b of rest)
        for (const c of rest) if (b !== c) out.push([r[0], b, c]);
      return out;
    },
  },
  {
    key: "formation_12fix_345",
    label: "フォーメーション: 1-2着r1-r2固定・3着r3,r4,r5（3点）",
    betType: "trifecta",
    combos: (r) => [r[2], r[3], r[4]].map((c) => [r[0], r[1], c]),
  },
  {
    key: "trio_box3",
    label: "3連複ボックス（上位3艇・1点）",
    betType: "trio",
    combos: (r) => [[r[0], r[1], r[2]]],
  },
  {
    key: "trio_box4",
    label: "3連複ボックス（上位4艇・4点）",
    betType: "trio",
    combos: (r) => combos3([r[0], r[1], r[2], r[3]]),
  },
];

async function main() {
  const inputFile = process.argv[2];
  if (!inputFile) {
    console.error(
      "使い方: node scripts/analysis/campaign-backtest-v5-betting-patterns.js <picks-v5-*.json>",
    );
    process.exit(1);
  }
  const races = JSON.parse(
    await fs.readFile(path.join(DIR, inputFile), "utf-8"),
  );

  const raceIds = races.map((r) => r.raceId);
  const resultByRaceId = new Map();
  for (let i = 0; i < raceIds.length; i += 200) {
    const batch = raceIds.slice(i, i + 200);
    const { data, error } = await supabase
      .from("race_results")
      .select("race_id, rank1, rank2, rank3, payout_trifecta, payout_trio")
      .in("race_id", batch);
    if (error) throw new Error(error.message);
    for (const row of data) resultByRaceId.set(row.race_id, row);
  }

  const summary = {};
  for (const p of PATTERNS) {
    summary[p.key] = {};
    for (const b of BUCKETS)
      summary[p.key][b] = { spend: 0, payout: 0, hits: 0, n: 0 };
  }

  for (const race of races) {
    const result = resultByRaceId.get(race.raceId);
    if (!result || result.rank1 == null) continue;
    const r = race.ranking;
    if (!r || r.length < 5) continue;
    const actualOrdered = [result.rank1, result.rank2, result.rank3];
    const actualOrderedKey = actualOrdered.join("-");
    const actualSet = sortedKey(actualOrdered);

    for (const pattern of PATTERNS) {
      const combos = pattern.combos(r);
      const spend = combos.length * AMOUNT_PER_POINT;
      let hit;
      if (pattern.betType === "trifecta") {
        hit = combos.some((c) => c.join("-") === actualOrderedKey);
      } else {
        hit = new Set(combos.map(sortedKey)).has(actualSet);
      }
      const payoutCol =
        pattern.betType === "trifecta"
          ? result.payout_trio
          : result.payout_trifecta;
      const payout = hit ? Math.round((payoutCol / 100) * AMOUNT_PER_POINT) : 0;

      for (const bucket of race.buckets) {
        if (!BUCKETS.includes(bucket)) continue;
        const s = summary[pattern.key][bucket];
        s.spend += spend;
        s.payout += payout;
        s.hits += hit ? 1 : 0;
        s.n += 1;
      }
    }
  }

  for (const bucket of BUCKETS) {
    console.log(`\n===== ${bucket} =====`);
    for (const pattern of PATTERNS) {
      const s = summary[pattern.key][bucket];
      if (!s || s.n === 0) continue;
      const recovery =
        s.spend > 0 ? ((s.payout / s.spend) * 100).toFixed(1) : "—";
      console.log(
        `${pattern.label.padEnd(46)} n=${String(s.n).padStart(3)}  的中率${((s.hits / s.n) * 100).toFixed(1)}%  購入${s.spend.toLocaleString()}円→払戻${s.payout.toLocaleString()}円  回収率${recovery}%`,
      );
    }
  }
}

main().catch((error) => {
  console.error("❌ 実行中にエラーが発生しました:", error.message);
  process.exit(1);
});
