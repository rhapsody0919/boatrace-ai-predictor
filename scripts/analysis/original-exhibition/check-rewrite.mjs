/**
 * オリジナル展示の行が保存後に書き換わったかの確認（読み取りのみ）
 *
 * race_original_exhibition・race_original_exhibition_values の各行で
 * updated_at − created_at が60秒を超える行（＝保存後に値が変わった行）を数える。
 *
 * 使い方: node scripts/analysis/original-exhibition/check-rewrite.mjs
 * 期間: 環境変数 OX_FROM（既定 2026-09-22）以降
 */

import { supabase } from "../../lib/supabaseClient.js";

const LO = process.env.OX_FROM || "2026-09-22";

for (const table of ["race_original_exhibition", "race_original_exhibition_values"]) {
  let n = 0;
  let late = 0;
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from(table)
      .select("race_id,created_at,updated_at")
      .gte("race_id", LO)
      .order("race_id")
      .order("created_at")
      .range(from, from + 999);
    if (error) throw new Error(`${table} の取得に失敗: ${error.message}`);
    for (const r of data) {
      n++;
      if (r.updated_at && new Date(r.updated_at) - new Date(r.created_at) > 60000) late++;
    }
    if (data.length < 1000) break;
  }
  console.log(`${table}: 行 ${n}、保存から60秒より後に書き換わった行 ${late}`);
}
