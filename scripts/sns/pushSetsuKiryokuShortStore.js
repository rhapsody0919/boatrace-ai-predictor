/**
 * 節の機力の Shorts の PostgREST・Storage の読み書き（service_role）。push-setsu-kiryoku-short.js から移した（createRestStore の中身を段に分けた。
 * 共通の書き込み（Storage・下書き・item・承認）は push-full-picture.js の store を使い、この型の読み取りと許可の列だけを足す。失敗は投げる）
 */
import { SETSU_KIRYOKU_SHORT_KIND } from "../../api/_lib/snsSetsuKiryokuShort.js";
import { isFinalStage } from "../lib/sns/setsuDeadlines.js";
import { createRestStore as createFullPictureStore } from "./push-full-picture.js";
import { SETSU_FORMAT } from "./pushSetsuKiryokuShortRows.js";

const jobSelect =
  "id,draft_id,state,error_code,scheduled_at,expires_at,posted_at,external_post_id,external_post_url";

// 本文があるときだけ JSON と return=representation を付けた service_role の headers
const requestHeaders = (key, body) => ({
  apikey: key,
  Authorization: `Bearer ${key}`,
  ...(body !== undefined
    ? { "Content-Type": "application/json", Prefer: "return=representation" }
    : {}),
});

// 応答の本文を読む。失敗（HTTP が ok でない）は投げる
async function readResponse(response, method, p) {
  const text = await response.text();
  if (!response.ok)
    throw new Error(
      `DB 操作に失敗: HTTP ${response.status} ${method} ${p.split("?")[0]} ${text.slice(0, 300)}`,
    );
  return text ? JSON.parse(text) : null;
}

/** PostgREST を呼ぶ関数（service_role）。失敗は投げる */
const restCall =
  ({ url, key, fetchImpl }) =>
  async (p, { method = "GET", body } = {}) =>
    readResponse(
      await fetchImpl(`${url}/rest/v1/${p}`, {
        method,
        headers: requestHeaders(key, body),
        body: body !== undefined ? JSON.stringify(body) : undefined,
      }),
      method,
      p,
    );

const one = (rows, what) => {
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error(what);
  return rows[0];
};

// setsu_kiryoku_short_enabled が無い（193 が未適用）と PostgREST が 400 を返すので、その時は列なしで読み直して off とする
async function readControls(call) {
  let rows;
  try {
    rows = await call(
      "sns_auto_send_control?select=channel,mode,dry_run,auto_approver_id,setsu_kiryoku_short_enabled",
    );
  } catch (error) {
    // 列が無いときの 400（PostgREST の本文に列の名前が出る）だけを off に倒す。ほかの 400 は投げる
    if (
      !/HTTP 400/.test(error.message) ||
      !error.message.includes("setsu_kiryoku_short_enabled")
    )
      throw error;
    console.error(
      "setsu_kiryoku_short_enabled の列が無い（マイグレーション 193 が未適用）。許可は off として扱う",
    );
    rows = await call(
      "sns_auto_send_control?select=channel,mode,dry_run,auto_approver_id",
    );
  }
  return Object.fromEntries(rows.map((r) => [r.channel, r]));
}

// 同じ優勝戦（final_key）の下書きの item
async function readFinalItems(call, finalKey) {
  const drafts = await call(
    `sns_drafts?format=eq.${SETSU_FORMAT}&source_data->setsu_kiryoku_short->>final_key=eq.${encodeURIComponent(finalKey)}&select=id`,
  );
  if (!drafts.length) return [];
  return call(
    `sns_auto_send_items?draft_id=in.(${drafts.map((d) => d.id).join(",")})&select=id,state,draft_id,race_id`,
  );
}

// その PT の日の予約（146 の claim の式と同じ: attempts の upload_reserved・general_reserved と reads の units）
async function readQuotaUsed(call, day) {
  const [attempts, reads] = await Promise.all([
    call(
      `sns_youtube_quota_attempts?quota_day=eq.${day}&select=upload_reserved,general_reserved`,
    ),
    call(`sns_youtube_quota_reads?quota_day=eq.${day}&select=units`),
  ]);
  return {
    uploads: attempts.reduce((n, a) => n + a.upload_reserved, 0),
    general:
      attempts.reduce((n, a) => n + a.general_reserved, 0) +
      reads.reduce((n, r) => n + r.units, 0),
  };
}

/** raceNumber を渡せば、そのレースが優勝戦（「優勝戦」を含み「準優勝戦」でない）のときだけ返す。無ければ今どおり「優勝戦」の1件 */
async function readFinalRace(call, date, venueCode, raceNumber = null) {
  let final;
  if (raceNumber != null) {
    const [row] = await call(
      `race_conditions?race_id=eq.${encodeURIComponent(`${date}-${venueCode}-${String(raceNumber).padStart(2, "0")}`)}&select=race_id,race_stage`,
    );
    final = row && isFinalStage(row.race_stage) ? row : null;
  } else {
    [final] = await call(
      `race_conditions?race_id=like.${encodeURIComponent(`${date}-${venueCode}-*`)}&race_stage=eq.${encodeURIComponent("優勝戦")}&select=race_id`,
    );
  }
  if (!final) return null;
  const id = encodeURIComponent(final.race_id);
  const [[race], entries, exhibition] = await Promise.all([
    call(`races?race_id=eq.${id}&select=cancellation_status,start_time`),
    call(`race_entries?race_id=eq.${id}&select=is_absent`),
    call(`exhibition_data?race_id=eq.${id}&select=is_absent`),
  ]);
  if (!race) return null;
  return {
    race_id: final.race_id,
    start_time: race.start_time ?? null,
    cancelled: race.cancellation_status != null,
    withdrawn: [...entries, ...exhibition].some((r) => r.is_absent === true),
  };
}

/**
 * PostgREST・Storage の読み書き（service_role）。共通の書き込み（Storage・下書き・item・承認）は push-full-picture.js の store を使い、
 * この型の読み取りと許可の列だけを足す。失敗は投げる
 */
export function createRestStore({ url, key, fetchImpl = fetch }) {
  const base = createFullPictureStore({ url, key, fetchImpl });
  const call = restCall({ url, key, fetchImpl });
  return {
    saveFile: (p, bytes) => base.saveFile(p, bytes, "video/mp4"),
    insertDraft: base.insertDraft,
    insertItem: base.insertItem,
    updateItem: base.updateItem,
    approve: base.approve,
    updateDraft: async (draftId, patch) =>
      one(
        await call(`sns_drafts?id=eq.${draftId}`, {
          method: "PATCH",
          body: patch,
        }),
        `下書き ${draftId} を更新できない`,
      ),
    controls: () => readControls(call),
    sendControl: async () =>
      (
        await call(
          "sns_x_send_control?id=eq.true&select=daily_limit,daily_limit_youtube,daily_baseline_date,daily_external_count,expiry_minutes,max_source_age_seconds",
        )
      )[0] ?? null,
    setsuItems: (date) =>
      call(
        `sns_auto_send_items?kind=eq.${SETSU_KIRYOKU_SHORT_KIND}&channel=eq.youtube&race_id=like.${encodeURIComponent(`setsu:${date}:*`)}&select=id,state,draft_id,race_id,variant,held_reason&order=created_at.desc`,
      ),
    finalItems: (finalKey) => readFinalItems(call, finalKey),
    jobForDraft: async (draftId) =>
      (
        await call(`sns_x_send_jobs?draft_id=eq.${draftId}&select=${jobSelect}`)
      )[0] ?? null,
    jobsAttemptedOn: (day) =>
      call(
        `sns_x_send_jobs?attempt_dates=cs.${encodeURIComponent(`{${day}}`)}&select=id,state,attempt_dates,attempt_channels`,
      ),
    // まだ claim していない YouTube の予定（期限の前）
    queuedYoutubeJobs: (now) =>
      call(
        `sns_x_send_jobs?channel=eq.youtube&state=eq.queued&attempts=eq.0&expires_at=gt.${encodeURIComponent(now.toISOString())}&select=id,draft_id,scheduled_at`,
      ),
    quotaControl: async () =>
      (
        await call(
          "sns_youtube_quota_control?id=eq.true&select=verified,baseline_day,upload_limit,general_limit,external_uploads,external_general",
        )
      )[0] ?? null,
    quotaUsed: (day) => readQuotaUsed(call, day),
    // その日のその会場の優勝戦（race_conditions.race_stage）と、中止・欠場
    /** 前夜に取った表の、その日・その会場の優勝戦の行（is_final=true） */
    async eveFinals(date, venueCode) {
      return call(
        `eve_race_deadlines?race_date=eq.${encodeURIComponent(date)}&venue_code=eq.${Number(venueCode)}&is_final=is.true&select=race_id,deadline`,
      );
    },
    async raceStartTimes(date, venueCode, raceNumbers) {
      const ids = raceNumbers.map((n) =>
        `${date}-${venueCode}-${String(n).padStart(2, "0")}`,
      );
      return call(`races?race_id=in.(${ids.join(",")})&select=race_id,start_time`);
    },
    finalRace: (date, venueCode, raceNumber = null) =>
      readFinalRace(call, date, venueCode, raceNumber),
  };
}
