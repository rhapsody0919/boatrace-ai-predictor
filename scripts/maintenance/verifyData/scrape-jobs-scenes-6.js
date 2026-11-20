/**
 * verify-scrape-jobs.js の後半の場面（6/9）。verify ではない。
 * 判定と期待値は分ける前の verify-scrape-jobs.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { SCRAPE_JOBS } from "../../lib/scrapeJobs/registry.js";
import { computeRetryAt } from "../../lib/scrapeJobs/outcomes.js";
import { createCircuitBreaker, BreakerOpenError } from "../../lib/scrapeJobs/circuitBreaker.js";
import { pathKeyOf, createPoliteFetch } from "../../lib/scrapeJobs/politeFetch.js";
import { runScrapeJob } from "../../lib/scrapeJobs/cronWrapper.js";
import { createMemoryStore } from "../../lib/scrapeJobs/testing/memoryStore.js";
import { mkClock, slot, run, T0 } from "./scrape-jobs-scenes-4.js";

let check, same, show;

/** 元の verify の1つの塊 { } を割った 1/2 */
async function scene1() {
  const BEFORE = "https://www.boatrace.jp/owpc/pc/race/beforeinfo";
  const exSlot = (raceId) => ({ ...slot(raceId, -33), job: "exhibition" });
  // 事前に beforeinfo のパスのブレーカーが開いている → claim しない。odds（同じホスト）は止めない
  {
    const clock = mkClock();
    const store = createMemoryStore({
      rows: {
        exhibition: { job: "exhibition", mode: "live" },
        odds: { job: "odds", mode: "live" },
      },
      slots: [exSlot("2026-09-19-01-01"), slot("2026-09-19-01-02")],
    });
    store.breakerStore.byKey[pathKeyOf(BEFORE)] = clock.c.t + 30 * 60_000;
    const ex = await run(store, {
      clock,
      job: "exhibition",
      handleSlot: async () => ({ outcome: "ok" }),
    });
    const oddsStore = createMemoryStore({
      rows: { odds: { job: "odds", mode: "live" } },
      slots: [slot("2026-09-19-01-02")],
    });
    oddsStore.breakerStore.byKey[pathKeyOf(BEFORE)] = clock.c.t + 30 * 60_000;
    const odds = await run(oddsStore, {
      clock,
      handleSlot: async () => ({ outcome: "ok" }),
    });
    check(
      "beforeinfo のパスのブレーカーが開いている: 展示はスロットを取らず skipped（claim なし）。同じホストの odds は動く",
      ex.status === 200 &&
        ex.body.skipped === "breaker_open" &&
        ex.body.host === pathKeyOf(BEFORE) &&
        !store.calls.some((c) => c.name === "claimSlots") &&
        odds.body.claimed === 1 &&
        oddsStore.completed.length === 1,
      show([ex.body, odds.body]),
    );
  }
  return { BEFORE, exSlot };
}

/** 元の verify の1つの塊 { } を割った 2/2 */
async function scene2({ BEFORE, exSlot }) {
  // 起動の途中で 403: その起動の残りは叩かない（展示は1件ずつ取る。concurrency 1）。再開・半開がちょうど1件で止まる
  {
    const clock = mkClock();
    const store = createMemoryStore({
      rows: { exhibition: { job: "exhibition", mode: "live" } },
      slots: [1, 2, 3, 4, 5, 6].map((n) => exSlot(`2026-09-19-01-0${n}`)),
    });
    const breaker = createCircuitBreaker({
      store: store.breakerStore,
      now: () => clock.c.t,
    });
    let fetched = 0;
    const pf = createPoliteFetch({
      breaker,
      sleep: async () => {},
      fetchImpl: async () => (fetched++, new Response("", { status: 403 })),
    });
    const r = await runScrapeJob({
      job: "exhibition",
      store,
      handleSlot: async (s, ctx) => {
        try {
          const res = await ctx.politeFetch(`${BEFORE}?rno=1`);
          return {
            outcome: res.ok ? "ok" : "error",
            error: `HTTP ${res.status}`,
          };
        } catch (e) {
          if (e instanceof BreakerOpenError) throw e;
          return { outcome: "error", error: e.message };
        }
      },
      now: clock.now,
      worker: "w-test",
      breaker,
      politeFetch: pf,
    });
    const breakerOpen = store.retried.filter(
      (x) => x.outcome === "breaker_open",
    );
    check(
      "起動の途中で 403: 公式へのリクエストは beforeinfo の1件とカナリア（race/index）の1件だけ。403 の1件も残りの5件も breaker_open（ブレーカーの期限＝30分後まで再試行しない。全件失敗＝連続失敗に数えない）",
      fetched === 2 &&
        breakerOpen.length === 6 &&
        r.status === 200 &&
        // カナリアも 403（この偽物は全部 403）: ホスト全体が60分開き、残りはホストの期限まで待つ
        breakerOpen.every(
          (x) => x.retryAt.getTime() >= clock.c.t + 30 * 60_000,
        ) &&
        store.breakerStore.byKey[pathKeyOf(BEFORE)] ===
          clock.c.t + 30 * 60_000 &&
        store.breakerStore.byKey["host:boatrace.jp"] ===
          clock.c.t + 60 * 60_000,
      show({ fetched, r: r.body, retried: store.retried.length }),
    );
  }
}

async function scene3() {
  {
    const s1 = await scene1();
    await scene2(s1);
  }
  // ソフトデッドライン: 超えていたら着手せず pending に戻す（並列度1にして、逐次で確認する）
  {
    const clock = mkClock();
    const seq = { ...SCRAPE_JOBS.odds, concurrency: 1 };
    const store = createMemoryStore({
      rows: { odds: { job: "odds", mode: "live" } },
      slots: [
        slot("2026-09-19-01-01"),
        slot("2026-09-19-01-02"),
        slot("2026-09-19-01-03"),
      ],
    });
    const handled = [];
    const r = await runScrapeJob({
      job: "odds",
      definition: seq,
      store,
      now: clock.now,
      worker: "w-test",
      politeFetch: async () => new Response(""),
      handleSlot: async (s) => {
        handled.push(s.race_id);
        clock.c.t += 271_000;
        return { outcome: "ok", rowsWritten: 1 };
      },
    });
    check(
      "ソフトデッドライン（maxDuration−30秒）を超えたら、新しいスロットに着手せず pending に戻す（試行回数も戻す）",
      handled.length === 1 &&
        store.completed.length === 1 &&
        store.retried.length === 2 &&
        store.retried.every(
          (x) =>
            x.retryAt.getTime() === clock.c.t && !x.outcome && x.releaseAttempt,
        ) &&
        r.body.outcomes.deferred === 2,
      show({ handled, retried: store.retried.length, body: r.body }),
    );
  }
  // 並列度の上限（レジストリの concurrency）
  {
    const clock = mkClock();
    const slots = Array.from({ length: 12 }, (_, i) =>
      slot(`2026-09-19-01-${String(i + 1).padStart(2, "0")}`),
    );
    const store = createMemoryStore({
      rows: { odds: { job: "odds", mode: "live" } },
      slots,
    });
    let active = 0;
    let peak = 0;
    await run(store, {
      clock,
      handleSlot: async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 3));
        active--;
        return { outcome: "ok" };
      },
    });
    check(
      `スロットの並列度はレジストリの値（${SCRAPE_JOBS.odds.concurrency}）を超えない（最大${peak}）`,
      peak === SCRAPE_JOBS.odds.concurrency,
    );
  }
}

async function scene4() {
  // 再試行の起点: ハンドラーの完了時刻ではなく、claim の時刻
  {
    const clock = mkClock();
    const store = createMemoryStore({
      rows: { odds: { job: "odds", mode: "live" } },
      slots: [slot("2026-09-19-01-01")],
    });
    await run(store, {
      clock,
      handleSlot: async () => {
        clock.c.t += 12_000; // 1件約10秒の取得
        return { outcome: "no_values" };
      },
    });
    const at = store.retried[0].retryAt.getTime();
    check(
      "再試行の間隔は、ハンドラーの完了(claim+12秒)ではなく claim を起点にする（60秒−10秒=claim+50秒。完了から数えると+72秒になり、毎分のCronの次の起動(+60秒)を1回飛ばす）",
      at === T0.getTime() + 50_000 && at < T0.getTime() + 60_000,
      String(at - T0.getTime()),
    );
    const slow = createMemoryStore({
      rows: { odds: { job: "odds", mode: "live" } },
      slots: [slot("2026-09-19-01-02")],
    });
    const clock2 = mkClock();
    await run(slow, {
      clock: clock2,
      handleSlot: async () => {
        clock2.c.t += 70_000;
        return { outcome: "no_values" };
      },
    });
    check(
      "処理が再試行の間隔より長くかかった場合は、現在時刻（即時に再試行できる）",
      slow.retried[0].retryAt.getTime() === clock2.c.t,
    );
    check(
      "computeRetryAt: claim時刻が無い・不正なら現在時刻を起点にする",
      computeRetryAt({ now: T0, claimedAt: null, retrySec: 60 }).getTime() ===
        T0.getTime() + 50_000 &&
        computeRetryAt({
          now: T0,
          claimedAt: "invalid",
          retrySec: 60,
        }).getTime() ===
          T0.getTime() + 50_000 &&
        computeRetryAt({ now: T0, claimedAt: T0, retrySec: 5 }).getTime() ===
          T0.getTime(),
    );
  }
  // リース切れ間近のスロットには着手しない（二重取得を避ける）
  {
    const clock = mkClock();
    const soon = (sec) => ({
      ...slot("2026-09-19-01-0" + sec),
      lease_until: new Date(T0.getTime() + sec * 1000).toISOString(),
    });
    const store = createMemoryStore({
      rows: { odds: { job: "odds", mode: "live" } },
      // oddsの slotSecEstimate は12秒。リースの残りが 5秒・11秒 のスロットは、完了前に切れる見込み
      slots: [soon(5), soon(11), soon(100)],
    });
    const handled = [];
    const r = await run(store, {
      clock,
      handleSlot: async (s) => {
        handled.push(s.race_id);
        return { outcome: "ok" };
      },
    });
    check(
      "リースの残りが1スロットの見積り(12秒)より短いスロットには着手せず、試行回数を戻して pending に戻す",
      same(handled, ["2026-09-19-01-0100"]) &&
        store.retried.length === 2 &&
        store.retried.every((x) => x.releaseAttempt === true) &&
        r.body.outcomes.deferred === 2,
      show({ handled, outcomes: r.body.outcomes }),
    );
  }
}

async function scene5() {
  // ハンドラーが不正な値を返しても、他のスロットの記録を止めない
  {
    const store = createMemoryStore({
      rows: { odds: { job: "odds", mode: "live" } },
      slots: [
        slot("2026-09-19-01-01"),
        slot("2026-09-19-01-02"),
        slot("2026-09-19-01-03"),
        slot("2026-09-19-01-04"),
      ],
    });
    const r = await run(store, {
      handleSlot: async (s) => {
        if (s.race_id.endsWith("01")) return undefined;
        if (s.race_id.endsWith("02")) return "ok";
        if (s.race_id.endsWith("04")) return {}; // outcome が無い
        return { outcome: "ok" };
      },
    });
    check(
      "ハンドラーが undefined・文字列・outcome の無いオブジェクトを返しても、error として記録し、他のスロットの完了を記録する（全スロットが running のまま残らない）",
      store.completed.length === 1 &&
        store.retried.length === 3 &&
        store.retried.every((x) => x.outcome === "error") &&
        r.body.claimed === 4,
      show(r.body),
    );
  }
  // 日次: リース取得後の再確認
  {
    const store = createMemoryStore({
      rows: { point_rank: { job: "point_rank", mode: "live" } },
    });
    let reads = 0;
    const original = store.readState;
    store.readState = async (job) => {
      reads++;
      const r = await original(job);
      // 2回目の読み取り（リース取得後）では、別の実行が完了させた状態にする
      if (reads >= 2) r.row = { ...r.row, last_target_date: "2026-09-19" };
      return r;
    };
    let called = 0;
    const r = await run(store, {
      job: "point_rank",
      clock: mkClock(new Date("2026-09-19T13:30:00Z")),
      run: async () => {
        called++;
        return {};
      },
    });
    check(
      "日次: リース取得後の再確認で、別の実行が対象日を完了済みなら実行しない（リースは解放する）",
      called === 0 &&
        r.body.skipped === "already_done" &&
        store.calls.some((c) => c.name === "releaseLease"),
      show(r.body),
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・same・show） */
export async function runScrapeJobsScenes6(env) {
  ({ check, same, show } = env);
  await scene3();
  await scene4();
  await scene5();
}
