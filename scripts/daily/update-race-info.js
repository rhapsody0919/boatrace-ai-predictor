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

import { getTodayDateJST, parseDateArg } from "../lib/dateUtils.js";
import {
  supabase,
  isSupabaseEnabled,
  VENUE_NAMES,
} from "../lib/supabaseClient.js";
import { getRaceSchedule, getRacesInWindow } from "../lib/raceSchedule.js";
import { scrapeRaceStage } from "../lib/raceStageParser.js";
import { scrapeRaceMeta, scrapeSeriesDay } from "../lib/raceListParser.js";
import { loadSeriesDayByVenue } from "../lib/raceSeriesLookup.js";
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
// 取得は raceInfoFetch.js、集計（書く行をためる・1件の結果）は raceInfoAccumulate.js に置く
import {
  defaultFetch,
  fetchRaceInfo,
  fetchRaceInfoDetailed,
  fetchRaceInfos,
} from "../lib/raceInfoFetch.js";
import {
  accumulateRaceInfo,
  applyFetchedRaceInfo,
  assertRaceInfoRunArgs,
  createAccumulator,
  parsedRaceOutcome,
} from "../lib/raceInfoAccumulate.js";

export { fetchRaceInfoDetailed };

// 発走1時間前ウィンドウ（±3分）
const WINDOW_MINUTES = 60;

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
    // 列の組み合わせ（気象の有無・日目の有無。順延・中止のタブの日は日目の列を含めない。BOA-501）ごとに
    // 分けて upsert する。同じ組み合わせの行だけをまとめれば、無い列は触られない
    const groups = new Map();
    for (const row of acc.conditionsRows) {
      const weatherRow = weatherByRaceId.get(row.race_id);
      const merged = weatherRow ? { ...row, ...weatherRow } : row;
      const key = `${weatherRow ? "w" : "-"}${"series_day" in row ? "d" : "-"}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(merged);
    }
    const labelOf = (key) =>
      `race_conditions${key[0] === "w" ? "" : "（気象なし）"}${key[1] === "d" ? "" : "（日目を残す）"}`;
    // weather_observed_at 列（マイグレーション069）が未適用でも書き込めるよう、共通の書き込み関数を使う
    for (const [group, label] of [...groups].map(([key, rows]) => [
      rows,
      labelOf(key),
    ])) {
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
  // 日目のフォールバック（BOA-501）。開催中の節は最大24行で、1回の実行で1回だけ読む
  const seriesDayByVenue = await loadSeriesDayByVenue(date, { client });

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
        seriesDayByVenue,
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

/** 締切予定時刻との照合・気象の観測時刻に使う予定表。渡されていなければ、要るときだけ読む */
async function resolveFullSchedule(
  schedule,
  { date, client, syncDeadlines, includeWeather },
) {
  return (
    schedule ??
    (syncDeadlines || includeWeather
      ? await getRaceSchedule(date, { client, throwOnError: true })
      : [])
  );
}

/** 節から導いた日目（BOA-501）。渡されていなければ読む */
async function resolveSeriesDays(seriesDayByVenue, date, client) {
  return seriesDayByVenue ?? (await loadSeriesDayByVenue(date, { client }));
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
 * @param {Map<number, number>|null} [options.seriesDayByVenue] 会場コード → 節から導いた日目（BOA-501）。
 *   無ければこの中で読む。Vercel Cron は1スロット＝1レースで呼ぶため、1回の起動で同じ読み取りを最大24回
 *   繰り返さないよう、ハンドラー側（preRaceHandlers.js の createSeriesDayLoader）が起動ごとに1回だけ読んで渡す
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
    seriesDayByVenue = null,
  } = {},
) {
  assertRaceInfoRunArgs(mode, date);
  if (races.length === 0) return [];
  const dryRun = mode === "shadow";

  const fullSchedule = await resolveFullSchedule(schedule, {
    date,
    client,
    syncDeadlines,
    includeWeather,
  });
  const startOf = new Map(fullSchedule.map((r) => [r.race_id, r.start_time]));
  const startTimeLookup = buildStartTimeLookup(fullSchedule);

  const preRaceSchema = await detectPreRaceSchema(client);
  const seriesDays = await resolveSeriesDays(seriesDayByVenue, date, client);
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
  const fetched = await fetchRaceInfos(races, {
    date,
    concurrency,
    fetchFn,
    includeWeather,
  });
  const parsedRaceIds = [];
  const accOptions = {
    schedule: fullSchedule,
    syncDeadlines,
    cancellationMap,
    cancellationFetchError,
    entriesExtended: preRaceSchema.raceEntries,
    conditionsExtended: preRaceSchema.raceConditions,
    includeWeather,
    seriesDayByVenue: seriesDays,
  };
  for (const f of fetched) {
    applyFetchedRaceInfo(f, {
      acc,
      accOptions,
      startOf,
      outcomes,
      base,
      parsedRaceIds,
    });
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
    outcomes.set(
      raceId,
      parsedRaceOutcome(acc.perRace.get(raceId), raceId, {
        flushed,
        dryRun,
        base,
      }),
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
