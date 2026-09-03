/**
 * Vercel Edge Function: ネタ駆動マルチチャネルパイプラインの手動実行トリガー
 * POST /api/admin/sns-hub/generate-topic-pipeline
 *
 * sns-hub-content-generation Routine（daily/evergreen、generate.js）とは別の
 * Routine（content-multi-channel-pipeline、trig_01BAymvDLFw9ZbFUBXk6h8Nq）を
 * 起動する。こちらはプラットフォーム/本数/型を選ばせる余地が無い——ネタ選定・
 * チャネル選定（X/TikTok/YouTubeが対象かどうかを含む）自体をRoutine側が
 * 毎回自律的に判断する設計のため、リクエストボディは受け取らない
 * （2026-09-02、ユーザー要望「ネタ駆動パイプラインもボタンで実行できるように」）。
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

  try {
    const routineResult = await fireRoutine("CONTENT_MULTI_CHANNEL_ROUTINE", {
      action: "run",
    });

    return jsonResponse({ routine: routineResult });
  } catch (error) {
    console.error(
      "SNS Hub generate-topic-pipeline Edge function error:",
      error,
    );
    return jsonResponse({ error: error.message }, 500);
  }
}
