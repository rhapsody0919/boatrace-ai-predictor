/**
 * オッズのライブ取得（BOA-487）の純粋部分。api/odds/live.js から使う。
 *
 * 公式のオッズページを1ページ取得して解析し、画面（オッズ一覧タブ）にそのまま返す。race_odds には書かない
 * （スナップショットの窓・prediction_odds の導出と混ぜないため）。取得（HTTP・ブレーカー）は呼び出し側の責務で、
 * ここはクエリの検証・URLの組み立て・HTMLの解析・応答（ステータス・Cache-Control・本文）の組み立てだけを持つ
 * （verify-odds-live-api.js がフィクスチャで検証する）。
 *
 * 票0（公式の「0.0」）は 0 のまま返す。「欠場・未発売」（セルが数値でない＝キーが無い）と区別するため。
 */
import * as cheerio from "cheerio";
import {
  parseTrifectaAll,
  parseTrioAll,
  parseExactaAll,
  parseQuinellaAll,
  parseWideAll,
  parseOddsUpdatedAt,
  isFinalOdds,
} from "./oddsParser.js";
import { scrapeWinOdds, scrapePlaceOdds } from "../daily/scrape-odds.js";
import { toJstDateString } from "./scrapeJobs/time.js";
import { BreakerOpenError } from "./scrapeJobs/circuitBreaker.js";
import { FetchError } from "./scrapeJobs/politeFetch.js";

/** page パラメータ → 公式のページ名 */
export const LIVE_ODDS_PAGES = {
  tf: "oddstf",
  "3t": "odds3t",
  "3f": "odds3f",
  "2tf": "odds2tf",
  k: "oddsk",
};

const ALLOWED_PARAMS = new Set(["raceId", "page"]);
const RACE_ID_RE = /^(\d{4}-\d{2}-\d{2})-(\d{2})-(\d{2})$/;

// Cache-Control（CDN に集約し、公式へのアクセスを1レース×1ページあたり最大30秒に1回に抑える）
export const CACHE_OK = "public, s-maxage=30, stale-while-revalidate=60";
export const CACHE_FINAL = "public, s-maxage=300, stale-while-revalidate=60";
export const CACHE_UPSTREAM_ERROR = "public, s-maxage=10";
export const CACHE_NO_STORE = "no-store";

/**
 * クエリを検証する。raceId は形式に加えて「JSTの当日」だけ受け付ける（過去・未来のレースで公式へ取りに行かない）。
 *
 * @param {Record<string, unknown>} query
 * @param {Date} [now]
 * @returns {{ok: true, raceId: string, page: string, date: string, venue: number, raceNo: number} | {ok: false, error: string}}
 */
export function validateLiveOddsQuery(query, now = new Date()) {
  const keys = Object.keys(query ?? {});
  const unknown = keys.filter((k) => !ALLOWED_PARAMS.has(k));
  if (unknown.length > 0) {
    return { ok: false, error: `未知のパラメータ: ${unknown.join(", ")}` };
  }
  const { raceId, page } = query;
  if (typeof raceId !== "string" || typeof page !== "string") {
    return { ok: false, error: "raceId と page は1つずつ指定してください" };
  }
  if (!Object.hasOwn(LIVE_ODDS_PAGES, page)) {
    return {
      ok: false,
      error: `page は ${Object.keys(LIVE_ODDS_PAGES).join("|")} のいずれか`,
    };
  }
  const m = raceId.match(RACE_ID_RE);
  if (!m) return { ok: false, error: "raceId は YYYY-MM-DD-VV-RR 形式" };
  const [, date, vv, rr] = m;
  const venue = Number(vv);
  const raceNo = Number(rr);
  if (venue < 1 || venue > 24 || raceNo < 1 || raceNo > 12) {
    return { ok: false, error: "会場は01〜24、レースは01〜12" };
  }
  if (date !== toJstDateString(now)) {
    return { ok: false, error: "当日（JST）のレースだけ取得できます" };
  }
  return { ok: true, raceId, page, date, venue, raceNo };
}

/** 公式オッズページのURL */
export function liveOddsUrl({ date, venue, raceNo, page }) {
  const hd = date.replace(/-/g, "");
  const jcd = String(venue).padStart(2, "0");
  return `https://www.boatrace.jp/owpc/pc/race/${LIVE_ODDS_PAGES[page]}?rno=${raceNo}&jcd=${jcd}&hd=${hd}`;
}

// 艇番 → 値（値が取れなかった艇＝欠場・解析できないセルは入れない）
const byBoatNumber = (values) =>
  Object.fromEntries(
    values
      .map((v, i) => [String(i + 1), v])
      .filter(([, v]) => v !== null && v !== undefined),
  );

const mapToObject = (map) => Object.fromEntries(map);

/**
 * 公式オッズページのHTMLを解析する。
 *
 * @param {string} page LIVE_ODDS_PAGES のキー
 * @param {string} html
 * @returns {{published: boolean, officialUpdatedAt: string|null, final: boolean, data: Record<string, unknown>}}
 *   published=false は、オッズのセル（.oddsPoint）が1件も無い（発売前・中止・順延）
 */
export function parseLiveOddsPage(page, html) {
  const $ = cheerio.load(html);
  const published = $(".oddsPoint").length > 0;
  const officialUpdatedAt = parseOddsUpdatedAt($);
  const final = isFinalOdds($);
  const opts = { keepZero: true };
  let data = {};
  if (published) {
    switch (page) {
      case "tf":
        data = {
          win: byBoatNumber(scrapeWinOdds($, opts)),
          place: byBoatNumber(scrapePlaceOdds($, opts)),
        };
        break;
      case "3t":
        data = { trifectaAll: mapToObject(parseTrifectaAll($, opts)) };
        break;
      case "3f":
        data = { trioAll: mapToObject(parseTrioAll($, opts)) };
        break;
      case "2tf":
        data = {
          exactaAll: mapToObject(parseExactaAll($, opts)),
          quinellaAll: mapToObject(parseQuinellaAll($, opts)),
        };
        break;
      case "k":
        data = { wideAll: mapToObject(parseWideAll($, opts)) };
        break;
      default:
        throw new Error(`未知の page: ${page}`);
    }
  }
  return { published, officialUpdatedAt, final, data };
}

const json = (status, cacheControl, body) => ({ status, cacheControl, body });

/** 400（クエリの誤り）。キャッシュさせない */
export function badRequestResponse(error) {
  return json(400, CACHE_NO_STORE, { ok: false, reason: "bad_request", error });
}

/**
 * 公式側の失敗（HTTP非200・タイムアウト・ブレーカー・未発売）。200 で返し、短くキャッシュする
 * （閲覧者が多いときに、落ちている公式へ全員が取りに行かないため）
 *
 * @param {string} reason
 * @param {number} retryAfterSec
 */
export function upstreamErrorResponse(reason, retryAfterSec) {
  return json(200, CACHE_UPSTREAM_ERROR, {
    ok: false,
    reason,
    retryAfterSec: Math.max(1, Math.ceil(retryAfterSec)),
  });
}

/**
 * 取得・解析の結果から応答を組み立てる
 *
 * @param {{raceId: string, page: string}} target
 * @param {ReturnType<typeof parseLiveOddsPage>} parsed
 * @param {Date} fetchedAt
 */
export function successResponse(target, parsed, fetchedAt) {
  if (!parsed.published) return upstreamErrorResponse("not_on_sale", 60);
  return json(200, parsed.final ? CACHE_FINAL : CACHE_OK, {
    ok: true,
    raceId: target.raceId,
    page: target.page,
    fetchedAt: fetchedAt.toISOString(),
    officialUpdatedAt: parsed.officialUpdatedAt,
    final: parsed.final,
    data: parsed.data,
  });
}

/**
 * 1回の要求を処理し、{status, cacheControl, body} を返す（HTTP に依存しない。検証ではこれを直接呼ぶ）。
 *
 * @param {Object} options
 * @param {Record<string, unknown>} options.query
 * @param {string} [options.method]
 * @param {(url: string) => Promise<Response>} options.politeFetch createPoliteFetch の返り値（ブレーカー込み）
 * @param {() => Date} [options.now]
 */
export async function handleLiveOddsRequest({
  query,
  method = "GET",
  politeFetch,
  now = () => new Date(),
}) {
  if (method !== "GET") {
    return { ...badRequestResponse("GET のみ"), status: 405 };
  }
  const target = validateLiveOddsQuery(query ?? {}, now());
  if (!target.ok) return badRequestResponse(target.error);

  let response;
  try {
    response = await politeFetch(liveOddsUrl(target));
  } catch (error) {
    if (error instanceof BreakerOpenError) {
      return upstreamErrorResponse(
        "breaker_open",
        (error.until - now().getTime()) / 1000,
      );
    }
    if (error instanceof FetchError) {
      console.warn(
        `オッズのライブ取得に失敗 ${target.raceId} ${target.page}: ${error.message}`,
      );
      return upstreamErrorResponse("fetch_failed", 10);
    }
    throw error;
  }
  if (!response.ok) {
    console.warn(
      `オッズのライブ取得: 公式が HTTP ${response.status} を返した ${target.raceId} ${target.page}`,
    );
    return upstreamErrorResponse(`upstream_http_${response.status}`, 10);
  }
  const parsed = parseLiveOddsPage(target.page, await response.text());
  return successResponse(target, parsed, now());
}
