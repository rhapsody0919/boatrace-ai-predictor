// push-research-image.js から移した、PostgREST・Storage の読み書き createRestStore（共通の読み書きは push-finals-image.js の store）
import { createRestStore as createFinalsRestStore } from "./push-finals-image.js";
import { RESEARCH_TYPE } from "./pushResearchImageChecks.js";

/** PostgREST の GET（失敗は投げる） */
async function restGet({ url, key, fetchImpl }, p) {
  const response = await fetchImpl(`${url}/rest/v1/${p}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  const text = await response.text();
  if (!response.ok)
    throw new Error(
      `DB の読み取りに失敗: HTTP ${response.status} ${p.split("?")[0]} ${text.slice(0, 300)}`,
    );
  return text ? JSON.parse(text) : null;
}

/**
 * 許可の列（research_image_enabled・setsu_kiryoku_enabled）が無い（179・194 が未適用）と PostgREST が 400 を返すので、
 * その時は列なしで読み直して off とする
 */
async function readControls(get, type) {
  let rows;
  try {
    rows = await get(
      `sns_auto_send_control?select=channel,mode,dry_run,auto_approver_id,${type.enabledColumn}`,
    );
  } catch (error) {
    if (!/HTTP 400/.test(error.message)) throw error;
    console.error(
      `${type.enabledColumn} の列が無い（マイグレーションが未適用）。許可は off として扱う`,
    );
    rows = await get(
      "sns_auto_send_control?select=channel,mode,dry_run,auto_approver_id",
    );
  }
  return Object.fromEntries(rows.map((r) => [r.channel, r]));
}

/**
 * PostgREST・Storage の読み書き（service_role）。共通の読み書きは push-finals-image.js の store を使い、
 * この型の item の読み取りと許可の列だけを足す。失敗は投げる
 */
export function createRestStore({
  url,
  key,
  fetchImpl = fetch,
  type = RESEARCH_TYPE,
}) {
  const base = createFinalsRestStore({ url, key, fetchImpl });
  const get = (p) => restGet({ url, key, fetchImpl }, p);
  return {
    ...base,
    // この型（type）の item（名前は数字で見たらのときのまま）
    researchItems: (date) =>
      get(
        `sns_auto_send_items?kind=eq.${type.kind}&channel=eq.x&race_id=like.${encodeURIComponent(`${type.idPrefix}:${date}:*`)}&select=id,state,draft_id,race_id,held_reason&order=created_at.desc`,
      ),
    controls: () => readControls(get, type),
    sendReport: async () =>
      (await get("scrape_job_state?job=eq.sns_send&select=last_report"))[0]
        ?.last_report ?? null,
    jobForDraft: async (draftId) =>
      (
        await get(
          `sns_x_send_jobs?draft_id=eq.${draftId}&select=id,state,error_code,scheduled_at,expires_at,posted_at,external_post_id,external_post_url`,
        )
      )[0] ?? null,
  };
}
