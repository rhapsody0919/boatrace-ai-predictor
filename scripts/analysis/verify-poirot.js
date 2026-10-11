/**
 * ポアロ予想（BOA-104）シャドー運用の実績検証
 *
 * poirot_predictions と race_results を突き合わせ、モデルバージョン別・
 * 確信度バケット別の的中率・回収率をレポートする。テーブルへの書き込みは
 * 行わない（スキーマ変更なしのオンザフライ集計）。
 *
 * 買い目は3連単1点（top_pick-top_2nd-top_3rd）。
 * ⚠️ race_results の列名は英日逆転: payout_trio が3連単の払戻。
 *
 * 使い方:
 *   node scripts/analysis/verify-poirot.js                # 全期間
 *   node scripts/analysis/verify-poirot.js --from=2026-07-10 --to=2026-07-31
 */

import { supabase, fetchAll } from "../lib/supabaseClient.js";

const BET_YEN = 100;

// UIの信頼度バッジと同じ閾値（src/pages/Poirot.jsx / confidenceBadge）
const CONF_BUCKETS = [
  { label: "高 (p≥0.10)", min: 0.1 },
  { label: "中 (0.05≤p<0.10)", min: 0.05, max: 0.1 },
  { label: "低 (p<0.05)", min: 0, max: 0.05 },
];

function parseArgs(argv = process.argv.slice(2)) {
  const get = (name) => {
    const a = argv.find((x) => x.startsWith(`--${name}=`));
    return a ? a.split("=")[1] : null;
  };
  return { from: get("from"), to: get("to") };
}

function newAcc() {
  return { bets: 0, hits: 0, payout: 0 };
}

function add(acc, hit, payout) {
  acc.bets += 1;
  if (hit) {
    acc.hits += 1;
    acc.payout += payout;
  }
}

function fmt(acc) {
  const invest = acc.bets * BET_YEN;
  const hitRate = acc.bets ? ((acc.hits / acc.bets) * 100).toFixed(1) : "-";
  const recovery = invest ? ((acc.payout / invest) * 100).toFixed(1) : "-";
  return `${String(acc.bets).padStart(5)}件 | 的中 ${hitRate.padStart(5)}% | 回収 ${recovery.padStart(6)}%`;
}

async function main() {
  if (!supabase) {
    console.error("❌ Supabase 環境変数が未設定です");
    process.exit(1);
  }
  const opts = parseArgs();

  const preds = await fetchAll(
    "poirot_predictions",
    "race_id, model_version, top_pick, top_2nd, top_3rd, trifecta_prob",
    (q) => {
      let query = q;
      if (opts.from) query = query.gte("race_id", opts.from);
      if (opts.to) query = query.lte("race_id", `${opts.to}~`); // race_id は日付先頭
      return query.order("race_id").order("model_version");
    },
  );
  if (preds.length === 0) {
    console.log("📭 poirot_predictions にデータがありません");
    return;
  }

  // 結果をチャンク取得
  const raceIds = [...new Set(preds.map((p) => p.race_id))];
  const results = new Map();
  for (let i = 0; i < raceIds.length; i += 100) {
    const { data, error } = await supabase
      .from("race_results")
      .select(
        "race_id, rank1, rank2, rank3, payout_trio, is_cancelled, is_no_race",
      )
      .in("race_id", raceIds.slice(i, i + 100));
    if (error) {
      console.error("❌ race_results 取得エラー:", error.message);
      process.exit(1);
    }
    for (const r of data || []) {
      if (!r.is_cancelled && !r.is_no_race && r.rank1 && r.rank2 && r.rank3) {
        results.set(r.race_id, r);
      }
    }
  }

  // モデル別 × 確信度バケット別に集計
  const stats = new Map(); // model -> { total, buckets: [acc...] }
  let unresolved = 0;
  for (const p of preds) {
    const res = results.get(p.race_id);
    if (!res) {
      unresolved++;
      continue;
    }
    const hit =
      p.top_pick === res.rank1 &&
      p.top_2nd === res.rank2 &&
      p.top_3rd === res.rank3;
    const payout = hit ? res.payout_trio || 0 : 0;

    if (!stats.has(p.model_version)) {
      stats.set(p.model_version, {
        total: newAcc(),
        buckets: CONF_BUCKETS.map(() => newAcc()),
      });
    }
    const s = stats.get(p.model_version);
    add(s.total, hit, payout);
    const prob = p.trifecta_prob ?? 0;
    CONF_BUCKETS.forEach((b, i) => {
      if (prob >= b.min && (b.max == null || prob < b.max)) {
        add(s.buckets[i], hit, payout);
      }
    });
  }

  const scope =
    opts.from || opts.to
      ? `${opts.from || "最初"} 〜 ${opts.to || "最新"}`
      : "全期間";
  console.log("\n════════════════════════════════════════════════════");
  console.log("  ポアロ予想 シャドー運用実績（3連単1点）");
  console.log(`  対象: ${scope} / 結果未確定スキップ: ${unresolved}件`);
  console.log("════════════════════════════════════════════════════");

  for (const [model, s] of [...stats.entries()].sort()) {
    console.log(`\n◆ ${model}`);
    console.log(`  全体          : ${fmt(s.total)}`);
    CONF_BUCKETS.forEach((b, i) => {
      console.log(
        `  ${b.label.padEnd(14, "　").slice(0, 14)}: ${fmt(s.buckets[i])}`,
      );
    });
  }
  console.log(
    "\n判定基準: 信頼度「高」バケットの回収率がバックテスト（V1 106%/V2 101%）に" +
      "\n近い水準を維持できているかを確認する。乖離が大きければ再学習・閾値見直し。\n",
  );
}

main().catch((err) => {
  console.error("❌ エラー:", err);
  process.exit(1);
});
