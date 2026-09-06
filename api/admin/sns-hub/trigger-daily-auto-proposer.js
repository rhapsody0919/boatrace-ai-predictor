/**
 * Vercel Edge Function: 日次・一般ネタ自動提案Routineの手動起動
 * POST /api/admin/sns-hub/trigger-daily-auto-proposer
 * body: { categoryKey?: string } — 省略時はRoutine側が自動選定する（従来通り）
 *
 * sns-topic-proposer-daily-auto（docs/operation/sns-topic-proposer-daily-auto.md）
 * は通常深夜〜早朝のcronでのみ起動するため、承認済みストックが少ない・動作確認
 * したい等の場面で管理画面から即時起動できるようにする（trigger-weekly-proposer.js
 * と同じ目的、2026-09-04追加）。このRoutineはautoApprove:true固定でネタを登録する
 * （sns_topics/sns_topic_targets）だけで、下書き生成は行わない。当日レース開催が
 * 無い日は提案せず正常終了する場合がある（不具合ではない）。
 *
 * categoryKeyは2026-09-04追加（要件: 日次ネタ生成で型を選べるようにする）。
 * 2026-09-02に一度「会場攻略型など」ボタンの型選択ドロップダウンとして実装
 * 済みだったが、9/4のsns-topic-gate移行で旧UIごと削除されていた。DB
 * （sns_topic_categories）・fireRoutineのpayload受け渡し機構は既存のまま
 * 再利用し、UI・Routineドキュメント側だけを再接続する
 *
 * 環境変数 TOPIC_PROPOSER_DAILY_AUTO_ROUTINE_FIRE_URL / _FIRE_TOKEN が必要
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
      "TOPIC_PROPOSER_DAILY_AUTO_ROUTINE",
      categoryKey ? { categoryKey } : {},
    );
    return jsonResponse({ routine: routineResult });
  } catch (error) {
    console.error(
      "SNS Hub trigger-daily-auto-proposer Edge function error:",
      error,
    );
    return jsonResponse({ error: error.message }, 500);
  }
}
