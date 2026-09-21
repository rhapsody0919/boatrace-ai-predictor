/**
 * 展示データ専用軽量スクレイピングスクリプト
 *
 * beforeinfo ページから展示タイム・展示STのみを取得し、
 * Supabase exhibition_data テーブルに直接 upsert する。
 * data/races.json には一切触れない。
 *
 * 実行時間: 約3-4分（取得済みレースはスキップ）
 */

import * as cheerio from "cheerio";
import { getTodayDateJST, parseDateArg } from "../lib/dateUtils.js";
import {
  supabase,
  isSupabaseEnabled,
  fetchAll,
  VENUE_NAMES,
} from "../lib/supabaseClient.js";
import { getRaceSchedule, getRacesInWindow } from "../lib/raceSchedule.js";
import {
  buildStartTimeLookup,
  buildWeatherRows,
  formatWeatherStats,
} from "../lib/beforeinfoWeather.js";
import { parseBeforeInfoDocument } from "../lib/beforeInfoParser.js";
import { buildExhibitionRows } from "../lib/preRaceRows.js";
import {
  PRE_RACE_OPTIONAL_COLUMN_GROUPS,
  detectPreRaceSchema,
} from "../lib/preRaceSchema.js";
import { upsertRaceConditions } from "../lib/raceConditionsWriter.js";
import { upsertChangedRows } from "../lib/unchangedRows.js";
import { BreakerOpenError } from "../lib/scrapeJobs/circuitBreaker.js";
import { mapWithConcurrency } from "../lib/scrapeJobs/concurrency.js";
import { computeExhibitionDigest } from "../lib/scrapeJobs/preRaceDigest.js";

const USER_AGENT =
  "BoatraceAIBot/1.0 (+https://github.com/rhapsody0919/boatrace-ai-predictor)";
const FETCH_HEADERS = {
  "User-Agent": USER_AGENT,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "ja,en-US;q=0.7,en;q=0.3",
};

// マイグレーション056（BOA-221）・059（BOA-289）で追加した列。未適用のDBでは除いて書き込む
const BOA221_COLUMNS = [
  "tilt",
  "propeller_change",
  "parts_changed",
  "adjustment_weight",
];
const BOA289_COLUMNS = [
  "today_weight",
  "prev_race_no",
  "prev_entry_course",
  "prev_start_timing",
  "prev_finish_rank",
];

/**
 * Supabase から「展示タイムが取得済み」の race_id セットを取得
 *
 * 行が存在するかではなく exhibition_time が非nullの行があるかで判定する。
 * 鳴門・丸亀・児島・江戸川等では公式ページが展示ST（スタート展示）を展示タイムより
 * 先に公開するため、その間に取得すると exhibition_time=null・start_timing のみの行が
 * 書かれる。行の有無で判定すると、この行が「取得済み」とみなされ展示タイムが
 * 永久に補完されない（2026-09-19判明、9/18は29レース＝16%が該当）。
 *
 * exhibition_data は1レース6行のため、1日180レースで1000行のデフォルト上限を超える。
 * fetchAll でページネーションして取りこぼしを防ぐ。
 */
export async function getRaceIdsWithExhibitionTime(date) {
  if (!isSupabaseEnabled()) return new Set();

  const rows = await fetchAll("exhibition_data", "race_id", (q) =>
    q
      .gte("race_id", date)
      .lt("race_id", `${date}~`)
      .not("exhibition_time", "is", null)
      .order("race_id")
      .order("boat_number"),
  );

  return new Set(rows.map((r) => r.race_id));
}

/**
 * 直前情報の解析結果（scripts/lib/beforeInfoParser.js）を、旧実装（scrapeExhibitionData）と同じ形にする。
 * 旧形式の項目（展示タイム・チルト・プロペラ・部品交換・調整重量・当日体重・前走成績・展示ST・フライング有無）は
 * 旧実装と同じ値。新しい項目（展示進入・F/L・前走の着順の生表記・欠場）が加わる。
 *
 * @param {ReturnType<typeof parseBeforeInfoDocument>} page
 * @param {number} tbodiesCount 直前情報の表の tbody の数（理由の表記用）
 * @returns {{ data: Array|null, reason: string|null }}
 *   reason: 'tables_lt_2' | 'no_boats' | 'no_values' | null(成功)
 */
export function toLegacyExhibition(page, tbodiesCount = 0) {
  if (page.tables_count < 2) {
    return { data: null, reason: `tables_lt_2 (found ${page.tables_count})` };
  }
  if (page.boats.length === 0) {
    return { data: null, reason: `no_boats (tbodies=${tbodiesCount})` };
  }
  const data = page.boats.map((b) => {
    const entry = {
      boatNumber: b.boat_number,
      exhibitionTime: b.exhibition_time,
      startTiming: null,
      tilt: b.tilt,
      propellerChange: b.propeller_text,
      partsChanged: b.parts_changed.length > 0 ? b.parts_changed : null,
      adjustmentWeight: b.adjustment_weight,
      todayWeight: b.weight_kg,
      prevRaceNo: b.prev_race_no,
      prevEntryCourse: b.prev_entry_course,
      prevStartTiming: b.prev_start_timing,
      prevFinishRank: b.prev_finish_rank,
      exhibitionCourse: b.exhibition_course,
      startFlag: b.start_flag,
      prevFinishMark: b.prev_finish_mark,
      isAbsent: b.is_absent,
    };
    // 旧実装と同じく、STの数値が読めた艇だけに、展示STとフライング有無を持たせる
    if (b.start_timing !== null) {
      entry.startTiming = b.start_timing;
      entry.isFlying = b.start_flag === "F";
    }
    return entry;
  });
  if (!data.some((e) => e.exhibitionTime !== null || e.startTiming !== null)) {
    return { data: null, reason: `no_values (boats=${data.length})` };
  }
  return { data, reason: null };
}

/**
 * beforeinfo ページから展示データをスクレイピング（旧実装と同じ形。全項目の解析は
 * scripts/lib/beforeInfoParser.js の parseBeforeInfoDocument）
 * @returns {{ data: Array|null, reason: string|null }}
 *   reason: 'tables_lt_2' | 'no_boats' | 'no_values' | null(成功)
 */
export function scrapeExhibitionData($) {
  return toLegacyExhibition(
    parseBeforeInfoDocument($),
    $(".table1").eq(1).find("tbody").length,
  );
}

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

/**
 * 1レースの展示データと気象を取得する（従来の入口。失敗は data: null に丸めてログに出す）
 * @returns {{ data: Array|null, reason: string|null, conditions: Object|null }}
 *   conditions: 水面気象情報の解析結果（ページを取得できなかった場合は null）。
 *   展示データが未公開（data が null）でも、気象は解析する
 */
async function fetchExhibitionForRace(date, venueCode, raceNo) {
  const detail = await fetchExhibitionDetailed(date, venueCode, raceNo);
  if (detail.status === "ok") return detail;
  if (detail.status !== "http_error") {
    console.error(`  ❌ ${VENUE_NAMES[venueCode]} ${raceNo}R: ${detail.error}`);
  }
  return { data: null, reason: detail.reason, conditions: null };
}

/**
 * exhibition_data へ、変更のある行だけを upsert する（run・runForRaces の共通の書き込み）。
 * 変更の無い行は書かず、書く行には updated_at を設定する（WS2）。展示タイム未公開でSTだけの行は、
 * 展示タイムが入るまで毎回再取得されるため、値が同じ間は書かない（updated_atが「値が変わった時刻」
 * を表すようにする）。created_at は初回のINSERT時にDBの DEFAULT が入る
 *
 * BOA-221の新列（マイグレーション056）とBOA-289の新列（マイグレーション059）は別々の
 * マイグレーションのため、片方だけ未適用というケースがありうる（本プロジェクトはSupabase Access
 * Tokenの失効等でマイグレーションを手動・個別に適用してきた実績があり、054適用済み・056未適用の
 * ような部分適用状態は現実的に起こりうる）。1つの列不在エラーで両方の新列を一律に剥がすと、056が
 * 既に適用済みで正常に書き込めていたtilt等まで巻き添えで書き込み停止してしまう（PR #645セルフ
 * レビューで発見）。そのため、エラーに名前の出た列が属するグループだけを除いて書き直し、
 * 適用済みのマイグレーション分は引き続き書き込み続ける（scripts/lib/optionalColumns.js）
 * 書き込みエラーは upsertChangedRows がログに出す（呼び出し元の戻り値・後続処理は従来どおり）
 */
function upsertExhibitionRows(client, rows, { dryRun = false } = {}) {
  return upsertChangedRows(client, "exhibition_data", rows, {
    onConflict: "race_id,boat_number",
    keyColumns: ["race_id", "boat_number"],
    label: "exhibition_data",
    dryRun,
    stampUpdatedAt: true,
    optionalColumnGroups: {
      "マイグレーション056（BOA-221）": BOA221_COLUMNS,
      "マイグレーション059（BOA-289）": BOA289_COLUMNS,
      ...PRE_RACE_OPTIONAL_COLUMN_GROUPS.exhibition,
    },
  });
}

/**
 * オーケストレーターから呼び出し可能な展示データ取得処理
 * @param {Array} schedule - getRaceSchedule() の返り値（外部から渡す）
 * @param {string} date - YYYY-MM-DD
 * @param {{updateWeather?: boolean}} [options]
 *   updateWeather: 取得した beforeinfo の気象も race_conditions へ反映するか（既定 true、BOA-358）。
 *   過去レースの補完（scrape-exhibition-data の backfill 系）は、beforeinfo が「その日の最新の観測」
 *   を表示するため false にする
 * @returns {Promise<{updated: boolean, count: number, weather?: Object, changedRaceIds: string[]}>}
 *   changedRaceIds: 展示データ・気象を実際に書き込んだレース（変更の無い行は書かないため、
 *   updated=true でも含まれないレースがある）。予測の再計算（Vercel、REFRESH_ON_VERCEL）の対象
 */
/**
 * 展示データ取得のウィンドウ（BOA-55: 発走30分前・15分前・10分前）
 * 展示タイム取得済みのレースはスキップするため広めに取っても二重取得なし。
 */
const EXHIBITION_WINDOWS = [30, 15, 10];

export async function run(schedule, date, { updateWeather = true } = {}) {
  // BOA-55: 30分前（初回取得）・15分前・10分前（未取得時リトライ）のウィンドウをカバー
  const exhibitionTargetMap = new Map();
  for (const w of EXHIBITION_WINDOWS) {
    for (const r of getRacesInWindow(schedule, w, 3)) {
      exhibitionTargetMap.set(r.race_id, r);
    }
  }
  const windowRaces = [...exhibitionTargetMap.values()];

  if (windowRaces.length === 0) {
    console.log("📭 展示: 発走10〜33分前ウィンドウの対象レースなし");
    return { updated: false, count: 0, changedRaceIds: [] };
  }
  console.log(
    `🎯 展示データ取得: ${windowRaces.length}レース（発走30/15/10分前ウィンドウ）`,
  );

  // 展示タイム取得済みの race_id（スキップ判定用）。展示タイム未公開のnull行は
  // 取得済み扱いにせず、次回のcron実行で再取得・上書きする
  const fetchedRaceIds = await getRaceIdsWithExhibitionTime(date);
  const targets = windowRaces.filter((r) => !fetchedRaceIds.has(r.race_id));

  if (targets.length === 0) {
    console.log("📭 展示: 全レース取得済み（スキップ）");
    return { updated: false, count: 0, changedRaceIds: [] };
  }

  return scrapeAndUpsertRaces(targets, date, {
    updateWeather,
    // 「N R時点」の気象の観測時刻（Nレース目の発走予定時刻）の解決用
    startTimeLookup: buildStartTimeLookup(schedule),
  });
}

/**
 * 指定レースの展示データを取得して exhibition_data に upsert する
 * （取得済み判定・ウィンドウ判定は呼び出し側の責務。過去分の補完スクリプトからも使う）
 * @param {Array<{race_id: string, venue_code: number, race_no: number, start_time?: Date}>} targets
 *   start_time: 発走予定時刻。気象の更新（updateWeather）では、発走後の観測を弾くために使う
 * @param {string} date - YYYY-MM-DD
 * @param {{updateWeather?: boolean, startTimeLookup?: Function|null}} [options]
 *   updateWeather: 気象も race_conditions へ反映するか。既定 false（過去分の補完は、beforeinfo が
 *   発走後もその日の最新の観測を表示するため、気象を書かない）。run() は既定 true で呼ぶ
 *   startTimeLookup: buildStartTimeLookup() の戻り値（「N R時点」の観測時刻の解決用）
 *   client: テスト用のSupabaseクライアントの差し替え
 * @returns {Promise<{updated: boolean, count: number, weather: Object|null, changedRaceIds: string[]}>}
 */
export async function scrapeAndUpsertRaces(
  targets,
  date,
  {
    updateWeather = false,
    startTimeLookup = null,
    // テスト用の差し替え（既定は supabaseClient.js）
    client = supabase,
  } = {},
) {
  // 直前情報の新しい列（マイグレーション082）が適用済みかを先に判定する。未適用なら、旧実装と同じ列だけを書く
  const extended = (await detectPreRaceSchema(client)).exhibition;

  // 会場ごとにグループ化
  const byVenue = new Map();
  for (const r of targets) {
    if (!byVenue.has(r.venue_code)) byVenue.set(r.venue_code, []);
    byVenue.get(r.venue_code).push(r);
  }

  let totalFetched = 0;
  const allRows = [];
  // 気象の反映対象（レースごとの解析結果）。展示データが未公開でも、ページを取得できたレースは対象
  const weatherFetched = [];

  const venueEntries = [...byVenue.entries()];
  for (let vi = 0; vi < venueEntries.length; vi++) {
    const [venueCode, races] = venueEntries[vi];
    const venueName = VENUE_NAMES[venueCode];

    // 会場内の全対象レースを並列取得
    const results = await Promise.all(
      races.map((r) =>
        fetchExhibitionForRace(date, venueCode, r.race_no).then(
          ({ data, reason, conditions, page }) => ({
            raceId: r.race_id,
            startTime: r.start_time ?? null,
            data,
            reason,
            conditions,
            page,
          }),
        ),
      ),
    );

    let venueFetched = 0;
    for (const {
      raceId,
      startTime,
      data,
      reason,
      conditions,
      page,
    } of results) {
      const raceNo = raceId.split("-")[4];
      if (conditions) {
        weatherFetched.push({ raceId, venueCode, startTime, conditions });
      }
      if (data) {
        // 展示タイム・展示STのある艇の行を書く（旧実装と同じ）。082適用済みなら、展示進入・F/L・前走の着順の
        // 生表記・欠場（欠場艇の行を含む）も書く（scripts/lib/preRaceRows.js）
        allRows.push(...buildExhibitionRows(raceId, page.boats, { extended }));
        venueFetched++;
      } else {
        console.log(
          `  ⚠️ ${venueName} ${parseInt(raceNo)}R: データなし (${reason})`,
        );
      }
    }

    if (venueFetched > 0) {
      console.log(`  ✅ ${venueName}: ${venueFetched}R 取得`);
    }
    totalFetched += venueFetched;

    // 会場間1秒待機（サーバー負荷配慮）
    if (vi < venueEntries.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  // 実際に書き込んだ（＝変更のあった、または新規の）レース。予測の再計算の対象になる
  const changedRaceIds = new Set();

  // Supabase に upsert
  if (allRows.length > 0) {
    console.log(`\n💾 exhibition_data: ${allRows.length}件書き込み中...`);

    const written = await upsertExhibitionRows(client, allRows);
    // 書き込みが1行も成功していないバッチだけのとき（全滅）は、DBが変わっていないので含めない
    if (written.written > 0) {
      for (const row of written.toWrite) changedRaceIds.add(row.race_id);
    }
  } else {
    console.log("\n📭 展示: 新規データなし");
  }

  console.log(`📊 展示: 取得${totalFetched}R / データ${allRows.length}件`);

  // 気象の反映（BOA-358）。展示データの保存が済んだ後に行い、失敗しても展示の成否・戻り値
  // （予測リフレッシュの起動条件）には影響させない
  const weather = updateWeather
    ? await updateRaceConditionsWeather(weatherFetched, date, {
        startTimeLookup,
        client,
      })
    : null;

  // 気象も予測の入力（イン崩れ指数の風速・波高）のため、書き込んだレースは再計算の対象に含める
  for (const raceId of weather?.changedRaceIds ?? [])
    changedRaceIds.add(raceId);

  return {
    updated: allRows.length > 0,
    count: allRows.length,
    weather,
    changedRaceIds: [...changedRaceIds],
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
 * outcome:
 *   ok                展示タイムが非NULLの行を書けた（変更なしも含む）＝完了
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
 * @returns {Promise<Array<{race_id: string, outcome: string, rowsWritten: number, rowsParsed: number, rowsExpected: number, changed: boolean, resultDigest?: string, error?: string, retryAt?: Date}>>}
 *   changed: 今回、展示データまたは気象を実際に書き換えた（予測の再計算の対象になる）
 */
export async function runForRaces(
  races,
  {
    date,
    mode = "live",
    fetchFn = defaultFetch,
    client = supabase,
    concurrency = 1,
    schedule = null,
    updateWeather = true,
  } = {},
) {
  if (mode !== "live" && mode !== "shadow") {
    throw new Error(`mode は live か shadow にしてください: ${mode}`);
  }
  if (!date) throw new Error("date（YYYY-MM-DD）が必要です");
  if (races.length === 0) return [];
  const live = mode === "live";
  /** @type {Map<string, Object>} */
  const outcomes = new Map();
  const base = {
    rowsWritten: 0,
    rowsParsed: 0,
    rowsExpected: 1,
    changed: false,
  };

  // 1) live: 展示タイムが取得済みのレースは、取得しない
  if (live) {
    const { data, error } = await client
      .from("exhibition_data")
      .select("race_id")
      .in(
        "race_id",
        races.map((r) => r.race_id),
      )
      .not("exhibition_time", "is", null);
    if (error) {
      throw new Error(
        `展示データの取得済みの確認に失敗しました: ${error.message}`,
      );
    }
    for (const row of data ?? []) {
      outcomes.set(row.race_id, { ...base, outcome: "skipped_have_data" });
    }
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
  const weatherOn = live && updateWeather;
  const fullSchedule =
    schedule ??
    (weatherOn
      ? await getRaceSchedule(date, { client, throwOnError: true })
      : []);
  const startOf = new Map(fullSchedule.map((r) => [r.race_id, r.start_time]));
  // 直前情報の新しい列（マイグレーション082）が適用済みかを先に判定する。未適用なら、旧実装と同じ列だけを書く
  const extended =
    fetched.length > 0 ? (await detectPreRaceSchema(client)).exhibition : false;
  const rowsByRace = new Map();
  const weatherFetched = [];
  for (const { race, detail } of fetched) {
    if (detail.status === "breaker_open") {
      outcomes.set(race.race_id, {
        ...base,
        outcome: "breaker_open",
        retryAt: detail.retryAt,
        error: detail.error,
      });
      continue;
    }
    if (detail.status !== "ok") {
      outcomes.set(race.race_id, {
        ...base,
        outcome: "error",
        error: `直前情報を取得できませんでした: ${detail.error}`,
      });
      continue;
    }
    // 気象は、展示が未公開でも、ページを取得できたレースは対象（従来の run と同じ）
    if (detail.conditions) {
      weatherFetched.push({
        raceId: race.race_id,
        venueCode: race.venue_code,
        startTime: startOf.get(race.race_id) ?? null,
        conditions: detail.conditions,
      });
    }
    if (!detail.data) {
      outcomes.set(race.race_id, {
        ...base,
        outcome: "no_values",
        error: `展示データが未公開です（${detail.reason}）`,
      });
      continue;
    }
    rowsByRace.set(
      race.race_id,
      buildExhibitionRows(race.race_id, detail.page.boats, { extended }),
    );
  }

  // 4) 書き込み（shadow は書かない）
  const allRows = [...rowsByRace.values()].flat();
  const write =
    allRows.length > 0
      ? await upsertExhibitionRows(client, allRows, { dryRun: !live })
      : null;
  const writtenByRace = new Map();
  if (live && write && write.written > 0) {
    for (const row of write.toWrite) {
      writtenByRace.set(row.race_id, (writtenByRace.get(row.race_id) ?? 0) + 1);
    }
  }
  for (const [raceId, rows] of rowsByRace) {
    const common = {
      ...base,
      rowsParsed: rows.length,
      rowsWritten: writtenByRace.get(raceId) ?? 0,
      changed: (writtenByRace.get(raceId) ?? 0) > 0,
      resultDigest: computeExhibitionDigest(rows),
    };
    if (write?.error) {
      outcomes.set(raceId, {
        ...common,
        outcome: "error",
        error: `展示データの書き込みに失敗しました: ${write.error.message}`,
      });
    } else if (rows.some((row) => row.exhibition_time != null)) {
      outcomes.set(raceId, { ...common, outcome: "ok" });
    } else {
      // 展示STだけが公開されている（展示タイム未公開）。書いた行は残し、展示タイムが入るまで再試行する
      outcomes.set(raceId, {
        ...common,
        outcome: "partial",
        error: "展示タイムが未公開です（展示STのみ）",
      });
    }
  }

  // 5) 気象（live のみ。展示の保存が済んだ後に行い、失敗しても展示の成否には影響させない）
  if (weatherOn && weatherFetched.length > 0) {
    const weather = await updateRaceConditionsWeather(weatherFetched, date, {
      startTimeLookup: buildStartTimeLookup(fullSchedule),
      client,
    });
    // 気象も予測の入力（イン崩れ指数の風速・波高）のため、書き込んだレースは再計算の対象に含める
    for (const raceId of weather.changedRaceIds) {
      const outcome = outcomes.get(raceId);
      if (outcome) outcomes.set(raceId, { ...outcome, changed: true });
    }
  }

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
      `❌ 気象の更新エラー（展示データは保存済み）: ${error.message}`,
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

/**
 * メイン処理（スタンドアローン実行用）
 */
async function main() {
  console.log("🚀 展示データ専用スクレイピング開始");
  console.log(`⏰ ${new Date().toISOString()}`);

  if (!isSupabaseEnabled()) {
    console.error("❌ Supabase環境変数が未設定です。");
    process.exit(1);
  }

  const date = parseDateArg() || getTodayDateJST();
  console.log(`📅 対象日: ${date}`);

  const schedule = await getRaceSchedule(date);
  if (schedule.length === 0) {
    console.log("📭 対象レースなし（スケジュール未登録）");
    return;
  }
  console.log(`📊 当日レース数: ${schedule.length}件`);

  await run(schedule, date);
  console.log("🏁 完了");
}

// スタンドアローン実行時のみ main() を呼ぶ（import 時に実行させない）
if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().catch((error) => {
    console.error("❌ エラー:", error);
    process.exit(1);
  });
}
