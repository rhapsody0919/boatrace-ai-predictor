// src/services/racerService.js から字のまま移した（領域: racer、RA40 BOA-1673）。
// モーターの部分（getRacerCurrentMotorStatus）は領域の向きの規則（domain-direct）で motorQueries7.js へ分けた
/**
 * 選手個別ページ用データ取得サービス
 *
 * racer_profiles・race_entries・racer_news を racer_id で結合して取得する。
 * 級別は racer_profiles.grade_at_scrape ではなく race_entries の最新出走時点の値を使う
 * （docs/adr/0023-racer-grade-freshness.md）。
 */
import { supabase } from "./supabaseClient";
import {
  getRacerAggregatedStats,
  getRacerAllPeriodStats as fetchRacerAllPeriodStats,
  getRacerFormSummary,
  getRacerFormTrend,
  getRacerOfficialAvgSt,
  getRacerTechniqueProfile,
} from "./racerQueries.js";
import { getRacerVenueStats } from "./racerQueries2.js";
import {
  getExhibitionTimeTrend,
  getRacerBoatReturnRate,
} from "./racerQueries3.js";
import { parseRaceId } from "../utils/raceId";
import { makeRacer } from "../pure/racerModel.js";
import { getTodayJST } from "../utils/dateUtils";

async function getRacerProfile(racerId) {
  if (!supabase) return null;
  const { data } = await supabase
    .from("racer_profiles")
    .select(
      "racer_id, name, name_kana, birth_date, height_cm, weight_kg, blood_type, branch, hometown, registration_period",
    )
    .eq("racer_id", racerId)
    .maybeSingle();
  // 不変条件の破れ（RangeError）は呼び手（RacerProfileData.js）の catch で取得失敗と同じ扱い（1回取り直して失敗の画面）
  return data ? makeRacer(data) : null;
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
 * 選手個別ページの成績・調子セクション用データを取得する
 * @param {number|string} racerId
 * @returns {Promise<{ formSummary: object|null, formTrend: object|null, techniqueProfile: object|null, aggregatedStats: object|null, exhibitionTimeTrend: object|null, boatReturnRate: object[], venueStats: object[], officialAvgSt: {period: object|null, avgSt: number|null} }>}
 */
/**
 * 選手ページの公式の期別成績（racer_period_stats の全期）。成績・調子とは別に取り、表示をブロックしない
 * @param {number|string} racerId
 */
export function getRacerAllPeriodStats(racerId) {
  return fetchRacerAllPeriodStats(racerId);
}

export async function getRacerStats(racerId) {
  const [
    formSummary,
    formTrend,
    techniqueProfile,
    aggregatedStats,
    exhibitionTimeTrend,
    boatReturnRate,
    venueStats,
    officialAvgSt,
  ] = await Promise.all([
    getRacerFormSummary(racerId),
    getRacerFormTrend(racerId),
    getRacerTechniqueProfile(racerId),
    getRacerAggregatedStats(racerId),
    getExhibitionTimeTrend(racerId),
    getRacerBoatReturnRate(racerId),
    getRacerVenueStats(racerId),
    // 平均ST（公式）: 今日の公式の出走表と同じ期の値（BOA-815）
    getRacerOfficialAvgSt(racerId, getTodayJST()),
  ]);
  return {
    formSummary,
    formTrend,
    techniqueProfile,
    aggregatedStats,
    exhibitionTimeTrend,
    boatReturnRate,
    venueStats,
    officialAvgSt,
  };
}
