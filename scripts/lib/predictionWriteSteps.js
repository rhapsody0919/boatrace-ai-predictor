/**
 * 予想の書き込みの段（writeToSupabase・buildRacesRow）と再計算の荒れ度の更新の計画・dry-run の表示。
 * scripts/daily/generate-predictions.js から字のまま下ろした物（lib-no-entry）。scripts/lib/predictionRun.js が読む。
 */
import { supabase } from "./supabaseClient.js";
import { filterUnchangedRows, planWriteAll } from "./unchangedRows.js";
import { upsertRaceConditions } from "./raceConditionsWriter.js";
import {
  buildConditionRow,
  buildEntryRows,
  buildExhibitionRows,
  buildPredictionRows,
  findStartedRaceIds,
  groupConditionRowsBySignature,
  hasConditionsToWrite,
  upsertEntryRows,
  upsertExhibitionRows,
  upsertPredictions,
  upsertRacesRows,
} from "./predictionWriteRows.js";
import { calculateStdDev } from "./predictionVolatility.js";
import {
  logRefreshDryRun,
  volatilitySummary,
} from "./predictionRefreshSteps.js";

/** races テーブルの1行（選手データから統計を計算する） */
function buildRacesRow(race, date) {
  const players = race.predictions.standard.players;
  const winRates = players.map((p) => parseFloat(p.winRate));
  const motorRates = players.map((p) => parseFloat(p.motor2Rate));
  const firstPlayer = players.find((p) => p.number === 1);

  return {
    race_id: race.raceId,
    race_date: date,
    venue_code: race.venueCode,
    race_number: race.raceNumber,
    start_time: race.startTime !== "未定" ? race.startTime + ":00" : null,
    volatility_score: race.volatility.score,
    volatility_level: race.volatility.level,
    recommended_model: race.volatility.recommendedModel,
    volatility_reasons: race.volatility.reasons,
    first_boat_grade: firstPlayer?.grade || null,
    first_boat_win_rate: firstPlayer ? parseFloat(firstPlayer.winRate) : null,
    first_boat_motor_2rate: firstPlayer
      ? parseFloat(firstPlayer.motor2Rate)
      : null,
    first_boat_avg_st: race.volatility.boat1AvgST ?? null,
    race_grade: race.conditions.raceGrade ?? null,
    win_rate_stddev: calculateStdDev(winRates),
    win_rate_avg: winRates.reduce((a, b) => a + b, 0) / winRates.length,
    motor_2rate_stddev: calculateStdDev(motorRates),
    updated_at: new Date().toISOString(),
  };
}

/**
 * Supabaseにデータを書き込む関数
 *
 * @param {Object[]} allPredictions generateRacePrediction の結果
 * @param {string} date 対象日（YYYY-MM-DD）
 * @param {Object} [options]
 * @param {import("@supabase/supabase-js").SupabaseClient|null} [options.client] 既定は supabaseClient.js のクライアント
 * @param {boolean} [options.throwOnError] true（既定。BOA-391）なら、書き込みの失敗を握りつぶさず例外にする。
 *   false は、エラーをログに出して続行する（CLI の main が、morning-init の後続の手順を止めないために指定する）
 * @param {() => Date} [options.now] テスト用の時刻の差し替え（発走済みのレースの判定に使う）
 */
async function writeToSupabase(
  allPredictions,
  date,
  { client = supabase, throwOnError = true, now = () => new Date() } = {},
) {
  if (!client) {
    if (throwOnError) {
      throw new Error("Supabase が設定されていないため、DBへ書き込めません");
    }
    console.log("⚠️  Supabase未設定のため、DB書き込みをスキップします");
    return;
  }
  // upsertChangedRows は失敗を例外にせず {error} で返す。throwOnError のときだけ、ここで例外にする
  const failIfError = (result) => {
    if (throwOnError && result?.error) throw result.error;
    return result;
  };

  console.log("\n📤 Supabaseにデータを書き込み中...");

  try {
    // 1. racesテーブルにupsert
    const racesData = allPredictions.map((race) => buildRacesRow(race, date));

    // WS8(b): 変更の無い行は書かない。updated_at は書き込みのたびに現在時刻へ変わるが
    // 情報を持たないため比較から外す（変更のある行は従来どおりupdated_atも更新する）
    failIfError(await upsertRacesRows(client, racesData));

    // 2. race_entriesテーブルにupsert
    const entriesData = buildEntryRows(allPredictions);

    // 変更の無い行は書かない（バッチ分割・エラー出力は upsertChangedRows が担う）。
    // 書く行には updated_at を設定する（WS2。created_at はINSERT時のDBの DEFAULT に任せる）
    failIfError(await upsertEntryRows(client, entriesData));

    // 2.5. exhibition_dataテーブルにupsert
    const exhibitionRows = buildExhibitionRows(allPredictions);

    if (exhibitionRows.length > 0) {
      failIfError(await upsertExhibitionRows(client, exhibitionRows));
    }

    // 3. predictionsテーブルにupsert（行の作り方と feature_contributions の扱いは predictionRowsForRace）
    const predictionsData = buildPredictionRows(allPredictions);

    // (race_id, model_id) で upsert する（BOA-628。理由と発走済みの扱いは findStartedRaceIds の注）
    const startedRaceIds = findStartedRaceIds(allPredictions, date, now);
    if (startedRaceIds.size > 0) {
      console.log(
        `  ⏭️ 発走済みの${startedRaceIds.size}レースの予測は書かない`,
      );
    }
    const rowsToWrite = predictionsData.filter(
      (row) => !startedRaceIds.has(row.race_id),
    );
    try {
      await upsertPredictions(client, rowsToWrite, now());
    } catch (predsError) {
      console.error("❌", predsError.message);
      if (throwOnError) throw predsError;
    }
    console.log(`  ✅ predictions: ${rowsToWrite.length}件`);

    // 4. race_conditionsテーブルにupsert（race_grade は races テーブルで管理）。
    // 行の作り方・キーの省き方・シグネチャごとのグループ化の理由は buildConditionRow の注
    const conditionsData = allPredictions
      .filter(hasConditionsToWrite)
      .map(buildConditionRow);

    if (conditionsData.length > 0) {
      // グループ（キーの組み合わせ）ごとに、変更のある行だけをupsertする。比較は行が持つ列のみ
      // で行うため、キーを省いた列（別経路が書いた天候等）を「変更あり」と誤判定しない
      for (const group of groupConditionRowsBySignature(
        conditionsData,
      ).values()) {
        // weather_observed_at 列（マイグレーション069）が未適用でも書き込める共通の書き込み関数
        failIfError(
          await upsertRaceConditions(client, group, {
            label: "race_conditions",
          }),
        );
      }
    }

    console.log("✅ Supabase書き込み完了");
  } catch (error) {
    console.error("❌ Supabase書き込みエラー:", error.message);
    if (throwOnError) throw error;
  }
}

// ---------------------------------------------------------------------------
// リフレッシュモード（--refresh）
// Supabase から直接データを読んで対象レースの predictions を更新する
// ---------------------------------------------------------------------------

/**
 * リフレッシュ時の races.volatility 系列の更新対象を決める（WS8(b)）。
 * 値が前回と同じレースは書かない（updated_at は毎回変わるが情報を持たないため、
 * 比較に含まれない: 書き込む列に含めておらず、書くときにだけ現在時刻を付ける）。
 * forceTouchRaces=true のときは従来どおり全レースを更新対象にする。
 *
 * @returns {Promise<{toWrite: Object[], stats: Object, fallback: boolean}>}
 */
async function planRacesVolatilityUpdates(
  allPredictions,
  forceTouchRaces,
  client = supabase,
) {
  const volatilityRows = allPredictions.map((race) => ({
    race_id: race.raceId,
    volatility_score: race.volatility.score,
    volatility_level: race.volatility.level,
    recommended_model: race.volatility.recommendedModel,
    volatility_reasons: race.volatility.reasons,
    first_boat_avg_st: race.volatility.boat1AvgST ?? null,
  }));
  if (forceTouchRaces) return planWriteAll(volatilityRows);
  return filterUnchangedRows(client, "races", volatilityRows, {
    keyColumns: ["race_id"],
    writeMissing: false, // 行が無ければUPDATEしても0件
  });
}

/** DRY-RUN の本体。書くはずの races.volatility 更新件数だけ数える（DBへは書き込まない。await は呼び元） */
function refreshDryRun(allPredictions, forceTouchRaces, client) {
  logRefreshDryRun(allPredictions.length);
  return planRacesVolatilityUpdates(
    allPredictions,
    forceTouchRaces,
    client,
  ).then(({ stats, fallback }) => {
    console.log(`  [DRY-RUN] ${volatilitySummary(stats, fallback)}`);
    return { volatilityStats: stats };
  });
}

export { writeToSupabase, planRacesVolatilityUpdates, refreshDryRun };
