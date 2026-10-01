/**
 * 不成立・一部返還のレースの予想の的中判定を、今の規則（BOA-544）で書き直す。
 *
 * 判定の規則は buildPredictionHitUpdate（scripts/lib/hitCalculator.js）と同じ。不成立は全券種と展開予測を NULL に、
 * 返還艇を含む券種を NULL にする。対象は race_results.race_status が no_race・partial_refund のレースの予想だけで
 * （通常のレースの判定は変わらない）、書くのは今の値と違う予想だけ。
 *
 * 既定は dry-run（書かない）。--apply で書く。dry-run でも、書き直しの前後の成績（models の集計と同じ、モデル別・
 * 券種別の的中率・回収率。is_hit_win がある予想が対象）を出す。
 *
 * 使い方:
 *   node --env-file=.env.local scripts/maintenance/backfill-refund-hit-flags.js            # dry-run
 *   node --env-file=.env.local scripts/maintenance/backfill-refund-hit-flags.js --apply    # 書き込み
 */
import { supabase, isSupabaseEnabled } from "../lib/supabaseClient.js";
import {
  PREDICTION_HIT_COLUMNS as HIT_COLUMNS,
  buildPredictionHitUpdate,
} from "../lib/hitCalculator.js";
import { summarizeHits } from "../daily/calculate-accuracy.js";

const MODELS = ["standard", "safeBet", "upsetFocus", "unified"];

/**
 * 書き直す予想を選ぶ（純関数）。
 * @param {Array<Object>} predictions 対象レースの予想（top_*・feature_contributions・HIT_COLUMNS）
 * @param {Map<string, Object>} resultsByRace race_id → race_results の行
 * @returns {Array<{prediction: Object, update: Object, changed: string[]}>}
 */
export function planRefundHitBackfill(predictions, resultsByRace) {
  const plan = [];
  for (const prediction of predictions) {
    const result = resultsByRace.get(prediction.race_id);
    if (!result || result.rank1 == null) continue;
    const update = buildPredictionHitUpdate(prediction, result);
    const changed = HIT_COLUMNS.filter(
      (c) => (prediction[c] ?? null) !== update[c],
    );
    if (changed.length > 0) plan.push({ prediction, update, changed });
  }
  return plan;
}

/** 計画を当てた後の予想の一覧（純関数。成績の前後比較に使う） */
export function applyPlan(predictions, plan) {
  const byId = new Map(plan.map((p) => [p.prediction.prediction_id, p.update]));
  return predictions.map((p) =>
    byId.has(p.prediction_id) ? { ...p, ...byId.get(p.prediction_id) } : p,
  );
}

async function fetchAll(table, columns, build) {
  const pageSize = 1000;
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build(
      supabase.from(table).select(columns),
    ).range(from, from + pageSize - 1);
    if (error)
      throw new Error(`${table} の読み取りに失敗しました: ${error.message}`);
    rows.push(...(data ?? []));
    if ((data ?? []).length < pageSize) return rows;
  }
}

const pct = (x) => `${(x * 100).toFixed(2)}%`;

async function main() {
  if (!isSupabaseEnabled()) throw new Error("Supabaseが設定されていません");
  const apply = process.argv.includes("--apply");

  const results = await fetchAll(
    "race_results",
    "race_id, rank1, rank2, rank3, payout_win, payout_place_1, payout_place_2, payout_trifecta, payout_trio, race_status, refund_boats",
    (q) => q.in("race_status", ["no_race", "partial_refund"]).order("race_id"),
  );
  const resultsByRace = new Map(results.map((r) => [r.race_id, r]));
  const raceIds = [...resultsByRace.keys()];
  const predictions = [];
  for (let i = 0; i < raceIds.length; i += 200) {
    predictions.push(
      ...(await fetchAll(
        "predictions",
        `prediction_id, race_id, model_id, top_pick, top_2nd, top_3rd, feature_contributions, ${HIT_COLUMNS.join(", ")}`,
        (q) =>
          q.in("race_id", raceIds.slice(i, i + 200)).order("prediction_id"),
      )),
    );
  }
  const plan = planRefundHitBackfill(predictions, resultsByRace);
  const byColumn = {};
  for (const p of plan)
    for (const c of p.changed) byColumn[c] = (byColumn[c] ?? 0) + 1;
  console.log(
    `${apply ? "[APPLY]" : "[DRY-RUN]"} 不成立 ${results.filter((r) => r.race_status === "no_race").length}レース・一部返還 ${results.filter((r) => r.race_status === "partial_refund").length}レース、予想 ${predictions.length}行のうち、書き直す ${plan.length}行`,
  );
  console.log(`  変わる列ごとの行数: ${JSON.stringify(byColumn)}`);

  // 成績の前後比較（models の集計と同じく、is_hit_win がある予想。書き直しで NULL になった予想は母数から外れる）
  for (const model of MODELS) {
    const all = await fetchAll(
      "predictions",
      `prediction_id, ${HIT_COLUMNS.join(", ")}`,
      (q) =>
        q
          .eq("model_id", model)
          .not("is_hit_win", "is", null)
          .order("prediction_id"),
    );
    const after = applyPlan(
      all,
      plan.filter((p) => p.prediction.model_id === model),
    ).filter((p) => p.is_hit_win != null);
    const b = summarizeHits(all);
    const a = summarizeHits(after);
    console.log(
      `\n  ${model}（書き直す ${plan.filter((p) => p.prediction.model_id === model).length}行）`,
    );
    for (const key of ["win", "place", "trifecta", "trio"]) {
      console.log(
        `    ${key.padEnd(8)} 母数 ${b[key].n}→${a[key].n}  的中率 ${pct(b[key].hitRate)}→${pct(a[key].hitRate)}（${((a[key].hitRate - b[key].hitRate) * 100).toFixed(3)}pt）  回収率 ${pct(b[key].recoveryRate)}→${pct(a[key].recoveryRate)}（${((a[key].recoveryRate - b[key].recoveryRate) * 100).toFixed(3)}pt）`,
      );
    }
  }

  if (!apply) return;
  let written = 0;
  for (const p of plan) {
    const { error } = await supabase
      .from("predictions")
      .update(p.update)
      .eq("prediction_id", p.prediction.prediction_id);
    if (error)
      throw new Error(
        `predictions ${p.prediction.prediction_id} の書き込みに失敗しました（${written}行は書き込み済み。再実行すれば残りだけ書く）: ${error.message}`,
      );
    written++;
  }
  console.log(`\n[APPLY] ${written}行を書き直した`);
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().catch((e) => {
    console.error(`❌ ${e.message}`);
    process.exit(1);
  });
}
