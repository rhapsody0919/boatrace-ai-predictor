/**
 * SNSマーケティングハブ用の共有ヘルパー（api/admin/sns-hub/配下の複数ハンドラーから利用）
 * ファイル名に`_`prefixを付けたディレクトリはVercelのルーティング対象外になる。
 */

export const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
export const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

export function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function isConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_KEY);
}

export async function getDraftById(id) {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/sns_drafts?id=eq.${id}&select=*`,
    {
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
    },
  );
  if (!response.ok) {
    throw new Error(`sns_drafts取得エラー: ${response.status}`);
  }
  const rows = await response.json();
  return rows[0] || null;
}

export async function updateDraft(id, patch) {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/sns_drafts?id=eq.${id}`,
    {
      method: "PATCH",
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(patch),
    },
  );
  if (!response.ok) {
    throw new Error(`sns_drafts更新エラー: ${response.status}`);
  }
  const rows = await response.json();
  return rows[0] || null;
}

/**
 * RoutineのAPIトリガー（/fireエンドポイント）を呼ぶ（ADR 0020）。
 * Task13/14でRoutineを実際に構築するまでは対応する環境変数が未設定のため、
 * その場合はfireをスキップして{fired: false}を返す（DB更新自体は独立してテストできるようにする）。
 *
 * @param {string} envPrefix - 'SNS_HUB_GENERATION_ROUTINE' 等、環境変数名のprefix
 * @param {object} payload - Routineに渡す内容（draft_id・修正理由等）
 */
export async function fireRoutine(envPrefix, payload) {
  const fireUrl = process.env[`${envPrefix}_FIRE_URL`];
  const fireToken = process.env[`${envPrefix}_FIRE_TOKEN`];

  if (!fireUrl || !fireToken) {
    console.warn(
      `${envPrefix}のfireをスキップ: 環境変数未設定（Routine未構築の可能性）`,
    );
    return { fired: false, reason: "not_configured" };
  }

  const response = await fetch(fireUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${fireToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text: JSON.stringify(payload) }),
  });

  if (!response.ok) {
    console.error(`${envPrefix}のfireに失敗: ${response.status}`);
    return { fired: false, reason: `http_${response.status}` };
  }

  const result = await response.json();
  return { fired: true, sessionUrl: result.claude_code_session_url };
}
