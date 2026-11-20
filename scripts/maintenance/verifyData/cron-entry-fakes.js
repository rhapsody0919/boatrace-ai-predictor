/**
 * cron-entry-fakes.js - cron-entry-probe.js が api/cron の入口・preRaceHandlers.js の import の代わりに渡す偽（verify の部品）。
 * ?m=<名> ごとに別の本。読み込まれたこと（loaded）と、作り手の関数の呼び出し（made: 名・引数・戻したハンドラー）・runScrapeJob の引数（jobs）を
 * globalThis の記録（cron-entry-probe.js が回ごとに作る）へ積む。ハンドラーは呼ばない（DB・取得先に繋がない）。
 */
const M = new URL(import.meta.url).searchParams.get("m");
const record = () => globalThis[Symbol.for("verify.cronEntry")];
record().loaded.push(M);

const maker = (name) =>
  function made(...args) {
    const handler = async () => {
      throw new Error(`${name} の偽のハンドラーは呼ばない`);
    };
    record().made.push({ m: M, name, args, handler });
    return handler;
  };

// scripts/lib/scrapeJobs/predictionOddsHandlers.js・preRaceHandlers.js の作り手
export const createOddsCronHandlerWithPredictionOdds = maker(
  "createOddsCronHandlerWithPredictionOdds",
);
export const createRefreshingCronHandler = maker("createRefreshingCronHandler");
export const createRaceInfoSlotHandler = maker("createRaceInfoSlotHandler");
export const createExhibitionCronHandler = maker("createExhibitionCronHandler");

export const createOddsSlotHandler = maker("createOddsSlotHandler");

// scripts/lib/scrapeJobs/cronWrapper.js（共通ラッパ。runScrapeJob へ渡した引数を記録し、成功の応答を返す）
export const isAuthorized = () => true;
export const createCronFetchContext = () => ({
  breaker: "fake-breaker",
  politeFetch: "fake-politeFetch",
  finish: async () => {},
});
export async function runScrapeJob(options) {
  record().jobs.push(options);
  return { status: 200, body: { success: true } };
}

// scripts/daily/generate-predictions.js（予測の再計算）
export async function mainRefresh(...args) {
  record().refreshes.push(args);
}

// scripts/lib/scrapeJobs/store.js（展示のジョブ状態だけを返す）
export function createSupabaseStore(client) {
  return {
    client,
    readState: async (job) => ({
      available: true,
      row: { job, mode: record().mode },
    }),
  };
}
