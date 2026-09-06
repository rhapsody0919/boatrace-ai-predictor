/**
 * Vercel Edge Function: 週次ネタ提案Routineの手動起動
 * POST /api/admin/sns-hub/trigger-weekly-proposer
 * body: { categoryKey?: string } — 省略時はRoutine側が交互取り出しで自動選定する（従来通り）
 *
 * sns-topic-proposer-weekly（docs/operation/sns-topic-proposer-weekly.md）は
 * 通常週次cronでのみ起動するため、承認済みストックが少ない・動作確認したい
 * 等の場面で管理画面から即時起動できるようにする（ユーザー要望、2026-09-04）。
 * このRoutineはネタ（sns_topics/sns_topic_targets）を登録するだけで、
 * 下書き生成は行わない（generate.jsのSNS_HUB_ROUTINEとは別Routine）。
 *
 * categoryKeyは2026-09-06追加（ユーザー要望: 豆知識型など特定の型だけを
 * いつでも手動生成したい）。trigger-daily-auto-proposer.jsと同じ
 * payload受け渡し方式に揃えた。
 *
 * 環境変数 TOPIC_PROPOSER_WEEKLY_ROUTINE_FIRE_URL / _FIRE_TOKEN が必要
 * （fireRoutineのenvPrefix規約、ADR 0020）。未設定の場合はfireRoutine内で
 * {fired: false, reason: "not_configured"}を返す（エラーにはしない）。
 */

import {
  jsonResponse,
  isConfigured,
  fireRoutine,
} from "../../_lib/snsHubHelpers.js";

export const config = {
  runtime: "edge",
};

export default async function handler(req) {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }
  if (!isConfigured()) {
    return jsonResponse({ error: "Supabase環境変数が未設定です" }, 500);
  }

  let categoryKey;
  try {
    const body = await req.json();
    categoryKey =
      typeof body?.categoryKey === "string" ? body.categoryKey.trim() : "";
  } catch {
    categoryKey = "";
  }

  try {
    const routineResult = await fireRoutine(
      "TOPIC_PROPOSER_WEEKLY_ROUTINE",
      categoryKey ? { categoryKey } : {},
    );
    return jsonResponse({ routine: routineResult });
  } catch (error) {
    console.error(
      "SNS Hub trigger-weekly-proposer Edge function error:",
      error,
    );
    return jsonResponse({ error: error.message }, 500);
  }
}
