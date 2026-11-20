// 予想の入力を Supabase から読む部品（会場の1コース勝率・選手統計・race_id 指定の一括取得・予測用の race オブジェクトへの変換）。
// scripts/daily/generate-predictions.js から元のまま移した（await の位置と順は元のまま）。
import { supabase, VENUE_NAMES } from "./supabaseClient.js";

export async function fetchVenueWinRates(client = supabase) {
  if (!client) return {};
  const { data, error } = await client
    .from("venues")
    .select("code, avg_first_win_rate")
    .not("avg_first_win_rate", "is", null);
  if (error || !data) return {};
  return Object.fromEntries(data.map((v) => [v.code, v.avg_first_win_rate]));
}

/** racer_aggregated_stats の1チャンク分の問い合わせ（await は呼び元。問い合わせをそのまま返す） */
function racerStatsChunkQuery(client, chunk) {
  return client
    .from("racer_aggregated_stats")
    .select(
      "racer_id, avg_st, st_stddev, attack_distribution, defense_distribution, course_race_counts",
    )
    .in("racer_id", chunk)
    .eq("venue_code", 0);
}

// racer_aggregated_stats から選手統計を一括取得
export async function fetchRacerStats(racerIds, client = supabase) {
  if (!client || racerIds.length === 0) return new Map();

  const map = new Map();
  const CHUNK_SIZE = 900; // Supabase .in() の1000件制限内

  for (let i = 0; i < racerIds.length; i += CHUNK_SIZE) {
    const chunk = racerIds.slice(i, i + CHUNK_SIZE);
    const { data, error } = await racerStatsChunkQuery(client, chunk);

    if (error) {
      console.error("racer_aggregated_stats取得エラー:", error.message);
      continue;
    }
    data?.forEach((r) => map.set(r.racer_id, r));
  }

  return map;
}

/**
 * race_id を指定して一括取得する際の、1回あたりの race_id の数。
 * race_entries・exhibition_data は1レース6行のため、100レース=600行で、PostgRESTの
 * 1リクエストあたりの上限（1000行）に収まる（超えると、約166レースを超えた分が黙って欠ける）。
 */
export const RACE_ID_CHUNK_SIZE = 100;

/** race_id の一覧を RACE_ID_CHUNK_SIZE ずつに分けて取得し、全行を連結する。失敗は例外にする */
export async function selectByRaceIds(client, table, columns, raceIds) {
  const chunks = [];
  for (let i = 0; i < raceIds.length; i += RACE_ID_CHUNK_SIZE) {
    chunks.push(raceIds.slice(i, i + RACE_ID_CHUNK_SIZE));
  }
  const results = await Promise.all(
    chunks.map((chunk) =>
      client.from(table).select(columns).in("race_id", chunk),
    ),
  );
  const failed = results.find((result) => result.error);
  // 展示・気象の取得に失敗したまま予測を作ると、入力の欠けた予測で、良い予測を上書きしてしまう
  // （再計算のきっかけが展示の変更のみになる案1では、次の再計算が来ず、そのまま残る）ため、例外にする
  if (failed) throw new Error(`${table}取得エラー: ${failed.error.message}`);
  return results.flatMap((result) => result.data ?? []);
}

/** race_id ごとにグループ化する（行の並びは入力の順） */
export function groupRowsByRaceId(rows) {
  const byRace = new Map();
  for (const row of rows) {
    if (!byRace.has(row.race_id)) byRace.set(row.race_id, []);
    byRace.get(row.race_id).push(row);
  }
  return byRace;
}

/** race_entries → racers 配列（generateRacePrediction が期待する形式）。entries を艇番順に並べ替える */
export function entriesToRacers(entries) {
  return entries
    .sort((a, b) => a.boat_number - b.boat_number)
    .map((e) => ({
      lane: e.boat_number,
      racerId: e.racer_id,
      name: e.player_name,
      grade: e.grade,
      age: e.age,
      globalWinRate: e.win_rate,
      global2Rate: e.global_2rate,
      global3Rate: e.global_3rate,
      localWinRate: e.local_win_rate,
      local2Rate: e.local_2rate,
      local3Rate: e.local_3rate,
      motorNumber: e.motor_number,
      motor2Rate: e.motor_2rate,
      motor3Rate: e.motor_3rate,
      boatNumber: e.boat_number_id,
      boat2Rate: e.boat_2rate,
      boat3Rate: e.boat_3rate,
    }));
}

/** exhibition_data → exhibitionData 配列 */
export function exhibitionRowsToData(rows) {
  return rows.map((ex) => ({
    boatNumber: ex.boat_number,
    exhibitionTime: ex.exhibition_time,
    startTiming: ex.start_timing,
  }));
}

/** 1レース分の DB の行から、generateRacePrediction が期待する race オブジェクトを作る */
export function buildRaceFromRows(raceId, entries, race, cond, exhibitionRows) {
  // race_id から venue_code と race_number を復元（YYYY-MM-DD-VV-RR）
  const parts = raceId.split("-");
  const venueCode = parseInt(parts[3], 10);
  const raceNo = parseInt(parts[4], 10);

  const racers = entriesToRacers(entries);
  const exhibitionData = exhibitionRowsToData(exhibitionRows);

  return {
    raceId,
    placeCd: venueCode,
    placeName: VENUE_NAMES[venueCode] || `会場${venueCode}`,
    raceNo,
    racers,
    exhibitionData: exhibitionData.length > 0 ? exhibitionData : null,
    // 天候情報（race_conditions から）
    weather: cond.weather || null,
    airTemp: cond.temperature ?? null,
    windDirection: null, // race_conditions は文字列保存のため省略（予測スコアに影響しない）
    windVelocity: cond.wind_speed ?? null,
    waterTemp: cond.water_temperature ?? null,
    waveHeight: cond.wave_height ?? null,
    raceGrade: race.race_grade || null,
    raceTitle: cond.race_title || null,
  };
}

/**
 * Supabase から対象レースのデータを取得し、generateRacePrediction が期待する
 * race オブジェクト形式に変換する
 */
export async function fetchRaceDataFromSupabase(raceIds, client = supabase) {
  const [entries, conditions, exhibition, raceRows] = await Promise.all([
    selectByRaceIds(client, "race_entries", "*", raceIds),
    selectByRaceIds(client, "race_conditions", "*", raceIds),
    selectByRaceIds(client, "exhibition_data", "*", raceIds),
    selectByRaceIds(
      client,
      "races",
      "race_id, race_grade, cancellation_status",
      raceIds,
    ),
  ]);

  // race_id ごとにグループ化
  const entriesByRace = groupRowsByRaceId(entries);
  const conditionsByRace = new Map(conditions.map((c) => [c.race_id, c]));
  const exhibitionByRace = groupRowsByRaceId(exhibition);
  const racesByRace = new Map(raceRows.map((r) => [r.race_id, r]));

  const races = [];
  for (const raceId of raceIds) {
    const entries = entriesByRace.get(raceId);
    if (!entries || entries.length === 0) continue;

    const race = racesByRace.get(raceId) || {};
    // 中止・順延が確定/暫定検知済み（cancellation_status が非NULL）のレースは、
    // race_entries が事前スクレイピング済みでも予測を生成しない（BOA-411）。
    // 開催されなかったレースにpredictionsが生成され、is_hit_win等の的中判定が
    // 永遠に未確定のまま残存する不具合の再発防止
    if (race.cancellation_status) {
      console.log(
        `  ⏭️  ${raceId} — 中止・順延検知済み（cancellation_status=${race.cancellation_status}）のため予測生成をスキップ`,
      );
      continue;
    }

    const cond = conditionsByRace.get(raceId) || {};
    races.push(
      buildRaceFromRows(
        raceId,
        entries,
        race,
        cond,
        exhibitionByRace.get(raceId) || [],
      ),
    );
  }
  return races;
}
