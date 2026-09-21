/**
 * レース情報リアルタイム更新スクリプト
 *
 * 発走1時間前のウィンドウで racelist・beforeinfo をスクレイプし、
 * 出場選手情報・天候データを Supabase に更新する。
 * 欠場・代替選手・レース中止の検出もここで行う。
 *
 * scrape-scheduled.yml から5分毎に実行される（1時間前ウィンドウのレースのみ対象）。
 * 実装パターン: scrape-exhibition-data.js に準拠
 *
 * 入口は2つ（取得・解析・行の組み立て・書き込みは共通）:
 *   run          GitHub Actions・CLI。発走60分前ウィンドウのレースを、racelist + beforeinfo（気象）で更新する
 *   runForRaces  Vercel Cron（api/cron/race-info.js）の予定表スロット。指定レースを、racelist のみで更新する
 *                （beforeinfo は展示 A2 が全項目を取るため取らない。気象は展示の取得時の値）
 */

import * as cheerio from "cheerio";
import { getTodayDateJST, parseDateArg } from "../lib/dateUtils.js";
import {
  supabase,
  isSupabaseEnabled,
  VENUE_NAMES,
} from "../lib/supabaseClient.js";
import { getRaceSchedule, getRacesInWindow } from "../lib/raceSchedule.js";
import { computeCancellationTransition } from "../lib/cancellationStatus.js";
import { scrapeRaceStage } from "../lib/raceStageParser.js";
import {
  parseRaceListPage,
  scrapeRaceMeta,
  scrapeSeriesDay,
} from "../lib/raceListParser.js";
import {
  buildRaceConditionRow,
  buildRaceEntryRows,
  planDeadlineUpdates,
} from "../lib/preRaceRows.js";
import {
  PRE_RACE_OPTIONAL_COLUMN_GROUPS,
  detectPreRaceSchema,
} from "../lib/preRaceSchema.js";
import {
  diffRows,
  formatSkipSummary,
  planWriteAll,
  upsertChangedRows,
} from "../lib/unchangedRows.js";
import {
  buildStartTimeLookup,
  buildWeatherRows,
  convertWindDirection,
  formatWeatherStats,
  scrapeConditions,
} from "../lib/beforeinfoWeather.js";
import { upsertRaceConditions } from "../lib/raceConditionsWriter.js";
import { BreakerOpenError } from "../lib/scrapeJobs/circuitBreaker.js";
import { mapWithConcurrency } from "../lib/scrapeJobs/concurrency.js";
import { computeRaceInfoDigest } from "../lib/scrapeJobs/preRaceDigest.js";

const USER_AGENT =
  "BoatraceAIBot/1.0 (+https://github.com/rhapsody0919/boatrace-ai-predictor)";
const FETCH_HEADERS = {
  "User-Agent": USER_AGENT,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "ja,en-US;q=0.7,en;q=0.3",
};
const defaultFetch = (url) => fetch(url, { headers: FETCH_HEADERS });

// 発走1時間前ウィンドウ（±3分）
const WINDOW_MINUTES = 60;

/** fetchFn の失敗を、取得の結果の種別にする（サーキットブレーカーが開いていた場合は、再試行の時刻つき） */
function failureOf(error) {
  if (error instanceof BreakerOpenError) {
    return {
      status: "breaker_open",
      error: error.message,
      retryAt: new Date(error.until),
    };
  }
  return { status: "error", error: error?.message ?? String(error) };
}

/**
 * 1レースの出走表（racelist）を取得・解析する。includeWeather=true のときだけ、直前情報（beforeinfo）も
 * 並列に取得して気象を解析する（従来の run の動作）。Vercel の api/cron/race-info.js は、beforeinfo を展示（A2）が
 * 1回で全項目を取得するため、includeWeather=false で呼ぶ（D2: beforeinfo の重複取得の解消。気象は展示の取得時の値）。
 *
 * @param {string} date YYYY-MM-DD
 * @param {number} venueCode
 * @param {number} raceNo
 * @param {{fetchFn?: (url: string) => Promise<Response>, includeWeather?: boolean}} [options]
 * @returns {Promise<
 *   | {status: "ok", page: ReturnType<typeof parseRaceListPage>, conditions: Object|null}
 *   | {status: "no_entries", page: ReturnType<typeof parseRaceListPage>}
 *   | {status: "http_error"|"error", error: string}
 *   | {status: "breaker_open", error: string, retryAt: Date}
 * >}
 *   no_entries: ページは取得できたが、選手が1人も取れない（中止・未公開の可能性）
 */
export async function fetchRaceInfoDetailed(
  date,
  venueCode,
  raceNo,
  { fetchFn = defaultFetch, includeWeather = true } = {},
) {
  const ymd = date.replace(/-/g, "");
  const jcd = String(venueCode).padStart(2, "0");
  const query = `rno=${raceNo}&jcd=${jcd}&hd=${ymd}`;
  const racelistUrl = `https://www.boatrace.jp/owpc/pc/race/racelist?${query}`;
  const beforeinfoUrl = `https://www.boatrace.jp/owpc/pc/race/beforeinfo?${query}`;
  // fetchFn が同期的に例外を投げても、もう一方の取得を巻き込まないよう Promise にそろえる
  const settle = (url) =>
    Promise.resolve()
      .then(() => fetchFn(url))
      .then(
        (response) => ({ response }),
        (error) => ({ error }),
      );

  const [list, before] = await Promise.all([
    settle(racelistUrl),
    includeWeather ? settle(beforeinfoUrl) : Promise.resolve(null),
  ]);
  if (list.error) return failureOf(list.error);
  if (!list.response.ok) {
    return { status: "http_error", error: `HTTP ${list.response.status}` };
  }

  let page;
  try {
    // 出走表は、全項目を1回で解析する（scripts/lib/raceListParser.js）
    page = parseRaceListPage(await list.response.text());
  } catch (error) {
    return failureOf(error);
  }
  // 選手が1人も取得できない場合は中止・未公開の可能性
  if (page.entries.length === 0) return { status: "no_entries", page };

  let conditions = null;
  if (includeWeather && before?.response?.ok) {
    try {
      conditions = scrapeConditions(cheerio.load(await before.response.text()));
    } catch (error) {
      // 気象の解析・取得の失敗は、出走表の保存を妨げない（気象を含めずに書く）
      console.warn(
        `  ⚠️ ${VENUE_NAMES[venueCode]} ${raceNo}R 気象の解析に失敗: ${error.message}`,
      );
    }
  }
  return { status: "ok", page, conditions };
}

/**
 * 1レースの racelist + beforeinfo を並列取得（従来の run の入口。失敗は null に丸めてログに出す）
 */
async function fetchRaceInfo(date, venueCode, raceNo, options = {}) {
  const detail = await fetchRaceInfoDetailed(date, venueCode, raceNo, options);
  const name = `${VENUE_NAMES[venueCode]} ${raceNo}R`;
  if (detail.status === "ok") return detail;
  if (detail.status === "no_entries") {
    console.warn(`  ⚠️ ${name} 選手情報なし（中止・未公開の可能性）`);
  } else if (detail.status === "http_error") {
    console.error(`  ❌ ${name} racelist 取得失敗 ${detail.error}`);
  } else {
    console.error(`  ❌ ${name} 取得エラー: ${detail.error}`);
  }
  return null;
}

/** 中止・順延の暫定検知（BOA-254 FR1）用に、対象レースの現在の状態を取得 */
async function loadCancellationRows(client, raceIds) {
  const { data, error } = await client
    .from("races")
    // race_grade は、後段の races.race_grade 更新で「変更なし」を判定する既存値として使う
    // （追加の読み取りをしないため、同じクエリで取得する）
    .select(
      "race_id, cancellation_status, cancellation_check_streak, race_grade",
    )
    .in("race_id", raceIds);
  if (error) {
    console.error(
      "⚠️ cancellation_status取得エラー（今回は暫定検知をスキップ）:",
      error.message,
    );
  }
  return { rows: data || [], error };
}

function createAccumulator() {
  return {
    entriesRows: [],
    conditionsRows: [],
    weatherFetched: [],
    racesGradeUpdates: [],
    cancellationUpdates: [],
    // 出走表の締切予定時刻による races.start_time の更新（race_id で重複を除く）
    deadlineUpdates: new Map(),
    // レースごとの、書く行（shadow のダイジェスト用）
    perRace: new Map(),
  };
}

/**
 * 1レース分の取得結果を、書き込む行・更新に変える（DBへは書かない）。
 *
 * @param {ReturnType<typeof createAccumulator>} acc
 * @param {Object} input
 * @param {{race_id: string, venue_code: number, race_no: number, start_time?: Date|null}} input.r
 * @param {{page: Object, conditions?: Object|null}|null} input.data 取得できなければ null
 * @param {"found"|"not_found"|"skip"} input.cancellationCheck 中止・順延の暫定検知に、今回の取得を数えるか。
 *   found=選手が取れた、not_found=ページは取れたが選手が0人、skip=数えない（通信の失敗等。streak を進めない）
 */
function accumulateRaceInfo(
  acc,
  {
    r,
    data,
    cancellationCheck,
    schedule,
    syncDeadlines,
    cancellationMap,
    cancellationFetchError,
    entriesExtended,
    conditionsExtended,
    includeWeather,
  },
) {
  // 中止・順延の暫定検知（BOA-254 FR1）: data有無に関わらず全レース分計算する。
  // 現在の状態の取得自体に失敗している場合、全レースがcancellationMapに
  // 存在しない=デフォルト値（null/0）にフォールバックしてしまい、既に
  // tentativeへ昇格済みのレースのstreakを誤ってリセットする恐れがあるため、
  // その回はまるごと計算をスキップする（cancellationFetchErrorのログ通り）
  if (!cancellationFetchError && cancellationCheck !== "skip") {
    const cancellationCurrent = cancellationMap.get(r.race_id) || {
      cancellation_status: null,
      cancellation_check_streak: 0,
    };
    const cancellationNext = computeCancellationTransition({
      currentStatus: cancellationCurrent.cancellation_status,
      currentStreak: cancellationCurrent.cancellation_check_streak,
      racersFound: cancellationCheck === "found",
    });
    if (cancellationNext.changed) {
      acc.cancellationUpdates.push({
        race_id: r.race_id,
        cancellation_status: cancellationNext.nextStatus,
        cancellation_check_streak: cancellationNext.nextStreak,
      });
    }
  }

  if (!data) return;
  const { page, conditions } = data;
  const { raceGrade, raceTitle, raceStage } = page.meta;
  const venueName = VENUE_NAMES[r.venue_code];

  // 欠場検出: 出走表で欠場の表示（tbody の is-miss）の艇、または登録番号を読めない艇
  const absentBoats = page.entries
    .filter((e) => e.is_absent || e.racer_id === null)
    .map((e) => e.boat_number);
  if (absentBoats.length > 0) {
    console.warn(
      `  ⚠️ ${venueName} ${r.race_no}R 欠場/代替の可能性: ${absentBoats.map((b) => `${b}号艇`).join(", ")}`,
    );
  }
  for (const anomaly of page.anomalies) {
    console.warn(`  ⚠️ ${venueName} ${r.race_no}R 出走表: ${anomaly}`);
  }

  // race_entries 行を構築（ai_score系は更新しない）
  const raceEntryRows = buildRaceEntryRows(r.race_id, page.entries, {
    extended: entriesExtended,
  });
  acc.entriesRows.push(...raceEntryRows);
  const perRace = { entries: raceEntryRows, condition: null, raceGrade };
  acc.perRace.set(r.race_id, perRace);

  // 締切予定時刻（同日12レース分）が races.start_time と違うレースは、start_time を更新する（N15）
  if (syncDeadlines) {
    const plan = planDeadlineUpdates(schedule, r.venue_code, page.deadlines);
    for (const update of plan.updates) {
      acc.deadlineUpdates.set(update.race_id, update);
    }
  }

  // race_conditions 行を構築（race_grade は除外、races テーブルで管理）
  // upsertは全カラムを書き込むため、判定条件にseriesDayの有無を含めると
  // 「conditions取得のみ失敗、seriesDayだけ成功」という再ポーリング時に
  // 既存の天候データをnullで上書きしてしまう。元の条件のまま変えない
  // （conditions取得はほぼ常に成功するため、seriesDay単独成功のレアケースを
  // 拾えなくても実害は小さい）
  if (conditions || raceTitle || raceStage) {
    // 気象の列（と観測時刻）は、書き込みの直前にまとめて作る（flushRaceInfo の buildWeatherRows。展示取得と
    // 同じ規則）。気象を取得できなかったレースは、気象の列を含めず、既存の良い値を消さない
    const conditionRow = buildRaceConditionRow(r.race_id, page.meta, {
      extended: conditionsExtended,
    });
    acc.conditionsRows.push(conditionRow);
    perRace.condition = conditionRow;
    if (includeWeather) {
      acc.weatherFetched.push({
        raceId: r.race_id,
        venueCode: r.venue_code,
        startTime: r.start_time,
        conditions,
      });
    }
  }

  // race_grade を races テーブルに記録（発走60分前の更新用）
  if (raceGrade) {
    acc.racesGradeUpdates.push({ race_id: r.race_id, race_grade: raceGrade });
  }
}

/**
 * 集めた行・更新を書く（dryRun なら書かず、書くはずの件数だけログに出す）。
 * 書き込みの失敗は、ログに出し、戻り値の errors に集める（従来の run は、失敗しても続行する）。
 *
 * @returns {Promise<{updated: boolean, count: number, deadlineUpdates: number, written: Map<string, number>, errors: string[]}>}
 *   written: レースごとに、実際に書いた行・更新の数（変更の無い行は書かない）
 */
async function flushRaceInfo(
  acc,
  {
    client,
    dryRun,
    date,
    startTimeLookup,
    cancellationRows,
    cancellationFetchError,
    includeWeather,
  },
) {
  const written = new Map();
  const errors = [];
  const countWritten = (raceId) =>
    written.set(raceId, (written.get(raceId) ?? 0) + 1);
  const countRows = (result) => {
    // 書き込みが1行も成功していないバッチ（全滅）は、DBが変わっていないので数えない
    if (result.written > 0) {
      for (const row of result.toWrite) countWritten(row.race_id);
    }
    if (result.error) errors.push(result.error.message);
  };

  // races.cancellation_status / cancellation_check_streak を更新（BOA-254 FR1）
  // entriesRowsが空（対象レース全てが中止疑い等）でも早期returnより前に書き込む
  let cancellationUpdateCount = 0;
  // dry-run では書き込まない（状態が変化するレースのみが対象で、既に変更時のみの更新）
  for (const {
    race_id,
    cancellation_status,
    cancellation_check_streak,
  } of dryRun ? [] : acc.cancellationUpdates) {
    const { error } = await client
      .from("races")
      .update({ cancellation_status, cancellation_check_streak })
      .eq("race_id", race_id);
    if (!error) {
      cancellationUpdateCount++;
      countWritten(race_id);
    } else {
      errors.push(error.message);
      console.error(
        `❌ races (cancellation_status) 更新エラー [${race_id}]:`,
        error.message,
      );
    }
  }
  if (cancellationUpdateCount > 0) {
    console.log(
      `  ⚠️ races (cancellation_status): ${cancellationUpdateCount}件`,
    );
  }

  // races.start_time を、出走表の締切予定時刻に追従させる（N15）。書き込みデータが無くても、時刻の変更は反映する
  let deadlineUpdateCount = 0;
  for (const update of dryRun ? [] : acc.deadlineUpdates.values()) {
    const { error } = await client
      .from("races")
      .update({ start_time: update.start_time })
      .eq("race_id", update.race_id);
    if (!error) {
      deadlineUpdateCount++;
      countWritten(update.race_id);
    } else {
      errors.push(error.message);
      console.error(
        `❌ races (start_time) 更新エラー [${update.race_id}]:`,
        error.message,
      );
    }
  }
  if (acc.deadlineUpdates.size > 0) {
    console.log(
      `  ${dryRun ? "[DRY-RUN] " : ""}🕒 races.start_time: ${[...acc.deadlineUpdates.values()].map((u) => `${u.race_id} ${u.previous}→${u.start_time.slice(0, 5)}`).join(", ")}` +
        (dryRun ? "" : `（更新${deadlineUpdateCount}件）`),
    );
  }

  const result = (updated) => ({
    updated,
    count: updated ? acc.entriesRows.length : 0,
    deadlineUpdates: deadlineUpdateCount,
    written,
    errors,
  });

  if (acc.entriesRows.length === 0) {
    console.log("\n📭 レース情報: 書き込みデータなし");
    return result(false);
  }

  console.log(`\n💾 レース情報書き込み中...`);

  // 以下の3テーブルは、発走60分前ウィンドウ（±3分）に取得のたびに全行をupsertしていたが、
  // 前回と同じ値の行は書かない（WS8(b)）。取得できた件数(entriesRows.length等)は
  // 予測リフレッシュの起動条件のため、戻り値・後続処理は従来のまま変えない

  // race_entries upsert（ai_score系は書き込み対象の列に含まれないため比較にも現れない）
  // 書く行には updated_at を設定する（WS2。created_at はINSERT時のDBの DEFAULT に任せる）
  countRows(
    await upsertChangedRows(client, "race_entries", acc.entriesRows, {
      onConflict: "race_id,boat_number",
      keyColumns: ["race_id", "boat_number"],
      label: "race_entries",
      dryRun,
      stampUpdatedAt: true,
      // 未適用の列は、行に含めない（detectPreRaceSchema）。判定後に列が無くなった場合の書き直し用
      optionalColumnGroups: PRE_RACE_OPTIONAL_COLUMN_GROUPS.raceEntries,
    }),
  );

  // race_conditions upsert
  if (acc.conditionsRows.length > 0) {
    // 気象の列（観測時刻を含む）は、展示取得と同じ規則で作る（BOA-358）。気象を書ける行と、
    // 書けない行（取得失敗・気象ブロックなし・発走後の観測）は、キーの組み合わせが違うため
    // 別々にupsertする（PostgRESTの一括upsertは、キーの無い行に明示的にNULLを書くため）
    // includeWeather=false（Vercel。気象は展示側）は、全行を「気象なし」の行として書く
    let weatherByRaceId = new Map();
    if (includeWeather) {
      const { rows: weatherRows, stats: weatherStats } = buildWeatherRows(
        acc.weatherFetched,
        date,
        { startTimeLookup },
      );
      console.log(`  🌤️ 気象: ${formatWeatherStats(weatherStats)}`);
      weatherByRaceId = new Map(weatherRows.map((row) => [row.race_id, row]));
    }
    const withWeather = [];
    const withoutWeather = [];
    for (const row of acc.conditionsRows) {
      const weatherRow = weatherByRaceId.get(row.race_id);
      if (weatherRow) withWeather.push({ ...row, ...weatherRow });
      else withoutWeather.push(row);
    }
    // weather_observed_at 列（マイグレーション069）が未適用でも書き込めるよう、共通の書き込み関数を使う
    for (const [group, label] of [
      [withWeather, "race_conditions"],
      [withoutWeather, "race_conditions（気象なし）"],
    ]) {
      if (group.length > 0) {
        countRows(
          await upsertRaceConditions(client, group, {
            label,
            dryRun,
            optionalColumnGroups:
              PRE_RACE_OPTIONAL_COLUMN_GROUPS.raceConditions,
          }),
        );
      }
    }
  }

  // races.race_grade を更新（Source of Truth = races テーブル）
  // 既存値の取得に失敗している場合（cancellationFetchError）は全件を従来どおり更新する
  const { toWrite: racesGradeToWrite, stats: racesGradeStats } =
    cancellationFetchError
      ? planWriteAll(acc.racesGradeUpdates)
      : diffRows(cancellationRows || [], acc.racesGradeUpdates, {
          keyColumns: ["race_id"],
          writeMissing: false, // racesに行が無ければUPDATEしても0件
        });
  let racesGradeUpdateCount = 0;
  if (!dryRun) {
    for (const { race_id, race_grade } of racesGradeToWrite) {
      const { error } = await client
        .from("races")
        .update({ race_grade })
        .eq("race_id", race_id);
      if (!error) {
        racesGradeUpdateCount++;
        countWritten(race_id);
      } else {
        errors.push(error.message);
      }
    }
  }
  console.log(
    `  ${dryRun ? "[DRY-RUN] " : ""}${formatSkipSummary("races.race_grade", racesGradeStats)}` +
      (dryRun ? "" : ` / 更新${racesGradeUpdateCount}件`),
  );

  return result(true);
}

/**
 * オーケストレーターから呼び出し可能なレース情報更新処理
 * @param {Array} schedule - getRaceSchedule() の返り値（外部から渡す）
 * @param {string} date - YYYY-MM-DD
 * @param {{dryRun?: boolean, syncDeadlines?: boolean, client?: import("@supabase/supabase-js").SupabaseClient}} [options]
 *   dryRun=trueならDBへ書き込まず、書くはずの件数だけログに出す。
 *   syncDeadlines: 出走表の「締切予定時刻」の行が races.start_time と違うレースの start_time を更新するか
 *   （既定 true。日中の時刻変更への追従。N15）。client: テスト用のSupabaseクライアントの差し替え
 * @returns {Promise<{updated: boolean, count: number, deadlineUpdates?: number}>}
 *   updated/count は「取得できた件数」で、DBへ実際に書いた件数ではない（変更の無い行は
 *   書かないが、後続の予測リフレッシュの起動条件は従来どおり取得ベースのまま変えない）
 */
export async function run(
  schedule,
  date,
  { dryRun = false, syncDeadlines = true, client = supabase } = {},
) {
  // 発走1時間前ウィンドウのレースのみ対象
  const targetRaces = getRacesInWindow(schedule, WINDOW_MINUTES);
  if (targetRaces.length === 0) {
    console.log(
      `📭 レース情報: 発走${WINDOW_MINUTES}分前ウィンドウの対象レースなし`,
    );
    return { updated: false, count: 0 };
  }
  console.log(
    `🎯 レース情報更新: ${targetRaces.length}レース（発走${WINDOW_MINUTES}分前ウィンドウ）`,
  );
  // 気象の観測時刻の解決用（「N R時点」の気象は、Nレース目の発走予定時刻を観測時刻とする）
  const startTimeLookup = buildStartTimeLookup(schedule);

  // 出走表の新しい列（マイグレーション081）が適用済みかを先に判定する。未適用なら、旧実装と同じ列だけを書く
  const preRaceSchema = await detectPreRaceSchema(client);

  const { rows: cancellationRows, error: cancellationFetchError } =
    await loadCancellationRows(
      client,
      targetRaces.map((r) => r.race_id),
    );
  const cancellationMap = new Map(cancellationRows.map((r) => [r.race_id, r]));

  const acc = createAccumulator();

  // 会場ごとにグループ化して並列取得
  const byVenue = new Map();
  for (const r of targetRaces) {
    if (!byVenue.has(r.venue_code)) byVenue.set(r.venue_code, []);
    byVenue.get(r.venue_code).push(r);
  }

  const venueEntries = [...byVenue.entries()];
  for (let vi = 0; vi < venueEntries.length; vi++) {
    const [venueCode, races] = venueEntries[vi];
    const venueName = VENUE_NAMES[venueCode];

    // 会場内の全レースを並列取得
    const results = await Promise.all(
      races.map((r) =>
        fetchRaceInfo(date, r.venue_code, r.race_no).then((data) => ({
          r,
          data,
        })),
      ),
    );

    for (const { r, data } of results) {
      accumulateRaceInfo(acc, {
        r,
        data,
        // 従来の動作: 取得できなかった（通信の失敗を含む）レースは「選手情報なし」として数える
        cancellationCheck: data ? "found" : "not_found",
        schedule,
        syncDeadlines,
        cancellationMap,
        cancellationFetchError,
        entriesExtended: preRaceSchema.raceEntries,
        conditionsExtended: preRaceSchema.raceConditions,
        includeWeather: true,
      });
      if (data) {
        const racerSummary = data.page.entries
          .map(
            (e) =>
              `${e.boat_number}号艇:${e.player_name ?? "不明"}(${e.grade ?? "??"})`,
          )
          .join(", ");
        console.log(`  ✅ ${venueName} ${r.race_no}R — ${racerSummary}`);
      }
    }

    // 会場間1秒待機（サーバー負荷配慮）
    if (vi < venueEntries.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  const { updated, count, deadlineUpdates } = await flushRaceInfo(acc, {
    client,
    dryRun,
    date,
    startTimeLookup,
    cancellationRows,
    cancellationFetchError,
    includeWeather: true,
  });
  return { updated, count, deadlineUpdates };
}

/**
 * レース単位のレース情報更新（Vercel Cron の予定表スロット `race_info` から呼ぶ。tasks.md T4b-09-1）。
 * 出走表（racelist）だけを取得し（beforeinfo は展示 A2 が全項目を取るため取らない。D2）、race_entries・
 * race_conditions（節・レース名。気象は含めない）・races（race_grade・締切予定時刻による start_time・中止・順延の
 * 暫定検知）を、run と同じ規則で書く（変更の無い行は書かない）。
 *
 * mode=shadow は、取得・解析・書き込みの計画までで、DBへ書かない（読み取りのみ）。結果に resultDigest を返す。
 *
 * outcome:
 *   ok         出走表を取得・解析でき、書き込めた（変更なしも含む）
 *   no_values  ページは取得できたが選手が0人（中止・未公開の可能性）。再試行。中止・順延の暫定検知の連続回数を進める
 *   error      通信・解析・書き込みの失敗。再試行（中止・順延の暫定検知は進めない）
 *   breaker_open  サーキットブレーカーが開いていた（retryAt つき）
 *
 * @param {Array<{race_id: string, venue_code: number, race_number: number}>} races
 * @param {Object} options
 * @param {string} options.date YYYY-MM-DD
 * @param {"live"|"shadow"} [options.mode]
 * @param {(url: string) => Promise<Response>} [options.fetchFn] 既定はグローバルの fetch
 * @param {import("@supabase/supabase-js").SupabaseClient} [options.client]
 * @param {number} [options.concurrency]
 * @param {Array<{race_id: string, venue_code: number, race_no: number, start_time: Date}>|null} [options.schedule]
 *   getRaceSchedule() の返り値（締切予定時刻との照合用）。無ければ読み込む
 * @param {boolean} [options.syncDeadlines] 既定 true（run と同じ）
 * @param {boolean} [options.includeWeather] 既定 false（気象は展示側）。true なら run と同じく beforeinfo も取る
 * @returns {Promise<Array<{race_id: string, outcome: string, rowsWritten: number, rowsParsed: number, rowsExpected: number, changed: boolean, resultDigest?: string, error?: string, retryAt?: Date}>>}
 *   changed: 今回、DBを実際に書き換えた（予測の再計算の対象になる）
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
    syncDeadlines = true,
    includeWeather = false,
  } = {},
) {
  if (mode !== "live" && mode !== "shadow") {
    throw new Error(`mode は live か shadow にしてください: ${mode}`);
  }
  if (!date) throw new Error("date（YYYY-MM-DD）が必要です");
  if (races.length === 0) return [];
  const dryRun = mode === "shadow";

  const fullSchedule =
    schedule ??
    (syncDeadlines || includeWeather
      ? await getRaceSchedule(date, { client, throwOnError: true })
      : []);
  const startOf = new Map(fullSchedule.map((r) => [r.race_id, r.start_time]));
  const startTimeLookup = buildStartTimeLookup(fullSchedule);

  const preRaceSchema = await detectPreRaceSchema(client);
  const { rows: cancellationRows, error: cancellationFetchError } =
    await loadCancellationRows(
      client,
      races.map((r) => r.race_id),
    );
  const cancellationMap = new Map(cancellationRows.map((r) => [r.race_id, r]));

  const acc = createAccumulator();
  /** @type {Map<string, Object>} */
  const outcomes = new Map();
  const base = { rowsWritten: 0, rowsParsed: 0, rowsExpected: 6 };

  // 取得・解析（1つの失敗で他のレースを止めない）
  const fetched = await mapWithConcurrency(
    races,
    concurrency,
    async (race) => ({
      race,
      detail: await fetchRaceInfoDetailed(
        date,
        race.venue_code,
        race.race_number,
        { fetchFn, includeWeather },
      ),
    }),
  );
  const parsedRaceIds = [];
  for (const { race, detail } of fetched) {
    const r = {
      race_id: race.race_id,
      venue_code: race.venue_code,
      race_no: race.race_number,
      start_time: startOf.get(race.race_id) ?? null,
    };
    const accumulate = (data, cancellationCheck) =>
      accumulateRaceInfo(acc, {
        r,
        data,
        cancellationCheck,
        schedule: fullSchedule,
        syncDeadlines,
        cancellationMap,
        cancellationFetchError,
        entriesExtended: preRaceSchema.raceEntries,
        conditionsExtended: preRaceSchema.raceConditions,
        includeWeather,
      });
    if (detail.status === "ok") {
      accumulate(detail, "found");
      parsedRaceIds.push(race.race_id);
    } else if (detail.status === "no_entries") {
      // ページは取れたが選手が0人。中止・順延の暫定検知の連続回数を進める（run と同じ規則）
      accumulate(null, "not_found");
      outcomes.set(race.race_id, {
        ...base,
        outcome: "no_values",
        error: "出走表に選手がいません（中止・未公開の可能性）",
      });
    } else if (detail.status === "breaker_open") {
      outcomes.set(race.race_id, {
        ...base,
        outcome: "breaker_open",
        retryAt: detail.retryAt,
        error: detail.error,
      });
    } else {
      // 通信・HTTPエラー: 中止・順延の暫定検知には数えない（取得先の一時的な失敗を、中止と取り違えない）
      outcomes.set(race.race_id, {
        ...base,
        outcome: "error",
        error: `出走表を取得できませんでした: ${detail.error}`,
      });
    }
  }

  // 書き込み（shadow は書かない）
  const flushed = await flushRaceInfo(acc, {
    client,
    dryRun,
    date,
    startTimeLookup,
    cancellationRows,
    cancellationFetchError,
    includeWeather,
  });

  for (const raceId of parsedRaceIds) {
    const perRace = acc.perRace.get(raceId);
    const rowsWritten = dryRun ? 0 : (flushed.written.get(raceId) ?? 0);
    const common = {
      ...base,
      rowsParsed: perRace.entries.length,
      rowsWritten,
      changed: rowsWritten > 0,
      resultDigest: computeRaceInfoDigest(perRace),
    };
    outcomes.set(
      raceId,
      flushed.errors.length > 0
        ? {
            ...common,
            outcome: "error",
            error: `レース情報の書き込みに失敗しました: ${flushed.errors.join(" / ")}`,
          }
        : { ...common, outcome: "ok" },
    );
  }

  return races.map((race) => ({
    race_id: race.race_id,
    changed: false,
    ...outcomes.get(race.race_id),
  }));
}

/**
 * メイン処理（スタンドアローン実行用）
 */
async function main() {
  console.log("📋 レース情報更新開始");
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

export const _internal = {
  scrapeRaceMeta,
  scrapeRaceStage,
  scrapeSeriesDay,
  scrapeConditions,
  convertWindDirection,
};

// スタンドアローン実行時のみ main() を呼ぶ（import 時に実行させない）
if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().catch((err) => {
    console.error("❌ エラー:", err);
    process.exit(1);
  });
}
