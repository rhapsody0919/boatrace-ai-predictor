// 送信・取り込みの鍵の健全性（sns-pdca-loop tasks 19）。refresh の可否と scope だけを返し、トークンの値は返さない。
// ?x_read=1 のときだけ X の自分のアカウントを読む（費用が1回 $0.001 程度かかるため既定では呼ばない）
import { requireAdminAuth } from "../../_lib/adminAuth.js";
import { isConfigured, jsonResponse } from "../../_lib/snsHubHelpers.js";
import { createPostgrestTokenDb } from "../../_lib/snsTokenStore.js";
import { checkTokenHealth } from "../../_lib/snsTokenHealth.js";
// 管理 API はすべて Web の Request/Response の形で書く。runtime の指定が無いと Node の (req, res) の形として呼ばれ、
// 応答を返さないまま時間切れの 500 になる（2026-10-13 本番で発生）
export const config = { runtime: "edge" };

// テストから env・fetch・DB を差し替えるための本体。Vercel からは下の handler（依存は既定値）が呼ばれる
export async function handleTokenHealth(req, deps = {}) {
  const denied = await requireAdminAuth(req);
  if (denied) return denied;
  if (req.method !== "GET")
    return jsonResponse({ error: "Method not allowed" }, 405);
  if (!deps.xDb && !isConfigured())
    return jsonResponse({ error: "DB未設定です" }, 503);
  const data = await checkTokenHealth({
    xDb: deps.xDb ?? createPostgrestTokenDb(),
    xRead: new URL(req.url).searchParams.get("x_read") === "1",
    ...deps,
  });
  const response = jsonResponse({ data });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export default function handler(req) {
  return handleTokenHealth(req);
}
