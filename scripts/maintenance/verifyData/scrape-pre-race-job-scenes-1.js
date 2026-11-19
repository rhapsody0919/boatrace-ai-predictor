/**
 * verify-scrape-pre-race-job.js の後半の場面（1/6）。verify ではない。
 * 判定と期待値は分ける前の verify-scrape-pre-race-job.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import * as cheerio from "cheerio";
import { createRaceInfoSlotHandler, runSlotsWithRefresh } from "../../lib/scrapeJobs/preRaceHandlers.js";
import { runScrapeJob } from "../../lib/scrapeJobs/cronWrapper.js";
import { createMemoryStore } from "../../lib/scrapeJobs/testing/memoryStore.js";
import { createDb } from "./scrape-pre-race-job-db.js";

let check, show, LIST_HTML, DATE, RACE, RACE_11, NOW, seedRaces, freshDb, createFetcher, pagesHandler, writeCount, slotOf, runViaWrapper, riHandler;

// ---------------------------------------------------------------------------
// (e) 予測の再計算（案1）
// ---------------------------------------------------------------------------
async function runWithRefresh({ env, slots, run, mode = "live", refresh }) {
  const calls = [];
  const store = createMemoryStore({
    rows: { race_info: { job: "race_info", mode, consecutive_failures: 0 } },
    slots,
  });
  const fetcher = createFetcher(pagesHandler());
  const { status, body } = await runSlotsWithRefresh({
    job: "race_info",
    createHandleSlot: (collector) =>
      createRaceInfoSlotHandler({
        run,
        loadSchedule: async () => [],
        onChanged: collector.onChanged,
      }),
    refresh:
      refresh ??
      (async (args) => {
        calls.push(args);
      }),
    client: freshDb(),
    store,
    env,
    runJob: (options) =>
      runScrapeJob({
        ...options,
        now: () => NOW,
        worker: "test:race_info",
        politeFetch: fetcher,
      }),
  });
  return { status, body, calls, store };
}

const changedRun = (changedIds) => async (races) =>
  races.map((race) => ({
    race_id: race.race_id,
    outcome: "ok",
    rowsWritten: changedIds.includes(race.race_id) ? 1 : 0,
    rowsParsed: 6,
    rowsExpected: 6,
    changed: changedIds.includes(race.race_id),
  }));

export const ENV_ON = { REFRESH_ON_VERCEL: "true" };

// ---------------------------------------------------------------------------
// (f) 展示のモード切り替え
// ---------------------------------------------------------------------------
export function createRes() {
  const res = {
    statusCode: null,
    body: null,
    status(code) {
      res.statusCode = code;
      return res;
    },
    json(body) {
      res.body = body;
      return res;
    },
  };
  return res;
}

export const req = ({ auth = "Bearer secret", ua = "cron-job.org" } = {}) => ({
  headers: { authorization: auth, "user-agent": ua },
  query: {},
});

export const VERCEL_UA = "vercel-cron/1.0";

/** 元の verify の1つの塊 { } を割った 1/2 */
async function scene1() {
  // 日程タブ（.tab2_inner）を落として、ページから日目が読めない状態を作る（実際に本番で起きている状態）
  const LIST_NO_TABS_HTML = (() => {
    const $ = cheerio.load(LIST_HTML);
    $(".tab2_inner").remove();
    return $.html();
  })();
  // 会場23の節。2026-09-16 は開始日 2026-09-14 から数えて3日目。フィクスチャのページは「初日」（1日目）なので、
  // ページと導出がわざと食い違う（ページ優先の検証を兼ねる）
  const SERIES = [
    { venue_code: 23, start_date: "2026-09-14", end_date: "2026-09-18" },
  ];
  const dbWith = (series, extra = {}) =>
    createDb({ tables: { races: seedRaces(), race_series: series }, ...extra });
  const seriesDayOf = (db) =>
    db.state.tables.race_conditions?.find((r) => r.race_id === RACE)
      ?.series_day ?? null;
  const runRaceInfo = ({ db, list = LIST_HTML }) =>
    runViaWrapper({
      job: "race_info",
      createHandleSlot: riHandler,
      rows: {
        race_info: { job: "race_info", mode: "live", consecutive_failures: 0 },
      },
      slots: [slotOf("race_info", RACE, -60)],
      db,
      fetcher: createFetcher(pagesHandler({ list })),
    });
  // 順延・中止のタブの日（BOA-501）: 順延が決まった後に取り直すと、選択中のタブが「順延」になる。
  // 既に入っている日目（当日に見えた「初日」等。公式の成績ファイルとも一致）を null で上書きしない
  const LIST_POSTPONED_HTML = (() => {
    const $ = cheerio.load(LIST_HTML);
    $("li.is-active2 .tab2_inner span").first().text("順延");
    return $.html();
  })();
  {
    const dbKept = dbWith(SERIES);
    dbKept.state.tables.race_conditions = [
      { race_id: RACE, series_day: 1, is_final_day: false },
    ];
    const kept = await runRaceInfo({ db: dbKept, list: LIST_POSTPONED_HTML });
    const keptRow = dbKept.state.tables.race_conditions.find(
      (r) => r.race_id === RACE,
    );
    const dbNew = dbWith(SERIES);
    const fresh = await runRaceInfo({ db: dbNew, list: LIST_POSTPONED_HTML });
    const freshRow = dbNew.state.tables.race_conditions?.find(
      (r) => r.race_id === RACE,
    );
    check(
      "日目（BOA-501）: 選択中のタブが「順延」のページを取り直しても、既に入っている日目（1）と最終日の印を上書きしない（節からの導出3でも埋めない）。行が新規なら日目は入れない。レース名などは更新する",
      keptRow?.series_day === 1 &&
        keptRow?.is_final_day === false &&
        kept.store.completed[0]?.outcome === "ok" &&
        freshRow != null &&
        freshRow.series_day == null &&
        fresh.store.completed[0]?.outcome === "ok",
      show({ keptRow, freshRow }),
    );
  }
  const noTabs = await runRaceInfo({
    db: dbWith(SERIES),
    list: LIST_NO_TABS_HTML,
  });
  check(
    "日目: ページの日程タブが無いとき、節（race_series）の開始日から導いた値で補う（2026-09-16 は 2026-09-14 開始の3日目）",
    seriesDayOf(noTabs.db) === 3 && noTabs.store.completed[0]?.outcome === "ok",
    show({
      seriesDay: seriesDayOf(noTabs.db),
      outcome: noTabs.store.completed[0]?.outcome,
    }),
  );
  const pageWins = await runRaceInfo({ db: dbWith(SERIES) });
  return { LIST_NO_TABS_HTML, SERIES, dbWith, seriesDayOf, runRaceInfo, pageWins };
}

/** 元の verify の1つの塊 { } を割った 2/2 */
async function scene2({ LIST_NO_TABS_HTML, SERIES, dbWith, seriesDayOf, runRaceInfo, pageWins }) {
  check(
    "日目: ページから読めた値は、節からの導出と食い違っても優先する（順延・中止で節の日程がずれると、導出が進みすぎる）",
    seriesDayOf(pageWins.db) === 1,
    show({ seriesDay: seriesDayOf(pageWins.db) }),
  );
  const noSeries = await runRaceInfo({
    db: dbWith([]),
    list: LIST_NO_TABS_HTML,
  });
  check(
    "日目: 節が無い会場×日は、従来どおり NULL のままにする（勝手な値を入れない）",
    seriesDayOf(noSeries.db) === null &&
      noSeries.store.completed[0]?.outcome === "ok",
    show({
      seriesDay: seriesDayOf(noSeries.db),
      outcome: noSeries.store.completed[0]?.outcome,
    }),
  );
  const seriesDown = await runRaceInfo({
    db: dbWith(SERIES, {
      failSelect: { race_series: { code: "57014", message: "DB down" } },
    }),
    list: LIST_NO_TABS_HTML,
  });
  check(
    "日目: 節を読めなくても、レース情報の更新そのものは止めない（日目だけ NULL のまま完了する）",
    seriesDown.store.completed[0]?.outcome === "ok" &&
      writeCount(seriesDown.db) > 0 &&
      seriesDayOf(seriesDown.db) === null,
    show({
      outcome: seriesDown.store.completed[0]?.outcome,
      seriesDay: seriesDayOf(seriesDown.db),
    }),
  );
  const twoSlots = await runViaWrapper({
    job: "race_info",
    createHandleSlot: riHandler,
    rows: {
      race_info: { job: "race_info", mode: "live", consecutive_failures: 0 },
    },
    slots: [slotOf("race_info", RACE, -60), slotOf("race_info", RACE_11, -60)],
    db: dbWith(SERIES),
  });
  const seriesReads = twoSlots.db.state.selects.filter(
    (x) => x.table === "race_series",
  );
  check(
    "日目: 1回の起動で処理した2スロットが、節（race_series）を1回だけ読む（スロットごとに読むと1起動で最大24回になる）",
    twoSlots.store.completed.length === 2 && seriesReads.length === 1,
    show({
      completed: twoSlots.store.completed.length,
      seriesReads: seriesReads.length,
    }),
  );
}

/** 元の verify の1つの塊 { } を割った 1/2 */
async function scene3() {
  const slots = [
    slotOf("race_info", RACE, -60),
    slotOf("race_info", RACE_11, -60),
    slotOf("race_info", "2026-09-16-23-10", -60),
  ];
  const on = await runWithRefresh({
    env: ENV_ON,
    slots,
    run: changedRun([RACE, RACE_11]),
  });
  check(
    "案1: REFRESH_ON_VERCEL=true で、変更を書いたレース（2件。変更なしの1件は含めない）について、全スロットの完了後に mainRefresh を1回だけ呼ぶ（upsert方式）",
    on.calls.length === 1 &&
      on.calls[0].date === DATE &&
      on.calls[0].writeMode === "upsert" &&
      on.calls[0].isDryRun === false &&
      [...on.calls[0].specificRaceIds].sort().join() ===
        [RACE_11, RACE].sort().join() &&
      on.body.refresh?.[0]?.refreshed === true &&
      on.store.completed.length === 3,
    show({ calls: on.calls, refresh: on.body.refresh }),
  );
  const off = await runWithRefresh({
    env: {},
    slots,
    run: changedRun([RACE]),
  });
  check(
    "案1: REFRESH_ON_VERCEL が有効でなければ、再計算しない（現行動作）。理由が応答に残る",
    off.calls.length === 0 && off.body.refresh?.[0]?.refreshed === false,
    show(off.body.refresh),
  );
  const none = await runWithRefresh({
    env: ENV_ON,
    slots,
    run: changedRun([]),
  });
  check(
    "案1: 変更を書いたレースが無ければ、再計算しない（応答にも refresh を付けない）",
    none.calls.length === 0 && !("refresh" in none.body),
    show(none.body),
  );
  const shadow = await runWithRefresh({
    env: ENV_ON,
    slots,
    mode: "shadow",
    run: changedRun([RACE]),
  });
  check(
    "案1: shadow は、変更を書かないため、再計算しない",
    shadow.calls.length === 0 && !("refresh" in shadow.body),
    show(shadow.body),
  );
  const failing = await runWithRefresh({
    env: ENV_ON,
    slots,
    run: changedRun([RACE]),
    refresh: async () => {
      throw new Error("mainRefresh が失敗");
    },
  });
  return { slots, failing };
}

/** 元の verify の1つの塊 { } を割った 2/2 */
async function scene4({ slots, failing }) {
  check(
    "案1: 再計算の失敗は、投げずに応答（refresh[].error）に残す。データの取得・保存は完了済みのため、HTTPは失敗にしない",
    failing.status === 200 &&
      /mainRefresh が失敗/.test(failing.body.refresh?.[0]?.error ?? "") &&
      failing.store.completed.length === 3,
    show(failing.body),
  );
  // 変異検証用: 変更の有無に依らず、常に変更ありとして通知する版
  const mutantRun = (changedIds) => async (races) =>
    (await changedRun(changedIds)(races)).map((r) => ({ ...r, changed: true }));
  const mutant = await runWithRefresh({
    env: ENV_ON,
    slots,
    run: mutantRun([]),
  });
  check(
    "変異検証: 「変更なしでも、変更ありとして通知する」版では、再計算が呼ばれ、上の検証（変更なしは再計算しない）が失敗する",
    mutant.calls.length === 1 &&
      !(mutant.calls.length === 0 && !("refresh" in mutant.body)),
    show(mutant.calls),
  );
}

async function scene5() {
  {
    const s1 = await scene1();
    await scene2(s1);
  }
  {
    const s1 = await scene3();
    await scene4(s1);
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・show・LIST_HTML・DATE・RACE・RACE_11・NOW・seedRaces・freshDb・createFetcher・pagesHandler・writeCount・slotOf・runViaWrapper・riHandler） */
export async function runScrapePreRaceJobScenes1(env) {
  ({ check, show, LIST_HTML, DATE, RACE, RACE_11, NOW, seedRaces, freshDb, createFetcher, pagesHandler, writeCount, slotOf, runViaWrapper, riHandler } = env);
  await scene5();
}
