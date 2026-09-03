/**
 * Vercel Edge Function: 手動生成トリガー
 * POST /api/admin/sns-hub/generate
 * body: { mode: 'daily' | 'evergreen', platforms?: string[], count?: number }
 *
 * 承認済みストックが少ない場合に、管理画面から生成Routineを即時起動する
 * （ユーザー要望、2026-08-31）。'daily'は当日開催中のレースを使う型
 * （予想数値フック型・答え合わせ型等）、'evergreen'は会場攻略・データ一覧型等
 * 当日データに依存しない型を使う。Routineプロンプト側の
 * action: 'generate-daily' | 'generate-evergreen' に対応する
 * （RemoteTrigger update、trig_01WW4Kc6vd7WtV9SXWJcFGis、2026-08-31）。
 *
 * platforms/countは2026-09-01追加（ユーザー要望: TikTokがシャドウバン気味の
 * 時期にX限定で生成したい、生成本数も自分で決めたい）。platformsは配列にして
 * あり、将来プラットフォームが追加された際もVALID_PLATFORMSに1件足すだけで
 * 拡張できるようにしている。youtubeは2026-09-01追加（content-multi-channel-pipeline、
 * spec.md FR7）。
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
const VALID_PLATFORMS = ["x", "tiktok", "youtube"];
const COUNT_MAX_BY_MODE = { daily: 5, evergreen: 10 };

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

  const { mode, platforms, count } = body;
  if (!VALID_MODES.includes(mode)) {
    return jsonResponse(
      { error: `modeは${VALID_MODES.join("または")}のいずれかが必要です` },
      400,
    );
  }

  // platformsを省略/未指定(undefined・null)の場合のみ両プラットフォームにフォールバック
  // する。空配列[]を明示的に送った場合はエラーにする（コードレビューで指摘: []だと
  // 「1つも選ばれていない」のに黙って両方生成にフォールバックしてしまっていた）
  const platformsOmitted = platforms === undefined || platforms === null;
  const resolvedPlatforms = platformsOmitted
    ? VALID_PLATFORMS
    : [...new Set(platforms)]; // 重複値が来ても1回ずつしか生成させない
  if (
    !Array.isArray(resolvedPlatforms) ||
    resolvedPlatforms.length === 0 ||
    !resolvedPlatforms.every((p) => VALID_PLATFORMS.includes(p))
  ) {
    return jsonResponse(
      {
        error: `platformsは${VALID_PLATFORMS.join("・")}を1つ以上の配列で指定してください`,
      },
      400,
    );
  }

  const countMax = COUNT_MAX_BY_MODE[mode];
  const resolvedCount = count === undefined || count === null ? null : count;
  if (
    resolvedCount !== null &&
    (!Number.isInteger(resolvedCount) ||
      resolvedCount < 1 ||
      resolvedCount > countMax)
  ) {
    return jsonResponse(
      { error: `countは1〜${countMax}の整数で指定してください` },
      400,
    );
  }

  try {
    const routineResult = await fireRoutine("SNS_HUB_ROUTINE", {
      action: mode === "daily" ? "generate-daily" : "generate-evergreen",
      platforms: resolvedPlatforms,
      count: resolvedCount,
    });

    return jsonResponse({ routine: routineResult });
  } catch (error) {
    console.error("SNS Hub generate Edge function error:", error);
    return jsonResponse({ error: error.message }, 500);
  }
}
