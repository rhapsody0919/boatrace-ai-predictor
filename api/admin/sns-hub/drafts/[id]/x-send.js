import { requireAdminAuth } from "../../../../_lib/adminAuth.js";
import {
  getDraftById,
  isConfigured,
  isValidUuid,
  jsonResponse,
} from "../../../../_lib/snsHubHelpers.js";
import { isBundlePublicationBlocked } from "../../../../_lib/snsBundleValidation.js";
import { createXSnapshot } from "../../../../_lib/snsXSend.js";
import { loadXMedia, xSendStore } from "../../../../_lib/snsXSendStore.js";

export const config = { runtime: "edge" };

export default async function handler(req) {
  const denied = await requireAdminAuth(req);
  if (denied) return denied;
  if (!["GET", "POST"].includes(req.method))
    return jsonResponse({ error: "Method not allowed" }, 405);
  const id = req.url.match(/drafts\/([^/]+)\/x-send/)?.[1];
  if (!isValidUuid(id)) return jsonResponse({ error: "IDが不正です" }, 400);
  if (!isConfigured()) return jsonResponse({ error: "DB未設定です" }, 503);
  try {
    if (req.method === "GET")
      return jsonResponse({ data: await xSendStore.status(id) });
    const body = await req.json();
    if (body.action === "cancel") {
      const { job } = await xSendStore.status(id);
      if (!job) return jsonResponse({ error: "待機中のjobがありません" }, 409);
      return jsonResponse({
        data: await xSendStore.transition(job.id, "cancel"),
      });
    }
    if (!isValidUuid(body.approverId))
      return jsonResponse({ error: "承認者が不正です" }, 400);
    const scheduledAt = body.scheduledAt || null;
    if (
      scheduledAt &&
      (!Number.isFinite(Date.parse(scheduledAt)) ||
        Date.parse(scheduledAt) <= Date.now())
    ) {
      return jsonResponse({ error: "予約は未来の日時を指定してください" }, 400);
    }
    const draft = await getDraftById(id);
    if (
      !draft ||
      draft.platform !== "x" ||
      draft.language !== "ja" ||
      !["pending_review", "approved"].includes(draft.status) ||
      isBundlePublicationBlocked(draft)
    ) {
      return jsonResponse({ error: "この下書きはX送信を承認できません" }, 409);
    }
    const snapshot = await createXSnapshot(draft, loadXMedia);
    const data = await xSendStore.approve(
      id,
      body.approverId,
      snapshot,
      scheduledAt,
    );
    return jsonResponse({ data, connected: false });
  } catch {
    return jsonResponse(
      { error: "X送信の承認・取得に失敗しました。版と状態を確認してください" },
      409,
    );
  }
}
