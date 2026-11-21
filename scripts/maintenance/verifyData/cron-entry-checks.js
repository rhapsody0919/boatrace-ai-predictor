/**
 * cron-entry-checks.js - api/cron の入口（odds・race-info・exhibition）と、その本体（predictionOddsHandlers.js・preRaceHandlers.js）の配線、
 * check-pre-race-shadow.js の読み取りのみの確かめ（verify の部品）。本文の字は読まず、cron-entry-probe.js・shadow-check-reads.js で
 * import を偽に差し替えて読み込み・呼び出し、作り手へ渡した引数・読み込まれた本・client に呼んだ method で見る。
 * check は呼ぶ verify の check(label, pass, detail)。
 */
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
