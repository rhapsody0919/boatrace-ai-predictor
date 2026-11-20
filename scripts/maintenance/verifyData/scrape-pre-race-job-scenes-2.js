/**
 * verify-scrape-pre-race-job.js の後半の場面（2/6）。verify ではない。
 * 判定と期待値は分ける前の verify-scrape-pre-race-job.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import {
  createExhibitionCronHandler,
  readExhibitionMode,
  isVercelCronRequest,
} from "../../lib/scrapeJobs/preRaceHandlers.js";
import { SCRAPE_JOBS } from "../../lib/scrapeJobs/registry.js";
import { evaluateJobHealth, decideFromRows } from "../../lib/ghaSkipGate.js";
import { createDb } from "./scrape-pre-race-job-db.js";
import { createRes, req, VERCEL_UA } from "./scrape-pre-race-job-scenes-1.js";

let check, show, BEFORE_AFTER_START_HTML, SUMI_RACE, NOW, freshDb, createFetcher, pagesHandler;

async function routeExhibition({
  stateRows = [],
  stateFail = null,
  ua = "cron-job.org",
  auth,
  handlerFactory = createExhibitionCronHandler,
}) {
  const db = createDb({
    tables: { scrape_job_state: stateRows },
    failSelect: stateFail ? { scrape_job_state: stateFail } : {},
  });
  const calls = { legacy: 0, slots: 0, slotArgs: [], deferred: [] };
  const handler = handlerFactory({
    getClient: async () => db,
    env: { CRON_SECRET: "secret" },
    now: () => NOW,
    defer: (promise) => calls.deferred.push(promise),
    legacy: async () => {
      calls.legacy++;
      return { status: 202, body: { accepted: true } };
    },
    runSlots: async (args) => {
      calls.slots++;
      calls.slotArgs.push(args);
      return {
        status: 200,
        body: { success: true, job: "exhibition", mode: "live" },
      };
    },
  });
  const res = createRes();
  await handler(req({ ua, auth }), res);
  return { res, calls };
}

const modeRow = (mode) => [{ job: "exhibition", mode }];

async function routingIsCorrect(handlerFactory) {
  const results = [];
  const run = (opts) => routeExhibition({ ...opts, handlerFactory });
  // 再現（P0）: off は、cron-job.org の起動でも何もしない（修正前は従来の経路が素の fetch で beforeinfo を叩いた）
  const idle = (x) =>
    x.calls.legacy === 0 && x.calls.slots === 0 && x.res.statusCode === 200;
  let r = await run({ stateRows: modeRow("off"), ua: "cron-job.org" });
  results.push(idle(r));
  r = await run({ stateRows: modeRow("off"), ua: VERCEL_UA });
  results.push(idle(r));
  // 行なし・読み取り失敗・テーブル未適用: 確かめられないため取らない
  r = await run({ stateRows: [], ua: "cron-job.org" });
  results.push(idle(r));
  r = await run({
    stateFail: { message: "boom", code: "XX000" },
    ua: "cron-job.org",
  });
  results.push(idle(r));
  r = await run({
    stateFail: {
      message:
        "Could not find the table 'public.scrape_job_state' in the schema cache",
      code: "PGRST205",
    },
    ua: "cron-job.org",
  });
  results.push(idle(r));
  // shadow: スロットのみ（取得・解析だけ。書かない）
  r = await run({ stateRows: modeRow("shadow"), ua: "cron-job.org" });
  results.push(r.calls.legacy === 0 && r.calls.slots === 1);
  r = await run({ stateRows: modeRow("shadow"), ua: VERCEL_UA });
  results.push(r.calls.legacy === 0 && r.calls.slots === 1);
  // live: スロットのみ。従来の経路は動かさない（どちらの起点でも）
  r = await run({ stateRows: modeRow("live"), ua: "cron-job.org" });
  results.push(r.calls.legacy === 0 && r.calls.slots === 1);
  r = await run({ stateRows: modeRow("live"), ua: VERCEL_UA });
  results.push(r.calls.legacy === 0 && r.calls.slots === 1);
  return results;
}

// ---------------------------------------------------------------------------
// (j) 窓の外の補完（BOA-382。展示の発走の後のスロット。レジストリの exhibition の offsets の 10）
// ---------------------------------------------------------------------------
export const CATCHUP_OFFSET = SCRAPE_JOBS.exhibition.catchupOffsets[0];

export const PRIMARY_OFFSET = -33;

export const SUMI_URL = "/beforeinfo?rno=5&jcd=12&hd=20260921";

export const sumiFetcher = (html = BEFORE_AFTER_START_HTML) =>
  createFetcher(pagesHandler({ before: html }));

export const sumiDbWithData = () => {
  const db = freshDb();
  db.state.tables.exhibition_data = [
    // 取得済み＝展示タイムと展示STの両方がある行（BOA-271 の前提の補完で、展示STも条件にした）
    {
      race_id: SUMI_RACE,
      boat_number: 1,
      exhibition_time: 6.89,
      start_timing: 0.12,
    },
  ];
  return db;
};

export const upsertedTables = (db) => db.state.upserts.map((u) => u.table);

/** 元の verify の1つの塊 { } を割った 1/2 */
async function scene1() {
  const results = await routingIsCorrect(createExhibitionCronHandler);
  check(
    `展示のモード切り替え（再現 P0）: off・行なし・読み取り失敗・テーブル未適用は、どちらの起点でも何もしない（従来の経路を動かさない）、shadow・live はスロットのみ（${results.length}通り）`,
    results.every(Boolean),
    show(results),
  );
  const unauth = await routeExhibition({
    stateRows: modeRow("live"),
    auth: "Bearer wrong",
  });
  const noAuth = await routeExhibition({
    stateRows: modeRow("live"),
    auth: "",
  });
  check(
    "展示: 認証（Bearer CRON_SECRET）が一致しなければ 401。従来の経路・スロットの経路とも動かない",
    unauth.res.statusCode === 401 &&
      noAuth.res.statusCode === 401 &&
      unauth.calls.legacy === 0 &&
      unauth.calls.slots === 0,
  );
  const live = await routeExhibition({ stateRows: modeRow("live") });
  check(
    "展示: スロットの経路には job='exhibition' と、展示のスロットのハンドラーを渡す",
    live.calls.slotArgs[0]?.job === "exhibition" &&
      typeof live.calls.slotArgs[0]?.createHandleSlot === "function",
  );
  const externalLive = await routeExhibition({
    stateRows: modeRow("live"),
    ua: "cron-job.org",
  });
  const vercelLive = await routeExhibition({
    stateRows: modeRow("live"),
    ua: VERCEL_UA,
  });
  await Promise.all(externalLive.calls.deferred);
  check(
    "展示: cron-job.org の起動は、スロットの処理をバックグラウンド（waitUntil）で行い、202 を即座に返す（cron-job.org のタイムアウト30秒に、約60〜70秒の処理を掛けない）。Vercel Cron の起動は、処理の完了後に 200",
    externalLive.res.statusCode === 202 &&
      externalLive.res.body.accepted === true &&
      externalLive.calls.deferred.length === 1 &&
      vercelLive.res.statusCode === 200 &&
      vercelLive.calls.deferred.length === 0 &&
      vercelLive.res.body.job === "exhibition",
    show({ external: externalLive.res, vercel: vercelLive.res }),
  );
  const externalShadow = await routeExhibition({
    stateRows: modeRow("shadow"),
    ua: "cron-job.org",
  });
  check(
    "展示（shadow）: cron-job.org の起動は、スロットだけをバックグラウンドで動かす（202）。従来の経路は動かさない",
    externalShadow.res.statusCode === 202 &&
      externalShadow.res.body.legacy === undefined &&
      externalShadow.calls.legacy === 0 &&
      externalShadow.calls.slots === 1,
    show(externalShadow.res),
  );
}

/** 元の verify の1つの塊 { } を割った 2/2 */
async function scene2() {
  check(
    "readExhibitionMode: shadow・live は認識し、それ以外の値・行なしは off",
    (
      await readExhibitionMode({
        readState: async () => ({ available: true, row: { mode: "live" } }),
      })
    ).mode === "live" &&
      (
        await readExhibitionMode({
          readState: async () => ({ available: true, row: { mode: "shadow" } }),
        })
      ).mode === "shadow" &&
      (
        await readExhibitionMode({
          readState: async () => ({ available: true, row: { mode: "???" } }),
        })
      ).mode === "off" &&
      (
        await readExhibitionMode({
          readState: async () => ({ available: true, row: null }),
        })
      ).mode === "off" &&
      (
        await readExhibitionMode({
          readState: async () => {
            throw new Error("x");
          },
        })
      ).mode === "off",
  );
  check(
    "isVercelCronRequest: User-Agent が vercel-cron/1.0 のときだけ true（cron-job.org・未設定は false）",
    isVercelCronRequest({ headers: { "user-agent": "vercel-cron/1.0" } }) &&
      !isVercelCronRequest({ headers: { "user-agent": "cron-job.org" } }) &&
      !isVercelCronRequest({ headers: {} }),
  );
  // 変異検証: モードを無視して、常に従来の経路を動かす版
  const mutantFactory = (deps) => async (request, res) => {
    await deps.legacy({});
    return res.status(202).json({});
  };
  const mutantResults = await routingIsCorrect(mutantFactory);
  check(
    "変異検証: 「モードを無視して従来の経路を動かす」版では、切り替えの検証が失敗する",
    !mutantResults.every(Boolean),
    show(mutantResults),
  );
}

async function scene3() {
  {
    await scene1();
    await scene2();
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・show・BEFORE_AFTER_START_HTML・SUMI_RACE・NOW・freshDb・createFetcher・pagesHandler） */
export async function runScrapePreRaceJobScenes2(env) {
  ({ check, show, BEFORE_AFTER_START_HTML, SUMI_RACE, NOW, freshDb, createFetcher, pagesHandler } = env);
  await scene3();
}

function scene4() {
  // フェイルセーフ付きSKIP（ghaSkipGate.js）への組み込み
  {
    const now = new Date("2026-09-24T12:00:00+09:00");
    const tick = (agoMin) =>
      new Date(now.getTime() - agoMin * 60000).toISOString();
    const row = (job, extra = {}) => ({
      job,
      mode: "live",
      last_tick_at: tick(1),
      consecutive_failures: 0,
      ...extra,
    });
    const decide = (varName, rows) => decideFromRows({ varName, rows, now });

    check(
      "gate race_info: live で起動が新しければ、連続失敗があってもスキップ。行なし・shadow・off もスキップ（どこからも取らない）。起動が古いときだけ実行（GitHubが肩代わり。P0）",
      decide("SKIP_RACE_INFO_ON_GHA", [row("race_info")]).skip === true &&
        decide("SKIP_RACE_INFO_ON_GHA", []).skip === true &&
        decide("SKIP_RACE_INFO_ON_GHA", [row("race_info", { mode: "shadow" })])
          .skip === true &&
        decide("SKIP_RACE_INFO_ON_GHA", [row("race_info", { mode: "off" })])
          .skip === true &&
        decide("SKIP_RACE_INFO_ON_GHA", [
          row("race_info", { last_tick_at: tick(30) }),
        ]).skip === false &&
        decide("SKIP_RACE_INFO_ON_GHA", [
          row("race_info", { consecutive_failures: 50 }),
        ]).skip === true,
    );
    check(
      "gate exhibition: mode・起動・失敗によらず常にスキップ（展示は GitHub で肩代わりしない。spec §8 G2）",
      [
        [],
        [row("exhibition", { mode: "off", last_tick_at: null })],
        [row("exhibition", { mode: "shadow", last_tick_at: null })],
        [row("exhibition")],
        [row("exhibition", { last_tick_at: tick(30) })],
        [row("exhibition", { last_tick_at: null })],
        [row("exhibition", { consecutive_failures: 50 })],
      ].every((rows) => {
        const d = decide("SKIP_EXHIBITION_ON_GHA", rows);
        return d.skip === true && d.reason === "never_takeover";
      }),
      show(decide("SKIP_EXHIBITION_ON_GHA", [])),
    );
    check(
      "gate: 行なし・live でないジョブは、どのジョブも肩代わりしない（healthy=true。どこからも取らない）",
      evaluateJobHealth({ job: "odds", rowsByJob: new Map(), now }).healthy ===
        true &&
        evaluateJobHealth({
          job: "odds",
          rowsByJob: new Map([["odds", row("odds", { mode: "shadow" })]]),
          now,
        }).healthy === true,
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・show・BEFORE_AFTER_START_HTML・SUMI_RACE・NOW・freshDb・createFetcher・pagesHandler） */
export function runScrapePreRaceJobScenes3(env) {
  ({ check, show, BEFORE_AFTER_START_HTML, SUMI_RACE, NOW, freshDb, createFetcher, pagesHandler } = env);
  scene4();
}
