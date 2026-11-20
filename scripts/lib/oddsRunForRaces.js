/**
 * レース単位のオッズ取得と race_odds への書き込み（runForRaces と、その再試行・窓の補いの部品）。
 * scripts/daily/scrape-odds.js から字のまま移した（CLI の入口は run・main を持ち、ここを再 export する。ハンドラー scrapeJobs/oddsHandlers.js はここを読む）
 */

import { supabase } from "./supabaseClient.js";
import { FULL_ODDS_KEYS } from "./oddsPageParse.js";
import {
  MAX_FALLBACK_AGE_MINUTES,
  buildOddsWindowRows,
  fetchedOddsOutcome,
  markCompletedRetries,
  oddsKeyOf,
  pickFallbackPatches,
  validateOddsRunArgs,
} from "./oddsRows.js";
import { defaultFetch, fetchOddsDetailed } from "./oddsPageFetch.js";
import { mapWithConcurrency } from "./scrapeJobs/concurrency.js";

/** window_min の一意索引（マイグレーション075）。窓内の再試行が、同じ行を更新する */
const ODDS_WINDOW_CONFLICT = "race_id,window_min";

/** 再試行のレースの、前回書いた同じ窓の行を読む（読むだけ）。`${race_id}|${window_min}` -> 行 */
async function loadExistingOddsRows(client, retryRaces) {
  const existing = new Map();
  const { data, error } = await client
    .from("race_odds")
    .select("*")
    .in("race_id", [...new Set(retryRaces.map((r) => r.race_id))])
    .in("window_min", [...new Set(retryRaces.map((r) => r.window_min))]);
  if (error) {
    throw new Error(`オッズの既存行の取得に失敗しました: ${error.message}`);
  }
  for (const row of data ?? []) {
    existing.set(`${row.race_id}|${row.window_min}`, row);
  }
  return existing;
}

/** runForRaces の 2) の1レースぶん: 取得・解析して fetched に足すか、outcomes に失敗を入れる */
async function fetchOneOdds(race, { date, fetchFn, outcomes, base, fetched }) {
  const detail = await fetchOddsDetailed(
    date,
    race.venue_code,
    race.race_number,
    { wantFull: true, winFirst: race.winFirst === true, fetchFn },
  );
  if (detail.status === "breaker_open") {
    outcomes.set(oddsKeyOf(race), {
      ...base,
      outcome: "breaker_open",
      retryAt: detail.retryAt,
      error: detail.error,
    });
  } else if (detail.status === "error") {
    outcomes.set(oddsKeyOf(race), {
      ...base,
      outcome: "error",
      error: detail.error,
    });
  } else if (detail.status === "no_values") {
    outcomes.set(oddsKeyOf(race), {
      ...base,
      outcome: "no_values",
      error: "単勝オッズを解析できませんでした（未公開・中止・順延の可能性）",
    });
  } else {
    fetched.push({ race, detail });
  }
}

/**
 * runForRaces の 4) の対象: 0分（締切時点）窓の行のうち全通り系が欠けている物（race_id → 取れている全通り系）
 */
function zeroWindowFallbackTargets(fetched, rows) {
  const fallbackTargets = new Map();
  for (const { race } of fetched) {
    if (race.window_min !== 0) continue;
    const row = rows.get(oddsKeyOf(race));
    const patch = Object.fromEntries(
      FULL_ODDS_KEYS.filter((k) => row[k]).map((k) => [k, row[k]]),
    );
    if (Object.keys(patch).length < FULL_ODDS_KEYS.length) {
      fallbackTargets.set(race.race_id, patch);
    }
  }
  return fallbackTargets;
}

/**
 * runForRaces の 4) の読み: 直近のスナップショットの問い（await するのは呼び出し側。async の殻を挟まず、
 * 書き込みの列の順を分ける前と同じにする）
 */
function fallbackSnapshotQuery(client, fallbackTargets, now) {
  const cutoffIso = new Date(
    now().getTime() - MAX_FALLBACK_AGE_MINUTES * 60000,
  ).toISOString();
  return client
    .from("race_odds")
    .select(`race_id, captured_at, window_min, ${FULL_ODDS_KEYS.join(", ")}`)
    .in("race_id", [...fallbackTargets.keys()])
    .gte("captured_at", cutoffIso)
    .order("captured_at", { ascending: false });
}

/** runForRaces の 4) の補完: スナップショットの行から欠けを埋める（rows の行をその場で書き換える） */
function applyFallbackPatches(rows, fallbackTargets, data) {
  // 自分の窓（0分）の行は、部分的な前回の試行の可能性があるため、補完元にしない
  const snapshots = (data ?? []).filter((r) => r.window_min !== 0);
  for (const [raceId, fallback] of pickFallbackPatches(
    fallbackTargets,
    snapshots,
  )) {
    Object.assign(rows.get(`${raceId}|0`), fallback);
  }
}

/**
 * レース×窓の入口（Vercel Cron のスロット消化から呼ぶ。T4b-04-1）。
 *
 * run（GitHub Actions・CLIの入口）と、解析（fetchOddsDetailed）・行の組み立て（buildBaseRow・fullOddsPatchOf）・
 * 0分窓のフォールバック（pickFallbackPatches）を共有する。違いは次のとおり:
 *   - 取得は fetchFn（Vercel では politeFetch 経由）で行い、会場直列・会場間の待機は無い。レース単位に concurrency で
 *     並列にする（各レースの5ページは並列）
 *   - 対象は、races のうち window_min（0〜-60）が決まっているスロット。全窓で全券種の全通りを取る（ADR-0057 FR-4）
 *   - 書き込みは、基本オッズと全通り系を1行にまとめ、race_id,window_min の一意索引で upsert する
 *     （source='vercel'・window_min つき。窓内の再試行は同じ行を更新するため、行が増えない）
 *   - 再試行（attempts>1）では、前回書いた同じ窓の行を読み、取れている列を null で上書きしない。既にその窓の
 *     行が完了していれば、取得せずに skipped_have_data で終える
 *   - mode="shadow" は、取得・解析のみで、race_odds へ一切書かない（result_digest に、構造のダイジェストを返す。
 *     再試行の既存行も読まない）
 *
 * 各レースの outcome（scrape_slots.outcome と同じ語彙）:
 *   ok                完了（単勝ページが発売済みで、全通り系5券種がそろった。0分窓は直近のスナップショットからの補完を含む。
 *                     単勝の値は票0で全て null のことがある。BOA-486）
 *   partial           単勝ページは発売済みだが、全通り系の一部が未取得（live では、取れた分を書き込み済み）。再試行する
 *   no_values         単勝の行そのものが無い（未公開・中止・順延の可能性）。再試行する
 *   skipped_have_data （live のみ）この窓の行が既に完了している
 *   error             取得（HTTP・ネットワーク）・書き込みの失敗。再試行する
 *   breaker_open      サーキットブレーカーが開いていた。retryAt まで再試行を遅らせる
 *
 * @param {Array<{race_id: string, venue_code: number, race_number: number, window_min: number, attempts?: number, winFirst?: boolean}>} races
 *   winFirst: true なら、単勝ページだけを先に取得し、未公開なら他のページを取得しない（fetchOddsDetailed）
 * @param {Object} options
 * @param {string} options.date YYYY-MM-DD（オッズページの日付）
 * @param {"live"|"shadow"} [options.mode]
 * @param {(url: string) => Promise<Response>} [options.fetchFn] 既定はグローバルの fetch
 * @param {import("@supabase/supabase-js").SupabaseClient} [options.client]
 * @param {number} [options.concurrency]
 * @param {() => Date} [options.now]
 * @returns {Promise<Array<{race_id: string, outcome: string, rowsWritten: number, rowsParsed: number, rowsExpected: number, resultDigest?: string, missing?: string[], error?: string, retryAt?: Date}>>}
 */
export async function runForRaces(
  races,
  {
    date,
    mode = "live",
    fetchFn = defaultFetch,
    client = supabase,
    concurrency = 1,
    now = () => new Date(),
  } = {},
) {
  validateOddsRunArgs(races, mode, date);
  const live = mode === "live";
  /** @type {Map<string, Object>} */
  const outcomes = new Map();
  const base = { rowsWritten: 0, rowsParsed: 0, rowsExpected: 1 };

  // 1) live・再試行のレース: 前回書いた同じ窓の行を読む（値の引き継ぎ・完了済みの判定）
  const keyOf = oddsKeyOf;
  const retryRaces = races.filter((r) => (r.attempts ?? 1) > 1);
  const existing =
    live && retryRaces.length > 0
      ? await loadExistingOddsRows(client, retryRaces)
      : new Map(); // `${race_id}|${window_min}` -> 行
  markCompletedRetries(retryRaces, existing, { live, outcomes, base });

  // 2) 取得・解析（1つの失敗で他のレースを止めない）
  /** @type {Array<{race: Object, detail: Awaited<ReturnType<typeof fetchOddsDetailed>>}>} */
  const fetched = [];
  await mapWithConcurrency(
    races.filter((race) => !outcomes.has(keyOf(race))),
    concurrency,
    (race) => fetchOneOdds(race, { date, fetchFn, outcomes, base, fetched }),
  );

  // 3) 行の組み立て（基本オッズ＋全通り系を1行に。再試行は既存の値を引き継ぐ）
  const capturedAt = now().toISOString();
  const rows = buildOddsWindowRows(fetched, existing, capturedAt); // race_id -> 行

  // 4) 0分（締切時点）窓: 全通り系の欠けを、直近のスナップショット（同じ窓の行を除く）から補完する（ADR-0057）
  const fallbackTargets = zeroWindowFallbackTargets(fetched, rows);
  if (fallbackTargets.size > 0) {
    const { data, error } = await fallbackSnapshotQuery(
      client,
      fallbackTargets,
      now,
    );
    if (error) {
      throw new Error(
        `オッズの補完用スナップショットの取得に失敗しました: ${error.message}`,
      );
    }
    applyFallbackPatches(rows, fallbackTargets, data);
  }

  // 5) live: 書き込む。shadow: 書かない
  let writeError = null;
  if (live && rows.size > 0) {
    const { error } = await client
      .from("race_odds")
      .upsert([...rows.values()], { onConflict: ODDS_WINDOW_CONFLICT });
    if (error) writeError = error.message;
  }

  for (const { race } of fetched) {
    outcomes.set(
      keyOf(race),
      fetchedOddsOutcome(rows.get(keyOf(race)), { base, writeError, live }),
    );
  }

  return races.map((race) => ({
    race_id: race.race_id,
    ...outcomes.get(keyOf(race)),
  }));
}
