/**
 * Vercel Edge Function: アナロジー・ファインダーの寄与度（BOA-271 FR-1）
 *
 * GET /api/analogy/contribution?venue=&grade=&round=&target=
 *   venue  0〜24（0=全会場、省略時0）
 *   grade  all|ippan|G3|G2|G1|SG（省略時 all）
 *   round  all|yosen|junyu|yusho|other（省略時 all）
 *   target 1|2|3（1着／2着以内／3着以内、省略時1）
 *
 * is_active の版の themes と、該当スライスの行（全艇と艇番1〜6）を返す。レース数が30未満のスライスは
 * 「会場→全会場」「ラウンド→全ラウンド」「グレード→全グレード」の順に一段ずつ広げ、広げた段を返す
 * （src/utils/analogyContribution.js。画面の直読みの経路と同じ規則）。
 * データは週1回の学習（train-analogy.yml）でしか変わらないので CDN に1日置く。
 * is_active の版が無い（学習前）・エラーの応答はキャッシュさせない。
 */
import {
  FINISH_TARGETS,
  GRADES,
  ROUNDS,
  resolveContributionSlice,
  sliceCandidates,
} from "../../src/utils/analogyContribution.js";

export const config = { runtime: "edge" };

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY =
  process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

const CORS = { "Access-Control-Allow-Origin": "*" };

const json = (body, status, cache) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": cache,
      ...CORS,
    },
  });

export function parseParams(searchParams) {
  const venue = Number(searchParams.get("venue") ?? 0);
  const grade = searchParams.get("grade") || "all";
  const round = searchParams.get("round") || "all";
  const target = Number(searchParams.get("target") ?? 1);
  if (!Number.isInteger(venue) || venue < 0 || venue > 24)
    throw new RangeError("venue は 0〜24");
  if (grade !== "all" && !GRADES.includes(grade))
    throw new RangeError(`grade は all|${GRADES.join("|")}`);
  if (round !== "all" && !ROUNDS.includes(round))
    throw new RangeError(`round は all|${ROUNDS.join("|")}`);
  if (!FINISH_TARGETS.includes(target)) throw new RangeError("target は 1|2|3");
  return { venue, grade, round, target };
}

async function rest(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  if (!res.ok)
    throw new Error(`Supabase ${path.split("?")[0]}: HTTP ${res.status}`);
  return res.json();
}

export default async function handler(req) {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: { ...CORS, "Access-Control-Allow-Methods": "GET, OPTIONS" },
    });
  }
  let params;
  try {
    params = parseParams(new URL(req.url).searchParams);
  } catch (e) {
    return json({ error: e.message }, 400, "no-store");
  }
  try {
    const models = await rest(
      "analogy_models?select=model_version,trained_at,themes,metrics->periods&is_active=is.true",
    );
    if (models.length === 0) return json({ available: false }, 200, "no-store");
    const model = models[0];
    const cands = sliceCandidates(params);
    const inList = (vals) => `in.(${[...new Set(vals)].join(",")})`;
    const rows = await rest(
      "analogy_contribution_profiles?select=venue_code,grade,round,boat_number,n_boats,n_races,period_from,period_to,shares,share_sd,breakdown" +
        `&model_version=eq.${encodeURIComponent(model.model_version)}` +
        `&finish_target=eq.${params.target}` +
        `&venue_code=${inList(cands.map((c) => c.venue))}` +
        `&grade=${inList(cands.map((c) => c.grade))}` +
        `&round=${inList(cands.map((c) => c.round))}`,
    );
    const slice = resolveContributionSlice(rows, params);
    if (!slice) {
      // 全会場・全グレード・全ラウンドの行すら無いのは学習の書き込みの異常
      throw new Error(
        `版 ${model.model_version} に target=${params.target} の行がありません`,
      );
    }
    return json(
      {
        available: true,
        modelVersion: model.model_version,
        trainedAt: model.trained_at,
        themes: model.themes,
        testPeriod: model.periods?.test ?? null,
        requested: params,
        ...slice,
      },
      200,
      "s-maxage=86400, stale-while-revalidate=3600",
    );
  } catch (error) {
    console.error("analogy contribution error:", error);
    return json({ error: error.message }, 500, "no-store");
  }
}
