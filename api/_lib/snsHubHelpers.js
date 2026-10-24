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

export const SITE_BASE_URL = "https://www.boat-ai.jp";

/**
 * `cover_image_path`をブラウザで表示可能なURLに変換する。
 *
 * blog/noteチャネルは`docs/operation/sns-pipeline-blog.md`/`sns-pipeline-note.md`の
 * 設計により、Supabase Storageにアップロードせず`public/images/blog/{slug}.jpg`
 * （リポジトリにコミット済みの静的アセット、本番では`{SITE_BASE_URL}/images/blog/{slug}.jpg`
 * として配信される）をそのまま`cover_image_path`に記録する。X/YouTubeは
 * `{content_group_id}/x-ja.jpg`のようなsns-hub-media（Storage）内の生パスを使う。
 * 両者は同じ列に異なる種類のパスが混在するため、形状で判定して分岐する
 * （2026-09-05発覚: この分岐が無く全パスをStorage署名対象として扱っていたため、
 * blog/noteのカバー画像プレビュー・ダウンロードボタンが常に表示されない不具合が
 * あった。承認済み下書きの画像はブログPRマージ後に本番へ反映されるため、
 * マージ前（pending_review）はまだ404になりうる制約が残る）
 */
export function resolvePublicAssetUrl(path) {
  if (!path) return null;
  if (path.startsWith("public/")) {
    return `${SITE_BASE_URL}/${path.slice("public/".length)}`;
  }
  return null;
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

export async function updateDraft(id, patch, expectedStatus) {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/sns_drafts?id=eq.${id}&or=(external_operation_state.is.null,external_operation_state.eq.done)${expectedStatus ? `&status=eq.${expectedStatus}` : ""}`,
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
  if (!rows[0]) {
    const error = new Error("下書きが変更されたか、送信中・要照合です");
    error.status = 409;
    throw error;
  }
  return rows[0];
}
