/**
 * 節の初日の欠落（racesに1行も無い会場日）を、公式サイトの過去日ページから補うCLI
 * （scripts/maintenance/backfill-opening-day-races.js）の、純粋な部分と取得器。
 * 調査・方針: docs/issues/races-opening-day-missing.md
 *
 * 取得（出走表・展示・結果）と書き込みの本体は、日次・Vercel Cronと共有する既存の runForRaces
 * （scripts/daily/update-race-info.js・scrape-exhibition-data.js・scrape-results.js）を使う。
 * ここにあるのは、racesの行の作成（既存の初期化は予想の生成と一体のため使えない）と、
 * 公式サイトへの負荷を抑える取得器（逐次・間隔・サーキットブレーカー・回数の上限）だけ。
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const BACKFILL_USER_AGENT =
  "BoatraceAIBot/1.0 (+https://github.com/rhapsody0919/boatrace-ai-predictor)";
export const BACKFILL_FETCH_HEADERS = Object.freeze({
  "User-Agent": BACKFILL_USER_AGENT,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "ja,en-US;q=0.7,en;q=0.3",
});

/** これらのHTTPステータスが続いたら、アクセス制限の疑いとして全体を止める */
export const BLOCK_STATUSES = Object.freeze([403, 429, 503]);
/** 連続してこの回数、ブロックの疑いのステータス（または通信失敗）が返ったら止める */
export const BREAKER_THRESHOLD = 2;

export class BackfillAbortError extends Error {
  constructor(message) {
    super(message);
    this.name = "BackfillAbortError";
  }
}

export const venueDayKey = (date, venueCode) =>
  `${date}:${String(venueCode).padStart(2, "0")}`;

export const raceIdOf = (date, venueCode, raceNumber) =>
  `${date}-${String(venueCode).padStart(2, "0")}-${String(raceNumber).padStart(2, "0")}`;

/** `--only=2026-09-01:12,2026-09-02:17` を、キーの集合にする。不正な形式は例外 */
export function parseOnly(spec) {
  if (spec == null || spec === "") return null;
  const keys = new Set();
  for (const part of String(spec).split(",")) {
    const [date, venue] = part.trim().split(":");
    if (!DATE_RE.test(date ?? "") || !/^\d{1,2}$/.test(venue ?? "")) {
      throw new Error(
        `--only の形式が不正です（YYYY-MM-DD:会場コード をカンマ区切り）: ${part}`,
      );
    }
    keys.add(venueDayKey(date, Number(venue)));
  }
  return keys;
}

/**
 * 欠落リスト（missing-venue-days.json の rows）から、処理対象を選ぶ。
 * リストにない会場日は、--only で指定しても処理しない（リスト外の会場日を、誤って書き込まないため）。
 * @param {Array<{race_date: string, venue_code: number}>} rows
 * @param {{only?: Set<string>|null, skip?: Set<string>, limit?: number|null}} [options]
 */
export function selectTargets(
  rows,
  { only = null, skip = new Set(), limit = null } = {},
) {
  const inList = new Set(
    rows.map((r) => venueDayKey(r.race_date, r.venue_code)),
  );
  if (only) {
    const unknown = [...only].filter((k) => !inList.has(k));
    if (unknown.length > 0) {
      throw new Error(
        `--only に、欠落リストに無い会場日があります: ${unknown.join(", ")}`,
      );
    }
  }
  const targets = rows
    .filter((r) => {
      const key = venueDayKey(r.race_date, r.venue_code);
      return (!only || only.has(key)) && !skip.has(key);
    })
    .sort(
      (a, b) =>
        a.race_date.localeCompare(b.race_date) || a.venue_code - b.venue_code,
    );
  return limit != null ? targets.slice(0, limit) : targets;
}

/**
 * 出走表（parseRaceListPage の結果）から、racesの行を作る。
 * 予想は生成しないため、イン崩れ指数（volatility_*）・1号艇の統計は書かない（NULL）。
 * 締切予定時刻（時刻が無いレースは、開催されていない）がある番号だけを作る。
 * @returns {{rows: Object[], raceNumbers: number[], anomalies: string[]}}
 */
export function buildRaceRows({ date, venueCode, page }) {
  if (!DATE_RE.test(date)) throw new Error(`日付の形式が不正です: ${date}`);
  const anomalies = [];
  const rows = [];
  for (const d of page.deadlines) {
    if (!d.time) continue;
    if (!/^\d{2}:\d{2}$/.test(d.time)) {
      anomalies.push(`deadline_format:${d.race_number}:${d.time}`);
      continue;
    }
    rows.push({
      race_id: raceIdOf(date, venueCode, d.race_number),
      race_date: date,
      venue_code: venueCode,
      race_number: d.race_number,
      start_time: `${d.time}:00`,
      race_grade: page.meta.raceGrade ?? null,
    });
  }
  const raceNumbers = rows.map((r) => r.race_number);
  if (rows.length !== 12) anomalies.push(`races_count:${rows.length}`);
  return { rows, raceNumbers, anomalies };
}

/**
 * 公式サイトへの取得器。逐次・間隔つき・URLのキャッシュ（会場日ごとに clearCache）・回数の上限・
 * サーキットブレーカー（403/429/503または通信失敗が連続したら、以後の取得を全て拒否する）。
 * fetchFn(url, init) は Response を返す（update-race-info・scrape-exhibition-data の fetchFn と同じ形）。
 *
 * @param {Object} [options]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {number} [options.intervalMs] リクエストの間隔（既定3500）
 * @param {number} [options.jitterMs] 間隔に加える揺らぎ（0〜jitterMs、既定500）
 * @param {number} [options.timeoutMs]
 * @param {number} [options.maxRequests] 実際に送るリクエスト数の上限（超えたら止める）
 * @param {(ms: number) => Promise<void>} [options.sleep]
 * @param {() => number} [options.random]
 */
export function createThrottledFetch({
  fetchImpl = fetch,
  intervalMs = 3500,
  jitterMs = 500,
  timeoutMs = 20_000,
  maxRequests = 5000,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  random = Math.random,
} = {}) {
  const cache = new Map();
  const state = {
    requests: 0,
    cacheHits: 0,
    consecutiveBlocked: 0,
    tripped: null,
    lastSentAt: 0,
  };

  async function fetchFn(url, init = {}) {
    if (state.tripped) throw new BackfillAbortError(state.tripped);
    const cached = cache.get(url);
    if (cached) {
      state.cacheHits++;
      return new Response(cached.text, { status: cached.status });
    }
    if (state.requests >= maxRequests) {
      state.tripped = `リクエスト数の上限（${maxRequests}）に達しました`;
      throw new BackfillAbortError(state.tripped);
    }
    const wait =
      state.lastSentAt + intervalMs + random() * jitterMs - Date.now();
    if (state.lastSentAt > 0 && wait > 0) await sleep(wait);
    state.lastSentAt = Date.now();
    state.requests++;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        ...init,
        headers: { ...BACKFILL_FETCH_HEADERS, ...(init.headers ?? {}) },
        signal: controller.signal,
      });
      const text = await response.text();
      if (BLOCK_STATUSES.includes(response.status)) {
        recordBlocked(`HTTP ${response.status}（${url}）`);
      } else {
        state.consecutiveBlocked = 0;
        if (response.ok) cache.set(url, { status: response.status, text });
      }
      return new Response(text, { status: response.status });
    } catch (error) {
      if (error instanceof BackfillAbortError) throw error;
      recordBlocked(`通信失敗: ${error.message}（${url}）`);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  function recordBlocked(reason) {
    state.consecutiveBlocked++;
    if (state.consecutiveBlocked >= BREAKER_THRESHOLD) {
      state.tripped = `アクセス制限の疑い（${state.consecutiveBlocked}回連続: ${reason}）。全体を止めます`;
    }
  }

  return {
    fetchFn,
    /** 結果の取得（fetchRaceResultHtml）向け。Response でなく本文を返す形に合わせるアダプタは呼び出し側で作る */
    state,
    clearCache: () => cache.clear(),
  };
}

/**
 * runForRaces の結果（outcome の配列）を、段階ごとの集計にする。
 * ok・skipped_have_data は成功、partial は「書けたが一部未公開」、no_values は「取得できたが値が無い」
 * （中止・未公開）、error・breaker_open は失敗。
 */
export function tallyOutcomes(results) {
  const tally = {};
  for (const r of results) tally[r.outcome] = (tally[r.outcome] ?? 0) + 1;
  return tally;
}

export const FAILED_OUTCOMES = Object.freeze(["error", "breaker_open"]);
export const hasFailure = (tally) =>
  FAILED_OUTCOMES.some((outcome) => (tally[outcome] ?? 0) > 0);
/**
 * 取得はできたが値が無いレース（no_values: 中止・順延・未公開）が1件でもあるか。
 * 全レースが no_values の会場日は、開催されていない（順延・中止）可能性が高い。
 */
export const hasGap = (tally) => (tally.no_values ?? 0) > 0;
