/**
 * campaign-backtest-generate-picks.jsの予想を実際のrace_results（rank1/2/3）と
 * 突き合わせ、閾値バケットごとに的中率・回収率を集計する。
 *
 * 購入額は1点300円×3点=900円/レース固定（spec.mdのパイロット企画と同条件）。
 *
 * ⚠️ DB列名の罠（scripts/lib/payoutCalculator.js・backtest-unified-model.js等で
 * 既知）: race_results.payout_trifecta は実態3連複（順不同）の払戻、
 * payout_trio は実態3連単（着順一致）の払戻。名前と実態が英日逆転している。
 * 本スクリプトは着順一致（3連単）判定のためpayout_trioを参照する
 * （--bet=trioを指定すると順不同判定+payout_trifectaで3連複として集計する）。
 *
 * 使い方:
 *   node scripts/analysis/campaign-backtest-score.js picks-xxx.json           # 3連単（着順一致）
 *   node scripts/analysis/campaign-backtest-score.js picks-xxx.json --bet=trio # 3連複（順不同、1点のみ）
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

function sortedKey(combo) {
  return combo
    .split("-")
    .map(Number)
    .sort((a, b) => a - b)
    .join("-");
}

async function main() {
  const inputFile = process.argv[2];
  const betType = process.argv.includes("--bet=trio") ? "trio" : "trifecta";
  if (!inputFile) {
    console.error(
      "使い方: node scripts/analysis/campaign-backtest-score.js <picks-*.json> [--bet=trio]",
    );
    process.exit(1);
  }
  const picks = JSON.parse(
    await fs.readFile(path.join(DIR, inputFile), "utf-8"),
  );

  const raceIds = picks.map((p) => p.raceId);
  const { data: results, error } = await supabase
    .from("race_results")
    .select("race_id, rank1, rank2, rank3, payout_trifecta, payout_trio")
    .in("race_id", raceIds);
  if (error) throw new Error(`race_results取得エラー: ${error.message}`);
  const resultByRaceId = new Map(results.map((r) => [r.race_id, r]));

  const detail = [];
  for (const p of picks) {
    const result = resultByRaceId.get(p.raceId);
    if (!result || result.rank1 == null) {
      detail.push({ ...p, status: "結果未確定/取得不可" });
      continue;
    }
    const actual = `${result.rank1}-${result.rank2}-${result.rank3}`;

    if (betType === "trio") {
      // 3連複: picksは元々3連単用の同一3艇の順列のため、艇の組み合わせで重複排除して1点として扱う
      const uniqueCombos = [...new Set(p.picks.map(sortedKey))];
      const hitPick = uniqueCombos.find((combo) => combo === sortedKey(actual));
      const spend = uniqueCombos.length * AMOUNT_PER_POINT;
      // 実態逆転: 3連複の払戻はpayout_trifecta列
      const payout = hitPick
        ? Math.round((result.payout_trifecta / 100) * AMOUNT_PER_POINT)
        : 0;
      detail.push({
        ...p,
        picks: uniqueCombos,
        actual,
        hit: Boolean(hitPick),
        spend,
        payout,
        net: payout - spend,
      });
      continue;
    }

    const hitPick = p.picks.find((combo) => combo === actual);
    const spend = p.picks.length * AMOUNT_PER_POINT;
    // 実態逆転: 3連単の払戻はpayout_trio列
    const payout = hitPick
      ? Math.round((result.payout_trio / 100) * AMOUNT_PER_POINT)
      : 0;
    detail.push({
      ...p,
      actual,
      hit: Boolean(hitPick),
      spend,
      payout,
      net: payout - spend,
    });
  }

  const scored = detail.filter((d) => d.spend !== undefined);

  console.log(
    `[${betType === "trio" ? "3連複" : "3連単"}] 集計対象: ${scored.length}件（結果未確定: ${detail.length - scored.length}件）\n`,
  );

  for (const bucket of ALL_BUCKETS) {
    const rows = scored.filter((d) => d.buckets.includes(bucket));
    if (rows.length === 0) continue;
    const spend = rows.reduce((s, r) => s + r.spend, 0);
    const payout = rows.reduce((s, r) => s + r.payout, 0);
    const hits = rows.filter((r) => r.hit).length;
    const recoveryRate = spend > 0 ? ((payout / spend) * 100).toFixed(1) : "—";
    console.log(
      `${bucket.padEnd(8)}: ${String(rows.length).padStart(3)}件  的中${String(hits).padStart(2)}件（的中率${((hits / rows.length) * 100).toFixed(1)}%）  購入${spend.toLocaleString()}円 → 払戻${payout.toLocaleString()}円  回収率${recoveryRate}%`,
    );
  }

  const suffix = betType === "trio" ? "-trio" : "";
  const outPath = path.join(
    DIR,
    `scored${suffix}-${inputFile.replace(/^picks-/, "")}`,
  );
  await fs.writeFile(outPath, JSON.stringify(detail, null, 2) + "\n");
  console.log(`\n詳細を書き出した: ${outPath}`);
}

main().catch((error) => {
  console.error("❌ 実行中にエラーが発生しました:", error.message);
  process.exit(1);
});
