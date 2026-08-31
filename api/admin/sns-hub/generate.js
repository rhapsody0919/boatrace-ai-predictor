/**
 * Vercel Edge Function: 手動生成トリガー
 * POST /api/admin/sns-hub/generate
 * body: { mode: 'daily' | 'evergreen' }
 *
 * 承認済みストックが少ない場合に、管理画面から生成Routineを即時起動する
 * （ユーザー要望、2026-08-31）。'daily'は当日開催中のレースを使う型
 * （予想数値フック型・答え合わせ型等）、'evergreen'は会場攻略・データ一覧型等
 * 当日データに依存しない型を使う。Routineプロンプト側の
 * action: 'generate-daily' | 'generate-evergreen' に対応する
 * （RemoteTrigger update、trig_01WW4Kc6vd7WtV9SXWJcFGis、2026-08-31）。
 *
 * fireRoutineは起動を指示するだけで完了を待たない。実際の生成完了までは
 * 動画レンダリングを含め数分〜十数分かかる。
 */

import {
  jsonResponse,
  isConfigured,
  fireRoutine,
} from "../../_lib/snsHubHelpers.js";

export const config = {
  runtime: "edge",
};

const VALID_MODES = ["daily", "evergreen"];

export default async function handler(req) {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }
  if (!isConfigured()) {
    return jsonResponse({ error: "Supabase環境変数が未設定です" }, 500);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "リクエストボディが不正です" }, 400);
  }

  const { mode } = body;
  if (!VALID_MODES.includes(mode)) {
    return jsonResponse(
      { error: `modeは${VALID_MODES.join("または")}のいずれかが必要です` },
      400,
    );
  }

  try {
    const routineResult = await fireRoutine("SNS_HUB_ROUTINE", {
      action: mode === "daily" ? "generate-daily" : "generate-evergreen",
    });

    return jsonResponse({ routine: routineResult });
  } catch (error) {
    console.error("SNS Hub generate Edge function error:", error);
    return jsonResponse({ error: error.message }, 500);
  }
}
