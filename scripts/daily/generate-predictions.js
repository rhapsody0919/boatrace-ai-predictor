// AI予想生成スクリプト
// data/races.json を読み込んで、data/predictions/YYYY-MM-DD.json を生成
// Supabaseにも同時書き込み（デュアルライト）

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { supabase, VENUE_CODES } from "../lib/supabaseClient.js";
import { getTodayDateJST, parseDateArg } from "../lib/dateUtils.js";
import { getRaceSchedule } from "../lib/raceSchedule.js";
import { filterUnchangedRows, planWriteAll } from "../lib/unchangedRows.js";
import { upsertRaceConditions } from "../lib/raceConditionsWriter.js";
import { buildConditionRow, buildEntryRows, buildExhibitionRows, buildPredictionRows, findStartedRaceIds, groupConditionRowsBySignature, hasConditionsToWrite, upsertEntryRows, upsertExhibitionRows, upsertPredictions, upsertRacesRows } from "../lib/predictionWriteRows.js";
import { calculateStdDev, calculateVolatilityScore, getRecommendedModel, getVolatilityLevel } from "../lib/predictionVolatility.js";
import { scoreRacersByModel } from "../lib/predictionScoring.js";
import {
  assembleRacePrediction,
  buildTurnPredictionPlayers,
} from "../lib/predictionRaceBuild.js";
import { RACE_ID_CHUNK_SIZE, fetchRaceDataFromSupabase, fetchRacerStats, fetchVenueWinRates } from "../lib/predictionRaceFetch.js";
import { assertRefreshReady, collectRacerIds, collectRacerIdsFromVenues, logRefreshDryRun, logRefreshStart, logVenueWinRateCount, logVolatilityUpdateError, resolveRefreshOptions, selectTargetRaceIds, triggerDeployHook, updateRaceVolatilityRow, volatilitySummary } from "../lib/predictionRefreshSteps.js";
import { predictFirstMark } from "../lib/turnPrediction.js";
import {
  COURSE_DEFAULT_DISTRIBUTION,
  COURSE_DEFAULT_DEFENSE,
} from "../lib/winningTechniques.js";
import {
  VENUE_VOLATILITY_THRESHOLD,
  VENUE_VOLATILITY_THRESHOLD_DEFAULT,
} from "../lib/venueParameters.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 起動時に venues テーブルから取得した90日実績値（キー: 整数の venue_code）
let venueWinRateCache = {};

// export の名は元のまま（RACE_ID_CHUNK_SIZE は predictionRaceFetch.js、processRacersWithScoreFn は predictionScoring.js が持つ）
export { RACE_ID_CHUNK_SIZE };
export { processRacersWithScoreFn } from "../lib/predictionScoring.js";

/** 荒れ度情報（スコア・レベル・推奨モデル・理由・1号艇の平均ST）。展開予測の結果を活用する */
function buildVolatilityInfo(race, turnPrediction, turnPredictionPlayers) {
  const volatilityData = calculateVolatilityScore(
    race.racers,
    race.placeCd,
    turnPrediction,
    turnPredictionPlayers,
    venueWinRateCache,
  );
  const volatilityLevel = getVolatilityLevel(
    volatilityData.score,
    String(race.placeCd).padStart(2, "0"),
  );
  const recommendedModel = getRecommendedModel(volatilityLevel);
  return {
    score: volatilityData.score,
    level: volatilityLevel,
    recommendedModel: recommendedModel,
    reasons: volatilityData.reasons,
    boat1AvgST: volatilityData.boat1AvgST,
  };
}

// 1レース分の予想を生成（3モデル対応）
function generateRacePrediction(race, date, racerStatsMap) {
  if (!race.racers || race.racers.length === 0) {
    console.warn(
      `⚠️  レース ${race.placeCd}-${race.raceNo} の選手データが不足しています`,
    );
    return null;
  }

  // 1マーク展開予測を算出（racer_aggregated_stats のデータを使用）
  // ※ 展開予測ボーナスをスコア計算に反映するため、モデル処理の前に実行する
  const turnPredictionPlayers = buildTurnPredictionPlayers(
    race,
    racerStatsMap,
  );
  const raceConditions = {
    venueCode: race.placeCd,
    windSpeed: race.windVelocity,
    waveHeight: race.waveHeight,
  };
  const turnPrediction = predictFirstMark(
    turnPredictionPlayers,
    raceConditions,
  );

  // 荒れ度スコアを計算（展開予測の結果を活用）
  const volatility = buildVolatilityInfo(
    race,
    turnPrediction,
    turnPredictionPlayers,
  );

  // 3つのモデルで予想を生成（展開予測・展示データを反映）
  const { standardPlayers, safeBetPlayers, upsetFocusPlayers } =
    scoreRacersByModel(race, turnPrediction);

  if (standardPlayers.length === 0) {
    console.warn(
      `⚠️  レース ${race.placeCd}-${race.raceNo} の選手データが不足しています`,
    );
    return null;
  }

  // 展開予測パターンをモデルにマッピングして、3モデルの予想と結果の入れ物を組み立てる
  return assembleRacePrediction(
    race,
    date,
    turnPrediction,
    turnPredictionPlayers,
    volatility,
    { standardPlayers, safeBetPlayers, upsetFocusPlayers },
  );
}

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

/** 各レースの予測を生成する（ログは元の順） */
function generateRefreshPredictions(races, date, racerStatsMap) {
  const allPredictions = [];
  for (const race of races) {
    const prediction = generateRacePrediction(race, date, racerStatsMap);
    if (prediction) {
      allPredictions.push(prediction);
      const exInfo = race.exhibitionData ? `（展示あり）` : `（展示なし）`;
      console.log(
        `  ✅ ${race.placeName} ${race.raceNo}R — 本命: ${prediction.predictions.standard.topPick}号艇 ${exInfo}`,
      );
    } else {
      console.log(`  ❌ ${race.placeName} ${race.raceNo}R — 予測生成失敗`);
    }
  }
  return allPredictions;
}

/**
 * リフレッシュモードのメイン処理
 * オーケストレーターから直接インポートして呼び出し可能
 *
 * @param {Object} params
 * @param {boolean} params.isDryRun
 * @param {string[]|null} [params.specificRaceIds]
 * @param {boolean} [params.forceTouchRaces] trueなら races の volatility 更新を、値の変化に
 *   関わらず全対象レースに行い updated_at を進める（既定はfalse＝変更のあるレースのみ）。
 *   morning-init.js の「予測スクリプトがDB更新後に変更された場合の再生成」判定は
 *   races.updated_at の最大値とスクリプトのコミット時刻を比べているため、再生成後に
 *   updated_at が進まないと（値が変わらず全行スキップされると）毎回再生成が走り続ける。
 *   その再生成経路だけ true を渡す
 * @param {string} [params.date] 対象日（YYYY-MM-DD）。省略時は CLI の --date= 引数、無ければ今日（JST）。
 *   Vercel Function から呼ぶ場合は process.argv に日付が無いため、引数で渡す（BOA-353 T4b-03）
 * @param {"upsert"} [params.writeMode] predictions の書き込み方式。"upsert" のみ（既定）:
 *   (race_id, model_id) の一意制約で1文の upsert にする。予測が空になる瞬間が無く、書き込みに失敗しても
 *   以前の予測が残る（失敗は例外にする）。的中フラグ・払戻・scores は null に戻し、predicted_at は現在時刻。
 *   書くのは standard・safeBet・upsetFocus のみで、unified には触れない。
 *   従来の "replace"（削除→挿入）は廃止した（BOA-628）: is_shadow=false の全モデルを削除するため unified も
 *   消え、次の morning-init.js（ensureUnifiedPredictions）が作り直すまで、発走の瞬間に unified が無いレースが
 *   出ていた（2026年9月、確定分だけで594件）
 * @param {boolean} [params.includeStarted] true なら発走済みのレースも書く（既定 false。BOA-628）。
 *   発走済みのレースを書き直すと、的中フラグ・払戻が消え、発走後のデータで作った予想が発走前の予想に
 *   見える（2026年9月は発走後の作り直しが2,065件）。過去日の作り直し（明示の手動実行）のときだけ true にする
 * @param {import("@supabase/supabase-js").SupabaseClient|null} [params.client] テスト用の差し替え（既定は supabaseClient.js）
 * @param {() => Date} [params.now] テスト用の時刻の差し替え
 * @returns {Promise<{predictedRaceIds: string[], volatilityUpdated: number, writeMode: string}|{volatilityStats: Object}|undefined>}
 */
export async function mainRefresh(params) {
  const {
    isDryRun,
    specificRaceIds,
    forceTouchRaces,
    dateArg,
    writeMode,
    includeStarted,
    client,
    now,
  } = resolveRefreshOptions(params);
  logRefreshStart(isDryRun, now);
  assertRefreshReady(writeMode, client);
  const date = dateArg || parseDateArg() || getTodayDateJST();
  console.log(`📅 対象日: ${date}`);

  // 発走時刻（発走済みのレースを書かないため。読めないときは書かずに例外にする＝予想を上書きしない）
  const schedule = await getRaceSchedule(date, { client, throwOnError: true });

  // 対象 race_ids を決定（発走済みのレースは書かない。BOA-628）
  const targetRaceIds = selectTargetRaceIds(
    schedule,
    specificRaceIds,
    includeStarted,
    now,
  );

  if (targetRaceIds.length === 0) {
    console.log("📭 更新対象レースなし（全ウィンドウ外・発走済み）");
    return;
  }
  console.log(`🎯 更新対象: ${targetRaceIds.length}レース`);

  // Supabase からレースデータを取得
  const races = await fetchRaceDataFromSupabase(targetRaceIds, client);
  if (races.length === 0) {
    console.log("📭 対象レースのデータが未登録（race_entries なし）");
    return;
  }

  // 選手 ID を収集して racer_aggregated_stats を一括取得
  const racerStatsMap = await fetchRacerStats(
    [...collectRacerIds(races)],
    client,
  );

  venueWinRateCache = await fetchVenueWinRates(client);
  logVenueWinRateCount(venueWinRateCache);

  // 各レースの予測を生成
  const allPredictions = generateRefreshPredictions(races, date, racerStatsMap);

  if (allPredictions.length === 0) {
    console.log("📭 更新データなし");
    return;
  }
  if (isDryRun) {
    return refreshDryRun(allPredictions, forceTouchRaces, client);
  }

  // predictions テーブルを更新
  console.log(`\n💾 predictions を更新中...`);
  const updatedRaceIds = allPredictions.map((r) => r.raceId);
  const predictionsData = buildPredictionRows(allPredictions);

  // 削除→挿入の交差・挿入失敗による「予測が空」を作らない。書き込みに失敗したら例外にする
  // （失敗しても、以前の予測は残っている）。unified は削除も更新もしない
  await upsertPredictions(client, predictionsData, now());
  console.log(
    `  ✅ predictions: ${predictionsData.length}件（${allPredictions.length}レース、${writeMode}）`,
  );

  // races テーブルの volatility 項目を更新（イン崩れ指数リフレッシュ）
  // upsert ではなく update を使用し、既存行のみを更新する（NOT NULL 制約エラーを回避）
  const volatilityAt = now().toISOString();
  const {
    toWrite: volatilityToWrite,
    stats: volatilityStats,
    fallback,
  } = await planRacesVolatilityUpdates(allPredictions, forceTouchRaces, client);
  let volatilityUpdated = 0;
  for (const row of volatilityToWrite) {
    const { error } = await updateRaceVolatilityRow(client, row, volatilityAt);
    if (error) {
      logVolatilityUpdateError(row.race_id, error);
    } else {
      volatilityUpdated++;
    }
  }
  console.log(
    `  ✅ ${volatilitySummary(volatilityStats, fallback)} / 更新${volatilityUpdated}件`,
  );

  // Vercel Deploy Hook をトリガー（叩く条件は triggerDeployHook の注）
  await triggerDeployHook(now(), volatilityUpdated);

  console.log("🏁 リフレッシュ完了");
  return { predictedRaceIds: updatedRaceIds, volatilityUpdated, writeMode };
}

/** 1会場のレースの予想を生成して allPredictions へ積む（race に placeName・placeCd を付ける。ログは元の順） */
function generateVenuePredictions(venue, date, racerStatsMap, allPredictions) {
  console.log(`\n📍 ${venue.placeName} (${venue.placeCd})`);

  if (!venue.races || venue.races.length === 0) {
    console.log("  ⚠️  レースデータなし");
    return;
  }

  for (const race of venue.races) {
    // レースデータに場所情報を追加
    race.placeName = venue.placeName;
    race.placeCd = venue.placeCd;

    const prediction = generateRacePrediction(race, date, racerStatsMap);

    if (prediction) {
      allPredictions.push(prediction);
      console.log(
        `  ✅ ${race.raceNo}R - 本命: ${prediction.prediction.topPick}号艇 (信頼度: ${prediction.prediction.confidence}%)`,
      );
    } else {
      console.log(`  ❌ ${race.raceNo}R - 予想生成失敗`);
    }
  }
}

/**
 * レースデータ（data/races.json と同じ形）から、全レースの予想を生成して Supabase へ書き込む（フルモード）。
 * fs にも process.argv にも依存しない（Vercel Function の races-init が、会場ごとに呼ぶ。WS4b T4b-07-2）。
 * CLI の main() は、races.json を読んで、この関数を呼ぶ。
 *
 * @param {Object} params
 * @param {{success?: boolean, data: Object[]}} params.racesData scrape-to-json.js の出力と同じ形
 * @param {string} params.date 予想生成日（YYYY-MM-DD。races の race_date になる）
 * @param {import("@supabase/supabase-js").SupabaseClient|null} [params.client] 既定は supabaseClient.js のクライアント
 * @param {boolean} [params.throwOnError] true（既定。BOA-391）なら、DBへの書き込みの失敗を例外にする。false はログのみ
 * @param {() => Date} [params.now] テスト用の時刻の差し替え
 * @returns {Promise<{predictedRaceIds: string[]}>}
 */
export async function generateAndWriteFromRacesData({
  racesData,
  date,
  client = supabase,
  throwOnError = true,
  now = () => new Date(),
}) {
  if (!racesData?.success || !racesData.data) {
    throw new Error("races.json に有効なデータがありません");
  }

  console.log(`✅ ${racesData.data.length}会場のデータを取得しました`);
  console.log(`📅 予想生成日: ${date}`);

  // 全選手IDを収集して racer_aggregated_stats を一括取得
  const allRacerIds = collectRacerIdsFromVenues(racesData.data);
  const racerStatsMap = await fetchRacerStats([...allRacerIds], client);
  if (racerStatsMap.size > 0) {
    console.log(`📊 ${racerStatsMap.size}人の選手統計を取得しました`);
  }

  venueWinRateCache = await fetchVenueWinRates(client);
  logVenueWinRateCount(venueWinRateCache);

  // 全レースの予想を生成
  const allPredictions = [];
  for (const venue of racesData.data) {
    generateVenuePredictions(venue, date, racerStatsMap, allPredictions);
  }

  console.log(`\n📊 合計 ${allPredictions.length}レースの予想を生成しました`);

  // Supabaseに書き込み
  await writeToSupabase(allPredictions, date, { client, throwOnError, now });

  return { predictedRaceIds: allPredictions.map((p) => p.raceId) };
}

// メイン処理
async function main() {
  try {
    console.log("🚀 AI予想生成を開始します...");

    // data/races.json を読み込み
    const racesPath = path.join(__dirname, "..", "..", "data", "races.json");
    console.log(`📖 レースデータを読み込み中: ${racesPath}`);

    const racesData = JSON.parse(await fs.readFile(racesPath, "utf-8"));

    if (!racesData.success || !racesData.data) {
      throw new Error("races.json に有効なデータがありません");
    }

    // 今日の日付を取得
    const today = getTodayDateJST();

    // races.json の日付が今日と一致するか確認（古いファイルで誤挿入を防ぐ）
    if (racesData.date && racesData.date !== today) {
      throw new Error(
        `races.json の日付 (${racesData.date}) が今日 (${today}) と一致しません。scrape-to-json.js を先に実行してください。`,
      );
    }

    // CLI は morning-init.js の手順2から try なしの execSync で呼ばれる。書き込みの一部が失敗しただけで
    // 例外にすると、morning-init の後続（unified の生成・pcexpect・Deploy Hook）まで止まり、その日は
    // 作り直されない。CLI だけは従来どおりログに出して続行する（Vercel の races-init は true。BOA-391）
    await generateAndWriteFromRacesData({
      racesData,
      date: today,
      // 握りつぶし可（BOA-391）: CLI だけ。morning-init の後続（unified・pcexpect・Deploy Hook）を止めない（上のコメント）
      throwOnError: false,
    });

    console.log("✨ 予想生成が完了しました！");
  } catch (error) {
    console.error("❌ エラーが発生しました:", error);
    process.exit(1);
  }
}

// スタンドアローン実行時のみ実行する（import 時に実行させない）
if (process.argv[1] === __filename) {
  const args = process.argv.slice(2);
  const isRefresh = args.includes("--refresh");
  const isDryRun = args.includes("--dry-run");
  const raceIdsArg = args.find((a) => a.startsWith("--race-ids="));
  const specificRaceIds = raceIdsArg
    ? raceIdsArg.split("=")[1].split(",")
    : null;

  if (isRefresh) {
    mainRefresh({ isDryRun, specificRaceIds }).catch((error) => {
      console.error("❌ エラー:", error);
      process.exit(1);
    });
  } else {
    main();
  }
}
