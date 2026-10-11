/**
 * Vercel Edge Function: SNSマーケティングハブ 承認者マスタ取得
 * GET /api/admin/sns-hub/approvers
 *
 * 承認者はタップ選択式（自由入力不可、spec.md要件12）。
 * middleware.js のBasic認証に加え、関数先頭の requireAdminAuth でも認証する（多層防御）。
 * service role keyでアクセス（ADR 0021）。
 */

import { requireAdminAuth } from "../../../_lib/adminAuth.js";

export const config = {
  runtime: "edge",
};

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export default async function handler(req) {
  // middleware はエンコードしたパスで迂回できるため、関数側でも必ず認証する（api/_lib/adminAuth.js）
  const denied = await requireAdminAuth(req);
  if (denied) return denied;

  if (req.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return jsonResponse({ error: "Supabase環境変数が未設定です" }, 500);
  }

  try {
    const params = new URLSearchParams({
      select: "id,display_name",
      active: "eq.true",
      order: "display_name.asc",
    });

    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/sns_approvers?${params.toString()}`,
      {
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        },
      },
    );

    if (!response.ok) {
      throw new Error(`sns_approvers取得エラー: ${response.status}`);
    }

    const data = await response.json();
    return jsonResponse({ data });
  } catch (error) {
    console.error("SNS Hub approvers Edge function error:", error);
    return jsonResponse({ error: "処理を完了できませんでした。最新の状態を再読み込みして確認してください。" }, 500);
  }
}
