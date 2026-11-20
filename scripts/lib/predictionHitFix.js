import { supabase, fetchAll } from "./supabaseClient.js";
import {
  PREDICTION_HIT_COLUMNS as HIT_COLUMNS,
  buildPredictionHitUpdate,
} from "./hitCalculator.js";

// 結果があるのにis_hit_winがNULLの予測を修正
// startDate〜endDate（両端含む、race_id昇順比較）の範囲で欠落を検知・修復する。
// 通常呼び出しは直近数日分の範囲を渡し、当日限定では拾えない過去日の
// 一時的な書き込み失敗（2026-09-06発覚）を後続の実行で自己修復できるようにする。
// GitHub Actions では結果取得のたびに、Vercel Cron では日次の result-catchup で呼ぶ（T4b-02-1）。
// 戻り値: 欠落していた件数と修正できた件数、判定対象外の件数（呼び出し側の多くは無視する）
export async function fixMissingHitFlags(
  startDate,
  endDate = startDate,
  { client = supabase } = {},
) {
  // is_hit_winがNULLの予測を取得
  // ⚠️ Supabaseのデフォルトlimit(1000行)を超える可能性があるため.range()でページネーションする
  // （2026-09-06発覚: 日付範囲を広げた際に無ページネーションのままだったため、範囲内の件数が
  // 1000件を超えると挿入順で末尾＝直近日（当日）の結果が切り捨てられ、当日分の欠落が
  // 一切修復されないまま固着していた）
  // 共通 fetchAll（失敗は例外。以前の自前のループは途中までの結果で続行し、欠落件数を少なく報告していた。BOA-391）
  const missingPredictions = await fetchAll(
    "predictions",
    `prediction_id, race_id, top_pick, top_2nd, top_3rd, feature_contributions, ${HIT_COLUMNS.join(", ")}`,
    (q) =>
      q
        .gte("race_id", startDate)
        .lt("race_id", `${endDate}~`)
        .is("is_hit_win", null)
        .order("prediction_id"),
    { client },
  );

  if (missingPredictions.length === 0) {
    return { missing: 0, fixed: 0 }; // 欠落なし
  }

  console.log(
    `\n🔧 欠落した的中フラグを修正中... (${missingPredictions.length}件, ${startDate}〜${endDate})`,
  );

  // 結果データを取得（同様にページネーション）
  const results = await fetchAll(
    "race_results",
    "race_id, rank1, rank2, rank3, payout_win, payout_place_1, payout_place_2, payout_trifecta, payout_trio, race_status, refund_boats",
    (q) =>
      q.gte("race_id", startDate).lt("race_id", `${endDate}~`).order("race_id"),
    { client },
  );

  const resultsMap = new Map();
  for (const r of results) {
    resultsMap.set(r.race_id, r);
  }

  let fixed = 0;
  let notJudgeable = 0; // 判定対象外のまま（不成立・単勝の艇が返還）。欠落ではない
  for (const pred of missingPredictions) {
    const result = resultsMap.get(pred.race_id);
    if (!result || !result.rank1) continue;

    const update = buildPredictionHitUpdate(pred, result);
    // 判定対象外（不成立・返還艇を含む券種）は NULL のまま。is_hit_win が NULL の行は毎回ここに来るので、
    // 今の値と同じなら書かない（変更の無い行は書かない。BOA-544）
    if (HIT_COLUMNS.every((c) => (pred[c] ?? null) === update[c])) {
      notJudgeable++;
      continue;
    }

    const { error: updateError } = await client
      .from("predictions")
      .update(update)
      .eq("prediction_id", pred.prediction_id);

    if (!updateError) fixed++;
  }

  if (fixed > 0) {
    console.log(`  ✅ ${fixed}件の欠落フラグを修正`);
  }
  return {
    missing: missingPredictions.length - notJudgeable,
    fixed,
    notJudgeable,
  };
}
