/**
 * 選手個別ページ用データ取得サービス
 *
 * racer_profiles・race_entries・racer_news を racer_id で結合して取得する。
 * 級別は racer_profiles.grade_at_scrape ではなく race_entries の最新出走時点の値を使う
 * （docs/adr/0023-racer-grade-freshness.md）。
 */

import { supabase } from "./supabaseClient";
import { supabaseDataService } from "./supabaseDataService";
import { parseRaceId } from "../utils/raceId";
import { groupIntoCurrentMeet } from "../utils/meetGrouping";

async function getRacerProfile(racerId) {
  if (!supabase) return null;
  const { data } = await supabase
    .from("racer_profiles")
    .select(
      "racer_id, name, name_kana, birth_date, height_cm, weight_kg, blood_type, branch, hometown, registration_period",
    )
    .eq("racer_id", racerId)
    .maybeSingle();
  return data;
}

// 最新の出走の級と開催日。開催日はインデックス判定（src/utils/racerIndexPolicy.js）に使う
async function getLatestEntry(racerId) {
  if (!supabase) return { grade: null, raceDate: null };
  const { data } = await supabase
    .from("race_entries")
    .select("grade, race_id")
    .eq("racer_id", racerId)
    .order("race_id", { ascending: false })
    .limit(1)
    .maybeSingle();
  return {
    grade: data?.grade ?? null,
    raceDate: data?.race_id ? (parseRaceId(data.race_id)?.date ?? null) : null,
  };
}

async function getRacerNews(racerId) {
  if (!supabase) return [];
  const { data } = await supabase
    .from("racer_news")
    .select(
      "id, title, summary, source_url, source_name, published_at, created_at",
    )
    .eq("racer_id", racerId)
    .order("created_at", { ascending: false });
  return data ?? [];
}

/**
 * 選手個別ページの表示に必要なデータを一括取得する
 * タイトル・メタ情報に関わるprofile/grade/newsのみを対象にする。
 * 成績・調子セクション（getRacerStats）は表示をブロックしないよう別経路で取得する
 * @param {number|string} racerId
 * @returns {Promise<{ profile: object|null, grade: string|null, news: object[] }>}
 */
export async function getRacerPageData(racerId) {
  const [profile, latestEntry, news] = await Promise.all([
    getRacerProfile(racerId),
    getLatestEntry(racerId),
    getRacerNews(racerId),
  ]);
  return {
    profile,
    grade: latestEntry.grade,
    latestRaceDate: latestEntry.raceDate,
    news,
  };
}

/**
 * 選手が直近出走で使用したモーターについて、今節（直近出走と同じ会場で、同一
 * モーターが連続して割り当てられている直近の連続開催日）の出走一覧を特定する。
 * race_idの日付部分を新しい順に辿り、間が2日以上空いたら節の境目とみなす
 * （モーターは節単位で入れ替わるため、日付の連続性で節の範囲を推定できる）
 */
async function getCurrentMeetRaceEntries(racerId, motorNumber) {
  const { data: entries } = await supabase
    .from("race_entries")
    .select("race_id, boat_number")
    .eq("racer_id", racerId)
    .eq("motor_number", motorNumber)
    .order("race_id", { ascending: false })
    .limit(30);

  if (!entries || entries.length === 0) return [];

  // 最新の走と同じ会場に絞る（BOA-591）。モーター番号は会場ごとに振られるので、
  // 番号だけだと別会場の同じ番号のモーターの節が地続きのときに繋がる
  const venue = entries[0].race_id.slice(11, 13);
  const sorted = entries
    .filter((e) => e.race_id.slice(11, 13) === venue)
    .sort((a, b) => a.race_id.localeCompare(b.race_id));
  return groupIntoCurrentMeet(sorted);
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
 * @returns {Promise<{ raceId: string, venueCode: number, motorNumber: number, powerIndex: object, meetTrend: { date: string, exhibition_time: number }[], latestPartsEvent: { date: string, propellerChanged: boolean, parts: string[]|null } | null, venueMotorStats: object|null } | null>}
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
  const generationStart =
    await supabaseDataService.getMotorGenerationStart(venueCode);
  const preGeneration = generationStart !== null && date < generationStart;
  const [powerIndex, meetEntries, venueMotorStats] = await Promise.all([
    preGeneration
      ? null
      : supabaseDataService.getMotorPowerIndex(venueCode, data.motor_number),
    getCurrentMeetRaceEntries(racerId, data.motor_number),
    preGeneration
      ? null
      : supabaseDataService.getVenueMotorStats(venueCode, data.motor_number),
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
    preGeneration,
  };
}

/**
 * 選手個別ページの成績・調子セクション用データを取得する
 * @param {number|string} racerId
 * @returns {Promise<{ formSummary: object|null, formTrend: object|null, techniqueProfile: object|null, aggregatedStats: object|null, exhibitionTimeTrend: object|null, boatReturnRate: object[], venueStats: object[] }>}
 */
export async function getRacerStats(racerId) {
  const [
    formSummary,
    formTrend,
    techniqueProfile,
    aggregatedStats,
    exhibitionTimeTrend,
    boatReturnRate,
    venueStats,
  ] = await Promise.all([
    supabaseDataService.getRacerFormSummary(racerId),
    supabaseDataService.getRacerFormTrend(racerId),
    supabaseDataService.getRacerTechniqueProfile(racerId),
    supabaseDataService.getRacerAggregatedStats(racerId),
    supabaseDataService.getExhibitionTimeTrend(racerId),
    supabaseDataService.getRacerBoatReturnRate(racerId),
    supabaseDataService.getRacerVenueStats(racerId),
  ]);
  return {
    formSummary,
    formTrend,
    techniqueProfile,
    aggregatedStats,
    exhibitionTimeTrend,
    boatReturnRate,
    venueStats,
  };
}
