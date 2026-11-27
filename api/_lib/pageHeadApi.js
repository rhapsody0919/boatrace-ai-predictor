/**
 * 生の HTML の head の材料の関数（/api/page-head/v1/*。設計は docs/adr の「生の HTML にページごとの head」）。
 *
 * middleware が head を差し込むために取る JSON。中身は人の画面・ボット向け HTML（ADR 0089）と同じ関数の値で、
 * 会場ページ（本日分）は botPage.js の venueModelOf と botPageRender.js の venuePageHeadOf を使う。
 * - 正常: 200 の JSON {v, kind, title, description, canonical, jsonLd}。CDN にキャッシュする（kind ごとの s-maxage）
 * - 材料が取れない・形が違う: 503・no-store・Retry-After（「該当なし」や古い値を CDN に残さない。middleware は素通り）
 * - パスの形の外: 404・no-store。GET・HEAD の外: 405。クエリ文字列は見ない
 * - 鍵は anon キーだけ（節の行は botPage.js の createSeriesSource）
 */
import { readFileSync } from "node:fs";
import { getJSTNow } from "../../src/pure/jstDate.js";
import { PAGE_HEAD_VERSION } from "../../src/pure/pageHead.js";
import {
  createSeriesSource,
  createTodayRacesSource,
  originOf,
  tFromResources,
  venueModelOf,
} from "./botPage.js";
import { venuePageHeadOf } from "./botPageRender.js";

// JSON の形の版は middleware と同じ定数（src/pure/pageHead.js）
export { PAGE_HEAD_VERSION };

export const VENUE_HEAD_HEADERS = Object.freeze({
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control":
    "public, max-age=0, s-maxage=300, stale-while-revalidate=60, stale-if-error=3600",
});
const NO_STORE = Object.freeze({
  "Content-Type": "text/plain; charset=utf-8",
  "Cache-Control": "no-store",
});
const UNAVAILABLE = Object.freeze({ ...NO_STORE, "Retry-After": "300" });

const VENUE_PATH = /^\/api\/page-head\/v1\/venue\/([1-9]|1\d|2[0-4])$/;

// ja の訳。静的なパスで読む（関数の束に入る。botPage.js の getLocaleT は言語をパスに入れて読むので
// vercel.json の includeFiles が要り、この関数には付いていない）
let jaTPromise = null;
function getBundledJaT() {
  jaTPromise ??= tFromResources("ja", {
    ja: {
      common: JSON.parse(
        readFileSync(new URL("../../src/locales/ja/common.json", import.meta.url), "utf8"),
      ),
    },
  }).catch((e) => {
    jaTPromise = null;
    throw e;
  });
  return jaTPromise;
}

const plain = (status, headers, body) => ({ status, headers, body });

/**
 * @param {{method?: string, url?: string, headers?: Record<string, string>}} req
 * @param {{getTodayJson: (origin: string) => Promise<unknown>, getSeriesRows: Function, getT: () => Promise<Function>, now: () => number}} deps
 * @returns {Promise<{status: number, headers: Record<string, string>, body: string}>}
 */
export async function respondVenueHead({ method, url, headers }, { getTodayJson, getSeriesRows, getT, now }) {
  if (method !== "GET" && method !== "HEAD") {
    return plain(405, { ...NO_STORE, Allow: "GET, HEAD" }, "405 Method Not Allowed\n");
  }
  let pathname = null;
  try {
    pathname = new URL(url ?? "", "http://localhost").pathname;
  } catch {
    pathname = null; // 読めない URL は形の外（404）
  }
  const m = pathname === null ? null : VENUE_PATH.exec(pathname);
  if (!m) return plain(404, NO_STORE, "404 Not Found\n");
  const origin = originOf(headers);
  if (!origin) return plain(400, NO_STORE, "400 Bad Request\n");
  const venueCode = Number(m[1]);
  try {
    const [json, t] = await Promise.all([getTodayJson(origin), getT()]);
    const today = getJSTNow(new Date(now())).toISOString().slice(0, 10);
    const model = await venueModelOf(json, venueCode, { t, lang: "ja", today }, getSeriesRows);
    const body = JSON.stringify({ v: PAGE_HEAD_VERSION, kind: "venue", ...venuePageHeadOf(model) });
    return plain(200, VENUE_HEAD_HEADERS, body);
  } catch (e) {
    console.error(`[page-head] venue ${venueCode}: 503 ${e?.name}: ${e?.message}`);
    return plain(503, UNAVAILABLE, "503 Service Unavailable\n");
  }
}

const defaultTodaySource = createTodayRacesSource();
const defaultSeriesSource = createSeriesSource();

/** Vercel の Node 関数のハンドラ（req, res）。deps は verify で差し替える */
export function createVenueHeadHandler({
  getTodayJson = defaultTodaySource,
  getSeriesRows = defaultSeriesSource,
  getT = getBundledJaT,
  now = Date.now,
} = {}) {
  return async function handler(req, res) {
    const { status, headers, body } = await respondVenueHead(
      { method: req.method, url: req.url, headers: req.headers },
      { getTodayJson, getSeriesRows, getT, now },
    );
    res.statusCode = status;
    for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
    res.end(req.method === "HEAD" ? undefined : body);
  };
}
