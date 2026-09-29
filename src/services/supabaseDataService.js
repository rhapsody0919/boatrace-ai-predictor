/**
 * Supabase データサービス
 *
 * Supabaseからデータを取得し、既存のJSON形式に変換して返す
 * Phase 2: Edge API経由でCDNキャッシュを活用
 */

import { supabase } from "./supabaseClient";
import { getVolatilityLevel } from "../utils/volatilityLevel";
import { isPlaceHit, isShowHit } from "../../scripts/lib/hitCalculator.js";
import {
  extractVenueCodeFromRaceId,
  addDaysToDateString,
} from "../../scripts/lib/dateUtils.js";
import { groupIntoCurrentMeet, findMeetStartDate } from "../utils/meetGrouping";
import { deriveRaceStContext } from "../utils/stConsideration";
import {
  currentMotorGenerationStart,
  isInMotorGeneration,
} from "../utils/motorGeneration";
import { isFinalStage } from "../constants/raceStageConfig";
import { finishPositionOf } from "../components/race/basicInfoStats.js";
import { isRaceCancelled } from "../utils/raceCancellation.js";
import { competitionRank } from "../utils/competitionRank.js";
import {
  countsForSeriesScore,
  shouldUseOfficialSeries,
  prelimEndRaceIdOf,
  semifinalSlotsOf,
  splitMeetSeries,
  scoreTableFor,
  isAbsentStartRow,
} from "../components/race/seriesPoints.js";
import { PAYOUT_BET_TYPES } from "../utils/raceOutcome.js";
import {
  PRETEST_LOOKBACK_DAYS,
  pickFirstPretestByRacer,
  pickLatestPretestByRacer,
  shiftDate,
} from "../utils/pretestRows";

// 100円単位で賭けた場合の回収率(%)を返す（払戻合計 / (件数*100) * 100）。
// getRacerBoatReturnRate/getRaceRacerBoatReturnRate/aggregateRacerVenueBoatStats
// の3箇所で同じ式が使われているための共通化（BOA-159レビューで発見）
function toReturnRate(payoutSum, sampleCount) {
  return sampleCount > 0 ? (payoutSum / (sampleCount * 100)) * 100 : null;
}

// race_resultsの1行が集計対象として使えるか（中止・不成立・未確定を除外）。
// getRacerVenueStats/getRacerRaceHistoryの両方で同じ判定を使うための共通化
function isUsableRaceResult(result) {
  return (
    !!result &&
    !result.is_cancelled &&
    !result.is_no_race &&
    result.rank1 !== null
  );
}

// resultのrank1〜rank6（着順でインデックス、値が艇番）を走査し、boatNumberと
// 一致する着順（1〜6）を返す。actual_course_N（艇番でインデックス、値が
// コース）とは列の向きが逆のため流用不可——進入コースはcourseOfBoat()を使う
function findBoatColumnIndex(result, columnPrefix, boatNumber) {
  if (!result) return null;
  for (let i = 1; i <= 6; i++) {
    if (result[`${columnPrefix}${i}`] === boatNumber) return i;
  }
  return null;
}

// race_results.actual_course_1〜6（BOA-257、Kファイル由来の実進入コース）から
// 指定艇番の実際の進入コースを取り出す。バックフィル未実行の過去レースでは
// 全列NULLのため、その場合のみ艇番をそのままコース番号とみなす（暫定値、
// plan.mdの「courseColumn」抽象化に相当。BOA-257解消後の新しいレースは
// actual_course_N側が使われ、過去データはフォールバックのみで動く）。
//
// データ精度検証(2026-09-16)で発覚: バックフィル済みレースで一部の艇だけ
// actual_course_Nがnullなのは「欠場等でKファイルに進入コース記載が無い」
// ことを意味する（docs/db-migration/063参照、実データでも
// 2025-12-04-01-11等で確認済み: 3号艇のみnullで他5艇は1-5が埋まっている
// ＝3号艇欠場）。この場合に艇番へフォールバックすると、実際には走っていない
// 艇を実在のコースとして誤集計してしまう。同じレースで1件でも
// actual_course_Nが取得できていれば「バックフィル済み」と判断し、
// 艇番フォールバックはせずnull（集計除外）を返す
function courseOfBoat(result, boatNumber) {
  const actualCourse = result?.[`actual_course_${boatNumber}`];
  if (actualCourse !== null && actualCourse !== undefined) return actualCourse;

  const isBackfilled = [1, 2, 3, 4, 5, 6].some((n) => {
    const v = result?.[`actual_course_${n}`];
    return v !== null && v !== undefined;
  });
  // バックフィル済みなのにこの艇だけnull = 欠場のため集計から除外(null)。
  // 未バックフィル(全列null)の場合のみ艇番を暫定コースとして使う
  return isBackfilled ? null : boatNumber;
}

// Edge API のベースURL（本番環境では同一オリジン）
const EDGE_API_BASE = "";

/**
 * 2層キャッシュ機構（メモリ + localStorage）
 * - メモリ: 最速、セッション中のみ有効
 * - localStorage: ページリロード後も有効
 * スクレイピングは1時間に1回なので、30分間キャッシュを保持
 */
const CACHE_TTL = 30 * 60 * 1000; // 30分
// 過去レースの分析データは不変のため長期キャッシュしてよい
// （Supabase egress削減: レース単位の分析クエリは1レースあたり約0.5MBの生データを転送するため）
const PAST_RACE_CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7日

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
        } catch (e2) {
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
      } catch (e) {}
      console.log(`[Cache CLEAR] ${key}`);
    } else {
      this.memory.clear();
      this._clearAllLocalStorage();
      console.log("[Cache CLEAR] All");
    }
  },

  /**
   * localStorage内の龍神レーダーキャッシュを全削除
   */
  _clearAllLocalStorage() {
    try {
      const keys = Object.keys(localStorage).filter((k) =>
        k.startsWith(CACHE_PREFIX),
      );
      keys.forEach((k) => localStorage.removeItem(k));
    } catch (e) {}
  },

  /**
   * 古いキャッシュを削除（容量超過時）
   */
  _cleanupOldCache() {
    try {
      const entries = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(CACHE_PREFIX)) {
          const stored = localStorage.getItem(key);
          if (stored) {
            const { timestamp } = JSON.parse(stored);
            entries.push({ key, timestamp });
          }
        }
      }
      // 古い順にソートして半分削除
      entries.sort((a, b) => a.timestamp - b.timestamp);
      const toDelete = entries.slice(0, Math.ceil(entries.length / 2));
      toDelete.forEach((e) => localStorage.removeItem(e.key));
      console.log(`[Cache CLEANUP] Removed ${toDelete.length} old entries`);
    } catch (e) {}
  },
};

/**
 * キャッシュ付きデータ取得
 * 同一キーの取得が進行中の場合は同じPromiseを返す（in-flightデデュープ）。
 * プリフェッチとコンポーネントの取得が重なっても二重クエリにならない
 */
const inflightRequests = new Map();

/**
 * オッズ（race_odds・race_odds_final）のキャッシュTTL。本日以降のレースは、発走前は数分おきに、締切後は締切時オッズが
 * 後から入るため短く（3分）する（既定の30分だと、取得前に開いて得た空の結果が30分固定される）。過去レースは追加取得が
 * 無いため既定（withCache がキーの日付から推定する長いTTL）に任せる
 */
function raceOddsCacheTtl(raceId) {
  const dateMatch = String(raceId).match(/^(\d{4}-\d{2}-\d{2})-/);
  const todayJst = new Date(Date.now() + 9 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];
  return dateMatch && dateMatch[1] < todayJst ? undefined : 3 * 60 * 1000;
}

function withCache(key, fetcher, ttl) {
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
      if (!data?.fetchFailed) {
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

/**
 * getRaceMotorMaintenanceBreakdown の戻り値を作る（BOA-497）。
 *
 * exhibition_data は1レースの中で段階的に埋まる。展示前は行が無いか、当日体重・調整重量
 * だけの行（BOA-500）、会場によっては展示タイムより先に展示STだけの行（BOA-356）。
 * チルト・展示タイム・展示進入はその後に同じ行へ入る。
 * 途中の状態をキャッシュすると、値が入った後も本日分は30分、リロードしても「—」のまま出る。
 *
 *   { state: "complete", rows }                      6艇以上の行があり、欠場以外の全艇に展示タイムがある
 *   { state: "partial",  rows, fetchFailed: true }   それ以外（展示前・書き込み途中・欠測）
 * partial は fetchFailed を付けて withCache に保存させない（frontend-data-fetch.md §4）。
 * 確定後も揃わないレース（欠測・取得漏れ）は毎回取り直すが、1クエリなので許容する。
 * 行の中身は state によらず同じで、画面は rows だけを見る
 */
const FULL_FIELD_SIZE = 6;
function toMaintenanceResult(rows) {
  const complete =
    rows.length >= FULL_FIELD_SIZE &&
    rows.every((row) => row.is_absent === true || row.exhibition_time != null);
  return complete
    ? { state: "complete", rows }
    : { state: "partial", rows, fetchFailed: true };
}

/**
 * getPredictions()の取得失敗を表す空レスポンス。
 * races: [] は既存の呼び出し側（HitRaces等、`data.races || []`で読むもの）を壊さない
 * ための互換値で、「取得に成功したが開催なし（fetchFailedなし）」との区別は
 * fetchFailed: true で行う。withCache()はこの値をキャッシュしない
 */
function buildFetchFailedPredictions(date) {
  return {
    date,
    generatedAt: null,
    updatedAt: null,
    races: [],
    fetchFailed: true,
  };
}

// キャッシュクリア（手動更新時に使用）
export function clearCache(key = null) {
  cache.clear(key);
}

// 配列を指定サイズごとに分割する（Supabase の in() 上限対策）
function chunkArray(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

// Supabaseのデフォルトlimit(1000行)を超えるin()クエリを.range()でページネーションして全件取得する
// （race_id 1件につき最大6艇分の行がある race_start_timings/exhibition_data 等、
// 「in()のキー数 × 1行あたりの行数」が1000を超えうるクエリで使用する）
async function fetchAllByIn(table, select, column, values) {
  const results = [];
  const pageSize = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select(select)
      .in(column, values)
      .range(from, from + pageSize - 1);
    if (error) {
      console.error(`${table}取得エラー:`, error.message);
      break;
    }
    if (!data || data.length === 0) break;
    results.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return results;
}

/**
 * 過去レースのモータ情報を「そのレースの直前まで」で集計するときの、キャッシュの
 * キーの接尾辞（BOA-521）。末尾が race_id になるので、inferTtlFromKey() が
 * 過去レースとして長いTTLを付ける（締め切った集計は後から変わらない）
 */
function beforeKey(beforeRaceId) {
  return beforeRaceId ? `-before-${beforeRaceId}` : "";
}

/**
 * 会場の、指定日（YYYY-MM-DD、当日を含む）以降のレース（BOA-151、複数メソッドで
 * 共有するためキャッシュする）。モーターの集計は、期間の開始を現行モーターの世代で
 * 切り詰めた日（motorWindowStart）から呼ぶ。
 * beforeRaceId を渡すと、そのレースより前（race_id < beforeRaceId）に限る（BOA-521。
 * 会場を固定すれば race_id の文字列順は時系列順と一致するので、同じ日のそれより
 * 後のレースと、そのレース自身は入らない）
 */
function getRacesForVenueSince(venueCode, sinceDate, beforeRaceId = null) {
  return withCache(
    `races-for-venue-since-${venueCode}-${sinceDate}${beforeKey(beforeRaceId)}`,
    async () => {
      const races = await fetchRacesForVenueSince(
        venueCode,
        sinceDate,
        beforeRaceId?.slice(0, 10) ?? null,
      );
      return beforeRaceId === null
        ? races
        : races.filter((r) => r.race_id < beforeRaceId);
    },
  );
}

async function fetchRacesForVenueSince(venueCode, cutoff, untilDate = null) {
  if (!supabase) return [];

  // BOA-301データ精度検証(2026-09-16)で発覚: Supabaseのデフォルトlimit(1000行)
  // により、1日十数レース開催する会場では180日窓で1000件を超え(実測: 常滑180日
  // 1368件)、.range()無しでは黙って切り捨てられていた。getMotorConditionTrend等
  // 既存の呼び出し元も含め、この関数を経由する全ての集計に影響するため
  // fetchAllByIn等と同じページネーションに修正する
  const allData = [];
  const pageSize = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("races")
      .select("race_id, race_date")
      .eq("venue_code", venueCode)
      .gte("race_date", cutoff)
      .lte("race_date", untilDate ?? "9999-12-31")
      // 同じ日のレースは race_date だけでは順序が決まらず、ページ境界で行が
      // 重複・欠落しうる。race_id で一意に並べる（世代全体＝最長約1年分、
      // 徳山で2148件＝3ページを読むようになったため）
      .order("race_date")
      .order("race_id")
      .range(from, from + pageSize - 1);

    if (error) {
      console.error("races取得エラー:", error.message);
      break;
    }
    if (!data || data.length === 0) break;
    allData.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return allData;
}

/**
 * 会場の現行モーター世代の開始日（venue_motor_start_dates の最新の使用開始日）。
 * 行が無い会場・匿名に権限が無い場合（マイグレーション104が外された場合）は null
 * （＝世代が分からない）。それ以外の取得エラーは例外にする（呼び出し側で
 * 「取得失敗」と「世代不明」を出し分けるため）
 * @returns {Promise<string|null>} YYYY-MM-DD
 */
async function getMotorGenerationStart(venueCode) {
  const cached = await withCache(
    `motor-generation-start-${venueCode}`,
    async () => {
      try {
        const { data } = await supabase
          .from("venue_motor_start_dates")
          .select("start_date")
          .eq("venue_code", venueCode);
        return { generationStart: currentMotorGenerationStart(data) };
      } catch (err) {
        if (isPermissionDeniedError(err)) return { generationStart: null };
        throw err;
      }
    },
  );
  return cached.generationStart;
}

/** JSTの今日（YYYY-MM-DD） */
function jstToday() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().split("T")[0];
}

/**
 * race_id（YYYY-MM-DD-VV-RR）のレースが、今日（JST）より前に行われたか。
 * 過去レースのモーター成績は、再計算せず出走表時点の公式値を出す（BOA-329、
 * 2026-09-29 ユーザー判断(c)）。今日を起点に集計するとレース後のデータが
 * 混ざり、入れ替え前のレースでは別モーターのデータになるため
 */
function isPastRace(raceId) {
  return raceId.slice(0, 10) < jstToday();
}

/**
 * モーターの成績を「過去days日」で集計するときの開始日。現行モーターの世代
 * （使用開始日以降）で切り詰める（BOA-329）。入れ替え前の同じ番号の別モーターを
 * 混ぜないため。
 * - since: max(使用開始日, 基準日−days)。使用開始日が不明なら null（集計しない）
 * - clippedByGeneration: 使用開始日で切り詰めたか（画面で注記を出す）
 * 基準日は今日（JST）。beforeRaceId を渡すとそのレースの日付（BOA-521。過去レースの
 * ドリルダウンを「そのレースの直前まで」で集計する）
 * 使用開始日の取得エラー（権限以外）は例外にする
 * @returns {Promise<{since:string|null, generationStart:string|null, clippedByGeneration:boolean}>}
 */
async function motorWindowStart(venueCode, days, beforeRaceId = null) {
  const generationStart = await getMotorGenerationStart(venueCode);
  if (generationStart === null) {
    return { since: null, generationStart, clippedByGeneration: false };
  }
  const daysAgo = new Date(
    beforeRaceId === null
      ? Date.now() + 9 * 60 * 60 * 1000
      : `${beforeRaceId.slice(0, 10)}T00:00:00Z`,
  );
  daysAgo.setUTCDate(daysAgo.getUTCDate() - days);
  const windowStart = daysAgo.toISOString().split("T")[0];
  const clippedByGeneration = generationStart > windowStart;
  return {
    since: clippedByGeneration ? generationStart : windowStart,
    generationStart,
    clippedByGeneration,
  };
}

const NEUTRAL_EXHIBITION_DIFF_SEC = 0.02; // これ未満は展示タイムの日次ブレの範囲内とみなす
const INTERPRETATION_WINDOW_DAYS = 3; // 前後何日分の平均で比較するか

/**
 * 指定会場・モーター番号の日次系列（race_entries+exhibition_data結合、日付単位
 * dedupe済み）を取得する内部共通ヘルパー。getMotorConditionTrend/
 * getMotorPartsHistoryの両方が同じrace_entries+exhibition_data結合パターンを
 * 必要とするため共通化（BOA-221）。withCacheで結果を共有することで、両関数が
 * 同じ(venueCode, motorNumber, days)を同時に要求した場合の二重フェッチも防ぐ
 */
function fetchMotorDailySeries(
  venueCode,
  motorNumber,
  days,
  beforeRaceId = null,
) {
  return withCache(
    // v2: 期間を現行モーターの世代で切り詰め、{window, series}を返す（BOA-329）
    // v3: 部品交換・プロペラ交換が記録されたレース番号（eventRaceNos）を追加（BOA-513）
    `motor-daily-series-v3-${venueCode}-${motorNumber}-${days}${beforeKey(beforeRaceId)}`,
    async () => {
      if (!supabase) {
        console.error("Supabase client not initialized");
        return { window: null, series: [] };
      }

      const window = await motorWindowStart(venueCode, days, beforeRaceId);
      if (window.since === null) return { window, series: [] };
      const races = await getRacesForVenueSince(
        venueCode,
        window.since,
        beforeRaceId,
      );
      if (races.length === 0) return { window, series: [] };

      const raceDateById = new Map(races.map((r) => [r.race_id, r.race_date]));
      const raceIds = races.map((r) => r.race_id);
      const chunks = chunkArray(raceIds, 500);

      const results = await Promise.all(
        chunks.map((chunk) =>
          supabase
            .from("race_entries")
            .select("race_id, boat_number, motor_2rate, motor_3rate")
            .in("race_id", chunk)
            .eq("motor_number", motorNumber)
            .order("race_id"),
        ),
      );
      let entries = [];
      results.forEach(({ data, error }) => {
        if (error) {
          console.error("race_entries取得エラー:", error.message);
          return;
        }
        entries = entries.concat(data);
      });
      if (entries.length === 0) return { window, series: [] };

      const exhibitionRows = await fetchAllByIn(
        "exhibition_data",
        "race_id, boat_number, exhibition_time, propeller_change, parts_changed",
        "race_id",
        entries.map((e) => e.race_id),
      );
      const exhibitionByKey = new Map(
        exhibitionRows.map((e) => [`${e.race_id}-${e.boat_number}`, e]),
      );

      // 日付単位でdedupe。motor_2rate/motor_3rate/exhibitionTimeは節単位でほぼ
      // 一定のためrace_idで安定ソート済みの先頭を採用するが、部品交換・プロペラ
      // 交換は「同日の特定の1レースだけに記録されるイベント」のため先頭決め打ちでは
      // 取りこぼす（例: 同日中の途中交換で、交換後のレースにしか記録されない）。
      // 同日の全レース分をOR/合算してdedupeする
      const byDate = new Map();
      entries
        .map((e) => ({
          ...e,
          race_date: raceDateById.get(e.race_id),
          exhibition: exhibitionByKey.get(`${e.race_id}-${e.boat_number}`),
        }))
        .filter((e) => e.race_date)
        .sort(
          (a, b) =>
            a.race_date.localeCompare(b.race_date) ||
            a.race_id.localeCompare(b.race_id),
        )
        .forEach((e) => {
          const propellerChanged = !!e.exhibition?.propeller_change;
          const parts = e.exhibition?.parts_changed ?? null;
          // 交換が記録されたレース番号。同じ日に何Rの前の交換かを画面で示す
          // （展示は各レースの前に行うので、そのレースの前に交換したことになる。BOA-513）
          const eventRaceNo =
            propellerChanged || (parts && parts.length > 0)
              ? Number(e.race_id.slice(-2))
              : null;
          const existing = byDate.get(e.race_date);
          if (!existing) {
            byDate.set(e.race_date, {
              date: e.race_date,
              motor_2rate: e.motor_2rate,
              motor_3rate: e.motor_3rate,
              exhibitionTime: e.exhibition?.exhibition_time ?? null,
              propellerChanged,
              parts,
              eventRaceNos: eventRaceNo === null ? [] : [eventRaceNo],
            });
            return;
          }
          if (eventRaceNo !== null) existing.eventRaceNos.push(eventRaceNo);
          existing.propellerChanged =
            existing.propellerChanged || propellerChanged;
          if (parts && parts.length > 0) {
            existing.parts = [
              ...new Set([...(existing.parts ?? []), ...parts]),
            ];
          }
        });

      return { window, series: [...byDate.values()] };
    },
  );
}

/**
 * 会場コード→会場名のマッピング
 */
const VENUE_NAMES = {
  1: "桐生",
  2: "戸田",
  3: "江戸川",
  4: "平和島",
  5: "多摩川",
  6: "浜名湖",
  7: "蒲郡",
  8: "常滑",
  9: "津",
  10: "三国",
  11: "びわこ",
  12: "住之江",
  13: "尼崎",
  14: "鳴門",
  15: "丸亀",
  16: "児島",
  17: "宮島",
  18: "徳山",
  19: "下関",
  20: "若松",
  21: "芦屋",
  22: "福岡",
  23: "唐津",
  24: "大村",
};

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
async function fetchVenueWinRateMap() {
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
 * race_results 1件分（camelCaseに正規化済み）から raceData.result を組み立てる共通ヘルパー
 * （BOA-238。Edge API経路/直接クエリ経路の2箇所から呼ばれるため重複を避けるために切り出した）
 * rank4〜6・追加payout種別・人気はバックフィルしていない過去データではnullのため、
 * 各セクションはpayoutが存在する場合のみエントリを持つ設計にしている
 *
 * ⚠️ 命名注意: 引数r（DB race_results由来）のpayoutTrifecta/payoutTrioは歴史的経緯で
 * 英語名と実態が逆転している（Trifecta=3連単/Trio=3連複が正しい英語ギャンブル用語で、
 * アプリ内の他機能（TrifectaReferenceCard.jsx等）もこの正しい意味で使っている）。
 * この関数の出力オブジェクトでは同じ混乱を持ち込まないよう、実際の意味で
 * sanrenpuku（3連複）/sanrentan（3連単）という曖昧さの無いキー名で正規化する
 */
// race_conditions（天候）をUI用に整形する（BOA-304、直前情報タブの気象カード）。
// weather/wind_direction はスクレイピング側（update-race-info.js）で既に
// 日本語ラベル文字列として保存されているため、変換不要でそのまま返す
function buildWeather(conditions) {
  if (!conditions) return null;
  const {
    weather = null,
    wind_direction: windDirection = null,
    wind_speed: windSpeed = null,
    wave_height: waveHeight = null,
    temperature = null,
    water_temperature: waterTemperature = null,
    // 気象の観測時刻（BOA-358、マイグレーション069）。行に含まれる場合のみ。この直接クエリの
    // フォールバックは、列が未適用のDBで失敗しないよう、select には含めていない
    weather_observed_at: observedAt = null,
  } = conditions;
  if (
    weather === null &&
    windDirection === null &&
    windSpeed === null &&
    waveHeight === null &&
    temperature === null &&
    waterTemperature === null
  ) {
    return null;
  }
  return {
    weather,
    windDirection,
    windSpeed: windSpeed !== null ? Number(windSpeed) : null,
    waveHeight: waveHeight !== null ? Number(waveHeight) : null,
    temperature: temperature !== null ? Number(temperature) : null,
    waterTemperature:
      waterTemperature !== null ? Number(waterTemperature) : null,
    observedAt,
  };
}

/**
 * RPC の payoutRows（race_payouts の行の配列）を、結果タブの払戻表の行へ変換する（BOA-543）。
 * status: paid=通常 / special=特払 / no_amount=組番のみ（払戻金が空欄）/ no_race=不成立（返還）。
 * combination は「1-2-5」（079）。配列でなければ null（旧列へのフォールバック）
 */
function buildPayoutRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const order = new Map(PAYOUT_BET_TYPES.map((b, i) => [b.betType, i]));
  const known = rows.filter((row) => order.has(row?.betType));
  // 知らない勝式しか無い（将来の追加等）ときは、空の払戻表を出さず旧列にフォールバックさせる
  if (known.length === 0) return null;
  return known
    .map((row) => {
      const meta = PAYOUT_BET_TYPES[order.get(row.betType)];
      return {
        betType: row.betType,
        typeKey: meta.typeKey,
        separator: meta.separator,
        seq: Number(row.seq) || 1,
        boats: row.combination
          ? String(row.combination)
              .split("-")
              .map(Number)
              .filter((n) => Number.isInteger(n))
          : [],
        amount: typeof row.payout === "number" ? row.payout : null,
        status: row.payoutStatus ?? null,
        popularity: row.popularity ?? null,
      };
    })
    .sort(
      (a, b) =>
        order.get(a.betType) - order.get(b.betType) || a.seq - b.seq,
    );
}

function buildRaceResult(r) {
  if (!r || !r.rank1) return null;

  const sortAsc = (nums) => [...nums].sort((a, b) => a - b);
  const wideEntry = (amount, popularity, boats) =>
    amount
      ? { boats: sortAsc(boats), amount, popularity: popularity ?? null }
      : null;

  return {
    finished: true,
    isCancelled: r.isCancelled || false,
    // レースの成立状態と返還艇（078。109でRPCに追加）。判定は src/utils/raceOutcome.js を通す。
    // 旧フラグ isNoRace（is_no_race）は全行 false で機能していないため持たない（BOA-543）。
    // RPC未適用・078以前の行は null（＝未判定。今までどおり通常のレースとして扱う）
    raceStatus: r.raceStatus ?? null,
    refundBoats: Array.isArray(r.refundBoats) ? r.refundBoats : null,
    remark: r.remark ?? null,
    // 払戻明細（race_payouts、109でRPCに追加）。無ければ null で、結果タブは旧 payout_* 列の
    // payouts にフォールバックする（RPC未適用・過去データ・直接クエリのフォールバック経路）
    payoutRows: buildPayoutRows(r.payoutRows),
    rank1: r.rank1,
    rank2: r.rank2,
    rank3: r.rank3,
    rank4: r.rank4 ?? null,
    rank5: r.rank5 ?? null,
    rank6: r.rank6 ?? null,
    raceTimes: [
      r.raceTime1,
      r.raceTime2,
      r.raceTime3,
      r.raceTime4,
      r.raceTime5,
      r.raceTime6,
    ].map((t) => t || null),
    winningTechnique: r.winningTechnique || null,
    payouts: {
      win: r.payoutWin ? { boats: [r.rank1], amount: r.payoutWin } : null,
      place: [
        r.payoutPlace1 ? { boat: r.rank1, amount: r.payoutPlace1 } : null,
        r.payoutPlace2 ? { boat: r.rank2, amount: r.payoutPlace2 } : null,
      ].filter(Boolean),
      // DB列名はpayout_trifectaだが実態は3連複（順不同）
      sanrenpuku: r.payoutTrifecta
        ? {
            boats: sortAsc([r.rank1, r.rank2, r.rank3]),
            amount: r.payoutTrifecta,
            popularity: r.popularityTrifecta ?? null,
          }
        : null,
      // DB列名はpayout_trioだが実態は3連単（着順通り）
      sanrentan: r.payoutTrio
        ? {
            boats: [r.rank1, r.rank2, r.rank3],
            amount: r.payoutTrio,
            popularity: r.popularityTrio ?? null,
          }
        : null,
      exacta: r.payoutExacta
        ? {
            boats: [r.rank1, r.rank2],
            amount: r.payoutExacta,
            popularity: r.popularityExacta ?? null,
          }
        : null,
      quinella: r.payoutQuinella
        ? {
            boats: sortAsc([r.rank1, r.rank2]),
            amount: r.payoutQuinella,
            popularity: r.popularityQuinella ?? null,
          }
        : null,
      wide: [
        wideEntry(r.payoutWide1, r.popularityWide1, [r.rank1, r.rank2]),
        wideEntry(r.payoutWide2, r.popularityWide2, [r.rank1, r.rank3]),
        wideEntry(r.payoutWide3, r.popularityWide3, [r.rank2, r.rank3]),
      ].filter(Boolean),
    },
  };
}

/**
 * Edge APIレスポンスをフロント期待形式に変換
 * Edge API(RPC)とSupabase直接クエリの構造差異を吸収する
 */
function transformEdgeResponse(edgeData, date, venueWinRateMap = {}) {
  const transformedRaces = (edgeData.races || []).map((race) => {
    const entries = race.entries || [];
    const predictions = race.predictions || {};

    // players配列を作成（entriesからaiScoreでソート）
    const createPlayers = (modelPred, scoreField) =>
      entries
        .map((e) => ({
          number: e.number,
          name: e.name,
          racerId: e.racerId ?? null,
          grade: e.grade,
          age: e.age,
          winRate: String(e.winRate || ""),
          localWinRate: String(e.localWinRate || ""),
          global2Rate: e.global2Rate != null ? String(e.global2Rate) : null,
          motorNumber: e.motorNumber,
          motor2Rate: String(e.motor2Rate || ""),
          boatNumber: e.boatNumber,
          boat2Rate: String(e.boat2Rate || ""),
          aiScore: e[scoreField] || 0,
        }))
        .sort((a, b) => b.aiScore - a.aiScore);

    // turnPrediction を取得（standardの予測に含まれる）
    const stdPred = predictions.standard;
    const rawTurn = stdPred?.turnPrediction || null;
    const turnPrediction = rawTurn
      ? {
          ...rawTurn,
          patterns: rawTurn.patterns || [
            {
              technique: rawTurn.technique,
              winnerCourse: rawTurn.winnerCourse,
              probability: rawTurn.probability,
            },
          ],
        }
      : null;

    const raceData = {
      raceId: race.raceId,
      venue:
        race.venue || VENUE_NAMES[race.venueCode] || `会場${race.venueCode}`,
      venueCode: race.venueCode,
      raceNumber: race.raceNumber,
      startTime: race.startTime || "",
      cancellationStatus: race.cancellationStatus ?? null,
      raceGrade: race.raceGrade ?? null,
      raceTitle: race.raceTitle ?? null,
      seriesDay: race.seriesDay ?? null,
      isFinalDay: race.isFinalDay ?? null,
      raceStage: race.raceStage ?? null,
      // 直前情報タブの気象カード用（BOA-304）。get_predictions_by_date/_light RPC
      // （066マイグレーション）がbuildWeather()と同じ形で既に組み立てて返すため、
      // そのまま渡すだけでよい
      weather: race.weather ?? null,
      volatility: race.volatility
        ? {
            ...race.volatility,
            venueWinRate: venueWinRateMap[race.venueCode] ?? null,
          }
        : null,
      turnPrediction,
      racerStats: stdPred?.racerStats || null,
      exhibitionData:
        race.exhibitionData?.map((ed) => ({
          boat_number: ed.boatNumber,
          exhibition_time: ed.exhibitionTime,
          start_timing: ed.startTiming,
        })) || null,
      predictionOdds: race.predictionOdds || null,
      // モデル非依存の選手一覧（race_entriesから直接構築、DataRaceTable等がunifiedモデルの
      // predictions行が無い過去日付でも表示できるようにするため）
      players: createPlayers(null, null),
    };

    // 予測データ（モデル別）
    raceData.predictions = {};
    for (const [modelId, pred] of Object.entries(predictions)) {
      if (!pred) continue;
      // unifiedモデル専用のai_score列はDBに存在しない（旧3モデル
      // aiScoreStandard/SafeBet/UpsetFocusのみ）。従来はここが必ずaiScoreUpsetFocusに
      // フォールバックしており、unified.playersを直接参照する経路が増えた場合に
      // 穴狙いモデルの並び順が紛れ込むバグになっていた（2026-08-14修正、BOA-187）。
      // nullを渡しaiScore=0（順位付け不能）として扱う
      const scoreField =
        modelId === "standard"
          ? "aiScoreStandard"
          : modelId === "safeBet"
            ? "aiScoreSafeBet"
            : modelId === "upsetFocus"
              ? "aiScoreUpsetFocus"
              : null;
      const players = createPlayers(pred, scoreField);
      const topPickPlayer = players.find((p) => p.number === pred.topPick);
      raceData.predictions[modelId] = {
        topPick: pred.topPick,
        top3: pred.top3 || [pred.topPick],
        confidence: Number(pred.confidence) || 0,
        players,
        reasoning: generateReasoning(topPickPlayer, modelId),
      };
    }

    // unifiedモデル（AI予想モデル大規模改修）: turnPrediction/volatilityPercentile/reasonsは
    // 019マイグレーション時点でturnPredictionのみRPCから汎用的に取得できていたが、
    // volatilityPercentile/volatilityReasonsは031マイグレーション未適用の間はundefinedになる
    // （docs/db-migration/031_add_unified_fields_to_predictions_rpc.sql参照、SUPABASE_ACCESS_TOKEN
    // 失効中のため2026-08-13時点で未適用。適用後はEdge API経由でも取得できるようになる）
    const unifiedRaw = predictions.unified;
    if (unifiedRaw) {
      const rawUnifiedTurn = unifiedRaw.turnPrediction || null;
      raceData.unified = {
        topPick: unifiedRaw.topPick,
        top2nd: unifiedRaw.top3?.[1] ?? null,
        players: raceData.predictions.unified?.players || [],
        turnPrediction: rawUnifiedTurn
          ? {
              ...rawUnifiedTurn,
              patterns: rawUnifiedTurn.patterns || [
                {
                  technique: rawUnifiedTurn.technique,
                  winnerCourse: rawUnifiedTurn.winnerCourse,
                  probability: rawUnifiedTurn.probability,
                },
              ],
            }
          : null,
        volatilityPercentile: unifiedRaw.volatilityPercentile ?? null,
        volatilityPercentileIsFallback:
          unifiedRaw.volatilityPercentileIsFallback ?? null,
        volatilityReasons: unifiedRaw.volatilityReasons || [],
      };
    }

    // 結果データ（051マイグレーションでresultのjson_build_objectに追加したキーは
    // 既にcamelCaseのためbuildRaceResult()にそのまま渡せる）
    raceData.result = buildRaceResult(race.result);

    return raceData;
  });

  return {
    date,
    generatedAt: edgeData.generatedAt || new Date().toISOString(),
    updatedAt: edgeData.updatedAt || new Date().toISOString(),
    races: transformedRaces,
  };
}

/**
 * 予想根拠を生成する関数
 * 各モデルの特性に基づいた詳細な分析結果を生成
 */
function generateReasoning(topPickPlayer, modelType) {
  if (!topPickPlayer) return ["予想データなし"];

  const reasons = [];
  const number = topPickPlayer.number;
  const name = topPickPlayer.name;
  const grade = topPickPlayer.grade || "";
  const winRate = parseFloat(topPickPlayer.winRate) || 0;
  const localWinRate = parseFloat(topPickPlayer.localWinRate) || 0;
  const motor2Rate = parseFloat(topPickPlayer.motor2Rate) || 0;
  const boat2Rate = parseFloat(topPickPlayer.boat2Rate) || 0;

  if (modelType === "standard") {
    // スタンダードモデル: 選手実力・機材・コース・当地相性を総合評価
    reasons.push(`【総合分析】${number}号艇 ${name}選手を本命に選定`);

    // 選手評価
    const playerAnalysis = [];
    if (grade === "A1") playerAnalysis.push("最高峰A1級の実力");
    else if (grade === "A2") playerAnalysis.push("上位A2級の安定感");
    else if (grade === "B1") playerAnalysis.push("B1級");

    if (winRate >= 7.0)
      playerAnalysis.push(`全国勝率${topPickPlayer.winRate}はトップクラス`);
    else if (winRate >= 6.0)
      playerAnalysis.push(`全国勝率${topPickPlayer.winRate}の高水準`);
    else if (winRate >= 5.0)
      playerAnalysis.push(`全国勝率${topPickPlayer.winRate}`);

    if (playerAnalysis.length > 0) {
      reasons.push(`選手力: ${playerAnalysis.join("、")}`);
    }

    // 機材評価
    const equipAnalysis = [];
    if (motor2Rate >= 45)
      equipAnalysis.push(`モーター2連率${topPickPlayer.motor2Rate}%は上位機`);
    else if (motor2Rate >= 35)
      equipAnalysis.push(`モーター2連率${topPickPlayer.motor2Rate}%で安定`);
    if (boat2Rate >= 40)
      equipAnalysis.push(`ボート2連率${topPickPlayer.boat2Rate}%の好艇`);

    if (equipAnalysis.length > 0) {
      reasons.push(`機材力: ${equipAnalysis.join("、")}`);
    }

    // 当地・コース評価
    const courseAnalysis = [];
    if (number === 1) courseAnalysis.push("1コースの圧倒的有利を活かせる位置");
    else if (number <= 3)
      courseAnalysis.push(`${number}コースからのスタート展開に期待`);

    if (localWinRate >= 7.0)
      courseAnalysis.push(`当地勝率${topPickPlayer.localWinRate}と抜群の相性`);
    else if (localWinRate >= 5.5)
      courseAnalysis.push(
        `当地勝率${topPickPlayer.localWinRate}で水面適性あり`,
      );

    if (courseAnalysis.length > 0) {
      reasons.push(`展開: ${courseAnalysis.join("、")}`);
    }

    reasons.push("→ 独自の重み付けアルゴリズムにより総合スコア最高と判定");
  } else if (modelType === "safeBet") {
    // 本命狙いモデル: 的中率重視、1コース・A級選手・安定性を重視
    reasons.push(`【堅実分析】${number}号艇 ${name}選手を本命に選定`);

    // コース優位性（本命狙いでは最重要）
    if (number === 1) {
      reasons.push(`コース: 1号艇は統計上55%以上の1着率、最も信頼できるコース`);
    } else if (number === 2) {
      reasons.push(`コース: 2号艇から差し・まくりの展開を想定`);
    } else if (number === 3) {
      reasons.push(`コース: 3号艇からまくり展開の可能性を評価`);
    } else {
      reasons.push(`コース: ${number}号艇ながら他要素で高評価`);
    }

    // 選手の安定性評価
    const stabilityAnalysis = [];
    if (grade === "A1") {
      stabilityAnalysis.push("A1級選手は安定した成績を残す傾向が強い");
      if (winRate >= 7.0)
        stabilityAnalysis.push(`勝率${topPickPlayer.winRate}は信頼度◎`);
    } else if (grade === "A2") {
      stabilityAnalysis.push("A2級選手として堅実なレース運び");
      if (winRate >= 6.0)
        stabilityAnalysis.push(`勝率${topPickPlayer.winRate}で期待十分`);
    } else if (grade === "B1" && winRate >= 5.5) {
      stabilityAnalysis.push(
        `B1級ながら勝率${topPickPlayer.winRate}と実力上位`,
      );
    }

    if (stabilityAnalysis.length > 0) {
      reasons.push(`安定性: ${stabilityAnalysis.join("、")}`);
    }

    // 機材の信頼性
    if (motor2Rate >= 40 || boat2Rate >= 40) {
      const equipParts = [];
      if (motor2Rate >= 40)
        equipParts.push(`モーター${topPickPlayer.motor2Rate}%`);
      if (boat2Rate >= 40) equipParts.push(`ボート${topPickPlayer.boat2Rate}%`);
      reasons.push(`機材信頼度: ${equipParts.join("・")}で堅実`);
    }

    reasons.push("→ 的中率を最大化する独自ロジックにより選出");
  } else if (modelType === "upsetFocus") {
    // 穴狙いモデル: 期待値・回収率重視、過小評価されている要素を発掘
    reasons.push(`【穴馬分析】${number}号艇 ${name}選手を本命に選定`);

    // 穴要素の分析
    const upsetFactors = [];

    // アウトコースからの逆転要素
    if (number >= 4) {
      if (motor2Rate >= 40) {
        upsetFactors.push(
          `${number}号艇ながらモーター2連率${topPickPlayer.motor2Rate}%の上位機で逆転機会あり`,
        );
      } else if (motor2Rate >= 33) {
        upsetFactors.push(
          `${number}号艇でもモーター${topPickPlayer.motor2Rate}%でまくり展開を狙える`,
        );
      }
    } else if (number >= 2 && number <= 3) {
      if (localWinRate > winRate + 0.5) {
        upsetFactors.push(
          `当地勝率${topPickPlayer.localWinRate}が全国勝率を上回る隠れた適性`,
        );
      }
    }

    // 過小評価されがちな要素
    if (grade === "B1" && winRate >= 5.5) {
      upsetFactors.push(`B1級でも勝率${topPickPlayer.winRate}は侮れない実力`);
    }
    if (grade === "B1" && localWinRate >= 6.5) {
      upsetFactors.push(
        `当地勝率${topPickPlayer.localWinRate}は格上選手に匹敵`,
      );
    }
    if (grade === "A2" && number >= 3 && motor2Rate >= 38) {
      upsetFactors.push("A2級×好モーターの組み合わせで高配当狙い");
    }

    // ボート・モーターの爆発力
    if (motor2Rate >= 45) {
      upsetFactors.push(
        `モーター2連率${topPickPlayer.motor2Rate}%は上位3%の好機、波乱の主役候補`,
      );
    }

    if (upsetFactors.length > 0) {
      reasons.push(`発掘要素: ${upsetFactors.join("。")}`);
    } else {
      reasons.push(
        "発掘要素: 独自の期待値計算により高配当時の回収効率が高いと判定",
      );
    }

    // 期待値の説明
    if (number >= 4) {
      reasons.push(`配当期待: ${number}号艇の1着時は高配当が見込める`);
    } else if (grade === "B1") {
      reasons.push("配当期待: B1級選手の1着は配当妙味あり");
    }

    reasons.push("→ 回収率最大化を目指す独自アルゴリズムにより選出");
  }

  return reasons;
}

/**
 * Supabase データサービス
 */
export const supabaseDataService = {
  /**
   * レースデータを取得（races.json形式で返す）
   * Phase 2: Edge API経由でCDNキャッシュを活用
   */
  async getRaces() {
    // 今日の日付（JST）
    const now = new Date();
    const jstOffset = 9 * 60;
    const jstNow = new Date(now.getTime() + jstOffset * 60 * 1000);
    const today = jstNow.toISOString().split("T")[0];

    return withCache(`races-${today}`, async () => {
      // Phase 2: まずEdge APIを試行（CDNキャッシュ活用）
      try {
        const edgeResponse = await fetch(`${EDGE_API_BASE}/api/races/today`);
        if (edgeResponse.ok) {
          const data = await edgeResponse.json();
          if (data.success && data.data) {
            console.log("[getRaces] Edge API success");
            // Edge APIはvenuesテーブルをjoinしないためvenueWinRateを別途取得
            const venueWinRateMap = await fetchVenueWinRateMap();
            return {
              success: true,
              data: data.data.map((venue) => ({
                placeCd: venue.place_cd || venue.placeCd,
                placeName:
                  venue.place_name ||
                  venue.placeName ||
                  VENUE_NAMES[venue.place_cd || venue.placeCd],
                races: (venue.races || []).map((race) => ({
                  ...race,
                  volatility: race.volatility
                    ? {
                        ...race.volatility,
                        venueWinRate: venueWinRateMap[race.placeCd] ?? null,
                      }
                    : null,
                })),
              })),
              scrapedAt: data.scrapedAt || new Date().toISOString(),
            };
          }
        }
      } catch (edgeError) {
        console.log(
          "[getRaces] Edge API failed, falling back to direct query:",
          edgeError.message,
        );
      }

      // フォールバック: 従来のSupabase直接クエリ
      if (!supabase) {
        console.error("Supabase client not initialized");
        return { success: false, data: [], scrapedAt: null };
      }

      // 今日のレースを取得
      const { data: races, error: racesError } = await supabase
        .from("races")
        .select(
          `
        race_id,
        race_date,
        venue_code,
        race_number,
        start_time,
        race_grade,
        cancellation_status,
        race_conditions (
          series_day,
          is_final_day,
          race_title,
          race_stage
        ),
        race_entries (
          boat_number,
          player_name,
          grade,
          age,
          win_rate,
          local_win_rate,
          global_2rate,
          motor_number,
          motor_2rate,
          boat_number_id,
          boat_2rate
        )
      `,
        )
        .eq("race_date", today)
        .order("venue_code")
        .order("race_number");

      if (racesError) {
        console.error("Supabase getRaces error:", racesError.message);
        return { success: false, data: [], scrapedAt: null };
      }

      // 会場別1コース勝率（直近90日）を取得
      const venueWinRateMap = await fetchVenueWinRateMap();

      // イン崩れ指数はunifiedモデル（predictions.feature_contributions.
      // volatilityPercentile）基準に統一する（旧races.volatility_score/level は
      // generate-predictions.js（旧3モデル）由来で別ロジックのため不使用。2026-08-15）
      const { data: unifiedPreds } = await supabase
        .from("predictions")
        .select("race_id, feature_contributions")
        .eq("model_id", "unified")
        .in(
          "race_id",
          races.map((r) => r.race_id),
        );
      const volatilityByRaceId = new Map();
      // 展開予測（先頭パターンのみ）。get_today_races RPC（052マイグレーション）と
      // 同じ情報源・同じ抜き出し方に揃える
      const turnPredictionByRaceId = new Map();
      for (const pred of unifiedPreds || []) {
        const percentile = pred.feature_contributions?.volatilityPercentile;
        if (typeof percentile === "number") {
          volatilityByRaceId.set(pred.race_id, {
            percentile,
            isFallback:
              pred.feature_contributions?.volatilityPercentileIsFallback ??
              false,
            level: getVolatilityLevel(percentile),
          });
        }
        const topPattern =
          pred.feature_contributions?.turnPrediction?.patterns?.[0];
        if (topPattern) {
          turnPredictionByRaceId.set(pred.race_id, topPattern);
        }
      }

      // 会場ごとにグループ化
      const venueMap = new Map();

      for (const race of races) {
        const venueCode = race.venue_code;

        if (!venueMap.has(venueCode)) {
          venueMap.set(venueCode, {
            placeCd: venueCode,
            placeName: VENUE_NAMES[venueCode] || `会場${venueCode}`,
            races: [],
          });
        }

        // レースデータを変換
        const raceData = {
          raceNo: race.race_number,
          startTime: race.start_time?.substring(0, 5) || "",
          cancellationStatus: race.cancellation_status ?? null,
          date: race.race_date,
          placeCd: race.venue_code,
          raceGrade: race.race_grade ?? null,
          raceTitle: race.race_conditions?.race_title ?? null,
          seriesDay: race.race_conditions?.series_day ?? null,
          isFinalDay: race.race_conditions?.is_final_day ?? null,
          raceStage: race.race_conditions?.race_stage ?? null,
          volatility: volatilityByRaceId.has(race.race_id)
            ? {
                ...volatilityByRaceId.get(race.race_id),
                venueWinRate: venueWinRateMap[race.venue_code] ?? null,
              }
            : null,
          turnPrediction: turnPredictionByRaceId.get(race.race_id) ?? null,
          racers: (race.race_entries || []).map((entry) => ({
            waku: entry.boat_number,
            name: (entry.player_name || "").replace(/\s+/g, ""),
            rank: entry.grade,
            age: entry.age,
            winRate: entry.win_rate,
            localWinRate: entry.local_win_rate,
            motorNo: entry.motor_number,
            motor2Rate: entry.motor_2rate,
            boatNo: entry.boat_number_id,
            boat2Rate: entry.boat_2rate,
          })),
        };

        venueMap.get(venueCode).races.push(raceData);
      }

      return {
        success: true,
        data: Array.from(venueMap.values()),
        scrapedAt: new Date().toISOString(),
      };
    }); // withCache end
  },

  /**
   * 予測データを取得（predictions/YYYY-MM-DD.json形式で返す）
   * Phase 2: Edge API経由でCDNキャッシュを活用
   */
  async getPredictions(date, { light = false } = {}) {
    const cacheKey = light
      ? `predictions-light-${date}`
      : `predictions-${date}`;
    return withCache(cacheKey, async () => {
      // Phase 2: まずEdge APIを試行（CDNキャッシュ活用）
      const lightParam = light ? "?light=true" : "";
      try {
        const edgeResponse = await fetch(
          `${EDGE_API_BASE}/api/predictions/${date}${lightParam}`,
        );
        if (edgeResponse.ok) {
          const edgeData = await edgeResponse.json();
          if (edgeData.races && edgeData.races.length > 0) {
            console.log(
              `[getPredictions] Edge API success: ${edgeData.races.length} races${light ? " (light)" : ""}`,
            );
            // Edge APIはvenuesテーブルをjoinしないためvenueWinRateを別途取得
            const venueWinRateMap = await fetchVenueWinRateMap();
            return transformEdgeResponse(edgeData, date, venueWinRateMap);
          }
        }
      } catch (edgeError) {
        console.log(
          "[getPredictions] Edge API failed, falling back to direct query:",
          edgeError.message,
        );
      }

      // フォールバック: 従来のSupabase直接クエリ
      if (!supabase) {
        console.error("Supabase client not initialized");
        return buildFetchFailedPredictions(date);
      }

      // レースと予測と結果を取得
      const { data: races, error: racesError } = await supabase
        .from("races")
        .select(
          `
        race_id,
        race_date,
        venue_code,
        race_number,
        start_time,
        race_grade,
        cancellation_status,
        race_conditions (
          series_day,
          is_final_day,
          race_title,
          race_stage,
          weather,
          wind_direction,
          wind_speed,
          wave_height,
          temperature,
          water_temperature
        ),
        race_entries (
          boat_number,
          player_name,
          racer_id,
          grade,
          age,
          win_rate,
          local_win_rate,
          global_2rate,
          motor_number,
          motor_2rate,
          boat_number_id,
          boat_2rate,
          ai_score_standard,
          ai_score_safe_bet,
          ai_score_upset_focus
        ),
        predictions (
          model_id,
          top_pick,
          top_2nd,
          top_3rd,
          confidence,
          is_hit_win,
          is_hit_place,
          feature_contributions
        ),
        race_results (
          rank1,
          rank2,
          rank3,
          rank4,
          rank5,
          rank6,
          race_time_1,
          race_time_2,
          race_time_3,
          race_time_4,
          race_time_5,
          race_time_6,
          is_cancelled,
          race_status,
          refund_boats,
          remark,
          payout_win,
          payout_place_1,
          payout_place_2,
          payout_trifecta,
          payout_trio,
          payout_exacta,
          payout_quinella,
          payout_wide_1,
          payout_wide_2,
          payout_wide_3,
          popularity_trifecta,
          popularity_trio,
          popularity_exacta,
          popularity_quinella,
          popularity_wide_1,
          popularity_wide_2,
          popularity_wide_3,
          winning_technique
        ),
        exhibition_data (
          boat_number,
          exhibition_time,
          start_timing
        ),
        prediction_odds (
          updated_at,
          trifecta_pred_standard,
          trifecta_odds_standard,
          trio_pred_standard,
          trio_odds_standard,
          trifecta_pred_safe_bet,
          trifecta_odds_safe_bet,
          trio_pred_safe_bet,
          trio_odds_safe_bet,
          trifecta_pred_upset_focus,
          trifecta_odds_upset_focus,
          trio_pred_upset_focus,
          trio_odds_upset_focus
        )
      `,
        )
        .eq("race_date", date)
        .order("venue_code")
        .order("race_number");

      if (racesError) {
        console.error("Supabase getPredictions error:", racesError.message);
        return buildFetchFailedPredictions(date);
      }

      // JSON形式に変換
      const transformedRaces = races.map((race) => {
        const entries = race.race_entries || [];
        const predictions = race.predictions || [];
        const result = race.race_results?.[0] || race.race_results;

        // 予測データをモデル別に整理
        const standardPred = predictions.find((p) => p.model_id === "standard");
        const safeBetPred = predictions.find((p) => p.model_id === "safeBet");
        const upsetPred = predictions.find((p) => p.model_id === "upsetFocus");
        const unifiedPred = predictions.find((p) => p.model_id === "unified");

        // turnPredictionを取得（standardのfeature_contributionsに格納）
        const rawTurn =
          standardPred?.feature_contributions?.turnPrediction || null;
        const turnPrediction = rawTurn
          ? {
              ...rawTurn,
              patterns: rawTurn.patterns || [
                {
                  technique: rawTurn.technique,
                  winnerCourse: rawTurn.winnerCourse,
                  probability: rawTurn.probability,
                },
              ],
            }
          : null;

        // players配列を作成（aiScoreで降順ソート）
        const createPlayers = (pred, scoreField) =>
          entries
            .map((e) => ({
              number: e.boat_number,
              name: (e.player_name || "").replace(/\s+/g, ""),
              racerId: e.racer_id ?? null,
              grade: e.grade,
              age: e.age,
              winRate: String(e.win_rate || ""),
              localWinRate: String(e.local_win_rate || ""),
              global2Rate:
                e.global_2rate != null ? String(e.global_2rate) : null,
              motorNumber: e.motor_number,
              motor2Rate: String(e.motor_2rate || ""),
              boatNumber: e.boat_number_id,
              boat2Rate: String(e.boat_2rate || ""),
              aiScore: e[scoreField] || 0,
            }))
            .sort((a, b) => b.aiScore - a.aiScore);

        // prediction_odds（1行 or null）
        const po = race.prediction_odds ?? null;
        const predictionOdds = po
          ? {
              updatedAt: po.updated_at ?? null,
              trifectaPredStandard: po.trifecta_pred_standard ?? null,
              trifectaOddsStandard:
                po.trifecta_odds_standard != null
                  ? Number(po.trifecta_odds_standard)
                  : null,
              trioPredStandard: po.trio_pred_standard ?? null,
              trioOddsStandard:
                po.trio_odds_standard != null
                  ? Number(po.trio_odds_standard)
                  : null,
              trifectaPredSafeBet: po.trifecta_pred_safe_bet ?? null,
              trifectaOddsSafeBet:
                po.trifecta_odds_safe_bet != null
                  ? Number(po.trifecta_odds_safe_bet)
                  : null,
              trioPredSafeBet: po.trio_pred_safe_bet ?? null,
              trioOddsSafeBet:
                po.trio_odds_safe_bet != null
                  ? Number(po.trio_odds_safe_bet)
                  : null,
              trifectaPredUpsetFocus: po.trifecta_pred_upset_focus ?? null,
              trifectaOddsUpsetFocus:
                po.trifecta_odds_upset_focus != null
                  ? Number(po.trifecta_odds_upset_focus)
                  : null,
              trioPredUpsetFocus: po.trio_pred_upset_focus ?? null,
              trioOddsUpsetFocus:
                po.trio_odds_upset_focus != null
                  ? Number(po.trio_odds_upset_focus)
                  : null,
            }
          : null;

        const raceData = {
          raceId: race.race_id,
          venue: VENUE_NAMES[race.venue_code] || `会場${race.venue_code}`,
          venueCode: race.venue_code,
          raceNumber: race.race_number,
          startTime: race.start_time?.substring(0, 5) || "",
          cancellationStatus: race.cancellation_status ?? null,
          raceGrade: race.race_grade ?? null,
          raceTitle: race.race_conditions?.race_title ?? null,
          seriesDay: race.race_conditions?.series_day ?? null,
          isFinalDay: race.race_conditions?.is_final_day ?? null,
          raceStage: race.race_conditions?.race_stage ?? null,
          // イン崩れ指数（旧「荒れ度」）はunifiedモデルのvolatilityPercentile
          // （raceData.unified.volatilityPercentile）に一本化済み。旧
          // races.volatility_score/level（generate-predictions.jsが今も書き込み
          // 続けているが読み手が無い値）は使用しない（2026-08-16、ユーザー指摘）
          turnPrediction: turnPrediction,
          racerStats: standardPred?.feature_contributions?.racerStats || null,
          exhibitionData: race.exhibition_data || null,
          // 直前情報タブの気象カード用（BOA-304）。beforeinfoページのスクレイピング
          // タイミング（発走30/15/10分前）でrace_conditionsに書き込まれるため、
          // 展示タイム等と同じ「レース前は未確定」データ。全項目nullならnullにする
          weather: buildWeather(race.race_conditions),
          predictionOdds,
          // モデル非依存の選手一覧（race_entriesから直接構築、DataRaceTable等がunifiedモデルの
          // predictions行が無い過去日付でも表示できるようにするため）
          players: createPlayers(null, null),
        };

        // 予測データ（新形式: predictions）
        if (standardPred || safeBetPred || upsetPred) {
          raceData.predictions = {};

          if (standardPred) {
            const players = createPlayers(standardPred, "ai_score_standard");
            const topPickPlayer = players.find(
              (p) => p.number === standardPred.top_pick,
            );
            raceData.predictions.standard = {
              topPick: standardPred.top_pick,
              top3: [
                standardPred.top_pick,
                standardPred.top_2nd,
                standardPred.top_3rd,
              ].filter(Boolean),
              confidence: Number(standardPred.confidence) || 0,
              players,
              reasoning: generateReasoning(topPickPlayer, "standard"),
            };
          }

          if (safeBetPred) {
            const players = createPlayers(safeBetPred, "ai_score_safe_bet");
            const topPickPlayer = players.find(
              (p) => p.number === safeBetPred.top_pick,
            );
            raceData.predictions.safeBet = {
              topPick: safeBetPred.top_pick,
              top3: [
                safeBetPred.top_pick,
                safeBetPred.top_2nd,
                safeBetPred.top_3rd,
              ].filter(Boolean),
              confidence: Number(safeBetPred.confidence) || 0,
              players,
              reasoning: generateReasoning(topPickPlayer, "safeBet"),
            };
          }

          if (upsetPred) {
            const players = createPlayers(upsetPred, "ai_score_upset_focus");
            const topPickPlayer = players.find(
              (p) => p.number === upsetPred.top_pick,
            );
            raceData.predictions.upsetFocus = {
              topPick: upsetPred.top_pick,
              top3: [
                upsetPred.top_pick,
                upsetPred.top_2nd,
                upsetPred.top_3rd,
              ].filter(Boolean),
              confidence: Number(upsetPred.confidence) || 0,
              players,
              reasoning: generateReasoning(topPickPlayer, "upsetFocus"),
            };
          }
        }

        // unifiedモデル（AI予想モデル大規模改修）。feature_contributions列を丸ごと取得しているため
        // Edge API経路と異なりマイグレーション適用を待たずvolatilityPercentile/volatilityReasonsを取得できる
        if (unifiedPred) {
          const fc = unifiedPred.feature_contributions || {};
          const rawUnifiedTurn = fc.turnPrediction || null;
          raceData.unified = {
            topPick: unifiedPred.top_pick,
            top2nd: unifiedPred.top_2nd,
            players: createPlayers(unifiedPred, "ai_score_standard"),
            turnPrediction: rawUnifiedTurn
              ? {
                  ...rawUnifiedTurn,
                  patterns: rawUnifiedTurn.patterns || [
                    {
                      technique: rawUnifiedTurn.technique,
                      winnerCourse: rawUnifiedTurn.winnerCourse,
                      probability: rawUnifiedTurn.probability,
                    },
                  ],
                }
              : null,
            volatilityPercentile: fc.volatilityPercentile ?? null,
            volatilityPercentileIsFallback:
              fc.volatilityPercentileIsFallback ?? null,
            volatilityReasons: fc.volatilityReasons || [],
          };
        }

        // 結果データ（直接クエリはsnake_caseのためbuildRaceResult()向けにcamelCaseへ変換）
        raceData.result = buildRaceResult(
          result && result.rank1
            ? {
                rank1: result.rank1,
                rank2: result.rank2,
                rank3: result.rank3,
                rank4: result.rank4,
                rank5: result.rank5,
                rank6: result.rank6,
                raceTime1: result.race_time_1,
                raceTime2: result.race_time_2,
                raceTime3: result.race_time_3,
                raceTime4: result.race_time_4,
                raceTime5: result.race_time_5,
                raceTime6: result.race_time_6,
                isCancelled: result.is_cancelled,
                raceStatus: result.race_status,
                refundBoats: result.refund_boats,
                remark: result.remark,
                winningTechnique: result.winning_technique,
                payoutWin: result.payout_win,
                payoutPlace1: result.payout_place_1,
                payoutPlace2: result.payout_place_2,
                payoutTrifecta: result.payout_trifecta,
                payoutTrio: result.payout_trio,
                payoutExacta: result.payout_exacta,
                payoutQuinella: result.payout_quinella,
                payoutWide1: result.payout_wide_1,
                payoutWide2: result.payout_wide_2,
                payoutWide3: result.payout_wide_3,
                popularityTrifecta: result.popularity_trifecta,
                popularityTrio: result.popularity_trio,
                popularityExacta: result.popularity_exacta,
                popularityQuinella: result.popularity_quinella,
                popularityWide1: result.popularity_wide_1,
                popularityWide2: result.popularity_wide_2,
                popularityWide3: result.popularity_wide_3,
              }
            : null,
        );

        return raceData;
      });

      return {
        date: date,
        generatedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        races: transformedRaces,
      };
    }); // withCache end
  },

  /**
   * 精度統計データを取得（summary.json形式で返す）
   */
  async getAccuracy() {
    // 精度データは日1回更新のため24時間キャッシュ（Edge CDNと合わせる）
    const ACCURACY_TTL = 24 * 60 * 60 * 1000;
    return withCache(
      "accuracy",
      async () => {
        // Phase D: まずEdge APIを試行（CDNキャッシュ活用）
        try {
          const edgeResponse = await fetch(`${EDGE_API_BASE}/api/accuracy`);
          if (edgeResponse.ok) {
            const edgeData = await edgeResponse.json();
            if (edgeData.models) {
              console.log("[getAccuracy] Edge API success");
              return edgeData;
            }
          }
        } catch (edgeError) {
          console.log(
            "[getAccuracy] Edge API failed, falling back to direct query:",
            edgeError.message,
          );
        }

        // フォールバック: 従来のSupabase直接クエリ
        if (!supabase) {
          console.error("Supabase client not initialized");
          return { lastUpdated: null, models: {} };
        }

        // 今月の日付範囲を計算
        const now = new Date();
        const jstOffset = 9 * 60;
        const jstNow = new Date(now.getTime() + jstOffset * 60 * 1000);
        const thisYear = jstNow.getUTCFullYear();
        const thisMonth = jstNow.getUTCMonth() + 1;
        const thisMonthStart = `${thisYear}-${String(thisMonth).padStart(2, "0")}-01`;
        const thisMonthEnd = `${thisYear}-${String(thisMonth).padStart(2, "0")}-31`;

        // 過去30日の開始日を計算
        const thirtyDaysAgo = new Date(
          jstNow.getTime() - 30 * 24 * 60 * 60 * 1000,
        );
        const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split("T")[0];

        // モデル情報を取得
        const { data: models, error: modelsError } = await supabase
          .from("models")
          .select(
            "model_id, display_name, total_predictions, hit_rate_win, hit_rate_place, hit_rate_trifecta, hit_rate_trio, recovery_rate_win, recovery_rate_place, recovery_rate_trifecta, recovery_rate_trio",
          );

        if (modelsError) {
          console.error("Supabase getAccuracy error:", modelsError.message);
          return { lastUpdated: null, models: {} };
        }

        // ページネーション付きでデータを取得するヘルパー関数
        // race_id形式: YYYY-MM-DD-VV-RR なので、endDateには末尾を追加して正しく比較
        const fetchAllPredictions = async (startDate, endDate) => {
          let allData = [];
          let from = 0;
          const pageSize = 1000;

          // endDateをrace_id形式で比較できるよう調整（例: 2025-12-31 → 2025-12-31-99-99）
          const adjustedEndDate = endDate ? `${endDate}-99-99` : null;

          while (true) {
            let query = supabase
              .from("predictions")
              .select(
                "race_id, model_id, is_hit_win, is_hit_place, is_hit_trifecta, is_hit_trio, payout_win, payout_place, payout_trifecta, payout_trio",
              )
              .gte("race_id", startDate)
              .not("is_hit_win", "is", null)
              .range(from, from + pageSize - 1);

            if (adjustedEndDate) {
              query = query.lte("race_id", adjustedEndDate);
            }

            const { data: page, error } = await query;

            if (error || !page || page.length === 0) break;
            allData = allData.concat(page);
            if (page.length < pageSize) break;
            from += pageSize;
          }

          return allData;
        };

        // 過去6ヶ月分の月別データを取得するためのヘルパー
        const getMonthRange = (year, month) => {
          const start = `${year}-${String(month).padStart(2, "0")}-01`;
          const end = `${year}-${String(month).padStart(2, "0")}-31`;
          return { start, end, year, month };
        };

        const getPreviousMonth = (year, month) => {
          if (month === 1) {
            return { year: year - 1, month: 12 };
          }
          return { year, month: month - 1 };
        };

        // 過去6ヶ月分の月情報を生成
        const monthsToFetch = [];
        let currentYear = thisYear;
        let currentMonth = thisMonth;

        for (let i = 0; i < 6; i++) {
          const prev = getPreviousMonth(currentYear, currentMonth);
          currentYear = prev.year;
          currentMonth = prev.month;
          monthsToFetch.push(getMonthRange(currentYear, currentMonth));
        }

        // 過去7日分・過去90日分の開始日
        const sevenDaysAgo = new Date(
          jstNow.getTime() - 7 * 24 * 60 * 60 * 1000,
        );
        const sevenDaysAgoStr = sevenDaysAgo.toISOString().split("T")[0];

        const ninetyDaysAgo = new Date(
          jstNow.getTime() - 90 * 24 * 60 * 60 * 1000,
        );
        const ninetyDaysAgoStr = ninetyDaysAgo.toISOString().split("T")[0];

        // 2026-08-15修正（BOA-193）: 以下9件のfetchAllPredictions呼び出しは互いに
        // 独立したデータ取得なのに直列awaitされており、predictionsテーブルの
        // 行数増加に伴って/accuracyの応答が数十秒〜1分以上に悪化していた。
        // Promise.allで並列化し、体感速度を「合計時間」から「最長1件分の時間」に短縮する
        const [
          thisMonthPredictions,
          monthlyResults,
          recentPredictions,
          allPredictions,
        ] = await Promise.all([
          fetchAllPredictions(thisMonthStart, thisMonthEnd),
          Promise.all(
            monthsToFetch.map((monthInfo) =>
              fetchAllPredictions(monthInfo.start, monthInfo.end),
            ),
          ),
          fetchAllPredictions(sevenDaysAgoStr, null),
          fetchAllPredictions(ninetyDaysAgoStr, null),
        ]);

        // 各月の予測データをマップ化
        const monthlyPredictionsMap = {};
        monthsToFetch.forEach((monthInfo, i) => {
          const key = `${monthInfo.year}-${String(monthInfo.month).padStart(2, "0")}`;
          monthlyPredictionsMap[key] = {
            predictions: monthlyResults[i],
            year: monthInfo.year,
            month: monthInfo.month,
          };
        });

        // 先月のデータ（互換性のため）
        const lastMonthKey = `${monthsToFetch[0].year}-${String(monthsToFetch[0].month).padStart(2, "0")}`;
        const lastMonthPredictions =
          monthlyPredictionsMap[lastMonthKey]?.predictions || [];

        // race_idから日付を抽出するヘルパー関数
        const extractDate = (raceId) => raceId.substring(0, 10);

        // race_idから会場コードを抽出するヘルパー関数 (YYYY-MM-DD-VV-RR形式)
        const extractVenueCode = (raceId) =>
          parseInt(raceId.substring(11, 13), 10);

        // 統計を計算する関数
        const calculateStats = (predictions) => {
          if (!predictions || predictions.length === 0) {
            return {
              totalRaces: 0,
              topPickHitRate: 0,
              topPickPlaceRate: 0,
              top3HitRate: 0,
              top3IncludedRate: 0,
              actualRecovery: {
                win: { recoveryRate: 0 },
                place: { recoveryRate: 0 },
                trifecta: { recoveryRate: 0 },
                trio: { recoveryRate: 0 },
              },
            };
          }

          const total = predictions.length;
          const winHits = predictions.filter((p) => p.is_hit_win).length;
          const placeHits = predictions.filter((p) => p.is_hit_place).length;
          const trifectaHits = predictions.filter(
            (p) => p.is_hit_trifecta,
          ).length;
          const trioHits = predictions.filter((p) => p.is_hit_trio).length;

          const winPayout = predictions.reduce(
            (sum, p) => sum + (p.payout_win || 0),
            0,
          );
          const placePayout = predictions.reduce(
            (sum, p) => sum + (p.payout_place || 0),
            0,
          );
          const trifectaPayout = predictions.reduce(
            (sum, p) => sum + (p.payout_trifecta || 0),
            0,
          );
          const trioPayout = predictions.reduce(
            (sum, p) => sum + (p.payout_trio || 0),
            0,
          );

          return {
            totalRaces: total,
            topPickHitRate: winHits / total,
            topPickPlaceRate: placeHits / total,
            top3HitRate: trifectaHits / total,
            top3IncludedRate: trioHits / total,
            actualRecovery: {
              win: { recoveryRate: winPayout / (total * 100) },
              place: { recoveryRate: placePayout / (total * 100) },
              trifecta: { recoveryRate: trifectaPayout / (total * 100) },
              trio: { recoveryRate: trioPayout / (total * 100) },
            },
          };
        };

        // 日別履歴を計算する関数
        const calculateDailyHistory = (predictions, modelId) => {
          const modelPreds =
            predictions?.filter((p) => p.model_id === modelId) || [];
          const dateMap = new Map();

          for (const pred of modelPreds) {
            const date = extractDate(pred.race_id);
            if (!dateMap.has(date)) {
              dateMap.set(date, []);
            }
            dateMap.get(date).push(pred);
          }

          return Array.from(dateMap.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([date, preds]) => ({
              date,
              ...calculateStats(preds),
            }));
        };

        // 会場別統計を計算する関数
        const calculateByVenue = (predictions, modelId) => {
          const modelPreds =
            predictions?.filter((p) => p.model_id === modelId) || [];
          const venueMap = new Map();

          for (const pred of modelPreds) {
            const venueCode = extractVenueCode(pred.race_id);
            if (!venueMap.has(venueCode)) {
              venueMap.set(venueCode, []);
            }
            venueMap.get(venueCode).push(pred);
          }

          const byVenue = {};
          for (const [venueCode, preds] of venueMap) {
            byVenue[venueCode] = {
              overall: calculateStats(preds),
            };
          }

          return byVenue;
        };

        // 各モデルの統計を構築
        const modelStats = {};
        const modelIds = ["standard", "safeBet", "upsetFocus"];

        for (const modelId of modelIds) {
          const modelInfo = models?.find((m) => m.model_id === modelId);
          const thisMonthPreds =
            thisMonthPredictions?.filter((p) => p.model_id === modelId) || [];
          const thisMonthStats = calculateStats(thisMonthPreds);
          const lastMonthPreds =
            lastMonthPredictions?.filter((p) => p.model_id === modelId) || [];
          const lastMonthStats = calculateStats(lastMonthPreds);
          const dailyHistory = calculateDailyHistory(
            recentPredictions,
            modelId,
          );
          const byVenue = calculateByVenue(allPredictions, modelId);

          // 月別履歴を構築（過去6ヶ月分）
          const monthlyHistory = Object.entries(monthlyPredictionsMap)
            .map(([key, data]) => {
              const monthPreds =
                data.predictions?.filter((p) => p.model_id === modelId) || [];
              const stats = calculateStats(monthPreds);
              return {
                year: data.year,
                month: data.month,
                ...stats,
              };
            })
            .filter((m) => m.totalRaces > 0)
            .sort((a, b) => {
              if (a.year !== b.year) return b.year - a.year;
              return b.month - a.month;
            });

          modelStats[modelId] = {
            overall: {
              totalRaces: modelInfo?.total_predictions || 0,
              finishedRaces: modelInfo?.total_predictions || 0,
              topPickHitRate: modelInfo?.hit_rate_win || 0,
              topPickPlaceRate: modelInfo?.hit_rate_place || 0,
              top3HitRate: modelInfo?.hit_rate_trifecta || 0,
              top3ExactHitRate: modelInfo?.hit_rate_trio || 0,
              actualRecovery: {
                win: { recoveryRate: modelInfo?.recovery_rate_win || 0 },
                place: { recoveryRate: modelInfo?.recovery_rate_place || 0 },
                trifecta: {
                  recoveryRate: modelInfo?.recovery_rate_trifecta || 0,
                },
                trio: { recoveryRate: modelInfo?.recovery_rate_trio || 0 },
              },
            },
            thisMonth: {
              year: thisYear,
              month: thisMonth,
              ...thisMonthStats,
            },
            lastMonth: {
              year: monthsToFetch[0].year,
              month: monthsToFetch[0].month,
              ...lastMonthStats,
            },
            monthlyHistory,
            dailyHistory,
            byVenue,
          };
        }

        // accuracy_cache から volatilityStats を取得（フォールバックパスでも表示できるよう）
        let volatilityStats = null;
        try {
          const { data: cacheRow } = await supabase
            .from("accuracy_cache")
            .select("data")
            .eq("key", "accuracy_summary")
            .single();
          volatilityStats = cacheRow?.data?.volatilityStats ?? null;
        } catch {
          // 取得失敗時は非表示のまま
        }

        return {
          lastUpdated: new Date().toISOString(),
          volatilityStats,
          models: modelStats,
        };
      },
      ACCURACY_TTL,
    ); // withCache end
  },

  /**
   * 予想データが存在する日付リストを取得
   * @param {number} days - 過去何日分を取得するか
   */
  async getAvailableDates(days = 90) {
    return withCache(`availableDates-${days}`, async () => {
      if (!supabase) {
        console.error("Supabase client not initialized");
        return [];
      }

      // 日付範囲を計算
      const today = new Date();
      const jstOffset = 9 * 60;
      const jstToday = new Date(today.getTime() + jstOffset * 60 * 1000);
      const startDate = new Date(
        jstToday.getTime() - days * 24 * 60 * 60 * 1000,
      );
      const startDateStr = startDate.toISOString().split("T")[0];

      // 日付ごとのレースを取得（ページネーションで1000行制限を回避）
      const allData = [];
      let offset = 0;
      const pageSize = 1000;

      while (true) {
        const { data, error } = await supabase
          .from("races")
          .select("race_date")
          .gte("race_date", startDateStr)
          .order("race_date", { ascending: false })
          .range(offset, offset + pageSize - 1);

        if (error) {
          console.error("Supabase getAvailableDates error:", error.message);
          break;
        }
        if (!data || data.length === 0) break;

        allData.push(...data);
        offset += pageSize;

        if (data.length < pageSize) break;
      }

      // ユニークな日付を抽出
      const uniqueDates = [...new Set(allData.map((r) => r.race_date))];
      return uniqueDates;
    }); // withCache end
  },

  /**
   * レース履歴サマリーを取得（日付ごとのモデル別的中統計）
   * /races ページ用。従来の N+1 フェッチを 1 リクエストに集約
   * @param {number} days - 過去何日分を取得するか（デフォルト 90）
   */
  async getRaceHistorySummary(days = 90) {
    return withCache(`raceHistorySummary-${days}`, async () => {
      // Phase 1: Edge API を試行
      try {
        const edgeResponse = await fetch(
          `${EDGE_API_BASE}/api/race-history/summary?days=${days}`,
        );
        if (edgeResponse.ok) {
          const edgeData = await edgeResponse.json();
          if (edgeData.days) {
            console.log("[getRaceHistorySummary] Edge API success");
            return edgeData;
          }
        }
      } catch (edgeError) {
        console.log(
          "[getRaceHistorySummary] Edge API failed, falling back:",
          edgeError.message,
        );
      }

      // フォールバック: race_history_cache テーブルから直接取得（RPC廃止）
      if (!supabase) {
        console.error("Supabase client not initialized");
        return { days: [] };
      }

      const { data: rows, error } = await supabase
        .from("race_history_cache")
        .select("data")
        .eq("key", "race_history_summary_90")
        .single();

      if (error) {
        console.error("Supabase race_history_cache error:", error.message);
        return { days: [] };
      }
      return rows?.data || { days: [] };
    });
  },

  /**
   * 会場固有の水面特性（水質・イン/アウト傾向のクラスタ分類）を取得する
   * venuesテーブルはモデル調整（softmax-temperature-calibration）用に
   * water_type/clusterを保持しているが、フロントエンドでは未使用だった
   * @param {number} venueCode - 会場コード（1-24）
   * @returns {Promise<{ waterType: string, cluster: string } | null>}
   */
  getVenueCharacteristics(venueCode) {
    return withCache(`venue-characteristics-${venueCode}`, async () => {
      if (!supabase) {
        console.error("Supabase client not initialized");
        return null;
      }

      const { data, error } = await supabase
        .from("venues")
        .select("water_type, cluster")
        .eq("code", venueCode)
        .maybeSingle();

      if (error) {
        console.error("venues取得エラー:", error.message);
        return null;
      }
      if (!data) return null;

      return { waterType: data.water_type, cluster: data.cluster };
    });
  },

  /**
   * 枠番別の1着率の全国平均（24会場プール値）を取得する
   * outcome_distributionは会場ごとの行を持つが、first_boatでgroup byして
   * count_90daysを合算すれば1クエリで全国平均が算出できる（24会場を
   * 個別に取得する必要はない）。会場を問わず同じ値のためracer_id等と
   * 違い引数を取らず、キャッシュキーも固定にする
   */
  getNationalAverageOutcomeDistribution() {
    return withCache("national-average-outcome-distribution", async () => {
      if (!supabase) {
        console.error("Supabase client not initialized");
        return null;
      }

      // outcome_distributionは2500行超あり、Supabaseのデフォルトlimit(1000行)を
      // 超えるため.range()でページネーションして全件取得する必要がある
      // （2026-09-07、ページネーション漏れで全国平均が偏っていたバグを発見・修正）
      const data = [];
      const pageSize = 1000;
      let from = 0;
      while (true) {
        const { data: page, error } = await supabase
          .from("outcome_distribution")
          .select("first_boat, count_90days")
          .range(from, from + pageSize - 1);

        if (error) {
          console.error(
            "outcome_distribution(全国平均)取得エラー:",
            error.message,
          );
          return null;
        }
        if (!page || page.length === 0) break;
        data.push(...page);
        if (page.length < pageSize) break;
        from += pageSize;
      }
      if (data.length === 0) return null;

      const countByBoat = {};
      let total = 0;
      data.forEach((row) => {
        countByBoat[row.first_boat] =
          (countByBoat[row.first_boat] ?? 0) + (row.count_90days ?? 0);
        total += row.count_90days ?? 0;
      });
      if (total === 0) return null;

      const rateByBoat = {};
      Object.entries(countByBoat).forEach(([boat, count]) => {
        rateByBoat[boat] = (count / total) * 100;
      });
      return rateByBoat;
    });
  },

  /**
   * 出目分布データを取得（会場別の3連単パターン）
   * @param {number} venueCode - 会場コード（1-24）
   * @returns {Promise<Object>} - { venue_code, venue_name, total_races, last_updated, data: { first_boat: [...] } }
   */
  getOutcomeDistribution(venueCode) {
    return withCache(`outcome-distribution-${venueCode}`, async () => {
      // Phase 1: Edge API を試行（CDNキャッシュ活用）
      try {
        const edgeResponse = await fetch(
          `${EDGE_API_BASE}/api/outcome-distribution?venue_code=${venueCode}`,
        );
        if (edgeResponse.ok) {
          const edgeData = await edgeResponse.json();
          if (edgeData.venue_code) {
            console.log("[getOutcomeDistribution] Edge API success");
            return edgeData;
          }
        }
      } catch (edgeError) {
        console.log(
          "[getOutcomeDistribution] Edge API failed, falling back:",
          edgeError.message,
        );
      }

      // フォールバック: Supabase 直接クエリ
      if (!supabase) {
        console.error("Supabase client not initialized");
        return {
          venue_code: venueCode,
          venue_name: "",
          total_races: 0,
          last_updated: null,
          data: {},
        };
      }

      const { data, error } = await supabase
        .from("outcome_distribution")
        .select("*")
        .eq("venue_code", venueCode)
        .order("first_boat")
        .order("count_90days", { ascending: false });

      if (error) {
        console.error("Supabase getOutcomeDistribution error:", error.message);
        return {
          venue_code: venueCode,
          venue_name: "",
          total_races: 0,
          last_updated: null,
          data: {},
        };
      }

      if (!data || data.length === 0) {
        return {
          venue_code: venueCode,
          venue_name: "",
          total_races: 0,
          last_updated: null,
          data: {},
        };
      }

      // 1着別にグループ化
      const outcomesData = {};
      let totalRaces = 0;
      let lastUpdated = null;

      data.forEach((row) => {
        const firstBoat = row.first_boat;
        if (!outcomesData[firstBoat]) {
          outcomesData[firstBoat] = [];
        }

        outcomesData[firstBoat].push({
          second_boat: row.second_boat,
          third_boat: row.third_boat,
          count: row.count_90days,
          probability: row.probability,
          avg_payout: row.avg_payout,
        });

        if (!totalRaces) {
          totalRaces = row.total_races;
          lastUpdated = row.last_updated;
        }
      });

      // VENUE_NAMES マッピング
      const VENUE_NAMES = {
        1: "桐生",
        2: "戸田",
        3: "江戸川",
        4: "平和島",
        5: "多摩川",
        6: "浜名湖",
        7: "蒲郡",
        8: "常滑",
        9: "津",
        10: "三国",
        11: "びわこ",
        12: "住之江",
        13: "尼崎",
        14: "鳴門",
        15: "丸亀",
        16: "児島",
        17: "宮島",
        18: "徳山",
        19: "下関",
        20: "若松",
        21: "芦屋",
        22: "福岡",
        23: "唐津",
        24: "大村",
      };

      return {
        venue_code: venueCode,
        venue_name: VENUE_NAMES[venueCode] || "",
        total_races: totalRaces,
        last_updated: lastUpdated,
        data: outcomesData,
      };
    });
  },

  /**
   * 会場別・枠番別の決まり手（逃げ/差し/まくり等）出現割合を取得する（BOA-150）
   * v1ではEdge API連携は行わず、Supabase直接クエリのみ
   */
  getWinningTechniqueStats(venueCode) {
    return withCache(`winning-technique-stats-${venueCode}`, async () => {
      if (!supabase) {
        console.error("Supabase client not initialized");
        return {
          venue_code: venueCode,
          venue_name: "",
          last_updated: null,
          data: {},
        };
      }

      const { data, error } = await supabase
        .from("winning_technique_stats")
        .select("*")
        .eq("venue_code", venueCode)
        .order("boat_number")
        .order("percentage", { ascending: false });

      if (error) {
        console.error(
          "Supabase getWinningTechniqueStats error:",
          error.message,
        );
        return {
          venue_code: venueCode,
          venue_name: "",
          last_updated: null,
          data: {},
        };
      }

      if (!data || data.length === 0) {
        return {
          venue_code: venueCode,
          venue_name: "",
          last_updated: null,
          data: {},
        };
      }

      // 枠番別にグループ化
      const techniqueData = {};
      let lastUpdated = null;

      data.forEach((row) => {
        const boatNumber = row.boat_number;
        if (!techniqueData[boatNumber]) {
          techniqueData[boatNumber] = {
            total_races: row.total_races,
            techniques: [],
          };
        }

        techniqueData[boatNumber].techniques.push({
          technique: row.winning_technique,
          count: row.count_90days,
          percentage: row.percentage,
        });

        if (!lastUpdated) {
          lastUpdated = row.last_updated;
        }
      });

      const VENUE_NAMES = {
        1: "桐生",
        2: "戸田",
        3: "江戸川",
        4: "平和島",
        5: "多摩川",
        6: "浜名湖",
        7: "蒲郡",
        8: "常滑",
        9: "津",
        10: "三国",
        11: "びわこ",
        12: "住之江",
        13: "尼崎",
        14: "鳴門",
        15: "丸亀",
        16: "児島",
        17: "宮島",
        18: "徳山",
        19: "下関",
        20: "若松",
        21: "芦屋",
        22: "福岡",
        23: "唐津",
        24: "大村",
      };

      return {
        venue_code: venueCode,
        venue_name: VENUE_NAMES[venueCode] || "",
        last_updated: lastUpdated,
        data: techniqueData,
      };
    });
  },

  /**
   * 本日レースが開催されている会場一覧を取得する（BOA-151）
   * races テーブルは当日分のカードしか保持していないため、モーター調子の
   * レース単位表示は「本日開催中の会場」に限定する
   */
  getVenuesWithTodaysRaces() {
    const now = new Date();
    const jstOffset = 9 * 60;
    const jstNow = new Date(now.getTime() + jstOffset * 60 * 1000);
    const today = jstNow.toISOString().split("T")[0];

    return withCache(`venues-with-races-${today}`, async () => {
      if (!supabase) {
        console.error("Supabase client not initialized");
        return [];
      }

      const { data, error } = await supabase
        .from("races")
        .select("venue_code")
        .eq("race_date", today);

      if (error) {
        console.error("races取得エラー:", error.message);
        return [];
      }

      return [...new Set(data.map((r) => r.venue_code))].sort((a, b) => a - b);
    });
  },

  /**
   * 指定会場の本日のレース一覧を取得する（BOA-151）
   */
  getTodaysRacesForVenue(venueCode) {
    const now = new Date();
    const jstOffset = 9 * 60;
    const jstNow = new Date(now.getTime() + jstOffset * 60 * 1000);
    const today = jstNow.toISOString().split("T")[0];

    return withCache(`todays-races-${venueCode}-${today}`, async () => {
      if (!supabase) {
        console.error("Supabase client not initialized");
        return [];
      }

      const { data, error } = await supabase
        .from("races")
        .select("race_id, race_number, start_time")
        .eq("venue_code", venueCode)
        .eq("race_date", today)
        .order("race_number");

      if (error) {
        console.error("races取得エラー:", error.message);
        return [];
      }
      return data ?? [];
    });
  },

  /**
   * 指定レースの枠番別・公式集計済み成績（全国/当地の勝率・2連率・3連率）を
   * 取得する（BOA-306、レース詳細ページ「基本情報」タブ）。
   * これらはboatrace.jp側で既に算出済みの「今期」公式値であり、自社で
   * 期間集計をやり直す必要が無い最も正確な値のため、期間フィルタが
   * 「今期」かつグレード条件無し（=全レース）の場合はこの値をそのまま使う。
   * グレード・期間で絞り込む場合は別途getRacerScopedRaceStatsで自社集計する
   */
  getRaceEntryOfficialRatesBreakdown(raceId) {
    // v2: F数バッジ（phase a T5-3）のために f_count / l_count を足したので版を上げる。
    // **v2 は raceId より前に置く**。後ろに付けると inferTtlFromKey の
    // 「末尾がYYYY-MM-DD-VV-RR」パターンにマッチしなくなり、過去レースの
    // 7日TTLが30分に落ちる
    return withCache(`race-entry-official-rates-v2-${raceId}`, async () => {
      if (!supabase) {
        console.error("Supabase client not initialized");
        return [];
      }

      const { data, error } = await supabase
        .from("race_entries")
        .select(
          "boat_number, win_rate, local_win_rate, global_2rate, local_2rate, global_3rate, local_3rate, f_count, l_count",
        )
        .eq("race_id", raceId)
        .order("boat_number");

      if (error) {
        console.error(
          "race_entries(公式勝率/連対率)取得エラー:",
          error.message,
        );
        return [];
      }
      return data ?? [];
    });
  },

  /**
   * 指定レースの枠番別モーター調子（2連率/3連率）を取得する（BOA-151）
   * 「このレースのどの艇のモーターが調子いいか」を直接示す
   * venueCodeを渡すと各艇のモーターの機力指数（BOA-265）も合わせて取得する
   *
   * ## 前検タイムと「節時点の公式2連率」（BOA-451 / FR-4a）
   *
   * この関数が返す `motor_2rate` は**選択期間（過去90日・直近1ヶ月）で再計算した値**に
   * 差し替えている（下の注記）。一方、出走表に印刷され他サイトにも載っている
   * 「モーター2連対率」は**節の開始時点（前検日）の公式値**で、両者は別物。
   * 同じタブの中で見比べられないと「なぜ基本情報タブと数字が違うのか」になるため、
   * 差し替え前の公式値を `official_2rate` として残す（**追加クエリ0本**。
   * `race_entries` から既に取っている値をそのまま持ち回るだけ）。
   *
   * 前検タイム（`pretest_time` / `pretest_rank`）は機力の**起点**で、
   * `motor_pretest_stats` から**1クエリ**で節の全選手分を引く。
   *
   * 行の選び方（実測で決めた。2026-09-28）:
   *   同じ会場・同じ選手で `race_date <= 表示レースの日付` かつ `>= 日付 - 6日` の
   *   **最新の行**を採る。理由は3つとも実データで確かめた。
   *     1. 節の中で `pretest_time` / `pretest_rank` が変わる例は **0件**
   *        （31,268の連続区間すべてで単一値）。どの行を採っても値は同じ
   *     2. 6日ルックバックで、**その日に走る選手について前の節の行を引く例は0件**
   *        （2026年1月〜9月の出走241,427件。採った行のモーター番号が
   *        `race_entries.motor_number` と食い違う例も9月の24,842件で0件）。
   *        返るMap自体には「前の節にしか出ていない選手」の行が残ることはあるが、
   *        引き当てには使われない（詳細は `src/utils/pretestRows.js`）
   *     3. 日付完全一致だけだと当たるのは30.9%（節の中の一部の日にしか行が無い）。
   *        6日ルックバックで94.6%に上がる
   *   今節タブ（`getMeetScoreboard`）は「節の最も古い行」を採るが、1の理由で
   *   両者は必ず同じ値になる。`npm run verify:pretest-row-pick` がこの不変条件を守る
   *
   * ## 過去レースは出走表時点の公式値（BOA-329、2026-09-29 ユーザー判断(c)）
   *
   * 再計算（機力指数・期間の2連率）は「今日から遡るN日」の集計なので、過去レースに
   * 使うとレース後のデータが混ざり、入れ替え前のレースでは別モーターの成績になる。
   * そのため過去レース（race_idの日付 < 今日JST）では再計算をせず、
   * - motor_2rate / motor_3rate は race_entries の値（そのレース時点の公式値）のまま
   * - power_index は null（公式に相当する値が無い。画面は「—」と注記）
   * - 優出・優勝・1着率は、レース日以前で最新の venue_motor_stats（公式サイトの
   *   その時点のスナップショット）。無ければ null
   * とし、rate_source: "official" を付ける（当日以降は "recalc"）。
   * 当日のレースの再計算は、期間を現行モーターの世代で切り詰める（getMotorPowerIndex）
   */
  getRaceMotorBreakdown(raceId, venueCode = null, days = 90) {
    const past = isPastRace(raceId);
    return withCache(
      // raceIdを末尾に置く: inferTtlFromKey()は末尾の「YYYY-MM-DD-会場-レース番号」
      // パターンで過去レースを検知し7日キャッシュを付与する。venueCode/daysを
      // 末尾に付けるとこのパターンにマッチしなくなり、過去レースでも30分キャッシュに
      // 格下げされてしまうため、raceIdより前に置く。
      // v2: motor_2rate/3rateを選択期間に応じた値に差し替えるよう変更(BOA-283)。
      // v3: 優出回数・優勝回数・1着率を追加(BOA-264追加調査、日和比較)。
      // v4: 前検タイム・前検順位・公式2連率（節時点）を追加(BOA-451)。
      // 旧キーのままだと古いキャッシュが新フィールド無しの形状のまま返る
      // （過去レースは7日TTLなので、上げ忘れると1週間「前検」列が出ない）
      // v5: 過去レースは公式値（rate_source）、当日は世代で切り詰め（BOA-329）。
      // 過去/当日をキーに含める: 当日に保存した再計算の値が、日付が変わって
      // 過去レース扱い（7日TTL）になった後も読まれ続けないようにする
      // v6: 当日のレースの行に sample_count（初下ろしの判定）を追加（BOA-513）
      // v7: 当日のレースの行に official_3rate（「集計前」の判定）を追加
      // v8: 過去レースの行にも official_3rate を追加し、当日の機力指数を
      //     「このレースの直前まで」にした（BOA-557）
      `race-motor-breakdown-v8-${past ? "official" : "recalc"}-${venueCode}-${days}-${raceId}`,
      async () => {
        if (!supabase) {
          console.error("Supabase client not initialized");
          return [];
        }

        const { data, error } = await supabase
          .from("race_entries")
          .select(
            "boat_number, player_name, racer_id, motor_number, motor_2rate, motor_3rate",
          )
          .eq("race_id", raceId)
          .order("boat_number");

        if (error) {
          console.error("race_entries取得エラー:", error.message);
          return [];
        }
        const rows = data ?? [];
        if (venueCode === null) return rows;

        if (past) {
          const raceDate = raceId.slice(0, 10);
          const [statsAsOf, pretestAsOf] = await Promise.all([
            Promise.all(
              rows.map((row) =>
                this.getVenueMotorStats(venueCode, row.motor_number, raceDate),
              ),
            ),
            fetchPretestByRacer(venueCode, raceDate),
          ]);
          return rows.map((row, i) => {
            const pretest = pretestAsOf.get(row.racer_id) ?? null;
            return {
              ...row,
              rate_source: "official",
              official_2rate: row.motor_2rate ?? null,
              // 公式の2連率・3連率がどちらも 0 か（「集計前」の判定、BOA-557）
              official_3rate: row.motor_3rate ?? null,
              pretest_time: pretest?.pretest_time ?? null,
              pretest_rank: pretest?.pretest_rank ?? null,
              power_index: null,
              clipped_by_generation: false,
              final_count: statsAsOf[i]?.finalCount ?? null,
              championship_count: statsAsOf[i]?.championshipCount ?? null,
              first_place_count: statsAsOf[i]?.firstPlaceCount ?? null,
              race_count: statsAsOf[i]?.raceCount ?? null,
            };
          });
        }

        const [powerIndexes, venueMotorStatsList, pretestByRacer] =
          await Promise.all([
            Promise.all(
              // このレースの直前まで（BOA-557）。終了後に開いてもそのレース自身の
              // 結果を含めず、翌日に開いたときと数字をそろえる
              rows.map((row) =>
                this.getMotorPowerIndex(
                  venueCode,
                  row.motor_number,
                  days,
                  raceId,
                ),
              ),
            ),
            Promise.all(
              rows.map((row) =>
                this.getVenueMotorStats(venueCode, row.motor_number),
              ),
            ),
            fetchPretestByRacer(venueCode, raceId.slice(0, 10)),
          ]);
        // 2連率/3連率も選択中の期間（過去90日/直近1ヶ月）に応じた値に差し替える。
        // race_entries.motor_2rate/3rateは公式サイトの「モーター抽選日からの通算」
        // 値でperiod非依存のため、そのまま使うと機力指数だけ期間が変わり
        // 2連率/3連率が変わらないという不整合が生じる（ユーザー指摘、2026-09-13）
        return rows.map((row, i) => {
          const pretest = pretestByRacer.get(row.racer_id) ?? null;
          return {
            ...row,
            rate_source: "recalc",
            // このレースより前に結果の出た走数（機力指数の母数）。0 なら初下ろし（BOA-513）
            sample_count: powerIndexes[i]?.sample_count ?? null,
            // 差し替える前の公式3連率（節の開始時点）。公式2連率とあわせて、新モーターで
            // 公式の累計がまだ付いていない（どちらも 0）かの判定に使う
            official_3rate: row.motor_3rate ?? null,
            clipped_by_generation:
              powerIndexes[i]?.clipped_by_generation ?? false,
            motor_2rate: powerIndexes[i]?.actual_rate2 ?? row.motor_2rate,
            motor_3rate: powerIndexes[i]?.actual_rate3 ?? row.motor_3rate,
            // 期間で差し替える前の公式値（節の開始時点）。追加クエリ0本
            official_2rate: row.motor_2rate ?? null,
            pretest_time: pretest?.pretest_time ?? null,
            pretest_rank: pretest?.pretest_rank ?? null,
            power_index: powerIndexes[i]?.power_index ?? null,
            final_count: venueMotorStatsList[i]?.finalCount ?? null,
            championship_count:
              venueMotorStatsList[i]?.championshipCount ?? null,
            first_place_count: venueMotorStatsList[i]?.firstPlaceCount ?? null,
            race_count: venueMotorStatsList[i]?.raceCount ?? null,
          };
        });
      },
    );
  },

  /**
   * 指定会場・モーター番号の「機力指数」を算出する（BOA-265）
   * このモーターが過去90日に出走した全レースについて、
   * 「そのレースで実際に2着以内だったか（0/1）」−
   * 「その時このモーターに乗っていた選手自身の全国2連率」を計算し、
   * 全レース分を平均する。強い選手ばかりが使ってきたことによる
   * 見かけ上の高評価（交絡バイアス）を避けるための設計。
   * 単純に motor_2rate − 現在の選手のglobal_2rate を引き算するだけでは
   * 過去の使用選手の実力とモーター自体の性能を区別できないため、
   * この残差平均方式を採用している（ユーザー指摘を受けて修正、2026-09-12）。
   * daysで集計期間を指定できる（既定90日=「過去90日」、30日=「直近1ヶ月」、BOA-283）。
   * 期間は現行モーターの世代（使用開始日以降）で切り詰める（BOA-329。入れ替え前の
   * 同じ番号の別モーターを混ぜない）。使用開始日が不明な会場は集計せず
   * generation_unknown: true を返す
   */
  getMotorPowerIndex(venueCode, motorNumber, days = 90, beforeRaceId = null) {
    return withCache(
      // v3: 期間を現行モーターの世代で切り詰め、generation_unknown・
      // clipped_by_generationを追加（BOA-329）
      `motor-power-index-v3-${venueCode}-${motorNumber}-${days}${beforeKey(beforeRaceId)}`,
      async () => {
        const empty = {
          venue_code: venueCode,
          motor_number: motorNumber,
          sample_count: 0,
          actual_rate2: null,
          actual_rate3: null,
          avg_baseline_rate2: null,
          power_index: null,
          generation_unknown: false,
          clipped_by_generation: false,
        };
        if (!supabase) {
          console.error("Supabase client not initialized");
          return empty;
        }

        const window = await motorWindowStart(venueCode, days, beforeRaceId);
        if (window.since === null) {
          return { ...empty, generation_unknown: true };
        }
        const windowed = {
          ...empty,
          clipped_by_generation: window.clippedByGeneration,
        };
        const races = await getRacesForVenueSince(
          venueCode,
          window.since,
          beforeRaceId,
        );
        if (races.length === 0) return windowed;

        const raceIds = races.map((r) => r.race_id);
        const entryChunks = chunkArray(raceIds, 500);

        const entryResults = await Promise.all(
          entryChunks.map((chunk) =>
            supabase
              .from("race_entries")
              .select("race_id, boat_number, global_2rate")
              .in("race_id", chunk)
              .eq("motor_number", motorNumber),
          ),
        );
        let entries = [];
        entryResults.forEach(({ data, error }) => {
          if (error) {
            console.error("race_entries取得エラー:", error.message);
            return;
          }
          entries = entries.concat(data ?? []);
        });
        if (entries.length === 0) return windowed;

        const resultChunks = chunkArray(
          entries.map((e) => e.race_id),
          500,
        );
        const resultResults = await Promise.all(
          resultChunks.map((chunk) =>
            supabase
              .from("race_results")
              .select("race_id, rank1, rank2, rank3")
              .in("race_id", chunk),
          ),
        );
        const resultByRaceId = new Map();
        resultResults.forEach(({ data, error }) => {
          if (error) {
            console.error("race_results取得エラー:", error.message);
            return;
          }
          (data ?? []).forEach((r) => resultByRaceId.set(r.race_id, r));
        });

        const residuals = [];
        let actualHits2 = 0;
        let actualHits3 = 0;
        let baselineSum = 0;
        entries.forEach((e) => {
          const result = resultByRaceId.get(e.race_id);
          if (!result || e.global_2rate === null) return;
          const isTop2 =
            result.rank1 === e.boat_number || result.rank2 === e.boat_number;
          const isTop3 = isTop2 || result.rank3 === e.boat_number;
          if (isTop2) actualHits2 += 1;
          if (isTop3) actualHits3 += 1;
          residuals.push((isTop2 ? 100 : 0) - e.global_2rate);
          baselineSum += e.global_2rate;
        });
        if (residuals.length === 0) return windowed;

        const powerIndex =
          residuals.reduce((sum, v) => sum + v, 0) / residuals.length;
        const avgBaseline = baselineSum / residuals.length;

        return {
          ...windowed,
          sample_count: residuals.length,
          actual_rate2: (actualHits2 / residuals.length) * 100,
          actual_rate3: (actualHits3 / residuals.length) * 100,
          avg_baseline_rate2: avgBaseline,
          power_index: powerIndex,
        };
      },
    );
  },

  /**
   * 指定会場・モーター番号を過去に使用した選手の履歴を、節ごとにグループ化して
   * 取得する（BOA-283）。「誰がこのモーターに乗っていたか」を辿れるようにする。
   * 節の境目は「同一選手が同一モーターに乗り続けた出走の間隔が2日以内か」で
   * 判定する（BOA-265のgetRacerCurrentMotorStatusと同じ考え方を一般化したもの）。
   * 各節の2連率/3連率はそのモーター・その選手のその節内の実績（機力指数のような
   * 選手実力の差し引きはしない、素の成績）を返す。選手の実力水準は級別バッジで
   * 別途示す（ユーザーフィードバック、2026-09-13: 機力指数を軸にすると選手間の
   * 比較がしづらいため、素の連対率＋級別表示に変更）。
   * 期間は過去90日を現行モーターの世代（使用開始日以降）で切り詰める（BOA-329。
   * 入れ替え前の同じ番号の別モーターに乗った選手を出さない）。使用開始日が
   * 不明な会場は空
   */
  getMotorUsageHistory(venueCode, motorNumber, beforeRaceId = null) {
    return withCache(
      // v2: 期間を現行モーターの世代で切り詰める（BOA-329）
      // v3: 着順の付かなかった走（失格等）も分母に数える（BOA-549）
      `motor-usage-history-v3-${venueCode}-${motorNumber}${beforeKey(beforeRaceId)}`,
      async () => {
        if (!supabase) {
          console.error("Supabase client not initialized");
          return [];
        }

        const window = await motorWindowStart(venueCode, 90, beforeRaceId);
        if (window.since === null) return [];
        const races = await getRacesForVenueSince(
          venueCode,
          window.since,
          beforeRaceId,
        );
        if (races.length === 0) return [];

        const raceIds = races.map((r) => r.race_id);
        const chunks = chunkArray(raceIds, 500);
        const entryResults = await Promise.all(
          chunks.map((chunk) =>
            supabase
              .from("race_entries")
              .select("race_id, boat_number, racer_id, player_name, grade")
              .in("race_id", chunk)
              .eq("motor_number", motorNumber),
          ),
        );
        let entries = [];
        entryResults.forEach(({ data, error }) => {
          if (error) {
            console.error("race_entries取得エラー:", error.message);
            return;
          }
          entries = entries.concat(data ?? []);
        });
        if (entries.length === 0) return [];

        const resultChunks = chunkArray(
          entries.map((e) => e.race_id),
          500,
        );
        const resultResults = await Promise.all(
          resultChunks.map((chunk) =>
            supabase
              .from("race_results")
              .select(
                "race_id, rank1, rank2, rank3, rank4, rank5, rank6, is_cancelled, is_no_race",
              )
              .in("race_id", chunk),
          ),
        );
        const resultByRaceId = new Map();
        resultResults.forEach(({ data, error }) => {
          if (error) {
            console.error("race_results取得エラー:", error.message);
            return;
          }
          (data ?? []).forEach((r) => resultByRaceId.set(r.race_id, r));
        });

        const rankOf = (result, boatNumber) =>
          findBoatColumnIndex(result, "rank", boatNumber);

        // race_id昇順に並べ、同一選手が2日以内の間隔で乗り続けている限り同じ節とみなす
        const sorted = [...entries].sort((a, b) =>
          a.race_id.localeCompare(b.race_id),
        );
        const meets = [];
        let current = null;
        sorted.forEach((e) => {
          const date = e.race_id.slice(0, 10);
          if (current && current.racerId === e.racer_id) {
            const gapDays =
              (new Date(date) - new Date(current.lastDate)) / 86400000;
            if (gapDays <= 2) {
              current.entries.push(e);
              current.lastDate = date;
              return;
            }
          }
          if (current) meets.push(current);
          current = {
            racerId: e.racer_id,
            playerName: e.player_name,
            grade: e.grade,
            entries: [e],
            firstDate: date,
            lastDate: date,
          };
        });
        if (current) meets.push(current);

        return meets
          .map((meet) => {
            let hits2 = 0;
            let hits3 = 0;
            let n = 0;
            const races = meet.entries.map((e) => {
              const result = resultByRaceId.get(e.race_id);
              const rank = rankOf(result, e.boat_number);
              // 着順の付かなかった走（失格・転覆等）も、結果の出たレースなら1走に数える。
              // 機力指数・枠番別成績と同じ数え方にそろえる（BOA-549。以前は節の2連率
              // だけ分母から外していて、同じモーターの2連率が画面の中で食い違った）。
              // 公式のモーター2連率は選手責任外の失格（S0）・欠場を数えないが、2026年の
              // データにはそれを見分ける列が無い（実測では着順なしの走の約76%が公式でも
              // 出走に数えられていた）。公式の成績コードの取り込みは別チケット
              if (rank !== null) {
                n += 1;
                if (rank <= 2) hits2 += 1;
                if (rank <= 3) hits3 += 1;
              } else if (isUsableRaceResult(result)) {
                n += 1;
              }
              return { date: e.race_id.slice(0, 10), rank };
            });
            return {
              racerId: meet.racerId,
              playerName: meet.playerName,
              grade: meet.grade,
              firstDate: meet.firstDate,
              lastDate: meet.lastDate,
              races,
              sampleCount: n,
              rate2: n > 0 ? (hits2 / n) * 100 : null,
              rate3: n > 0 ? (hits3 / n) * 100 : null,
            };
          })
          .reverse();
      },
    );
  },

  /**
   * 指定会場・モーター番号の公式サイト発表モーター成績（節数・出走回数・
   * 優出回数・優勝回数等）の最新スナップショットを取得する（BOA-264）。
   * `venue_motor_stats`は日次で会場公式サイトをスクレイピングして書き込まれる
   * （scripts/daily/scrape-venue-motor-stats.js）。会場ごとに公式サイトの
   * 公開項目が異なるため、値が無い項目はnullのまま返す（戸田・平和島は
   * データ自体が無いため常にnull）。「機力指数+16.6だが抽選後8走しかしていない
   * ので信頼度低め」のように、他のモーター指標の信頼度を判断する材料として使う
   */
  getVenueMotorStats(venueCode, motorNumber, asOfDate = null) {
    return withCache(
      // asOfDate（YYYY-MM-DD）を渡すと、その日以前で最新のスナップショットを返す
      // （過去レースの一覧表をレース時点の公式値にする、BOA-329）
      asOfDate === null
        ? `venue-motor-stats-${venueCode}-${motorNumber}`
        : `venue-motor-stats-asof-${venueCode}-${motorNumber}-${asOfDate}`,
      async () => {
        if (!supabase) {
          console.error("Supabase client not initialized");
          return null;
        }

        // このメソッドはRaceDetailの機力指数・モーター調子ドリルダウンの
        // Promise.allに同居させて呼ぶ想定のため、ネットワークレベルの例外
        // （supabase-jsが{data,error}を返さずreject自体する稀なケース）が
        // Promise.all全体を巻き込んで他の取得済みデータまで消さないよう、
        // 内部でtry/catchして安全側（null）にフォールバックする
        try {
          const { data, error } = await supabase
            .from("venue_motor_stats")
            .select("*")
            .eq("venue_code", venueCode)
            .eq("motor_number", motorNumber)
            .lte("scraped_date", asOfDate ?? "9999-12-31")
            .order("scraped_date", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (error) {
            console.error("venue_motor_stats取得エラー:", error.message);
            return null;
          }
          if (!data) return null;

          return {
            scrapedDate: data.scraped_date,
            meetCount: data.meet_count,
            raceCount: data.race_count,
            finalCount: data.final_count,
            championshipCount: data.championship_count,
            firstPlaceCount: data.first_place_count,
            secondPlaceCount: data.second_place_count,
            thirdPlaceCount: data.third_place_count,
            winRate: data.win_rate,
            top2Rate: data.top2_rate,
            top3Rate: data.top3_rate,
            accidentRate: data.accident_rate,
            bestTime: data.best_time,
            avgExhibitionTime: data.avg_exhibition_time,
            statsPeriodStart: data.stats_period_start,
            statsPeriodEnd: data.stats_period_end,
          };
        } catch (err) {
          console.error("venue_motor_stats取得エラー(例外):", err.message);
          return null;
        }
      },
    );
  },

  /**
   * 指定会場・モーター番号が「優勝戦」で実際に1着になった日付・選手を
   * 取得する（BOA-264追加調査、BOA-226のrace_stage列が前提）。
   * venue_motor_statsの優勝数は公式サイト側の集計期間内の合計回数のみで
   * 日付・選手の内訳が無いため、自社データ（race_conditions.race_stage=
   * 優勝戦を含む×race_entries×race_results）から逆算する。
   * race_stageはBOA-226実装後に取得したレースに入るほか、BOA-347の
   * scripts/maintenance/backfill-race-conditions.js で過去分も遡及取得している
   * （2025-12〜2026-02-02分を2026-09-28に実施する方針）。
   *
   * モーターは会場ごとに概ね年1回入れ替わり、番号は再利用されるため、
   * 現行モーターの世代（venue_motor_start_datesの最新の使用開始日以降）の
   * レースに限る。使用開始日が取れない会場（行が無い）は、別モーターの記録を
   * 混ぜないよう履歴を出さず generationStart: null を返す。
   * @returns {Promise<{generationStart: string|null, wins: Array<{raceId:string,date:string,racerId:number|null,playerName:string|null}>, fetchFailed?: boolean}>}
   */
  getVenueMotorChampionshipHistory(
    venueCode,
    motorNumber,
    beforeRaceId = null,
  ) {
    return withCache(
      // 戻り値を配列から{generationStart, wins}に変えたため、キーを変えて
      // localStorageに残る旧形式（配列）を読まない
      `venue-motor-championship-generation-${venueCode}-${motorNumber}${beforeKey(beforeRaceId)}`,
      async () => {
        const failed = { generationStart: null, wins: [], fetchFailed: true };
        if (!supabase) {
          console.error("Supabase client not initialized");
          return failed;
        }
        try {
          const generationStart = await getMotorGenerationStart(venueCode);
          if (generationStart === null) return { generationStart, wins: [] };

          const { data: stageRows, error: stageError } = await supabase
            .from("race_conditions")
            .select("race_id, race_stage, races!inner(venue_code)")
            // 「優勝戦」で終わるものをDBで粗く絞り、「準優勝戦」「準々優勝戦」の
            // 除外は `isFinalStage` に任せる。完全一致だと会場固有の接頭が付く
            // 「ツッキー優勝戦」「ＭＤ優勝戦」「団体・優勝戦」を取りこぼす
            // （旧コメントは「優勝戦/準優勝戦の2値のみ」と書いていたが、
            //  実データの race_stage は349種あった。BOA-457）
            .like("race_stage", "%優勝戦")
            .eq("races.venue_code", venueCode);
          if (stageError) {
            console.error("race_conditions取得エラー:", stageError.message);
            return failed;
          }
          const raceIds = (stageRows ?? [])
            .filter((r) => isFinalStage(r.race_stage))
            .map((r) => r.race_id)
            .filter((raceId) => isInMotorGeneration(raceId, generationStart))
            // 過去レースのドリルダウンは、そのレースより前の優勝に限る（BOA-521）
            .filter((raceId) => beforeRaceId === null || raceId < beforeRaceId);
          if (raceIds.length === 0) return { generationStart, wins: [] };

          const { data: entries, error: entriesError } = await supabase
            .from("race_entries")
            .select("race_id, boat_number, racer_id, player_name")
            .in("race_id", raceIds)
            .eq("motor_number", motorNumber);
          if (entriesError) {
            console.error("race_entries取得エラー:", entriesError.message);
            return failed;
          }
          if (!entries || entries.length === 0) {
            return { generationStart, wins: [] };
          }

          const { data: results, error: resultsError } = await supabase
            .from("race_results")
            .select("race_id, rank1")
            .in(
              "race_id",
              entries.map((e) => e.race_id),
            );
          if (resultsError) {
            console.error("race_results取得エラー:", resultsError.message);
            return failed;
          }
          const rank1ByRaceId = new Map(
            (results ?? []).map((r) => [r.race_id, r.rank1]),
          );

          const wins = entries
            .filter((e) => rank1ByRaceId.get(e.race_id) === e.boat_number)
            .map((e) => ({
              raceId: e.race_id,
              date: e.race_id.slice(0, 10),
              racerId: e.racer_id,
              playerName: e.player_name,
            }))
            .sort((a, b) => b.date.localeCompare(a.date));
          return { generationStart, wins };
        } catch (err) {
          // 権限エラー（使用開始日が読めない）は getMotorGenerationStart が
          // null（世代不明）に倒すため、ここに来るのは取得失敗だけ
          console.error("優勝履歴取得エラー(例外):", err.message);
          return failed;
        }
      },
    );
  },

  /**
   * 指定会場・モーター番号が、同一会場内の全モーターの中で指標順に何位かを
   * 算出する（BOA-301 FR-1）。venue_motor_stats（会場公式サイト由来、BOA-264）の
   * 最新スクレイピング日1件分のスナップショットのみを対象とし、自社race_results
   * からの再計算は行わない（会場公式値の方が正確という既存合意、spec.md参照）。
   * metricがaccidentRate（事故率）の場合のみ昇順（低いほど良い）でランクする。
   * 値がnullのモーター（会場によって非公開の指標がある）はランキング対象外にし、
   * totalにも含めない
   * @param {number} venueCode
   * @param {number} motorNumber
   * @param {'winRate'|'top2Rate'|'top3Rate'|'accidentRate'} metric
   * @returns {Promise<{rank:number,total:number,metric:string,value:number,scrapedDate:string}|null>}
   */
  getVenueMotorRanking(
    venueCode,
    motorNumber,
    metric = "top2Rate",
    asOfDate = null,
  ) {
    return withCache(
      // asOfDate（YYYY-MM-DD）を渡すと、その日以前で最新のスナップショットで順位を
      // 出す（過去レースのドリルダウン、BOA-521）
      // v2: 同じ値は同じ順位・tied を追加（BOA-529）
      asOfDate === null
        ? `venue-motor-ranking-v2-${venueCode}-${motorNumber}-${metric}`
        : `venue-motor-ranking-v2-asof-${venueCode}-${motorNumber}-${metric}-${asOfDate}`,
      async () => {
        if (!supabase) {
          console.error("Supabase client not initialized");
          return null;
        }
        try {
          const { data: latestRow, error: latestError } = await supabase
            .from("venue_motor_stats")
            .select("scraped_date")
            .eq("venue_code", venueCode)
            .lte("scraped_date", asOfDate ?? "9999-12-31")
            .order("scraped_date", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (latestError) {
            console.error("venue_motor_stats取得エラー:", latestError.message);
            return null;
          }
          if (!latestRow) return null;

          const { data, error } = await supabase
            .from("venue_motor_stats")
            .select(
              "motor_number, win_rate, top2_rate, top3_rate, accident_rate",
            )
            .eq("venue_code", venueCode)
            .eq("scraped_date", latestRow.scraped_date);
          if (error) {
            console.error("venue_motor_stats取得エラー:", error.message);
            return null;
          }
          if (!data || data.length === 0) return null;

          const columnByMetric = {
            winRate: "win_rate",
            top2Rate: "top2_rate",
            top3Rate: "top3_rate",
            accidentRate: "accident_rate",
          };
          const column = columnByMetric[metric] ?? "top2_rate";
          // 事故率のみ低いほど良いため昇順、他は降順
          const ascending = metric === "accidentRate";

          const valued = data.filter(
            (row) => row[column] !== null && row[column] !== undefined,
          );
          const own = valued.find((row) => row.motor_number === motorNumber);
          if (!own) return null;
          // 同じ値は同じ順位（BOA-529）。並べ替えた位置を順位にすると、同値の中の
          // 順位が DB の行順で決まっていた
          const { rank, tied } = competitionRank(
            valued.map((row) => Number(row[column])),
            Number(own[column]),
            { ascending },
          );

          return {
            rank,
            tied,
            total: valued.length,
            metric,
            value: own[column],
            scrapedDate: latestRow.scraped_date,
          };
        } catch (err) {
          console.error("venue_motor_stats取得エラー(例外):", err.message);
          return null;
        }
      },
    );
  },

  /**
   * 会場の現行モーター世代の開始日（不明なら null）。画面で「このレースのモーターは
   * 入れ替え前か」を判定するのに使う（日付そのものは画面に出さない、ADR-0067）
   * @returns {Promise<string|null>}
   */
  getMotorGenerationStart(venueCode) {
    return getMotorGenerationStart(venueCode);
  },

  /**
   * 指定会場・モーター番号の枠番（進入コース）別成績・展示タイム推移を、
   * 自社race_entries×race_results×exhibition_dataからライブ集計する
   * （BOA-301 FR-2/FR-3、ADR-0060: 1会場×1モーターに絞り込んだ範囲のため
   * 事前バッチ集計は不要と判断）。
   *
   * 集計期間は現行モーターの世代（venue_motor_start_datesの最新の使用開始日以降）。
   * モーターは会場ごとに概ね年1回入れ替わり番号が再利用されるため、以前は
   * 混在リスクを緩和する暫定策として直近180日に絞っていた（BOA-329）。
   * 使用開始日が不明な会場は、別モーターの成績を混ぜないよう集計しない
   * （generationStart: null。優勝履歴と同じ扱い、ADR-0067 2026-09-28追記）。
   * rowsは常に1〜6コース分（出走が無いコースはraceCount:0・値null）で、
   * UI側で6行固定のグリッドを組みやすくする
   * @returns {Promise<{generationStart:string|null, fetchFailed?:boolean,
   *   rows:Array<{course:number, raceCount:number, winRate:number|null,
   *   top2Rate:number|null, top3Rate:number|null, avgExhibitionTime:number|null,
   *   exhibitionTrend:Array<{raceId:string,time:number}>}>}>}
   */
  getMotorWakuStats(venueCode, motorNumber, beforeRaceId = null) {
    return withCache(
      // 戻り値を配列から{generationStart, rows}に変えたため、キーを変えて
      // localStorageに残る旧形式（配列）を読まない
      `motor-waku-stats-generation-${venueCode}-${motorNumber}${beforeKey(beforeRaceId)}`,
      async () => {
        const emptyRows = () =>
          Array.from({ length: 6 }, (_, i) => ({
            course: i + 1,
            raceCount: 0,
            winRate: null,
            top2Rate: null,
            top3Rate: null,
            avgExhibitionTime: null,
            exhibitionTrend: [],
          }));

        if (!supabase) {
          console.error("Supabase client not initialized");
          return {
            generationStart: null,
            rows: emptyRows(),
            fetchFailed: true,
          };
        }

        let generationStart;
        try {
          generationStart = await getMotorGenerationStart(venueCode);
        } catch (err) {
          console.error("モーター使用開始日取得エラー:", err.message);
          return {
            generationStart: null,
            rows: emptyRows(),
            fetchFailed: true,
          };
        }
        if (generationStart === null) {
          return { generationStart, rows: emptyRows() };
        }

        const races = await getRacesForVenueSince(
          venueCode,
          generationStart,
          beforeRaceId,
        );
        if (races.length === 0) return { generationStart, rows: emptyRows() };

        const raceIds = races.map((r) => r.race_id);
        const chunks = chunkArray(raceIds, 500);
        const entryResults = await Promise.all(
          chunks.map((chunk) =>
            supabase
              .from("race_entries")
              .select("race_id, boat_number")
              .in("race_id", chunk)
              .eq("motor_number", motorNumber),
          ),
        );
        let entries = [];
        entryResults.forEach(({ data, error }) => {
          if (error) {
            console.error("race_entries取得エラー:", error.message);
            return;
          }
          entries = entries.concat(data ?? []);
        });
        if (entries.length === 0) return { generationStart, rows: emptyRows() };

        const [resultRows, exhibitionRows] = await Promise.all([
          fetchAllByIn(
            "race_results",
            "race_id, rank1, rank2, rank3, is_cancelled, is_no_race, actual_course_1, actual_course_2, actual_course_3, actual_course_4, actual_course_5, actual_course_6",
            "race_id",
            entries.map((e) => e.race_id),
          ),
          fetchAllByIn(
            "exhibition_data",
            "race_id, boat_number, exhibition_time",
            "race_id",
            entries.map((e) => e.race_id),
          ),
        ]);
        const resultByRaceId = new Map(resultRows.map((r) => [r.race_id, r]));
        const exhibitionByKey = new Map(
          exhibitionRows.map((e) => [`${e.race_id}-${e.boat_number}`, e]),
        );

        const byCourse = new Map(
          Array.from({ length: 6 }, (_, i) => [
            i + 1,
            {
              course: i + 1,
              raceCount: 0,
              firstPlaceCount: 0,
              top2Count: 0,
              top3Count: 0,
              exhibitionTimes: [],
            },
          ]),
        );

        entries.forEach((entry) => {
          const result = resultByRaceId.get(entry.race_id);
          if (!isUsableRaceResult(result)) return;
          const course = courseOfBoat(result, entry.boat_number);
          const stat = byCourse.get(course);
          // courseOfBoat()がnullを返す(欠場等で進入コース無し)場合や、
          // 進入コース値が1-6の範囲外(データ異常)の場合は集計対象外にする
          if (!stat) return;

          stat.raceCount += 1;
          if (result.rank1 === entry.boat_number) stat.firstPlaceCount += 1;
          if (isPlaceHit(entry.boat_number, result.rank1, result.rank2)) {
            stat.top2Count += 1;
          }
          if (
            isShowHit(
              entry.boat_number,
              result.rank1,
              result.rank2,
              result.rank3,
            )
          ) {
            stat.top3Count += 1;
          }
          const exhibition = exhibitionByKey.get(
            `${entry.race_id}-${entry.boat_number}`,
          );
          if (
            exhibition?.exhibition_time !== null &&
            exhibition?.exhibition_time !== undefined
          ) {
            stat.exhibitionTimes.push({
              raceId: entry.race_id,
              time: exhibition.exhibition_time,
            });
          }
        });

        const rows = [...byCourse.values()].map((stat) => {
          const trend = stat.exhibitionTimes.sort((a, b) =>
            a.raceId.localeCompare(b.raceId),
          );
          return {
            course: stat.course,
            raceCount: stat.raceCount,
            winRate:
              stat.raceCount > 0
                ? (stat.firstPlaceCount / stat.raceCount) * 100
                : null,
            top2Rate:
              stat.raceCount > 0
                ? (stat.top2Count / stat.raceCount) * 100
                : null,
            top3Rate:
              stat.raceCount > 0
                ? (stat.top3Count / stat.raceCount) * 100
                : null,
            avgExhibitionTime:
              trend.length > 0
                ? trend.reduce((sum, t) => sum + t.time, 0) / trend.length
                : null,
            exhibitionTrend: trend,
          };
        });
        return { generationStart, rows };
      },
    );
  },

  /**
   * 指定会場・モーター番号を使用した選手ごとの枠番（進入コース）別成績を
   * ライブ集計する（BOA-301 FR-4、選手×モーター×枠）。getMotorWakuStatsと同じ
   * JOIN・集計期間（現行モーターの世代）・進入コース判定にracer_idの
   * グルーピングを加えたもの。サンプル数が小さくなりやすい軸のため、常にnを
   * 返しUI側で小標本表示を判断できるようにする（合否判定・非表示化はしない、
   * BOA-306と同じ方針）。入れ替え直後はnがさらに小さくなるが、扱いは同じ
   * @returns {Promise<{generationStart:string|null, fetchFailed?:boolean,
   *   rows:Array<{racerId:number, playerName:string, course:number,
   *   raceCount:number, winRate:number|null, top2Rate:number|null, top3Rate:number|null}>}>}
   */
  getMotorRacerWakuStats(venueCode, motorNumber, beforeRaceId = null) {
    return withCache(
      // 戻り値の形を変えたためキーも変える（getMotorWakuStatsと同じ理由）
      `motor-racer-waku-stats-generation-${venueCode}-${motorNumber}${beforeKey(beforeRaceId)}`,
      async () => {
        if (!supabase) {
          console.error("Supabase client not initialized");
          return { generationStart: null, rows: [], fetchFailed: true };
        }

        let generationStart;
        try {
          generationStart = await getMotorGenerationStart(venueCode);
        } catch (err) {
          console.error("モーター使用開始日取得エラー:", err.message);
          return { generationStart: null, rows: [], fetchFailed: true };
        }
        if (generationStart === null) return { generationStart, rows: [] };

        const races = await getRacesForVenueSince(
          venueCode,
          generationStart,
          beforeRaceId,
        );
        if (races.length === 0) return { generationStart, rows: [] };

        const raceIds = races.map((r) => r.race_id);
        const chunks = chunkArray(raceIds, 500);
        const entryResults = await Promise.all(
          chunks.map((chunk) =>
            supabase
              .from("race_entries")
              .select("race_id, boat_number, racer_id, player_name")
              .in("race_id", chunk)
              .eq("motor_number", motorNumber),
          ),
        );
        let entries = [];
        entryResults.forEach(({ data, error }) => {
          if (error) {
            console.error("race_entries取得エラー:", error.message);
            return;
          }
          entries = entries.concat(data ?? []);
        });
        if (entries.length === 0) return { generationStart, rows: [] };

        const resultRows = await fetchAllByIn(
          "race_results",
          "race_id, rank1, rank2, rank3, is_cancelled, is_no_race, actual_course_1, actual_course_2, actual_course_3, actual_course_4, actual_course_5, actual_course_6",
          "race_id",
          entries.map((e) => e.race_id),
        );
        const resultByRaceId = new Map(resultRows.map((r) => [r.race_id, r]));

        const byKey = new Map();
        entries.forEach((entry) => {
          if (entry.racer_id === null || entry.racer_id === undefined) return;
          const result = resultByRaceId.get(entry.race_id);
          if (!isUsableRaceResult(result)) return;
          const course = courseOfBoat(result, entry.boat_number);
          // courseOfBoat()がnullを返す(欠場等で進入コース無し)場合はnull<1が
          // trueになりここで除外される。範囲外(データ異常)の場合も同様に除外
          if (course < 1 || course > 6) return;

          const key = `${entry.racer_id}-${course}`;
          if (!byKey.has(key)) {
            byKey.set(key, {
              racerId: entry.racer_id,
              playerName: entry.player_name,
              course,
              raceCount: 0,
              firstPlaceCount: 0,
              top2Count: 0,
              top3Count: 0,
            });
          }
          const stat = byKey.get(key);
          stat.raceCount += 1;
          if (result.rank1 === entry.boat_number) stat.firstPlaceCount += 1;
          if (isPlaceHit(entry.boat_number, result.rank1, result.rank2)) {
            stat.top2Count += 1;
          }
          if (
            isShowHit(
              entry.boat_number,
              result.rank1,
              result.rank2,
              result.rank3,
            )
          ) {
            stat.top3Count += 1;
          }
        });

        const rows = [...byKey.values()]
          .map((stat) => ({
            racerId: stat.racerId,
            playerName: stat.playerName,
            course: stat.course,
            raceCount: stat.raceCount,
            winRate:
              stat.raceCount > 0
                ? (stat.firstPlaceCount / stat.raceCount) * 100
                : null,
            top2Rate:
              stat.raceCount > 0
                ? (stat.top2Count / stat.raceCount) * 100
                : null,
            top3Rate:
              stat.raceCount > 0
                ? (stat.top3Count / stat.raceCount) * 100
                : null,
          }))
          .sort((a, b) => a.course - b.course || b.raceCount - a.raceCount);
        return { generationStart, rows };
      },
    );
  },

  /**
   * 指定レースの枠番別・選手の勝率上昇/下降を取得する（BOA-152）
   * 現在の全国勝率と約90日前時点の全国勝率を比較し、調子の変化を示す
   */
  getRaceRacerFormBreakdown(raceId) {
    return withCache(`race-racer-form-${raceId}`, async () => {
      if (!supabase) {
        console.error("Supabase client not initialized");
        return [];
      }

      const { data: current, error: curError } = await supabase
        .from("race_entries")
        .select("boat_number, player_name, racer_id, win_rate, local_win_rate")
        .eq("race_id", raceId)
        .order("boat_number");

      if (curError || !current || current.length === 0) {
        if (curError)
          console.error("race_entries取得エラー:", curError.message);
        return [];
      }

      const racerIds = [...new Set(current.map((r) => r.racer_id))].filter(
        (id) => id !== null,
      );
      if (racerIds.length === 0) return current;

      // 約90日前時点の直近の記録を探す（cutoff以前・探索窓2週間で最新のもの）
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
      const cutoff = ninetyDaysAgo.toISOString().split("T")[0];
      const windowStart = new Date(ninetyDaysAgo);
      windowStart.setDate(windowStart.getDate() - 14);
      const windowStartStr = windowStart.toISOString().split("T")[0];

      const { data: past, error: pastError } = await supabase
        .from("race_entries")
        .select("race_id, racer_id, win_rate")
        .in("racer_id", racerIds)
        .gte("race_id", windowStartStr)
        .lte("race_id", cutoff)
        .order("race_id", { ascending: false });

      if (pastError) {
        console.error("過去データ取得エラー:", pastError.message);
      }

      // race_id降順のため、各racer_idごとに最初に出てくるものが cutoff に最も近い記録
      const pastByRacer = new Map();
      (past ?? []).forEach((row) => {
        if (!pastByRacer.has(row.racer_id)) {
          pastByRacer.set(row.racer_id, row.win_rate);
        }
      });

      return current.map((row) => {
        const pastWinRate = pastByRacer.get(row.racer_id) ?? null;
        return {
          ...row,
          past_win_rate: pastWinRate,
          delta: pastWinRate !== null ? row.win_rate - pastWinRate : null,
        };
      });
    });
  },

  /**
   * 指定選手の全国勝率の節ごとの推移を取得する（BOA-152）
   * race_entries.win_rate/local_win_rate は節単位でのみ更新されるため、
   * モーター調子と同じく日付単位でdedupeして推移として扱う
   */
  getRacerFormTrend(racerId) {
    return withCache(`racer-form-trend-${racerId}`, async () => {
      if (!supabase) {
        console.error("Supabase client not initialized");
        return { racer_id: racerId, trend: [] };
      }

      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
      const cutoff = ninetyDaysAgo.toISOString().split("T")[0];

      const { data, error } = await supabase
        .from("race_entries")
        .select("race_id, win_rate, local_win_rate")
        .eq("racer_id", racerId)
        .gte("race_id", cutoff)
        .order("race_id");

      if (error) {
        console.error("race_entries取得エラー:", error.message);
        return { racer_id: racerId, trend: [] };
      }

      // 日付単位でdedupe（同日の複数レースは同じ値のため最初の1件を採用）
      const byDate = new Map();
      (data ?? [])
        .map((e) => ({ ...e, race_date: e.race_id.slice(0, 10) }))
        .forEach((e) => {
          if (!byDate.has(e.race_date)) {
            byDate.set(e.race_date, {
              date: e.race_date,
              win_rate: e.win_rate,
              local_win_rate: e.local_win_rate,
            });
          }
        });

      return { racer_id: racerId, trend: [...byDate.values()] };
    });
  },

  /**
   * 指定選手の現在の全国勝率と約90日前時点の全国勝率を比較する（選手個人ページ用）
   * getRaceRacerFormBreakdownと同じ比較ロジックをracer_id単体向けに転用したもの
   */
  getRacerFormSummary(racerId) {
    return withCache(`racer-form-summary-${racerId}`, async () => {
      if (!supabase) {
        console.error("Supabase client not initialized");
        return null;
      }

      const { data: current, error: curError } = await supabase
        .from("race_entries")
        .select("race_id, win_rate, local_win_rate")
        .eq("racer_id", racerId)
        .order("race_id", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (curError || !current) {
        if (curError)
          console.error("race_entries取得エラー:", curError.message);
        return null;
      }

      // 約90日前時点の直近の記録を探す（cutoff以前・探索窓2週間で最新のもの）
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
      const cutoff = ninetyDaysAgo.toISOString().split("T")[0];
      const windowStart = new Date(ninetyDaysAgo);
      windowStart.setDate(windowStart.getDate() - 14);
      const windowStartStr = windowStart.toISOString().split("T")[0];

      const { data: past, error: pastError } = await supabase
        .from("race_entries")
        .select("win_rate")
        .eq("racer_id", racerId)
        .gte("race_id", windowStartStr)
        .lte("race_id", cutoff)
        .order("race_id", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (pastError) {
        console.error("過去データ取得エラー:", pastError.message);
      }

      const pastWinRate = past?.win_rate ?? null;
      return {
        racer_id: racerId,
        current_win_rate: current.win_rate,
        current_local_win_rate: current.local_win_rate,
        past_win_rate: pastWinRate,
        delta: pastWinRate !== null ? current.win_rate - pastWinRate : null,
      };
    });
  },

  /**
   * 指定選手が過去90日間で勝った時の決まり手構成比を取得する（選手個人ページ用）
   * getRaceTechniqueProfileBreakdownのクライアント集計ロジックをracer_id単体向けに
   * 転用したもの。対象が1選手のみのためRPC化は不要（egress負荷が小さい）
   */
  getRacerTechniqueProfile(racerId) {
    return withCache(`racer-technique-profile-${racerId}`, async () => {
      if (!supabase) {
        console.error("Supabase client not initialized");
        return { racer_id: racerId, win_count: 0, techniques: [] };
      }

      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
      const cutoffStr = ninetyDaysAgo.toISOString().split("T")[0];

      const { data: entries, error: entriesError } = await supabase
        .from("race_entries")
        .select("race_id, boat_number")
        .eq("racer_id", racerId)
        .gte("race_id", cutoffStr);

      if (entriesError || !entries || entries.length === 0) {
        if (entriesError)
          console.error("race_entries取得エラー:", entriesError.message);
        return { racer_id: racerId, win_count: 0, techniques: [] };
      }

      const raceIds = [...new Set(entries.map((e) => e.race_id))];
      const resultRows = await fetchAllByIn(
        "race_results",
        "race_id, rank1, winning_technique",
        "race_id",
        raceIds,
      );

      const resultByRaceId = new Map();
      resultRows.forEach((r) => {
        if (!r.winning_technique || r.rank1 === null) return;
        resultByRaceId.set(r.race_id, r);
      });

      const counts = new Map();
      entries.forEach((e) => {
        const result = resultByRaceId.get(e.race_id);
        if (!result || result.rank1 !== e.boat_number) return; // この選手が勝ったレースのみ集計
        counts.set(
          result.winning_technique,
          (counts.get(result.winning_technique) ?? 0) + 1,
        );
      });

      const winCount = [...counts.values()].reduce((s, c) => s + c, 0);
      const techniques = [...counts.entries()]
        .map(([technique, count]) => ({
          technique,
          count,
          percentage: winCount > 0 ? (count / winCount) * 100 : 0,
        }))
        .sort((a, b) => b.count - a.count);

      return { racer_id: racerId, win_count: winCount, techniques };
    });
  },

  /**
   * 指定選手の平均ST等の集計統計を取得する（選手個人ページ用）
   * scripts/analysis/aggregate-racer-stats.jsが日次で事前集計したracer_aggregated_stats
   * （venue_code=0は全会場合算のレコード）を参照する
   */
  getRacerAggregatedStats(racerId) {
    return withCache(`racer-aggregated-stats-${racerId}`, async () => {
      if (!supabase) {
        console.error("Supabase client not initialized");
        return null;
      }

      const { data, error } = await supabase
        .from("racer_aggregated_stats")
        .select(
          "avg_st, avg_st_last_30, st_stddev, flying_rate, total_races, course_race_counts",
        )
        .eq("racer_id", racerId)
        .eq("venue_code", 0)
        .maybeSingle();

      if (error) {
        console.error("racer_aggregated_stats取得エラー:", error.message);
        return null;
      }
      return data;
    });
  },

  /**
   * 選手検索UI向けに全選手の軽量一覧を取得する。
   * 対象約1,627件・数十KB程度のため都度クエリではなく一括取得し長期キャッシュする
   * （選手数の変動は月数件程度、egress削減のため24時間キャッシュ）。
   * 検索自体はこのデータをクライアント側でフィルタする（RacerSearchBox.jsx参照）。
   * racer_profilesは1,627件でSupabaseのデフォルトlimit(1000行)を超えるため、
   * .range()でページネーションして全件取得する必要がある
   * （2026-09-08、ページネーション漏れで約4割の選手が検索に出てこないバグを発見・修正）。
   * キャッシュキーは取得列を変更するたびにサフィックスを上げる（v2で列追加）。
   * 24時間TTLのため、キー名を変えずに列だけ増やすと、変更前にキャッシュ済みの
   * ブラウザが新しい列（登録期・出身地等）を含まない古いデータを最大24時間
   * 表示し続けてしまう（2026-09-08、実機確認で発覚）
   */
  getAllRacersLite() {
    return withCache(
      "all-racers-lite-v2",
      async () => {
        if (!supabase) {
          console.error("Supabase client not initialized");
          return [];
        }
        const data = [];
        const pageSize = 1000;
        let from = 0;
        while (true) {
          const { data: page, error } = await supabase
            .from("racer_profiles")
            .select(
              "racer_id, name, name_kana, branch, height_cm, weight_kg, registration_period, hometown, birth_date",
            )
            .order("racer_id")
            .range(from, from + pageSize - 1);

          if (error) {
            // withCacheは成功時（.then）のみキャッシュするため、ここは[]を返さず
            // throwする。[]を返すと一時的なエラーが24時間キャッシュされ、
            // 取得済み分のデータも道連れで破棄されてしまう
            // （2026-09-08、コードレビューで発見）
            throw new Error(`racer_profiles取得エラー: ${error.message}`);
          }
          if (!page || page.length === 0) break;
          data.push(...page);
          if (page.length < pageSize) break;
          from += pageSize;
        }
        return data;
      },
      24 * 60 * 60 * 1000,
    );
  },

  /**
   * 選手ごとの最新級別・勝率（race_entriesの最新行、ADR-0023準拠）を
   * racer_grade_cache（scripts/daily/update-racer-grade-cache.jsが夜間更新）
   * から取得する（docs/adr/0043-racer-grade-win-rate-cache-strategy.md）
   */
  getRacerGradeCache() {
    return withCache(
      "racer-grade-cache",
      async () => {
        if (!supabase) {
          console.error("Supabase client not initialized");
          return [];
        }
        const { data, error } = await supabase
          .from("racer_grade_cache")
          .select("data")
          .eq("key", "latest_grades")
          .single();

        if (error) {
          // withCacheは成功時（.then）のみキャッシュするため、ここは[]を返さず
          // throwする（getAllRacersLiteと同じ理由、2026-09-08コードレビューで発見）
          throw new Error(`racer_grade_cache取得エラー: ${error.message}`);
        }
        return data?.data ?? [];
      },
      24 * 60 * 60 * 1000,
    );
  },

  /**
   * 選手検索・一覧（RacerSearchBox・/racers）向けに、選手プロフィールと
   * 最新級別・勝率をマージした一覧を取得する
   * （docs/design/racer-search-and-list/plan.md参照）
   */
  async getAllRacersWithGrade() {
    const [racers, grades] = await Promise.all([
      this.getAllRacersLite(),
      this.getRacerGradeCache(),
    ]);
    const gradeByRacerId = new Map(grades.map((g) => [g.racer_id, g]));
    return racers.map((racer) => {
      const gradeInfo = gradeByRacerId.get(racer.racer_id);
      return {
        ...racer,
        grade: gradeInfo?.grade ?? null,
        winRate: gradeInfo?.win_rate ?? null,
      };
    });
  },

  /**
   * 指定選手の会場別（当地）成績を取得する（選手個人ページ用）
   * racer_aggregated_statsは本番では venue_code=0（全会場合算）の行しか
   * 存在せず（会場別集計は日次自動化に未組み込み、2026-09-06確認）、
   * 会場別行を前提にはできない。そのためgetRacerBoatReturnRate等と同じ
   * 「対象は1選手のみなのでその場でライブ集計する」方式で
   * race_entries×races×race_resultsから直接算出する
   */
  getRacerVenueStats(racerId) {
    return withCache(`racer-venue-stats-${racerId}`, async () => {
      if (!supabase) {
        console.error("Supabase client not initialized");
        return [];
      }

      // 過去2年分を対象（他のracer_id単体集計は90〜180日窓だが、
      // 会場別成績は会場ごとの出走機会自体が少ないため長めに取る）。
      // 窓は730日だが、DBは2025-12-02からしか無いので実際はそれ以降になる。
      // 画面の注記は「2025年12月以降・最大過去2年」と開始月を直書きしている
      // （BOA-503。getRacerScopedRaceStats/getRacerRaceHistoryも同じ窓）。
      // 2027-12-03以降は窓の始点がデータの開始日を越えて直書きが誤りになるため、
      // その時点で注記（locales の basicInfo/wakuInfo.periodCaveat、
      // beforeInfo.detailTableNote、termHints.js、RacerPerformanceStats.jsx）を見直す
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - 730);
      const cutoffStr = cutoffDate.toISOString().split("T")[0];

      const { data: entries, error: entriesError } = await supabase
        .from("race_entries")
        .select("race_id, boat_number")
        .eq("racer_id", racerId)
        .gte("race_id", cutoffStr);

      if (entriesError || !entries || entries.length === 0) {
        if (entriesError)
          console.error("race_entries取得エラー:", entriesError.message);
        return [];
      }

      const raceIds = [...new Set(entries.map((e) => e.race_id))];
      const [raceRows, resultRows] = await Promise.all([
        fetchAllByIn("races", "race_id, venue_code", "race_id", raceIds),
        fetchAllByIn(
          "race_results",
          "race_id, rank1, rank2, rank3, is_cancelled, is_no_race",
          "race_id",
          raceIds,
        ),
      ]);

      const venueByRaceId = new Map(
        raceRows.map((r) => [r.race_id, r.venue_code]),
      );
      const resultByRaceId = new Map(resultRows.map((r) => [r.race_id, r]));

      const byVenue = new Map();
      entries.forEach((entry) => {
        const venueCode = venueByRaceId.get(entry.race_id);
        const result = resultByRaceId.get(entry.race_id);
        if (!venueCode || !isUsableRaceResult(result)) return;

        if (!byVenue.has(venueCode)) {
          byVenue.set(venueCode, { total: 0, wins: 0, top2: 0, top3: 0 });
        }
        const stat = byVenue.get(venueCode);
        stat.total += 1;
        if (result.rank1 === entry.boat_number) stat.wins += 1;
        if (isPlaceHit(entry.boat_number, result.rank1, result.rank2)) {
          stat.top2 += 1;
        }
        if (
          isShowHit(entry.boat_number, result.rank1, result.rank2, result.rank3)
        ) {
          stat.top3 += 1;
        }
      });

      return [...byVenue.entries()]
        .map(([venueCode, stat]) => ({
          venue_code: venueCode,
          total_races: stat.total,
          win_rate: stat.total > 0 ? stat.wins / stat.total : null,
          top2_rate: stat.total > 0 ? stat.top2 / stat.total : null,
          top3_rate: stat.total > 0 ? stat.top3 / stat.total : null,
        }))
        .filter((row) => row.total_races >= 5)
        .sort((a, b) => b.total_races - a.total_races);
    });
  },

  /**
   * 指定選手の過去2年分の出走履歴を、レース詳細ページ「基本情報」タブ
   * （BOA-306）の会場/グレード/期間フィルタ用にフラットな形で1回だけ取得する。
   * getRacerVenueStats/getRacerRaceHistoryと同じ「対象は1選手のみなのでその場で
   * ライブ集計する」方式（BOA-303が問題視する全選手×全会場の横断集計とは
   * スコープが異なる）。フィルタの絞り込み・集計自体はクライアント側の
   * aggregateBasicInfoStats（basicInfoStats.js）が担い、この関数はracerId単位で
   * キャッシュ可能な生データの取得のみ担当する
   *
   * 2026-09-16追記(BOA-304、直前情報タブ): actualCourse（実進入コース、BOA-257の
   * race_results.actual_course_N）とisFastestExhibition（当該レースで自分の
   * 展示タイムが単独最速だったか）を追加した。直前情報タブの「平均進入順」
   * 「展示タイム1位勝率」が、基本情報タブと同じこの生データを再利用して
   * クライアント側で集計する（beforeInfoStats.js）。同着最速は
   * scripts/daily/update-exhibition-time-top-stats.jsの既存集計と同じ規約で
   * スキップする（isFastestExhibitionをnullにし分母から除外）
   *
   * 2026-09-16追記(BOA-333「直近5走」レビュー指摘): raceTitle/raceStage
   * （race_conditions）とwinningTechnique/payoutWin（race_results）を追加した。
   * 「直近5走」がgetRacerRaceHistory()由来のRaceHistoryTable（BOA-159）と
   * 同じ列を表示するようになったため、この関数もそれと同じ列を取得する必要が
   * 生じたため（元々はBOA-306の勝率/2連対率/3連対率/平均ST集計にしか
   * 使っておらず不要だった）
   */
  getRacerScopedRaceStats(racerId) {
    // v2: 条件別タブ（phase a FR-2）のために waveHeight / seriesDay / isFinalDay を
    // 足したので版を上げる。古い形のキャッシュが返ると、これらが undefined になって
    // 「波5cm以上 n=0」のような誤った値が出る。このキーは inferTtlFromKey に
    // マッチせず30分TTLなので、旧エントリが残る窓は最大30分
    // v3: 今節タブの展示タイム推移（phase a FR-3のPhase A）のために
    // exhibitionTime を足した。同じ理由で版を上げる
    // v4: 展示は絶対値でなく同レース内の順位で見ることにしたので
    // exhibitionRank を足した（水面の影響を相殺するため）
    // v5: 欠場（absent）を足した（BOA-504）
    return withCache(`racer-scoped-race-stats-v5-${racerId}`, async () => {
      if (!supabase) {
        console.error("Supabase client not initialized");
        return [];
      }

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - 730);
      const cutoffStr = cutoffDate.toISOString().split("T")[0];

      // gradeはST考察のベースライン（st_course_baselineの(course, grade)セル）を
      // 引くのに使う（phase a FR-1）。race_entries.gradeは実測でnull 0件・4値（A1/A2/B1/B2）
      const { data: entries, error: entriesError } = await supabase
        .from("race_entries")
        .select("race_id, boat_number, grade, f_count")
        .eq("racer_id", racerId)
        .gte("race_id", cutoffStr);

      if (entriesError || !entries || entries.length === 0) {
        if (entriesError)
          console.error("race_entries取得エラー:", entriesError.message);
        return [];
      }

      const raceIds = [...new Set(entries.map((e) => e.race_id))];
      // race_gradeはraces側のカラム（race_conditions側は017マイグレーションで
      // 削除済み）。race_conditions.series_day/is_final_dayは**下記で取得する**。
      // 以前ここには「generate-predictions.jsが常にnullを書くため取得しない」と
      // 書いてあったが、BOA-226（update-race-info.jsのscrapeSeriesDay()）と
      // BOA-390のバックフィルで埋まり、条件別タブ（phase a FR-2）の初日・最終日行が
      // 実際にこの2列を読んでいる（2026-09-28実測で2026-02-01以降
      // 36,607/36,629行＝99.94%。残る22行は当日＝スクレイプ前の分）。
      // ただし2025-12は12行・2026-01は0行で、選手の窓の前半はrace_conditionsの
      // 行そのものが無い（BOA-498）。
      // rank4〜6はBOA-238で追加（過去データは未バックフィルのためnullのままの
      // 行がある）。start_timingは平均ST（BOA-306フィードバック#1で会場/グレード
      // フィルタ対応が必要になったため追加、race_start_timingsから取得）。
      // actual_course_1〜6はBOA-257（Kファイル方式の実進入コース、2025-12-04以降
      // のみバックフィル済み）
      const [
        raceRows,
        resultRows,
        startTimingRows,
        exhibitionRows,
        conditionRows,
      ] = await Promise.all([
        fetchAllByIn(
          "races",
          "race_id, race_date, venue_code, race_grade",
          "race_id",
          raceIds,
        ),
        fetchAllByIn(
          "race_results",
          "race_id, rank1, rank2, rank3, rank4, rank5, rank6, is_cancelled, is_no_race, actual_course_1, actual_course_2, actual_course_3, actual_course_4, actual_course_5, actual_course_6, winning_technique, payout_win",
          "race_id",
          raceIds,
        ),
        fetchAllByIn(
          "race_start_timings",
          // finish_mark: 欠場の走を「着外」でなく「欠場」と出すため（BOA-504）
          "race_id, boat_number, start_timing, is_flying, finish_mark",
          "race_id",
          raceIds,
        ),
        // 展示タイム1位判定には自艇だけでなく同レースの全艇分が必要
        fetchAllByIn(
          "exhibition_data",
          "race_id, boat_number, exhibition_time",
          "race_id",
          raceIds,
        ),
        // レース名・レース種別（「直近5走」表示用、BOA-333レビュー指摘）。
        // 勝率/2連対率/3連対率/平均ST/得意会場等の既存機能はこのクエリに依存
        // していないため、ここだけ失敗してもPromise.all全体を巻き込んで
        // 既存機能まで空にしないよう、個別にcatchしてフォールバックする
        fetchAllByIn(
          "race_conditions",
          "race_id, race_stage, race_title, wave_height, series_day, is_final_day",
          "race_id",
          raceIds,
        ).catch((err) => {
          console.error(
            "race_conditions取得エラー（レース名・種別は「-」表示にフォールバック）:",
            err?.message ?? String(err),
          );
          // [] ではなく null を返す。[] だと「取得できなかった」と「その期間は
          // race_conditions の行が無い」が区別できず、条件別タブ（FR-2）が
          // 波・初日・最終日の行に誤った n=0 を出してしまう（.claude/rules/
          // frontend-data-fetch.md §2）。null のときは該当行ごと出さない
          return null;
        }),
      ]);

      const raceById = new Map(raceRows.map((r) => [r.race_id, r]));
      const resultById = new Map(resultRows.map((r) => [r.race_id, r]));
      const startTimingByKey = new Map(
        startTimingRows.map((r) => [`${r.race_id}-${r.boat_number}`, r]),
      );
      // ST考察（FR-1）用: レース単位で全艇分のSTをまとめ、Fを除いた
      // 「ST順1位」「ST順位」「内側艇の最速ST」を求める。生の6艇分の配列は
      // 返り値に出さず、派生値だけを各行に載せる（返り値のサイズを増やさないため。
      // Fの除外規則は src/utils/stConsideration.js に閉じ込める）
      const stRowsByRace = new Map();
      startTimingRows.forEach((r) => {
        if (!stRowsByRace.has(r.race_id)) stRowsByRace.set(r.race_id, []);
        stRowsByRace.get(r.race_id).push(r);
      });
      const stContextByRace = new Map();
      stRowsByRace.forEach((rows, raceId) => {
        stContextByRace.set(
          raceId,
          deriveRaceStContext(rows, resultById.get(raceId)),
        );
      });
      // conditionRows が null＝取得失敗。Mapを作らず、各行の派生値を
      // undefined のままにして「未取得」を下流へ伝える
      const conditionsUnavailable = conditionRows === null;
      const conditionById = new Map(
        (conditionRows ?? []).map((r) => [r.race_id, r]),
      );
      const exhibitionRowsByRace = new Map();
      exhibitionRows.forEach((r) => {
        if (r.exhibition_time === null || r.exhibition_time === undefined)
          return;
        if (!exhibitionRowsByRace.has(r.race_id))
          exhibitionRowsByRace.set(r.race_id, []);
        exhibitionRowsByRace.get(r.race_id).push(r);
      });

      // レースごとに「単独最速だった艇番」を判定する（同着は対象艇なしとしてスキップ、
      // scripts/daily/update-exhibition-time-top-stats.jsと同じ規約）
      const soleFastestBoatByRace = new Map();
      exhibitionRowsByRace.forEach((rows, raceId) => {
        const minTime = Math.min(...rows.map((r) => r.exhibition_time));
        const fastest = rows.filter((r) => r.exhibition_time === minTime);
        if (fastest.length === 1) {
          soleFastestBoatByRace.set(raceId, fastest[0].boat_number);
        }
      });

      return entries
        .map((entry) => {
          const race = raceById.get(entry.race_id);
          const result = resultById.get(entry.race_id);
          if (!race || !isUsableRaceResult(result)) return null;
          const st = startTimingByKey.get(
            `${entry.race_id}-${entry.boat_number}`,
          );
          const hasExhibitionData = exhibitionRowsByRace.has(entry.race_id);
          const soleFastestBoat = soleFastestBoatByRace.get(entry.race_id);
          const condition = conditionById.get(entry.race_id);
          const stContext = stContextByRace.get(entry.race_id);
          const stDerived = stContext?.byBoat.get(entry.boat_number);
          return {
            raceId: entry.race_id,
            date: race.race_date,
            venueCode: race.venue_code,
            boatNumber: entry.boat_number,
            // racesの約76%のみrace_grade取得済み（2026-09-15確認）。
            // 未取得レースはグレードフィルタ「全レース」時のみ集計対象に含める
            raceGrade: race.race_grade ?? null,
            raceTitle: condition?.race_title ?? null,
            raceStage: condition?.race_stage ?? null,
            // 条件別タブ（phase a FR-2）。取得失敗時は undefined のままにして
            // 「未取得」を伝え、欠測（null）と区別する
            waveHeight: conditionsUnavailable
              ? undefined
              : (condition?.wave_height ?? null),
            // 節の何日目か／最終日か。公式サイトの日程タブ由来（BOA-226）で
            // 2026-02-03以降99.0%が埋まっている。race_series（月間スケジュール）
            // とは3,014 venue-dayで100%一致することを実装前に確認済み
            seriesDay: conditionsUnavailable
              ? undefined
              : (condition?.series_day ?? null),
            isFinalDay: conditionsUnavailable
              ? undefined
              : (condition?.is_final_day ?? null),
            rank1: result.rank1,
            rank2: result.rank2,
            rank3: result.rank3,
            rank4: result.rank4 ?? null,
            rank5: result.rank5 ?? null,
            rank6: result.rank6 ?? null,
            // 決まり手・単勝配当（「直近5走」表示用、BOA-333レビュー指摘）。
            // 1着以外では意味を持たないが、判定はRaceHistoryTable側（finishRank
            // ===1の行のみ表示）に委ね、ここでは生値をそのまま渡す
            winningTechnique: result.winning_technique ?? null,
            payoutWin: result.payout_win ?? null,
            // フライングは異常値のため平均ST計算から除外する（RaceResult.jsx等と
            // 同じ扱い）。未計測・未取得レースはnullのまま
            // 欠場（本番STの行の着順が「欠」）。履歴の表で「着外」と区別する（BOA-504）
            // 本番STの行そのものが無い欠場もある（他の艇の行はあるのに自艇だけ無い。
            // 2026-06-13 浜名湖5R・12Rの中岡正彦）。着順が付いた走は表示側が着順を
            // 優先するので、ここで欠場扱いにしても「着順あり」の走は変わらない
            absent:
              isAbsentStartRow(st) || (!st && stRowsByRace.has(entry.race_id)),
            startTiming:
              st && !st.is_flying && st.start_timing != null
                ? st.start_timing
                : null,
            // 実進入コース（BOA-257）。2025-12-04より前のレースや欠場艇はnull
            actualCourse: result[`actual_course_${entry.boat_number}`] ?? null,
            // 級別（そのレース時点の値）。ST考察のベースラインを(course, grade)で引く
            grade: entry.grade ?? null,
            // 自艇の展示タイム。展示1位判定のために同レース全艇分を既に
            // 取得しているので、そこから拾うだけ（追加クエリ0本）。
            // 今節タブの「展示タイムの推移」（FR-3 Phase A）で使う
            exhibitionTime:
              exhibitionRowsByRace
                .get(entry.race_id)
                ?.find((r) => r.boat_number === entry.boat_number)
                ?.exhibition_time ?? null,
            // 同じレースの中での展示タイム順位（1が最速）。
            // **絶対値の推移は水面の影響を拾う**——桐生の会場平均は
            // 2026-09-20〜25で 6.763〜6.865 と日によって0.10秒動いており、
            // 「+0.03で下向き」のような判定は水面が重い日に全艇へ出てしまう。
            // 同じレース内の順位なら、その日の水面の影響が相殺される
            exhibitionRank: (() => {
              const rows = exhibitionRowsByRace.get(entry.race_id);
              const mine = rows?.find(
                (r) => r.boat_number === entry.boat_number,
              )?.exhibition_time;
              if (!rows || mine === null || mine === undefined) return null;
              // 同着は同順位（1,1,3…）。展示は小数2桁で同着が起きる
              return rows.filter((r) => r.exhibition_time < mine).length + 1;
            })(),
            // そのレース時点の出走表に載っていた今期のF数（phase a FR-2の
            // 「F持ち時」「F無し時」の行）。null の走は母数から落ちる。
            // 充足の内訳（2026-09-25実測）:
            //   2025-12-03〜2026-02-14 … N19（racelist-backfill.js）が夜間に実行中
            //   2026-02-15〜2026-09-20 … **埋める計画が無い**（BOA-417で起票）
            //   2026-09-21〜           … 日次の生取得でほぼ100%
            // K/Bアーカイブからは埋められない（Kファイルは今期F数のような累積を
            // 持たず、レース限りのF/Lフラグだけ。導出を試して完全一致率約5%で
            // 不採用になっている。pre-race-full-fields/plan.md §6.1）
            fCount: entry.f_count ?? null,
            // ST考察（FR-1）の派生値。Fは stForRank を null にし、raceBestSt /
            // innerMinSt / stRank の算出からも外す（符号反転はしない。ADR-0068 却下5）
            isFlying: st?.is_flying === true,
            stForRank: stDerived?.stForRank ?? null,
            raceBestSt: stContext?.raceBestSt ?? null,
            innerMinSt: stDerived?.innerMinSt ?? null,
            stRank: stDerived?.stRank ?? null,
            // 当該レースで自艇の展示タイムが単独最速だったか。同着・データ欠落は
            // nullにし、集計時に分母から除外する（isFastestExhibition===trueの
            // 件数のみで「展示1位だった時の1着率」等を計算する）
            isFastestExhibition: hasExhibitionData
              ? soleFastestBoat !== undefined
                ? soleFastestBoat === entry.boat_number
                : null
              : null,
          };
        })
        .filter(Boolean)
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    });
  },

  /**
   * 指定選手の「今節（同一モーターが連続して割り当てられている、当該レースより
   * 前の直近開催日）」の展示タイム推移を取得する（BOA-304、直前情報タブ
   * 「今節展示情報」）。racerService.getCurrentMeetRaceEntriesと同じ節判定
   * （groupIntoCurrentMeet、race_idの日付連続性）を使うが、あちらは常に
   * 「選手の絶対最新の節」を返すのに対し、こちらはbeforeRaceIdより前の節を
   * 返す点が異なる（過去日付のレース詳細ページを閲覧した場合に、選手の
   * 最新（未来）の節を誤って表示しないため）
   * `boatNumber` も返す（追加クエリ0本）。オリジナル展示（BOA-473）は
   * `(race_id, boat_number)` で引くため、呼び出し側がこの2つを組にして使う。
   * @returns {Promise<Array<{raceId: string, boatNumber: number, exhibitionTime: number|null}>>} 昇順（古い→新しい）
   */
  getRacerMeetExhibitionTrendBefore(racerId, motorNumber, beforeRaceId) {
    return withCache(
      `racer-meet-exhibition-trend-${racerId}-${motorNumber}-${beforeRaceId}`,
      async () => {
        if (!supabase || !racerId || !motorNumber || !beforeRaceId) return [];

        const { data: entries, error } = await supabase
          .from("race_entries")
          .select("race_id, boat_number")
          .eq("racer_id", racerId)
          .eq("motor_number", motorNumber)
          .lt("race_id", beforeRaceId)
          .order("race_id", { ascending: false })
          .limit(30);

        if (error) {
          console.error("今節展示情報（出走履歴）取得エラー:", error.message);
          return [];
        }
        if (!entries || entries.length === 0) return [];

        const sorted = [...entries].sort((a, b) =>
          a.race_id.localeCompare(b.race_id),
        );
        const meet = groupIntoCurrentMeet(sorted);
        const raceIds = meet.map((e) => e.race_id);

        const exhibitionRows = await fetchAllByIn(
          "exhibition_data",
          "race_id, boat_number, exhibition_time",
          "race_id",
          raceIds,
        );
        const exhibitionByKey = new Map(
          exhibitionRows.map((r) => [
            `${r.race_id}-${r.boat_number}`,
            r.exhibition_time,
          ]),
        );

        return meet.map((e) => ({
          raceId: e.race_id,
          boatNumber: e.boat_number,
          exhibitionTime:
            exhibitionByKey.get(`${e.race_id}-${e.boat_number}`) ?? null,
        }));
      },
    );
  },

  /**
   * 今節のオリジナル展示（一周・半周ラップ・まわり足・直線）を、**レースIDの集合に対して
   * 1クエリ**で引く（[BOA-473](https://linear.app/boat-ai/issue/BOA-473) / phase a FR-4b の続き）。
   *
   * ## なぜ選手ごとではなく集合で引くか
   *
   * 直前情報タブの「今節展示情報」は選手ごとに
   * `getRacerMeetExhibitionTrendBefore` を呼ぶ（6選手 × 2クエリ）。同じ形で
   * オリジナル展示も選手ごとに引くと **+6本**になり、非機能要件（1タブあたり+3本以内）を
   * 超える。6選手の今節はほぼ同じレース集合なので、**IDを束ねて1本**にする。
   *
   * ## なぜ「今節展示情報」に出すのか
   *
   * 直前情報タブの「展示情報」に出しているオリジナル展示（BOA-452）は、**そのレースの
   * 展示が発表されてからしか出ない**（発走30〜10分前）。それまでの間、機力の内訳は
   * 画面に何も無い。ボートレース日和は同じ画面に「今節展示情報」として前走と節平均を
   * 併記していて、**締切前に読めるのはこちらだけ**。
   *
   * 戻り値の `state` は `getRaceOriginalExhibition` と同じ規約:
   *   "published" 値がある / "empty" まだ無い / "forbidden" 匿名に権限が無い（096未適用）
   * 終端でない状態には `fetchFailed: true` を付けて `withCache` に焼き付けない。
   *
   * @param {string[]} raceIds 今節のレースID（表示中のレースより前）
   * @returns {Promise<{state: string, byKey: Object<string, Object<string, number>>}>}
   *   `byKey` のキーは `` `${raceId}-${boatNumber}` ``、値は `{ 一周: 36.9, ... }`
   */
  getMeetOriginalExhibitionByRaceBoat(raceIds) {
    const ids = [...new Set(raceIds ?? [])].filter(Boolean).sort();
    if (ids.length === 0) {
      return Promise.resolve({ state: "empty", byKey: {}, fetchFailed: true });
    }
    // **IDを全部キーに入れる**。件数＋最後のIDだけだと、同じ節・同じ最終レースで
    // 中身の違う集合（選手の顔ぶれが変わって別のレースが混ざる等）が同じキーに
    // なりうる。全部繋ぐと末尾が `YYYY-MM-DD-VV-RR` のままなので、
    // inferTtlFromKey の過去レース判定（7日TTL）もそのまま効く
    return withCache(`meet-original-exhibition-${ids.join(",")}`, async () => {
      if (!supabase) {
        throw new Error("Supabase client not initialized");
      }
      let rows;
      try {
        rows = await fetchAllByIn(
          "race_original_exhibition_values",
          "race_id, boat_number, kind, value",
          "race_id",
          ids,
        );
      } catch (error) {
        if (isPermissionDeniedError(error)) {
          // 096（匿名へのSELECT公開）が未適用なら行ごと出さない
          return { state: "forbidden", byKey: {}, fetchFailed: true };
        }
        throw error;
      }

      const byKey = {};
      (rows ?? []).forEach((row) => {
        // 欠測（BOATCASTの `--.--`）は NULL で入る。平均の分母に入れない
        if (row.value === null || row.value === undefined) return;
        const key = `${row.race_id}-${row.boat_number}`;
        byKey[key] = { ...(byKey[key] ?? {}), [row.kind]: Number(row.value) };
      });

      if (Object.keys(byKey).length === 0) {
        return { state: "empty", byKey: {}, fetchFailed: true };
      }
      return { state: "published", byKey };
    });
  },

  /**
   * 指定選手の過去2年分の出走履歴を、会場×枠番クロス集計用にフラットな形で
   * 1回だけ取得する（選手個人ページの会場×枠番フィルタ用）。
   * venueCode/boatNumberによる絞り込みは行わない（=racerIdだけでキャッシュ
   * できる）。フィルタ変更のたびに毎回re-fetchするのではなく、この関数を
   * racerId単位で1回だけ呼び、絞り込み・集計はaggregateRacerVenueBoatStats
   * （同ファイル内のプレーン関数）でクライアント側メモリ上に行う設計にして
   * いる（フィルタ操作をネットワークI/O無しの即時計算にするため）。
   * 中止・不成立レース（is_cancelled/is_no_race）とrank1未確定行は
   * ここで除外し、以降の集計側では意識しなくて済むようにする
   */
  getRacerRaceHistory(racerId) {
    return withCache(`racer-race-history-${racerId}`, async () => {
      if (!supabase) {
        console.error("Supabase client not initialized");
        return [];
      }

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - 730);
      const cutoffStr = cutoffDate.toISOString().split("T")[0];

      const { data: entries, error: entriesError } = await supabase
        .from("race_entries")
        .select("race_id, boat_number")
        .eq("racer_id", racerId)
        .gte("race_id", cutoffStr);

      if (entriesError || !entries || entries.length === 0) {
        if (entriesError)
          console.error("race_entries取得エラー:", entriesError.message);
        return [];
      }

      const raceIds = [...new Set(entries.map((e) => e.race_id))];
      const [raceRows, resultRows, exhibitionRows, conditionRows] =
        await Promise.all([
          fetchAllByIn(
            "races",
            "race_id, venue_code, race_grade",
            "race_id",
            raceIds,
          ),
          fetchAllByIn(
            "race_results",
            "race_id, rank1, rank2, rank3, rank4, rank5, rank6, winning_technique, payout_win, payout_place_1, payout_place_2, is_cancelled, is_no_race",
            "race_id",
            raceIds,
          ),
          fetchAllByIn(
            "exhibition_data",
            "race_id, boat_number, exhibition_time, start_timing",
            "race_id",
            raceIds,
          ),
          fetchAllByIn(
            "race_conditions",
            "race_id, race_stage, race_title",
            "race_id",
            raceIds,
          ),
        ]);

      const raceInfoByRaceId = new Map(raceRows.map((r) => [r.race_id, r]));
      const resultByRaceId = new Map(resultRows.map((r) => [r.race_id, r]));
      const exhibitionByKey = new Map(
        exhibitionRows.map((e) => [`${e.race_id}-${e.boat_number}`, e]),
      );
      const conditionByRaceId = new Map(
        conditionRows.map((c) => [c.race_id, c]),
      );

      return entries
        .map((entry) => {
          const raceInfo = raceInfoByRaceId.get(entry.race_id);
          const result = resultByRaceId.get(entry.race_id);
          const exhibition = exhibitionByKey.get(
            `${entry.race_id}-${entry.boat_number}`,
          );
          const condition = conditionByRaceId.get(entry.race_id);
          if (!raceInfo?.venue_code || !isUsableRaceResult(result)) return null;
          return {
            raceId: entry.race_id,
            venueCode: raceInfo.venue_code,
            raceGrade: raceInfo.race_grade ?? null,
            raceStage: condition?.race_stage ?? null,
            raceTitle: condition?.race_title ?? null,
            boatNumber: entry.boat_number,
            rank1: result.rank1,
            rank2: result.rank2,
            rank3: result.rank3,
            rank4: result.rank4,
            rank5: result.rank5,
            rank6: result.rank6,
            winningTechnique: result.winning_technique ?? null,
            payoutWin: result.payout_win ?? null,
            payoutPlace1: result.payout_place_1 ?? null,
            payoutPlace2: result.payout_place_2 ?? null,
            exhibitionTime: exhibition?.exhibition_time ?? null,
            startTiming: exhibition?.start_timing ?? null,
          };
        })
        .filter(Boolean)
        .sort((a, b) => a.raceId.localeCompare(b.raceId));
    });
  },

  /**
   * 指定選手の過去180日間の枠番別回収率を取得する（選手個人ページ用）
   * getRaceRacerBoatReturnRateと同じ集計ロジック（racer_id+boat_numberキー）を
   * racer_id単体向けに転用したもの。対象が1選手のみのためRPC化は不要
   */
  getRacerBoatReturnRate(racerId) {
    return withCache(`racer-boat-return-rate-${racerId}`, async () => {
      if (!supabase) {
        console.error("Supabase client not initialized");
        return [];
      }

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - 180);
      const cutoffStr = cutoffDate.toISOString().split("T")[0];

      const { data: entries, error: entriesError } = await supabase
        .from("race_entries")
        .select("race_id, boat_number")
        .eq("racer_id", racerId)
        .gte("race_id", cutoffStr);

      if (entriesError || !entries || entries.length === 0) {
        if (entriesError)
          console.error("race_entries取得エラー:", entriesError.message);
        return [];
      }

      const raceIds = [...new Set(entries.map((e) => e.race_id))];
      const resultRows = await fetchAllByIn(
        "race_results",
        "race_id, rank1, rank2, payout_win, payout_place_1, payout_place_2, is_cancelled, is_no_race",
        "race_id",
        raceIds,
      );
      const resultByRaceId = new Map(resultRows.map((r) => [r.race_id, r]));

      // boat_numberごとに集計（同じ選手でも枠番が違えば別集計）
      const statsByBoat = new Map();
      entries.forEach((e) => {
        const result = resultByRaceId.get(e.race_id);
        if (!result || result.is_cancelled || result.is_no_race) return;

        if (!statsByBoat.has(e.boat_number)) {
          statsByBoat.set(e.boat_number, {
            sampleCount: 0,
            winPayoutSum: 0,
            placePayoutSum: 0,
          });
        }
        const stats = statsByBoat.get(e.boat_number);
        stats.sampleCount += 1;

        if (result.rank1 === e.boat_number) {
          stats.winPayoutSum += result.payout_win ?? 0;
          stats.placePayoutSum += result.payout_place_1 ?? 0;
        } else if (result.rank2 === e.boat_number) {
          stats.placePayoutSum += result.payout_place_2 ?? 0;
        }
      });

      return [...statsByBoat.entries()]
        .map(([boatNumber, stats]) => ({
          boat_number: boatNumber,
          sample_count: stats.sampleCount,
          win_return_rate: toReturnRate(stats.winPayoutSum, stats.sampleCount),
          place_return_rate: toReturnRate(
            stats.placePayoutSum,
            stats.sampleCount,
          ),
        }))
        .sort((a, b) => a.boat_number - b.boat_number);
    });
  },

  /**
   * 指定会場・モーター番号の2連率/3連率の節ごとの推移を取得する（BOA-151）
   * race_entries.motor_2rate/3rate は節単位でのみ更新されるため、
   * 日付単位でdedupeして推移として扱う
   */
  getMotorConditionTrend(
    venueCode,
    motorNumber,
    days = 90,
    beforeRaceId = null,
  ) {
    return withCache(
      // v2: 展示タイム(exhibition_time)を追加(BOA-265軸B)。旧キャッシュ形状には
      // 無いフィールドのため、旧キーのままだと古いキャッシュがしばらく残ってしまう。
      // daysも末尾以外に含める（BOA-283の期間切り替え）
      // v3: 期間を現行モーターの世代で切り詰め、generationUnknown・
      // clippedByGenerationを追加（BOA-329）
      `motor-condition-v3-${venueCode}-${motorNumber}-${days}${beforeKey(beforeRaceId)}`,
      async () => {
        const { window, series } = await fetchMotorDailySeries(
          venueCode,
          motorNumber,
          days,
          beforeRaceId,
        );
        return {
          venue_code: venueCode,
          motor_number: motorNumber,
          generationUnknown: window?.generationStart === null,
          clippedByGeneration: window?.clippedByGeneration ?? false,
          trend: series.map((d) => ({
            date: d.date,
            motor_2rate: d.motor_2rate,
            motor_3rate: d.motor_3rate,
            exhibition_time: d.exhibitionTime,
          })),
        };
      },
    );
  },

  /**
   * 指定モーターのプロペラ交換・部品交換の履歴を取得する（BOA-221）
   * 単独では「機力低下のサイン」にも「整備直後の好転サイン」にもなり得るため
   * （チケット参照）、イベント前後の展示タイム平均を比較し、方向感の目安
   * （improved/declined/neutral）を自動判定して添える。展示タイムは日次の
   * 実測値で、motor_2rate（公式サイトの「モーター交換時からの累積」値）と違い
   * イベント前後で単純比較できるため、この目的にはこちらを使う
   */
  getMotorPartsHistory(venueCode, motorNumber, days = 90, beforeRaceId = null) {
    return withCache(
      // v2: 期間を現行モーターの世代で切り詰める（BOA-329）
      // v3: 交換が記録されたレース番号（raceNos）を追加（BOA-513）
      `motor-parts-history-v3-${venueCode}-${motorNumber}-${days}${beforeKey(beforeRaceId)}`,
      async () => {
        const { series: dateSeries } = await fetchMotorDailySeries(
          venueCode,
          motorNumber,
          days,
          beforeRaceId,
        );

        const avgOf = (list) => {
          const values = list
            .map((d) => d.exhibitionTime)
            .filter((v) => v !== null);
          return values.length > 0
            ? values.reduce((sum, v) => sum + v, 0) / values.length
            : null;
        };

        const events = [];
        dateSeries.forEach((d, i) => {
          if (!d.propellerChanged && !(d.parts && d.parts.length > 0)) return;

          const before = avgOf(
            dateSeries.slice(Math.max(0, i - INTERPRETATION_WINDOW_DAYS), i),
          );
          const after = avgOf(
            dateSeries.slice(i + 1, i + 1 + INTERPRETATION_WINDOW_DAYS),
          );
          let interpretation = null;
          if (before !== null && after !== null) {
            // 展示タイムは速いほど良い（小さいほど良い）ため、after<beforeは好転
            const diff = before - after;
            if (Math.abs(diff) >= NEUTRAL_EXHIBITION_DIFF_SEC) {
              interpretation = diff > 0 ? "improved" : "declined";
            } else {
              interpretation = "neutral";
            }
          }
          events.push({
            date: d.date,
            raceNos: d.eventRaceNos ?? [],
            propellerChanged: d.propellerChanged,
            parts: d.parts,
            interpretation,
          });
        });

        return {
          venue_code: venueCode,
          motor_number: motorNumber,
          events,
        };
      },
    );
  },

  /**
   * 指定レースの枠番別・展示ST/本番STのズレ（安定度）を取得する（BOA-153）
   * 展示STが本番の参考になるか（ズレが小さいほど安定）を選手ごとの過去実績から示す
   */
  getRaceStPredictabilityBreakdown(raceId) {
    return withCache(`race-st-predictability-${raceId}`, async () => {
      if (!supabase) {
        console.error("Supabase client not initialized");
        return [];
      }

      // RPC優先（サーバー側集計でegressを約1/25に削減、029マイグレーション）。
      // 未適用環境では旧クライアント集計にフォールバックする
      const { data: rpcData, error: rpcError } = await supabase.rpc(
        "get_race_st_predictability",
        { p_race_id: raceId },
      );
      if (!rpcError && Array.isArray(rpcData)) {
        return rpcData;
      }
      if (rpcError) {
        console.warn(
          "get_race_st_predictability RPC未適用のため旧ロジックで取得:",
          rpcError.message,
        );
      }

      const { data: entries, error: entriesError } = await supabase
        .from("race_entries")
        .select("boat_number, player_name, racer_id")
        .eq("race_id", raceId)
        .order("boat_number");

      if (entriesError || !entries || entries.length === 0) {
        if (entriesError)
          console.error("race_entries取得エラー:", entriesError.message);
        return [];
      }

      const { data: todaysExhibition } = await supabase
        .from("exhibition_data")
        .select("boat_number, start_timing")
        .eq("race_id", raceId);
      const exhibitionByBoat = new Map(
        (todaysExhibition ?? []).map((e) => [e.boat_number, e.start_timing]),
      );

      const racerIds = [...new Set(entries.map((r) => r.racer_id))].filter(
        (id) => id !== null,
      );
      if (racerIds.length === 0) {
        return entries.map((row) => ({
          ...row,
          exhibition_st: exhibitionByBoat.get(row.boat_number) ?? null,
          avg_deviation: null,
          sample_count: 0,
        }));
      }

      // 過去90日、当該レースより前の出走を選手ごとに収集
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
      const cutoffStr = ninetyDaysAgo.toISOString().split("T")[0];

      const { data: pastEntries, error: pastError } = await supabase
        .from("race_entries")
        .select("race_id, boat_number, racer_id")
        .in("racer_id", racerIds)
        .gte("race_id", cutoffStr)
        .lt("race_id", raceId);

      if (pastError) {
        console.error("過去出走データ取得エラー:", pastError.message);
      }

      const pastRaceIds = [
        ...new Set((pastEntries ?? []).map((e) => e.race_id)),
      ];

      if (pastRaceIds.length === 0) {
        return entries.map((row) => ({
          ...row,
          exhibition_st: exhibitionByBoat.get(row.boat_number) ?? null,
          avg_deviation: null,
          sample_count: 0,
        }));
      }

      // race_id 1件につき最大6艇分の行があるため、in()のキー数だけでなく取得行数も
      // 1000行を超えうる。chunkArrayだけでは不十分なため.range()ページネーションで全件取得する
      const [actualRows, exhibitionRows] = await Promise.all([
        fetchAllByIn(
          "race_start_timings",
          "race_id, boat_number, start_timing, is_flying",
          "race_id",
          pastRaceIds,
        ),
        fetchAllByIn(
          "exhibition_data",
          "race_id, boat_number, start_timing",
          "race_id",
          pastRaceIds,
        ),
      ]);

      const actualByKey = new Map();
      actualRows.forEach((r) => {
        if (r.is_flying) return; // フライングは異常値のためズレ計算から除外
        actualByKey.set(`${r.race_id}-${r.boat_number}`, r.start_timing);
      });

      const exhibitionByKey = new Map();
      exhibitionRows.forEach((e) => {
        exhibitionByKey.set(`${e.race_id}-${e.boat_number}`, e.start_timing);
      });

      // 選手ごとに過去の |本番ST - 展示ST| を集計
      const deviationsByRacer = new Map();
      (pastEntries ?? []).forEach((e) => {
        const key = `${e.race_id}-${e.boat_number}`;
        const actual = actualByKey.get(key);
        const exhibition = exhibitionByKey.get(key);
        if (actual === undefined || exhibition === undefined) return;

        const deviation = Math.abs(actual - exhibition);
        if (!deviationsByRacer.has(e.racer_id)) {
          deviationsByRacer.set(e.racer_id, []);
        }
        deviationsByRacer.get(e.racer_id).push(deviation);
      });

      return entries.map((row) => {
        const deviations = deviationsByRacer.get(row.racer_id) ?? [];
        const avgDeviation =
          deviations.length > 0
            ? deviations.reduce((sum, d) => sum + d, 0) / deviations.length
            : null;
        return {
          ...row,
          exhibition_st: exhibitionByBoat.get(row.boat_number) ?? null,
          avg_deviation: avgDeviation,
          sample_count: deviations.length,
        };
      });
    });
  },

  /**
   * 指定選手の展示ST/本番STのズレの推移を取得する（BOA-153）
   * フライングは異常値のため除外。同日複数レースは平均してグラフ用に日付単位でまとめる
   */
  getStDeviationTrend(racerId) {
    return withCache(`st-deviation-trend-${racerId}`, async () => {
      if (!supabase) {
        console.error("Supabase client not initialized");
        return { racer_id: racerId, trend: [] };
      }

      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
      const cutoffStr = ninetyDaysAgo.toISOString().split("T")[0];

      const { data: pastEntries, error: entriesError } = await supabase
        .from("race_entries")
        .select("race_id, boat_number")
        .eq("racer_id", racerId)
        .gte("race_id", cutoffStr)
        .order("race_id");

      if (entriesError || !pastEntries || pastEntries.length === 0) {
        if (entriesError)
          console.error("race_entries取得エラー:", entriesError.message);
        return { racer_id: racerId, trend: [] };
      }

      const raceIds = pastEntries.map((e) => e.race_id);

      // race_id 1件につき最大6艇分の行があるため.range()ページネーションで全件取得する
      const [actualRows, exhibitionRows] = await Promise.all([
        fetchAllByIn(
          "race_start_timings",
          "race_id, boat_number, start_timing, is_flying",
          "race_id",
          raceIds,
        ),
        fetchAllByIn(
          "exhibition_data",
          "race_id, boat_number, start_timing",
          "race_id",
          raceIds,
        ),
      ]);

      const actualByKey = new Map();
      actualRows.forEach((r) => {
        if (r.is_flying) return;
        actualByKey.set(`${r.race_id}-${r.boat_number}`, r.start_timing);
      });

      const exhibitionByKey = new Map();
      exhibitionRows.forEach((e) => {
        exhibitionByKey.set(`${e.race_id}-${e.boat_number}`, e.start_timing);
      });

      // 日付単位で当日の平均ズレをまとめる
      const byDate = new Map();
      pastEntries
        .map((e) => ({ ...e, race_date: e.race_id.slice(0, 10) }))
        .sort((a, b) => a.race_date.localeCompare(b.race_date))
        .forEach((e) => {
          const key = `${e.race_id}-${e.boat_number}`;
          const actual = actualByKey.get(key);
          const exhibition = exhibitionByKey.get(key);
          if (actual === undefined || exhibition === undefined) return;

          const deviation = Math.abs(actual - exhibition);
          if (!byDate.has(e.race_date)) {
            byDate.set(e.race_date, []);
          }
          byDate.get(e.race_date).push(deviation);
        });

      const trend = [...byDate.entries()].map(([date, deviations]) => ({
        date,
        avg_deviation:
          deviations.reduce((sum, d) => sum + d, 0) / deviations.length,
      }));

      return { racer_id: racerId, trend };
    });
  },

  /**
   * 本日開催中のレースの出走選手について、直近90日間の平均展示タイム（周回タイム）を取得する（BOA-164）
   */
  getRaceExhibitionTimeBreakdown(raceId) {
    return withCache(`race-exhibition-time-breakdown-${raceId}`, async () => {
      if (!supabase) {
        console.error("Supabase client not initialized");
        return [];
      }

      // RPC優先（サーバー側集計でegressを約1/25に削減、029マイグレーション）。
      // 未適用環境では旧クライアント集計にフォールバックする
      const { data: rpcData, error: rpcError } = await supabase.rpc(
        "get_race_exhibition_trend",
        { p_race_id: raceId },
      );
      if (!rpcError && Array.isArray(rpcData)) {
        return rpcData;
      }
      if (rpcError) {
        console.warn(
          "get_race_exhibition_trend RPC未適用のため旧ロジックで取得:",
          rpcError.message,
        );
      }

      const { data: entries, error: entriesError } = await supabase
        .from("race_entries")
        .select("boat_number, player_name, racer_id")
        .eq("race_id", raceId)
        .order("boat_number");

      if (entriesError || !entries || entries.length === 0) {
        if (entriesError)
          console.error("race_entries取得エラー:", entriesError.message);
        return [];
      }

      const { data: todaysExhibition } = await supabase
        .from("exhibition_data")
        .select("boat_number, exhibition_time")
        .eq("race_id", raceId);
      const exhibitionByBoat = new Map(
        (todaysExhibition ?? []).map((e) => [e.boat_number, e.exhibition_time]),
      );

      const racerIds = [...new Set(entries.map((r) => r.racer_id))].filter(
        (id) => id !== null,
      );
      if (racerIds.length === 0) {
        return entries.map((row) => ({
          ...row,
          exhibition_time: exhibitionByBoat.get(row.boat_number) ?? null,
          avg_exhibition_time: null,
          sample_count: 0,
        }));
      }

      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
      const cutoffStr = ninetyDaysAgo.toISOString().split("T")[0];

      const { data: pastEntries, error: pastError } = await supabase
        .from("race_entries")
        .select("race_id, boat_number, racer_id")
        .in("racer_id", racerIds)
        .gte("race_id", cutoffStr)
        .lt("race_id", raceId);

      if (pastError) {
        console.error("過去出走データ取得エラー:", pastError.message);
      }

      const pastRaceIds = [
        ...new Set((pastEntries ?? []).map((e) => e.race_id)),
      ];

      if (pastRaceIds.length === 0) {
        return entries.map((row) => ({
          ...row,
          exhibition_time: exhibitionByBoat.get(row.boat_number) ?? null,
          avg_exhibition_time: null,
          sample_count: 0,
        }));
      }

      const exhibitionRows = await fetchAllByIn(
        "exhibition_data",
        "race_id, boat_number, exhibition_time",
        "race_id",
        pastRaceIds,
      );

      const exhibitionByKey = new Map();
      exhibitionRows.forEach((e) => {
        exhibitionByKey.set(`${e.race_id}-${e.boat_number}`, e.exhibition_time);
      });

      const timesByRacer = new Map();
      (pastEntries ?? []).forEach((e) => {
        const key = `${e.race_id}-${e.boat_number}`;
        const time = exhibitionByKey.get(key);
        if (time === undefined || time === null) return;

        if (!timesByRacer.has(e.racer_id)) {
          timesByRacer.set(e.racer_id, []);
        }
        timesByRacer.get(e.racer_id).push(time);
      });

      return entries.map((row) => {
        const times = timesByRacer.get(row.racer_id) ?? [];
        const avgTime =
          times.length > 0
            ? times.reduce((sum, t) => sum + t, 0) / times.length
            : null;
        return {
          ...row,
          exhibition_time: exhibitionByBoat.get(row.boat_number) ?? null,
          avg_exhibition_time: avgTime,
          sample_count: times.length,
        };
      });
    });
  },

  /**
   * 指定レースのチルト・調整重量・当日体重・前走成績・部品交換/プロペラ交換を
   * 取得する（BOA-221/BOA-289/BOA-304）。展示タイムと同じ行(exhibition_data)の
   * 別列で、履歴平均を出す必要が無い「今回のレースでの設定値・直近の実績値」の
   * ため、getRaceExhibitionTimeBreakdownのような過去90日平均フォールバックは
   * 不要。単純に該当race_idの1回読み取りで足りる
   *
   * propeller_change/parts_changedはtilt/adjustment_weightと同じマイグレーション
   * 056（BOA-221、既に全環境適用済み）の列のため、フォールバック対象には含めない。
   * BOA-289の新列（today_weight/prev_race_no/prev_entry_course/prev_start_timing/
   * prev_finish_rank、マイグレーション059）は未適用環境がありうる。1回のselectに
   * 未適用の列を含めると「column does not exist」でクエリ全体が失敗し、既に動作している
   * tilt/adjustment_weight/propeller_change/parts_changed（マイグレーション056）まで
   * 巻き添えで表示できなくなる。これを避けるため、失敗時は新列を除いた旧列のみで再取得する
   */
  getRaceMotorMaintenanceBreakdown(raceId) {
    // v3: 戻り値を配列から { state, rows } に変えた（BOA-497）。v2 は展示進入等の列を
    // 足したとき（BOA-485）。キーを変えないと localStorage に残った旧形（配列）が返る
    return withCache(`race-motor-maintenance-v3-${raceId}`, async () => {
      if (!supabase) {
        throw new Error("Supabase client not initialized");
      }

      // supabaseClient.js が .throwOnError() を既定で適用するため、取得エラーは例外になる。
      // 「新列が未適用」だけは旧列での再取得に倒したいので、ここで捕まえて分岐する
      // （それ以外のエラーはそのまま投げて、空配列＝「データなし」に化けさせない）
      let data;
      try {
        ({ data } = await supabase
          .from("exhibition_data")
          .select(
            // exhibition_course/is_absent/updated_at は直前情報タブの「展示進入」用
            // （BOA-485）。同じ行の別列なので、クエリ本数は増やさない（BOA-357）。
            // exhibition_time はキャッシュしてよいか（展示後か）の判定用（BOA-497）
            "boat_number, exhibition_time, tilt, adjustment_weight, propeller_change, parts_changed, today_weight, prev_race_no, prev_entry_course, prev_start_timing, prev_finish_rank, exhibition_course, is_absent, updated_at",
          )
          .eq("race_id", raceId));
      } catch (error) {
        if (!/column .* does not exist/i.test(error?.message ?? ""))
          throw error;
        console.warn(
          "exhibition_data: BOA-289の新列が未適用のため旧列のみで再取得します（マイグレーション059未適用の可能性）:",
          error.message,
        );
        const { data: legacyData } = await supabase
          .from("exhibition_data")
          .select(
            "boat_number, exhibition_time, tilt, adjustment_weight, propeller_change, parts_changed",
          )
          .eq("race_id", raceId);
        return toMaintenanceResult(legacyData ?? []);
      }

      return toMaintenanceResult(data ?? []);
    });
  },

  /**
   * 指定レースの出走表の体重（race_entries.weight_kg、マイグレーション081）を取得する（BOA-484）。
   *
   * 直前情報タブで、展示前（exhibition_data の行がまだ無い時点）に体重を出すために使う。
   * 公式の出走表の体重は、直前情報ページの体重と同じ時刻に公開され、値も一致する
   * （2026-09-23〜27の5,075艇で99.4%一致。差は展示の直前の再計量）。race_entries へは
   * 発走60分前の出走表の取得（race_info スロット）で入る。朝の初期化の時点では NULL。
   *
   * 戻り値:
   *   { state: "published", byBoat: { [boat_number]: number } }  1艇以上の体重がある
   *   { state: "empty", byBoat: {}, fetchFailed: true }            まだ公開されていない
   * empty はキャッシュさせない（fetchFailed。公開された後もリロードまで出なくなるため）。
   * 取得の失敗は例外のまま投げる（呼び出し側で「取得失敗」として扱う）
   */
  getRaceEntryWeights(raceId) {
    return withCache(`race-entry-weights-${raceId}`, async () => {
      if (!supabase) {
        throw new Error("Supabase client not initialized");
      }
      const { data } = await supabase
        .from("race_entries")
        .select("boat_number, weight_kg")
        .eq("race_id", raceId);
      const byBoat = {};
      (data ?? []).forEach((row) => {
        const weight = parseFloat(row.weight_kg);
        if (Number.isFinite(weight)) byBoat[row.boat_number] = weight;
      });
      if (Object.keys(byBoat).length === 0) {
        return { state: "empty", byBoat: {}, fetchFailed: true };
      }
      return { state: "published", byBoat };
    });
  },

  /**
   * 指定選手の展示タイム（周回タイム）の推移を取得する（BOA-164）
   * 同日複数レースは平均してグラフ用に日付単位でまとめる
   */
  getExhibitionTimeTrend(racerId) {
    return withCache(`exhibition-time-trend-${racerId}`, async () => {
      if (!supabase) {
        console.error("Supabase client not initialized");
        return { racer_id: racerId, trend: [] };
      }

      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
      const cutoffStr = ninetyDaysAgo.toISOString().split("T")[0];

      const { data: pastEntries, error: entriesError } = await supabase
        .from("race_entries")
        .select("race_id, boat_number")
        .eq("racer_id", racerId)
        .gte("race_id", cutoffStr)
        .order("race_id");

      if (entriesError || !pastEntries || pastEntries.length === 0) {
        if (entriesError)
          console.error("race_entries取得エラー:", entriesError.message);
        return { racer_id: racerId, trend: [] };
      }

      const raceIds = pastEntries.map((e) => e.race_id);

      const exhibitionRows = await fetchAllByIn(
        "exhibition_data",
        "race_id, boat_number, exhibition_time",
        "race_id",
        raceIds,
      );

      const exhibitionByKey = new Map();
      exhibitionRows.forEach((e) => {
        exhibitionByKey.set(`${e.race_id}-${e.boat_number}`, e.exhibition_time);
      });

      const byDate = new Map();
      pastEntries
        .map((e) => ({ ...e, race_date: e.race_id.slice(0, 10) }))
        .sort((a, b) => a.race_date.localeCompare(b.race_date))
        .forEach((e) => {
          const key = `${e.race_id}-${e.boat_number}`;
          const time = exhibitionByKey.get(key);
          if (time === undefined || time === null) return;

          if (!byDate.has(e.race_date)) {
            byDate.set(e.race_date, []);
          }
          byDate.get(e.race_date).push(time);
        });

      const trend = [...byDate.entries()].map(([date, times]) => ({
        date,
        avg_exhibition_time:
          times.reduce((sum, t) => sum + t, 0) / times.length,
      }));

      return { racer_id: racerId, trend };
    });
  },

  /**
   * 指定選手の今節成績（節内の日別進入・着順・ST推移）を取得する
   * （BOA-291/BOA-220、FR-3、docs/adr/0053参照）
   *
   * 進入コース・着順・STは自社race_results/race_entries/race_start_timingsから
   * 導出する（ADR-0053: 自社データとの二重管理を避けるため、racelistページの
   * 「今節成績」表示を直接スクレイピングしない）。
   * 得点率（SG/G1等の記念競走のみ存在）はracer_series_points（pointrankページの
   * 直接スクレイピング、ADR-0053追記2026-09-16）から取得する。
   *
   * @param {number} racerId
   * @param {number} venueCode
   * @param {string} meetStartDate - 開催初日 YYYY-MM-DD（race_conditions.series_dayから逆算した値）
   * @returns {Promise<{racer_id: number, venue_code: number, meet_start_date: string, days: Array, series_points: object|null}>}
   *   series_pointsはracer_series_pointsの1行（rank/score_rate/placements/total_points/penalty_points/remarks）
   *   をそのまま返す。得点率という単一の値ではなく行全体を保持するため`score_rate`ではなくこの名前にしている
   */
  async getSeriesResultsByRacer(racerId, venueCode, meetStartDate) {
    return withCache(
      `series-results-${racerId}-${venueCode}-${meetStartDate}`,
      async () => {
        const empty = {
          racer_id: racerId,
          venue_code: venueCode,
          meet_start_date: meetStartDate,
          days: [],
          series_points: null,
        };
        if (!supabase) {
          console.error("Supabase client not initialized");
          return empty;
        }

        // race_idは"YYYY-MM-DD-VV-RR"形式のため、venue_codeのLIKE部分一致
        // （"%-VV-%"）は日付側の月日部分と衝突しうる（例: 4月のレースが
        // venue_code=4に誤マッチする）。venue_codeの絞り込みはJS側で正確に行う。
        // 上限日付はSG/G1でも最長6日程度の開催に対する安全マージンで、同一
        // 会場での次開催のデータが誤って混入しないようにする
        const upperBoundDate = addDaysToDateString(meetStartDate, 10);
        const { data: rawEntries, error: entriesError } = await supabase
          .from("race_entries")
          .select("race_id, boat_number")
          .eq("racer_id", racerId)
          .gte("race_id", meetStartDate)
          .lte("race_id", upperBoundDate)
          .order("race_id");

        if (entriesError) {
          console.error(
            "race_entries(今節成績)取得エラー:",
            entriesError.message,
          );
          return empty;
        }
        const entries = (rawEntries || []).filter(
          (e) => extractVenueCodeFromRaceId(e.race_id) === venueCode,
        );
        if (entries.length === 0) return empty;

        const raceIds = entries.map((e) => e.race_id);
        const boatByRaceId = new Map(
          entries.map((e) => [e.race_id, e.boat_number]),
        );

        const [resultsRows, conditionsRows, startTimingRows, seriesPointsRes] =
          await Promise.all([
            fetchAllByIn(
              "race_results",
              "race_id, rank1, rank2, rank3, rank4, rank5, rank6, actual_course_1, actual_course_2, actual_course_3, actual_course_4, actual_course_5, actual_course_6, winning_technique",
              "race_id",
              raceIds,
            ),
            fetchAllByIn(
              "race_conditions",
              "race_id, series_day, is_final_day",
              "race_id",
              raceIds,
            ),
            fetchAllByIn(
              "race_start_timings",
              "race_id, boat_number, start_timing, is_flying, is_late_start",
              "race_id",
              raceIds,
            ),
            supabase
              .from("racer_series_points")
              .select(
                "rank, score_rate, placements, total_points, penalty_points, remarks",
              )
              .eq("racer_id", racerId)
              .eq("venue_code", venueCode)
              .eq("meet_start_date", meetStartDate)
              .maybeSingle(),
          ]);

        if (seriesPointsRes.error) {
          console.error(
            "racer_series_points取得エラー:",
            seriesPointsRes.error.message,
          );
        }
        const seriesPoints = seriesPointsRes.data ?? null;

        const resultsByRaceId = new Map(resultsRows.map((r) => [r.race_id, r]));
        const conditionsByRaceId = new Map(
          conditionsRows.map((r) => [r.race_id, r]),
        );
        const startTimingByKey = new Map(
          startTimingRows.map((r) => [`${r.race_id}-${r.boat_number}`, r]),
        );

        const days = raceIds.map((raceId) => {
          const boatNumber = boatByRaceId.get(raceId);
          const result = resultsByRaceId.get(raceId);
          const conditions = conditionsByRaceId.get(raceId);
          const startTiming = startTimingByKey.get(`${raceId}-${boatNumber}`);

          const finishRank = findBoatColumnIndex(result, "rank", boatNumber);
          // actual_course_Nは艇番でインデックスされた列（N号艇の進入コース）
          // であり、rank1..6とは列の向きが逆のためfindBoatColumnIndexは使えない
          const entryCourse = courseOfBoat(result, boatNumber);

          return {
            race_id: raceId,
            race_date: raceId.slice(0, 10),
            boat_number: boatNumber,
            series_day: conditions?.series_day ?? null,
            is_final_day: conditions?.is_final_day ?? null,
            entry_course: entryCourse,
            finish_rank: finishRank,
            start_timing: startTiming?.start_timing ?? null,
            is_flying: startTiming?.is_flying ?? null,
            is_late_start: startTiming?.is_late_start ?? null,
            winning_technique: result?.winning_technique ?? null,
          };
        });

        // is_final_dayの日以降は次開催のデータの可能性があるため切り捨てる
        // （upperBoundDateは安全マージンに過ぎず、確実な境界はis_final_dayのみ）
        const finalDayIndex = days.findIndex((d) => d.is_final_day);
        const trimmedDays =
          finalDayIndex === -1 ? days : days.slice(0, finalDayIndex + 1);

        return {
          racer_id: racerId,
          venue_code: venueCode,
          meet_start_date: meetStartDate,
          days: trimmedDays,
          series_points: seriesPoints,
        };
      },
    );
  },

  /**
   * 指定レースの選手コース別統計（racerStats）を取得する（BOA-168）
   * predictions.feature_contributions.racerStats に日次バッチで保存済みの
   * 進入コース・平均ST・コース別勝敗・攻め手/守り手分布を返す。
   * 超展開データタブ・データ出走表の平均ST/枠番勝率行で使用する。
   * 注: 「コース」という名称だが、実際の進入コース変化（前づけ）は
   * BOA-257の制約により区別できず、実質的に枠番（艇番）基準の値である
   * （raceIndicators.jsxのcourseRateOf関数も参照）
   */
  getRaceRacerStats(raceId) {
    return withCache(`race-racer-stats-${raceId}`, async () => {
      if (!supabase) {
        console.error("Supabase client not initialized");
        return null;
      }

      // shadow予測が併存する可能性があるためmaybeSingleは使わず最新1件を取る
      const { data, error } = await supabase
        .from("predictions")
        .select("model_id, feature_contributions, predicted_at")
        .eq("race_id", raceId)
        .eq("model_id", "standard")
        .order("predicted_at", { ascending: false })
        .limit(1);

      if (error) {
        console.error("predictions取得エラー:", error.message);
        return null;
      }
      return data?.[0]?.feature_contributions?.racerStats ?? null;
    });
  },

  /**
   * 指定レースの複勝オッズ（最新スクレイプ分）を取得する（AI予想モデル大規模改修、複勝予想バッジ用）
   * 複勝オッズは下限-上限のレンジで提供される（race_odds.odds_place_{n}_low/high、マイグレーション032）。
   * 未適用環境・スクレイピング未実施のレースではlow/highともnullを返す
   */
  getRacePlaceOdds(raceId) {
    return withCache(`race-place-odds-${raceId}`, async () => {
      if (!supabase) {
        console.error("Supabase client not initialized");
        return null;
      }

      const { data, error } = await supabase
        .from("race_odds")
        .select(
          "odds_place_1_low, odds_place_1_high, odds_place_2_low, odds_place_2_high, odds_place_3_low, odds_place_3_high, odds_place_4_low, odds_place_4_high, odds_place_5_low, odds_place_5_high, odds_place_6_low, odds_place_6_high",
        )
        .eq("race_id", raceId)
        .order("captured_at", { ascending: false })
        .limit(1);

      if (error) {
        console.error("race_odds（複勝）取得エラー:", error.message);
        return null;
      }
      const row = data?.[0];
      if (!row) return null;
      return [1, 2, 3, 4, 5, 6].map((n) => ({
        boat_number: n,
        odds_place_low: row[`odds_place_${n}_low`] ?? null,
        odds_place_high: row[`odds_place_${n}_high`] ?? null,
      }));
    });
  },

  /**
   * 指定レースのオッズ全通り系スナップショット履歴を取得する（オッズ一覧タブ、BOA-311）
   * race_odds.trifecta_all/trio_all/exacta_all/quinella_all/wide_all（jsonb、ADR-0054/0057）を
   * captured_at昇順で全件返す。全窓（60/30/15/10/5/0分前）分が入る想定だが、
   * オンデマンド更新（別チケットBOA-310で予定）が加わると窓に一致しない行が
   * 混ざりうるため、呼び出し側は行数を6固定と決め打ちしないこと。
   * 全通り系5列が全てnullの行（全通り捕捉ウィンドウ外のスナップショット）は
   * オッズ一覧タブでは無意味なため除外する
   */
  getRaceOddsSnapshots(raceId) {
    const ttl = raceOddsCacheTtl(raceId);

    // v2: 単勝・複勝（odds_win_N・odds_place_N_low/high）を足した（BOA-487）。キーを変えないと、
    // localStorage に残った旧形（単勝なし）が過去レースで最大7日返る
    return withCache(
      `race-odds-snapshots-v2-${raceId}`,
      async () => {
        if (!supabase) {
          throw new Error("Supabase client not initialized");
        }

        const winPlaceColumns = [1, 2, 3, 4, 5, 6]
          .map(
            (n) => `odds_win_${n}, odds_place_${n}_low, odds_place_${n}_high`,
          )
          .join(", ");
        const { data, error } = await supabase
          .from("race_odds")
          .select(
            `captured_at, trifecta_all, trio_all, exacta_all, quinella_all, wide_all, ${winPlaceColumns}`,
          )
          .eq("race_id", raceId)
          .order("captured_at", { ascending: true });

        // エラーは[]にせず投げる（withCacheは失敗をキャッシュしないため、
        // 一時的なDBエラーの空結果が長時間固定されるのを防げる。
        // 呼び出し側で「データなし」表示にフォールバックする）
        if (error) {
          throw new Error(`race_odds（全通り系）取得エラー: ${error.message}`);
        }

        // 単勝・複勝は艇番（"1"〜"6"）→ 値。null は「票0（公式の0.0）か未取得」で、保存時に区別していない
        // （scrape-odds.js が 0.0 を null にする）。画面では「票なし（または未取得）」として扱う
        const winOf = (row) =>
          Object.fromEntries(
            [1, 2, 3, 4, 5, 6].map((n) => [String(n), row[`odds_win_${n}`]]),
          );
        const placeOf = (row) =>
          Object.fromEntries(
            [1, 2, 3, 4, 5, 6].map((n) => {
              const low = row[`odds_place_${n}_low`];
              const high = row[`odds_place_${n}_high`];
              return [
                String(n),
                low != null && high != null ? { low, high } : null,
              ];
            }),
          );
        return (data || [])
          .filter(
            (row) =>
              row.trifecta_all ||
              row.trio_all ||
              row.exacta_all ||
              row.quinella_all ||
              row.wide_all ||
              [1, 2, 3, 4, 5, 6].some((n) => row[`odds_win_${n}`] != null),
          )
          .map((row) => ({
            capturedAt: row.captured_at,
            trifectaAll: row.trifecta_all ?? null,
            trioAll: row.trio_all ?? null,
            exactaAll: row.exacta_all ?? null,
            quinellaAll: row.quinella_all ?? null,
            wideAll: row.wide_all ?? null,
            win: winOf(row),
            place: placeOf(row),
          }));
      },
      ttl,
    );
  },

  /**
   * 指定レースの締切時オッズ（公式）を取得する（BOA-496）。締切の後に Cron（api/cron/odds-final.js）が公式の
   * 「締切時オッズ」表示のページを取り直して race_odds_final に保存した値。券種ごとに取れたものだけが入る
   * （取れなかった券種は null）。票0は 0 のまま（スナップショットと違い、キーが無いのは欠場・未発売）。
   *
   * 戻り値: { capturedAt, win, place, trifectaAll, trioAll, exactaAll, quinellaAll, wideAll }、行が無ければ null。
   * 本日のレースは、締切後に値が入るため短いTTLにする（getRaceOddsSnapshots と同じ理由）
   */
  getRaceFinalOdds(raceId) {
    const ttl = raceOddsCacheTtl(raceId);
    return withCache(
      `race-odds-final-v1-${raceId}`,
      async () => {
        if (!supabase) {
          throw new Error("Supabase client not initialized");
        }
        const nonEmpty = (v) =>
          v && typeof v === "object" && Object.keys(v).length > 0 ? v : null;
        let data;
        try {
          ({ data } = await supabase
            .from("race_odds_final")
            .select(
              "captured_at, win_all, place_all, trifecta_all, trio_all, exacta_all, quinella_all, wide_all",
            )
            .eq("race_id", raceId)
            .maybeSingle());
        } catch (err) {
          // マイグレーション108が未適用（テーブルが無い）のときだけ「締切時オッズなし」に倒す。画面は従来の
          // スナップショットの表示のまま動く（適用とデプロイの順序を問わないため）。それ以外は上流に流す
          if (err?.code === "PGRST205" || err?.code === "42P01") return null;
          throw err;
        }
        if (!data) return null;
        const final = {
          capturedAt: data.captured_at,
          win: nonEmpty(data.win_all),
          place: nonEmpty(data.place_all),
          trifectaAll: nonEmpty(data.trifecta_all),
          trioAll: nonEmpty(data.trio_all),
          exactaAll: nonEmpty(data.exacta_all),
          quinellaAll: nonEmpty(data.quinella_all),
          wideAll: nonEmpty(data.wide_all),
        };
        // 一部の券種だけの行は、Cron の再試行で後から埋まる。キャッシュに保存しない（withCache は TTL を読み出し時に
        // キーの日付から決め直すため、今日3分で保存した途中の行が、翌日には過去レースの7日TTLで返り続ける）
        const complete = [
          final.win,
          final.trifectaAll,
          final.trioAll,
          final.exactaAll,
          final.quinellaAll,
          final.wideAll,
        ].every(Boolean);
        return complete ? final : { ...final, fetchFailed: true };
      },
      ttl,
    );
  },

  /**
   * unifiedモデルの実測精度（複勝的中率・回収率、展開的中率）を取得する（BOA-179関連）
   * scripts/daily/calculate-unified-model-accuracy.js が日次で accuracy_cache に
   * 保存した集計値を読むだけなので軽量。AIデータ分析の複勝予想/展開予測カードで
   * 「過去の実測実績」を動的に表示するために使う
   */
  getUnifiedModelAccuracy() {
    return withCache(
      "unified-model-accuracy",
      async () => {
        if (!supabase) {
          console.error("Supabase client not initialized");
          return null;
        }
        const { data, error } = await supabase
          .from("accuracy_cache")
          .select("data")
          .eq("key", "unified_model_accuracy")
          .single();

        if (error) {
          console.error("unified_model_accuracy取得エラー:", error.message);
          return null;
        }
        return data?.data ?? null;
      },
      6 * 60 * 60 * 1000, // 6時間キャッシュ（日次バッチでしか更新されないため長め）
    );
  },

  /**
   * unifiedモデルのイン崩れ指数の実測精度（レベル別イン崩れ率）を取得する（BOA-177）
   * scripts/daily/calculate-unified-volatility-accuracy.js が日次で accuracy_cache に
   * 保存した集計値を読むだけ。既存のVolatilityAccuracySectionコンポーネントと
   * 同じshape（baseline/byLevel）で返す
   */
  getUnifiedVolatilityAccuracy() {
    return withCache(
      "unified-volatility-accuracy",
      async () => {
        if (!supabase) {
          console.error("Supabase client not initialized");
          return null;
        }
        const { data, error } = await supabase
          .from("accuracy_cache")
          .select("data")
          .eq("key", "unified_volatility_accuracy")
          .single();

        if (error) {
          console.error(
            "unified_volatility_accuracy取得エラー:",
            error.message,
          );
          return null;
        }
        return data?.data ?? null;
      },
      6 * 60 * 60 * 1000,
    );
  },

  /**
   * 指定レースの出走表詳細（race_entriesの全選手データ）を取得する（BOA-168）
   * 分析ツールの「出走表データ」タブで使用する。AIスコアは含めない
   */
  getRaceEntriesDetail(raceId) {
    return withCache(`race-entries-detail-${raceId}`, async () => {
      if (!supabase) {
        console.error("Supabase client not initialized");
        return [];
      }

      const [entriesRes, exhibitionRes] = await Promise.all([
        supabase
          .from("race_entries")
          .select(
            "boat_number, player_name, grade, age, win_rate, local_win_rate, global_2rate, motor_number, motor_2rate",
          )
          .eq("race_id", raceId)
          .order("boat_number"),
        supabase
          .from("exhibition_data")
          .select("boat_number, exhibition_time, start_timing")
          .eq("race_id", raceId),
      ]);

      if (entriesRes.error || !entriesRes.data) {
        if (entriesRes.error)
          console.error("race_entries取得エラー:", entriesRes.error.message);
        return [];
      }
      const exByBoat = new Map(
        (exhibitionRes.data ?? []).map((e) => [e.boat_number, e]),
      );
      return entriesRes.data.map((row) => ({
        ...row,
        exhibition_time: exByBoat.get(row.boat_number)?.exhibition_time ?? null,
        exhibition_st: exByBoat.get(row.boat_number)?.start_timing ?? null,
      }));
    });
  },

  /**
   * 指定レースの結果サマリー（着順・決まり手）を取得する（BOA-168）
   * Edge Function経由のpredictionデータにはwinning_techniqueが含まれないため、
   * 「データで振り返る」はこの関数で確実に決まり手を取得する
   */
  getRaceResultSummary(raceId) {
    return withCache(`race-result-summary-${raceId}`, async () => {
      if (!supabase) {
        console.error("Supabase client not initialized");
        return null;
      }

      const { data, error } = await supabase
        .from("race_results")
        .select(
          "race_id, rank1, rank2, rank3, winning_technique, is_cancelled, is_no_race",
        )
        .eq("race_id", raceId)
        .maybeSingle();

      if (error) {
        console.error("race_results取得エラー:", error.message);
        return null;
      }
      return data ?? null;
    });
  },

  /**
   * 本日開催中のレースの出走選手について、過去180日間・同じ艇番で出走した
   * レースでの単勝回収率・複勝回収率を取得する（BOA-167）
   * AI予想モデルの確率は使わず、race_results.payout_win/payout_place_1/2の
   * 過去の実績払戻金のみを集計する（期待値分析のようなモデル較正は不要）
   */
  getRaceRacerBoatReturnRate(raceId) {
    return withCache(`race-racer-boat-return-rate-${raceId}`, async () => {
      if (!supabase) {
        console.error("Supabase client not initialized");
        return [];
      }

      // RPC優先（サーバー側集計でegressを約1/25に削減、029マイグレーション）。
      // 未適用環境では旧クライアント集計にフォールバックする
      const { data: rpcData, error: rpcError } = await supabase.rpc(
        "get_race_return_rate",
        { p_race_id: raceId },
      );
      if (!rpcError && Array.isArray(rpcData)) {
        return rpcData;
      }
      if (rpcError) {
        console.warn(
          "get_race_return_rate RPC未適用のため旧ロジックで取得:",
          rpcError.message,
        );
      }

      const { data: entries, error: entriesError } = await supabase
        .from("race_entries")
        .select("boat_number, player_name, racer_id")
        .eq("race_id", raceId)
        .order("boat_number");

      if (entriesError || !entries || entries.length === 0) {
        if (entriesError)
          console.error("race_entries取得エラー:", entriesError.message);
        return [];
      }

      const racerIds = [...new Set(entries.map((r) => r.racer_id))].filter(
        (id) => id !== null,
      );
      if (racerIds.length === 0) {
        return entries.map((row) => ({
          ...row,
          sample_count: 0,
          win_return_rate: null,
          place_return_rate: null,
        }));
      }

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - 180);
      const cutoffStr = cutoffDate.toISOString().split("T")[0];

      const relevantPastEntries = [];
      const pageSize = 1000;
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from("race_entries")
          .select("race_id, boat_number, racer_id")
          .in("racer_id", racerIds)
          .gte("race_id", cutoffStr)
          .lt("race_id", raceId)
          .range(from, from + pageSize - 1);
        if (error) {
          console.error("過去出走データ取得エラー:", error.message);
          break;
        }
        if (!data || data.length === 0) break;
        relevantPastEntries.push(...data);
        if (data.length < pageSize) break;
        from += pageSize;
      }

      if (relevantPastEntries.length === 0) {
        return entries.map((row) => ({
          ...row,
          sample_count: 0,
          win_return_rate: null,
          place_return_rate: null,
        }));
      }

      const pastRaceIds = [
        ...new Set(relevantPastEntries.map((e) => e.race_id)),
      ];
      const resultRows = await fetchAllByIn(
        "race_results",
        "race_id, rank1, rank2, payout_win, payout_place_1, payout_place_2, is_cancelled, is_no_race",
        "race_id",
        pastRaceIds,
      );
      const resultByRaceId = new Map(resultRows.map((r) => [r.race_id, r]));

      // racer_id + boat_number ごとに集計（同じ選手でも艇番が違えば別集計）
      const statsByRacerBoat = new Map();
      relevantPastEntries.forEach((e) => {
        const result = resultByRaceId.get(e.race_id);
        if (!result || result.is_cancelled || result.is_no_race) return;

        const key = `${e.racer_id}-${e.boat_number}`;
        if (!statsByRacerBoat.has(key)) {
          statsByRacerBoat.set(key, {
            sampleCount: 0,
            winPayoutSum: 0,
            placePayoutSum: 0,
          });
        }
        const stats = statsByRacerBoat.get(key);
        stats.sampleCount += 1;

        if (result.rank1 === e.boat_number) {
          stats.winPayoutSum += result.payout_win ?? 0;
          stats.placePayoutSum += result.payout_place_1 ?? 0;
        } else if (result.rank2 === e.boat_number) {
          stats.placePayoutSum += result.payout_place_2 ?? 0;
        }
      });

      return entries.map((row) => {
        const stats = statsByRacerBoat.get(
          `${row.racer_id}-${row.boat_number}`,
        );
        if (!stats || stats.sampleCount === 0) {
          return {
            ...row,
            sample_count: 0,
            win_return_rate: null,
            place_return_rate: null,
          };
        }
        return {
          ...row,
          sample_count: stats.sampleCount,
          win_return_rate: toReturnRate(stats.winPayoutSum, stats.sampleCount),
          place_return_rate: toReturnRate(
            stats.placePayoutSum,
            stats.sampleCount,
          ),
        };
      });
    });
  },

  /**
   * 本日出走する全選手を対象に、現在の全国勝率と約90日前時点の全国勝率のdeltaで
   * 急上昇/急下降ランキングを作成する（BOA-166）
   * 会場・レース単位の選手調子（BOA-152）とは異なり、レース選択前の発見導線として
   * 本日カード全体を横断する
   */
  getTodaysRacerFormRanking(limit = 10) {
    const now = new Date();
    const jstOffset = 9 * 60;
    const jstNow = new Date(now.getTime() + jstOffset * 60 * 1000);
    const today = jstNow.toISOString().split("T")[0];

    return withCache(
      `todays-racer-form-ranking-${today}-${limit}`,
      async () => {
        if (!supabase) {
          console.error("Supabase client not initialized");
          return { rising: [], falling: [] };
        }

        const { data: races, error: racesError } = await supabase
          .from("races")
          .select("race_id, venue_code, race_number")
          .eq("race_date", today);

        if (racesError || !races || races.length === 0) {
          if (racesError) console.error("races取得エラー:", racesError.message);
          return { rising: [], falling: [] };
        }

        const raceMetaByRaceId = new Map(races.map((r) => [r.race_id, r]));
        const raceIds = races.map((r) => r.race_id);

        const entries = await fetchAllByIn(
          "race_entries",
          "race_id, boat_number, player_name, racer_id, win_rate",
          "race_id",
          raceIds,
        );

        // 同じ選手が本日複数レースに出走することは無いはずだが、念のためracer_idごとに最初の1件のみ採用
        const currentByRacer = new Map();
        entries.forEach((e) => {
          if (e.racer_id === null || e.win_rate === null) return;
          if (!currentByRacer.has(e.racer_id))
            currentByRacer.set(e.racer_id, e);
        });

        if (currentByRacer.size === 0) return { rising: [], falling: [] };

        // 約90日前時点の直近の記録を探す（cutoff以前・探索窓2週間で最新のもの）
        const ninetyDaysAgo = new Date();
        ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
        const cutoff = ninetyDaysAgo.toISOString().split("T")[0];
        const windowStart = new Date(ninetyDaysAgo);
        windowStart.setDate(windowStart.getDate() - 14);
        const windowStartStr = windowStart.toISOString().split("T")[0];

        // racer_idのIN句が大きくなりうるため、race_id範囲（全会場横断・2週間分）で
        // まとめて取得しracer_idでフィルタする
        const pastRows = [];
        const pageSize = 1000;
        let from = 0;
        while (true) {
          const { data, error } = await supabase
            .from("race_entries")
            .select("race_id, racer_id, win_rate")
            .gte("race_id", windowStartStr)
            .lte("race_id", cutoff)
            .order("race_id", { ascending: false })
            .range(from, from + pageSize - 1);
          if (error) {
            console.error("過去データ取得エラー:", error.message);
            break;
          }
          if (!data || data.length === 0) break;
          pastRows.push(...data);
          if (data.length < pageSize) break;
          from += pageSize;
        }

        // race_id降順のため、各racer_idごとに最初に出てくるものが cutoff に最も近い記録
        const pastByRacer = new Map();
        pastRows.forEach((row) => {
          if (!currentByRacer.has(row.racer_id)) return;
          if (!pastByRacer.has(row.racer_id)) {
            pastByRacer.set(row.racer_id, row.win_rate);
          }
        });

        const withDelta = [...currentByRacer.values()]
          .map((entry) => {
            const pastWinRate = pastByRacer.get(entry.racer_id) ?? null;
            const meta = raceMetaByRaceId.get(entry.race_id);
            return {
              ...entry,
              venue_code: meta?.venue_code ?? null,
              race_number: meta?.race_number ?? null,
              past_win_rate: pastWinRate,
              delta: pastWinRate !== null ? entry.win_rate - pastWinRate : null,
            };
          })
          .filter((row) => row.delta !== null);

        const rising = [...withDelta]
          .sort((a, b) => b.delta - a.delta)
          .slice(0, limit);
        const falling = [...withDelta]
          .sort((a, b) => a.delta - b.delta)
          .slice(0, limit);

        return { rising, falling };
      },
    );
  },

  /**
   * 本日の結果確定済みレースを会場別に横断集計し、4指標（固い場/荒れている場/
   * イン逃げ率/万舟率）でランキングする（BOA-171）
   * 消化レース数が少ない会場（minRaceCount未満）はサンプル不足のためランキング対象から除外する
   *
   * 注意: 3連単配当は race_results.payout_trio を使う（DB列名と実態が歴史的経緯で
   * 逆転しており、payout_trifecta は実態3連複のため使わない。scripts/lib/payoutCalculator.js参照）
   */
  getTodaysVenueRanking(limit = 5, minRaceCount = 3) {
    const now = new Date();
    const jstOffset = 9 * 60;
    const jstNow = new Date(now.getTime() + jstOffset * 60 * 1000);
    const today = jstNow.toISOString().split("T")[0];

    const empty = { stable: [], rough: [], nigeRate: [], manshu: [] };

    // 本日限定のリアルタイム集計のため、グローバルの30分キャッシュ（inferTtlFromKey）
    // ではなく短めのTTLを明示指定する。特に「まだ結果確定レースが無い」空状態が
    // 30分間キャッシュされ続けると、レース確定後もリアルタイム性が損なわれるため
    const VENUE_RANKING_CACHE_TTL = 5 * 60 * 1000; // 5分

    return withCache(
      `todays-venue-ranking-${today}-${limit}-${minRaceCount}`,
      async () => {
        if (!supabase) {
          console.error("Supabase client not initialized");
          return empty;
        }

        const { data: races, error: racesError } = await supabase
          .from("races")
          .select("race_id, venue_code")
          .eq("race_date", today);

        if (racesError || !races || races.length === 0) {
          if (racesError) console.error("races取得エラー:", racesError.message);
          return empty;
        }

        const venueByRaceId = new Map(
          races.map((r) => [r.race_id, r.venue_code]),
        );
        const raceIds = races.map((r) => r.race_id);

        const results = await fetchAllByIn(
          "race_results",
          "race_id, rank1, payout_trio, winning_technique, is_cancelled, is_no_race",
          "race_id",
          raceIds,
        );

        const byVenue = new Map();
        results.forEach((r) => {
          if (r.is_cancelled || r.is_no_race || r.rank1 === null) return;
          const venueCode = venueByRaceId.get(r.race_id);
          if (venueCode === null || venueCode === undefined) return;
          if (!byVenue.has(venueCode)) {
            byVenue.set(venueCode, {
              venue_code: venueCode,
              raceCount: 0,
              payoutCount: 0,
              payoutSum: 0,
              nigeCount: 0,
              manshuCount: 0,
            });
          }
          const v = byVenue.get(venueCode);
          v.raceCount += 1;
          if (r.payout_trio !== null) {
            v.payoutCount += 1;
            v.payoutSum += r.payout_trio;
            if (r.payout_trio >= 10000) v.manshuCount += 1;
          }
          if (r.rank1 === 1 && r.winning_technique === "逃げ") v.nigeCount += 1;
        });

        // イン逃げ率は配当データに依存しないため、配当が1件も取れていない会場
        // （payoutCount=0）も対象に含める。固い場/荒れている場/万舟率は
        // payout_trioの平均・件数を使うためpayoutCount>0の会場のみ対象とする
        const qualifyingVenues = [...byVenue.values()].filter(
          (v) => v.raceCount >= minRaceCount,
        );

        const nigeRateVenues = qualifyingVenues.map((v) => ({
          venue_code: v.venue_code,
          race_count: v.raceCount,
          nige_rate: (v.nigeCount / v.raceCount) * 100,
        }));

        const payoutVenues = qualifyingVenues
          .filter((v) => v.payoutCount > 0)
          .map((v) => ({
            venue_code: v.venue_code,
            race_count: v.raceCount,
            avg_payout: v.payoutSum / v.payoutCount,
            manshu_rate: (v.manshuCount / v.payoutCount) * 100,
          }));

        const byAvgPayoutAsc = [...payoutVenues].sort(
          (a, b) => a.avg_payout - b.avg_payout,
        );
        const byAvgPayoutDesc = [...payoutVenues].sort(
          (a, b) => b.avg_payout - a.avg_payout,
        );

        return {
          stable: byAvgPayoutAsc.slice(0, limit),
          rough: byAvgPayoutDesc.slice(0, limit),
          nigeRate: [...nigeRateVenues]
            .sort((a, b) => b.nige_rate - a.nige_rate)
            .slice(0, limit),
          manshu: [...payoutVenues]
            .sort((a, b) => b.manshu_rate - a.manshu_rate)
            .slice(0, limit),
        };
      },
      VENUE_RANKING_CACHE_TTL,
    );
  },

  /**
   * 指定会場・指定日の結果確定済みレースを集計し、平均配当・万舟率・1号艇の逃げ率・
   * 決まり手別回数・進入コース別1着回数を返す（BOA-304。2026-09-24のFR-5で
   * 直前情報タブから結果タブ・会場ページへ移設、`VenueDaySummaryCard`が使う）。
   *
   * nigeRateは `rank1 === 1 && winning_technique === "逃げ"` の**艇番基準**で、
   * 「1コース逃げ」ではない。決まり手が逃げの有効23,892レースのうち
   * rank1 !== 1（前づけで他艇が1コースを取って逃げた）が238件＝1.0%あり、
   * これを分子から落としている（2026-09-24実測。逆にrank1===1かつ逃げで
   * 実進入コースが1でない例は0件）。実進入コース基準に寄せると、当日の
   * レースはactual_course_*が100%NULLのため算出できなくなるため据え置き、
   * 画面のラベルを「1号艇の逃げ率」にして実装に合わせている
   *
   * byRaceは「この日の傾向 vs このレース」の比較文（FR-5 / T4-4）のために
   * レース単位の決まり手・1着艇の実進入コースを返す。actual_course_1〜6は
   * 既にselectしているので**追加クエリは0本**。当日のレースはバックフィルが
   * 未了でwinnerCourseがnullになる（会場×日単位でオール・オア・ナッシングに
   * 入るため、当日は必ずnull）。courseOfBoat()は使わない——未バックフィルの
   * 艇番を暫定コースとみなすと、当日レースで「3コースまくり」と断定してしまう
   *
   * 平均配当/万舟率/イン逃げ率の定義・除外条件（is_cancelled/is_no_race/
   * rank1===null除外、3連単配当はpayout_trio列を使う歴史的経緯）は
   * getTodaysVenueRanking（BOA-171）と完全に同じにする。あちらは「本日」
   * 固定・全24会場横断ランキング用、こちらは任意の日付・単一会場の
   * サマリー表示用という違いのみで、集計ロジックの重複・食い違いを避ける
   */
  getVenueDaySummary(venueCode, date) {
    if (!venueCode || !date) {
      return Promise.resolve({
        raceCount: 0,
        payoutCount: 0,
        avgPayout: null,
        manshuRate: null,
        nigeRate: null,
        techniqueCounts: {},
        entryCourseWinCounts: {},
        byRace: {},
      });
    }

    return withCache(
      `venue-day-summary-${venueCode}-${date}`,
      async () => {
        const empty = {
          raceCount: 0,
          payoutCount: 0,
          avgPayout: null,
          manshuRate: null,
          nigeRate: null,
          techniqueCounts: {},
          entryCourseWinCounts: {},
          byRace: {},
        };
        if (!supabase) {
          console.error("Supabase client not initialized");
          // 環境変数の未設定は「その日は0レース」ではないため、キャッシュに
          // 焼き付けない（.claude/rules/frontend-data-fetch.md §4）
          return { ...empty, fetchFailed: true };
        }

        const { data: races, error: racesError } = await supabase
          .from("races")
          .select("race_id")
          .eq("race_date", date)
          .eq("venue_code", venueCode);

        if (racesError || !races || races.length === 0) {
          if (racesError) console.error("races取得エラー:", racesError.message);
          return empty;
        }

        const raceIds = races.map((r) => r.race_id);
        const results = await fetchAllByIn(
          "race_results",
          "race_id, rank1, payout_trio, winning_technique, is_cancelled, is_no_race, actual_course_1, actual_course_2, actual_course_3, actual_course_4, actual_course_5, actual_course_6",
          "race_id",
          raceIds,
        );

        let raceCount = 0;
        let payoutCount = 0;
        let payoutSum = 0;
        let manshuCount = 0;
        let nigeCount = 0;
        const techniqueCounts = {};
        const entryCourseWinCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
        const byRace = {};

        results.forEach((r) => {
          if (r.is_cancelled || r.is_no_race || r.rank1 === null) return;
          raceCount += 1;
          byRace[r.race_id] = {
            rank1: r.rank1,
            winningTechnique: r.winning_technique ?? null,
            // 1着艇が実際に進入したコース。当日・未バックフィル日はnull
            winnerCourse: r[`actual_course_${r.rank1}`] ?? null,
          };
          if (r.payout_trio !== null) {
            payoutCount += 1;
            payoutSum += r.payout_trio;
            if (r.payout_trio >= 10000) manshuCount += 1;
          }
          if (r.rank1 === 1 && r.winning_technique === "逃げ") nigeCount += 1;
          if (r.winning_technique) {
            techniqueCounts[r.winning_technique] =
              (techniqueCounts[r.winning_technique] ?? 0) + 1;
          }
          // 進入コース別1着回数（BOA-257の実進入コース列を使う。バックフィル対象外の
          // 古いレース・欠場艇はactual_course_Nがnullのため、そのレースは対象外になる）
          for (let boat = 1; boat <= 6; boat++) {
            const course = r[`actual_course_${boat}`];
            if (course !== null && course !== undefined && boat === r.rank1) {
              entryCourseWinCounts[course] =
                (entryCourseWinCounts[course] ?? 0) + 1;
              break;
            }
          }
        });

        return {
          raceCount,
          payoutCount,
          avgPayout: payoutCount > 0 ? payoutSum / payoutCount : null,
          manshuRate:
            payoutCount > 0 ? (manshuCount / payoutCount) * 100 : null,
          nigeRate: raceCount > 0 ? (nigeCount / raceCount) * 100 : null,
          techniqueCounts,
          entryCourseWinCounts,
          byRace,
        };
      },
      5 * 60 * 1000, // 当日分は結果反映のたびに変わりうるため短めのTTL
    );
  },

  /**
   * 全24会場の1号艇勝率ランキングを取得する（BOA-267、venuerankingタブの追加指標）
   * venues.avg_first_win_rate（update-venue-stats.jsが日次バッチで更新するキャッシュ列）
   * には依存せず、直近days日のrace_results/racesから都度ライブ集計する。バッチの実行
   * タイミングに依存せず常に最新の値になり、消化レース数（race_count）も同時に得られる
   * （avg_first_win_rate列は値のみでレース数を保持していないため）。
   * 注: 90日全会場スキャンは軽くないため6時間キャッシュにしている（BOA-303で
   * update-venue-stats.js側にrace_count列を追加しavg_first_win_rateを読むだけの
   * 実装に置き換えることを検討、そちらはDBマイグレーションの手動適用が必要なため
   * 本チケットでは見送った）
   */
  getVenueFirstWinRateRanking(days = 90, minRaceCount = 3) {
    const CACHE_TTL = 6 * 60 * 60 * 1000; // 6時間（90日集計は変化が緩やか）
    return withCache(
      `venue-first-win-rate-ranking-${days}-${minRaceCount}`,
      async () => {
        if (!supabase) {
          console.error("Supabase client not initialized");
          return [];
        }

        const jstOffset = 9 * 60;
        const jstNow = new Date(Date.now() + jstOffset * 60 * 1000);
        const since = new Date(jstNow);
        since.setDate(since.getDate() - days);
        const sinceStr = since.toISOString().split("T")[0];

        const races = [];
        const PAGE = 1000;
        let from = 0;
        while (true) {
          const { data, error } = await supabase
            .from("races")
            .select("venue_code, race_results(rank1, is_cancelled, is_no_race)")
            .gte("race_date", sinceStr)
            .order("race_id")
            .range(from, from + PAGE - 1);
          if (error) {
            // getAllRacersLiteと同じ教訓（2026-09-08）: ここで[]を返すとエラー時の
            // 結果が正常値としてキャッシュされ、取得済み分のデータも道連れで
            // 破棄されてしまう。エラーは必ずthrowしてwithCacheにキャッシュさせない
            throw new Error(`races取得エラー: ${error.message}`);
          }
          if (!data || data.length === 0) break;
          races.push(...data);
          if (data.length < PAGE) break;
          from += PAGE;
        }

        const byVenue = new Map();
        races.forEach((r) => {
          const result = Array.isArray(r.race_results)
            ? r.race_results[0]
            : r.race_results;
          if (!isUsableRaceResult(result)) return;
          const venueCode = r.venue_code;
          if (!byVenue.has(venueCode)) {
            byVenue.set(venueCode, {
              venue_code: venueCode,
              race_count: 0,
              firstWins: 0,
            });
          }
          const v = byVenue.get(venueCode);
          v.race_count += 1;
          if (result.rank1 === 1) v.firstWins += 1;
        });

        return [...byVenue.values()]
          .filter((v) => v.race_count >= minRaceCount)
          .map((v) => ({
            venue_code: v.venue_code,
            race_count: v.race_count,
            first_win_rate: (v.firstWins / v.race_count) * 100,
          }))
          .sort((a, b) => b.first_win_rate - a.first_win_rate);
      },
      CACHE_TTL,
    );
  },

  /**
   * 本日開催中のレースの出走選手について、過去90日間で勝った時の決まり手構成比を取得する（BOA-165）
   * 会場・枠番単位の決まり手データ分析（BOA-150）とは異なり、選手個人単位の勝ちパターンを見る機能
   */
  getRaceTechniqueProfileBreakdown(raceId) {
    return withCache(`race-technique-profile-breakdown-${raceId}`, async () => {
      if (!supabase) {
        console.error("Supabase client not initialized");
        return [];
      }

      // RPC優先（サーバー側集計でegressを約1/25に削減、029マイグレーション）。
      // 未適用環境では旧クライアント集計にフォールバックする
      const { data: rpcData, error: rpcError } = await supabase.rpc(
        "get_race_technique_profile",
        { p_race_id: raceId },
      );
      if (!rpcError && Array.isArray(rpcData)) {
        return rpcData;
      }
      if (rpcError) {
        console.warn(
          "get_race_technique_profile RPC未適用のため旧ロジックで取得:",
          rpcError.message,
        );
      }

      const { data: entries, error: entriesError } = await supabase
        .from("race_entries")
        .select("boat_number, player_name, racer_id")
        .eq("race_id", raceId)
        .order("boat_number");

      if (entriesError || !entries || entries.length === 0) {
        if (entriesError)
          console.error("race_entries取得エラー:", entriesError.message);
        return [];
      }

      const racerIds = [...new Set(entries.map((r) => r.racer_id))].filter(
        (id) => id !== null,
      );
      if (racerIds.length === 0) {
        return entries.map((row) => ({
          ...row,
          win_count: 0,
          techniques: [],
        }));
      }

      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
      const cutoffStr = ninetyDaysAgo.toISOString().split("T")[0];

      const { data: pastEntries, error: pastError } = await supabase
        .from("race_entries")
        .select("race_id, boat_number, racer_id")
        .in("racer_id", racerIds)
        .gte("race_id", cutoffStr)
        .lt("race_id", raceId);

      if (pastError) {
        console.error("過去出走データ取得エラー:", pastError.message);
      }

      const pastRaceIds = [
        ...new Set((pastEntries ?? []).map((e) => e.race_id)),
      ];

      if (pastRaceIds.length === 0) {
        return entries.map((row) => ({
          ...row,
          win_count: 0,
          techniques: [],
        }));
      }

      const resultRows = await fetchAllByIn(
        "race_results",
        "race_id, rank1, winning_technique",
        "race_id",
        pastRaceIds,
      );

      const resultByRaceId = new Map();
      resultRows.forEach((r) => {
        if (!r.winning_technique || r.rank1 === null) return;
        resultByRaceId.set(r.race_id, r);
      });

      const techniqueCountsByRacer = new Map();
      (pastEntries ?? []).forEach((e) => {
        const result = resultByRaceId.get(e.race_id);
        if (!result || result.rank1 !== e.boat_number) return; // この選手が勝ったレースのみ集計

        if (!techniqueCountsByRacer.has(e.racer_id)) {
          techniqueCountsByRacer.set(e.racer_id, new Map());
        }
        const counts = techniqueCountsByRacer.get(e.racer_id);
        counts.set(
          result.winning_technique,
          (counts.get(result.winning_technique) ?? 0) + 1,
        );
      });

      return entries.map((row) => {
        const counts = techniqueCountsByRacer.get(row.racer_id) ?? new Map();
        const winCount = [...counts.values()].reduce((s, c) => s + c, 0);
        const techniques = [...counts.entries()]
          .map(([technique, count]) => ({
            technique,
            count,
            percentage: winCount > 0 ? (count / winCount) * 100 : 0,
          }))
          .sort((a, b) => b.count - a.count);
        return {
          ...row,
          win_count: winCount,
          techniques,
        };
      });
    });
  },

  /**
   * 会場別・枠番別のトップスタート実績（回数/確率、トップスタート時の1着率）を取得する（BOA-154）
   * 日次バッチ（scripts/daily/update-top-start-stats.js）で事前集計したテーブルを参照する
   */
  getTopStartStats(venueCode) {
    return withCache(`top-start-stats-${venueCode}`, async () => {
      if (!supabase) {
        console.error("Supabase client not initialized");
        return { venue_code: venueCode, last_updated: null, data: [] };
      }

      const { data, error } = await supabase
        .from("top_start_stats")
        .select("*")
        .eq("venue_code", venueCode)
        .order("boat_number");

      if (error) {
        console.error("Supabase getTopStartStats error:", error.message);
        return { venue_code: venueCode, last_updated: null, data: [] };
      }

      return {
        venue_code: venueCode,
        last_updated: data?.[0]?.last_updated ?? null,
        data: data ?? [],
      };
    });
  },

  /**
   * 会場別・枠番別の負け決まり手（1着を逃した際、勝者がどの決まり手で勝ったか）を取得する（BOA-157）
   * 既存のgetWinningTechniqueStatsと対になる。v1ではEdge API連携は行わず、Supabase直接クエリのみ
   */
  getLosingTechniqueStats(venueCode) {
    return withCache(`losing-technique-stats-${venueCode}`, async () => {
      if (!supabase) {
        console.error("Supabase client not initialized");
        return {
          venue_code: venueCode,
          venue_name: "",
          last_updated: null,
          data: {},
        };
      }

      const { data, error } = await supabase
        .from("losing_technique_stats")
        .select("*")
        .eq("venue_code", venueCode)
        .order("boat_number")
        .order("percentage", { ascending: false });

      if (error) {
        console.error("Supabase getLosingTechniqueStats error:", error.message);
        return {
          venue_code: venueCode,
          venue_name: "",
          last_updated: null,
          data: {},
        };
      }

      if (!data || data.length === 0) {
        return {
          venue_code: venueCode,
          venue_name: "",
          last_updated: null,
          data: {},
        };
      }

      const techniqueData = {};
      let lastUpdated = null;

      data.forEach((row) => {
        const boatNumber = row.boat_number;
        if (!techniqueData[boatNumber]) {
          techniqueData[boatNumber] = {
            total_races: row.total_losses_90days,
            techniques: [],
          };
        }

        techniqueData[boatNumber].techniques.push({
          technique: row.losing_technique,
          count: row.count_90days,
          percentage: row.percentage,
        });

        if (!lastUpdated) {
          lastUpdated = row.last_updated;
        }
      });

      const VENUE_NAMES = {
        1: "桐生",
        2: "戸田",
        3: "江戸川",
        4: "平和島",
        5: "多摩川",
        6: "浜名湖",
        7: "蒲郡",
        8: "常滑",
        9: "津",
        10: "三国",
        11: "びわこ",
        12: "住之江",
        13: "尼崎",
        14: "鳴門",
        15: "丸亀",
        16: "児島",
        17: "宮島",
        18: "徳山",
        19: "下関",
        20: "若松",
        21: "芦屋",
        22: "福岡",
        23: "唐津",
        24: "大村",
      };

      return {
        venue_code: venueCode,
        venue_name: VENUE_NAMES[venueCode] || "",
        last_updated: lastUpdated,
        data: techniqueData,
      };
    });
  },

  /**
   * ST考察の「同コース・同級別の平均」ベースラインを取得する（phase a FR-1、ADR-0068）。
   *
   * `st_course_baseline` はコース(1〜6) × 級別(A1/A2/B1/B2) の24行だけの
   * 事前集計テーブル（日次バッチ update-course-baseline-stats.js が更新する）。
   * レース詳細を開くたびに約56万行を集計するのは非機能要件（Disk IO予算・
   * +3クエリ以内）に反するため、画面は単純なSELECTで読む。
   *
   * 取得エラーは例外になる（supabaseClient.js が .throwOnError() を既定適用）。
   * 094未適用の環境では権限エラーになるので、呼び出し側は
   * 「セクションを出さない」に倒す（ピットレポートと同じ扱い）。
   *
   * キーにスキーマ版（-v1）を含める: 094をロールバックした場合、成功レスポンスが
   * クライアントのlocalStorageに残りうるため、キーを変えて無効化できるようにする
   */
  getStCourseBaseline() {
    return withCache("st-course-baseline-v1", async () => {
      if (!supabase) {
        throw new Error("Supabase client not initialized");
      }
      try {
        const { data } = await supabase
          .from("st_course_baseline")
          .select(
            "course, grade, window_start, window_end, window_days, runs, avg_st, stable_rate, late_rate, breakout_count, breakout_rate, st_histogram",
          )
          .order("course")
          .order("grade");
        return data ?? [];
      } catch (error) {
        if (isPermissionDeniedError(error)) {
          // 094（匿名へのSELECT公開）が未適用の間はここを通る。
          // withCacheに保存させないためfetchFailedを付ける
          return { state: "forbidden", rows: [], fetchFailed: true };
        }
        throw error;
      }
    });
  },

  /**
   * 節の全選手の今節得点率と順位を取得する（phase a FR-3 Phase B、BOA-291）。
   *
   * ## なぜ節の全選手が要るのか
   *
   * 得点率は**単独では読めない**。「3.67」と出しても、準優に乗るのかが分からない。
   * ファンが見たいのは「この節の中で今どこにいるか」「準優の枠まであと何点か」で、
   * それには節の全選手（約48名）の得点率が要る。
   *
   * ## 取得は3本
   *
   * `race_id` が `YYYY-MM-DD-VV-RR` の固定長なので、`like("__________-VV-__")` で
   * 会場を厳密に絞れる（実測: 桐生の1節=432行を1クエリ・550ms）。
   * 節の切り出しは日付の連続性（間隔2日以内）で行う。`race_series` は引かない。
   *
   * **1レース詳細あたり+3本**。ただしキーは節単位なので、6艇のどれを開いても
   * 使い回され、同じ節の他のレースを開いても再取得しない。
   *
   * @param {string} raceId 表示中のレース
   * @param {number} venueCode
   * @returns {Promise<{rows: Array, currentStage: string|null,
   *   meetStart: string, meetEnd: string, semifinalSlots: number|null}>}
   */
  getMeetScoreboard(raceId, venueCode) {
    const date = (raceId ?? "").slice(0, 10);
    if (!date || venueCode === null || venueCode === undefined) {
      return Promise.resolve(null);
    }
    const vv = String(venueCode).padStart(2, "0");
    // v15: 本番STの「欠」の行を出走に数えない（BOA-504）
    return withCache(`meet-scoreboard-v15-${raceId}`, async () => {
      if (!supabase) throw new Error("Supabase client not initialized");

      // 節は最長でも7日程度。表示日から9日前までを見れば前節との境目が入る。
      // **窓を広げるときは既定の1000行上限に注意する**。出走表は10日 × 12R × 6艇 =
      // 最大720行で、余裕は280行しか無い（12日ぶんで864行、14日で上限を超える）。
      // 上限に当たっても PostgREST はエラーを返さず黙って切るので、古い日が
      // 落ちて節の境目を見失う。広げるならページングを入れる
      const from = new Date(date);
      from.setDate(from.getDate() - 9);
      const windowStart = from.toISOString().slice(0, 10);
      // 出走表と**窓ぶんの種別**を同時に取る。種別は節の初日を決めるのに要るので
      // `meetStart` より先に要るが、窓の範囲は `meetStart` に依存しないため
      // 往復は増えない（この2本のあとに走る並列の束から種別を外している）
      const [entriesRes, windowConditionsRes] = await Promise.all([
        supabase
          .from("race_entries")
          .select("race_id, boat_number, racer_id, player_name")
          .gte("race_id", windowStart)
          // **これから走るレースも含めて**取る（2026-09-28）。得点率の集計は
          // 「結果がまだ無いレースは分母に入れない」で弾いているので混ざらない。
          // 必要得点（ボーダーに届くのに要る点）には**残り何走あるか**が要り、
          // それは番組が出ている予選レースの数から数えるしかない
          .lte("race_id", `${date}-zz`)
          .like("race_id", `__________-${vv}-__`),
        supabase
          .from("race_conditions")
          // `race_title` も取る（追加クエリ0本）。男女Ｗ優勝戦＝1つの節に2シリーズが
          // 同居する開催の検出に使う（BOA-511）。判定材料はこの列だけで足りる
          .select("race_id, race_stage, is_final_day, series_day, race_title")
          .gte("race_id", windowStart)
          .lte("race_id", `${date}-zz`)
          .like("race_id", `__________-${vv}-__`),
      ]);

      const rows = entriesRes.data ?? [];
      if (rows.length === 0) return null;
      const windowConditions = windowConditionsRes.data ?? [];

      // **節の初日は `series_day` から決める**（BOA-508）。
      // 以前は日付の連続性（間が2日を**超えたら**別の節）で切っていたが、
      // 節と節の間が中1日空くと連続する開催日の差がちょうど2日になり、
      // 境目とみなされず**前の節が丸ごと混ざっていた**。2026-09-28 戸田8Rで
      // 節内順位が6艇とも「対象外」になり、出場人数・準優の目安・必要得点が
      // 前の節の値になった（BOA-491）。実測では3,065（会場×日）のうち59件で
      // 前の節を跨いでいた。
      //
      // `race_entries` にしか無い日（種別が未取得）も拾えるよう、日付は出走表側を
      // 基準にし、`series_day` は種別から引く
      const conditionByDate = new Map();
      for (const c of windowConditions) {
        const d = c.race_id.slice(0, 10);
        const cur = conditionByDate.get(d) ?? {
          seriesDay: null,
          isFinalDay: false,
        };
        if (
          c.series_day != null &&
          (cur.seriesDay == null || c.series_day < cur.seriesDay)
        )
          cur.seriesDay = c.series_day;
        if (c.is_final_day) cur.isFinalDay = true;
        conditionByDate.set(d, cur);
      }
      const meetStart =
        findMeetStartDate(
          [...new Set(rows.map((r) => r.race_id.slice(0, 10)))].map((d) => ({
            date: d,
            seriesDay: conditionByDate.get(d)?.seriesDay ?? null,
            // 種別が1行も取れていない日は「分からない」。false（最終日でない）と
            // 区別する必要があるので null を渡す
            isFinalDay: conditionByDate.has(d)
              ? conditionByDate.get(d).isFinalDay
              : null,
          })),
          date,
        ) ?? date;
      const meetRows = rows.filter((r) => r.race_id.slice(0, 10) >= meetStart);
      const raceIds = [...new Set(meetRows.map((r) => r.race_id))];
      // 節に絞った種別（以降は今までどおり `conditions` として使う）
      const conditions = windowConditions.filter(
        (c) => c.race_id.slice(0, 10) >= meetStart,
      );

      const [
        results,
        cancellations,
        pretest,
        meetExhibition,
        meetStarts,
        officialSeries,
      ] = await Promise.all([
        fetchAllByIn(
          "race_results",
          "race_id, rank1, rank2, rank3, rank4, rank5, rank6",
          "race_id",
          raceIds,
        ),
        // **中止・順延**（047、BOA-254）。番組に残っているだけで行われなかった
        // レースを、準優の枠数から外すのに使う（BOA-490）。並列の束に入るので
        // 往復は増えず、行数も節の全レース（最大約84行）×2列で済む
        fetchAllByIn(
          "races",
          "race_id, cancellation_status",
          "race_id",
          raceIds,
        ),
        // 前検タイム（FR-4a、`motor_pretest_stats`。095で匿名SELECTを公開済み）。
        // 機力の**起点**。今節の展示順位の推移だけでは「元から悪い舟」なのか
        // 「調整が進んだ」のかが読めない。節の全選手分を1クエリで引く
        supabase
          .from("motor_pretest_stats")
          // `racer_class` も一緒に取る（追加クエリ0本）。級別は「44人中43位」が
          // B2の順当なのかA1の不調なのかを分ける情報で、勝負駆けの読みが変わる
          .select(
            "racer_id, race_date, motor_number, pretest_time, pretest_rank, racer_class",
          )
          .eq("venue_code", venueCode)
          .gte("race_date", meetStart)
          .lte("race_date", date)
          .then(({ data }) => data ?? []),
        // **節の全レース・全艇**の展示タイム（2026-09-27追加、+1本）。
        // 2つの用途を1クエリで賄う:
        //   1. その日の会場平均（水面の重さ。同じ6.90でも日によって意味が違う）
        //   2. 6艇それぞれの今節の展示の推移（選手単位で引くと6本増える）
        // 節は最長7日 × 12R × 6艇 = 504行で、Supabaseの既定上限1000行に収まる
        supabase
          .from("exhibition_data")
          .select("race_id, boat_number, exhibition_time")
          .gte("race_id", meetStart)
          .lt("race_id", raceId)
          .like("race_id", `__________-${vv}-__`)
          .then(({ data }) => data ?? []),
        // 同じく節の全レース・全艇の本番ST（+1本）。6艇のST推移に使う。
        // フライングは異常値なので呼び出し側で落とす
        supabase
          .from("race_start_timings")
          // finish_mark: 欠場の行（「欠」）を出走から外すため（BOA-504）
          .select("race_id, boat_number, start_timing, is_flying, finish_mark")
          .gte("race_id", meetStart)
          .lt("race_id", raceId)
          .like("race_id", `__________-${vv}-__`)
          .then(({ data }) => data ?? []),
        // 公式の得点率一覧のスクレイプ（064）。**備考がそのまま入っている**ので、
        // 「賞典除外」「途中帰郷」で順位の対象外を直接判定できる（推定が要らない）。
        // ただし収録はSG/G1の一部のみ（2026-09-28時点で2開催101行）なので、
        // 無い開催では出走の有無からの推定にフォールバックする
        supabase
          .from("racer_series_points")
          // 備考（賞典除外・途中帰郷）に加えて、**得点率そのもの**も使う。
          // 公式の得点率は `(着順点 − 減点) ÷ 走数` で、当社は減点を持って
          // いないため、減点のある選手とその下の全員の順位がズレる（BOA-475）。
          // 走数の列は無いが `placements` の文字数から出せる
          .select("racer_id, remarks, placements, total_points, penalty_points")
          .eq("venue_code", venueCode)
          .eq("meet_start_date", meetStart)
          .then(({ data }) => data ?? []),
      ]);
      const resultById = new Map((results ?? []).map((r) => [r.race_id, r]));
      // 中止が**確定**し、結果も無いレース。判定は `isRaceCancelled` に集めてあるので
      // ここで文字列を比べない（`src/utils/raceCancellation.js`。疑いの段階と
      // 確定を各所で書き分けると必ずズレる、というのがあの関数の由来）。
      // 中止の疑い（tentative）は含まれない——疑いで枠数を減らすと、実際は
      // 行われたときにボーダーが狂う。結果の行を渡すので、誤って確定が残った
      // 実施済みのレースも含まれない（BOA-525）。列名だけスネーク→キャメルに合わせる
      const cancelledRaceIds = new Set(
        (cancellations ?? [])
          .filter((r) =>
            isRaceCancelled({
              cancellationStatus: r.cancellation_status,
              result: resultById.get(r.race_id) ?? null,
            }),
          )
          .map((r) => r.race_id),
      );
      const stageById = new Map(
        (conditions ?? []).map((c) => [c.race_id, c.race_stage]),
      );
      // **男女Ｗ優勝戦の節を2シリーズに分ける**（BOA-511）。同じレースを走った
      // 選手を辿った連結成分がシリーズになる。該当しなければ null。
      // 出走表は節ぶんを既に持っているので追加クエリ0本
      const racersByRace = new Map();
      for (const e of meetRows) {
        if (!racersByRace.has(e.race_id)) racersByRace.set(e.race_id, []);
        if (e.racer_id != null) racersByRace.get(e.race_id).push(e.racer_id);
      }
      const meetSeries = splitMeetSeries(conditions ?? [], racersByRace);
      // 表示中のレースの6艇が属する側。**6艇全員が同じ側に居るときだけ**分ける。
      // 予選終了後の消化レースには両方の選手が乗ることがあり（多摩川に5レース）、
      // 「1人でも居る側」で決めると反対側の艇が表から消える。
      // そういうレースでは分けずに節全体を出す（注記も出さない）
      const currentRacers = (racersByRace.get(raceId) ?? []).filter(
        (r) => r !== null && r !== undefined,
      );
      const currentSeries =
        currentRacers.length > 0
          ? (meetSeries?.find((set) =>
              currentRacers.every((r) => set.has(r)),
            ) ?? null)
          : null;
      // 枠数はシリーズの準優だけから出す。節全体で数えると2シリーズ合計になる
      // 枠数を出すための、この側のレースだけの種別。
      // **1つの準優に両側の選手が混ざらないことが前提**（実データのＷ開催6節では
      // 準優12本すべてが 6+0 か 0+6）。`some` で絞っているので、もし混合の準優が
      // 現れると両側の `seriesConditions` に入り、枠数が反対側の選手ごと数えられる。
      // 予選終了後の消化レースは混ざるが、そちらは `semifinalRaceIdsOf` が
      // 種別で落とすので枠数には効かない
      const seriesConditions = currentSeries
        ? (conditions ?? []).filter((c) =>
            (racersByRace.get(c.race_id) ?? []).some((r) =>
              currentSeries.has(r),
            ),
          )
        : (conditions ?? []);
      // **本番スタートの記録があるか**（欠場の判定。BOA-489）。
      // 着順に載らない走には「失格・落水（走ったが着順が付かない。0点だが
      // 走数に入れる）」と「欠場（走っていない。走数にも入れない）」があり、
      // 区別にはST記録の有無を使う。`meetStarts` は得点率に使う範囲
      // （節の頭〜表示中レースの直前）と同じ窓を引いているので追加クエリ0本。
      //
      // STが1行も無いレースは**取得漏れ**の可能性があるため、全艇を出走扱いに
      // 倒す（欠場扱いにするとレースが丸ごと得点率から消えて、いま直そうと
      // している誤差より大きく狂う）
      // 欠場の艇にも行がある（finish_mark が「欠」）ので、それは出走に数えない（BOA-504）
      const startedKeys = new Set(
        (meetStarts ?? [])
          .filter((r) => !isAbsentStartRow(r))
          .map((r) => `${r.race_id}|${r.boat_number}`),
      );
      const racesWithSt = new Set((meetStarts ?? []).map((r) => r.race_id));

      return {
        meetStart,
        meetEnd: date,
        // 表示中レースの種別。早見（得点率がどう動くか）の出し分けに使う
        currentStage: stageById.get(raceId) ?? null,
        // **予選の終わり**＝種別が「予選」の最後のレースの race_id。
        // 得点率はここで確定し、以降は算入されない。公式の得点率一覧も
        // 「4日目12R終了時点」で止まる（2026-09-27に若松G1で確認）。
        //
        // 最初の準優を境にすると**予選終了後の一般戦を算入してしまう**。
        // 若松は9/25(4日目)で予選が終わり、9/26は1R〜8Rが一般戦・9R〜11Rが
        // 準優だった。「最初の準優より前」で切ると9/26の一般戦が入り、
        // 52人中32人の得点率が公式とズレた（公式と照合して5/5で確認）。
        // 無い（予選中でまだ予選が終わっていない）なら null
        prelimEndRaceId: prelimEndRaceIdOf(conditions ?? []),
        // **公式の得点率一覧（`racer_series_points`）の行**。
        // `buildMeetRanking` がこれを受け取ると、当社計算ではなく公式の値で
        // 得点率・節内順位・着順の並びを出す（BOA-475）。
        //
        // **予選が終わった後の表示でだけ渡す**。公式の行は節に1行しか無く、
        // 中身は「◯日目１２R終了時点」＝予選終了時点のスナップショットなので、
        // 予選中のレースを開いているときに使うと**まだ走っていない走を含む
        // 得点率・順位**を出してしまう（レース詳細は過去日も開ける）。
        // 予選中は従来どおり当社計算で、減点のズレは残る（公式の行が生えるのも
        // 4日目以降なので、予選中は直しようが無い）
        officialByRacer: (() => {
          // 「使ってよいか」の判断は純関数に切り出してある（回帰テスト可能）
          if (
            !shouldUseOfficialSeries(
              stageById.get(raceId) ?? null,
              raceId,
              prelimEndRaceIdOf(conditions ?? []),
            )
          )
            return null;
          const rows = officialSeries ?? [];
          if (rows.length === 0) return null;
          return Object.fromEntries(rows.map((r) => [r.racer_id, r]));
        })(),
        // **途中で節を離脱した選手**（途中帰郷）。公式の順位表はこの選手たちを
        // 順位から外すため、当社が全員で順位を振ると下位ほどズレる。
        //
        // 判定は「節の最終日に1度も出走が無い」。2026-09-28に実測で裏を取った:
        //   若松G1 … 該当2名が公式の「途中帰郷」2名と完全一致。除くと
        //             推定ボーダーが 5.67 → 5.60 になり実ボーダーと**完全一致**
        //   桐生   … 該当5名は全員、他会場でも走っておらず9/22〜9/24で出走が
        //             途切れている（節の前後半でメンバーが入れ替わる形ではない）
        //
        // **節が終わるまでは判定できない**（最終日が未来なので）。
        // `is_final_day` が取れていて、その日を過ぎている場合だけ有効にする。
        // 賞典除外は判定できない（該当選手は最終日まで普通に走っている）
        withdrawnRacerIds: (() => {
          // 公式の備考が取れていればそれが正（推定より確実）。
          // 「賞典除外」「途中帰郷」など、公式が順位を付けていない選手
          // （rank/score_rate が NULL）を除く
          const official = (officialSeries ?? []).filter((r) => r.remarks);
          if (official.length > 0) return official.map((r) => r.racer_id);

          // 収録が無い開催（一般戦など）は出走の有無から推定する
          const finalDayRow = (conditions ?? []).find((c) => c.is_final_day);
          const finalDay = finalDayRow?.race_id.slice(0, 10) ?? null;
          if (!finalDay || date < finalDay) return [];
          const ranAtFinalDay = new Set(
            meetRows
              .filter((e) => e.race_id.startsWith(finalDay))
              .map((e) => e.racer_id),
          );
          const all = new Set(meetRows.map((e) => e.racer_id));
          return [...all].filter((id) => !ranAtFinalDay.has(id));
        })(),
        // **残りの予選走数**（表示中のレースを含む）。公式の「必要得点」は
        // 「準優ボーダーをクリアするために必要な得点」で、実データから
        // 逆算すると `ボーダー × (今の走数 + 残り走数) − 今の得点` だった
        // （公式の図: 篠崎 得点率5.75・残り2走 → 13点／池田 7.00・残り1走 → 1点）。
        // 残り走数は**番組が出ている予選レース**からしか数えられないので、
        // 当社は当日ぶんまでで数える（翌日以降の出走表は未取得のことが多い）。
        // 画面側はその旨を注記する
        //
        // **算入判定は得点率と同じ `countsForSeriesScore` を通す**。
        // 以前は「種別に『予選』を含むレース」だけを数えていたため、
        // 予選期間内でも会場固有名のレース（芦屋「サンライズＸ戦」、桐生
        // 「ドラドキ３」等）が残り走数から漏れ、必要得点が過大になっていた
        // （BOA-457）
        remainingPrelimRunsByRacer: (() => {
          const byRacer = {};
          const prelimEnd = prelimEndRaceIdOf(conditions ?? []);
          for (const e of meetRows) {
            if (e.race_id < raceId) continue;
            const st = stageById.get(e.race_id) ?? "";
            if (!countsForSeriesScore(st, e.race_id, prelimEnd)) continue;
            byRacer[e.racer_id] = (byRacer[e.racer_id] ?? 0) + 1;
          }
          return byRacer;
        })(),
        // 残り走で取りうる**最大得点**。残りの本数だけでは出せない（ドリーム戦の
        // 1着は12点、特選は11点）。予選配点の10点で決め打ちすると、ドリーム戦が
        // 残っている選手を「届かず」と誤って出す（BOA-457）
        remainingPrelimMaxPointsByRacer: (() => {
          const byRacer = {};
          const prelimEnd = prelimEndRaceIdOf(conditions ?? []);
          for (const e of meetRows) {
            if (e.race_id < raceId) continue;
            const st = stageById.get(e.race_id) ?? "";
            if (!countsForSeriesScore(st, e.race_id, prelimEnd)) continue;
            byRacer[e.racer_id] =
              (byRacer[e.racer_id] ?? 0) + scoreTableFor(st)[1];
          }
          return byRacer;
        })(),
        // 予選が終わった日が節の何日目か（公式の「4日目12R終了時点」に合わせる）
        prelimEndDay: (() => {
          const last = prelimEndRaceIdOf(conditions ?? []);
          if (!last) return null;
          // `dates` は9日窓ぶん（前節を含む）なので、節の日付だけで数える
          const meetDates = [
            ...new Set(meetRows.map((r) => r.race_id.slice(0, 10))),
          ].sort();
          return meetDates.indexOf(last.slice(0, 10)) + 1 || null;
        })(),
        // **この節に組まれた準優勝戦の枠数**。慣例は3個レース=18名で、決められない
        // とき（予選中で準優がまだ番組に出ていない等）は **null**（0ではない）。
        // 画面は `?? SEMIFINAL_DEFAULT_SLOTS` で既定の18枠に落とす。
        // 「準優進出戦」は準優の1つ前の勝ち上がり戦なので数えない（BOA-457）。
        // 中止で流れた準優も数えない。番組に2日ぶん残る中止順延で枠数が倍になり、
        // ボーダー・必要得点・「届かず」まで狂う（BOA-490）
        semifinalSlots: semifinalSlotsOf(seriesConditions, {
          cancelledRaceIds,
          ranRaceIds: new Set(resultById.keys()),
          // 枠数は本数 × 6 ではなく実人数で数える。多摩川のＷ準優戦は
          // 同じ12名が2回走るヒートで、本数で数えると倍になる
          racersByRace,
        }),
        // **男女Ｗ優勝戦の節で、表示中の6艇が属するシリーズの選手**（BOA-511）。
        // null なら通常の節で、画面はこれまでどおり節全体を母集団にする。
        // 2シリーズを混ぜて順位を振ると、節内順位・出場人数・準優の目安が
        // すべて実際の勝ち上がり争いとズレる
        seriesRacerIds: currentSeries ? [...currentSeries] : null,
        // **節がＷ開催か**（`seriesRacerIds` とは別）。両方の選手が乗るレースでは
        // 分けられないので `seriesRacerIds` が null になるが、そのときも
        // 「なぜ節全体で出しているのか」を画面が断れるようにする（BOA-511）
        isSplitMeet: Boolean(meetSeries),
        // 節の全レースの種別が取れているか（取れていなければ枠数は目安のまま）
        stagesKnown: stageById.size > 0,
        // その日の会場の展示タイム平均（水面の重さ）。同じ6.90でも日によって
        // 意味が変わるため、選手個人の推移を読むときの補正に使う。
        // 実測（若松2026-09-22〜27）で日ごとに 6.829〜6.907 と0.08秒動く
        venueDailyExhibitionAvg: Object.fromEntries(
          [
            ...(meetExhibition ?? [])
              .filter((r) => r.exhibition_time != null)
              .reduce((map, r) => {
                const d = r.race_id.slice(0, 10);
                const cur = map.get(d) ?? { sum: 0, n: 0 };
                cur.sum += Number(r.exhibition_time);
                cur.n += 1;
                map.set(d, cur);
                return map;
              }, new Map()),
          ].map(([d, v]) => [d, v.sum / v.n]),
        ),
        // 6艇それぞれの今節の走（ST・展示）。選手単位で引くと6本増えるため、
        // 節の全レースぶんを2クエリで取って画面側で選手ごとに畳む
        meetRunsByRacer: (() => {
          const exByRace = new Map();
          for (const r of meetExhibition ?? []) {
            if (!exByRace.has(r.race_id)) exByRace.set(r.race_id, new Map());
            exByRace.get(r.race_id).set(r.boat_number, r.exhibition_time);
          }
          const stByRace = new Map();
          for (const r of meetStarts ?? []) {
            if (!stByRace.has(r.race_id)) stByRace.set(r.race_id, new Map());
            stByRace.get(r.race_id).set(r.boat_number, r);
          }
          const byRacer = {};
          for (const e of meetRows) {
            // 推移も**表示中のレースより前**だけ（未実施のレースは
            // 展示もSTも無いので実害は無いが、過去日を開いたときに
            // 同じ日の後のレースを拾わないよう明示的に切る）
            if (e.race_id >= raceId) continue;
            const ex = exByRace.get(e.race_id)?.get(e.boat_number) ?? null;
            const stRow = stByRace.get(e.race_id)?.get(e.boat_number) ?? null;
            const st =
              stRow && !stRow.is_flying && stRow.start_timing != null
                ? Number(stRow.start_timing)
                : null;
            // そのレースの中で何番目のSTだったか（1が最速、同着は同順位）。
            // 「毎回ちゃんと届いているか」は平均STより順位の方が直接的で、
            // 日和の「安定率」（当社定義は最速STとの差0.05以内の割合）が
            // 答えようとしている問いに、%より読みやすい形で答えられる。
            // Fの艇は順位から外す（異常値のため）
            const sameRace = [...(stByRace.get(e.race_id)?.values() ?? [])]
              .filter((r) => !r.is_flying && r.start_timing != null)
              .map((r) => Number(r.start_timing));
            (byRacer[e.racer_id] ??= []).push({
              raceId: e.race_id,
              date: e.race_id.slice(0, 10),
              exhibition: ex === null ? null : Number(ex),
              st,
              stRank:
                st === null ? null : sameRace.filter((v) => v < st).length + 1,
            });
          }
          for (const id of Object.keys(byRacer)) {
            byRacer[id].sort((a, b) => a.raceId.localeCompare(b.raceId));
          }
          return byRacer;
        })(),
        // 選手ごとの前検（節の最初の行＝前検日のもの）。
        // 直近は節の中の複数日に行があるため、最も古い日付を採る。
        // 採り方の根拠と、モータ情報タブ（最新の行を採る）と必ず一致することの
        // 実測は src/utils/pretestRows.js を読むこと
        pretestByRacer: Object.fromEntries(pickFirstPretestByRacer(pretest)),
        // 得点率の計算は画面側の純関数（seriesPoints.js）と同じ規則。
        // ここでは素材（着順と種別）だけ渡し、集計は呼び出し側に任せる。
        // **表示中のレースより前だけ**を渡す。過去日を開いているときは
        // 同じ日の後のレースにも結果があるため、範囲を広げたまま渡すと
        // 「5Rを見ているのに9Rの結果まで得点率に入る」状態に戻る
        // （2026-09-28、必要得点のために取得範囲を広げた際に一度再発させた）
        entries: meetRows
          .filter((e) => e.race_id < raceId)
          .map((e) => ({
            raceId: e.race_id,
            boatNumber: e.boat_number,
            racerId: e.racer_id,
            playerName: e.player_name,
            raceStage: stageById.get(e.race_id) ?? null,
            // 欠場を走数から外すための材料（BOA-489）
            started:
              !racesWithSt.has(e.race_id) ||
              startedKeys.has(`${e.race_id}|${e.boat_number}`),
            ...(resultById.get(e.race_id) ?? {}),
          })),
      };
    });
  },

  /**
   * 選手の「前期」の期別成績を取得する（phase a FR-4c、マイグレーション095）。
   *
   * `racer_period_stats` は公式の期別成績ファイル（fan）由来で、期ごとに
   * 1選手1行。**集計はしない**——取得した値をそのまま表示する。
   *
   * ## as-of で引く（最新期で決め打ちしない）
   *
   * 083_racer_period_stats.sql:218-219 のCOMMENTどおり「レース日 > `calc_to` の
   * 最新の期」を使う。最新期で決め打ちすると、過去日のレースを開いたときに
   * **そのレースより未来の成績**を「前期」として出してしまう（2026-01-15の
   * レースに、算出期間が2026-04-30までの期を出すことになる）。
   *
   * 期の境界は 5/1 と 11/1（`period_no` 1 = 5/1〜10/31、2 = 11/1〜4/30、
   * `period_year` は算出期間の終了が4月の年）。クライアントで計算できるので、
   * `.eq()` 2つで6行に絞る（絞らないと1選手あたり約12期分が返る）。
   *
   * ## 単位に注意
   *
   * `win_rate` は**公式勝率（点、実測1.07〜8.24）**で、自社集計の1着率（%）とは
   * 別物。同じ列に並べてはいけない（画面では別枠の固定3値として出す）。
   * `top3_rate` に相当する列は無い。
   *
   * 095未適用の環境では権限エラーになるので、呼び出し側は「枠ごと出さない」に
   * 倒す（getStCourseBaseline と同じ扱い）。
   *
   * @param {Array<number>} racerIds 登録番号
   * @param {string} raceDate `YYYY-MM-DD`。この日より前に終わった期を引く
   */
  getRacerPeriodStats(racerIds, raceDate) {
    const ids = [...new Set((racerIds ?? []).filter(Boolean))].sort(
      (a, b) => a - b,
    );
    if (ids.length === 0 || !raceDate) return Promise.resolve([]);

    // レース日から見て「直前に**終わった**期」を求める。
    // `period_year` Y は「5月〜翌4月の年度」を指し、その中が2つに割れる
    // （本番DBの全15期を実測して確認した。083のCOMMENTの言い換え）:
    //   (Y,1) = (Y-1)-05-01 〜 (Y-1)-10-31
    //   (Y,2) = (Y-1)-11-01 〜     Y-04-30
    // 例: (2026,1)=2025-05-01〜2025-10-31、(2026,2)=2025-11-01〜2026-04-30
    // したがって直前に終わった期は
    //   5〜10月  → (Y,2)   … Y-04-30 に終わった期
    //   11〜12月 → (Y+1,1) … Y-10-31 に終わった期
    //   1〜4月   → (Y,1)   … (Y-1)-10-31 に終わった期
    const [y, m] = raceDate.split("-").map(Number);
    const periodYear = m >= 5 && m <= 10 ? y : m >= 11 ? y + 1 : y;
    const periodNo = m >= 5 && m <= 10 ? 2 : 1;

    return withCache(
      `racer-period-stats-v1-${periodYear}-${periodNo}-${ids.join(",")}`,
      async () => {
        if (!supabase) {
          throw new Error("Supabase client not initialized");
        }
        try {
          const { data } = await supabase
            .from("racer_period_stats")
            .select(
              "racer_id, period_year, period_no, calc_from, calc_to, win_rate, top2_rate, avg_st, starts",
            )
            .eq("period_year", periodYear)
            .eq("period_no", periodNo)
            .in("racer_id", ids);
          return data ?? [];
        } catch (error) {
          if (isPermissionDeniedError(error)) {
            // 095（匿名へのSELECT公開）が未適用の間はここを通る
            return { state: "forbidden", rows: [], fetchFailed: true };
          }
          throw error;
        }
      },
    );
  },

  /**
   * 逃げシミュレーション（この会場で1コースが逃げたときの2着コース分布）を
   * 取得する（phase a FR-6、ADR-0068）。会場別・5行だけ。
   *
   * 既存の getNigeOutcomeDistribution（027、艇番基準・90日・3連単粒度）とは
   * 粒度も期間も違う別物（あちらはBOA-158の「逃げ成功時分布」タブが使用中）。
   */
  getNigeSimulation(venueCode) {
    return withCache(`nige-simulation-v1-${venueCode}`, async () => {
      if (!supabase) {
        throw new Error("Supabase client not initialized");
      }
      try {
        const { data } = await supabase
          .from("nige_second_by_course")
          .select(
            "venue_code, second_course, window_start, window_end, window_days, total_races, nige_races, second_count, second_rate, exacta_rate",
          )
          .eq("venue_code", venueCode)
          .order("second_course");
        return data ?? [];
      } catch (error) {
        if (isPermissionDeniedError(error)) {
          return { state: "forbidden", rows: [], fetchFailed: true };
        }
        throw error;
      }
    });
  },

  /**
   * 逃げ成功時（winning_technique='逃げ'）の複勝分布を取得する（BOA-158）
   * 既存のgetOutcomeDistributionと対になるが、テーブル・集計とも分離されている
   */
  getNigeOutcomeDistribution(venueCode) {
    return withCache(`nige-outcome-distribution-${venueCode}`, async () => {
      if (!supabase) {
        console.error("Supabase client not initialized");
        return {
          venue_code: venueCode,
          venue_name: "",
          total_races: 0,
          last_updated: null,
          data: {},
        };
      }

      const { data, error } = await supabase
        .from("nige_outcome_distribution")
        .select("*")
        .eq("venue_code", venueCode)
        .order("first_boat")
        .order("count_90days", { ascending: false });

      if (error) {
        console.error(
          "Supabase getNigeOutcomeDistribution error:",
          error.message,
        );
        return {
          venue_code: venueCode,
          venue_name: "",
          total_races: 0,
          last_updated: null,
          data: {},
        };
      }

      if (!data || data.length === 0) {
        return {
          venue_code: venueCode,
          venue_name: "",
          total_races: 0,
          last_updated: null,
          data: {},
        };
      }

      const outcomesData = {};
      let totalRaces = 0;
      let lastUpdated = null;

      data.forEach((row) => {
        const firstBoat = row.first_boat;
        if (!outcomesData[firstBoat]) {
          outcomesData[firstBoat] = [];
        }

        outcomesData[firstBoat].push({
          second_boat: row.second_boat,
          third_boat: row.third_boat,
          count: row.count_90days,
          probability: row.probability,
          avg_payout: row.avg_payout,
        });

        if (!totalRaces) {
          totalRaces = row.total_races;
          lastUpdated = row.last_updated;
        }
      });

      const VENUE_NAMES = {
        1: "桐生",
        2: "戸田",
        3: "江戸川",
        4: "平和島",
        5: "多摩川",
        6: "浜名湖",
        7: "蒲郡",
        8: "常滑",
        9: "津",
        10: "三国",
        11: "びわこ",
        12: "住之江",
        13: "尼崎",
        14: "鳴門",
        15: "丸亀",
        16: "児島",
        17: "宮島",
        18: "徳山",
        19: "下関",
        20: "若松",
        21: "芦屋",
        22: "福岡",
        23: "唐津",
        24: "大村",
      };

      return {
        venue_code: venueCode,
        venue_name: VENUE_NAMES[venueCode] || "",
        total_races: totalRaces,
        last_updated: lastUpdated,
        data: outcomesData,
      };
    });
  },

  /**
   * 会場別・枠番別の展示タイム最速実績（回数/確率、最速時の1着率）を取得する（BOA-160）
   * 日次バッチ（scripts/daily/update-exhibition-time-top-stats.js）で事前集計したテーブルを参照する
   */
  getExhibitionTimeTopStats(venueCode) {
    return withCache(`exhibition-time-top-stats-${venueCode}`, async () => {
      if (!supabase) {
        console.error("Supabase client not initialized");
        return { venue_code: venueCode, last_updated: null, data: [] };
      }

      const { data, error } = await supabase
        .from("exhibition_time_top_stats")
        .select("*")
        .eq("venue_code", venueCode)
        .order("boat_number");

      if (error) {
        console.error(
          "Supabase getExhibitionTimeTopStats error:",
          error.message,
        );
        return { venue_code: venueCode, last_updated: null, data: [] };
      }

      return {
        venue_code: venueCode,
        last_updated: data?.[0]?.last_updated ?? null,
        data: data ?? [],
      };
    });
  },

  /**
   * unifiedモデルの3連単参考情報（FR4）を1レース分取得する（AI予想モデル大規模改修 Task11）。
   * scripts/daily/generate-unified-trifecta-reference.js（発走前バッチ）が書き込む。
   * 発走前バッチ未実行の時間帯はnullを返す（呼び出し側で非表示にする）
   */
  async getUnifiedTrifectaReference(raceId) {
    if (!supabase || !raceId) return null;
    const { data, error } = await supabase
      .from("bet_recommendations")
      .select(
        "recommendation, expected_value, expected_hit_rate, expected_payout, reasons",
      )
      .eq("model_id", "unified")
      .eq("race_id", raceId)
      .maybeSingle();

    if (error || !data) return null;

    return {
      recommendation: data.recommendation,
      expectedValue: data.expected_value,
      expectedHitRate: data.expected_hit_rate,
      expectedPayout: data.expected_payout,
      combo: data.reasons?.combo ?? null,
      odds: data.reasons?.odds ?? null,
    };
  },

  /**
   * 1レース分の各艇スタートタイミングを取得する（BOA-238）。
   * race_start_timingsは1レースにつき最大6行の1対多テーブルのため、一覧表示用の
   * getPredictions()/RPCには含めず、レース詳細ページ表示時にRaceResult.jsxから
   * この関数で個別に軽量フェッチする
   */
  async getRaceStartTimings(raceId) {
    if (!supabase || !raceId) return [];
    const { data, error } = await supabase
      .from("race_start_timings")
      .select(
        "boat_number, start_timing, is_flying, is_late_start, finish_mark, finish_rank",
      )
      .eq("race_id", raceId)
      .order("boat_number");

    if (error || !data) return [];

    // finish_mark / finish_rank（077、2026-09-21から全件）は結果タブの着順の組み立てに使う
    // （BOA-543）。rank1〜rank6 は公式ページの並び順のままで返還艇（F・L・欠）が混ざるため
    return data.map((row) => ({
      boatNumber: row.boat_number,
      startTiming: row.start_timing,
      isFlying: row.is_flying,
      isLateStart: row.is_late_start,
      finishMark: row.finish_mark ?? null,
      finishRank: row.finish_rank ?? null,
    }));
  },

  /**
   * 指定会場の「グレード×艇番」横断統計を取得する（BOA-263）
   * scripts/daily/calculate-venue-grade-stats.jsが日次バッチで事前集計した
   * venue_grade_boat_statsテーブルを読むだけ（全会場横断のためライブ集計はしない。
   * BOA-267のコードレビューで指摘された「全会場集計は必ずバッチ事前集計する」
   * という既存規約に最初から従っている）。boat_number=0はレース全体（艇番非依存）
   * の集計行を表すセンチネル値
   */
  getVenueGradeBoatStats(venueCode) {
    return withCache(`venue-grade-boat-stats-${venueCode}`, async () => {
      if (!supabase) {
        console.error("Supabase client not initialized");
        return [];
      }
      const { data, error } = await supabase
        .from("venue_grade_boat_stats")
        .select(
          "race_grade, boat_number, race_count, wins, top2, top3, technique_breakdown, manshu_count, payout_count, payout_trio_sum",
        )
        .eq("venue_code", venueCode);
      if (error) {
        // withCacheは成功時（.then）のみキャッシュするため、ここで[]を返すと
        // 一時的なエラーが正常な「データなし」として30分キャッシュされてしまう
        // （getAllRacersLiteと同じ理由、2026-09-08のコードレビューで発見済みの
        // バグクラス）。必ずthrowしてキャッシュさせない
        throw new Error(`venue_grade_boat_stats取得エラー: ${error.message}`);
      }
      return data ?? [];
    });
  },

  /**
   * 会場×グレード統計データを保持する全会場のコード一覧を取得する（BOA-263）
   * venue_grade_boat_statsに1件でも行がある会場のみを選択肢として提示するため
   */
  getVenuesWithGradeStats() {
    return withCache("venues-with-grade-stats", async () => {
      if (!supabase) return [];
      const { data, error } = await supabase
        .from("venue_grade_boat_stats")
        .select("venue_code");
      if (error) {
        throw new Error(`venue_grade_boat_stats取得エラー: ${error.message}`);
      }
      return [...new Set((data ?? []).map((r) => r.venue_code))].sort(
        (a, b) => a - b,
      );
    });
  },

  /**
   * レースのピットレポート（選手コメント）を取得する（BOA-379）
   * 設計: docs/design/pit-comments/screens.md §9（データの契約）
   *
   * RPCを増やさず、race_id単位の単独SELECTを2本（レース単位・艇単位）で読む。
   * 呼ぶ前に、画面側で isPitReportCandidate（src/utils/pitReportUrl.js）を必ず通すこと
   * （G3・一般戦・G1/G2の1R〜6Rでは呼ばない）。
   *
   * 戻り値の state:
   *   "published"  コメントあり
   *   "not_target" 公式ページが「対象外」と答えたレース（行はあるがコメント0件）
   *   "pending"    行が無い＝まだ公開されていない（または対象外の判定もまだ）
   *   "forbidden"  匿名にSELECT権限が無い（マイグレーション086が未適用）。
   *                画面はセクションごと出さない。「対象外」「未公開」に化けさせない
   * 取得失敗（ネットワーク等）は例外を投げる（BOA-359。空・対象外に化けさせない）
   */
  getRacePitReport(raceId) {
    return withCache(`pit-report-${raceId}`, async () => {
      if (!supabase) {
        throw new Error("Supabase client not initialized");
      }

      // supabaseClient.js が .throwOnError() を既定で適用するため、取得エラーは
      // ここに到達する前に例外になる。権限エラー（086未適用）だけは例外にせず
      // 「セクションを出さない」に倒したいので、ここで捕まえて分岐する
      let reportRes;
      let commentsRes;
      try {
        [reportRes, commentsRes] = await Promise.all([
          supabase
            .from("race_pit_reports")
            .select(
              "status, target_from, target_to, reporter_name, comment_count, created_at, updated_at",
            )
            .eq("race_id", raceId)
            .maybeSingle(),
          supabase
            .from("race_pit_comments")
            .select(
              "boat_number, racer_id, comment_text, confidence_stars, previous_race_number",
            )
            .eq("race_id", raceId)
            .order("boat_number", { ascending: true }),
        ]);
      } catch (error) {
        if (isPermissionDeniedError(error)) {
          // 086（匿名へのSELECT公開）が未適用の間は、ここを通る。本番の公開順序の保険で、
          // エラー表示ではなく「セクションを出さない」に倒す
          return { ...NON_TERMINAL_PIT_REPORT, state: "forbidden" };
        }
        throw error;
      }

      const report = reportRes.data;
      if (!report) return { ...NON_TERMINAL_PIT_REPORT, state: "pending" };
      const comments = (commentsRes.data ?? []).map((row) => ({
        boatNumber: row.boat_number,
        racerId: row.racer_id ?? null,
        text: row.comment_text,
        stars: row.confidence_stars ?? null,
        previousRaceNumber: row.previous_race_number ?? null,
      }));

      return {
        // 行はあるがコメントが0件なら、公式が「対象外」と答えたレース
        state: comments.length > 0 ? "published" : "not_target",
        reporterName: report.reporter_name ?? null,
        capturedAt: report.created_at ?? null,
        updatedAt: report.updated_at ?? null,
        targetRange:
          report.target_from != null && report.target_to != null
            ? { from: report.target_from, to: report.target_to }
            : null,
        comments,
      };
    });
  },

  /**
   * オリジナル展示（一周・半周ラップ・まわり足・直線）を1レース分取得する
   * （phase a FR-4b / [BOA-452](https://linear.app/boat-ai/issue/BOA-452)）。
   *
   * 出所はBOATCAST（`race.boatcast.jp`、BOATRACE振興会の公式Web映像サービス）。
   * [ADR-0067](docs/adr/0067-official-site-content-redisplay-policy.md) が
   * 「取得した値は保存のみ。画面に再表示するには別途ユーザーの承認と出典表記の
   * 設計が要る」としている区分なので、画面側は必ず出典を添えて出す。
   *
   * 戻り値の `state`:
   *   "published" 値がある
   *   "empty"     まだ取得できていない（計測前・未公開）→ 行を出さない
   *   "forbidden" 匿名にSELECT権限が無い（マイグレーション096が未適用）→ 行を出さない
   * 取得失敗（ネットワーク等）は例外を投げる（BOA-359。空に化けさせない）
   *
   * クエリは**2本**（ヘッダ1・値1）。値は6艇 × 最大4項目 = 最大24行。
   * 直前情報タブを開いたときだけ走る（RaceTabs は非アクティブタブを
   * アンマウントする）。
   */
  getRaceOriginalExhibition(raceId) {
    return withCache(`original-exhibition-${raceId}`, async () => {
      if (!supabase) {
        throw new Error("Supabase client not initialized");
      }

      let headerRes;
      let valueRes;
      try {
        [headerRes, valueRes] = await Promise.all([
          supabase
            .from("race_original_exhibition")
            .select("item_labels, updated_at")
            .eq("race_id", raceId)
            .maybeSingle(),
          supabase
            .from("race_original_exhibition_values")
            .select("boat_number, kind, value")
            .eq("race_id", raceId),
        ]);
      } catch (error) {
        if (isPermissionDeniedError(error)) {
          // 096（匿名へのSELECT公開）が未適用の間はここを通る。
          // 「データ無し」ではなく forbidden として返し、画面は行ごと出さない
          // fetchFailed を付けて withCache に保存させない。付け忘れると、
          // 096の適用前に開いた過去レースが7日間ずっと forbidden のまま固着する
          return {
            state: "forbidden",
            capturedAt: null,
            kinds: [],
            byBoat: {},
            fetchFailed: true,
          };
        }
        throw error;
      }

      const values = valueRes.data ?? [];

      // `value` は nullable で、欠測（BOATCASTのファイルの `--.--`。津・三国の
      // 一周など。091のコメント）は NULL で入る。**値がある行だけ**を数えて
      // 「出せるかどうか」を決める。行数だけで見ると、全艇が欠測の項目まで
      // 出典に名前が並んだり、1行も出ないのに出典ブロックだけ残ったりする
      const measured = values.filter(
        (row) => row.value !== null && row.value !== undefined,
      );
      if (measured.length === 0) {
        // まだ計測されていない（または全艇欠測）。発走の30分前あたりに値が
        // 入るので、この状態をキャッシュすると出た後もリロードまで出ない
        return {
          state: "empty",
          capturedAt: null,
          kinds: [],
          byBoat: {},
          fetchFailed: true,
        };
      }

      const byBoat = {};
      measured.forEach((row) => {
        byBoat[row.boat_number] = {
          ...(byBoat[row.boat_number] ?? {}),
          [row.kind]: Number(row.value),
        };
      });

      // 会場によって項目が違う（例: 児島は「一周|まわり足」の2項目だけ）。
      // ヘッダの item_labels（"一周|まわり足|直線"）を正として順番を決め、
      // 実際に値がある種別だけ残す。ヘッダが無ければ既定の順に落とす
      const present = new Set(measured.map((row) => row.kind));
      const declared = (headerRes.data?.item_labels ?? "")
        .split("|")
        .map((label) => label.trim())
        .filter(Boolean);
      const order = declared.length > 0 ? declared : ORIGINAL_EXHIBITION_KINDS;
      const kinds = order.filter((kind) => present.has(kind));

      return {
        state: "published",
        capturedAt: headerRes.data?.updated_at ?? null,
        kinds,
        byBoat,
      };
    });
  },

  /**
   * 「本日のデータ一覧」（BOA-402）の1日ぶんを取得する。
   *
   * ページは morning_digest_days / morning_digest_rows の **2表だけ**を読む
   * （ADR-0070）。抽出ロジックは早朝バッチ generate-morning-digest.js の
   * 1箇所にしか存在しないため、ここでは整形しかしない。
   *
   * 戻り値の `state`:
   *   - "generated": 生成済み（rows がある）
   *   - "not_generated": その日の行が無い、または generated_at が NULL（生成途中で落ちた）
   *     → 画面は「該当0件」と**区別して**表示する（spec §6）
   *
   * TTLは呼び出し側で明示的に渡す。`inferTtlFromKey` は race_id 形式の末尾
   * （YYYY-MM-DD-VV-RR）を要求する正規表現のため、`morning-digest-YYYY-MM-DD`
   * ではマッチせず、過去日でも当日TTL（30分）になってしまう。
   *
   * @param {string} date YYYY-MM-DD（JST）
   */
  getMorningDigest(date) {
    const jstToday = new Date(Date.now() + 9 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];
    const ttl =
      date < jstToday ? PAST_RACE_CACHE_TTL : /* 当日は30分 */ CACHE_TTL;

    return withCache(
      `morning-digest-${date}`,
      async () => {
        const [{ data: day }, { data: rows }] = await Promise.all([
          supabase
            .from("morning_digest_days")
            .select("*")
            .eq("digest_date", date)
            .maybeSingle(),
          supabase
            .from("morning_digest_rows")
            .select("*")
            .eq("digest_date", date)
            .order("section")
            .order("rank"),
        ]);

        // generated_at は書き込み完了のマーク（ADR-0070）。NULLなら生成途中で
        // 落ちた状態なので「未生成」として扱い、「該当0件」と混同しない
        if (!day || !day.generated_at) {
          return { state: "not_generated", day: day ?? null, sections: {} };
        }

        const sections = {
          featured: [],
          nige: [],
          makuri: [],
          nigashi: [],
          flying: [],
          returned: [],
        };
        for (const row of rows ?? []) {
          if (!sections[row.section]) sections[row.section] = [];
          sections[row.section].push(row);
        }

        return { state: "generated", day, sections };
      },
      ttl,
    );
  },
};

/**
 * 終端でない状態（pending・forbidden）の戻り値のひな形。
 *
 * `fetchFailed: true` は withCache に「この結果を保存するな」と伝えるためのもので、
 * 取得自体は成功している（画面は state だけを見る）。保存してしまうと、
 * (1) 公開待ちのレースでコメントが公開されても、再読み込みでキャッシュ（本日分30分・
 *     過去分7日）が返り続けて表示が更新されない、
 * (2) マイグレーション086の適用後も、適用前に見たレースが最大7日間「権限なし＝非表示」
 *     のままになる、という不具合になる。
 */
const NON_TERMINAL_PIT_REPORT = Object.freeze({
  state: "pending",
  reporterName: null,
  capturedAt: null,
  updatedAt: null,
  targetRange: null,
  comments: [],
  fetchFailed: true,
});

/**
 * オリジナル展示の項目の既定の並び（BOATCASTのTSVの並びに合わせる）。
 * 会場ごとに項目数が違うため、実際の並びは `item_labels` を正とする
 */
const ORIGINAL_EXHIBITION_KINDS = ["一周", "半周ラップ", "まわり足", "直線"];

/**
 * モータ情報タブ向けに、節の前検タイムを選手ごとに1クエリで引く（BOA-451）。
 * 採る行は「同じ会場・`race_date <= 当日` かつ `>= 当日 - 6日` の最新」。
 * 根拠と、今節タブ（節の最初の行）と必ず一致することの実測は
 * `src/utils/pretestRows.js` に書いてある。
 *
 * 取得に失敗しても前検の列が出ないだけで他の列は読めるため、ここは
 * 例外を投げずに空のMapへ倒す（`.throwOnError()` の例外はここで捕まえる）。
 * @returns {Promise<Map<number, object>>}
 */
async function fetchPretestByRacer(venueCode, date) {
  if (!supabase || !date) return new Map();
  try {
    const { data } = await supabase
      .from("motor_pretest_stats")
      .select("racer_id, race_date, pretest_time, pretest_rank")
      .eq("venue_code", venueCode)
      .gte("race_date", shiftDate(date, -PRETEST_LOOKBACK_DAYS))
      .lte("race_date", date);
    return pickLatestPretestByRacer(data ?? []);
  } catch (error) {
    console.error("前検タイム取得エラー:", error?.message ?? String(error));
    return new Map();
  }
}

/**
 * PostgRESTが返す「権限が無い」エラーか。
 * PostgreSQLの insufficient_privilege（42501）のほか、GRANTが無いテーブルへの
 * アクセスは PostgREST が 401/42501 や "permission denied for table ..." で返す
 */
function isPermissionDeniedError(error) {
  if (!error) return false;
  if (error.code === "42501") return true;
  return /permission denied/i.test(error.message ?? "");
}

/**
 * 1走分の勝敗を{win, top2, top3}アキュムレータに加算する共通ロジック。
 * aggregateRacerVenueBoatStats（単一集計）とaggregateRacerCrossStats
 * （グループ別集計）の両方が同じ勝率/2連率/3連率の判定を必要とするため
 * 共通化（ADR-0063、BOA-159レビューで発見）。
 * @returns {boolean} 勝利（1着）だったか
 */
function tallyWinPlaceShow(totals, row) {
  const isWin = row.rank1 === row.boatNumber;
  if (isWin) totals.win += 1;
  if (isPlaceHit(row.boatNumber, row.rank1, row.rank2)) totals.top2 += 1;
  if (isShowHit(row.boatNumber, row.rank1, row.rank2, row.rank3)) {
    totals.top3 += 1;
  }
  return isWin;
}

/**
 * getRacerRaceHistory()が返すフラット履歴を「会場×枠番×グレード×レース種別」
 * で絞り込み集計する純粋関数（I/O無し）。各引数はnullで絞り込みなしを表す。
 * raceGrade/raceStageはBOA-159で追加（完全一致判定のみ、サンプル数閾値は
 * 適用しない方針、docs/design/racer-stats-drilldown/spec.md参照）。
 * 選手個人ページのフィルタが変更されるたびにこれを呼ぶことで、
 * ネットワークI/O無しで即座に再集計できる。
 * 注: 実際の進入コースはBOA-257の制約により取得できないため、発走前に
 * 決まる枠番（艇番）基準で集計する
 * @param {Array} history - getRacerRaceHistory()の戻り値
 * @param {number|null} venueCode
 * @param {number|null} boatNumber
 * @param {string|null} raceGrade - races.race_gradeと完全一致（ippan/G1/G2/G3/SG）
 * @param {string|null} raceStage - race_conditions.race_stageと完全一致（優勝戦/準優勝戦）
 */
export function aggregateRacerVenueBoatStats(
  history,
  venueCode,
  boatNumber,
  raceGrade,
  raceStage,
) {
  let n = 0,
    returnSum = 0,
    placeReturnSum = 0,
    stSum = 0,
    stN = 0,
    exSum = 0,
    exN = 0;
  const totals = { win: 0, top2: 0, top3: 0 };
  const tech = {};
  const series = [];
  const matchedRaces = [];

  for (const row of history ?? []) {
    if (venueCode && row.venueCode !== venueCode) continue;
    if (boatNumber && row.boatNumber !== boatNumber) continue;
    if (raceGrade && row.raceGrade !== raceGrade) continue;
    if (raceStage && row.raceStage !== raceStage) continue;

    n += 1;
    const isWin = tallyWinPlaceShow(totals, row);
    if (isWin) {
      if (row.winningTechnique) {
        tech[row.winningTechnique] = (tech[row.winningTechnique] ?? 0) + 1;
      }
      returnSum += row.payoutWin ?? 0;
      placeReturnSum += row.payoutPlace1 ?? 0;
    } else if (row.rank2 === row.boatNumber) {
      placeReturnSum += row.payoutPlace2 ?? 0;
    }

    const hasEx = row.exhibitionTime !== null;
    const hasSt = row.startTiming !== null;
    if (hasSt) {
      stSum += Number(row.startTiming);
      stN += 1;
    }
    if (hasEx) {
      exSum += Number(row.exhibitionTime);
      exN += 1;
    }
    if (hasEx || hasSt) {
      // historyは既にrace_id（YYYY-MM-DD-会場-レース番号）昇順でソート済みの
      // ため点の並び順は正しいが、対象期間が最大2年に及ぶため月日だけを表示
      // すると異なる年の同じ月日が同一ラベルに見えてしまう。年下2桁を含めて
      // 曖昧さを避ける（例: "25-05-12"）
      series.push({
        date: row.raceId.slice(2, 10),
        avg_exhibition_time: hasEx ? Number(row.exhibitionTime) : null,
        start_timing: hasSt ? Number(row.startTiming) : null,
      });
    }

    matchedRaces.push({
      raceId: row.raceId,
      date: row.raceId.slice(0, 10),
      venueCode: row.venueCode,
      raceNo: Number(row.raceId.slice(-2)),
      raceTitle: row.raceTitle,
      raceGrade: row.raceGrade,
      raceStage: row.raceStage,
      boatNumber: row.boatNumber,
      startTiming: row.startTiming,
      finishRank: finishPositionOf(row),
      winningTechnique: row.winningTechnique,
      payoutWin: row.payoutWin,
    });
  }

  // レース一覧（BOA-159）は日付降順（新しい順）で見せる。集計用のhistory自体は
  // 昇順ソート済みのため、この配列だけ表示直前に反転する
  matchedRaces.reverse();

  return {
    n,
    win: totals.win,
    top2: totals.top2,
    top3: totals.top3,
    winRate: n > 0 ? totals.win / n : null,
    top2Rate: n > 0 ? totals.top2 / n : null,
    top3Rate: n > 0 ? totals.top3 / n : null,
    tech,
    avgSt: stN > 0 ? stSum / stN : null,
    stN,
    avgExhibitionTime: exN > 0 ? exSum / exN : null,
    exN,
    returnRate: toReturnRate(returnSum, n),
    placeReturnRate: toReturnRate(placeReturnSum, n),
    series,
    matchedRaces,
  };
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
