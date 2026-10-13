// 送信・取り込みの鍵の健全性（sns-pdca-loop tasks 19）。refresh の可否と scope だけを返し、トークンの値は返さない。
import { requireAdminAuth } from "../../_lib/adminAuth.js";
import { isConfigured, jsonResponse } from "../../_lib/snsHubHelpers.js";
import { createPostgrestTokenDb } from "../../_lib/snsTokenStore.js";
import { checkTokenHealth } from "../../_lib/snsTokenHealth.js";

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
    ...deps,
  });
  const response = jsonResponse({ data });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export default function handler(req) {
  return handleTokenHealth(req);
}
