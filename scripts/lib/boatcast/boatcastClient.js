/**
 * BOATCAST（race.boatcast.jp）への取得の共通部品: URL・間隔の制御・カナリア・403の解釈。
 *
 * BOATCASTは、存在しないファイルを「403のHTMLエラーページ」で返す（S3/CloudFrontの標準の挙動）。共有の
 * politeFetch（scripts/lib/scrapeJobs/politeFetch.js）は、429/503だけを失敗として数え、403は成功として扱う。
 * そのため、(a)「未配置（正常）」と「アクセス拒否（異常）」を区別できず、(b)サーキットブレーカーの半開中の403が
 * ブレーカーを誤って閉じる。共有部品は変更せず（別PRの領域）、このジョブの中で次のように扱う。
 *   - 403は「データ無し」として扱う前に、既知の存在ファイル（カナリア: bc_mst）を取り、それも403・失敗なら、
 *     アクセス拒否・接続の異常として扱う（データ無しとして記録しない）
 *   - 会場×項目の公開マップ（publicMap.js）で、常時403の会場は最初から取得しない
 *   - 403の再試行は最大3回（oritenRows.js の decideNotPublished）
 *   - 取得は逐次で、リクエストの間隔を2.2秒以上空ける（sharedPacer。ADR-0067の負荷の配慮）
 *
 * 別ホスト: ブレーカーのキーは host:race.boatcast.jp（boatrace.jp のブレーカーとは独立）。
 */
import { parseMotorStartDate } from "./oritenParser.js";
import { parseLastModified } from "./oritenRows.js";
import { BreakerOpenError } from "../scrapeJobs/circuitBreaker.js";

export const BOATCAST_ORIGIN = "https://race.boatcast.jp";
export const BOATCAST_HOST = "race.boatcast.jp";

/** リクエスト間隔の下限（ミリ秒）。調査時と同じ2秒に余裕（0.2秒）を足す */
export const BOATCAST_MIN_INTERVAL_MS = 2200;

/** オリジナル展示のURL。race_id は YYYY-MM-DD-VV-RR */
export function buildOritenUrl(raceId) {
  const m = /^(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})$/.exec(String(raceId));
  if (!m) throw new Error(`race_id の形式が不正です: ${String(raceId)}`);
  const [, y, mo, d, jo, rr] = m;
  return `${BOATCAST_ORIGIN}/txt/${jo}/bc_oriten_${y}${mo}${d}_${jo}_${rr}.txt`;
}

/** モーター使用開始日（bc_mst）のURL。会場コードは2桁。`txt/` 配下ではなく `hp_txt/` 配下（`txt/` は403） */
export function buildMotorStartUrl(jo) {
  if (!/^\d{2}$/.test(String(jo))) {
    throw new Error(`会場コードの形式が不正です: ${String(jo)}`);
  }
  return `${BOATCAST_ORIGIN}/hp_txt/${jo}/bc_mst_${jo}.txt`;
}

/**
 * カナリア: 既知の存在ファイル。bc_mst は全24会場で常時存在し（2026-09-21に24件とも200を確認）、毎日再生成される。
 * 住之江（12）を使う。403・失敗・形式不正なら、BOATCAST側のアクセス拒否・接続の異常とみなす。
 */
export const CANARY_VENUE = "12";
export const CANARY_URL = buildMotorStartUrl(CANARY_VENUE);

/**
 * リクエスト間隔の制御（直前のリクエストの開始から minIntervalMs 以上空ける）。1つのプロセス（関数インスタンス）内で
 * 共有する。並行する呼び出しも、順番に間隔を空けて進む。
 */
export function createPacer({
  minIntervalMs = BOATCAST_MIN_INTERVAL_MS,
  now = () => Date.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  let nextAllowedAt = 0;
  return {
    /** 次のリクエストを出してよい時刻まで待つ（呼び出した順に、間隔を空けて通す） */
    async wait() {
      const t = now();
      const startAt = Math.max(t, nextAllowedAt);
      nextAllowedAt = startAt + minIntervalMs;
      if (startAt > t) await sleep(startAt - t);
    },
  };
}

export const sharedPacer = createPacer();

/**
 * 1件取得する。200・403・その他（404・5xx・429/503（politeFetchの再試行後））を区別して返す。ネットワーク
 * エラーは例外（呼び出し側が error として扱う）。本文は200のときだけ返す（403のHTMLエラーページは捨てる）。
 *
 * @param {string} url
 * @param {Object} deps
 * @param {(url: string, init?: RequestInit) => Promise<Response>} deps.fetchImpl politeFetch など
 * @param {{wait: () => Promise<void>}} [deps.pacer]
 * @returns {Promise<{status: number, text: string|null, lastModified: string|null, contentType: string|null}>}
 */
export async function fetchBoatcast(url, { fetchImpl, pacer = sharedPacer }) {
  await pacer.wait();
  const response = await fetchImpl(url, { headers: { Accept: "text/plain" } });
  const status = response.status;
  const text = status === 200 ? await response.text() : null;
  return {
    status,
    text,
    lastModified: parseLastModified(response.headers?.get?.("last-modified")),
    contentType: response.headers?.get?.("content-type") ?? null,
  };
}

/**
 * カナリアを取って判定する。ブレーカーが開いている場合（BreakerOpenError）は、そのまま投げる。
 * @returns {Promise<{ok: boolean, status: number|null, detail: string}>}
 */
export async function checkCanary(deps) {
  try {
    const res = await fetchBoatcast(CANARY_URL, deps);
    if (res.status !== 200) {
      return {
        ok: false,
        status: res.status,
        detail: `カナリア（${CANARY_URL}）が HTTP ${res.status} でした`,
      };
    }
    if (parseMotorStartDate(res.text) === null) {
      return {
        ok: false,
        status: 200,
        detail: `カナリア（${CANARY_URL}）の本文が YYYYMMDD ではありません: ${String(res.text).slice(0, 40)}`,
      };
    }
    return { ok: true, status: 200, detail: "ok" };
  } catch (error) {
    // ブレーカーが開いている（429/503の連続）は、カナリアの失敗ではない。呼び出し側（共通ラッパ）が breaker_open として扱う
    if (error instanceof BreakerOpenError) throw error;
    return {
      ok: false,
      status: null,
      detail: `カナリア（${CANARY_URL}）の取得に失敗しました: ${error?.message ?? error}`,
    };
  }
}
