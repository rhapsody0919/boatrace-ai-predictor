/**
 * verify-scrape-jobs.js の後半の場面（7/9）。verify ではない。
 * 判定と期待値は分ける前の verify-scrape-jobs.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { createCircuitBreaker } from "../../lib/scrapeJobs/circuitBreaker.js";
import { shouldEnsureSlots, runScrapeJob } from "../../lib/scrapeJobs/cronWrapper.js";
import { createMemoryStore } from "../../lib/scrapeJobs/testing/memoryStore.js";
import { mkClock, run, slot } from "./scrape-jobs-scenes-4.js";

let check, show;

async function scene1() {
  // 予定表の生成の頻度
  {
    const at = (iso) => new Date(iso);
    check(
      "予定表の生成: 10分に1回（分が10の倍数のとき）",
      shouldEnsureSlots(at("2026-09-19T00:10:30Z"), "2026-09-19T00:05:00Z") &&
        !shouldEnsureSlots(at("2026-09-19T00:11:30Z"), "2026-09-19T00:10:00Z"),
    );
    check(
      "予定表の生成: その日の最初の起動・ジョブを日中に有効化した直後（last_tick_atが無い/前日）は、分に関わらず生成",
      shouldEnsureSlots(at("2026-09-19T00:03:00Z"), null) &&
        shouldEnsureSlots(at("2026-09-19T00:03:00Z"), "2026-09-18T14:00:00Z") &&
        !shouldEnsureSlots(at("2026-09-19T00:03:00Z"), "2026-09-19T00:00:00Z"),
    );
  }
  // 日次ジョブ
  {
    const clock = mkClock(new Date("2026-09-18T16:51:00Z")); // 9/19 01:51 JST（22:00指定が遅れて起動）
    const store = createMemoryStore({
      rows: { point_rank: { job: "point_rank", mode: "live" } },
    });
    let target;
    const r = await run(store, {
      job: "point_rank",
      clock,
      run: async (ctx) => {
        target = ctx.targetDate;
        return { rowsWritten: 10, rowsParsed: 10, rowsExpected: 10 };
      },
    });
    check(
      "日次（22:00指定）が翌01:51に起動しても、対象日は前日。成功で last_target_date を記録し、リースを解放する",
      target === "2026-09-18" &&
        store.state.get("point_rank").last_target_date === "2026-09-18" &&
        store.state.get("point_rank").claimed_by === null &&
        r.status === 200 &&
        r.body.targetDate === "2026-09-18",
      show({ target, r }),
    );
    // 補足の起動: 対象日が成功済みなら何もしない
    let calls = 0;
    const r2 = await run(store, {
      job: "point_rank",
      clock,
      run: async () => {
        calls++;
        return {};
      },
    });
    check(
      "補足の起動: 対象日が成功済みなら何もしない（冪等。リースも取らない）",
      r2.body.skipped === "already_done" &&
        calls === 0 &&
        store.calls.filter((c) => c.name === "acquireLease").length === 1,
      show(r2),
    );
    // 翌日の指定時刻を過ぎると、次の対象日を処理する
    clock.c.t = new Date("2026-09-19T13:30:00Z").getTime(); // 9/19 22:30 JST
    const r3 = await run(store, {
      job: "point_rank",
      clock,
      run: async (ctx) => {
        target = ctx.targetDate;
        return { rowsWritten: 5 };
      },
    });
    check(
      "次の指定時刻を過ぎたら、新しい対象日を処理する",
      r3.status === 200 && target === "2026-09-19",
    );
  }
  {
    const store = createMemoryStore({
      rows: { point_rank: { job: "point_rank", mode: "shadow" } },
    });
    await run(store, {
      job: "point_rank",
      clock: mkClock(new Date("2026-09-19T13:30:00Z")),
      run: async () => ({ rowsWritten: 0 }),
    });
    check(
      "日次の shadow は last_target_date を更新しない（live に切り替えた日の分を処理できるように）",
      !store.state.get("point_rank").last_target_date &&
        store.state.get("point_rank").last_success_at,
    );
  }
}

async function scene2() {
  {
    const store = createMemoryStore({
      rows: { point_rank: { job: "point_rank", mode: "live" } },
      leaseHeld: true,
    });
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
      "リースを他の実行が持っていたら何もしない",
      r.body.skipped === "lease_held" &&
        called === 0 &&
        !store.calls.some((c) => c.name === "releaseLease"),
    );
  }
  {
    const store = createMemoryStore({
      rows: {
        point_rank: {
          job: "point_rank",
          mode: "live",
          consecutive_failures: 2,
        },
      },
    });
    const r = await run(store, {
      job: "point_rank",
      clock: mkClock(new Date("2026-09-19T13:30:00Z")),
      run: async () => ({ rowsExpected: 20, rowsParsed: 0, rowsWritten: 0 }),
    });
    check(
      "日次: 期待>0で解析0件は失敗（500）。対象日を済みにせず、連続失敗+1、リースを解放する",
      r.status === 500 &&
        !store.state.get("point_rank").last_target_date &&
        store.state.get("point_rank").consecutive_failures === 3 &&
        store.state.get("point_rank").claimed_by === null,
      show(r),
    );
    const r2 = await run(store, {
      job: "point_rank",
      clock: mkClock(new Date("2026-09-19T13:31:00Z")),
      run: async () => {
        throw new Error("取得先が落ちている");
      },
    });
    check(
      "日次: run() の例外は500、リースを必ず解放する",
      r2.status === 500 &&
        store.state.get("point_rank").claimed_by === null &&
        /取得先/.test(r2.body.error),
    );
  }
  // DB障害
  {
    const store = createMemoryStore({
      rows: { odds: { job: "odds", mode: "live" } },
    });
    store.readState = async () => {
      throw new Error(
        "ジョブ状態(odds)の読み取りに失敗しました: connection reset",
      );
    };
    const r = await run(store, { handleSlot: async () => ({ outcome: "ok" }) });
    check(
      "ジョブ状態の読み取りのDB障害は、skippedにせず500",
      r.status === 500 && /connection reset/.test(r.body.error),
    );
  }
  {
    const store = createMemoryStore({
      rows: { odds: { job: "odds", mode: "live" } },
      slots: [slot("2026-09-19-01-01")],
    });
    store.claimSlots = async () => {
      throw new Error(
        "スロットの取得(claim_scrape_slots, odds)に失敗しました: timeout",
      );
    };
    const r = await run(store, { handleSlot: async () => ({ outcome: "ok" }) });
    check(
      "claim のDBエラーは「対象なし」に化けさせず500。失敗を記録する",
      r.status === 500 && store.state.get("odds").consecutive_failures === 1,
      show(r),
    );
  }
}

async function scene3() {
  {
    const r = await runScrapeJob({
      job: "unknown_job",
      store: createMemoryStore(),
      breaker: createCircuitBreaker(),
      politeFetch: async () => new Response(""),
    });
    check("未登録のジョブは500", r.status === 500);
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・show） */
export async function runScrapeJobsScenes7(env) {
  ({ check, show } = env);
  await scene1();
  await scene2();
  await scene3();
}
