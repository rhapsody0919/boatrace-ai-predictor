/**
 * Vercel Edge Function: 「⚡今すぐ生成」ボタン
 * POST /api/admin/sns-hub/topics/:id/targets/:targetId/fire
 * body: {}
 *
 * status='pending'のsns_topic_targets行に対し、対象チャネルのパイプラインRoutineを
 * 即時発火する（spec.md要件26）。対象ターゲット行はポーリングでも通常いずれ拾われるが、
 * このボタンは起動タイミングを早めるショートカットであり、生成結果自体は変わらない。
 * claim自体はRoutine側（各sns-pipeline-*.mdの`generate_now`アクション）が行うため、
 * このエンドポイントはstatusを変更しない。
 */

import {
  jsonResponse,
  isConfigured,
  isValidUuid,
  getTopicTargetById,
  fireRoutine,
  resolveRoutineEnvPrefix,
} from "../../../../../../_lib/snsHubHelpers.js";

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

  // 複数動的セグメント（[id]/targets/[targetId]/fire）を持つルートでは、
  // req.urlに抽出済みパラメータがクエリ文字列として付与されるため、
  // 必ずpathnameのみを対象にマッチさせる（2026-09-04発覚のバグと同じ原因を回避）
  const targetId = new URL(req.url).pathname.match(
    /targets\/([^/]+)\/fire$/,
  )?.[1];
  if (!isValidUuid(targetId)) {
    return jsonResponse({ error: "target idの形式が不正です" }, 400);
  }

  try {
    const target = await getTopicTargetById(targetId);
    if (!target) {
      return jsonResponse({ error: "対象のターゲットが見つかりません" }, 404);
    }
    if (target.status !== "pending") {
      return jsonResponse(
        {
          error: `status='${target.status}'のターゲットは今すぐ生成できません（pendingのみ）`,
        },
        409,
      );
    }
    const platform = target.sns_target_accounts?.platform;
    if (!platform) {
      return jsonResponse(
        { error: "対象アカウントのplatformが特定できません" },
        500,
      );
    }

    const routineResult = await fireRoutine(resolveRoutineEnvPrefix(platform), {
      action: "generate_now",
      targetId,
    });

    return jsonResponse({ data: target, routine: routineResult });
  } catch (error) {
    console.error("SNS Hub topic target fire Edge function error:", error);
    return jsonResponse({ error: error.message }, 500);
  }
}
