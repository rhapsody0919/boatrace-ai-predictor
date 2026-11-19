// 結果の書き込み（race_results・race_start_timings・race_payouts・気象・的中判定）。
// scripts/daily/scrape-results.js から分けた（呼び出し元はこれまでどおり scrape-results.js から import できる）

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
