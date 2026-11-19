// 結果の書き込み（race_results・race_start_timings・race_payouts・気象・的中判定）と、レース単位の入口 runForRaces。
// scripts/daily/scrape-results.js から分けた（呼び出し元はこれまでどおり scrape-results.js から import できる）

import { supabase } from "./supabaseClient.js";
import {
  PREDICTION_HIT_COLUMNS as HIT_COLUMNS,
  buildPredictionHitUpdate,
} from "./hitCalculator.js";
import { upsertChangedRows } from "./unchangedRows.js";
import { buildResultWeatherRows } from "./beforeinfoWeather.js";
import {
  buildPayoutRows,
  buildResultExtras,
  buildTimingRows,
} from "./raceResultRows.js";
import { detectResultSchema } from "./raceResultSchema.js";
import { upsertRaceConditions } from "./raceConditionsWriter.js";
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

/**
 * predictions の的中判定を更新する（結果が新規・変更のレースだけ）。
 *
 * 変更の無いレース（再取得されただけ）は前回の実行で判定済みで、trg_update_predictions も同じ判定を行うため、
 * 毎回predictionsを再UPDATEしない。判定漏れは fixMissingHitFlags が自己修復する。
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} client
 * @param {Object[]} resultsToJudge race_results の行（rank1〜3・payout_* を持つ）
 */
async function judgeAndUpdateHits(client, resultsToJudge) {
  console.log(`\n📤 predictions の的中判定を更新中...`);
  let winHits = 0;
  let placeHits = 0;
  let trifectaHits = 0;
  let trioHits = 0;

  const newResultIds = resultsToJudge.map((r) => r.race_id);
  const { data: allPredictions } =
    newResultIds.length === 0
      ? { data: [] } // 全レースが変更なしなら、predictionsの読み取りも不要
      : await client
          .from("predictions")
          .select(
            "prediction_id, model_id, top_pick, top_2nd, top_3rd, race_id, feature_contributions",
          )
          .in("race_id", newResultIds);

  // race_id ごとにグループ化
  const predsByRace = new Map();
  for (const pred of allPredictions || []) {
    if (!predsByRace.has(pred.race_id)) predsByRace.set(pred.race_id, []);
    predsByRace.get(pred.race_id).push(pred);
  }

  for (const result of resultsToJudge) {
    const predictions = predsByRace.get(result.race_id) || [];
    if (predictions.length === 0) continue;

    for (const pred of predictions) {
      // 判定の規則（不成立・返還艇・top_3rd を予想しないモデル・展開予測）は buildPredictionHitUpdate に集約（BOA-544）
      const updateData = buildPredictionHitUpdate(pred, result);

      const { error: updateError } = await client
        .from("predictions")
        .update(updateData)
        .eq("prediction_id", pred.prediction_id);

      if (!updateError) {
        if (updateData.is_hit_win) winHits++;
        if (updateData.is_hit_place) placeHits++;
        if (updateData.is_hit_trifecta) trifectaHits++;
        if (updateData.is_hit_trio) trioHits++;
      }
    }
  }

  console.log(`  ✅ 単勝的中: ${winHits}件, 複勝的中: ${placeHits}件`);
  console.log(`  ✅ 3連複的中: ${trifectaHits}件, 3連単的中: ${trioHits}件`);
}

/**
 * race_start_timings と race_payouts の書き込み（persistRaceResults の一部）。失敗は errors に足す。書いた timings の行を返す
 */
async function writeTimingsAndPayouts(client, scrapeCache, schema, errors) {
  // race_start_timingsに艇別の結果（ST・着欄・進入・レースタイム）を書き込み。
  // 077が未適用なら、STを読めた艇の行だけ（旧実装と同じ）
  const allStartTimings = [...scrapeCache].flatMap(([raceId, scraped]) =>
    buildTimingRows(raceId, scraped, {
      extended: schema.timings,
      officialRow: schema.officialRow,
    }),
  );

  let startTimingRowsWritten = [];
  if (allStartTimings.length > 0) {
    // 書く行には updated_at を設定する（WS2。created_at はINSERT時のDBの DEFAULT に任せる）
    const timingsResult = await upsertChangedRows(
      client,
      "race_start_timings",
      allStartTimings,
      {
        onConflict: "race_id,boat_number",
        keyColumns: ["race_id", "boat_number"],
        label: "race_start_timings",
        stampUpdatedAt: true,
      },
    );
    startTimingRowsWritten = timingsResult.toWrite;
    if (timingsResult.error) errors.push(timingsResult.error);
  }

  // 払戻明細（同着の複数口・特払・不成立を含む。079が適用済みのときだけ）
  if (schema.payouts) {
    const payoutRows = [...scrapeCache].flatMap(([raceId, scraped]) =>
      buildPayoutRows(raceId, scraped),
    );
    if (payoutRows.length > 0) {
      const payoutsResult = await upsertChangedRows(
        client,
        "race_payouts",
        payoutRows,
        {
          onConflict: "race_id,bet_type,seq",
          keyColumns: ["race_id", "bet_type", "seq"],
          label: "race_payouts",
          stampUpdatedAt: true,
          // 1レース約8〜14行。PostgRESTの1000行上限を超えない範囲に分割する
          chunkSize: 50,
        },
      );
      if (payoutsResult.error) errors.push(payoutsResult.error);
    }
  }
  return startTimingRowsWritten;
}

/** 結果ページの気象を race_conditions へ（persistRaceResults の一部。失敗しても止めない） */
async function writeResultWeather(client, scrapeCache, startTimeByRaceId) {
  // レース時点の気象（結果ページの水面気象情報）を race_conditions へ反映する（BOA-358）。
  // 発走前に取得した値（beforeinfo）より新しい確定値のため上書きする。変更のある行だけ書く。
  // 失敗しても、以降の的中判定を止めない
  try {
    const { rows: weatherRows, stats: weatherStats } = buildResultWeatherRows(
      [...scrapeCache].map(([raceId, scraped]) => ({
        raceId,
        startTime: startTimeByRaceId.get(raceId) ?? null,
        conditions: scraped.weather,
      })),
    );
    console.log(
      `🌤️ 結果ページの気象: 取得${weatherStats.fetched}レース / 解析${weatherStats.parsed}レース`,
    );
    if (weatherStats.fetched > 0 && weatherRows.length === 0) {
      console.warn(
        "⚠️ 結果ページの気象: 結果を取得したが、気象が1件も解析できなかった（公式ページの構造変更の可能性）",
      );
    }
    if (weatherRows.length > 0) {
      await upsertRaceConditions(client, weatherRows, {
        label: "race_conditions(結果ページの気象)",
      });
    }
  } catch (weatherError) {
    console.error(
      `❌ 結果ページの気象の更新エラー（結果は保存済み）: ${weatherError.message}`,
    );
  }
}

/**
 * 取得した結果をDBへ書き込む（race_results・race_start_timings・気象・的中判定）。
 * scrapeAndSaveResults（GitHub Actions・CLI）と runForRaces（Vercel Cron）で共有する。
 *
 * 書き込みの失敗は、従来どおり後続（気象・的中判定）を止めず、errors に集めて返す
 * （GitHub Actions側は従来どおり無視する。Vercel Cron側は、errors があれば、その実行を失敗として再試行する）。
 *
 * @param {Object} params
 * @param {import("@supabase/supabase-js").SupabaseClient} params.client
 * @param {Object[]} params.newResults buildRaceResultRow が作った行
 * @param {Map<string, ReturnType<typeof parseRaceResultHtml>>} params.scrapeCache race_id → 解析結果
 * @param {Map<string, Date>} params.startTimeByRaceId race_id → 発走予定時刻（気象の観測時刻に使う）
 * @returns {Promise<{changedResults: Object[], startTimingRowsWritten: Object[], errors: Error[]}>}
 */
export async function persistRaceResults({
  client,
  newResults,
  scrapeCache,
  startTimeByRaceId,
}) {
  const errors = [];
  console.log(`\n📤 Supabaseに結果を書き込み中...`);

  // 決まり手・ST等が公式サイトに出るまで（発走20〜30分後以降）、着順・払戻金だけ揃った
  // レースは「完了」扱いにならず毎回再取得される（BOA-323）。その間の再取得では、
  // 前回と同じ値をupsertし直していた。race_results の書き込みは trg_update_predictions で
  // predictions・bet_recommendations の再UPDATEも連鎖させるため、変更の無い行は書かない。
  // result_at は取得時刻で毎回変わるが情報を持たないため比較から外す
  // （変更なしのレースは最初に取得できた時刻が残る）
  //
  // 結果系の新しい列・テーブル（マイグレーション077〜079。docs/design/race-result-full-fields/plan.md）は、
  // 適用済みのDBにだけ書く。未適用のDBでは、旧実装と同じ列だけを書く（挙動が変わらない）
  const schema = await detectResultSchema(client);
  const resultRows = schema.results
    ? newResults.map((row) => ({
        ...row,
        ...(scrapeCache.has(row.race_id)
          ? buildResultExtras(scrapeCache.get(row.race_id))
          : {}),
      }))
    : newResults;
  const { toWrite: changedResults, error: resultsError } =
    await upsertChangedRows(client, "race_results", resultRows, {
      onConflict: "race_id",
      keyColumns: ["race_id"],
      ignoreColumns: ["result_at"],
      label: "race_results",
    });
  if (resultsError) errors.push(resultsError);

  const startTimingRowsWritten = await writeTimingsAndPayouts(
    client,
    scrapeCache,
    schema,
    errors,
  );

  await writeResultWeather(client, scrapeCache, startTimeByRaceId);

  // 的中判定は、race_resultsが新規・変更のレースだけ行う（judgeAndUpdateHits の説明を参照）
  const changedResultIds = new Set(changedResults.map((r) => r.race_id));
  const resultsToJudge = newResults.filter((r) =>
    changedResultIds.has(r.race_id),
  );
  await judgeAndUpdateHits(client, resultsToJudge);

  return { changedResults, startTimingRowsWritten, errors };
}

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
  if (mode !== "live" && mode !== "shadow") {
    throw new Error(`mode は live か shadow にしてください: ${mode}`);
  }
  if (!date) throw new Error("date（YYYY-MM-DD）が必要です");
  const live = mode === "live";
  /** @type {Map<string, Object>} */
  const outcomes = new Map();
  const base = { rowsWritten: 0, rowsParsed: 0, rowsExpected: 1 };

  // 1) live: 既に完了済みのレースは、取得しない
  const finished =
    live && races.length > 0
      ? await markFinishedRaces(client, races, outcomes, base)
      : new Set();

  // 2) 取得・解析（1つの失敗で他のレースを止めない）
  const fetched = await fetchAndParseRaces(
    races.filter((race) => !finished.has(race.race_id)),
    { date, fetchHtml, concurrency, now, outcomes, base },
  );

  // 3) live: 書き込む。shadow: 書かない
  const persisted =
    live && fetched.length > 0
      ? await persistFetchedResults(client, date, fetched, outcomes, base)
      : null;

  recordFetchedOutcomes(fetched, persisted, outcomes, base);
  return races.map((race) => ({
    race_id: race.race_id,
    ...outcomes.get(race.race_id),
  }));
}

/**
 * live: race_results で既に完了済み（isResultComplete）のレースを集め、outcomes に skipped_have_data を入れる（runForRaces の 1）
 * @returns {Promise<Set<string>>}
 */
async function markFinishedRaces(client, races, outcomes, base) {
  const finished = new Set();
  const { data, error } = await client
    .from("race_results")
    .select("race_id, payout_win, winning_technique")
    .in(
      "race_id",
      races.map((r) => r.race_id),
    );
  if (error) {
    throw new Error(`結果の既存行の取得に失敗しました: ${error.message}`);
  }
  for (const r of data ?? []) {
    if (isResultComplete(r)) finished.add(r.race_id);
  }
  for (const race of races) {
    if (finished.has(race.race_id)) {
      outcomes.set(race.race_id, { ...base, outcome: "skipped_have_data" });
    }
  }
  return finished;
}

/**
 * 結果ページの取得・解析・行の組み立て（runForRaces の 2）。失敗・未公開・ブレーカーは outcomes に入れ、解析できた物を返す
 * @returns {Promise<Array<{race: Object, parsed: Object, row: Object}>>}
 */
async function fetchAndParseRaces(
  races,
  { date, fetchHtml, concurrency, now, outcomes, base },
) {
  /** @type {Array<{race: Object, parsed: NonNullable<ReturnType<typeof parseRaceResultHtml>>, row: Object}>} */
  const fetched = [];
  await mapWithConcurrency(races, concurrency, async (race) => {
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
  });
  return fetched;
}

/**
 * live の書き込み（runForRaces の 3）。想定外の失敗は全レースを error にして { failed: true } を返す
 */
async function persistFetchedResults(client, date, fetched, outcomes, base) {
  let persisted = null;
  try {
    const startTimeByRaceId = await loadStartTimes(client, date, fetched);
    persisted = await persistRaceResults({
      client,
      newResults: fetched.map((f) => f.row),
      scrapeCache: new Map(fetched.map((f) => [f.race.race_id, f.parsed])),
      startTimeByRaceId,
    });
  } catch (error) {
    // 書き込み前後の想定外の失敗（DB接続等）。書けたか分からないため、全レースを再試行する（書き込みは冪等）
    for (const { race } of fetched) {
      outcomes.set(race.race_id, {
        ...base,
        rowsParsed: 1,
        outcome: "error",
        error: `結果の書き込みに失敗しました: ${error.message}`,
      });
    }
    persisted = { failed: true };
  }
  return persisted;
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
