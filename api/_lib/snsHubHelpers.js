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

export const SNS_HUB_STORAGE_BUCKET = "sns-hub-media";

/**
 * sns-hub-media（非公開バケット）内の複数パスをまとめて署名付きURLに変換する。
 * `sns_drafts.video_storage_path`/`cover_image_path`は生のStorageパスを保存する
 * 規約（2026-09-03確定、下記参照）のため、実際にfetchする側は必ずこの関数で
 * 署名してから使う。
 *
 * 2026-09-03、コードレビューで発覚した不具合の修正: 以前は生成Routine側が
 * `createSignedUrl()`で発行した署名付きURLをそのまま列に保存する運用だったが、
 * `drafts/index.js`（管理画面の一覧取得）は列の値を生パスとして扱い読み取り時に
 * 再署名する設計だったため、両者の前提が食い違い「動画準備中」表示のまま
 * 進めなくなっていた。生パス保存・都度署名に統一し、この関数を両方の呼び出し元
 * （`drafts/index.js`・`publish-youtube.js`）で共有する。
 *
 * @param {string[]} paths - バケット相対の生パス（例: `{content_group_id}/x-ja.mp4`）
 * @param {number} [expiresIn] - 秒数、既定1時間
 * @returns {Promise<Record<string, string>>} path -> 署名付きURLのマップ（署名失敗分は含まれない）
 */
export async function signStoragePaths(paths, expiresIn = 3600) {
  if (!paths || paths.length === 0) return {};

  const response = await fetch(
    `${SUPABASE_URL}/storage/v1/object/sign/${SNS_HUB_STORAGE_BUCKET}`,
    {
      method: "POST",
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ expiresIn, paths }),
    },
  );

  if (!response.ok) {
    console.error(`Storage署名エラー: ${response.status}`);
    return {};
  }

  const results = await response.json();
  const map = {};
  for (const r of results) {
    if (r.signedURL) {
      map[r.path] = `${SUPABASE_URL}/storage/v1${r.signedURL}`;
    }
  }
  return map;
}

/** 単一パスを署名付きURLに変換する。見つからない/失敗した場合はnull */
export async function signStoragePath(path, expiresIn = 3600) {
  if (!path) return null;
  const map = await signStoragePaths([path], expiresIn);
  return map[path] || null;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * URLパスから抽出したIDがUUID形式か検証する（draft/insight等どのエンティティにも使う汎用関数）。
 * 未検証のままSupabase REST APIのクエリ文字列に埋め込むと、意図しない文字
 * （&や?等）でクエリ構造が壊れる可能性があるため、抽出直後に必ず通す。
 */
export function isValidUuid(id) {
  return typeof id === "string" && UUID_PATTERN.test(id);
}

/** @deprecated isValidUuidを使う。既存呼び出し元との後方互換のために残している */
export const isValidDraftId = isValidUuid;

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

export async function getInsightById(id) {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/sns_strategy_insights?id=eq.${id}&select=*`,
    {
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
    },
  );
  if (!response.ok) {
    throw new Error(`sns_strategy_insights取得エラー: ${response.status}`);
  }
  const rows = await response.json();
  return rows[0] || null;
}

/**
 * insightを新規作成する（revise/redoの自由記述フィードバックをユーザーが選択的に
 * 恒久方針へ反映する機能用、spec.md課題4）。statusは常にproposedで作成し、既存の
 * 週次昇格フロー（promote-strategy-insights.js）にそのまま乗せる。
 */
export async function createInsight(payload) {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/sns_strategy_insights`,
    {
      method: "POST",
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(payload),
    },
  );
  if (!response.ok) {
    throw new Error(`sns_strategy_insights作成エラー: ${response.status}`);
  }
  const rows = await response.json();
  return rows[0] || null;
}

export async function updateInsight(id, patch) {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/sns_strategy_insights?id=eq.${id}`,
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
    throw new Error(`sns_strategy_insights更新エラー: ${response.status}`);
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
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "experimental-cc-routine-2026-04-01",
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
