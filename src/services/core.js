// src/services/supabaseDataService.js から scripts/maintenance/split-data-layer.mjs で字のまま移した（領域: core）。
// 本体の字下げは元のまま。手で直すときは普通の関数として直してよい

import { getTodayJST } from "../utils/dateUtils.js";
import { supabase } from "./supabaseClient";
import { tallyWinPlaceShow } from "../utils/racerConditionStats.js";
import { fetchAllInChunks } from "./fetchAllPages.js";

// Edge API のベースURL（本番環境では同一オリジン）
export const EDGE_API_BASE = "";

/**
 * 2層キャッシュ機構（メモリ + localStorage）
 * - メモリ: 最速、セッション中のみ有効
 * - localStorage: ページリロード後も有効
 * スクレイピングは1時間に1回なので、30分間キャッシュを保持
 */
export const CACHE_TTL = 30 * 60 * 1000; // 30分
// 過去レースの分析データは不変のため長期キャッシュしてよい
// （Supabase egress削減: レース単位の分析クエリは1レースあたり約0.5MBの生データを転送するため）
export const PAST_RACE_CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7日

/**
 * キャッシュキーからTTLを推定する。
 * キー末尾がrace_id形式（YYYY-MM-DD-VV-RR）かつ過去日付なら長期TTL
 * （本日分は展示データ投入・結果確定で内容が変わるため通常TTL）
 */
function inferTtlFromKey(key) {
  const m = String(key).match(/(\d{4}-\d{2}-\d{2})-\d{2}-\d{2}(?::.*)?$/);
  if (m) {
    const jstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const today = jstNow.toISOString().split("T")[0];
    if (m[1] < today) return PAST_RACE_CACHE_TTL;
  }
  return CACHE_TTL;
}
const CACHE_PREFIX = "boatai:";

/**
 * localStorage のそのキーが、データキャッシュ（cache.set が書いた {data, timestamp}）か。
 * 接頭辞 boatai: は Cookie の同意（boatai:cookie-consent）・初回訪問・案内バナーを
 * 閉じた記録にも使っており、接頭辞だけで判定すると更新ボタンでそれらまで消えた
 * （BOA-665。Cookie の同意バナーが再表示される）。値の形で見分ける
 */
function readCacheEntry(storageKey) {
  if (!storageKey || !storageKey.startsWith(CACHE_PREFIX)) return null;
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey));
    return parsed !== null &&
      typeof parsed === "object" &&
      typeof parsed.timestamp === "number" &&
      "data" in parsed
      ? parsed
      : null;
  } catch {
    return null; // JSON でない値（"granted" 等）はキャッシュではない
  }
}

const cache = {
  memory: new Map(),

  /**
   * キャッシュからデータを取得
   * 1. メモリキャッシュ（最速）
   * 2. localStorageキャッシュ（リロード後も有効）
   * @param {string} key
   * @param {number} [ttl] - TTL(ms)。省略時はグローバルCACHE_TTL
   */
  get(key, ttl = CACHE_TTL) {
    // 1. メモリから
    const memCached = this.memory.get(key);
    if (memCached && Date.now() - memCached.timestamp < ttl) {
      const remaining = Math.round(
        (ttl - (Date.now() - memCached.timestamp)) / 1000,
      );
      console.log(`[Cache HIT] Memory: ${key} (${remaining}s remaining)`);
      return memCached.data;
    }

    // 2. localStorageから
    try {
      const stored = localStorage.getItem(CACHE_PREFIX + key);
      if (stored) {
        const { data, timestamp } = JSON.parse(stored);
        if (Date.now() - timestamp < ttl) {
          const remaining = Math.round((ttl - (Date.now() - timestamp)) / 1000);
          console.log(
            `[Cache HIT] localStorage: ${key} (${remaining}s remaining)`,
          );
          // メモリにも復元
          this.memory.set(key, { data, timestamp });
          return data;
        } else {
          // 期限切れは削除
          localStorage.removeItem(CACHE_PREFIX + key);
        }
      }
    } catch (e) {
      console.warn("[Cache] localStorage read error:", e);
    }

    return null;
  },

  /**
   * キャッシュにデータを保存（メモリ + localStorage両方）
   */
  set(key, data) {
    const timestamp = Date.now();

    // メモリに保存（サイズ制限なし）
    this.memory.set(key, { data, timestamp });

    // localStorageに保存（サイズ制限あり: 500KB以下のみ）
    try {
      const serialized = JSON.stringify({ data, timestamp });
      const sizeKB = serialized.length / 1024;

      if (sizeKB > 500) {
        // 500KB超はlocalStorageに保存しない（メモリキャッシュのみ）
        console.log(
          `[Cache SET] ${key} (memory only, ${sizeKB.toFixed(0)}KB exceeds localStorage limit)`,
        );
        return;
      }

      localStorage.setItem(CACHE_PREFIX + key, serialized);
      console.log(`[Cache SET] ${key} (${sizeKB.toFixed(0)}KB)`);
    } catch (e) {
      // localStorage容量超過時は古いキャッシュを削除して再試行
      if (e.name === "QuotaExceededError") {
        this._cleanupOldCache();
        try {
          localStorage.setItem(
            CACHE_PREFIX + key,
            JSON.stringify({ data, timestamp }),
          );
        } catch {
          console.log(`[Cache SET] ${key} (memory only, localStorage full)`);
        }
      } else {
        console.warn("[Cache] localStorage write error:", e);
      }
    }
  },

  /**
   * キャッシュをクリア
   */
  clear(key = null) {
    if (key) {
      this.memory.delete(key);
      try {
        localStorage.removeItem(CACHE_PREFIX + key);
      } catch {
        // localStorage が使えない環境では何もしない
      }
      console.log(`[Cache CLEAR] ${key}`);
    } else {
      this.memory.clear();
      this._clearAllLocalStorage();
      console.log("[Cache CLEAR] All");
    }
  },

  /**
   * localStorage内の龍神レーダーのデータキャッシュを全削除（設定のキーは残す）
   */
  _clearAllLocalStorage() {
    try {
      const keys = Object.keys(localStorage).filter(
        (k) => readCacheEntry(k) !== null,
      );
      keys.forEach((k) => localStorage.removeItem(k));
    } catch {
      // localStorage が使えない環境では何もしない
    }
  },

  /**
   * 古いキャッシュを削除（容量超過時）
   */
  _cleanupOldCache() {
    try {
      const entries = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        // 設定のキー（JSON でない値）で JSON.parse が投げて掃除全体が止まっていた（BOA-665）
        const entry = readCacheEntry(key);
        if (entry) entries.push({ key, timestamp: entry.timestamp });
      }
      // 古い順にソートして半分削除
      entries.sort((a, b) => a.timestamp - b.timestamp);
      const toDelete = entries.slice(0, Math.ceil(entries.length / 2));
      toDelete.forEach((e) => localStorage.removeItem(e.key));
      console.log(`[Cache CLEANUP] Removed ${toDelete.length} old entries`);
    } catch {
      // localStorage が使えない環境では何もしない
    }
  },
};

/**
 * キャッシュ付きデータ取得
 * 同一キーの取得が進行中の場合は同じPromiseを返す（in-flightデデュープ）。
 * プリフェッチとコンポーネントの取得が重なっても二重クエリにならない
 */
const inflightRequests = new Map();

// shouldCache: 結果を保存するか。既定は取得失敗（fetchFailed: true）以外を保存する。
// 0行を「まだ書かれていない」と区別できない表（毎日書き直す集計表等）は、0行も保存しないよう渡す
export function withCache(
  key,
  fetcher,
  ttl,
  shouldCache = (data) => !data?.fetchFailed,
) {
  const effectiveTtl = ttl ?? inferTtlFromKey(key);
  const cached = cache.get(key, effectiveTtl);
  if (cached !== null) {
    return Promise.resolve(cached);
  }

  if (inflightRequests.has(key)) {
    return inflightRequests.get(key);
  }

  console.log(`[Cache MISS] ${key}`);
  const promise = fetcher()
    .then((data) => {
      // 取得失敗（fetchFailed: true）の結果は保存しない。保存すると、一時的な
      // タイムアウトが「空データ」としてTTL（本日分は30分）の間、再読み込みしても
      // 直らない状態で残ってしまう。次のアクセスで実際に取得をやり直せるようにする
      if (shouldCache(data)) {
        cache.set(key, data);
      }
      return data;
    })
    .finally(() => {
      inflightRequests.delete(key);
    });
  inflightRequests.set(key, promise);
  return promise;
}

// キャッシュクリア（手動更新時に使用）
export function clearCache(key = null) {
  cache.clear(key);
}

// 配列を指定サイズごとに分割する（Supabase の in() 上限対策）
export function chunkArray(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

// fetchAllByIn のページングで使う、テーブルごとの一意な並び（主キー）。ORDER BY が無いと、PostgreSQL は
// 行の順序を保証しないため、.range() のページの境目で行が重複・欠落しうる（BOA-595。races では BOA-301 で
// 実際に起きた）。ここに無いテーブルを渡すと例外にする（並びを決めずにページングさせない）
export const FETCH_ALL_BY_IN_ORDER = Object.freeze({
  races: ["race_id"],
  race_results: ["race_id"],
  race_conditions: ["race_id"],
  race_entries: ["race_id", "boat_number"],
  exhibition_data: ["race_id", "boat_number"],
  race_start_timings: ["race_id", "boat_number"],
  race_original_exhibition_values: ["race_id", "boat_number", "kind"],
});

// fetchAllByIn が1回の in() に入れる値の数。値が多いと URL が長すぎて要求が落ちる
// （BOA-1051。2026-10-25 の本番の実測: race_id 800件・URL 約15.4KB は通り、850件・約16.3KB で fetch failed）。
// 選手単位の730日窓は1人で最大約1460走になりうるので、分けて読む（fetchAllInChunks）
const FETCH_ALL_BY_IN_CHUNK_SIZE = 300;

export async function fetchAllByIn(table, select, column, values) {
  const orderKeys = FETCH_ALL_BY_IN_ORDER[table];
  if (!orderKeys) {
    throw new Error(
      `fetchAllByIn: ${table} の並び（主キー）が FETCH_ALL_BY_IN_ORDER に無い`,
    );
  }
  // 呼び出しはどれも並びの先頭の列（race_id）で in() する（verify-fetch-all-by-in-order が検査）ので、
  // 分けて読んでつないだ結果は、分けずに読んだときと同じ並びになる
  return fetchAllInChunks(
    values,
    FETCH_ALL_BY_IN_CHUNK_SIZE,
    (chunk, from, to) => {
      let query = supabase.from(table).select(select).in(column, chunk);
      for (const key of orderKeys) query = query.order(key);
      return query.range(from, to);
    },
  );
}

/**
 * race_id（YYYY-MM-DD-VV-RR）のレースが、今日（JST）より前に行われたか。
 * 過去レースのモーター成績は、再計算せず出走表時点の公式値を出す（BOA-329、
 * 2026-09-29 ユーザー判断(c)）。今日を起点に集計するとレース後のデータが
 * 混ざり、入れ替え前のレースでは別モーターのデータになるため
 */
export function isPastRace(raceId) {
  return raceId.slice(0, 10) < getTodayJST();
}

/**
 * 会場別1コース勝率（イン崩れ指数バッジの補助値）を取得する。
 *
 * ここは**意図的に失敗を飲む数少ない例外**（.claude/rules/frontend-data-fetch.md §2）。
 * レース一覧そのものはEdge API/predictionsから取得済みで、この値は
 * バッジに添える参考値でしかない。例外を上流に流すと、補助値の失敗で
 * レース一覧全体が表示できなくなる（2026-09-23、BOA-359の対応中に
 * E2E「失敗はキャッシュされず、再読み込みで取得がやり直されて一覧が表示される」
 * が実際にこれを検知した）。
 * 失敗時は空マップを返し、バッジ側が値なしとして扱う。
 */
export async function fetchVenueWinRateMap() {
  if (!supabase) return {};
  try {
    const { data } = await supabase
      .from("venues")
      .select("code, avg_first_win_rate");
    return Object.fromEntries(
      (data || []).map((v) => [v.code, v.avg_first_win_rate]),
    );
  } catch (error) {
    console.error(
      "会場別1コース勝率(補助値)取得エラー:",
      error?.message ?? String(error),
    );
    return {};
  }
}

/**
 * PostgRESTが返す「権限が無い」エラーか。
 * PostgreSQLの insufficient_privilege（42501）のほか、GRANTが無いテーブルへの
 * アクセスは PostgREST が 401/42501 や "permission denied for table ..." で返す
 */
export function isPermissionDeniedError(error) {
  if (!error) return false;
  if (error.code === "42501") return true;
  return /permission denied/i.test(error.message ?? "");
}

/**
 * 会場・枠番のどちらか一方だけを固定し、固定していない方でグループ化した
 * 成績一覧を返す（BOA-159 Phase2、ADR-0063）。「会場だけ選んだら、その会場
 * 限定の枠番別成績を一覧で比較したい」というニーズに応える。
 * 会場・枠番どちらも未固定/どちらも固定のケースはaggregateRacerVenueBoatStats
 * を使う（本関数は「どちらか一方だけ固定」のケース専用）。
 * @param {Array} history - getRacerRaceHistory()の戻り値
 * @param {{venueCode?: number, boatNumber?: number}} fixed - 固定する軸（片方のみ指定）
 * @param {"venue"|"boat"} groupBy - グループ化する軸（固定していない方）
 * @param {string|null} raceGrade
 * @param {string|null} raceStage
 */
export function aggregateRacerCrossStats(
  history,
  fixed,
  groupBy,
  raceGrade,
  raceStage,
) {
  const groups = new Map();

  for (const row of history ?? []) {
    if (fixed.venueCode && row.venueCode !== fixed.venueCode) continue;
    if (fixed.boatNumber && row.boatNumber !== fixed.boatNumber) continue;
    if (raceGrade && row.raceGrade !== raceGrade) continue;
    if (raceStage && row.raceStage !== raceStage) continue;

    const key = groupBy === "venue" ? row.venueCode : row.boatNumber;
    if (!groups.has(key)) {
      groups.set(key, { n: 0, win: 0, top2: 0, top3: 0 });
    }
    const g = groups.get(key);
    g.n += 1;
    tallyWinPlaceShow(g, row);
  }

  return [...groups.entries()]
    .map(([key, g]) => ({
      key,
      n: g.n,
      win: g.win,
      top2: g.top2,
      top3: g.top3,
      winRate: g.n > 0 ? g.win / g.n : null,
      top2Rate: g.n > 0 ? g.top2 / g.n : null,
      top3Rate: g.n > 0 ? g.top3 / g.n : null,
    }))
    .sort((a, b) => a.key - b.key);
}
