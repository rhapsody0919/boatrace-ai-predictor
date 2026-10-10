/**
 * Vercel Edge Function: SNSマーケティングハブ 下書き一覧取得
 * GET /api/admin/sns-hub/drafts?status=pending_review
 *
 * middleware.js のBasic認証に加え、関数先頭の requireAdminAuth でも認証する（多層防御）。
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

import { requireAdminAuth } from "../../../_lib/adminAuth.js";

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
  // middleware はエンコードしたパスで迂回できるため、関数側でも必ず認証する（api/_lib/adminAuth.js）
  const denied = await requireAdminAuth(req);
  if (denied) return denied;

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
    //
    // 企画型パイプライン（format='CampaignEntryCard'）は2枚目の画像パスを
    // source_data.dataCardPathに保存している（sns_drafts.cover_image_pathは
    // 1枚しか持てないため）。ここで署名しないと2枚目のURLがフロントエンドに
    // 一切渡らず、プレビューもダウンロードも不可能になる不具合があった
    // （2026-09-09発覚）。
    const dataCardPaths = drafts
      .map((d) => d.source_data?.dataCardPath)
      .filter(Boolean);
    const pathsToSign = [
      ...new Set(
        drafts
          .flatMap((d) => [d.video_storage_path, d.cover_image_path])
          .concat(dataCardPaths)
          .filter(Boolean)
          .filter((p) => !resolvePublicAssetUrl(p)),
      ),
    ];
    const signedUrlMap = await signStoragePaths(pathsToSign);

    const enriched = drafts.map((d) => {
      const dataCardPath = d.source_data?.dataCardPath;
      return {
        ...d,
        video_url: d.video_storage_path
          ? signedUrlMap[d.video_storage_path] || null
          : null,
        cover_image_url: d.cover_image_path
          ? resolvePublicAssetUrl(d.cover_image_path) ||
            signedUrlMap[d.cover_image_path] ||
            null
          : null,
        source_data: dataCardPath
          ? {
              ...d.source_data,
              dataCardUrl:
                resolvePublicAssetUrl(dataCardPath) ||
                signedUrlMap[dataCardPath] ||
                null,
            }
          : d.source_data,
      };
    });

    return jsonResponse({ data: enriched });
  } catch (error) {
    console.error("SNS Hub drafts Edge function error:", error);
    return jsonResponse({ error: "処理を完了できませんでした。最新の状態を再読み込みして確認してください。" }, 500);
  }
}
