/**
 * 予想の生成と再計算の本体（generateAndWriteFromRacesData・mainRefresh）。scripts/daily/generate-predictions.js から字のまま下ろした物
 * （scripts/lib から入口の scripts/daily を読まない、lib-no-entry）。入口 generate-predictions.js は同じ名で再 export する。
 * 読み手: scripts/lib/racesInit/job.js・scripts/lib/scrapeJobs/preRaceHandlers.js（動的 import）、入口 generate-predictions.js。
 * 会場の90日実績のキャッシュ（venueWinRateCache）を書く関数と読む関数はこのファイルに置く（別のモジュールからは代入できない）。
 */
import { supabase } from "./supabaseClient.js";
import { getTodayDateJST, parseDateArg } from "./dateUtils.js";
import { getRaceSchedule } from "./raceSchedule.js";
import {
  buildPredictionRows,
  upsertPredictions,
} from "./predictionWriteRows.js";
import {
  calculateVolatilityScore,
  getRecommendedModel,
  getVolatilityLevel,
} from "./predictionVolatility.js";
import { scoreRacersByModel } from "./predictionScoring.js";
import {
  assembleRacePrediction,
  buildTurnPredictionPlayers,
} from "./predictionRaceBuild.js";
import {
  fetchRaceDataFromSupabase,
  fetchRacerStats,
  fetchVenueWinRates,
} from "./predictionRaceFetch.js";
import {
  assertRefreshReady,
  collectRacerIds,
  collectRacerIdsFromVenues,
  logRefreshStart,
  logVenueWinRateCount,
  logVolatilityUpdateError,
  resolveRefreshOptions,
  selectTargetRaceIds,
  triggerDeployHook,
  updateRaceVolatilityRow,
  volatilitySummary,
} from "./predictionRefreshSteps.js";
import { predictFirstMark } from "./turnPrediction.js";
import {
  writeToSupabase,
  planRacesVolatilityUpdates,
  refreshDryRun,
} from "./predictionWriteSteps.js";

// 起動時に venues テーブルから取得した90日実績値（キー: 整数の venue_code）
let venueWinRateCache = {};

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
