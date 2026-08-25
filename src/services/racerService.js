/**
 * 選手個別ページ用データ取得サービス
 *
 * racer_profiles・race_entries・racer_news を racer_id で結合して取得する。
 * 級別は racer_profiles.grade_at_scrape ではなく race_entries の最新出走時点の値を使う
 * （docs/adr/0023-racer-grade-freshness.md）。
 */

import { supabase } from "./supabaseClient";

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
