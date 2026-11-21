// 直前情報（race_info）のレース単位の取得・書き込み runForRaces と私有の部品（loadCancellationRows・flushRaceInfo・resolveFullSchedule・resolveSeriesDays）。
// scripts/daily/update-race-info.js から字のまま移した（lib-no-entry: scripts/lib/scrapeJobs/preRaceHandlers.js が入口を読まないため）。入口は run・main と再 export。

import { supabase } from "./supabaseClient.js";
import { getRaceSchedule } from "./raceSchedule.js";
import { loadSeriesDayByVenue } from "./raceSeriesLookup.js";
import {
  PRE_RACE_OPTIONAL_COLUMN_GROUPS,
  detectPreRaceSchema,
} from "./preRaceSchema.js";
import { formatSkipSummary, upsertChangedRows } from "./unchangedRows.js";
import { buildStartTimeLookup } from "./beforeinfoWeather.js";
import { upsertRaceConditions } from "./raceConditionsWriter.js";
import { defaultFetch, fetchRaceInfos } from "./raceInfoFetch.js";
import {
  applyFetchedRaceInfo,
  assertRaceInfoRunArgs,
  createAccumulator,
  parsedRaceOutcome,
} from "./raceInfoAccumulate.js";
import {
  conditionGroups,
  entriesUpsertOptions,
  planRacesGrade,
  racesUpdates,
  updateRacesBeforeRows,
  updateRacesEach,
  writeCounters,
} from "./raceInfoWrite.js";

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
  const { written, errors, countWritten, countRows } = writeCounters();

  // races.cancellation_status / cancellation_check_streak（BOA-254 FR1）と races.start_time（N15）を先に更新する
  // （entriesRowsが空＝対象レース全てが中止疑い等でも、早期returnより前に書く）
  const deadlineUpdateCount = await updateRacesBeforeRows(client, acc, {
    dryRun,
    countWritten,
    errors,
  });

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
    await upsertChangedRows(
      client,
      "race_entries",
      acc.entriesRows,
      entriesUpsertOptions(dryRun),
    ),
  );

  // race_conditions upsert（列の組み合わせごとに分けて。conditionGroups）
  // weather_observed_at 列（マイグレーション069）が未適用でも書き込めるよう、共通の書き込み関数を使う
  if (acc.conditionsRows.length > 0) {
    for (const [group, label] of conditionGroups(acc, {
      includeWeather,
      date,
      startTimeLookup,
    })) {
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
  const { toWrite: racesGradeToWrite, stats: racesGradeStats } = planRacesGrade(
    acc,
    cancellationRows,
    cancellationFetchError,
  );
  const racesGradeUpdateCount = await updateRacesEach(
    client,
    racesUpdates(dryRun, racesGradeToWrite, ({ race_grade }) => ({
      race_grade,
    })),
    { onOk: countWritten, onError: (_, error) => errors.push(error.message) },
  );
  console.log(
    `  ${dryRun ? "[DRY-RUN] " : ""}${formatSkipSummary("races.race_grade", racesGradeStats)}` +
      (dryRun ? "" : ` / 更新${racesGradeUpdateCount}件`),
  );

  return result(true);
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

export { loadCancellationRows, flushRaceInfo };
