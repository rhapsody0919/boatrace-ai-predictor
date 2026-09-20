/**
 * 既存の race_results の誤り（Q6）を、公式の結果ページの再取得で修正するための計画づくりと書き込み。
 * 書き込みは scripts/maintenance/audit-race-result-anomalies.js の --apply からだけ呼ぶ
 * （既定は読み取りのみ。ユーザーの承認後に実行する）。
 *
 * 修正する列だけを書く（rank4〜6・払戻・人気・race_status・refund_boats・remark）。rank1〜3・レースタイム・
 * 決まり手・進入・的中フラグには触れない。既存の値と同じ列は書かない（race_results の UPDATE は
 * trg_update_predictions で predictions・bet_recommendations の再UPDATEを連鎖させるため、変更の無い行は書かない）。
 */

import {
  buildPayoutRows,
  buildResultExtras,
  buildTimingRows,
} from "./raceResultRows.js";
import { normalizeValue } from "./unchangedRows.js";

/** 修正の対象にする race_results の列 */
export const FIX_RESULT_COLUMNS = Object.freeze([
  "rank4",
  "rank5",
  "rank6",
  "payout_win",
  "payout_place_1",
  "payout_place_2",
  "payout_trifecta",
  "payout_trio",
  "payout_exacta",
  "payout_quinella",
  "payout_wide_1",
  "payout_wide_2",
  "payout_wide_3",
  "popularity_trifecta",
  "popularity_trio",
  "popularity_exacta",
  "popularity_quinella",
  "popularity_wide_1",
  "popularity_wide_2",
  "popularity_wide_3",
]);

/** 078の列（適用済みのときだけ書く） */
export const FIX_EXTRA_COLUMNS = Object.freeze([
  "race_status",
  "refund_boats",
  "remark",
]);

/**
 * 1レースの修正計画を作る（純関数）。
 *
 * @param {Record<string, unknown>} existingRow race_results の現在の行（FIX_RESULT_COLUMNS・FIX_EXTRA_COLUMNS の列を含む）
 * @param {Record<string, unknown>} newRow buildRaceResultRow が作った行（再取得した結果ページ由来）
 * @param {NonNullable<ReturnType<import("./raceResultRows.js").toLegacyResult>>} parsed
 * @param {{results: boolean, timings: boolean, payouts: boolean}} schema マイグレーション078・077・079の適用状況
 */
export function buildFixPlan(existingRow, newRow, parsed, schema) {
  const columns = schema.results
    ? [...FIX_RESULT_COLUMNS, ...FIX_EXTRA_COLUMNS]
    : FIX_RESULT_COLUMNS;
  const desired = { ...newRow, ...buildResultExtras(parsed) };
  const update = {};
  for (const column of columns) {
    if (!(column in desired)) continue; // 判定できなかった列（race_status 等）は書かない
    if (
      normalizeValue(desired[column]) !== normalizeValue(existingRow[column])
    ) {
      update[column] = desired[column] ?? null;
    }
  }
  return {
    race_id: newRow.race_id,
    resultUpdate: update,
    // 艇別・払戻明細は、対応するマイグレーションの適用済みのときだけ。全行を書く（既存行との差分は upsert が吸収する）
    timingRows: schema.timings
      ? buildTimingRows(newRow.race_id, parsed, { extended: true })
      : [],
    payoutRows: schema.payouts ? buildPayoutRows(newRow.race_id, parsed) : [],
  };
}

/**
 * 修正を書き込む。1レースずつ、race_results（変更のある列だけ）→ race_start_timings → race_payouts の順。
 * 1レースの失敗は、他のレースを止めない（結果に error を残して返す）。
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} client
 * @param {ReturnType<typeof buildFixPlan>} plan
 * @param {{now?: () => Date}} [options]
 * @returns {Promise<{race_id: string, wrote: {results: boolean, timings: number, payouts: number}, error?: string}>}
 */
export async function applyFixPlan(
  client,
  plan,
  { now = () => new Date() } = {},
) {
  const wrote = { results: false, timings: 0, payouts: 0 };
  try {
    if (Object.keys(plan.resultUpdate).length > 0) {
      const { error } = await client
        .from("race_results")
        .update(plan.resultUpdate)
        .eq("race_id", plan.race_id);
      if (error) throw new Error(`race_results 更新エラー: ${error.message}`);
      wrote.results = true;
    }
    const stamp = now().toISOString();
    if (plan.timingRows.length > 0) {
      const { error } = await client.from("race_start_timings").upsert(
        plan.timingRows.map((r) => ({ ...r, updated_at: stamp })),
        { onConflict: "race_id,boat_number" },
      );
      if (error)
        throw new Error(`race_start_timings 書き込みエラー: ${error.message}`);
      wrote.timings = plan.timingRows.length;
    }
    if (plan.payoutRows.length > 0) {
      const { error } = await client.from("race_payouts").upsert(
        plan.payoutRows.map((r) => ({ ...r, updated_at: stamp })),
        { onConflict: "race_id,bet_type,seq" },
      );
      if (error)
        throw new Error(`race_payouts 書き込みエラー: ${error.message}`);
      wrote.payouts = plan.payoutRows.length;
    }
    return { race_id: plan.race_id, wrote };
  } catch (error) {
    return { race_id: plan.race_id, wrote, error: error.message };
  }
}
