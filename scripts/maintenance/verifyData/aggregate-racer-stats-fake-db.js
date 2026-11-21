/**
 * aggregate-racer-stats-fake-db.js - 日次の集計 CLI（scripts/analysis/aggregate-racer-stats.js・
 * scripts/daily/calculate-unified-volatility-accuracy.js・scripts/daily/calculate-venue-grade-stats.js）を、本文の字でなく
 * 「偽の DB に何を問い合わせ・何を書いたか」で見るための部品
 * （verify-aggregate-racer-stats.js・verify-volatility-accuracy-heading.js・verify-race-outcome-filters.js）。
 *
 * 3本が import する scripts/lib/supabaseClient.js だけを、この隣の写し aggregate-racer-stats-fake-supabase.js へ差し替える
 * （module.register の resolve hook。他の import は本物のまま。racerStStats.js・unchangedRows.js は client を引数で受けるので、
 * 本物のまま偽の client に問い合わせる）。DB・鍵には繋がない。
 *
 * 使い方:
 *   const db = fakeDb({ tables: { race_entries: [...] }, fail: ["race_results"] });   // 場面を置く
 *   const { runSingleRacer } = await loadAggregateRacerStats();
 *   await runSingleRacer(4203, null, false);
 *   db.queries（{table, method, args} の並び）・db.writes（upsert の {table, rows, options}）
 */
import { register } from "node:module";
// 写しの静的な import。読み込みの差し替えは下の HOOKS（URL）で行うが、verify→verifyData の辿りが静的な相対 import しか見ないため、ここで名指しする
import { SCENE_KEY } from "./aggregate-racer-stats-fake-supabase.js";

const PRODUCTS = [
  new URL("../../analysis/aggregate-racer-stats.js", import.meta.url).href,
  new URL("../../daily/calculate-unified-volatility-accuracy.js", import.meta.url).href,
  new URL("../../daily/calculate-venue-grade-stats.js", import.meta.url).href,
];
const REAL = new URL("../../lib/supabaseClient.js", import.meta.url).href;
const FAKE = new URL("./aggregate-racer-stats-fake-supabase.js", import.meta.url).href;
// 解決の hook（module.register が別の thread で動かす）。製品3本からの supabaseClient.js の import だけを写しへ向ける
const HOOKS = `
const PRODUCTS = new Set(${JSON.stringify(PRODUCTS)});
export async function resolve(specifier, context, next) {
  const resolved = await next(specifier, context);
  return PRODUCTS.has(context.parentURL) && resolved.url === ${JSON.stringify(REAL)}
    ? { url: ${JSON.stringify(FAKE)}, shortCircuit: true }
    : resolved;
}
`;

let registered = false;
function ensureHooks() {
  if (registered) return;
  register(`data:text/javascript,${encodeURIComponent(HOOKS)}`);
  registered = true;
}

/** 場面（表の行・失敗させる表）を置き、問い合わせと書きの記録を返す。写しは globalThis の同じ鍵から場面を読む */
export function fakeDb({ tables = {}, fail = [] } = {}) {
  const scene = { tables, fail: new Set(fail), queries: [], writes: [] };
  globalThis[SCENE_KEY] = scene;
  return scene;
}

/** aggregate-racer-stats.js を、supabaseClient を写しに差し替えて読み込む（import 時に main は走らない: isDirectRun）。
 *  本物の supabaseClient.js（racerStStats.js 等が import する）が鍵の無い環境で出す案内は黙らせる */
export async function loadAggregateRacerStats() {
  ensureHooks();
  return quietly(() => import(PRODUCTS[0]));
}

/** calculate-unified-volatility-accuracy.js を、supabaseClient を写しに差し替えて読み込む */
export async function loadVolatilityAccuracy() {
  ensureHooks();
  return quietly(() => import(PRODUCTS[1]));
}

/** calculate-venue-grade-stats.js を、supabaseClient を写しに差し替えて読み込む（import 時に集計は走らない: isDirectRun） */
export async function loadVenueGradeStats() {
  ensureHooks();
  return quietly(() => import(PRODUCTS[2]));
}

/** 記録のうち、表 table への問い合わせの連なり（from から await まで）を1本ずつにまとめる */
export function chainsOf(scene, table) {
  const chains = [];
  for (const q of scene.queries) {
    if (q.table !== table) continue;
    if (q.method === "from") chains.push([]);
    else chains.at(-1)?.push(q);
  }
  return chains;
}

/** 連なりの中のメソッド名の集合 */
export const methodsOf = (chain) => new Set(chain.map((q) => q.method));

/** console を黙らせて fn を回す（製品の進捗の文を verify の出力に混ぜない）。例外はそのまま投げる */
export async function quietly(fn) {
  const saved = { log: console.log, warn: console.warn, error: console.error };
  console.log = () => {};
  console.warn = () => {};
  console.error = () => {};
  try {
    return await fn();
  } finally {
    Object.assign(console, saved);
  }
}
