/**
 * race_conditions への書き込み（気象列を含む）の共通処理（BOA-358）
 *
 * weather_observed_at 列（マイグレーション069）が未適用でも、コードが先にデプロイされて本番が壊れない
 * ようにする。未適用のDBへ weather_observed_at を含む行を書くと、その行の他の列（series_day・
 * race_title・気象そのもの）まで書き込みが失敗するため、列が無いことを示すエラーを受けたら
 * weather_observed_at を除いて1回だけ書き直す。
 * 列が無い場合の判定は optionalColumns.js に共通化している（PGRST204・42703の両方に対応）。
 */

import { isColumnMissingError, stripColumns } from "./optionalColumns.js";
import { upsertChangedRows } from "./unchangedRows.js";

export const OBSERVED_AT_COLUMN = "weather_observed_at";

/**
 * DBのエラーが「列が存在しない」を示すか（weather_observed_at に関するものに限る）。
 *
 * **エラーオブジェクトを渡す**（メッセージ文字列だけでは、コードが分からず判定できない）。
 * 2026-09-27、`isColumnMissingError` をコードでの判定に厳格化した際、ここが `error.message`
 * だけを渡していたためフォールバックが効かなくなりかけた。
 *
 * @param {{message?: string, code?: string}|null|undefined} error
 */
export function isObservedAtColumnMissing(error) {
  return isColumnMissingError(error, [OBSERVED_AT_COLUMN]);
}

/**
 * race_conditions へ、変更のある行だけを upsert する。weather_observed_at 列が無いDBでは、
 * その列を除いて書き直す（気象の値そのものは書く）。
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} client
 * @param {Object[]} rows
 * @param {{label?: string, dryRun?: boolean, optionalColumnGroups?: Record<string, string[]>}} [options]
 * @returns {Promise<Awaited<ReturnType<typeof upsertChangedRows>> & {observedAtSupported: boolean}>}
 */
export async function upsertRaceConditions(
  client,
  rows,
  { label = "race_conditions", dryRun = false, optionalColumnGroups = {} } = {},
) {
  const write = (targetRows, targetLabel) =>
    upsertChangedRows(client, "race_conditions", targetRows, {
      onConflict: "race_id",
      keyColumns: ["race_id"],
      label: targetLabel,
      dryRun,
      // 未適用のマイグレーションの列は、除いて書き直す（例: 081 の距離・ラベル。scripts/lib/preRaceSchema.js）
      optionalColumnGroups,
    });

  const first = await write(rows, label);
  if (first.error && isObservedAtColumnMissing(first.error)) {
    console.warn(
      `⚠️ race_conditions.${OBSERVED_AT_COLUMN} が未適用のため、この列を除いて書き直します（マイグレーション069）`,
    );
    const retry = await write(
      stripColumns(rows, [OBSERVED_AT_COLUMN]),
      `${label}（観測時刻なし）`,
    );
    return { ...retry, observedAtSupported: false };
  }
  return { ...first, observedAtSupported: true };
}
