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
 *   const status = await runDaily(DAILY.topStart, { entry: "argv" });   // DAILY の6本（下の runDaily）
 */
import { register } from "node:module";
import { fileURLToPath } from "node:url";
// 写しの静的な import。読み込みの差し替えは下の HOOKS（URL）で行うが、verify→verifyData の辿りが静的な相対 import しか見ないため、ここで名指しする
import { SCENE_KEY } from "./aggregate-racer-stats-fake-supabase.js";

/** 不成立の条件 NOT_NO_RACE_FILTER に置き換えた6本（verify-race-outcome-filters.js の (d)） */
export const DAILY = {
  exhibitionTimeTop: new URL("../../daily/update-exhibition-time-top-stats.js", import.meta.url).href,
  losingTechnique: new URL("../../daily/update-losing-technique-stats.js", import.meta.url).href,
  nigeOutcome: new URL("../../daily/update-nige-outcome-distribution.js", import.meta.url).href,
  outcome: new URL("../../daily/update-outcome-distribution.js", import.meta.url).href,
  topStart: new URL("../../daily/update-top-start-stats.js", import.meta.url).href,
  winningTechnique: new URL("../../daily/update-winning-technique-stats.js", import.meta.url).href,
};
const PRODUCTS = [
  new URL("../../analysis/aggregate-racer-stats.js", import.meta.url).href,
  new URL("../../daily/calculate-unified-volatility-accuracy.js", import.meta.url).href,
  new URL("../../daily/calculate-venue-grade-stats.js", import.meta.url).href,
  ...Object.values(DAILY),
];
const REAL = new URL("../../lib/supabaseClient.js", import.meta.url).href;
const FAKE = new URL("./aggregate-racer-stats-fake-supabase.js", import.meta.url).href;
// 解決の hook（module.register が別の thread で動かす）。製品（3本と DAILY の6本）からの supabaseClient.js の import だけを写しへ向ける
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

const SETTLE_ROUNDS = 20; // 目安（根拠なし）。偽の client の Promise は1回の macrotask の前に流れ切る。多めに空ける
const settle = async () => {
  for (let i = 0; i < SETTLE_ROUNDS; i++) await new Promise((r) => setImmediate(r));
};

/**
 * DAILY の1本を、先に置いた fakeDb の場面で1回回し、終了の値（0 = 正常、他 = 失敗）を返す。問い合わせは場面の記録に残る。
 * CLI の入口が3つの形に分かれるので、その形 entry で回す（読み込みは1つの process で1回。製品は変えない）:
 *   "export" … run 関数（名前 run）を export する物（isDirectRun の CLI）: その関数を呼ぶ
 *   "argv"   … `node <path>` の時だけ main を回し、main を export しない物: 読み込む間だけ process.argv[1] をその本にする
 *   "import" … 読み込むと main を回す物
 * argv・import の main は待てないので、読み込んだ後に macrotask を数回空けて終わりを待つ（偽の client は Promise だけで、時計を使わない）。
 * その間の process.exit は記録だけにする（失敗で verify ごと落ちず、終了の値として返す）
 */
export async function runDaily(url, { entry, run } = {}) {
  ensureHooks();
  const savedExit = process.exit;
  const savedArgv1 = process.argv[1];
  let status = 0;
  process.exit = (code = 0) => {
    status = code;
  };
  const go = async () => {
    if (entry === "argv") process.argv[1] = fileURLToPath(url);
    const mod = await import(url);
    process.argv[1] = savedArgv1;
    if (entry === "export") await mod[run]();
    else await settle();
  };
  try {
    const failed = await quietly(go).then(
      () => false,
      () => true,
    );
    return failed ? 1 : status;
  } finally {
    process.exit = savedExit;
    process.argv[1] = savedArgv1;
  }
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
