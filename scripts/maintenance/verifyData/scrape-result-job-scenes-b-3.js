/**
 * verify-scrape-result-job.js の後半の場面（3/7）。verify ではない。
 * 判定と期待値は分ける前の verify-scrape-result-job.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { runForRaces } from "../../daily/scrape-results.js";
import { createResultOnTick, createResultSlotHandler } from "../../lib/scrapeJobs/resultHandlers.js";
import { runScrapeJob } from "../../lib/scrapeJobs/cronWrapper.js";
import { SCRAPE_JOBS } from "../../lib/scrapeJobs/registry.js";
import { createMemoryStore } from "../../lib/scrapeJobs/testing/memoryStore.js";
import { createFakeDb } from "./scrape-result-job-fake-db.js";
import { racesA, DATE, NOW_FN, baseDb } from "./scrape-result-job-scenes-b-2.js";
import { RACE_A, RACE_B, digestA, RACE_NONE } from "./scrape-result-job-scenes-b-1.js";

let check, show, same, HTML_A, HTML_NONE, HTML_PARTIAL, URL_TO_HTML;
export let NOW_TICK;

 // 14:40 JST
export const slotFor = (raceId, overrides = {}) => ({
  job: "result",
  race_id: raceId,
  offset_min: 5,
  race_date: "2026-09-19",
  status: "running",
  attempts: 1,
  last_attempt_at: NOW_TICK.toISOString(),
  lease_until: "2026-09-19T06:40:00Z",
  ...overrides,
});

export const politeFor = (map = URL_TO_HTML) => {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    return new Response(map(url), { status: 200 });
  };
  fn.calls = calls;
  return fn;
};

export async function runResultJob({
  mode,
  slots = [],
  db = baseDb(),
  rows,
  polite = politeFor(),
  onTick,
  storeOverrides = {},
  available = true,
}) {
  const store = createMemoryStore({
    available,
    rows: rows ?? (mode ? { result: { job: "result", mode } } : {}),
    slots,
  });
  Object.assign(store, storeOverrides);
  const events = [];
  const origClaim = store.claimSlots.bind(store);
  store.claimSlots = async (a) => {
    events.push("claim");
    return origClaim(a);
  };
  const res = await runScrapeJob({
    job: "result",
    store,
    handleSlot: createResultSlotHandler(),
    onTick:
      onTick ??
      (async (ctx) => {
        events.push("tick");
        return createResultOnTick({
          confirm: async () => ({ checked: 0, confirmed: [] }),
        })(ctx);
      }),
    now: () => NOW_TICK,
    worker: "test-worker",
    client: db,
    politeFetch: polite,
  });
  return { res, store, db, polite, events };
}

async function srjb3Scene1() {
  {
    // 書き込みの失敗は error（ok にしない）
    const db = createFakeDb(
      {
        race_results: [],
        race_start_timings: [],
        race_conditions: [],
        races: [],
        predictions: [],
      },
      { failOn: [{ table: "race_results", op: "upsert" }] },
    );
    const res = await runForRaces([racesA], {
      date: DATE,
      mode: "live",
      fetchHtml: async () => HTML_A,
      client: db,
      now: NOW_FN,
    });
    check(
      "race_results の書き込みが失敗したら error（完了にしない。次の再試行で書き直す）",
      res[0].outcome === "error" &&
        /race_results/.test(res[0].error) &&
        res[0].resultDigest === undefined,
      show(res),
    );
    const dbRead = createFakeDb(
      { race_results: [] },
      { readError: { race_results: "接続断" } },
    );
    let thrown = null;
    try {
      await runForRaces([racesA], {
        date: DATE,
        mode: "live",
        fetchHtml: async () => HTML_A,
        client: dbRead,
      });
    } catch (e) {
      thrown = e;
    }
    check(
      "完了済みの確認（読み取り）が失敗したら例外（「未完了」とみなして取得・書き込みを進めない）",
      thrown && /接続断/.test(thrown.message) && dbRead.writes.length === 0,
    );
  }
  {
    // 並列度の上限
    let active = 0;
    let peak = 0;
    const many = Array.from({ length: 6 }, (_, i) => ({
      race_id: `2026-09-19-05-${String(i + 1).padStart(2, "0")}`,
      venue_code: 5,
      race_number: i + 1,
    }));
    await runForRaces(many, {
      date: DATE,
      mode: "shadow",
      fetchHtml: async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
        return HTML_NONE;
      },
      concurrency: 2,
    });
    check(
      "並列度の上限: concurrency=2 で同時取得は2件まで",
      peak === 2,
      `peak=${peak}`,
    );
    let threw = false;
    try {
      await runForRaces([racesA], { date: DATE, mode: "dry" });
    } catch {
      threw = true;
    }
    check("mode が live・shadow 以外なら例外", threw);
  }
  // ---------------------------------------------------------------------------
  // (c)(d) 共通ラッパ経由の result
  // ---------------------------------------------------------------------------
  NOW_TICK = new Date("2026-09-19T05:40:00Z");
}

async function srjb3Scene2() {
  {
    // off・行なし・075未適用: 何も取得せず何も書かない
    for (const [label, opts] of [
      ["mode=off", { mode: "off", slots: [slotFor(RACE_A)] }],
      ["scrape_job_state に行なし", { mode: null, slots: [slotFor(RACE_A)] }],
      [
        "予定表（075）が未適用",
        { mode: "live", slots: [slotFor(RACE_A)], available: false },
      ],
    ]) {
      const r = await runResultJob(opts);
      const names = r.store.calls.map((c) => c.name);
      check(
        `${label}: 取得0回・データテーブルへの書き込み0件・claimもしない・200（マージしても本番の挙動は変わらない）`,
        r.res.status === 200 &&
          r.polite.calls.length === 0 &&
          r.db.writes.length === 0 &&
          r.db.reads.length === 0 &&
          !names.includes("claimSlots") &&
          !names.includes("ensureSlots") &&
          !names.includes("completeSlot") &&
          !names.includes("touchTick") &&
          r.events.length === 0,
        show({
          body: r.res.body,
          names,
          writes: r.db.writes,
          fetched: r.polite.calls,
        }),
      );
      if (label === "scrape_job_state に行なし") {
        check(
          `${label}: 書くのは、mode=off の行を1つ作る（ensureRow）ことだけ。modeは変更しない`,
          names.filter((n) => n !== "readState").join() === "ensureRow" &&
            r.store.state.get("result").mode === "off",
          show(names),
        );
      }
    }
  }
}

async function srjb3Scene3() {
  {
    // shadow: 取得・解析のみ。予定表に digest を記録。データテーブルへは書かない。onTick も呼ばない
    const r = await runResultJob({
      mode: "shadow",
      slots: [slotFor(RACE_A), slotFor(RACE_B)],
    });
    check(
      "shadow: 2スロットが ok で完了し、result_digest が記録される（既存基盤の行から計算した値と比べられる形）",
      r.res.status === 200 &&
        r.store.completed.length === 2 &&
        r.store.completed.every(
          (c) => c.outcome === "ok" && /^[0-9a-f]{16}$/.test(c.resultDigest),
        ) &&
        r.store.completed.find((c) => c.slot.race_id === RACE_A).resultDigest ===
          digestA,
      show(r.res.body),
    );
    check(
      "shadow: データテーブルへの書き込み0件（DBを読みもしない）・onTick（races への書き込み）は呼ばない",
      r.db.writes.length === 0 &&
        r.db.reads.length === 0 &&
        !r.events.includes("tick"),
      show({ writes: r.db.writes, events: r.events }),
    );
    check(
      "shadow: 取得は politeFetch 経由（2件）。run_mode は shadow で claim される",
      r.polite.calls.length === 2 &&
        r.store.calls.find((c) => c.name === "claimSlots").mode === "shadow",
    );
  }
  {
    // live: 書き込む。onTick は claim の前
    const r = await runResultJob({ mode: "live", slots: [slotFor(RACE_A)] });
    check(
      "live: ok で完了・データテーブルへ書き込む。書き込み行数が予定表に記録される",
      r.res.status === 200 &&
        r.store.completed.length === 1 &&
        r.store.completed[0].outcome === "ok" &&
        r.store.completed[0].rowsWritten === 7 &&
        r.db.tables.race_results.length === 1,
      show(r.res.body),
    );
    check(
      "live: onTick（中止・順延の確定）は claim（スロットの取得）より前に呼ばれる（確定が先＝中止のレースが expired にならない）",
      r.events.join() === "tick,claim",
      r.events.join(),
    );
  }
}

async function srjb3Scene4() {
  {
    // partial / no_values → 完了にせず再試行（retrySlot）。error だけなら500
    const partial = await runResultJob({
      mode: "live",
      slots: [slotFor(RACE_A)],
      polite: politeFor(() => HTML_PARTIAL),
    });
    check(
      "live・決まり手が未公開: 完了にせず、再試行（pending に戻す）。理由が last_error に入る",
      partial.store.completed.length === 0 &&
        partial.store.retried.length === 1 &&
        /決まり手/.test(partial.store.retried[0].error) &&
        partial.store.retried[0].outcome === "partial",
      show(partial.store.retried),
    );
    const none = await runResultJob({
      mode: "live",
      slots: [slotFor(RACE_NONE)],
      polite: politeFor(() => HTML_NONE),
    });
    check(
      "live・未公開（no_values）: 再試行。書き込みなし。0件を成功にしない（完了にしない）",
      none.store.completed.length === 0 &&
        none.store.retried[0].outcome === "no_values" &&
        none.db.writes.length === 0 &&
        none.res.status === 200,
      show(none.res.body),
    );
    const allErr = await runResultJob({
      mode: "live",
      slots: [slotFor(RACE_A)],
      polite: async () => new Response("x", { status: 503 }),
    });
    check(
      "live・全スロットが取得失敗（HTTP 503）: 500・連続失敗を記録・スロットは再試行",
      allErr.res.status === 500 &&
        allErr.store.retried.length === 1 &&
        allErr.store.calls.some((c) => c.name === "recordFailure"),
      show(allErr.res.body),
    );
    const lost = await runResultJob({
      mode: "live",
      slots: [slotFor(RACE_A)],
      storeOverrides: { completeSlot: async () => false },
    });
    check(
      "リースを奪われていた（completeSlot が false）: 例外にも失敗にもせず、200（データ側は冪等な書き込み済みで無害。二重完了しない）",
      lost.res.status === 200 &&
        !lost.store.calls.some((c) => c.name === "recordFailure"),
      show(lost.res.body),
    );
  }
  check(
    "result の最初の窓は発走 +10分",
    same(SCRAPE_JOBS.result.offsets, [10]),
    show(SCRAPE_JOBS.result.offsets),
  );
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・show・same・HTML_A・HTML_NONE・HTML_PARTIAL・URL_TO_HTML） */
export async function runScrapeResultJobScenesB4(env) {
  ({ check, show, same, HTML_A, HTML_NONE, HTML_PARTIAL, URL_TO_HTML } = env);
  await srjb3Scene1();
  await srjb3Scene2();
  await srjb3Scene3();
  await srjb3Scene4();
}
