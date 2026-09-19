/**
 * race_conditions への書き込み（気象列を含む）の共通処理（BOA-358）
 *
 * weather_observed_at 列（マイグレーション069）が未適用でも、コードが先にデプロイされて本番が壊れない
 * ようにする。未適用のDBへ weather_observed_at を含む行を書くと、その行の他の列（series_day・
 * race_title・気象そのもの）まで書き込みが失敗するため、列が無いことを示すエラーを受けたら
 * weather_observed_at を除いて1回だけ書き直す。
 * 列が無い場合の判定はエラーメッセージで行う。PostgRESTは、UPSERTの本文に未知の列があると
 * 「Could not find the 'x' column of 'y' in the schema cache」（PGRST204）を、SELECTに未知の列が
 * あると「column y.x does not exist」（42703）を返す。両方に対応する。
 */

import { upsertChangedRows } from "./unchangedRows.js";

export const OBSERVED_AT_COLUMN = "weather_observed_at";

/** DBのエラーメッセージが「列が存在しない」を示すか（weather_observed_at に関するものに限る） */
export function isObservedAtColumnMissing(message) {
  if (!message || !message.includes(OBSERVED_AT_COLUMN)) return false;
  return /does not exist|Could not find the .* column|schema cache/i.test(
    message,
  );
}

function stripObservedAt(rows) {
  return rows.map((row) => {
    const copy = { ...row };
    delete copy[OBSERVED_AT_COLUMN];
    return copy;
  });
}

/**
 * race_conditions へ、変更のある行だけを upsert する。weather_observed_at 列が無いDBでは、
 * その列を除いて書き直す（気象の値そのものは書く）。
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} client
 * @param {Object[]} rows
 * @param {{label?: string, dryRun?: boolean}} [options]
 * @returns {Promise<Awaited<ReturnType<typeof upsertChangedRows>> & {observedAtSupported: boolean}>}
 */
export async function upsertRaceConditions(
  client,
  rows,
  { label = "race_conditions", dryRun = false } = {},
) {
  const write = (targetRows, targetLabel) =>
    upsertChangedRows(client, "race_conditions", targetRows, {
      onConflict: "race_id",
      keyColumns: ["race_id"],
      label: targetLabel,
      dryRun,
    });

  const first = await write(rows, label);
  if (first.error && isObservedAtColumnMissing(first.error.message)) {
    console.warn(
      `⚠️ race_conditions.${OBSERVED_AT_COLUMN} が未適用のため、この列を除いて書き直します（マイグレーション069）`,
    );
    const retry = await write(
      stripObservedAt(rows),
      `${label}（観測時刻なし）`,
    );
    return { ...retry, observedAtSupported: false };
  }
  return { ...first, observedAtSupported: true };
}
