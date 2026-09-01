/**
 * Vercel Edge Function: SNSマーケティングハブ 下書き一覧取得
 * GET /api/admin/sns-hub/drafts?status=pending_review
 *
 * middleware.js のBasic認証配下にあるため、この関数自体は認証チェックを行わない。
 * service role keyでSupabaseにアクセスする（ADR 0021: anon keyはこのテーブル群に
 * 一切公開しない設計のため、フロントエンドからの直接アクセスは不可）。
 */

export const config = {
  runtime: "edge",
};

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const STORAGE_BUCKET = "sns-hub-media";
const SIGNED_URL_EXPIRES_IN = 3600; // 1時間

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

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

// 動画・カバー画像のStorageパスをまとめて署名付きURLに変換する
async function signPaths(paths) {
  if (paths.length === 0) return {};

  const response = await fetch(
    `${SUPABASE_URL}/storage/v1/object/sign/${STORAGE_BUCKET}`,
    {
      method: "POST",
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ expiresIn: SIGNED_URL_EXPIRES_IN, paths }),
    },
  );

  if (!response.ok) {
    // 署名に失敗しても一覧自体は返す（動画URLがnullになるだけで一覧表示は継続できるようにする）
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

export default async function handler(req) {
  if (req.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return jsonResponse({ error: "Supabase環境変数が未設定です" }, 500);
  }

  try {
    const url = new URL(req.url);
    const status = url.searchParams.get("status");

    const drafts = await fetchDrafts(status);

    const pathsToSign = [
      ...new Set(
        drafts
          .flatMap((d) => [d.video_storage_path, d.cover_image_path])
          .filter(Boolean),
      ),
    ];
    const signedUrlMap = await signPaths(pathsToSign);

    const enriched = drafts.map((d) => ({
      ...d,
      video_url: d.video_storage_path
        ? signedUrlMap[d.video_storage_path] || null
        : null,
      cover_image_url: d.cover_image_path
        ? signedUrlMap[d.cover_image_path] || null
        : null,
    }));

    return jsonResponse({ data: enriched });
  } catch (error) {
    console.error("SNS Hub drafts Edge function error:", error);
    return jsonResponse({ error: error.message }, 500);
  }
}
