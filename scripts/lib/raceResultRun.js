// レース単位の結果取得の入口 runForRaces（Vercel Cron のスロット消化・catch-up）。
// scripts/daily/scrape-results.js から分けた（呼び出し元はこれまでどおり scrape-results.js から import できる）

import { supabase } from "./supabaseClient.js";
import { BreakerOpenError } from "./scrapeJobs/circuitBreaker.js";
import { mapWithConcurrency } from "./scrapeJobs/concurrency.js";
import { computeResultDigest } from "./scrapeJobs/resultDigest.js";
import { raceStartInstant } from "./scrapeJobs/time.js";
import {
  buildRaceResultRow,
  fetchRaceResultHtml,
  getRaceResultUrl,
  isResultComplete,
  parseRaceResultHtml,
} from "./raceResultPage.js";
import { persistRaceResults } from "./raceResultPersist.js";

/**
 * レース単位の入口（Vercel Cron のスロット消化・catch-up から呼ぶ。T4b-02-1）。
 *
 * scrapeAndSaveResults と同じ解析（parseRaceResultHtml）・行の組み立て（buildRaceResultRow）・書き込み
 * （persistRaceResults）を使う。違いは次のとおり:
 *   - 取得は fetchHtml（Vercelでは politeFetch 経由）で行い、待機（500ms）は入れず、concurrency で並列にする
 *   - 「直近10日の的中フラグの補完（fixMissingHitFlags）」は呼ばない（日次の result-catchup へ移した。
 *     ここでは、今回書いた結果の的中判定のみ）
 *   - mode="shadow" は、取得・解析のみで、データテーブルへ一切書かない。既存の完了済みの結果も、取得して
 *     ダイジェストを計算する（既存基盤が書いた値との一致を、ダイジェストで比べるため）
 *   - mode="live" は、既に完了済み（payout_win・winning_technique が揃う）のレースを、取得せずに終える
 *
 * 各レースの outcome（scrape_slots.outcome と同じ語彙）:
 *   ok                完了（決まり手まで揃った）。resultDigest を返す
 *   partial           着順・払戻のみ（決まり手が未公開）。live では書き込み済み。再試行する
 *   no_values         結果ページから着順・払戻を解析できなかった（未公開・中止・順延）。再試行する
 *   skipped_have_data （live のみ）既に完了済み
 *   error             取得（HTTP・ネットワーク）・解析・書き込みの失敗。再試行する
 *   breaker_open      サーキットブレーカーが開いていた。retryAt まで再試行を遅らせる
 *
 * @param {Array<{race_id: string, venue_code: number, race_number: number, start_time?: Date}>} races
 * @param {Object} options
 * @param {string} options.date YYYY-MM-DD（結果ページの日付）
 * @param {"live"|"shadow"} [options.mode]
 * @param {(url: string) => Promise<string>} [options.fetchHtml] 既定は fetchRaceResultHtml（グローバルの fetch）
 * @param {import("@supabase/supabase-js").SupabaseClient} [options.client]
 * @param {number} [options.concurrency]
 * @param {() => Date} [options.now]
 * @returns {Promise<Array<{race_id: string, outcome: string, rowsWritten: number, rowsParsed: number, rowsExpected: number, resultDigest?: string, error?: string, retryAt?: Date}>>}
 */
export async function runForRaces(
  races,
  {
    date,
    mode = "live",
    fetchHtml = (url) => fetchRaceResultHtml(url),
    client = supabase,
    concurrency = 1,
    now = () => new Date(),
  } = {},
) {
  const live = assertRunOptions(mode, date);
  /** @type {Map<string, Object>} */
  const outcomes = new Map();
  const base = { rowsWritten: 0, rowsParsed: 0, rowsExpected: 1 };

  // await はこの関数の中に元のまま並べる（分けた先を async にすると await の段が増え、Vercel Cron の並列の
  // スロットの間で書き込みの順が入れ替わる。hq write_match の result-jobs の場面で確かめた）

  // 1) live: 既に完了済みのレースは、取得しない
  const finished = new Set();
  if (live && races.length > 0) {
    const { data, error } = await selectExistingResults(client, races);
    if (error) {
      throw new Error(`結果の既存行の取得に失敗しました: ${error.message}`);
    }
    markFinishedRaces(data, races, finished, outcomes, base);
  }

  // 2) 取得・解析（1つの失敗で他のレースを止めない）
  /** @type {Array<{race: Object, parsed: NonNullable<ReturnType<typeof parseRaceResultHtml>>, row: Object}>} */
  const fetched = [];
  await mapWithConcurrency(
    races.filter((race) => !finished.has(race.race_id)),
    concurrency,
    (race) =>
      fetchAndParseRace(race, { date, fetchHtml, now, outcomes, base, fetched }),
  );

  // 3) live: 書き込む。shadow: 書かない
  let persisted = null;
  if (live && fetched.length > 0) {
    try {
      const startTimeByRaceId = await loadStartTimes(client, date, fetched);
      persisted = await persistRaceResults({
        client,
        newResults: fetched.map((f) => f.row),
        scrapeCache: new Map(fetched.map((f) => [f.race.race_id, f.parsed])),
        startTimeByRaceId,
      });
    } catch (error) {
      markPersistFailed(fetched, outcomes, base, error);
      persisted = { failed: true };
    }
  }

  recordFetchedOutcomes(fetched, persisted, outcomes, base);
  return races.map((race) => ({
    race_id: race.race_id,
    ...outcomes.get(race.race_id),
  }));
}

/** 引数の確かめ（mode は live か shadow、date は必須）。live なら true を返す */
function assertRunOptions(mode, date) {
  if (mode !== "live" && mode !== "shadow") {
    throw new Error(`mode は live か shadow にしてください: ${mode}`);
  }
  if (!date) throw new Error("date（YYYY-MM-DD）が必要です");
  return mode === "live";
}

/** race_results の既存行（完了の判定に使う列）を読む。async にせず問い合わせの Promise をそのまま返す（runForRaces の 1） */
function selectExistingResults(client, races) {
  return client
    .from("race_results")
    .select("race_id, payout_win, winning_technique")
    .in(
      "race_id",
      races.map((r) => r.race_id),
    );
}

/** 既存行のうち完了済み（isResultComplete）のレースを finished に集め、outcomes に skipped_have_data を入れる（runForRaces の 1） */
function markFinishedRaces(data, races, finished, outcomes, base) {
  for (const r of data ?? []) {
    if (isResultComplete(r)) finished.add(r.race_id);
  }
  for (const race of races) {
    if (finished.has(race.race_id)) {
      outcomes.set(race.race_id, { ...base, outcome: "skipped_have_data" });
    }
  }
}

/**
 * 1レースの結果ページの取得・解析・行の組み立て（runForRaces の 2、mapWithConcurrency の中身）。
 * 失敗・未公開・ブレーカーは outcomes に入れ、解析できた物を fetched に足す
 */
async function fetchAndParseRace(
  race,
  { date, fetchHtml, now, outcomes, base, fetched },
) {
  try {
    const html = await fetchHtml(
      getRaceResultUrl(race.venue_code, race.race_number, date),
    );
    const parsed = parseRaceResultHtml(html);
    if (!parsed) {
      outcomes.set(race.race_id, {
        ...base,
        outcome: "no_values",
        error:
          "結果ページから着順・払戻を解析できませんでした（未公開・中止・順延の可能性）",
      });
      return;
    }
    const row = buildRaceResultRow(race.race_id, parsed, {
      resultAt: now().toISOString(),
    });
    fetched.push({ race, parsed, row });
  } catch (error) {
    if (error instanceof BreakerOpenError) {
      outcomes.set(race.race_id, {
        ...base,
        outcome: "breaker_open",
        retryAt: new Date(error.until),
        error: error.message,
      });
    } else {
      outcomes.set(race.race_id, {
        ...base,
        outcome: "error",
        error: error.message,
      });
    }
  }
}

/**
 * 書き込み前後の想定外の失敗（DB接続等）。書けたか分からないため、全レースを error にして再試行させる（書き込みは冪等。runForRaces の 3）
 */
function markPersistFailed(fetched, outcomes, base, error) {
  for (const { race } of fetched) {
    outcomes.set(race.race_id, {
      ...base,
      rowsParsed: 1,
      outcome: "error",
      error: `結果の書き込みに失敗しました: ${error.message}`,
    });
  }
}

/** 書き込みまで済んだ1レースの outcome（ok か partial。recordFetchedOutcomes の一部） */
function fetchedOutcome(
  race,
  parsed,
  row,
  { changedIds, timingsWrittenByRace, base },
) {
  // 不成立（全勝式が不成立）のレースは、決まり手が出ない・単勝の払戻が無いため、待っても揃わない。
  // 「決まり手が未公開」として毎分再取得し続けないよう、着順・払戻の表が読めた時点で完了とする
  const complete =
    isResultComplete(row) || parsed.full?.race_status === "no_race";
  return {
    ...base,
    rowsParsed: 1,
    rowsWritten:
      (changedIds.has(race.race_id) ? 1 : 0) +
      (timingsWrittenByRace.get(race.race_id) ?? 0),
    outcome: complete ? "ok" : "partial",
    resultDigest: complete
      ? computeResultDigest(
          row,
          (parsed.startTimings ?? []).map((st) => ({
            race_id: race.race_id,
            ...st,
          })),
        )
      : undefined,
    error: complete
      ? undefined
      : "決まり手が未公開です（着順・払戻のみ取得。再試行します）",
  };
}

/** 取得・解析できたレースの outcome（ok・partial・error）を outcomes に入れる（runForRaces の 4） */
function recordFetchedOutcomes(fetched, persisted, outcomes, base) {
  const changedIds = new Set(
    (persisted?.changedResults ?? []).map((r) => r.race_id),
  );
  const timingsWrittenByRace = new Map();
  for (const row of persisted?.startTimingRowsWritten ?? []) {
    timingsWrittenByRace.set(
      row.race_id,
      (timingsWrittenByRace.get(row.race_id) ?? 0) + 1,
    );
  }
  for (const { race, parsed, row } of fetched) {
    if (persisted?.failed) continue; // 上で error を設定済み
    if (persisted?.errors?.length > 0) {
      outcomes.set(race.race_id, {
        ...base,
        rowsParsed: 1,
        outcome: "error",
        error: persisted.errors.map((e) => e.message).join(" / "),
      });
      continue;
    }
    outcomes.set(
      race.race_id,
      fetchedOutcome(race, parsed, row, {
        changedIds,
        timingsWrittenByRace,
        base,
      }),
    );
  }
}

/**
 * 書き込む結果の発走予定時刻（気象の観測時刻）を、races から1回のクエリで取る。races の行に start_time が
 * 無い（取れない）レースは、観測時刻なし（NULL）で書く（従来の scrapeAndSaveResults と同じ）。
 * 引数の races に start_time（Date）が渡されていれば、それを使う。
 */
async function loadStartTimes(client, date, fetched) {
  const startTimeByRaceId = new Map(
    fetched
      .filter((f) => f.race.start_time)
      .map((f) => [f.race.race_id, f.race.start_time]),
  );
  const missing = fetched
    .map((f) => f.race.race_id)
    .filter((id) => !startTimeByRaceId.has(id));
  if (missing.length === 0) return startTimeByRaceId;
  const { data, error } = await client
    .from("races")
    .select("race_id, start_time")
    .in("race_id", missing);
  if (error) {
    // 観測時刻が付かないだけで、結果そのものの保存には影響しない
    console.warn(
      `⚠️ 発走時刻の取得に失敗（気象の観測時刻はNULL）: ${error.message}`,
    );
    return startTimeByRaceId;
  }
  for (const r of data ?? []) {
    if (!r.start_time) continue;
    try {
      startTimeByRaceId.set(r.race_id, raceStartInstant(date, r.start_time));
    } catch (e) {
      console.warn(`⚠️ 発走時刻を解釈できません(${r.race_id}): ${e.message}`);
    }
  }
  return startTimeByRaceId;
}
