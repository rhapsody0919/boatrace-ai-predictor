/**
 * verify-data-health-job.js の後半の場面（3/5）。verify ではない。
 * 判定と期待値は分ける前の verify-data-health-job.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import path from "node:path";
import { NIGHTLY_FRESHNESS_CHECKS } from "../../lib/dataHealth/checks.js";
import {
  NIGHTLY_FRESHNESS_ITEMS,
  TABLE_ROWS_TABLES,
  functionByName,
} from "../../lib/dataHealth/functions.js";
import {
  runDataHealthChecks,
  runDataHealthMorningJob,
  runDataHealthJob,
  createRpcCaller,
} from "../../lib/dataHealth/job.js";
import { runScrapeJob } from "../../lib/scrapeJobs/cronWrapper.js";
import { createMemoryStore } from "../../lib/scrapeJobs/testing/memoryStore.js";
import {
  show,
  allFresh,
  NOW,
  dates,
  makeCaller,
  TARGET,
  coverageRow,
} from "./data-health-job-fixtures.js";
import { evaluateScenarios } from "./data-health-job-scenarios.js";
import { scenariosForJob } from "./data-health-job-for-job.js";

let LIB, check;
let jobMod;
export let evalMod;

// 共通ラッパ経由
export const liveRow = { job: "data_health", mode: "live", consecutive_failures: 0 };

export async function wrapperRun({ rows, at = NOW, caller, worker = "verify" }) {
  const store = createMemoryStore({ rows });
  const res = await runScrapeJob({
    job: "data_health",
    run: (ctx) => runDataHealthJob(ctx, { callFunction: caller }),
    store,
    client: {},
    now: () => at,
    worker,
  });
  return { res, store };
}

async function scene1() {
  // 鮮度の実行: 夜は data_health（評価の終端=前日）、朝は data_health_morning（評価の終端=当日・空テーブルを見ない）
  {
    const nightStale = Object.fromEntries(
      NIGHTLY_FRESHNESS_ITEMS.map((i) => [
        i.key,
        { applicable: true, ok: false, observed: "2026-10-18T16:00:00+00:00" },
      ]),
    );
    const calls = [];
    const caller = async (fn, args) => {
      calls.push({ name: fn.name, args });
      if (fn.name === "data_health_nightly_freshness") return nightStale;
      if (fn.name === "data_health_table_rows")
        return Object.fromEntries(TABLE_ROWS_TABLES.map((t) => [t, true]));
      if (fn.items) return allFresh(fn.items);
      return [];
    };
    const { alerts } = await runDataHealthChecks({
      targetDate: "2026-10-20",
      now: new Date("2026-10-19T21:35:00Z"),
      mode: "live",
      callFunction: caller,
      checks: NIGHTLY_FRESHNESS_CHECKS,
    });
    const nightCall = calls.find(
      (c) => c.name === "data_health_nightly_freshness",
    );
    check(
      "鮮度の実行（夜）: 関数に p_to=前日 を渡し、12本が全て未達なら共通原因の要約を先頭に、12件を通知する（2026-10-20 朝の型。11/25 に growth_gsc を足して12本）",
      nightCall?.args.p_to === "2026-10-19" &&
        alerts.length === 13 &&
        alerts[0].key === "dh:summary:2026-10-20" &&
        alerts.some((a) => a.key === "dh:nightly.accuracy:2026-10-20"),
      show({ nightCall, n: alerts.length, keys: alerts.map((a) => a.key) }),
    );
    const morningCalls = [];
    const sonarZero = async (fn, args) => {
      morningCalls.push({ name: fn.name, args });
      return {
        sonar_racecard: { applicable: true, ok: false, observed: 0 },
        poirot_predictions: { applicable: true, ok: false, observed: 0 },
        moriarty_recommendations: { applicable: true, ok: false, observed: 0 },
      };
    };
    const out = await runDataHealthMorningJob(
      {
        targetDate: "2026-10-20",
        now: () => new Date("2026-10-19T22:55:00Z"),
        mode: "live",
        state: null,
        client: {},
      },
      { callFunction: sonarZero },
    );
    check(
      "朝のジョブ: 関数を1回だけ p_to=当日 で呼び、空テーブルの関数は呼ばない。ソナーの0件だけ通知し、ポアロ・モリアーティは info（通知しない・last_report に載る）",
      morningCalls.length === 1 &&
        morningCalls[0].name === "data_health_morning_freshness" &&
        morningCalls[0].args.p_to === "2026-10-20" &&
        out.report.alerts.length === 1 &&
        out.report.alerts[0].key === "dh:morning.sonar:2026-10-20" &&
        out.report.checks.filter((c) => c.status === "breach").length === 3,
      show({
        morningCalls,
        alerts: out.report.alerts,
        checks: out.report.checks,
      }),
    );
    const shadow = await runDataHealthMorningJob(
      {
        targetDate: "2026-10-20",
        now: () => new Date("2026-10-19T22:55:00Z"),
        mode: "shadow",
        state: null,
        client: {},
      },
      { callFunction: sonarZero },
    );
    check(
      "朝のジョブ: shadow は通知せず、wouldAlert に残す",
      shadow.report.alerts.length === 0 && shadow.report.wouldAlert.length === 1,
      show(shadow.report),
    );
  }
  evalMod = await import(path.join(LIB, "evaluate.js"));
  {
    const results = await evaluateScenarios(evalMod);
    for (const r of results) check(r.label, r.pass, r.detail);
  }
  jobMod = await import(path.join(LIB, "job.js"));
}

async function scene2() {
  {
    const results = await scenariosForJob(jobMod);
    for (const r of results) check(r.label, r.pass, r.detail);
  }
  {
    const badRows = dates.map((d) =>
      coverageRow(d, d === "2026-09-18" ? { odds: 50 } : {}),
    );
    const { res, store } = await wrapperRun({
      rows: { data_health: { ...liveRow } },
      caller: makeCaller({ coverage: badRows }),
    });
    const row = store.state.get("data_health");
    check(
      "共通ラッパ: live で成功し、対象日（06:30指定→当日）を処理済みにして、last_report に結果・通知・状態を残す。rowsWritten は0（データテーブルへ書かない）",
      res.status === 200 &&
        row.last_target_date === TARGET &&
        row.last_report.alerts.length === 1 &&
        row.last_report.emitted["coverage.odds"] !== undefined &&
        row.last_rows_written === 0,
      show(res),
    );
    const second = await wrapperRun({
      rows: { data_health: { ...row } },
      at: new Date("2026-09-21T22:35:00Z"),
      caller: makeCaller({ coverage: badRows }),
    });
    check(
      "共通ラッパ: 補足の起動（07:35 JST）は、処理済みの対象日を再処理しない（冪等・DBを読まない）",
      second.res.body.skipped === "already_done",
      show(second.res.body),
    );
    const nextDay = await wrapperRun({
      rows: { data_health: { ...row } },
      at: new Date("2026-09-22T21:35:00Z"),
      caller: makeCaller({ coverage: badRows }),
    });
    check(
      "共通ラッパ: 翌日の実行で、同じ未達は通知しない（前回の last_report.emitted を引き継ぐ）",
      nextDay.res.status === 200 &&
        nextDay.store.state.get("data_health").last_report.alerts.length === 0 &&
        nextDay.store.state.get("data_health").last_report.emitted[
          "coverage.odds"
        ] !== undefined,
      show(nextDay.res.body),
    );
    const off = await wrapperRun({ rows: {}, caller: makeCaller() });
    check(
      "共通ラッパ: 行が無い（off）間は何もしない（関数を呼ばない）",
      off.res.body.skipped === "mode_off",
      show(off.res.body),
    );
    const failing = await wrapperRun({
      rows: { data_health: { ...liveRow } },
      caller: async () => {
        throw new Error("db down");
      },
    });
    const failedRow = failing.store.state.get("data_health");
    check(
      "共通ラッパ: 全ての関数が失敗したら HTTP 500・連続失敗を記録し、対象日を処理済みにしない（補足の起動が再試行する）",
      failing.res.status === 500 &&
        failedRow.consecutive_failures === 1 &&
        !failedRow.last_target_date &&
        String(failedRow.last_error).includes("全て失敗"),
      show(failing.res.body),
    );
  }
}

async function scene3() {
  // 前日の通知の配信確認（scrape-monitor の通知済みの記録を読む）
  {
    const badRows = dates.map((d) =>
      coverageRow(d, d === "2026-09-18" ? { odds: 50 } : {}),
    );
    const first = await wrapperRun({
      rows: { data_health: { ...liveRow } },
      caller: makeCaller({ coverage: badRows }),
    });
    const row = first.store.state.get("data_health");
    const alertKey = row.last_report.emitted["coverage.odds"].alertKey;
    const nextDayAt = new Date("2026-09-22T21:35:00Z");
    const runNext = async (notified) => {
      const store = createMemoryStore({ rows: { data_health: { ...row } } });
      const client = {
        from(table) {
          const q = {
            select: () => q,
            eq: () => q,
            maybeSingle: async () => ({
              data:
                table === "scrape_job_state" && notified !== undefined
                  ? { last_report: { notified } }
                  : null,
              error: null,
            }),
          };
          return q;
        },
      };
      const res = await runScrapeJob({
        job: "data_health",
        run: (ctx) =>
          runDataHealthJob(ctx, {
            callFunction: makeCaller({ coverage: badRows }),
          }),
        store,
        client,
        now: () => nextDayAt,
        worker: "verify",
      });
      return { res, row: store.state.get("data_health") };
    };
    const undelivered = await runNext({});
    const delivered = await runNext({
      [`report:data_health:${alertKey}`]: "2026-09-21T22:00:30Z",
    });
    const noRecord = await runNext(undefined);
    check(
      "配信確認: 前日の通知が scrape-monitor の通知済みの記録に無ければ、翌日に再通知する。あれば通知しない。記録を読めなければ通知しない",
      undelivered.row.last_report.alerts.length === 1 &&
        undelivered.row.last_report.alerts[0].text.includes("届いていない") &&
        delivered.row.last_report.alerts.length === 0 &&
        noRecord.row.last_report.alerts.length === 0,
      show([
        undelivered.row.last_report.alerts.length,
        delivered.row.last_report.alerts.length,
        noRecord.row.last_report.alerts.length,
      ]),
    );
  }
}

async function scene4() {
  // createRpcCaller（supabase-js の rpc と同じ形 {data, error} を返す最小のクライアント）
  {
    const rpcCalls = [];
    const client = {
      async rpc(name, args) {
        rpcCalls.push({ name, args });
        if (name === "data_health_pit_reports")
          return {
            data: null,
            error: {
              code: "PGRST202",
              message:
                "Could not find the function public.data_health_pit_reports",
            },
          };
        if (name === "data_health_race_series")
          return {
            data: null,
            error: {
              code: "57014",
              message: "canceling statement due to statement timeout",
            },
          };
        return { data: [{ d: args.p_from }], error: null };
      },
    };
    const rpc = createRpcCaller(client);
    const ok = await rpc(functionByName("data_health_coverage"), {
      p_from: "2026-09-15",
      p_to: "2026-09-21",
    });
    const errOf = async (name) => {
      try {
        await rpc(functionByName(name), { p_from: "a", p_to: "b" });
        return null;
      } catch (e) {
        return e;
      }
    };
    const missing = await errOf("data_health_pit_reports");
    const timeout = await errOf("data_health_race_series");
    check(
      "RPC呼び出し: 引数（p_from・p_to）を渡し、関数が無い（089の未適用）エラーには原因の案内を付ける。その他のDBエラーは、関数名つきで例外にする",
      ok[0].d === "2026-09-15" &&
        missing?.message.includes("089が未適用") &&
        timeout?.message.includes("data_health_race_series") &&
        timeout.message.includes("statement timeout") &&
        !timeout.message.includes("089が未適用") &&
        rpcCalls.length === 3,
      show([ok, missing?.message, timeout?.message]),
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（LIB・check） */
export async function runDataHealthJobScenes4(env) {
  ({ LIB, check } = env);
  await scene1();
  await scene2();
  await scene3();
  await scene4();
}
