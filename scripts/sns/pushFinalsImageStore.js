// 優勝戦・思考投稿の PostgREST・Storage の読み書き（service_role）。push-finals-image.js の createRestStore を、call・読み・controls・書きに分けて移した。
import { xSlotRoomVia } from "../lib/snsXSlots.js";
import { FINALS_IMAGE_FORMAT } from "../lib/sns/finalsImageBase.js";
import { KINDS } from "./pushFinalsImageKinds.js";
import { readTodayPicks } from "./today-picks.js";

/** JSON を送るときの追加のヘッダ */
const requestHeaders = (headers, body) => ({
  ...headers,
  ...(body !== undefined
    ? { "Content-Type": "application/json", Prefer: "return=representation" }
    : {}),
});

/** 応答の本文を JSON にする。失敗（HTTP の失敗）は投げる */
function parseReply(response, text, method, p) {
  if (!response.ok)
    throw new Error(
      `DB 操作に失敗: HTTP ${response.status} ${method} ${p.split("?")[0]} ${text.slice(0, 300)}`,
    );
  return text ? JSON.parse(text) : null;
}

/** PostgREST の呼び出し（service_role）。失敗は投げる */
function createCall({ url, headers, fetchImpl }) {
  return async function call(p, { method = "GET", body } = {}) {
    const response = await fetchImpl(`${url}/rest/v1/${p}`, {
      method,
      headers: requestHeaders(headers, body),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return parseReply(response, await response.text(), method, p);
  };
}

const idOf = (raceId) => encodeURIComponent(raceId);

// 許可の列（flag、既定は finals_image_enabled）が無い（176・189 が未適用）と PostgREST が 400 を返すので、その時は列なしで読み直して off とする。
// 読むのは呼んだ種類の列だけ（他の種類の列を同じ select に並べると、189 の前に finals_image_enabled まで外れて優勝戦が止まる）
const controlsVia =
  (call) =>
  async (flag = KINDS[FINALS_IMAGE_FORMAT].flag) => {
    if (!Object.values(KINDS).some((k) => k.flag === flag))
      throw new Error(`許可の列 ${flag} を知らない`);
    let rows;
    try {
      rows = await call(
        `sns_auto_send_control?select=channel,mode,dry_run,auto_approver_id,${flag}`,
      );
    } catch (error) {
      if (!/HTTP 400/.test(error.message)) throw error;
      const migration = Object.values(KINDS).find(
        (k) => k.flag === flag,
      ).migration;
      console.error(
        `${flag} の列が無い（マイグレーション ${migration} が未適用）。許可は off として扱う`,
      );
      rows = await call(
        "sns_auto_send_control?select=channel,mode,dry_run,auto_approver_id",
      );
    }
    return Object.fromEntries(rows.map((r) => [r.channel, r]));
  };

/** レース・item・job・許可などの読み */
function readsOf(call) {
  return {
    race: async (raceId) =>
      (
        await call(
          `races?race_id=eq.${idOf(raceId)}&select=race_id,race_date,start_time,cancellation_status,race_grade,race_number`,
        )
      )[0] ?? null,
    // その日の 12R（思考投稿の受ける場を決める。thinkingGradeDayVenue）
    twelfthRaces: (date) =>
      call(
        `races?race_date=eq.${encodeURIComponent(date)}&race_number=eq.12&select=race_id,race_grade,start_time&order=race_id`,
      ),
    stage: async (raceId) =>
      (
        await call(
          `race_conditions?race_id=eq.${idOf(raceId)}&select=race_stage`,
        )
      )[0]?.race_stage ?? null,
    // kind は KINDS のキー（既定は優勝戦）。variant は種類ごとに違うが、kind でも絞る
    finalsItems: (raceId, variant, kind = FINALS_IMAGE_FORMAT) =>
      call(
        `sns_auto_send_items?kind=eq.${KINDS[kind].kind}&variant=eq.${variant}&race_id=eq.${idOf(raceId)}&select=id,state,draft_id&order=created_at.desc`,
      ),
    controls: controlsVia(call),
    sendControl: async () =>
      (
        await call(
          "sns_x_send_control?id=eq.true&select=daily_limit,daily_limit_x,daily_baseline_date,daily_external_count",
        )
      )[0] ?? null,
    // X の日の枠の取り置きの残り（182）
    xSlotRoom: xSlotRoomVia(call),
    // その日の /today の X 投稿の対象（思考投稿の受け取りの条件、today-picks.js と同じ読み方）
    todayPicks: (date) => readTodayPicks(date, call),
    // 今日（JST）に試行のある job（X・YouTube の両方。数えるのは dailyLimitReason が X だけ）
    jobsAttemptedOn: (day) =>
      call(
        `sns_x_send_jobs?attempt_dates=cs.${encodeURIComponent(`{${day}}`)}&select=id,state,attempt_dates,attempt_channels`,
      ),
    // まだ claim していない X の子（親の予約の枠。reservedChildren が親で絞る）
    waitingChildren: async (now) =>
      (
        await call(
          `sns_x_send_jobs?state=eq.queued&attempts=eq.0&channel=eq.x&parent_job_id=not.is.null&expires_at=gt.${encodeURIComponent(now.toISOString())}&select=id,state,channel,attempts,expires_at,parent_job_id,sns_drafts(bundle_import_id)`,
        )
      ).map(({ sns_drafts: draft, ...job }) => ({
        ...job,
        bundle_import_id: draft?.bundle_import_id ?? null,
      })),
    jobForDraft: async (draftId) =>
      (
        await call(
          `sns_x_send_jobs?draft_id=eq.${draftId}&select=id,state,error_code,posted_at,external_post_id,external_post_url`,
        )
      )[0] ?? null,
  };
}

/** Storage への画像の保存 */
const saveFileVia =
  ({ url, headers, fetchImpl }) =>
  async (p, bytes) => {
    const response = await fetchImpl(
      `${url}/storage/v1/object/sns-hub-media/${p}`,
      {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "image/png",
          "x-upsert": "true",
        },
        body: bytes,
      },
    );
    if (!response.ok)
      throw new Error(`画像を保存できない: HTTP ${response.status} ${p}`);
  };

const one = (rows, what) => {
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error(what);
  return rows[0];
};

/** 下書き・item の書きと承認 */
function writesOf(call) {
  return {
    insertDraft: async (row) =>
      one(
        await call("sns_drafts", { method: "POST", body: row }),
        "下書きを作れない",
      ),
    insertItem: async (row) =>
      one(
        await call("sns_auto_send_items", { method: "POST", body: row }),
        "item を作れない",
      ),
    updateDraft: async (draftId, patch) =>
      one(
        await call(`sns_drafts?id=eq.${draftId}`, {
          method: "PATCH",
          body: patch,
        }),
        `下書き ${draftId} を更新できない`,
      ),
    updateItem: async (itemId, fromState, patch) =>
      one(
        await call(
          `sns_auto_send_items?id=eq.${itemId}&state=eq.${fromState}`,
          {
            method: "PATCH",
            body: { ...patch, updated_at: new Date().toISOString() },
          },
        ),
        `item ${itemId} を更新できない`,
      ),
    approve: (args) =>
      call("rpc/approve_sns_x_send", { method: "POST", body: args }),
  };
}

/** PostgREST・Storage の読み書き（service_role）。失敗は投げる */
export function createRestStore({ url, key, fetchImpl = fetch }) {
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  const call = createCall({ url, headers, fetchImpl });
  return {
    ...readsOf(call),
    saveFile: saveFileVia({ url, headers, fetchImpl }),
    ...writesOf(call),
  };
}
