/**
 * cron-entry-probe.js - api/cron の入口と scripts/lib/scrapeJobs/preRaceHandlers.js の配線を、本文の字でなく、import の差し替えで見る（verify の部品）。
 *
 * cronEntry(file): api/cron/{file}.js を、本体（preRaceHandlers.js・predictionOddsHandlers.js）と予測の再計算（generate-predictions.js）を
 *   偽（cron-entry-fakes.js）にして新しく読み込み、config・default と、作り手の呼び出し（made）・読み込まれた偽（loaded）を返す。
 *   入口が generate-predictions.js を直に import すれば loaded に predictions が出る。
 * preRaceRefresh(): preRaceHandlers.js を、generate-predictions.js・scrape-exhibition-data.js・store.js を偽にして新しく読み込み、
 *   読み込みの直後の loaded と、展示のハンドラー（mode=live・Vercel Cron の起動）が渡す既定の refresh を1回呼んだ後の loaded・再計算の引数を返す。
 * oddsWiring(): predictionOddsHandlers.js を、共通ラッパ（cronWrapper.js）・オッズのスロットのハンドラー（oddsHandlers.js）・store.js を偽にして
 *   新しく読み込み、createOddsCronHandlerWithPredictionOdds() の既定のハンドラーを1回呼んで、runScrapeJob へ渡した引数と作られたスロットのハンドラーを返す。
 * DB・取得先には繋がない（ハンドラーの本体は runSlots の偽で置き換える）。
 */
import { fakeOf, probeImport } from "./importProbe.js";

const KEY = Symbol.for("verify.cronEntry");
const FAKES = import.meta.resolve("./cron-entry-fakes.js");
const PRE_RACE = import.meta.resolve("../../lib/scrapeJobs/preRaceHandlers.js");
const PREDICTION_ODDS = import.meta
  .resolve("../../lib/scrapeJobs/predictionOddsHandlers.js");
const GENERATE = import.meta.resolve("../../daily/generate-predictions.js");
const LEGACY_EXHIBITION = import.meta
  .resolve("../../daily/scrape-exhibition-data.js");
const STORE = import.meta.resolve("../../lib/scrapeJobs/store.js");
const WRAPPER = import.meta.resolve("../../lib/scrapeJobs/cronWrapper.js");
const ODDS_SLOT = import.meta.resolve("../../lib/scrapeJobs/oddsHandlers.js");
const ENTRY = (file) => import.meta.resolve(`../../../api/cron/${file}.js`);

const fresh = (mode = "live") => {
  globalThis[KEY] = { loaded: [], made: [], jobs: [], refreshes: [], mode };
  return globalThis[KEY];
};

export async function cronEntry(file) {
  const rec = fresh();
  const mod = await probeImport(ENTRY(file), (n) => ({
    [PRE_RACE]: fakeOf(FAKES, "preRaceHandlers", n),
    [PREDICTION_ODDS]: fakeOf(FAKES, "predictionOddsHandlers", n),
    [GENERATE]: fakeOf(FAKES, "predictions", n),
  }));
  return {
    config: mod.config,
    handler: mod.default,
    made: rec.made,
    loaded: [...rec.loaded].sort(),
  };
}

export async function preRaceRefresh(args) {
  const rec = fresh("live");
  const mod = await probeImport(PRE_RACE, (n) => ({
    [GENERATE]: fakeOf(FAKES, "predictions", n),
    [LEGACY_EXHIBITION]: fakeOf(FAKES, "legacyExhibition", n),
    [STORE]: fakeOf(FAKES, "store", n),
  }));
  const loadedAtImport = [...rec.loaded].sort();
  let passed = null;
  const handler = mod.createExhibitionCronHandler({
    getClient: async () => ({ fake: true }),
    runSlots: async (opts) => {
      passed = opts;
      await opts.refresh(args);
      return { status: 200, body: { success: true } };
    },
    defer: () => {
      throw new Error("Vercel Cron の起動は defer しない");
    },
    env: { CRON_SECRET: "s" },
  });
  const res = fakeRes();
  await handler(
    { headers: { authorization: "Bearer s", "user-agent": "vercel-cron/1.0" } },
    res,
  );
  return {
    module: mod,
    loadedAtImport,
    loadedAfter: [...rec.loaded].sort(),
    refreshes: rec.refreshes,
    job: passed?.job,
    status: res.statusCode,
  };
}

const fakeRes = () => ({
  statusCode: 0,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});

export async function oddsWiring() {
  const rec = fresh();
  const mod = await probeImport(PREDICTION_ODDS, (n) => ({
    [WRAPPER]: fakeOf(FAKES, "cronWrapper", n),
    [ODDS_SLOT]: fakeOf(FAKES, "oddsHandlers", n),
    [STORE]: fakeOf(FAKES, "store", n),
  }));
  const handler = mod.createOddsCronHandlerWithPredictionOdds({
    getClient: async () => ({ fake: true }),
  });
  const res = fakeRes();
  await handler({ headers: { authorization: "Bearer s" }, query: {} }, res);
  return {
    jobs: rec.jobs,
    slotHandlers: rec.made.filter((m) => m.name === "createOddsSlotHandler"),
    status: res.statusCode,
  };
}
