/**
 * verify-boatcast-job.js の後半の場面（1/6）。verify ではない。
 * 判定と期待値は分ける前の verify-boatcast-job.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import * as realJob from "../../lib/boatcast/oritenJob.js";
import { CANARY_URL, buildOritenUrl, checkCanary } from "../../lib/boatcast/boatcastClient.js";
import { runScrapeJob } from "../../lib/scrapeJobs/cronWrapper.js";
import { BreakerOpenError } from "../../lib/scrapeJobs/circuitBreaker.js";
import { computeWindowStats } from "../../lib/scrapeJobs/monitor.js";
import { createMemoryStore } from "../../lib/scrapeJobs/testing/memoryStore.js";
import { evaluateJobStates } from "../../lib/scrapeJobs/monitor.js";
import {
  RACE_ID,
  freshClient,
  createFakeFetch,
  routeOriten,
  same,
  show,
  THREE,
  FORBIDDEN,
  HTML_ERROR,
  OK_MST,
} from "./boatcast-job-fixtures.js";

let check, SLOT;

export const NOW = () => new Date("2026-09-21T10:22:40+09:00");

 // 発走(10:30)の約7分前
export const noWaitPacer = { wait: async () => {} };

export async function runWrapped({
  mode,
  rows,
  client,
  fetchImpl,
  slots,
  handlerOptions = {},
  now = NOW,
}) {
  realJob.clearTicks();
  const memory = createMemoryStore({
    rows: rows ?? {
      [realJob.ORITEN_JOB]: {
        job: realJob.ORITEN_JOB,
        mode,
        consecutive_failures: 0,
      },
    },
    slots: slots ?? [SLOT(RACE_ID)],
  });
  const store = realJob.createOritenStore(client, {
    base: memory,
    // 全て失敗した起動の last_report は、共通ラッパを経由せず直接書く（本番は scrape_job_state の update）。テストではメモリのストアへ
    saveReport: async (job, report) => {
      memory.state.get(job).last_report = report;
    },
  });
  const result = await runScrapeJob({
    job: realJob.ORITEN_JOB,
    store,
    handleSlot: realJob.createOritenSlotHandler({
      pacer: noWaitPacer,
      venueNoData: async () => null,
      ...handlerOptions,
    }),
    now,
    client,
    modeGated: true,
    politeFetch: fetchImpl,
  });
  return { result, store: memory };
}

async function scene1() {
  {
    const client = freshClient();
    const oriten = () => ({
      status: 200,
      body: THREE,
      lastModified: "Mon, 21 Sep 2026 01:16:32 GMT",
    });
    const f0 = createFakeFetch(routeOriten(oriten));
    const off = await runWrapped({ mode: "off", client, fetchImpl: f0 });
    check(
      "(d) off: 何も取得せず、DBにも予定表にも書かない",
      off.result.body.skipped === "mode_off" &&
        f0.calls.length === 0 &&
        client.writes.length === 0 &&
        off.store.completed.length === 0,
    );
    const noRow = await runWrapped({ rows: {}, client, fetchImpl: f0 });
    check(
      "(d) 行なし: off として扱い、何も取得しない（行を作るのみ）",
      noRow.result.body.skipped === "mode_off" &&
        f0.calls.length === 0 &&
        noRow.store.state.get(realJob.ORITEN_JOB)?.mode === "off",
    );

    const f1 = createFakeFetch(routeOriten(oriten));
    const shadow = await runWrapped({ mode: "shadow", client, fetchImpl: f1 });
    check(
      "(d) shadow: 取得・解析のみ。データには書かず、予定表に result_digest を残す。カナリア→オリジナル展示の順に2リクエスト",
      same(f1.calls, [CANARY_URL, buildOritenUrl(RACE_ID)]) &&
        client.writes.length === 0 &&
        shadow.store.completed.length === 1 &&
        shadow.store.completed[0].outcome === "ok" &&
        shadow.store.completed[0].resultDigest?.length === 64,
      show(f1.calls),
    );
    const f2 = createFakeFetch(routeOriten(oriten));
    const live = await runWrapped({ mode: "live", client, fetchImpl: f2 });
    check(
      "(d) live: 書き込み、予定表を完了にする",
      client.data.race_original_exhibition_values.length === 18 &&
        live.store.completed.length === 1 &&
        live.store.completed[0].rowsWritten === 19,
    );
  }
}

async function scene2() {
  {
    // カナリア: 各tickの先頭で1回だけ。複数スロットでも1回
    const client = freshClient({
      races: ["05", "06", "12"].map((jo) => ({
        race_id: `2026-09-21-${jo}-01`,
        race_date: "2026-09-21",
        start_time: "10:30:00",
      })),
    });
    const fetchImpl = createFakeFetch(
      routeOriten(() => ({ status: 200, body: THREE })),
    );
    const { store } = await runWrapped({
      mode: "shadow",
      client,
      fetchImpl,
      slots: ["05", "06", "12"].map((jo) => SLOT(`2026-09-21-${jo}-01`)),
    });
    check(
      "(d) カナリア: 複数スロットでも、tickの先頭で1回だけ（最初のリクエストがカナリア）",
      fetchImpl.calls.filter((u) => u === CANARY_URL).length === 1 &&
        fetchImpl.calls[0] === CANARY_URL &&
        fetchImpl.calls.length === 4 &&
        store.completed.length === 3,
      show(fetchImpl.calls),
    );
  }
}

async function scene3() {
  {
    // カナリアが403: データを取らず、全スロットが error（データ無しにしない）。alerts に出す。連続失敗で監視が通知
    const client = freshClient();
    const fetchImpl = createFakeFetch(() => FORBIDDEN);
    const { result, store } = await runWrapped({
      mode: "live",
      client,
      fetchImpl,
    });
    const state = store.state.get(realJob.ORITEN_JOB);
    check(
      "(d) カナリアが403: データを取らない（リクエストはカナリアの1件のみ）。スロットは error で再試行（打ち切りにしない）",
      same(fetchImpl.calls, [CANARY_URL]) &&
        store.retried.length === 1 &&
        store.retried[0].outcome === "error" &&
        /canary_failed/.test(store.retried[0].error) &&
        store.completed.length === 0 &&
        result.status === 500,
      show({
        calls: fetchImpl.calls,
        retried: store.retried.map((r) => r.outcome),
      }),
    );
    check(
      "(d) カナリアが403: last_report.alerts に canary_failed（until付き）。連続失敗も記録される",
      state.last_report?.alerts?.some(
        (a) =>
          a.key === "canary_failed" && a.until && a.text.includes("カナリア"),
      ) && state.consecutive_failures === 1,
      show(state.last_report),
    );
    // 監視が、last_report.alerts を通知する
    const alerts = evaluateJobStates(
      [
        {
          job: realJob.ORITEN_JOB,
          mode: "live",
          ...state,
          last_tick_at: NOW().toISOString(),
        },
      ],
      NOW(),
    );
    check(
      "(d) 監視: canary_failed が job_report として通知される",
      alerts.some(
        (a) => a.kind === "job_report" && a.key.endsWith("canary_failed"),
      ),
      show(alerts),
    );
    // カナリアが本文不正（200だがYYYYMMDDでない）・ネットワークエラーも失敗
    const bodyBad = await checkCanary({
      fetchImpl: createFakeFetch(() => ({ status: 200, body: HTML_ERROR })),
      pacer: noWaitPacer,
    });
    const netErr = await checkCanary({
      fetchImpl: async () => {
        throw new Error("ECONNRESET");
      },
      pacer: noWaitPacer,
    });
    const okCanary = await checkCanary({
      fetchImpl: createFakeFetch(() => OK_MST),
      pacer: noWaitPacer,
    });
    check(
      "(d) カナリア判定: 200＋YYYYMMDD だけが ok（403・本文不正・ネットワークエラーは失敗）",
      okCanary.ok && !bodyBad.ok && !netErr.ok && netErr.status === null,
    );
  }
}

async function scene4() {
  {
    // ブレーカーが開いている（politeFetch が BreakerOpenError を投げる）: カナリアの失敗として通知せず、breaker_open で再試行する
    const client = freshClient();
    const until = new Date("2026-09-21T10:24:00+09:00").getTime();
    const { result, store } = await runWrapped({
      mode: "live",
      client,
      fetchImpl: async () => {
        throw new BreakerOpenError("host:race.boatcast.jp", until);
      },
    });
    const state = store.state.get(realJob.ORITEN_JOB);
    check(
      "(d) ブレーカーが開いている: canary_failed の通知を出さず、breaker_open で再試行する（ブレーカーが閉じる頃まで）",
      store.retried.length === 1 &&
        store.retried[0].outcome === "breaker_open" &&
        new Date(store.retried[0].retryAt).getTime() === until &&
        !state.last_report?.alerts?.some((a) => a.key === "canary_failed") &&
        result.status === 200,
      show({
        retried: store.retried.map((r) => r.outcome),
        report: state.last_report,
      }),
    );
  }
  {
    // カナリアが正常で、データが403: 未公開（再試行）→ 打ち切り
    const client = freshClient();
    const f403 = createFakeFetch(routeOriten(() => FORBIDDEN));
    const early = await runWrapped({ mode: "live", client, fetchImpl: f403 });
    const claimedMs = new Date("2026-09-21T10:22:30+09:00").getTime();
    check(
      "(d) 403（カナリア正常）: 発走の約7分前（窓の中）→ no_values で再試行（claimから110秒後＝次の次の毎分の起動）",
      early.store.retried.length === 1 &&
        early.store.retried[0].outcome === "no_values" &&
        new Date(early.store.retried[0].retryAt).getTime() ===
          claimedMs + 110 * 1000 &&
        early.store.completed.length === 0,
      show(early.store.retried.map((r) => [r.outcome, r.retryAt])),
    );
    const late = await runWrapped({
      mode: "live",
      client,
      fetchImpl: createFakeFetch(routeOriten(() => FORBIDDEN)),
      now: () => new Date("2026-09-21T10:36:00+09:00"),
      slots: [SLOT(RACE_ID, { last_attempt_at: "2026-09-21T10:36:00+09:00" })],
    });
    // 発走までの分は claim の時刻から測る: -8分の取得（claim 10:22:05、m=7.9）が、同じ起動の後ろの順番で処理され
    // 処理の時刻が m=6.3 になっても、窓の中（2分後）のまま
    const queued = await runWrapped({
      mode: "live",
      client,
      fetchImpl: createFakeFetch(routeOriten(() => FORBIDDEN)),
      now: () => new Date("2026-09-21T10:23:40+09:00"),
      slots: [SLOT(RACE_ID, { last_attempt_at: "2026-09-21T10:22:05+09:00" })],
    });
    check(
      "(d) 403: 発走までの分は claim の時刻から測る（処理の順番で後ろになっても、窓と後段の境目をまたがない）",
      queued.store.retried.length === 1 &&
        new Date(queued.store.retried[0].retryAt).getTime() ===
          new Date("2026-09-21T10:23:55+09:00").getTime(),
      show(queued.store.retried.map((r) => r.retryAt)),
    );
    check(
      "(d) 403（カナリア正常）: 発走の6分後 → 打ち切り（skipped_not_target で完了。予定表の expired にしない）",
      late.store.completed.length === 1 &&
        late.store.completed[0].outcome === "skipped_not_target",
      show(late.store.completed.map((c) => c.outcome)),
    );
    const stats = computeWindowStats([
      ...[
        ["ok", "2026-09-21T01:23:00Z"],
        ["skipped_not_target", "2026-09-21T01:36:00Z"],
      ].map(([outcome, doneAt]) => ({
        job: realJob.ORITEN_JOB,
        race_id: "r",
        offset_min: -8,
        race_date: "2026-09-21",
        status: "done",
        outcome,
        run_mode: "live",
        done_at: doneAt,
        races: { start_time: "10:30:00", cancellation_status: null },
      })),
    ]);
    check(
      "(d) 監視: 打ち切り（skipped_not_target）は窓内取得率の分母に入れない",
      stats.length === 1 && stats[0].total === 1,
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・SLOT） */
export async function runBoatcastJobScenes1(env) {
  ({ check, SLOT } = env);
  await scene1();
  await scene2();
  await scene3();
  await scene4();
}
