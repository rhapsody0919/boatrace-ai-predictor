/**
 * アナロジー・ファインダー（BOA-271）のデータ取得。
 *
 * 寄与度（FR-1）は Edge API（api/analogy/contribution.js、CDN に1日）を先に試し、失敗したら
 * Supabase を直接読む（スライスの選び方は src/utils/analogyContribution.js で API と共有）。
 * supabaseDataService.js には足さない（既に大きい）。キャッシュはメモリだけ。エラーは残さない。
 * 学習前（版が無い・テーブル未適用）は、タブを開くたびに問い合わせないよう UNAVAILABLE_TTL_MS だけ覚える
 * （ずっと覚えると、版ができても出ないままになる。BOA-497 の教訓）。
 * 類似レース（FR-2）の取得は、類似の定義が決まってから足す。
 */
import { supabase } from "./supabaseClient";
import {
  DEFAULT_STAGE,
  resolveContributionSlice,
  sliceCandidates,
} from "../utils/analogyContribution.js";

const cache = new Map();
const UNAVAILABLE_TTL_MS = 10 * 60 * 1000;
let unavailableUntil = 0;

const withStage = (params) => ({
  ...params,
  stage: params.stage ?? DEFAULT_STAGE,
});

const contributionKey = ({ venue, grade, round, target, stage }) =>
  `contribution|${stage}|${venue}|${grade}|${round}|${target}`;

async function fromApi(params) {
  const q = new URLSearchParams({
    venue: String(params.venue),
    grade: params.grade,
    round: params.round,
    target: String(params.target),
    stage: params.stage,
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
  let models;
  try {
    ({ data: models } = await supabase
      .from("analogy_models")
      .select("model_version,trained_at,themes,metrics")
      .eq("is_active", true));
  } catch (err) {
    // テーブルがまだ無い（マイグレーション 118 の適用前）は「学習前」と同じく節を出さない。
    // 画面の PR が適用より先に出ても、エラー表示を出さないための保険（getRacePitReport と同じ考え方）
    if (err?.code === "PGRST205" || err?.code === "42P01")
      return { available: false };
    throw err;
  }
  if (models.length === 0) return { available: false };
  const model = models[0];
  const cands = sliceCandidates(params);
  const uniq = (vals) => [...new Set(vals)];
  const { data: rows } = await supabase
    .from("analogy_contribution_profiles")
    .select(
      "venue_code,grade,round,boat_number,n_boats,n_races,period_from,period_to,shares,share_sd,breakdown,frame_ratio",
    )
    .eq("model_version", model.model_version)
    .eq("stage", params.stage)
    .eq("finish_target", params.target)
    .in("venue_code", uniq(cands.map((c) => c.venue)))
    .in("grade", uniq(cands.map((c) => c.grade)))
    .in("round", uniq(cands.map((c) => c.round)));
  const slice = resolveContributionSlice(rows, params);
  // 出走表時点の集計がまだ無い版は「準備中」（api/analogy/contribution.js と同じ）
  if (!slice && params.stage === "racecard" && rows.length === 0)
    return { available: false, stageMissing: true };
  if (!slice)
    throw new Error(
      `版 ${model.model_version} に stage=${params.stage} target=${params.target} の行がありません`,
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
 * @param {{venue:number, grade:string, round:string, target:1|2|3, stage?:"exhibition"|"racecard"}} input
 *   stage は省略時 exhibition（展示後のモデルの集計）
 * @returns {Promise<object>} available=false なら学習前（節を出さない）。失敗は例外
 */
export async function getAnalogyContribution(input) {
  const params = withStage(input);
  const key = contributionKey(params);
  if (cache.has(key)) return cache.get(key);
  // 学習前の判定は版全体についてなので、条件を問わず共有する
  if (Date.now() < unavailableUntil) return { available: false };
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
  // 出走表時点の集計が無いだけ（stageMissing）は、展示後の集計まで止めない
  else if (!result.stageMissing)
    unavailableUntil = Date.now() + UNAVAILABLE_TTL_MS;
  return result;
}

// ---------------------------------------------------------------- v16（BOA-271 T6-3）
// 来る艇の条件・類似レース・展開シナリオの読み出し（api/analogy/{facts,similar,scenario}/[raceId].js、Edge）。
// 応答の status（api/_lib/analogyV16.js の resolveStatus）は時刻で変わる（展示の後に exhibition_ready になる）ので、
// メモリのキャッシュは CDN と同じ 60秒だけ持つ。失敗は残さない（BOA-497）。

const V16_TTL_MS = 60 * 1000;
const v16Cache = new Map();

async function getV16(path) {
  const hit = v16Cache.get(path);
  if (hit && Date.now() - hit.at < V16_TTL_MS) return hit.body;
  const res = await fetch(path);
  if (!res.ok)
    throw new Error(
      `アナロジー・ファインダーの API が HTTP ${res.status}（${path.split("?")[0]}）`,
    );
  const body = await res.json();
  if (typeof body?.status !== "string")
    throw new Error(
      `アナロジー・ファインダーの API の応答の形が違う（${path.split("?")[0]}）`,
    );
  v16Cache.set(path, { at: Date.now(), body });
  return body;
}

const stageQuery = (stage) => `stage=${encodeURIComponent(stage)}`;

/** タブ1（today・facts・exhibition）。stage は racecard|exhibition */
export const getAnalogyFacts = (raceId, stage) =>
  getV16(
    `/api/analogy/facts/${encodeURIComponent(raceId)}?${stageQuery(stage)}`,
  );

/** タブ2（似ている順の上位・層・比べる相手） */
export const getAnalogySimilar = (raceId, stage) =>
  getV16(
    `/api/analogy/similar/${encodeURIComponent(raceId)}?${stageQuery(stage)}`,
  );

/** タブ3（範囲キーの scenario）。scope を省略すると API が既定（VC、300件未満なら NC）を選ぶ */
export const getAnalogyScenario = (raceId, scope, stage) =>
  getV16(
    `/api/analogy/scenario/${encodeURIComponent(raceId)}?${stageQuery(stage)}${
      scope ? `&scope=${encodeURIComponent(scope)}` : ""
    }`,
  );
