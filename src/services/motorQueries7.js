// src/services/racerService.js から字のまま移した（領域: motor、RA40 BOA-1673）。
// 選手個別ページの今節のモーター（getRacerCurrentMotorStatus）と、それだけが使う節の日程の取得
import { supabase } from "./supabaseClient";
import { getMotorGenerationStart } from "./motorQueries.js";
import { getMotorPowerIndex } from "./motorQueries2.js";
import { getVenueMotorStats } from "./motorQueries3.js";
import { parseRaceId } from "../utils/raceId";
import { fetchCurrentMeetRaceEntries } from "./currentMeetEntries";
import { getTodayJST } from "../utils/dateUtils";

/**
 * レースが属する節（race_series）の日程を返す。中止で順延した節があるので、
 * 節が終わったかは日付の連続性ではなく race_series.end_date で決める（BOA-1182）。
 * 節の行が無ければ null。クエリの失敗は supabase クライアントが例外にする
 * @param {number} venueCode
 * @param {string} raceDate YYYY-MM-DD
 * @returns {Promise<{ start_date: string, end_date: string } | null>}
 */
async function getSeriesOfRace(venueCode, raceDate) {
  const { data } = await supabase
    .from("race_series")
    .select("start_date,end_date")
    .eq("venue_code", venueCode)
    .lte("start_date", raceDate)
    .gte("end_date", raceDate)
    .order("start_date", { ascending: false })
    .limit(1);
  return data?.[0] ?? null;
}

/**
 * 選手の直近出走から今節（開催中の会場）のモーター番号を特定し、
 * そのモーターの機力指数（通算・他選手も含む実績との比較）と、
 * この選手自身が今節このモーターに乗ってからの展示タイム推移を取得する（BOA-265）
 * モーターの2連率/3連率そのものは複数選手の実績が混ざった値のため、
 * 選手ページでは「この選手が今節使い始めてからの推移」のみに絞る
 * （モーター単体の通算成績は分析ツール「モーター調子」タブの役割とする）
 * race_idは「YYYY-MM-DD-会場コード-レース番号」形式のため、会場コードは
 * 追加クエリ無しでrace_idから直接取り出せる
 * @param {number|string} racerId
 * @returns {Promise<{ raceId: string, venueCode: number, motorNumber: number, powerIndex: object, meetTrend: { date: string, exhibition_time: number }[], latestPartsEvent: { date: string, propellerChanged: boolean, parts: string[]|null } | null, venueMotorStats: object|null, preGeneration: boolean, meetEnded: boolean|null } | null>}
 */
export async function getRacerCurrentMotorStatus(racerId) {
  if (!supabase) return null;

  const { data } = await supabase
    .from("race_entries")
    .select("race_id, motor_number")
    .eq("racer_id", racerId)
    .order("race_id", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data || data.motor_number === null || data.motor_number === undefined) {
    return null;
  }

  const parsed = parseRaceId(data.race_id);
  if (!parsed) return null;
  const { venueCode, date } = parsed;

  // 直近出走が、その会場のモーター入れ替えより前なら、そのモーターは今の同じ
  // 番号のモーターとは別物。機力指数・公式成績（どちらも現行世代の値）は出さない
  // （BOA-329。長期休養明け等で直近出走が数ヶ月前のことがある）
  const generationStart = await getMotorGenerationStart(venueCode);
  const preGeneration = generationStart !== null && date < generationStart;
  const [powerIndex, meetEntries, venueMotorStats, series] = await Promise.all([
    preGeneration ? null : getMotorPowerIndex(venueCode, data.motor_number),
    fetchCurrentMeetRaceEntries(supabase, racerId, data.motor_number),
    preGeneration ? null : getVenueMotorStats(venueCode, data.motor_number),
    preGeneration ? null : getSeriesOfRace(venueCode, date),
  ]);

  const meetRaceIds = meetEntries.map((e) => e.race_id);
  let exhibitionByKey = new Map();
  if (meetRaceIds.length > 0) {
    const { data: exhibitionRows } = await supabase
      .from("exhibition_data")
      .select(
        "race_id, boat_number, exhibition_time, propeller_change, parts_changed",
      )
      .in("race_id", meetRaceIds);
    exhibitionByKey = new Map(
      (exhibitionRows ?? []).map((e) => [`${e.race_id}-${e.boat_number}`, e]),
    );
  }

  const meetTrend = meetEntries
    .map((e) => ({
      date: e.race_id.slice(0, 10),
      raceNo: Number(e.race_id.slice(-2)),
      exhibition_time:
        exhibitionByKey.get(`${e.race_id}-${e.boat_number}`)?.exhibition_time ??
        null,
    }))
    .filter((row) => row.exhibition_time !== null);

  // 今節（このモーター使用開始後）の部品交換・プロペラ交換のうち直近1件（BOA-221）
  const latestPartsEvent =
    [...meetEntries]
      .sort((a, b) => b.race_id.localeCompare(a.race_id))
      .map((e) => {
        const row = exhibitionByKey.get(`${e.race_id}-${e.boat_number}`);
        return {
          date: e.race_id.slice(0, 10),
          propellerChanged: !!row?.propeller_change,
          parts: row?.parts_changed ?? null,
        };
      })
      .find((ev) => ev.propellerChanged || (ev.parts && ev.parts.length > 0)) ??
    null;

  return {
    raceId: data.race_id,
    date,
    venueCode,
    motorNumber: data.motor_number,
    powerIndex,
    meetTrend,
    latestPartsEvent,
    venueMotorStats,
    // 直近出走の節が終わっているか（BOA-1182）。race_series.end_date が JST の今日より前。
    // 節の行が引けなければ null（終わったかどうか分からない。壁時計の推定はしない）
    meetEnded: series ? series.end_date < getTodayJST() : null,
    preGeneration,
  };
}
