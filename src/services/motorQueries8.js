// モーターの推移の線（レーン B、オーナー 2026-11-25 承認のモック改訂2）のための取得。
// このレースの6基の、今の世代（そのレースの日以前で最新の使用開始日から）の走を1走1行で返す
import { supabase } from "./supabaseClient";
import { findBoatColumnIndex, getRacesForVenueSince } from "./motorQueries.js";
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
        .select("race_id, boat_number, motor_number, motor_2rate, motor_3rate, player_name")
        .in("race_id", chunk)
        .in("motor_number", motorNumbers)
        .order("race_id")
        .order("boat_number")
        .range(0, RACE_CHUNK * 6 - 1),
    ),
  );
  return pages.flatMap(({ data }) => data ?? []);
}

/** 会場の、世代の初めからレースの日までに始まった節（吹き出しの期間・グレード） */
async function fetchMeets(venueCode, from, to) {
  const { data } = await supabase
    .from("race_series")
    .select("start_date, end_date, total_days, grade, title")
    .eq("venue_code", venueCode)
    .gte("start_date", from)
    .lte("start_date", to)
    .order("start_date");
  return (data ?? []).map((m) => ({ start: m.start_date, end: m.end_date, days: m.total_days, grade: m.grade, title: m.title }));
}

/**
 * このレースの6基の、今の世代の走（このレースより前）。
 * @param {number} venueCode
 * @param {number[]} motorNumbers
 * @param {string} raceId YYYY-MM-DD-VV-RR（このレースより前の走だけを数える）
 * 走には乗った選手（racerName）と着順（finish。結果が無い・着が付かなければ null）も付ける。meets は会場の節（吹き出し用）
 * @returns {Promise<{generationStart: string|null, meets: Array<{start:string,end:string,days:number|null,grade:string|null,title:string|null}>, runsByMotor: Object<string, Array<{raceId:string,date:string,motor2Rate:number|null,motor3Rate:number|null,exhibitionTime:number|null,racerName:string|null,finish:number|null,finishMark:string|null}>>}>}
 *   generationStart が null なら世代が分からない（推移を描かない）
 */
export function getMotorGenerationRuns(venueCode, motorNumbers, raceId) {
  const motors = [...new Set(motorNumbers.filter((n) => Number.isInteger(n)))].sort((a, b) => a - b);
  return withCache(`motor-generation-runs-v3-${venueCode}-${motors.join("_")}-${raceId}`, async () => {
    const generationStart = await generationStartAsOf(venueCode, raceId);
    const runsByMotor = Object.fromEntries(motors.map((n) => [n, []]));
    if (generationStart === null || motors.length === 0) return { generationStart, meets: [], runsByMotor };
    const [races, meets] = await Promise.all([
      getRacesForVenueSince(venueCode, generationStart, raceId),
      fetchMeets(venueCode, generationStart, raceId.slice(0, 10)),
    ]);
    if (races.length === 0) return { generationStart, meets, runsByMotor };
    const dateById = new Map(races.map((r) => [r.race_id, r.race_date]));
    const entries = await fetchEntries(races.map((r) => r.race_id), motors);
    const runIds = [...new Set(entries.map((e) => e.race_id))];
    const [exhibition, results, marks] = await Promise.all([
      fetchAllByIn("exhibition_data", "race_id, boat_number, exhibition_time", "race_id", runIds),
      fetchAllByIn("race_results", "race_id, rank1, rank2, rank3, rank4, rank5, rank6", "race_id", runIds),
      // 着順が付かない走の公式の記号（F・L・欠・転 等）。着順より先に見る（BOA-576: F でも rank に入ることがある）
      fetchAllByIn("race_start_timings", "race_id, boat_number, finish_mark", "race_id", runIds),
    ]);
    const markByKey = new Map(marks.filter((m) => m.finish_mark).map((m) => [`${m.race_id}-${m.boat_number}`, m.finish_mark]));
    const resultById = new Map(results.map((r) => [r.race_id, r]));
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
          racerName: e.player_name ?? null,
          finish: findBoatColumnIndex(resultById.get(e.race_id), "rank", e.boat_number),
          finishMark: markByKey.get(`${e.race_id}-${e.boat_number}`) ?? null,
        }),
      );
    return { generationStart, meets, runsByMotor };
  });
}
