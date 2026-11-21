/**
 * scrape-scheduled-fakes.js - scrape-scheduled-run.js が scripts/daily/scrape-scheduled.js の import の代わりに渡す偽（verify の部品）。
 * ?m=<名> ごとに別の本（取得の run・予測の再計算・Supabase の有無・スケジュール・肩代わりの判定）。
 * 呼び出しは globalThis の記録（runScheduled が回ごとに作る）へ積む。窓の判定（getRacesInWindow 等）と ODDS_WINDOWS は本物。
 */
export {
  getRacesInWindow,
  getRacesAfterStart,
  getRacesBeforeStart,
} from "../../lib/raceSchedule.js";
export { ODDS_WINDOWS } from "../../daily/scrape-odds.js";

const M = new URL(import.meta.url).searchParams.get("m");
const record = () => globalThis[Symbol.for("verify.scrapeScheduled")];
const called = (name, args) => {
  const r = record();
  r.calls.push({ m: M, name, args });
  return r;
};

/** 取得の run（レース情報・オッズ・展示・結果・買い目オッズ）。戻りは回の updated[名]（既定は更新なし） */
export const run = async (...args) =>
  called("run", args).updated[M] ?? { updated: false, count: 0 };
export const mainRefresh = async (...args) => {
  called("mainRefresh", args);
};
export const isSupabaseEnabled = () => true;
export const getRaceSchedule = async (...args) =>
  called("getRaceSchedule", args).races;
export const isGhaFetchStopped = async () => ({
  stopped: record().fetchStopped,
});
/** 肩代わりの判定。回の gate[変数名]（既定は skip＝Vercel が健全で GitHub は取らない） */
export const shouldSkipOnGha = async ({ varName }) => ({
  skip: called("shouldSkipOnGha", [varName]).gate[varName] ?? true,
});
