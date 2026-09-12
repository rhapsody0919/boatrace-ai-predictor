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

async function getRacerProfile(racerId) {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("racer_profiles")
    .select(
      "racer_id, name, name_kana, birth_date, height_cm, weight_kg, blood_type, branch, hometown, registration_period",
    )
    .eq("racer_id", racerId)
    .maybeSingle();
  if (error) throw new Error(`選手プロフィール取得エラー: ${error.message}`);
  return data;
}

async function getLatestGrade(racerId) {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("race_entries")
    .select("grade")
    .eq("racer_id", racerId)
    .order("race_id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`級別取得エラー: ${error.message}`);
  return data?.grade ?? null;
}

async function getRacerNews(racerId) {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("racer_news")
    .select(
      "id, title, summary, source_url, source_name, published_at, created_at",
    )
    .eq("racer_id", racerId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`選手ニュース取得エラー: ${error.message}`);
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
  const [profile, grade, news] = await Promise.all([
    getRacerProfile(racerId),
    getLatestGrade(racerId),
    getRacerNews(racerId),
  ]);
  return { profile, grade, news };
}

/**
 * 選手が直近出走で使用したモーターについて、今節（同一モーターが連続して
 * 割り当てられている直近の連続開催日）の出走一覧を特定する。
 * race_idの日付部分を新しい順に辿り、間が2日以上空いたら節の境目とみなす
 * （モーターは節単位で入れ替わるため、日付の連続性で節の範囲を推定できる）
 */
async function getCurrentMeetRaceEntries(racerId, motorNumber) {
  const { data: entries, error } = await supabase
    .from("race_entries")
    .select("race_id, boat_number")
    .eq("racer_id", racerId)
    .eq("motor_number", motorNumber)
    .order("race_id", { ascending: false })
    .limit(30);

  if (error) {
    console.error("今節の出走取得エラー:", error.message);
    return [];
  }
  if (!entries || entries.length === 0) return [];

  const sorted = [...entries].sort((a, b) =>
    a.race_id.localeCompare(b.race_id),
  );
  const meet = [sorted[sorted.length - 1]];
  for (let i = sorted.length - 2; i >= 0; i--) {
    const currentDate = new Date(meet[0].race_id.slice(0, 10));
    const prevDate = new Date(sorted[i].race_id.slice(0, 10));
    const diffDays = (currentDate - prevDate) / (1000 * 60 * 60 * 24);
    if (diffDays > 2) break;
    meet.unshift(sorted[i]);
  }
  return meet;
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
 * @returns {Promise<{ raceId: string, venueCode: number, motorNumber: number, powerIndex: object, meetTrend: { date: string, exhibition_time: number }[] } | null>}
 */
export async function getRacerCurrentMotorStatus(racerId) {
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("race_entries")
    .select("race_id, motor_number")
    .eq("racer_id", racerId)
    .order("race_id", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("直近出走取得エラー:", error.message);
    return null;
  }
  if (!data || data.motor_number === null || data.motor_number === undefined) {
    return null;
  }

  const parsed = parseRaceId(data.race_id);
  if (!parsed) return null;
  const { venueCode } = parsed;

  const [powerIndex, meetEntries] = await Promise.all([
    supabaseDataService.getMotorPowerIndex(venueCode, data.motor_number),
    getCurrentMeetRaceEntries(racerId, data.motor_number),
  ]);

  const meetRaceIds = meetEntries.map((e) => e.race_id);
  let exhibitionByKey = new Map();
  if (meetRaceIds.length > 0) {
    const { data: exhibitionRows, error: exError } = await supabase
      .from("exhibition_data")
      .select("race_id, boat_number, exhibition_time")
      .in("race_id", meetRaceIds);
    if (exError) {
      console.error("展示タイム取得エラー:", exError.message);
    } else {
      exhibitionByKey = new Map(
        (exhibitionRows ?? []).map((e) => [
          `${e.race_id}-${e.boat_number}`,
          e.exhibition_time,
        ]),
      );
    }
  }

  const meetTrend = meetEntries
    .map((e) => ({
      date: e.race_id.slice(0, 10),
      exhibition_time:
        exhibitionByKey.get(`${e.race_id}-${e.boat_number}`) ?? null,
    }))
    .filter((row) => row.exhibition_time !== null);

  return {
    raceId: data.race_id,
    venueCode,
    motorNumber: data.motor_number,
    powerIndex,
    meetTrend,
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
