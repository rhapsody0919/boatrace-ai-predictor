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
 * 選手の直近出走から今節（開催中の会場）のモーター番号を特定し、
 * そのモーターの機力指数・節ごとの推移を取得する（BOA-265）
 * race_idは「YYYY-MM-DD-会場コード-レース番号」形式のため、会場コードは
 * 追加クエリ無しでrace_idから直接取り出せる
 * @param {number|string} racerId
 * @returns {Promise<{ raceId: string, venueCode: number, motorNumber: number, powerIndex: object, trend: object } | null>}
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

  const [powerIndex, trend] = await Promise.all([
    supabaseDataService.getMotorPowerIndex(venueCode, data.motor_number),
    supabaseDataService.getMotorConditionTrend(venueCode, data.motor_number),
  ]);

  return {
    raceId: data.race_id,
    venueCode,
    motorNumber: data.motor_number,
    powerIndex,
    trend,
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
