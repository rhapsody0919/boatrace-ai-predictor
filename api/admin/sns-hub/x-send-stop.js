import { requireAdminAuth } from "../../_lib/adminAuth.js";
import { isConfigured, jsonResponse } from "../../_lib/snsHubHelpers.js";
import { xSendStore } from "../../_lib/snsXSendStore.js";
export const config = { runtime: "edge" };
export default async function handler(req) {
  const denied = await requireAdminAuth(req);
  if (denied) return denied;
  if (req.method !== "POST")
    return jsonResponse({ error: "Method not allowed" }, 405);
  if (!isConfigured()) return jsonResponse({ error: "DB未設定です" }, 503);
  try {
    await xSendStore.stop();
    return jsonResponse({ data: { paused: true } });
  } catch {
    return jsonResponse({ error: "停止を保存できませんでした" }, 503);
  }
}
