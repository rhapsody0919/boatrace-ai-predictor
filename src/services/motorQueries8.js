// モーターの推移の線（レーン B、オーナー 2026-11-25 承認のモック改訂2）のための取得。
// このレースの6基の、今の世代（そのレースの日以前で最新の使用開始日から）の走を1走1行で返す
import { supabase } from "./supabaseClient";
import { getRacesForVenueSince } from "./motorQueries.js";
import { chunkArray, fetchAllByIn, isPermissionDeniedError, withCache } from "./core.js";
import { motorGenerationStartAsOf } from "../utils/motorGeneration";

// 1回に in() するレースの数。1レースに6艇なので 150×6=900 行で PostgREST の1000行に届かない
const RACE_CHUNK = 150;

/** レースの日以前で最新の使用開始日。行が無い・匿名に権限が無いときは null。ほかの失敗は例外 */
async function generationStartAsOf(venueCode, raceId) {
  const cached = await withCache(`motor-start-dates-${venueCode}`, async () => {
    try {
      const { data } = await supabase
        .from("venue_motor_start_dates")
        .select("start_date")
        .eq("venue_code", venueCode);
      return { rows: data ?? [] };
    } catch (err) {
      if (isPermissionDeniedError(err)) return { rows: [] };
      throw err;
    }
  });
  return motorGenerationStartAsOf(cached.rows, raceId);
}

async function fetchEntries(raceIds, motorNumbers) {
  const pages = await Promise.all(
    chunkArray(raceIds, RACE_CHUNK).map((chunk) =>
      supabase
        .from("race_entries")
        .select("race_id, boat_number, motor_number, motor_2rate, motor_3rate")
        .in("race_id", chunk)
        .in("motor_number", motorNumbers)
        .order("race_id")
        .order("boat_number")
        .range(0, RACE_CHUNK * 6 - 1),
    ),
  );
  return pages.flatMap(({ data }) => data ?? []);
}

/**
 * このレースの6基の、今の世代の走（このレースより前）。
 * @param {number} venueCode
 * @param {number[]} motorNumbers
 * @param {string} raceId YYYY-MM-DD-VV-RR（このレースより前の走だけを数える）
 * @returns {Promise<{generationStart: string|null, runsByMotor: Object<string, Array<{raceId:string,date:string,motor2Rate:number|null,motor3Rate:number|null,exhibitionTime:number|null}>>}>}
 *   generationStart が null なら世代が分からない（推移を描かない）
 */
export function getMotorGenerationRuns(venueCode, motorNumbers, raceId) {
  const motors = [...new Set(motorNumbers.filter((n) => Number.isInteger(n)))].sort((a, b) => a - b);
  return withCache(`motor-generation-runs-v1-${venueCode}-${motors.join("_")}-${raceId}`, async () => {
    const generationStart = await generationStartAsOf(venueCode, raceId);
    const runsByMotor = Object.fromEntries(motors.map((n) => [n, []]));
    if (generationStart === null || motors.length === 0) return { generationStart, runsByMotor };
    const races = await getRacesForVenueSince(venueCode, generationStart, raceId);
    if (races.length === 0) return { generationStart, runsByMotor };
    const dateById = new Map(races.map((r) => [r.race_id, r.race_date]));
    const entries = await fetchEntries(races.map((r) => r.race_id), motors);
    const exhibition = await fetchAllByIn(
      "exhibition_data",
      "race_id, boat_number, exhibition_time",
      "race_id",
      [...new Set(entries.map((e) => e.race_id))],
    );
    const exByKey = new Map(exhibition.map((x) => [`${x.race_id}-${x.boat_number}`, x.exhibition_time]));
    entries
      .filter((e) => dateById.has(e.race_id) && runsByMotor[e.motor_number])
      .sort((a, b) => a.race_id.localeCompare(b.race_id))
      .forEach((e) =>
        runsByMotor[e.motor_number].push({
          raceId: e.race_id,
          date: dateById.get(e.race_id),
          motor2Rate: e.motor_2rate,
          motor3Rate: e.motor_3rate,
          exhibitionTime: exByKey.get(`${e.race_id}-${e.boat_number}`) ?? null,
        }),
      );
    return { generationStart, runsByMotor };
  });
}
