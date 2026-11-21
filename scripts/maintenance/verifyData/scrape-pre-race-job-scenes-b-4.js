/**
 * verify-scrape-pre-race-job.js の後半の場面（4/4）。verify ではない。
 * 判定と期待値は分ける前の verify-scrape-pre-race-job.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { createScheduleLoader } from "../../lib/scrapeJobs/preRaceHandlers.js";
import * as preRaceHandlersModule from "../../lib/scrapeJobs/preRaceHandlers.js";
import { checkNoLegacyExhibition } from "./cron-entry-checks.js";
import { runScrapePreRaceJobScenes1 } from "./scrape-pre-race-job-scenes-1.js";
import { runScrapePreRaceJobScenes2, runScrapePreRaceJobScenes3 } from "./scrape-pre-race-job-scenes-2.js";
import { runScrapePreRaceJobScenes4 } from "./scrape-pre-race-job-scenes-3.js";
import { runScrapePreRaceJobScenes5 } from "./scrape-pre-race-job-scenes-4.js";
import { runScrapePreRaceJobScenes6 } from "./scrape-pre-race-job-scenes-5.js";
import { runScrapePreRaceJobScenes7, runScrapePreRaceJobScenes8 } from "./scrape-pre-race-job-scenes-6.js";
import { riHandler, exHandler } from "./scrape-pre-race-job-scenes-b-3.js";
import { raceInfoShadowWritesNothing, raceInfoFetchesOnlyRacelist, exhibitionShadowWritesNothing } from "./scrape-pre-race-job-scenes-b-1.js";

let printOut, check, show, LIST_HTML, BEFORE_UNPUBLISHED_HTML, BEFORE_AFTER_START_HTML, DATE, SUMI_RACE, RACE, RACE_11, NOW, seedRaces, freshDb, createFetcher, pagesHandler, upsertsOf, writeCount, slotOf, runViaWrapper;

/** 元の verify の1つの塊 { } を割った 1/2 */
async function sprjb4Scene1() {
  // 選手0人・展示未公開は、完了にせず再試行に戻す
  const noEntries = await runViaWrapper({
    job: "race_info",
    createHandleSlot: riHandler,
    rows: {
      race_info: { job: "race_info", mode: "live", consecutive_failures: 0 },
    },
    slots: [slotOf("race_info", RACE, -60)],
    fetcher: createFetcher(pagesHandler({ list: "<html></html>" })),
  });
  check(
    "ラッパ A1: 選手0人（no_values）は、完了にせず、再試行に戻す",
    noEntries.store.completed.length === 0 &&
      noEntries.store.retried[0]?.outcome === "no_values",
    show(noEntries.store.retried),
  );
  const unpublished = await runViaWrapper({
    job: "exhibition",
    createHandleSlot: exHandler,
    rows: {
      exhibition: { job: "exhibition", mode: "live", consecutive_failures: 0 },
    },
    slots: [slotOf("exhibition", RACE, -33)],
    fetcher: createFetcher(pagesHandler({ before: BEFORE_UNPUBLISHED_HTML })),
  });
  check(
    // BOA-500 以降、展示航走前のページは当日体重・調整重量を書くため partial になる。
    // 完了にせず再試行に戻す、という予定表の扱いは変わらない
    "ラッパ A2: 展示タイムが未公開（partial）は、完了にせず、再試行に戻す",
    unpublished.store.completed.length === 0 &&
      unpublished.store.retried[0]?.outcome === "partial",
    show(unpublished.store.retried),
  );
  const already = await runViaWrapper({
    job: "exhibition",
    createHandleSlot: exHandler,
    rows: {
      exhibition: { job: "exhibition", mode: "live", consecutive_failures: 0 },
    },
    slots: [slotOf("exhibition", RACE, -33)],
    db: (() => {
      const db = freshDb();
      db.state.tables.exhibition_data = [
        {
          race_id: RACE,
          boat_number: 2,
          exhibition_time: 6.9,
          start_timing: 0.15,
        },
      ];
      return db;
    })(),
  });
  check(
    "ラッパ A2: 展示タイムが取得済みなら、取得せずに完了する（skipped_have_data）",
    already.fetcher.calls.length === 0 &&
      already.store.completed[0]?.outcome === "skipped_have_data",
    show(already.store.completed),
  );
  // 1回の起動で、スケジュール（races の start_time）を1回だけ読む
  const two = await runViaWrapper({
    job: "exhibition",
    createHandleSlot: exHandler,
    rows: {
      exhibition: { job: "exhibition", mode: "live", consecutive_failures: 0 },
    },
    slots: [
      slotOf("exhibition", RACE, -33),
      slotOf("exhibition", RACE_11, -33),
    ],
  });
  const scheduleReads = two.db.state.selects.filter(
    (s) => s.table === "races" && s.columns === "race_id, start_time",
  );
  return { two, scheduleReads };
}

/** 元の verify の1つの塊 { } を割った 2/2 */
async function sprjb4Scene2({ two, scheduleReads }) {
  check(
    "ラッパ: 1回の起動で処理した2スロットが、スケジュール（races の start_time）を1回だけ読む",
    two.store.completed.length === 2 && scheduleReads.length === 1,
    show({
      completed: two.store.completed.length,
      scheduleReads: scheduleReads.length,
    }),
  );
  const loader = createScheduleLoader({
    load: async () => {
      throw new Error("DB down");
    },
  });
  const ctx = {};
  const failure = await loader(ctx, DATE).then(
    () => "",
    (e) => e.message,
  );
  const failureAgain = await loader(ctx, DATE).then(
    () => "",
    (e) => e.message,
  );
  check(
    "スケジュールの読み取りの失敗は、例外にして覚えない（次のスロットがもう一度試す。「対象なし」に化けさせない）",
    failure === "DB down" && failureAgain === "DB down",
  );
}

async function sprjb4Scene3() {
  {
    const s1 = await sprjb4Scene1();
    await sprjb4Scene2(s1);
  }
  // ---- 後半の場面（verifyData/scrape-pre-race-job-scenes-1.js・scrape-pre-race-job-scenes-2.js） ----
  await runScrapePreRaceJobScenes1({ check, show, LIST_HTML, DATE, RACE, RACE_11, NOW, seedRaces, freshDb, createFetcher, pagesHandler, writeCount, slotOf, runViaWrapper, riHandler });
  await runScrapePreRaceJobScenes2({ check, show, BEFORE_AFTER_START_HTML, SUMI_RACE, NOW, freshDb, createFetcher, pagesHandler });
  // ---------------------------------------------------------------------------
  // (g) 従来の経路（runLegacyExhibition）が消えている（P0）
  // ---------------------------------------------------------------------------
  {
    check(
      "従来の経路の export（runLegacyExhibition）が preRaceHandlers.js に無い",
      !("runLegacyExhibition" in preRaceHandlersModule),
    );
    await checkNoLegacyExhibition({ check, show });
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（printOut・check・show・LIST_HTML・BEFORE_UNPUBLISHED_HTML・BEFORE_AFTER_START_HTML・DATE・SUMI_RACE・RACE・RACE_11・NOW・seedRaces・freshDb・createFetcher・pagesHandler・upsertsOf・writeCount・slotOf・runViaWrapper） */
export async function runScrapePreRaceJobScenesB5(env) {
  ({ printOut, check, show, LIST_HTML, BEFORE_UNPUBLISHED_HTML, BEFORE_AFTER_START_HTML, DATE, SUMI_RACE, RACE, RACE_11, NOW, seedRaces, freshDb, createFetcher, pagesHandler, upsertsOf, writeCount, slotOf, runViaWrapper } = env);
  await sprjb4Scene3();
}

async function sprjb4Scene4() {
  // ---- 後半の場面（verifyData/scrape-pre-race-job-scenes-2.js・scrape-pre-race-job-scenes-3.js・scrape-pre-race-job-scenes-4.js・scrape-pre-race-job-scenes-5.js・scrape-pre-race-job-scenes-6.js） ----
  runScrapePreRaceJobScenes3({ check, show, BEFORE_AFTER_START_HTML, SUMI_RACE, NOW, freshDb, createFetcher, pagesHandler });
  runScrapePreRaceJobScenes4({ BEFORE_UNPUBLISHED_HTML, SUMI_RACE, NOW, freshDb, writeCount, slotOf, runViaWrapper });
  await runScrapePreRaceJobScenes5({ check, show, BEFORE_UNPUBLISHED_HTML, DATE, SUMI_RACE, RACE, NOW, freshDb, createFetcher, pagesHandler, upsertsOf, raceInfoShadowWritesNothing, raceInfoFetchesOnlyRacelist, exhibitionShadowWritesNothing, slotOf });
  await runScrapePreRaceJobScenes6({ check, show, NOW, upsertsOf });
  await runScrapePreRaceJobScenes7({ printOut, check, show, DATE, RACE, freshDb, createFetcher, pagesHandler, slotOf });
}

/** verify から呼ぶ入口。env は verify 側の束縛（printOut・check・show・LIST_HTML・BEFORE_UNPUBLISHED_HTML・BEFORE_AFTER_START_HTML・DATE・SUMI_RACE・RACE・RACE_11・NOW・seedRaces・freshDb・createFetcher・pagesHandler・upsertsOf・writeCount・slotOf・runViaWrapper） */
export async function runScrapePreRaceJobScenesB6(env) {
  ({ printOut, check, show, LIST_HTML, BEFORE_UNPUBLISHED_HTML, BEFORE_AFTER_START_HTML, DATE, SUMI_RACE, RACE, RACE_11, NOW, seedRaces, freshDb, createFetcher, pagesHandler, upsertsOf, writeCount, slotOf, runViaWrapper } = env);
  await sprjb4Scene4();
}

function sprjb4Scene5() {
  // ---- 後半の場面（verifyData/scrape-pre-race-job-scenes-6.js） ----
  runScrapePreRaceJobScenes8({ printOut, check, show, DATE, RACE, freshDb, createFetcher, pagesHandler, slotOf });
}

/** verify から呼ぶ入口。env は verify 側の束縛（printOut・check・show・LIST_HTML・BEFORE_UNPUBLISHED_HTML・BEFORE_AFTER_START_HTML・DATE・SUMI_RACE・RACE・RACE_11・NOW・seedRaces・freshDb・createFetcher・pagesHandler・upsertsOf・writeCount・slotOf・runViaWrapper） */
export function runScrapePreRaceJobScenesB7(env) {
  ({ printOut, check, show, LIST_HTML, BEFORE_UNPUBLISHED_HTML, BEFORE_AFTER_START_HTML, DATE, SUMI_RACE, RACE, RACE_11, NOW, seedRaces, freshDb, createFetcher, pagesHandler, upsertsOf, writeCount, slotOf, runViaWrapper } = env);
  sprjb4Scene5();
}
