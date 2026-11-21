/**
 * verify-scrape-jobs.js の後半の場面（4/9）。verify ではない。
 * 判定と期待値は分ける前の verify-scrape-jobs.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { createCircuitBreaker } from "../../lib/scrapeJobs/circuitBreaker.js";
import { createPoliteFetch, pathKeyOf, hostKeyOf } from "../../lib/scrapeJobs/politeFetch.js";
import { mapWithConcurrency, createSemaphore } from "../../lib/scrapeJobs/concurrency.js";
import { runScrapeJob, isAuthorized } from "../../lib/scrapeJobs/cronWrapper.js";
import { createMemoryStore } from "../../lib/scrapeJobs/testing/memoryStore.js";
import { noSleep, mkResponse } from "./scrape-jobs-scenes-2.js";

let check, same, show;
export let T0;

 // 09:00 JST
export const mkClock = (start = T0) => {
  const c = { t: start.getTime() };
  return { c, now: () => new Date(c.t) };
};

export const slot = (raceId, offset = -60) => ({
  job: "odds",
  race_id: raceId,
  offset_min: offset,
  attempts: 1,
  // claim した時刻（RPCが返す last_attempt_at）。再試行の間隔の起点
  last_attempt_at: T0.toISOString(),
});

export const run = (store, opts = {}) => {
  const clock = opts.clock ?? mkClock();
  return runScrapeJob({
    job: opts.job ?? "odds",
    store,
    handleSlot: opts.handleSlot,
    run: opts.run,
    now: clock.now,
    worker: "w-test",
    modeGated: opts.modeGated ?? true,
    politeFetch: opts.politeFetch ?? (async () => new Response("")),
  });
};

const noWrites = (store) =>
  !store.calls.some((c) =>
    [
      "touchTick",
      "claimSlots",
      "ensureSlots",
      "acquireLease",
      "recordSuccess",
      "recordFailure",
    ].includes(c.name),
  );

// shadow・live の1つのモード（分ける前は下の for の中の文。中身と並びは同じ）: claim → ハンドラー
export async function runModeSlots(mode) {
  const clock = mkClock();
  const store = createMemoryStore({
    rows: { odds: { job: "odds", mode, consecutive_failures: 2 } },
    slots: [
      slot("2026-09-19-01-01"),
      slot("2026-09-19-01-02"),
      slot("2026-09-19-01-03"),
      slot("2026-09-19-01-04"),
      slot("2026-09-19-01-05"),
    ],
  });
  const seen = [];
  const r = await run(store, {
    clock,
    handleSlot: async (s, ctx) => {
      seen.push({ id: s.race_id, mode: ctx.mode });
      switch (s.race_id.slice(-2)) {
        case "01":
          return {
            outcome: "ok",
            rowsWritten: 1,
            rowsParsed: 1,
            rowsExpected: 1,
            resultDigest: "abc",
          };
        case "02":
          return { outcome: "skipped_have_data" };
        case "03":
          return { outcome: "no_values" };
        case "04":
          throw new Error("解析エラー");
        default:
          return { outcome: "ok", rowsExpected: 5, rowsParsed: 0 }; // 0件エラー
      }
    },
  });
  return { clock, store, seen, r };
}

async function scene1() {
  // 半開の試行が 404・500 等（2xx・3xx でない）なら、403 のパスのブレーカーを閉じない（次の取得がもう一度試行になる）
  {
    const clock = { t: 11_000_000 };
    const breaker = createCircuitBreaker({ now: () => clock.t });
    const BEFORE = "https://www.boatrace.jp/owpc/pc/race/beforeinfo";
    let status = 403;
    let n = 0;
    const f = createPoliteFetch({
      breaker,
      sleep: noSleep,
      canaryUrls: {},
      fetchImpl: async () => (n++, mkResponse(status)),
    });
    await f(`${BEFORE}?rno=1`).catch(() => {});
    clock.t += 30 * 60_000 + 1;
    status = 404;
    const r404 = await f(`${BEFORE}?rno=2`);
    const snap404 = breaker.snapshot(pathKeyOf(BEFORE));
    status = 200;
    const r200 = await f(`${BEFORE}?rno=3`);
    check(
      "半開の試行が 404 なら 403 のパスのブレーカーは閉じず（期限は残り、試行中の印だけ外す）、次の 200 で閉じる",
      r404.status === 404 &&
        snap404.openUntil > 0 &&
        snap404.probing === false &&
        r200.status === 200 &&
        breaker.snapshot(pathKeyOf(BEFORE)).openUntil === 0 &&
        n === 3,
      show(snap404),
    );
  }
  // 登録していないパスの 403 は従来どおり（BOATCAST は未公開のファイルを 403 で返すのが通常。ADR-0067）
  {
    const breaker = createCircuitBreaker({ now: () => 9_000_000 });
    let n = 0;
    const f = createPoliteFetch({
      breaker,
      sleep: noSleep,
      fetchImpl: async () => (n++, mkResponse(403)),
    });
    const a = await f(
      "https://race.boatcast.jp/txt/04/bc_oriten_20261026_04_01.txt",
    );
    const b = await f(
      "https://race.boatcast.jp/txt/04/bc_oriten_20261026_04_01.txt",
    );
    const c = await f("https://www.boatrace.jp/owpc/pc/race/racelist?rno=1");
    check(
      "登録していないパスの 403（BOATCAST・racelist）は、ブレーカーを開かず 403 をそのまま返す（従来どおり）",
      a.status === 403 &&
        b.status === 403 &&
        c.status === 403 &&
        n === 3 &&
        breaker.snapshot(pathKeyOf("https://race.boatcast.jp/txt/04/x.txt"))
          .openUntil === 0 &&
        breaker.snapshot(hostKeyOf("https://race.boatcast.jp/")).openUntil ===
          0,
    );
  }
}

async function scene2() {
  // 並列度の上限
  {
    let active = 0;
    let peak = 0;
    const f = createPoliteFetch({
      maxConcurrent: 3,
      sleep: noSleep,
      fetchImpl: async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
        return mkResponse(200);
      },
    });
    await Promise.all(
      Array.from({ length: 12 }, (_, i) => f(`https://www.boatrace.jp/${i}`)),
    );
    check(
      `politeFetch の同時実行数は上限（3）を超えない（最大${peak}）`,
      peak === 3,
    );

    let active2 = 0;
    let peak2 = 0;
    await mapWithConcurrency(
      Array.from({ length: 10 }, (_, i) => i),
      4,
      async () => {
        active2++;
        peak2 = Math.max(peak2, active2);
        await new Promise((r) => setTimeout(r, 3));
        active2--;
      },
    );
    check(
      `mapWithConcurrency の並列度は上限（4）を超えない（最大${peak2}）`,
      peak2 === 4,
    );
    const order = await mapWithConcurrency([30, 1, 10], 3, async (ms, i) => {
      await new Promise((r) => setTimeout(r, ms));
      return i;
    });
    check("mapWithConcurrency の結果は入力と同じ順序", same(order, [0, 1, 2]));
    const sem = createSemaphore(1);
    check("セマフォは初期状態で0", sem.active === 0);
  }
  // ---------------------------------------------------------------------------
  // (h) 共通ラッパ
  // ---------------------------------------------------------------------------
  T0 = new Date("2026-09-19T00:00:00Z");
  // 認証
  check(
    "認証: 正しいBearerのみ許可（未設定・不一致・長さ違いは拒否）",
    isAuthorized("Bearer s3cret", "s3cret") &&
      !isAuthorized("Bearer wrong!", "s3cret") &&
      !isAuthorized("Bearer s3cre", "s3cret") &&
      !isAuthorized("Bearer s3cret", undefined) &&
      !isAuthorized(undefined, "s3cret"),
  );
  // 075未適用
  {
    const store = createMemoryStore({ available: false });
    const r = await run(store, { handleSlot: async () => ({ outcome: "ok" }) });
    check(
      "075未適用（テーブルが無い）: 何もせず200（skipped）。書き込み・claimなし",
      r.status === 200 &&
        r.body.skipped === "scrape_schema_not_applied" &&
        noWrites(store),
      show(r),
    );
  }
  // 行なし → 作成して skipped
  {
    const store = createMemoryStore();
    const r = await run(store, { handleSlot: async () => ({ outcome: "ok" }) });
    check(
      "ジョブ状態の行が無い: mode=off の行を作り、何もせず200",
      r.status === 200 &&
        r.body.skipped === "mode_off" &&
        store.state.get("odds").mode === "off" &&
        noWrites(store),
      show(r),
    );
  }
}

async function scene3() {
  // off
  {
    const store = createMemoryStore({
      rows: { odds: { job: "odds", mode: "off" } },
    });
    const r = await run(store, { handleSlot: async () => ({ outcome: "ok" }) });
    check(
      "mode=off: 何もしない（tick・claimも書かない）",
      r.status === 200 && r.body.skipped === "mode_off" && noWrites(store),
    );
  }
  // 監視系（ゲートなし）は、行が無くても実行し、行を作って死活を記録する
  {
    const store = createMemoryStore();
    let ran = 0;
    const r = await run(store, {
      job: "scrape-monitor",
      modeGated: false,
      run: async () => {
        ran++;
        return { rowsWritten: 0 };
      },
    });
    check(
      "ゲートなし（監視）: 行が無くても実行し、行を作り、tickと成功を記録する",
      r.status === 200 &&
        ran === 1 &&
        store.state.get("scrape-monitor").last_tick_at &&
        store.state.get("scrape-monitor").last_success_at,
      show(r),
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・same・show） */
export async function runScrapeJobsScenes4(env) {
  ({ check, same, show } = env);
  await scene1();
  await scene2();
  await scene3();
}
