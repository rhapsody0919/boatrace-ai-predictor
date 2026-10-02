/**
 * アナロジー・ファインダー（BOA-271）のデータ取得。
 *
 * 寄与度（FR-1）は Edge API（api/analogy/contribution.js、CDN に1日）を先に試し、失敗したら
 * Supabase を直接読む（スライスの選び方は src/utils/analogyContribution.js で API と共有）。
 * supabaseDataService.js には足さない（既に大きい）。キャッシュはメモリだけで、学習前（版が無い）・
 * エラーの結果は残さない（途中の状態を残すと、版ができても出ないままになる。BOA-497 の教訓）。
 * 類似レース（FR-2）の取得は、類似の定義が決まってから足す。
 */
import { supabase } from "./supabaseClient";
import {
  resolveContributionSlice,
  sliceCandidates,
} from "../utils/analogyContribution.js";

const cache = new Map();

const contributionKey = ({ venue, grade, round, target }) =>
  `contribution|${venue}|${grade}|${round}|${target}`;

async function fromApi(params) {
  const q = new URLSearchParams({
    venue: String(params.venue),
    grade: params.grade,
    round: params.round,
    target: String(params.target),
  });
  const res = await fetch(`/api/analogy/contribution?${q}`);
  if (!res.ok) throw new Error(`寄与度の API が HTTP ${res.status}`);
  const body = await res.json();
  if (typeof body.available !== "boolean")
    throw new Error("寄与度の API の応答の形が違う");
  return body;
}

async function fromSupabase(params) {
  if (!supabase) throw new Error("Supabase が未設定");
  const { data: models, error } = await supabase
    .from("analogy_models")
    .select("model_version,trained_at,themes,metrics")
    .eq("is_active", true);
  if (error) throw new Error(`analogy_models: ${error.message}`);
  if (models.length === 0) return { available: false };
  const model = models[0];
  const cands = sliceCandidates(params);
  const uniq = (vals) => [...new Set(vals)];
  const { data: rows, error: rowsError } = await supabase
    .from("analogy_contribution_profiles")
    .select(
      "venue_code,grade,round,boat_number,n_boats,n_races,period_from,period_to,shares,share_sd,breakdown",
    )
    .eq("model_version", model.model_version)
    .eq("finish_target", params.target)
    .in("venue_code", uniq(cands.map((c) => c.venue)))
    .in("grade", uniq(cands.map((c) => c.grade)))
    .in("round", uniq(cands.map((c) => c.round)));
  if (rowsError)
    throw new Error(`analogy_contribution_profiles: ${rowsError.message}`);
  const slice = resolveContributionSlice(rows, params);
  if (!slice)
    throw new Error(
      `版 ${model.model_version} に target=${params.target} の行がありません`,
    );
  return {
    available: true,
    modelVersion: model.model_version,
    trainedAt: model.trained_at,
    themes: model.themes,
    testPeriod: model.metrics?.periods?.test ?? null,
    requested: params,
    ...slice,
  };
}

/**
 * @param {{venue:number, grade:string, round:string, target:1|2|3}} params
 * @returns {Promise<object>} available=false なら学習前（節を出さない）。失敗は例外
 */
export async function getAnalogyContribution(params) {
  const key = contributionKey(params);
  if (cache.has(key)) return cache.get(key);
  let result;
  try {
    result = await fromApi(params);
  } catch (apiError) {
    console.warn(
      "[analogy] 寄与度の API に失敗、Supabase を直接読む:",
      apiError.message,
    );
    result = await fromSupabase(params);
  }
  if (result.available) cache.set(key, result);
  return result;
}
