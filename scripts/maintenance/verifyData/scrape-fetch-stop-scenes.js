/**
 * verify-scrape-fetch-stop.js の後半の場面。verify ではない。
 * 判定と期待値は分ける前の verify-scrape-fetch-stop.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import {
  createCircuitBreaker,
  BreakerOpenError,
  FetchStoppedError,
} from "../../lib/scrapeJobs/circuitBreaker.js";
import { createPoliteFetch } from "../../lib/scrapeJobs/politeFetch.js";
import { createMemoryStore } from "../../lib/scrapeJobs/testing/memoryStore.js";
import { runScrapeJob } from "../../lib/scrapeJobs/cronWrapper.js";
import { handleLiveOddsRequest } from "../../lib/liveOdds.js";
import { reasonFromError } from "../../lib/scrapeJobs/venueJobSupport.js";
import { evaluateJobStates } from "../../lib/scrapeJobs/monitor.js";

let check, show, HOST, mkClock;

async function scene1() {
  // (e) 共通ラッパ
  {
    const clock = mkClock();
    const store = createMemoryStore({
      rows: { odds: { job: "odds", mode: "live", consecutive_failures: 0 } },
      slots: [
        {
          job: "odds",
          race_id: "2026-10-26-01-01",
          offset_min: -60,
          attempts: 1,
          last_attempt_at: clock.now().toISOString(),
        },
      ],
    });
    store.breakerStore.fetchStop[HOST] = true;
    let handled = 0;
    const r = await runScrapeJob({
      job: "odds",
      store,
      handleSlot: async () => {
        handled++;
        return { outcome: "ok" };
      },
      now: clock.now,
      worker: "w-test",
    });
    check(
      "(e) 共通ラッパ: ホストの fetch_stop でスロットを取らず 200・skipped=fetch_stop",
      r.status === 200 &&
        r.body.skipped === "fetch_stop" &&
        handled === 0 &&
        !store.calls.some((c) => c.name === "claimSlots"),
      show(r),
    );
    check(
      "(e) 共通ラッパ: 連続失敗に数えない（recordFailure を呼ばない）",
      !store.calls.some((c) => c.name === "recordFailure"),
      show(store.calls.map((c) => c.name)),
    );
    // ブレーカーが開いているだけなら従来どおり breaker_open
    const store2 = createMemoryStore({
      rows: { odds: { job: "odds", mode: "live" } },
    });
    store2.breakerStore.until = clock.c.t + 60_000;
    const r2 = await runScrapeJob({
      job: "odds",
      store: store2,
      handleSlot: async () => ({ outcome: "ok" }),
      now: clock.now,
      worker: "w-test",
    });
    check(
      "(e) ブレーカーが開いているだけなら従来どおり skipped=breaker_open",
      r2.body.skipped === "breaker_open",
      show(r2),
    );
  }
  // (f) /api/odds/live の本体
  {
    const clock = mkClock();
    const calls = [];
    const breaker = createCircuitBreaker({
      store: { read: async (k) => ({ untilMs: 0, fetchStop: k === HOST }) },
      now: clock.nowMs,
    });
    const polite = createPoliteFetch({
      breaker,
      maxRetries: 0,
      fetchImpl: async (url) => {
        calls.push(url);
        return new Response("<html></html>");
      },
    });
    const r = await handleLiveOddsRequest({
      query: { raceId: "2026-10-26-01-01", page: "tf" },
      politeFetch: polite,
      now: clock.now,
    });
    check(
      "(f) ライブオッズ: fetch_stop で公式へ取りに行かず ok:false の breaker_open",
      r.status === 200 &&
        r.body.ok === false &&
        r.body.reason === "breaker_open" &&
        calls.length === 0,
      show({ r, calls }),
    );
  }
}

async function scene2() {
  // (g) 旧い形のストア
  {
    const clock = mkClock();
    const breaker = createCircuitBreaker({
      store: { read: async () => clock.c.t + 60_000 },
      now: clock.nowMs,
    });
    let err = null;
    try {
      await breaker.check(HOST);
    } catch (e) {
      err = e;
    }
    check(
      "(g) read が数（期限）を返す旧い形も、開いているときは BreakerOpenError（非常停止ではない）",
      err instanceof BreakerOpenError && !(err instanceof FetchStoppedError),
      String(err),
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・show・HOST・mkClock） */
export async function runScrapeFetchStopScenes1(env) {
  ({ check, show, HOST, mkClock } = env);
  await scene1();
  await scene2();
}

function scene3() {
  // (i)
  check(
    "(i) 会場のジョブの理由コード: FetchStoppedError も breaker_open（その日を処理済みにしない）",
    reasonFromError(new FetchStoppedError(HOST, 0)) === "breaker_open" &&
      reasonFromError(new BreakerOpenError(HOST, 0)) === "breaker_open",
  );
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・show・HOST・mkClock） */
export function runScrapeFetchStopScenes2(env) {
  ({ check, show, HOST, mkClock } = env);
  scene3();
}

function scene4() {
  // (j)
  {
    const now = new Date("2026-10-26T03:00:00Z");
    const alerts = evaluateJobStates(
      [
        { job: HOST, mode: "off", fetch_stop: true, breaker_open_until: null },
        { job: "host:mbrace.or.jp", mode: "off", fetch_stop: false },
      ],
      now,
    );
    check(
      "(j) 監視: fetch_stop が立った host の行だけを知らせる",
      alerts.length === 1 &&
        alerts[0].key === `fetch_stop:${HOST}` &&
        /非常停止/.test(alerts[0].text),
      show(alerts),
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・show・HOST・mkClock） */
export function runScrapeFetchStopScenes3(env) {
  ({ check, show, HOST, mkClock } = env);
  scene4();
}
