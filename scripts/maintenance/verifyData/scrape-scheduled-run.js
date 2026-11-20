/**
 * scrape-scheduled-run.js - scripts/daily/scrape-scheduled.js（import で main が動く入口）を、取得・DB・再計算・肩代わりの判定を偽に
 * 差し替えて1回回す（verify の部品）。本文の字は読まず、どの取得をどの引数で呼んだか・再計算の対象・ログで見る。
 *
 * 差し替えるのは scrape-scheduled.js の直の import のうち SWAPPED の本だけ（importProbe.js、偽は scrape-scheduled-fakes.js）。
 * predictionRefresh.js・dateUtils.js と窓の判定は本物。DB・公式・GitHub には繋がない。
 *
 * 使い方:
 *   const r = await runScheduled({ env: { SKIP_ODDS_ON_GHA: "true" }, races: [raceAt("A", 30)], updated: { odds: UPDATED } });
 *   r.ran("odds")（run の引数の並び）・r.refreshes（mainRefresh の引数）・r.gateVars・r.logs・r.warns・r.exitCode
 */
import { fakeOf, probeImport } from "./importProbe.js";
// 偽の本は ?m= を付けて読み込む（下の FAKES）。ここの静的な import は verify から辿れるようにするだけ（中身は使わない）
import "./scrape-scheduled-fakes.js";

const KEY = Symbol.for("verify.scrapeScheduled");
const SCHEDULED = import.meta.resolve("../../daily/scrape-scheduled.js");
const FAKES = import.meta.resolve("./scrape-scheduled-fakes.js");
const SWAPPED = {
  supabase: import.meta.resolve("../../lib/supabaseClient.js"),
  schedule: import.meta.resolve("../../lib/raceSchedule.js"),
  gate: import.meta.resolve("../../lib/ghaSkipGate.js"),
  raceInfo: import.meta.resolve("../../daily/update-race-info.js"),
  odds: import.meta.resolve("../../daily/scrape-odds.js"),
  exhibition: import.meta.resolve("../../daily/scrape-exhibition-data.js"),
  results: import.meta.resolve("../../daily/scrape-results.js"),
  predictions: import.meta.resolve("../../daily/generate-predictions.js"),
  predictionOdds: import.meta.resolve("../../daily/scrape-prediction-odds.js"),
};
/** scrape-scheduled.js が読む切り替えの変数（回ごとに全部消してから opts.env を入れる） */
export const SKIP_VARS = [
  "SKIP_ODDS_ON_GHA",
  "SKIP_ODDS_REFRESH_ON_GHA",
  "SKIP_RACE_INFO_ON_GHA",
  "SKIP_EXHIBITION_ON_GHA",
  "SKIP_RESULTS_ON_GHA",
  "SKIP_KFILE_ON_GHA",
];
export const UPDATED = { updated: true, count: 1 };

/** 今から minutesBefore 分後に発走するレース（負なら発走済み）。窓の判定は本物の getRacesInWindow 等が今の時刻で行う */
export const raceAt = (race_id, minutesBefore) => ({
  race_id,
  start_time: new Date(Date.now() + minutesBefore * 60_000),
});

const flush = () => new Promise((resolve) => setImmediate(resolve));

/**
 * @param {Object} opts
 * @param {Record<string, string>} [opts.env] 切り替えの変数（SKIP_VARS の内）
 * @param {Array} [opts.races] getRaceSchedule の戻り
 * @param {Record<string, {updated: boolean, count: number}>} [opts.updated] 取得の run の戻り（名は SWAPPED の鍵）
 * @param {Record<string, boolean>} [opts.gate] 肩代わりの判定の skip（変数名ごと。既定 true）
 * @param {boolean} [opts.fetchStopped] 取得の非常停止
 */
export async function runScheduled({
  env = {},
  races = [],
  updated = {},
  gate = {},
  fetchStopped = false,
} = {}) {
  const saved = Object.fromEntries(SKIP_VARS.map((k) => [k, process.env[k]]));
  const out = { calls: [], logs: [], warns: [], errors: [], exitCode: null };
  globalThis[KEY] = { calls: out.calls, races, updated, gate, fetchStopped };
  const io = {
    log: console.log,
    warn: console.warn,
    error: console.error,
    exit: process.exit,
  };
  const text = (args) => args.map(String).join(" ");
  console.log = (...a) => out.logs.push(text(a));
  console.warn = (...a) => out.warns.push(text(a));
  console.error = (...a) => out.errors.push(text(a));
  process.exit = (code) => {
    out.exitCode = code ?? 0;
  };
  for (const k of SKIP_VARS) delete process.env[k];
  Object.assign(process.env, env);
  try {
    await probeImport(SCHEDULED, (n) =>
      Object.fromEntries(
        Object.entries(SWAPPED).map(([name, real]) => [
          real,
          fakeOf(FAKES, name, n),
        ]),
      ),
    );
    // main は import の後に動く（偽はすぐ解決するので、次の macrotask までに終わる）
    for (let i = 0; i < 5; i += 1) await flush();
  } finally {
    Object.assign(console, { log: io.log, warn: io.warn, error: io.error });
    process.exit = io.exit;
    for (const k of SKIP_VARS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
  const of = (m, name) =>
    out.calls.filter((c) => c.m === m && c.name === name).map((c) => c.args);
  return {
    ...out,
    ran: (m) => of(m, "run"),
    refreshes: of("predictions", "mainRefresh"),
    gateVars: of("gate", "shouldSkipOnGha").map((a) => a[0]),
    finished: out.logs.some((l) => l.includes("オーケストレーター完了")),
  };
}
