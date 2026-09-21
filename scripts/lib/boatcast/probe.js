/**
 * BOATCASTへ、Vercel（実際の本番のリージョン）から到達できるかの確認（probe）。
 *
 * 調査時のアクセス（2026-09-20・21）は、Vercelからではなかった。BOATCASTがVercelのIPをブロックしていないか、
 * 本番へマージした後、shadow・live にする前に、手動リクエストで確認する。
 *
 *   GET /api/cron/boatcast-oriten?probe=1
 *       Authorization: Bearer {CRON_SECRET}
 *       （任意）&race=YYYY-MM-DD-VV-RR  オリジナル展示のファイルも1件取る。無ければカナリアだけ（1リクエスト）
 *
 * 認証は Bearer {CRON_SECRET}（共通ラッパと同じ）。ジョブ boatcast_oriten の scrape_job_state.mode が shadow・live
 * のときだけ実行する（off は、意図せず取得先へアクセスしないため、409）。書き込まない。
 * 応答: 既知の存在ファイル（カナリア。bc_mst）の HTTP ステータス・Content-Type・Last-Modified・本文の先頭、
 * 実行したリージョン（VERCEL_REGION）、所要時間（ms）。リクエストは逐次で、間隔を2.2秒以上空ける。
 * ブレーカーには載せない（確認用。数件のリクエスト）。
 */
import { isAuthorized } from "../scrapeJobs/cronWrapper.js";
import { createPoliteFetch } from "../scrapeJobs/politeFetch.js";
import { createSupabaseStore } from "../scrapeJobs/store.js";
import {
  CANARY_URL,
  buildOritenUrl,
  fetchBoatcast,
  sharedPacer,
} from "./boatcastClient.js";
import { ORITEN_JOB } from "./oritenJob.js";

const HEAD_LENGTH = 120;

async function probeOne(url, deps) {
  const started = Date.now();
  try {
    const res = await fetchBoatcast(url, deps);
    return {
      url,
      status: res.status,
      contentType: res.contentType,
      lastModified: res.lastModified,
      head: res.text === null ? null : res.text.slice(0, HEAD_LENGTH),
      elapsedMs: Date.now() - started,
    };
  } catch (error) {
    return {
      url,
      status: null,
      error: String(error?.message ?? error),
      elapsedMs: Date.now() - started,
    };
  }
}

/**
 * @param {Object} [options]
 * @param {() => Promise<import("@supabase/supabase-js").SupabaseClient|null>} [options.getClient]
 * @param {(client: unknown) => {readState: Function}} [options.createStore]
 * @param {typeof fetch} [options.fetchImpl]
 */
export function createBoatcastProbeHandler({
  getClient = async () => (await import("../supabaseClient.js")).supabase,
  createStore = createSupabaseStore,
  fetchImpl = createPoliteFetch(),
  pacer = sharedPacer,
} = {}) {
  return async function probeHandler(req, res) {
    if (!isAuthorized(req.headers.authorization, process.env.CRON_SECRET)) {
      return res.status(401).json({ success: false, error: "unauthorized" });
    }
    const client = await getClient();
    if (!client) {
      return res
        .status(500)
        .json({ success: false, error: "Supabase が設定されていません" });
    }
    let state;
    try {
      state = await createStore(client).readState(ORITEN_JOB);
    } catch (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
    const mode = state.row?.mode ?? "off";
    if (!state.available || (mode !== "shadow" && mode !== "live")) {
      return res.status(409).json({
        success: false,
        error: `${ORITEN_JOB} の mode が shadow・live ではありません（${state.available ? mode : "予定表が未適用"}）`,
      });
    }
    const started = Date.now();
    const deps = { fetchImpl, pacer };
    const canary = await probeOne(CANARY_URL, deps);
    const raceId = typeof req.query?.race === "string" ? req.query.race : null;
    let sample = null;
    if (raceId) {
      try {
        sample = await probeOne(buildOritenUrl(raceId), deps);
      } catch (error) {
        return res.status(400).json({ success: false, error: error.message });
      }
    }
    return res.status(200).json({
      success: true,
      region: process.env.VERCEL_REGION ?? "local",
      mode,
      canary,
      sample,
      elapsedMs: Date.now() - started,
    });
  };
}
