/**
 * series-points-hypotheses-run.js - 分析の1回物の本 scripts/analysis/series-points-scoring-hypotheses.mjs を、
 * 本文の字でなく「偽の DB の行を渡して回し、出した表」で見るための部品（verify-absent-start-rows.js の (d)）。verify ではない。
 *
 * 本が import する scripts/lib/supabaseClient.js だけを、隣の写し series-points-hypotheses-fake-supabase.js へ差し替える
 * （module.register の resolve hook。他の import は本物のまま）。本は import の時に取得と集計を回し console.log に表を出すので、
 * 場面を置いてから1回だけ import し、出した行を集めて返す。DB・鍵・ネットには繋がない。
 */
import { register } from "node:module";
// 写しの静的な import。差し替えは下の HOOKS（URL）で行うが、verify→verifyData の辿りが静的な相対 import しか見ないため、ここで名指しする
import { SCENE_KEY } from "./series-points-hypotheses-fake-supabase.js";

const PRODUCT = new URL(
  "../../analysis/series-points-scoring-hypotheses.mjs",
  import.meta.url,
).href;
const REAL = new URL("../../lib/supabaseClient.js", import.meta.url).href;
const FAKE = new URL(
  "./series-points-hypotheses-fake-supabase.js",
  import.meta.url,
).href;
const HOOKS = `
export async function resolve(specifier, context, next) {
  const resolved = await next(specifier, context);
  return context.parentURL === ${JSON.stringify(PRODUCT)} && resolved.url === ${JSON.stringify(REAL)}
    ? { url: ${JSON.stringify(FAKE)}, shortCircuit: true }
    : resolved;
}
`;

/**
 * 表の行（tables: {race_conditions, race_entries, race_results, race_start_timings, racer_series_points}）を置いて本を1回回す。
 * @returns {Promise<{lines: string[], selects: Array<{table: string, select: string}>}>} 本が console.log に出した行と、問い合わせた列
 */
export async function runSeriesPointsHypotheses(tables) {
  const scene = { tables, selects: [] };
  globalThis[SCENE_KEY] = scene;
  register(`data:text/javascript,${encodeURIComponent(HOOKS)}`);
  const lines = [];
  const saved = console.log;
  console.log = (...args) => lines.push(...args.join(" ").split("\n"));
  try {
    await import(PRODUCT);
  } finally {
    console.log = saved;
  }
  return { lines, selects: scene.selects };
}
