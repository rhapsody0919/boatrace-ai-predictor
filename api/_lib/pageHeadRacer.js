/**
 * 生の HTML の head の材料の関数: 選手ページ（/api/page-head/v1/racer/{4桁}。設計は docs/adr の「生の HTML にページごとの head」）。
 *
 * 人の画面（RacerProfile.jsx）と同じ材料を Supabase の REST から anon キーで読み、同じ関数で組む。
 * - プロフィール（racer_profiles）・最新の出走の級（race_entries の最新1行）・公式の期別成績（racer_period_stats）
 * - title・description・canonical は src/pure/racerPageHead.js、JSON-LD は src/pure/racerStructuredData.js
 * - 正常: 200 の JSON（s-maxage=21600）。読みの失敗・形の違い: 503・no-store（「プロフィール無し」の head にしない）。
 *   選手が無い: 404・no-store。形の外: 404。GET・HEAD の外: 405
 * - 鍵は anon キーだけ（VITE_SUPABASE_ANON_KEY か SUPABASE_ANON_KEY）
 */
import { PAGE_HEAD_VERSION } from "./pageHeadApi.js";
import { makeRacer } from "../../src/pure/racerModel.js";
import { buildRacerSummary } from "../../src/pure/racerOfficialPeriodStats.js";
import { racerPageMeta } from "../../src/pure/racerPageHead.js";
import { racerStructuredData } from "../../src/pure/racerStructuredData.js";

export const RACER_HEAD_HEADERS = Object.freeze({
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control":
    "public, max-age=0, s-maxage=21600, stale-while-revalidate=3600, stale-if-error=3600",
});
const NO_STORE = Object.freeze({ "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
const UNAVAILABLE = Object.freeze({ ...NO_STORE, "Retry-After": "300" });
const RACER_PATH = /^\/api\/page-head\/v1\/racer\/(\d{4})$/;
const FETCH_TIMEOUT_MS = 4_000;

/** 材料の読みの失敗（503 にする） */
export class RacerHeadFetchError extends Error {
  constructor(message) {
    super(message);
    this.name = "RacerHeadFetchError";
  }
}

const PROFILE_COLUMNS =
  "racer_id,name,name_kana,birth_date,height_cm,weight_kg,blood_type,branch,hometown,registration_period";
const PERIOD_COLUMNS = "period_year,period_no,calc_to,win_rate,top2_rate,starts,finals,wins";

/**
 * 選手の材料を読む関数を作る
 * @param {{fetchImpl?: typeof fetch, env?: Record<string, string|undefined>}} [options]
 * @returns {(racerId: string) => Promise<{profile: object|null, grade: string|null, periodRows: object[]}>}
 */
export function createRacerSource({ fetchImpl = (...args) => fetch(...args), env = process.env } = {}) {
  async function rest(path) {
    const base = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
    const key = env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY;
    if (!base || !key) throw new RacerHeadFetchError("Supabase の URL か anon キーが無い");
    let res;
    try {
      res = await fetchImpl(`${String(base).replace(/\/$/, "")}/rest/v1/${path}`, {
        headers: { apikey: key, Authorization: `Bearer ${key}`, accept: "application/json" },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch (e) {
      throw new RacerHeadFetchError(`${path.split("?")[0]} を取れない: ${e?.message ?? e}`);
    }
    if (!res.ok) throw new RacerHeadFetchError(`${path.split("?")[0]} が HTTP ${res.status}`);
    const rows = await res.json().catch(() => null);
    if (!Array.isArray(rows)) throw new RacerHeadFetchError(`${path.split("?")[0]} の応答が配列でない`);
    return rows;
  }
  return async function getRacer(racerId) {
    const id = encodeURIComponent(racerId);
    const [profiles, entries, periodRows] = await Promise.all([
      rest(`racer_profiles?racer_id=eq.${id}&select=${PROFILE_COLUMNS}&limit=1`),
      rest(`race_entries?racer_id=eq.${id}&select=grade,race_id&order=race_id.desc&limit=1`),
      rest(`racer_period_stats?racer_id=eq.${id}&select=${PERIOD_COLUMNS}&order=period_year.desc,period_no.desc`),
    ]);
    let profile = null;
    try {
      profile = profiles[0] ? makeRacer(profiles[0]) : null;
    } catch (e) {
      throw new RacerHeadFetchError(`racer_profiles の行が壊れている: ${e?.message ?? e}`);
    }
    return { profile, grade: entries[0]?.grade ?? null, periodRows };
  };
}

/**
 * 選手の head の JSON の中身（材料から組む純な部分）
 * @param {{profile: object|null, grade: string|null, periodRows: object[]}} material
 * @param {string} racerId
 */
export function racerHeadOf({ profile, grade, periodRows }, racerId) {
  const summary = buildRacerSummary(periodRows);
  const meta = racerPageMeta({ profile, grade }, racerId, summary);
  return {
    title: meta.title,
    description: meta.description,
    canonical: meta.canonicalUrl,
    jsonLd: racerStructuredData(profile, racerId, summary?.dateModified ?? null),
  };
}

const plain = (status, headers, body) => ({ status, headers, body });

/**
 * @param {{method?: string, url?: string}} req
 * @param {{getRacer: (racerId: string) => Promise<{profile: object|null, grade: string|null, periodRows: object[]}>}} deps
 */
export async function respondRacerHead({ method, url }, { getRacer }) {
  if (method !== "GET" && method !== "HEAD") {
    return plain(405, { ...NO_STORE, Allow: "GET, HEAD" }, "405 Method Not Allowed\n");
  }
  let pathname = "";
  try {
    pathname = new URL(url ?? "", "http://localhost").pathname;
  } catch {
    pathname = ""; // 読めない URL は形の外（404）
  }
  const m = RACER_PATH.exec(pathname);
  if (!m) return plain(404, NO_STORE, "404 Not Found\n");
  try {
    const material = await getRacer(m[1]);
    // 選手が無い（人の画面は「該当する選手なし」で noindex）。CDN に残さない
    if (!material.profile) return plain(404, NO_STORE, "404 Not Found\n");
    const body = JSON.stringify({ v: PAGE_HEAD_VERSION, kind: "racer", ...racerHeadOf(material, m[1]) });
    return plain(200, RACER_HEAD_HEADERS, body);
  } catch (e) {
    console.error(`[page-head] racer ${m[1]}: 503 ${e?.name}: ${e?.message}`);
    return plain(503, UNAVAILABLE, "503 Service Unavailable\n");
  }
}

const defaultSource = createRacerSource();

/** Vercel の Node 関数のハンドラ（req, res）。deps は verify で差し替える */
export function createRacerHeadHandler({ getRacer = defaultSource } = {}) {
  return async function handler(req, res) {
    const { status, headers, body } = await respondRacerHead({ method: req.method, url: req.url }, { getRacer });
    res.statusCode = status;
    for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
    res.end(req.method === "HEAD" ? undefined : body);
  };
}
