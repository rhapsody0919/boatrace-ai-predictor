// 展示（直前情報の展示タイム・天候）のレース単位の取得・書き込み runForRaces と私有の部品（fetchExhibitionDetailed・runForRacesOptions・updateRaceConditionsWeather・defaultFetch 等）。
// scripts/daily/scrape-exhibition-data.js から字のまま移した（lib-no-entry: scripts/lib/scrapeJobs/preRaceHandlers.js が入口を読まないため）。入口は run・main と再 export。

import * as cheerio from "cheerio";
import { supabase, VENUE_NAMES } from "./supabaseClient.js";
import { getRaceSchedule } from "./raceSchedule.js";
import {
  buildStartTimeLookup,
  buildWeatherRows,
  formatWeatherStats,
} from "./beforeinfoWeather.js";
import { parseBeforeInfoDocument } from "./beforeInfoParser.js";
import { detectPreRaceSchema } from "./preRaceSchema.js";
import { upsertRaceConditions } from "./raceConditionsWriter.js";
import { BreakerOpenError } from "./scrapeJobs/circuitBreaker.js";
import { mapWithConcurrency } from "./scrapeJobs/concurrency.js";
import {
  classifyFetched,
  markHaveData,
  settleOutcomes,
  toLegacyExhibition,
  upsertExhibitionRows,
} from "./exhibitionJobParts.js";

const USER_AGENT =
  "BoatraceAIBot/1.0 (+https://github.com/rhapsody0919/boatrace-ai-predictor)";
const FETCH_HEADERS = {
  "User-Agent": USER_AGENT,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "ja,en-US;q=0.7,en;q=0.3",
};

// scripts/lib/supabaseClient.js の FETCH_TIMEOUT_MSと同じ値。
// 2026-08-13判明のNode.js標準fetch（undici）無期限ハング不具合と同種のリスクが
// boatrace.jpへのこのfetchにもあるため、PR #639セルフレビューで追加。
const FETCH_TIMEOUT_MS = 15000;

// 既定の取得（GitHub Actions・従来の Vercel 関数・CLI）。ヘッダーと本文の両方に15秒のタイムアウトを効かせる。
// Vercel の予定表スロットは、politeFetch（タイムアウト・429/503のバックオフ・ブレーカー込み）を fetchFn で渡す
const defaultFetch = (url) =>
  fetch(url, {
    headers: FETCH_HEADERS,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

/**
 * 1レースの直前情報（beforeinfo）を取得・解析する（展示データと気象を、同じページから1回で。BOA-358）
 * @param {string} date YYYY-MM-DD
 * @param {number} venueCode
 * @param {number} raceNo
 * @param {{fetchFn?: (url: string) => Promise<Response>}} [options]
 * @returns {Promise<
 *   | {status: "ok", data: Array|null, reason: string|null, conditions: Object|null, page: Object}
 *   | {status: "http_error"|"error", error: string, reason: string}
 *   | {status: "breaker_open", error: string, reason: string, retryAt: Date}
 * >}
 *   ok: ページを取得・解析できた。data が null なら未公開（reason に理由）。展示が未公開でも、気象は解析する
 */
export async function fetchExhibitionDetailed(
  date,
  venueCode,
  raceNo,
  { fetchFn = defaultFetch } = {},
) {
  const ymd = date.replace(/-/g, "");
  const jcd = String(venueCode).padStart(2, "0");
  const url = `https://www.boatrace.jp/owpc/pc/race/beforeinfo?rno=${raceNo}&jcd=${jcd}&hd=${ymd}`;
  try {
    const response = await fetchFn(url);
    if (!response.ok) {
      return {
        status: "http_error",
        error: `HTTP ${response.status}`,
        reason: `http_${response.status}`,
      };
    }

    const html = await response.text();
    const $ = cheerio.load(html);
    // 直前情報は、全項目を1回で解析する（気象を含む。気象の解析失敗は、展示データの取得・保存を妨げない）
    const page = parseBeforeInfoDocument($);
    for (const anomaly of page.anomalies) {
      console.warn(
        `  ⚠️ ${VENUE_NAMES[venueCode]} ${raceNo}R 直前情報: ${anomaly}`,
      );
    }
    const exhibition = toLegacyExhibition(
      page,
      $(".table1").eq(1).find("tbody").length,
    );
    return { status: "ok", ...exhibition, conditions: page.conditions, page };
  } catch (error) {
    if (error instanceof BreakerOpenError) {
      return {
        status: "breaker_open",
        error: error.message,
        reason: `error: ${error.message}`,
        retryAt: new Date(error.until),
      };
    }
    return {
      status: "error",
      error: error.message,
      reason: `error: ${error.message}`,
    };
  }
}

/** runForRaces の引数の既定と確かめ（Vercel の予定表スロットは fetchFn に politeFetch を渡す） */
function runForRacesOptions({
  date,
  mode = "live",
  fetchFn = defaultFetch,
  client = supabase,
  concurrency = 1,
  schedule = null,
  updateWeather = true,
  catchup = false,
  weightOnly = false,
}) {
  if (mode !== "live" && mode !== "shadow") {
    throw new Error(`mode は live か shadow にしてください: ${mode}`);
  }
  if (!date) throw new Error("date（YYYY-MM-DD）が必要です");
  return {
    date,
    mode,
    fetchFn,
    client,
    concurrency,
    schedule,
    updateWeather,
    catchup,
    weightOnly,
  };
}

/**
 * レース単位の展示データ取得（Vercel Cron の予定表スロット `exhibition` から呼ぶ。tasks.md T4b-06-2）。
 * beforeinfo を1回取得し、展示データ（exhibition_data）と気象（race_conditions）を、run と同じ解析・行の組み立て・
 * 書き込みで保存する（変更の無い行は書かない）。
 *
 * mode=live のとき、展示タイムが取得済みのレースは取得しない（skipped_have_data）。mode=shadow は、取得済みでも
 * 取得・解析する（既存の経路が書いた行と比べるため）。shadow は、DBへ書かない（読み取りのみ）。
 *
 * catchup=true（窓の外の補完。発走の後のスロット。BOA-382）: mode によらず、展示タイムが取得済みのレースは取得しない
 * （shadow でも。取得済みのレースは、公式ページへのリクエスト0＝DBの読み取りだけで終わる）。気象は書かない（発走後の
 * beforeinfo は、そのレースの発走前ではなく、その日の最新の観測を表示するため）。書き込みは live のみ（shadow は書かない）。
 *
 * outcome:
 *   ok                展示タイムが非NULLの行を書けた（変更なしも含む）＝完了。体重だけの窓（weightOnly）では、
 *                     当日体重・調整重量が非NULLの行を書けたときも完了
 *   skipped_have_data 展示タイムが取得済み（live のみ）＝完了
 *   partial           展示STだけが公開され、展示タイムが未公開（一部の会場で、STが先に出る）。再試行
 *   no_values         展示が未公開（表が空）。再試行
 *   error             通信・解析・書き込みの失敗。再試行
 *   breaker_open      サーキットブレーカーが開いていた（retryAt つき）
 *
 * @param {Array<{race_id: string, venue_code: number, race_number: number}>} races
 * @param {Object} options
 * @param {string} options.date YYYY-MM-DD
 * @param {"live"|"shadow"} [options.mode]
 * @param {(url: string) => Promise<Response>} [options.fetchFn] 既定はグローバルの fetch（15秒のタイムアウト）
 * @param {import("@supabase/supabase-js").SupabaseClient} [options.client]
 * @param {number} [options.concurrency]
 * @param {Array<{race_id: string, venue_code: number, race_no: number, start_time: Date}>|null} [options.schedule]
 *   getRaceSchedule() の返り値（気象の観測時刻の解決用）。updateWeather のとき、無ければ読み込む
 * @param {boolean} [options.updateWeather] 気象も race_conditions へ反映するか（既定 true。shadow では書かない）
 * @param {boolean} [options.catchup] 窓の外の補完（発走の後のスロット）か。取得済みのスキップを shadow にも効かせ、気象を書かない
 * @param {boolean} [options.weightOnly] 体重だけの窓（発走60分前。BOA-500）か。当日体重・調整重量が1艇でも取れたら ok（完了）にする。
 *   展示タイムの有無では判定しない（展示前のため）。気象の要否は updateWeather で別に指定する
 * @returns {Promise<Array<{race_id: string, outcome: string, rowsWritten: number, rowsParsed: number, rowsExpected: number, changed: boolean, resultDigest?: string, error?: string, retryAt?: Date}>>}
 *   changed: 今回、展示データまたは気象を実際に書き換えた（予測の再計算の対象になる）
 */
export async function runForRaces(races, options = {}) {
  const {
    date,
    mode,
    fetchFn,
    client,
    concurrency,
    schedule,
    updateWeather,
    catchup,
    weightOnly,
  } = runForRacesOptions(options);
  if (races.length === 0) return [];
  const live = mode === "live";
  /** @type {Map<string, Object>} */
  const outcomes = new Map();

  // 1) live（と、窓の外の補完）: 展示タイムが取得済みのレースは、取得しない
  //    （shadow の通常のスロットは、既存の経路が書いた行と比べるため、取得済みでも取得・解析する）
  if (live || catchup) {
    const { data, error } = await client
      .from("exhibition_data")
      .select("race_id")
      .in(
        "race_id",
        races.map((r) => r.race_id),
      )
      .not("exhibition_time", "is", null)
      // 展示STまであるレースだけを取得済みにする（getRaceIdsWithExhibitionTime と同じ判定）
      .not("start_timing", "is", null);
    if (error) {
      throw new Error(
        `展示データの取得済みの確認に失敗しました: ${error.message}`,
      );
    }
    markHaveData(outcomes, data);
  }

  // 2) 取得・解析（1つの失敗で他のレースを止めない）
  const targets = races.filter((race) => !outcomes.has(race.race_id));
  const fetched = await mapWithConcurrency(
    targets,
    concurrency,
    async (race) => ({
      race,
      detail: await fetchExhibitionDetailed(
        date,
        race.venue_code,
        race.race_number,
        { fetchFn },
      ),
    }),
  );

  // 3) 行の組み立て
  // 窓の外の補完は、気象を書かない（発走後のページは、そのレースの発走前の値ではなく、その日の最新の観測を表示する）
  const weatherOn = live && updateWeather && !catchup;
  const fullSchedule =
    schedule ??
    (weatherOn
      ? await getRaceSchedule(date, { client, throwOnError: true })
      : []);
  // 直前情報の新しい列（マイグレーション082）が適用済みかを先に判定する。未適用なら、旧実装と同じ列だけを書く
  const extended =
    fetched.length > 0 ? (await detectPreRaceSchema(client)).exhibition : false;
  const { rowsByRace, weatherFetched } = classifyFetched(fetched, outcomes, {
    startOf: new Map(fullSchedule.map((r) => [r.race_id, r.start_time])),
    extended,
  });

  // 4) 気象（live のみ）を展示より先に書く。展示タイムがそろったのを見て動く読み手（アナロジーの展示後の段等）が、
  //    同じ取得回の気象を読めるようにするため（BOA-271 T4-3。展示の後に書くと、その数秒の間に前の回の気象を読む）。
  //    失敗しても展示の成否には影響させない（updateRaceConditionsWeather は投げない）
  const weather =
    weatherOn && weatherFetched.length > 0
      ? await updateRaceConditionsWeather(weatherFetched, date, {
          startTimeLookup: buildStartTimeLookup(fullSchedule),
          client,
        })
      : null;

  // 書き込み（shadow は書かない）。5) 気象を書き込んだレースも changed にする
  const allRows = [...rowsByRace.values()].flat();
  const write =
    allRows.length > 0
      ? await upsertExhibitionRows(client, allRows, { dryRun: !live })
      : null;
  settleOutcomes(outcomes, rowsByRace, { write, live, weightOnly, weather });

  return races.map((race) => ({
    race_id: race.race_id,
    ...outcomes.get(race.race_id),
  }));
}
/**
 * beforeinfo から取得した気象を race_conditions へ反映する（変更のある行だけ書く）。
 * 例外・書き込み失敗は投げず、結果に error として返す（展示データの取得・保存と分離するため）。
 * 気象が1件も反映できなかった場合は、理由の内訳を警告として出す（0件を成功扱いにしない）。
 *
 * @param {Array<{raceId: string, venueCode: number, startTime: Date|null, conditions: Object|null}>} fetched
 * @param {string} date YYYY-MM-DD
 * @param {{startTimeLookup?: Function|null}} [options]
 * @returns {Promise<{fetched: number, parsed: number, written: number, error: string|null, changedRaceIds: string[]}>}
 */
export async function updateRaceConditionsWeather(
  fetched,
  date,
  { startTimeLookup = null, client = supabase } = {},
) {
  try {
    const { rows, stats } = buildWeatherRows(fetched, date, {
      startTimeLookup,
    });
    console.log(`🌤️ 気象: ${formatWeatherStats(stats)}`);
    if (stats.fetched > 0 && rows.length === 0) {
      console.warn(
        "⚠️ 気象: ページを取得したが、反映できる気象が1件も無かった（公式ページの構造変更の可能性。発走後の観測しか無い場合も含む）",
      );
    } else if (
      rows.length > 0 &&
      stats.no_time + stats.future === rows.length
    ) {
      console.warn(
        "⚠️ 気象: 観測時刻を1件も取得できなかった（気象は反映したが、観測時刻はNULL。タイトルの書式変更の可能性）",
      );
    }
    if (rows.length === 0) {
      return {
        fetched: stats.fetched,
        parsed: 0,
        written: 0,
        error: null,
        changedRaceIds: [],
      };
    }
    const result = await upsertRaceConditions(client, rows, {
      label: "race_conditions(気象)",
    });
    return {
      fetched: stats.fetched,
      parsed: stats.parsed,
      written: result.written,
      error: result.error ? result.error.message : null,
      changedRaceIds:
        result.written > 0 ? result.toWrite.map((r) => r.race_id) : [],
    };
  } catch (error) {
    console.error(
      `❌ 気象の更新エラー（展示データの保存は続ける）: ${error.message}`,
    );
    return {
      fetched: fetched.length,
      parsed: 0,
      written: 0,
      error: error.message,
      changedRaceIds: [],
    };
  }
}
