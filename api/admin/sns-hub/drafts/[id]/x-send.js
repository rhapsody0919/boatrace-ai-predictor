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

// 認証・メソッド・id・環境を確かめる。弾くときは { denied }、通れば { id }
async function readTarget(req) {
  const denied = await requireAdminAuth(req);
  if (denied) return { denied };
  if (!["GET", "POST"].includes(req.method))
    return { denied: jsonResponse({ error: "Method not allowed" }, 405) };
  const id = req.url.match(/drafts\/([^/]+)\/x-send/)?.[1];
  if (!isValidUuid(id)) return { denied: jsonResponse({ error: "IDが不正です" }, 400) };
  if (!isConfigured()) return { denied: jsonResponse({ error: "DB未設定です" }, 503) };
  return { id };
}

async function cancelJob(id) {
  const { job } = await xSendStore.status(id);
  if (!job) return jsonResponse({ error: "待機中のjobがありません" }, 409);
  return jsonResponse({
    data: await xSendStore.transition(job.id, "cancel"),
  });
}

const isPastSchedule = (scheduledAt) =>
  !Number.isFinite(Date.parse(scheduledAt)) ||
  Date.parse(scheduledAt) <= Date.now();

const canApproveXSend = (draft) =>
  draft &&
  draft.platform === "x" &&
  draft.language === "ja" &&
  ["pending_review", "approved"].includes(draft.status) &&
  !isBundlePublicationBlocked(draft);

async function approveXSend(id, body) {
  if (!isValidUuid(body.approverId))
    return jsonResponse({ error: "承認者が不正です" }, 400);
  const scheduledAt = body.scheduledAt || null;
  if (scheduledAt && isPastSchedule(scheduledAt)) {
    return jsonResponse({ error: "予約は未来の日時を指定してください" }, 400);
  }
  const draft = await getDraftById(id);
  if (!canApproveXSend(draft)) {
    return jsonResponse({ error: "この下書きはX送信を承認できません" }, 409);
  }
  const snapshot = await createXSnapshot(draft, loadXMedia);
  const data = await xSendStore.approve(id, body.approverId, snapshot, scheduledAt || new Date().toISOString());
  return jsonResponse({ data, connected: false });
}

export default async function handler(req) {
  const target = await readTarget(req);
  if (target.denied) return target.denied;
  const { id } = target;
  try {
    if (req.method === "GET")
      return jsonResponse({ data: await xSendStore.status(id) });
    const body = await req.json();
    if (body.action === "cancel") return await cancelJob(id);
    return await approveXSend(id, body);
  } catch {
    return jsonResponse(
      { error: "X送信の承認・取得に失敗しました。版と状態を確認してください" },
      409,
    );
  }
}
