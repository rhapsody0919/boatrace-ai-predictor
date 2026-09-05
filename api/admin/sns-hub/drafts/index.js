/**
 * Vercel Edge Function: SNSマーケティングハブ 下書き一覧取得
 * GET /api/admin/sns-hub/drafts?status=pending_review
 *
 * middleware.js のBasic認証配下にあるため、この関数自体は認証チェックを行わない。
 * service role keyでSupabaseにアクセスする（ADR 0021: anon keyはこのテーブル群に
 * 一切公開しない設計のため、フロントエンドからの直接アクセスは不可）。
 */

import {
  SUPABASE_URL,
  SUPABASE_SERVICE_KEY,
  jsonResponse,
  isConfigured,
  signStoragePaths,
  resolvePublicAssetUrl,
} from "../../../_lib/snsHubHelpers.js";

export const config = {
  runtime: "edge",
};

async function fetchDrafts(status) {
  const params = new URLSearchParams({
    select:
      "*,sns_template_variants(variant_name,composition_name),sns_approvers(display_name)",
    order: "created_at.desc",
  });
  if (status && status !== "all") {
    params.set("status", `eq.${status}`);
  } else if (!status) {
    // statusを指定しないデフォルト呼び出しはarchivedを除外する（2026-09-01対応）。
    // SnsHubAdmin.jsxのどのタブもarchivedを表示対象にしていないのに、絞り込み無しで
    // 呼ばれ続けていたため、承認・非表示等のアクションのたびにアーカイブ済み分（実測
    // 全体の4割超）まで再取得・署名付きURL発行される無駄が生じていた。archivedを含む
    // 全件が本当に必要な場合は明示的に?status=allを指定する
    params.set("status", "neq.archived");
  }

  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/sns_drafts?${params.toString()}`,
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

  return response.json();
}

export default async function handler(req) {
  if (req.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  if (!isConfigured()) {
    return jsonResponse({ error: "Supabase環境変数が未設定です" }, 500);
  }

  try {
    const url = new URL(req.url);
    const status = url.searchParams.get("status");

    const drafts = await fetchDrafts(status);

    // blog/noteのcover_image_pathは`public/images/blog/...`（Storageではなく
    // リポジトリのコミット済み静的アセット）のため、署名対象から除外する
    // （resolvePublicAssetUrl参照）
    const pathsToSign = [
      ...new Set(
        drafts
          .flatMap((d) => [d.video_storage_path, d.cover_image_path])
          .filter(Boolean)
          .filter((p) => !resolvePublicAssetUrl(p)),
      ),
    ];
    const signedUrlMap = await signStoragePaths(pathsToSign);

    const enriched = drafts.map((d) => ({
      ...d,
      video_url: d.video_storage_path
        ? signedUrlMap[d.video_storage_path] || null
        : null,
      cover_image_url: d.cover_image_path
        ? resolvePublicAssetUrl(d.cover_image_path) ||
          signedUrlMap[d.cover_image_path] ||
          null
        : null,
    }));

    return jsonResponse({ data: enriched });
  } catch (error) {
    console.error("SNS Hub drafts Edge function error:", error);
    return jsonResponse({ error: error.message }, 500);
  }
}
