/**
 * cron-entry-checks.js - api/cron の入口（odds・race-info・exhibition）と、その本体（predictionOddsHandlers.js・preRaceHandlers.js）の配線、
 * check-pre-race-shadow.js の読み取りのみの確かめ（verify の部品）。本文の字は読まず、cron-entry-probe.js・shadow-check-reads.js で
 * import を偽に差し替えて読み込み・呼び出し、作り手へ渡した引数・読み込まれた本・client に呼んだ method で見る。
 * check は呼ぶ verify の check(label, pass, detail)。
 */
import { runSlotsWithRefresh } from "../../lib/scrapeJobs/preRaceHandlers.js";
import { SCRAPE_JOBS } from "../../lib/scrapeJobs/registry.js";
import { cronEntry, oddsWiring, preRaceRefresh } from "./cron-entry-probe.js";
import { shadowCheckCalls } from "./shadow-check-reads.js";

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const brief = (e) => ({
  config: e.config,
  loaded: e.loaded,
  made: e.made.map((m) => ({ name: m.name, args: m.args })),
});

/** api/cron/odds.js と、その本体 createOddsCronHandlerWithPredictionOdds の配線 */
export async function checkOddsEntry({ check, show }) {
  const def = SCRAPE_JOBS.odds;
  const e = await cronEntry("odds");
  check(
    "api/cron/odds.js: config.maxDuration がレジストリ（odds.maxDurationSec）と同じ",
    e.config?.maxDuration === def.maxDurationSec,
    `${e.config?.maxDuration} / ${def.maxDurationSec}`,
  );
  check(
    "api/cron/odds.js: prediction_odds の導出フック込みのハンドラー（createOddsCronHandlerWithPredictionOdds）を引数なし（waitUntil 等を渡さない）で1回作り、それを default export にする",
    same(
      e.made.map((m) => [m.name, m.args]),
      [["createOddsCronHandlerWithPredictionOdds", []]],
    ) &&
      e.handler === e.made[0].handler &&
      same(e.loaded, ["predictionOddsHandlers"]),
    show(brief(e)),
  );
  const w = await oddsWiring();
  const job = w.jobs[0];
  check(
    "predictionOddsHandlers.js: createOddsCronHandlerWithPredictionOdds の既定は、runScrapeJob に job='odds'・レジストリの odds・createOddsSlotHandler で作った handleSlot・モードのゲートを渡す",
    w.status === 200 &&
      w.jobs.length === 1 &&
      job.job === "odds" &&
      job.definition === def &&
      job.modeGated === true &&
      w.slotHandlers.length === 1 &&
      job.handleSlot === w.slotHandlers[0].handler &&
      typeof w.slotHandlers[0].args[0]?.onChanged === "function",
    show({ status: w.status, jobs: w.jobs.map((j) => j.job) }),
  );
}

/** api/cron/race-info.js・exhibition.js の maxDuration と配線 */
export async function checkPreRaceEntries({ check, show }) {
  for (const [job, file] of [
    ["race_info", "race-info"],
    ["exhibition", "exhibition"],
  ]) {
    const e = await cronEntry(file);
    check(
      `api/cron/${file}.js: config.maxDuration がレジストリ（${job}.maxDurationSec）と同じ`,
      e.config?.maxDuration === SCRAPE_JOBS[job].maxDurationSec,
      `${e.config?.maxDuration} / ${SCRAPE_JOBS[job].maxDurationSec}`,
    );
  }
  await raceInfoEntry({ check, show });
  await exhibitionEntry({ check, show });
}

async function raceInfoEntry({ check, show }) {
  const ri = await cronEntry("race-info");
  const opts = ri.made[0]?.args[0] ?? {};
  const collector = { onChanged: () => {} };
  const slot = opts.createHandleSlot?.(collector);
  const slotMade = ri.made.find((m) => m.name === "createRaceInfoSlotHandler");
  check(
    "api/cron/race-info.js: createRefreshingCronHandler を job='race_info' だけ（waitUntil 等を渡さない）で1回作って default export にし、スロットは createRaceInfoSlotHandler に集める側の onChanged を渡す",
    ri.made[0]?.name === "createRefreshingCronHandler" &&
      same(Object.keys(opts).sort(), ["createHandleSlot", "job"]) &&
      opts.job === "race_info" &&
      ri.handler === ri.made[0].handler &&
      slotMade !== undefined &&
      slot === slotMade.handler &&
      slotMade.args[0]?.onChanged === collector.onChanged,
    show(brief(ri)),
  );
}

async function exhibitionEntry({ check, show }) {
  const ex = await cronEntry("exhibition");
  check(
    "api/cron/exhibition.js: createExhibitionCronHandler を引数なしで1回作り、default export にする",
    same(
      ex.made.map((m) => [m.name, m.args]),
      [["createExhibitionCronHandler", []]],
    ) && ex.handler === ex.made[0].handler,
    show(brief(ex)),
  );
}

/** 展示の従来の経路（素の fetch で beforeinfo を叩く runLegacyExhibition）が消えている */
export async function checkNoLegacyExhibition({ check, show }) {
  const p = await preRaceRefresh({ isDryRun: false, specificRaceIds: [] });
  check(
    "従来の経路（素の fetch で beforeinfo を叩く runLegacyExhibition）が消えている: export も、scrape-exhibition-data.js の import も無い",
    !("runLegacyExhibition" in p.module) &&
      !p.loadedAfter.includes("legacyExhibition"),
    show({ loadedAtImport: p.loadedAtImport, loadedAfter: p.loadedAfter }),
  );
}

/** 予測の再計算の配線（preRaceHandlers.js は再計算を有効なときだけ読み込む・全スロットの後に1回・入口は再計算を静的に import しない） */
export async function checkRefreshWiring({ check, show }) {
  const args = { isDryRun: false, specificRaceIds: ["2026-09-19-05-01"] };
  const p = await preRaceRefresh(args);
  check(
    "preRaceHandlers.js: generate-predictions.js（mainRefresh）と従来の展示（scrape-exhibition-data.js）を静的に import しない。展示のハンドラーの既定の refresh が呼ばれたときだけ generate-predictions.js を読み込み、その mainRefresh に引数をそのまま渡す。従来の経路（runLegacyExhibition）の export も無い",
    same(p.loadedAtImport, ["store"]) &&
      same(p.loadedAfter, ["predictions", "store"]) &&
      same(p.refreshes, [[args]]) &&
      p.job === "exhibition" &&
      p.status === 200 &&
      !("runLegacyExhibition" in p.module),
    show({ ...p, module: undefined }),
  );
  for (const file of ["exhibition", "race-info"]) {
    const e = await cronEntry(file);
    check(
      `api/cron/${file}.js: 本体は preRaceHandlers.js の作り手で、generate-predictions.js（mainRefresh）を静的に import しない`,
      same(e.loaded, ["preRaceHandlers"]) && e.made[0]?.m === "preRaceHandlers",
      show(brief(e)),
    );
  }
  // スロットの経路: 全スロットの完了（runJob の戻り）の後に、変更を書いたレースを日付ごとに1回だけ再計算する
  const order = [];
  const refresh = async (a) => {
    order.push(["refresh", a.date, [...a.specificRaceIds].sort()]);
  };
  const runJob = async ({ handleSlot }) => {
    order.push(["job-start"]);
    await handleSlot("2026-09-19", "2026-09-19-05-02");
    await handleSlot("2026-09-19", "2026-09-19-05-01");
    order.push(["job-end"]);
    return { status: 200, body: { success: true } };
  };
  const createHandleSlot = (collector) => async (date, raceId) =>
    collector.onChanged(date, raceId);
  // refreshAfterChange の案内のログ（🤖 予測の再計算）は verify の出力に混ぜない
  const run = async (env) => {
    const log = console.log;
    console.log = () => {};
    try {
      return await runSlotsWithRefresh({
        job: "race_info",
        createHandleSlot,
        refresh,
        client: null,
        runJob,
        store: {},
        env,
      });
    } finally {
      console.log = log;
    }
  };
  const on = await run({ REFRESH_ON_VERCEL: "true" });
  check(
    "preRaceHandlers.js: スロットの経路は、全スロットの完了の後に、変更を書いたレースについて1回だけ refreshAfterChange（REFRESH_ON_VERCEL=true のとき mainRefresh）を呼ぶ",
    same(order, [
      ["job-start"],
      ["job-end"],
      ["refresh", "2026-09-19", ["2026-09-19-05-01", "2026-09-19-05-02"]],
    ]) && on.body.refresh?.[0]?.refreshed === true,
    show({ order, body: on.body }),
  );
  order.length = 0;
  const off = await run({});
  check(
    "preRaceHandlers.js: REFRESH_ON_VERCEL が無ければ、変更を書いても再計算しない",
    same(order, [["job-start"], ["job-end"]]) &&
      off.body.refresh?.[0]?.refreshed === false,
    show({ order, body: off.body }),
  );
}

const READ_METHODS = new Set([
  "from",
  "select",
  "eq",
  "gte",
  "lte",
  "order",
  "range",
  "in",
]);

/** check-pre-race-shadow.js は読み取りのみ（client に insert・update・upsert・delete・rpc を呼ばない） */
export async function checkShadowReadOnly({ check, show }) {
  // 窓の内の offset（展示の -60 は体重だけの窓で、一致率の比べの外）
  for (const [job, table, offset] of [
    ["race_info", "race_entries", -60],
    ["exhibition", "exhibition_data", -33],
  ]) {
    const slot = {
      race_id: "2026-10-01-05-01",
      race_date: "2026-10-01",
      offset_min: offset,
      status: "done",
      attempts: 1,
      outcome: "ok",
      run_mode: "shadow",
      rows_written: 0,
      first_attempt_at: "2026-10-01T00:00:00Z",
      done_at: "2026-10-01T00:30:00Z",
      result_digest: "digest",
      last_error: null,
      races: { start_time: "10:30:00", cancellation_status: null },
    };
    const r = await shadowCheckCalls(job, [slot]);
    const methods = [...new Set(r.calls.map((c) => c.method))].sort();
    const tables = [...new Set(r.calls.map((c) => c.table))];
    check(
      `check-pre-race-shadow（${job}）: 読み取りのみ（呼ぶ method は from・select・eq・gte・lte・order・range・in だけで、insert・update・upsert・delete・rpc を呼ばない）。shadow の完了の比べで ${table} まで読む`,
      r.clients.length === 1 &&
        r.exitCode === null &&
        methods.every((m) => READ_METHODS.has(m)) &&
        tables.includes("scrape_slots") &&
        tables.includes(table),
      show({ methods, tables, exitCode: r.exitCode, errors: r.errors }),
    );
  }
}
