/**
 * verify-scrape-jobs.js の後半の場面（5/9）。verify ではない。
 * 判定と期待値は分ける前の verify-scrape-jobs.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { BreakerOpenError } from "../../lib/scrapeJobs/circuitBreaker.js";
import { CLAIM_FALLBACK_ALERT_KEY } from "../../lib/scrapeJobs/cronWrapper.js";
import { createMemoryStore } from "../../lib/scrapeJobs/testing/memoryStore.js";
import { runModeSlots, slot, run, mkClock } from "./scrape-jobs-scenes-4.js";

let check, same, show;

// shadow・live の1つのモード: claim のモードとハンドラーの ctx.mode・完了の記録
function checkModeClaims(mode, store, seen) {
  const claimCall = store.calls.find((c) => c.name === "claimSlots");
  check(
    `[${mode}] claim にモードを渡し、ハンドラーに ctx.mode を渡す`,
    claimCall.mode === mode &&
      seen.length === 5 &&
      seen.every((s) => s.mode === mode),
  );
  check(
    `[${mode}] ok・skipped_have_data は完了として記録（結果のダイジェスト・行数付き）`,
    store.completed.length === 2 &&
      store.completed[0].outcome === "ok" &&
      store.completed[0].resultDigest === "abc" &&
      store.completed[0].rowsWritten === 1 &&
      store.completed[1].outcome === "skipped_have_data" &&
      store.completed.every((c) => c.worker === "w-test"),
  );
}

// shadow・live の1つのモード: 再試行・実行の結果
function checkModeRetries(mode, clock, store, r) {
  const retryById = Object.fromEntries(
    store.retried.map((x) => [x.slot.race_id.slice(-2), x]),
  );
  check(
    `[${mode}] no_values は再試行（claim から50秒後。60秒−ジッター10秒）。outcome を残す`,
    retryById["03"]?.outcome === "no_values" &&
      retryById["03"].retryAt.getTime() === clock.c.t + 50_000,
  );
  check(
    `[${mode}] ハンドラーの例外は error として再試行に回し、他のスロットを止めない`,
    retryById["04"]?.outcome === "error" &&
      /解析エラー/.test(retryById["04"].error),
  );
  check(
    `[${mode}] 期待>0で解析0件は、ok でも error にして再試行（0件を成功にしない）`,
    retryById["05"]?.outcome === "error" && /0件/.test(retryById["05"].error),
  );
  check(
    `[${mode}] 一部が error でも他が成功なら、実行は成功（200）。成功を記録し、連続失敗を戻す`,
    r.status === 200 &&
      r.body.claimed === 5 &&
      same(r.body.outcomes, {
        ok: 1,
        skipped_have_data: 1,
        no_values: 1,
        error: 2,
      }) &&
      store.state.get("odds").consecutive_failures === 0,
    show(r.body),
  );
}

/** 元の verify の1つの塊 { } を割った 1/2 */
async function scene1() {
  const reason =
    "claim_scrape_slots_by_offset が無いため（マイグレーション092が未適用）、既存の claim_scrape_slots で取りました";
  const alertsOf = (store) => store.state.get("odds").last_report?.alerts;
  // フォールバックした・スロットなし: アラートを last_report に残し、応答にも出す
  let store = createMemoryStore({
    rows: { odds: { job: "odds", mode: "live" } },
  });
  store.setClaimFallback({ reason });
  let r = await run(store, { handleSlot: async () => ({ outcome: "ok" }) });
  check(
    "claim がフォールバックした（スロットなし）: last_report.alerts にアラート（key=claim_fallback・理由）を残し、応答に claimFallback を出す",
    r.status === 200 &&
      r.body.claimFallback === reason &&
      alertsOf(store)?.length === 1 &&
      alertsOf(store)[0].key === CLAIM_FALLBACK_ALERT_KEY &&
      alertsOf(store)[0].text === reason,
    show([r, alertsOf(store)]),
  );
  // フォールバックが続く・既にアラートがある: 毎分、書き直さない（recordSuccess を増やさない）
  const before = store.calls.filter((c) => c.name === "recordSuccess").length;
  store.setClaimFallback({ reason });
  r = await run(store, { handleSlot: async () => ({ outcome: "ok" }) });
  check(
    "フォールバックが続いても、既にアラートがあれば、ジョブ状態を書き直さない（毎分の更新にしない）。応答には出す",
    store.calls.filter((c) => c.name === "recordSuccess").length === before &&
      r.body.claimFallback === reason,
  );
  // 回復（092が適用され、新関数で取れた）: アラートを消す
  r = await run(store, { handleSlot: async () => ({ outcome: "ok" }) });
  check(
    "新関数で取れるようになったら（フォールバックなし）、前回のアラートを消す（last_report.alerts=[]）。応答に claimFallback は無い",
    alertsOf(store)?.length === 0 && r.body.claimFallback === undefined,
    show([r.body, alertsOf(store)]),
  );
  // 上書きのないジョブ（result）は、last_report のアラートを消さない（他のジョブの通知を巻き込まない）
  store = createMemoryStore({
    rows: {
      result: {
        job: "result",
        mode: "live",
        last_report: {
          alerts: [{ key: CLAIM_FALLBACK_ALERT_KEY, text: "他の通知" }],
        },
      },
    },
  });
  r = await run(store, {
    job: "result",
    handleSlot: async () => ({ outcome: "ok" }),
  });
  check(
    "上書きのないジョブ（result）は、フォールバックがなくても last_report を書き換えない",
    !store.calls.some((c) => c.name === "recordSuccess") &&
      store.state.get("result").last_report.alerts.length === 1,
  );
  // スロットを処理した実行でも、応答に出す。処理の成功の記録（recordSuccess）は last_report を上書きしない
  store = createMemoryStore({
    rows: { odds: { job: "odds", mode: "live" } },
    slots: [slot("2026-09-19-01-01")],
  });
  store.setClaimFallback({ reason });
  r = await run(store, { handleSlot: async () => ({ outcome: "ok" }) });
  return { reason, alertsOf, store, r };
}

/** 元の verify の1つの塊 { } を割った 2/2 */
function scene2({ reason, alertsOf, store, r }) {
  check(
    "フォールバックした実行でスロットを処理しても、取得は続く（completeSlot）。アラートは残り、応答に出る",
    r.status === 200 &&
      r.body.claimed === 1 &&
      store.completed.length === 1 &&
      r.body.claimFallback === reason &&
      alertsOf(store)?.[0]?.key === CLAIM_FALLBACK_ALERT_KEY,
    show([r, alertsOf(store)]),
  );
}

async function scene3() {
  // shadow・live: claim → ハンドラー → 完了/再試行
  for (const mode of ["shadow", "live"]) {
    const { clock, store, seen, r } = await runModeSlots(mode);
    checkModeClaims(mode, store, seen);
    checkModeRetries(mode, clock, store, r);
  }
  // 全スロットがerror → 500・連続失敗+1・成功を記録しない
  {
    const store = createMemoryStore({
      rows: { odds: { job: "odds", mode: "live", consecutive_failures: 1 } },
      slots: [slot("2026-09-19-01-01"), slot("2026-09-19-01-02")],
    });
    const r = await run(store, {
      handleSlot: async () => {
        throw new Error("取得先が落ちている");
      },
    });
    check(
      "処理した全スロットが error: HTTP 500、連続失敗を+1、last_error を残す",
      r.status === 500 &&
        r.body.success === false &&
        store.state.get("odds").consecutive_failures === 2 &&
        /取得先が落ちている/.test(store.state.get("odds").last_error) &&
        !store.calls.some((c) => c.name === "recordSuccess"),
      show(r),
    );
  }
  // 何も期限が来ていない tick: 書き込みは tick のみ（成功も記録しない）
  {
    const store = createMemoryStore({
      rows: { odds: { job: "odds", mode: "live" } },
    });
    const r = await run(store, { handleSlot: async () => ({ outcome: "ok" }) });
    check(
      "期限が来たスロットが無い tick: 200。記録は tick のみ（recordSuccess を毎分書かない）",
      r.status === 200 &&
        r.body.claimed === 0 &&
        store.calls.some((c) => c.name === "touchTick") &&
        !store.calls.some(
          (c) => c.name === "recordSuccess" || c.name === "completeSlot",
        ),
      show(r),
    );
  }
  {
    const s1 = await scene1();
    scene2(s1);
  }
  // ブレーカー
  {
    // 事前にブレーカーが開いている → スロットを取らない
    const clock = mkClock();
    const store = createMemoryStore({
      rows: { odds: { job: "odds", mode: "live" } },
      slots: [slot("2026-09-19-01-01")],
    });
    store.breakerStore.until = clock.c.t + 30_000;
    const r = await run(store, {
      clock,
      handleSlot: async () => ({ outcome: "ok" }),
    });
    check(
      "取得先のブレーカーが開いている: スロットを取らず（claimなし）200 で skipped",
      r.status === 200 &&
        r.body.skipped === "breaker_open" &&
        !store.calls.some((c) => c.name === "claimSlots"),
      show(r),
    );
  }
  {
    // 実行中にブレーカーが開く: breaker_open として、開く期限まで再試行を遅らせる
    const clock = mkClock();
    const store = createMemoryStore({
      rows: { odds: { job: "odds", mode: "live" } },
      slots: [slot("2026-09-19-01-01")],
    });
    const until = clock.c.t + 90_000;
    const r = await run(store, {
      clock,
      handleSlot: async () => {
        throw new BreakerOpenError("host:boatrace.jp", until);
      },
    });
    check(
      "実行中にブレーカーが開いた: outcome=breaker_open。再試行はブレーカーの期限まで遅らせる。失敗には数えない",
      store.retried.length === 1 &&
        store.retried[0].outcome === "breaker_open" &&
        store.retried[0].retryAt.getTime() === until &&
        r.status === 200,
      show(store.retried),
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・same・show） */
export async function runScrapeJobsScenes5(env) {
  ({ check, same, show } = env);
  await scene3();
}
