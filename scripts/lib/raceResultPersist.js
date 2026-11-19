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


/** race_results の行（マイグレーション077〜079 が適用済みなら結果の追加の列を足す。persistRaceResults の一部） */
function buildResultRows(newResults, scrapeCache, schema) {
  // 結果系の新しい列・テーブル（マイグレーション077〜079。docs/design/race-result-full-fields/plan.md）は、
  // 適用済みのDBにだけ書く。未適用のDBでは、旧実装と同じ列だけを書く（挙動が変わらない）
  return schema.results
    ? newResults.map((row) => ({
        ...row,
        ...(scrapeCache.has(row.race_id)
          ? buildResultExtras(scrapeCache.get(row.race_id))
          : {}),
      }))
    : newResults;
}

/**
 * race_results の upsert（変更の無い行は書かない。persistRaceResults の一部）。
 * async にせず upsertChangedRows の Promise をそのまま返す（await の段数を変えず、並列の書き込みの順を保つ）
 */
function upsertResultRows(client, resultRows) {
  // 決まり手・ST等が公式サイトに出るまで（発走20〜30分後以降）、着順・払戻金だけ揃った
  // レースは「完了」扱いにならず毎回再取得される（BOA-323）。その間の再取得では、
  // 前回と同じ値をupsertし直していた。race_results の書き込みは trg_update_predictions で
  // predictions・bet_recommendations の再UPDATEも連鎖させるため、変更の無い行は書かない。
  // result_at は取得時刻で毎回変わるが情報を持たないため比較から外す
  // （変更なしのレースは最初に取得できた時刻が残る）
  return upsertChangedRows(client, "race_results", resultRows, {
    onConflict: "race_id",
    keyColumns: ["race_id"],
    ignoreColumns: ["result_at"],
    label: "race_results",
  });
}

/** race_start_timings の行（艇別の結果: ST・着欄・進入・レースタイム。077が未適用なら、STを読めた艇の行だけ＝旧実装と同じ） */
function buildAllTimingRows(scrapeCache, schema) {
  return [...scrapeCache].flatMap(([raceId, scraped]) =>
    buildTimingRows(raceId, scraped, {
      extended: schema.timings,
      officialRow: schema.officialRow,
    }),
  );
}

/** race_start_timings の upsert（async にせず Promise をそのまま返す）。書く行には updated_at を設定する（WS2。created_at はINSERT時のDBの DEFAULT に任せる） */
function upsertTimingRows(client, allStartTimings) {
  return upsertChangedRows(client, "race_start_timings", allStartTimings, {
    onConflict: "race_id,boat_number",
    keyColumns: ["race_id", "boat_number"],
    label: "race_start_timings",
    stampUpdatedAt: true,
  });
}

/** 払戻明細の行（同着の複数口・特払・不成立を含む） */
function buildAllPayoutRows(scrapeCache) {
  return [...scrapeCache].flatMap(([raceId, scraped]) =>
    buildPayoutRows(raceId, scraped),
  );
}

/** race_payouts の upsert（async にせず Promise をそのまま返す）。1レース約8〜14行。PostgRESTの1000行上限を超えない範囲に分割する */
function upsertPayoutRows(client, payoutRows) {
  return upsertChangedRows(client, "race_payouts", payoutRows, {
    onConflict: "race_id,bet_type,seq",
    keyColumns: ["race_id", "bet_type", "seq"],
    label: "race_payouts",
    stampUpdatedAt: true,
    chunkSize: 50,
  });
}

/**
 * 結果ページの気象（水面気象情報）の race_conditions の行を組み立て、取得・解析の件数を出す（persistRaceResults の一部）。
 * 解析できなければ throw する（呼び手の try で受ける）
 */
function buildWeatherRows(scrapeCache, startTimeByRaceId) {
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
  return weatherRows;
}

/** 的中判定の対象（race_results が新規・変更のレースだけ。judgeAndUpdateHits の説明を参照） */
function pickResultsToJudge(newResults, changedResults) {
  const changedResultIds = new Set(changedResults.map((r) => r.race_id));
  return newResults.filter((r) => changedResultIds.has(r.race_id));
}

/**
 * 取得した結果をDBへ書き込む（race_results・race_start_timings・気象・的中判定）。
 * scrapeAndSaveResults（GitHub Actions・CLI）と runForRaces（Vercel Cron）で共有する。
 *
 * 書き込みの失敗は、従来どおり後続（気象・的中判定）を止めず、errors に集めて返す
 * （GitHub Actions側は従来どおり無視する。Vercel Cron側は、errors があれば、その実行を失敗として再試行する）。
 *
 * await はこの関数の中に元のまま並べる（分けた先を async にすると await の段が増え、Vercel Cron の並列の
 * スロットの間で書き込みの順が入れ替わる。hq write_match の result-jobs の場面で確かめた）
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

  const schema = await detectResultSchema(client);
  const { toWrite: changedResults, error: resultsError } =
    await upsertResultRows(
      client,
      buildResultRows(newResults, scrapeCache, schema),
    );
  if (resultsError) errors.push(resultsError);

  const allStartTimings = buildAllTimingRows(scrapeCache, schema);
  let startTimingRowsWritten = [];
  if (allStartTimings.length > 0) {
    const timingsResult = await upsertTimingRows(client, allStartTimings);
    startTimingRowsWritten = timingsResult.toWrite;
    if (timingsResult.error) errors.push(timingsResult.error);
  }

  // 払戻明細（079が適用済みのときだけ）
  if (schema.payouts) {
    const payoutRows = buildAllPayoutRows(scrapeCache);
    if (payoutRows.length > 0) {
      const payoutsResult = await upsertPayoutRows(client, payoutRows);
      if (payoutsResult.error) errors.push(payoutsResult.error);
    }
  }

  // レース時点の気象（結果ページの水面気象情報）を race_conditions へ反映する（BOA-358）。
  // 発走前に取得した値（beforeinfo）より新しい確定値のため上書きする。変更のある行だけ書く。
  // 失敗しても、以降の的中判定を止めない
  try {
    const weatherRows = buildWeatherRows(scrapeCache, startTimeByRaceId);
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

  await judgeAndUpdateHits(
    client,
    pickResultsToJudge(newResults, changedResults),
  );

  return { changedResults, startTimingRowsWritten, errors };
}
