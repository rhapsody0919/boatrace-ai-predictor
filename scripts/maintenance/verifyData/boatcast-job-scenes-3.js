/**
 * verify-boatcast-job.js の後半の場面（3/6）。verify ではない。
 * 判定と期待値は分ける前の verify-boatcast-job.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import * as realJob from "../../lib/boatcast/oritenJob.js";
import {
  fetchMotorStartDates,
  ABORT_AFTER_CONSECUTIVE_FAILURES,
  MOTOR_START_JOB,
  createMotorStartRun,
} from "../../lib/boatcast/motorStartJob.js";
import { runScrapeJob } from "../../lib/scrapeJobs/cronWrapper.js";
import { createMemoryStore } from "../../lib/scrapeJobs/testing/memoryStore.js";
import { createFakeSupabaseClient } from "../../lib/scrapeJobs/testing/fakeSupabaseClient.js";
import {
  show,
  freshClient,
  createFakeFetch,
  routeOriten,
  HTML_ERROR,
  FORBIDDEN,
  same,
} from "./boatcast-job-fixtures.js";
import { runWrapped, noWaitPacer } from "./boatcast-job-scenes-1.js";

let check;

// ---------------------------------------------------------------------------
// (f) モーター使用開始日（日次）
// ---------------------------------------------------------------------------
export const mstRouter =
  (over = {}) =>
  (url) => {
    const jo = /bc_mst_(\d{2})\.txt/.exec(url)?.[1];
    if (over[jo]) return over[jo];
    const n = Number(jo);
    return {
      status: 200,
      body: `2026${String((n % 12) + 1).padStart(2, "0")}15\n`,
    };
  };

export async function runDaily({ mode, client, fetchImpl, rows, targetNow }) {
  const memory = createMemoryStore({
    rows: rows ?? {
      [MOTOR_START_JOB]: {
        job: MOTOR_START_JOB,
        mode,
        consecutive_failures: 0,
      },
    },
  });
  const result = await runScrapeJob({
    job: MOTOR_START_JOB,
    store: memory,
    run: createMotorStartRun({ pacer: noWaitPacer }),
    now: () => targetNow ?? new Date("2026-09-21T06:40:00+09:00"),
    client,
    politeFetch: fetchImpl,
  });
  return { result, store: memory };
}

/** 元の verify の1つの塊 { } を割った 1/2 */
function scene1() {
  const now = new Date("2026-09-21T10:30:00+09:00");
  const tick = (over) => ({
    canary: null,
    anomalies: [],
    warnings: [],
    venueAlerts: [],
    ...over,
  });
  const failedTick = tick({ canary: { ok: false, detail: "HTTP 403" } });
  const r1 = realJob.mergeReport(undefined, failedTick, now);
  check(
    "(e) 通知: カナリア失敗 → canary_failed（60分のuntil）",
    r1?.alerts.length === 1 &&
      r1.alerts[0].key === "canary_failed" &&
      new Date(r1.alerts[0].until).getTime() === now.getTime() + 60 * 60 * 1000,
  );
  const r2 = realJob.mergeReport(
    r1,
    tick({ canary: { ok: true, detail: "ok" } }),
    new Date(now.getTime() + 60000),
  );
  check(
    "(e) 通知: カナリアが正常に戻ると canary_failed を外す",
    r2?.alerts.length === 0,
    show(r2),
  );
  const r3 = realJob.mergeReport(
    undefined,
    tick({ anomalies: ["x"], warnings: ["y"] }),
    now,
  );
  check(
    "(e) 通知: parse_anomaly（構造の異常・項目名の不一致の件数と例）",
    r3?.alerts[0].key === "parse_anomaly" && /2件/.test(r3.alerts[0].text),
  );
  check(
    "(e) 通知: 変化が無ければ書かない（undefined）",
    realJob.mergeReport({ alerts: [] }, tick(), now) === undefined &&
      realJob.mergeReport(r1, tick(), new Date(now.getTime() + 1000)) ===
        undefined,
  );
  check(
    "(e) 通知: until を過ぎた前回の通知は残さない",
    realJob.mergeReport(r1, tick(), new Date(now.getTime() + 2 * 3600 * 1000))
      ?.alerts.length === 0,
  );
  const r4 = realJob.mergeReport(
    undefined,
    tick({ venueAlerts: [{ key: "no_data:10", text: "三国" }] }),
    now,
  );
  return { r4 };
}

/** 元の verify の1つの塊 { } を割った 2/2 */
async function scene2({ r4 }) {
  check(
    "(e) 通知: 会場のデータ無し（no_data:会場）",
    r4?.alerts[0].key === "no_data:10" && r4.alerts[0].until,
  );
  // 会場のデータ無しの閾値
  const slotRows = (n, outcome) =>
    Array.from({ length: n }, (_, i) => ({
      job: realJob.ORITEN_JOB,
      race_id: `2026-09-21-10-${String(i + 1).padStart(2, "0")}`,
      race_date: "2026-09-21",
      status: "done",
      outcome,
    }));
  const many = createFakeSupabaseClient({
    tables: {
      scrape_slots: [
        ...slotRows(2, "skipped_not_target"),
        ...slotRows(0, "ok"),
      ],
    },
  });
  const alert = await realJob.evaluateVenueNoData(many, "2026-09-21-10-12");
  const few = createFakeSupabaseClient({
    tables: {
      scrape_slots: [
        ...slotRows(1, "skipped_not_target"),
        ...slotRows(8, "ok").map((s, i) => ({
          ...s,
          race_id: `2026-09-21-10-${20 + i}`,
        })),
      ],
    },
  });
  const noAlert = await realJob.evaluateVenueNoData(few, "2026-09-21-10-12");
  check(
    "(e) 会場のデータ無し: 完了レースの半分以上・3件以上（今回を含む）で通知。1件（三国R12のような散発）では通知しない",
    alert?.key === "no_data:10" && noAlert === null,
    show({ alert, noAlert }),
  );
  // parse_anomaly が起動の通知に入る
  const client = freshClient();
  const fetchImpl = createFakeFetch(
    routeOriten(() => ({ status: 200, body: HTML_ERROR })),
  );
  const { store } = await runWrapped({ mode: "live", client, fetchImpl });
  check(
    "(e) 200でHTML（構造の変化）: スロットは error・last_report.alerts に parse_anomaly",
    store.retried[0]?.outcome === "error" &&
      store.state
        .get(realJob.ORITEN_JOB)
        .last_report?.alerts?.some((a) => a.key === "parse_anomaly"),
    show(store.state.get(realJob.ORITEN_JOB)),
  );
}

async function scene3() {
  {
    const s1 = scene1();
    await scene2(s1);
  }
  {
    const f = createFakeFetch(mstRouter());
    const r = await fetchMotorStartDates({ fetchImpl: f, pacer: noWaitPacer });
    check(
      "(f) 全24会場を取得・解析する（hp_txt/{jo}/bc_mst_{jo}.txt）",
      r.rows.length === 24 &&
        r.failures.length === 0 &&
        f.calls.length === 24 &&
        f.calls.every((u) => /\/hp_txt\/\d{2}\/bc_mst_\d{2}\.txt$/.test(u)) &&
        r.rows[0].venue_code === 1 &&
        /^\d{4}-\d{2}-\d{2}$/.test(r.rows[0].start_date),
    );
    const partial = await fetchMotorStartDates({
      fetchImpl: createFakeFetch(
        mstRouter({ "07": FORBIDDEN, 15: { status: 200, body: "abc" } }),
      ),
      pacer: noWaitPacer,
    });
    check(
      "(f) 一部（403・本文不正）が失敗しても、他は取る（失敗の会場と理由を返す）",
      partial.rows.length === 22 &&
        same(
          partial.failures.map((x) => x.venue),
          ["07", "15"],
        ) &&
        !partial.aborted,
    );
    const blocked = await fetchMotorStartDates({
      fetchImpl: createFakeFetch(() => FORBIDDEN),
      pacer: noWaitPacer,
    });
    check(
      `(f) 最初から${ABORT_AFTER_CONSECUTIVE_FAILURES}件続けて失敗したら、取得を止める（アクセス拒否・接続の異常の疑い。リクエストは3件）`,
      blocked.aborted === true &&
        blocked.failures.length === 3 &&
        blocked.rows.length === 0,
    );
    const stopped = await fetchMotorStartDates({
      fetchImpl: createFakeFetch(mstRouter()),
      pacer: noWaitPacer,
      shouldStop: (() => {
        let n = 0;
        return () => ++n > 5;
      })(),
    });
    check(
      "(f) 時間切れ（ソフトデッドライン）で止まる",
      stopped.stopped === true && stopped.rows.length === 5,
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check） */
export async function runBoatcastJobScenes3(env) {
  ({ check } = env);
  await scene3();
}
