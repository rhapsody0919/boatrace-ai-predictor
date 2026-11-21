/**
 * verify-scrape-result-job.js の後半の場面（5/7）。verify ではない。
 * 判定と期待値は分ける前の verify-scrape-result-job.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { parseKFileRankings } from "../../lib/kfileParser.js";
import { createKFileSyncRun } from "../../lib/scrapeJobs/resultHandlers.js";
import { runScrapeJob } from "../../lib/scrapeJobs/cronWrapper.js";
import { createMemoryStore } from "../../lib/scrapeJobs/testing/memoryStore.js";
import { createFakeDb } from "./scrape-result-job-fake-db.js";
import { kDb, K_DATE } from "./scrape-result-job-scenes-b-4.js";
import { RACE_A, RACE_B } from "./scrape-result-job-scenes-b-1.js";
import { DATE } from "./scrape-result-job-scenes-b-2.js";
import { politeFor } from "./scrape-result-job-scenes-b-3.js";

let check, show, same, K_TEXT;

// ---------------------------------------------------------------------------
// (f) catch-up
// ---------------------------------------------------------------------------
export const catchupDb = (extra = {}) =>
  createFakeDb({
    scrape_slots: [
      {
        job: "result",
        race_id: RACE_A,
        race_date: DATE,
        status: "expired",
        races: { cancellation_status: null },
      },
      {
        job: "result",
        race_id: RACE_B,
        race_date: DATE,
        status: "expired",
        races: { cancellation_status: "confirmed" },
      },
      {
        job: "result",
        race_id: "2026-09-19-05-02",
        race_date: DATE,
        status: "done",
        races: { cancellation_status: null },
      },
      {
        job: "result",
        race_id: "2026-09-18-05-01",
        race_date: "2026-09-18",
        status: "expired",
        races: { cancellation_status: null },
      },
      ...(extra.openSlots ?? []),
    ],
    race_results: [],
    race_start_timings: [],
    race_conditions: [],
    races: [
      {
        race_id: RACE_A,
        race_date: DATE,
        start_time: "14:30:00",
        cancellation_status: null,
      },
      {
        race_id: RACE_B,
        race_date: DATE,
        start_time: "15:00:00",
        cancellation_status: "confirmed",
      },
      {
        race_id: "2026-09-19-01-12",
        race_date: DATE,
        start_time: "20:00:00",
        cancellation_status: null,
      },
      {
        race_id: "2026-09-19-01-11",
        race_date: DATE,
        start_time: "22:45:00",
        cancellation_status: null,
      },
    ],
    predictions: [],
  });

export const catchupCtx = (
  db,
  { mode = "live", iso = "2026-09-19T14:50:00Z", polite = politeFor() } = {},
) => ({
  targetDate: DATE,
  mode,
  client: db,
  politeFetch: polite,
  now: () => new Date(iso),
});

/** 元の verify の1つの塊 { } を割った 1/4 */
async function srjb5Scene1() {
  // createKFileSyncRun
  const calls = [];
  const mk = (per) => async (date, opts) => {
    calls.push({ date, ...opts });
    const r = per(date);
    return {
      date,
      downloads: 1,
      actualCourse: { updated: 0, ...r },
      rank456: { updated: 0, pending: 0, ...r },
    };
  };
  const ctx = (mode) => ({
    targetDate: "2026-09-19",
    mode,
    client: {},
    politeFetch: () => {},
  });
  const ok = await createKFileSyncRun({
    syncDate: mk(() => ({ status: "nothing_pending" })),
  })(ctx("live"));
  check(
    "kfile-sync: 当日を除く直近4日（9/18・17・16・15）を、新しい日から処理。全て同期済みなら成功・書き込み0件・完了",
    same(
      calls.map((c) => c.date),
      ["2026-09-18", "2026-09-17", "2026-09-16", "2026-09-15"],
    ) &&
      ok.rowsWritten === 0 &&
      ok.incomplete === false &&
      !ok.outcome,
    show(calls.map((c) => c.date)),
  );
  check(
    "kfile-sync: live は dryRun=false・shadow は dryRun=true。politeFetch を fetchImpl として渡す",
    calls.every(
      (c) => c.dryRun === false && typeof c.fetchImpl === "function",
    ) &&
      ((calls.length = 0),
      await createKFileSyncRun({
        syncDate: mk(() => ({ status: "nothing_pending" })),
      })(ctx("shadow")),
      calls.every((c) => c.dryRun === true)),
  );
  const unpub = await createKFileSyncRun({
    syncDate: mk((d) => ({
      status: d === "2026-09-18" ? "kfile_unavailable" : "nothing_pending",
    })),
  })(ctx("live"));
  check(
    "kfile-sync: 未同期があるのにKファイル未公開 → 成功だが incomplete（対象日を処理済みにせず、12:00の補足が再処理）。エラーにはしない",
    unpub.incomplete === true &&
      !unpub.outcome &&
      same(unpub.report.unpublished, ["2026-09-18"]),
    show(unpub),
  );
  const bad = await createKFileSyncRun({
    syncDate: mk((d) =>
      d === "2026-09-17"
        ? { status: "kfile_error", error: "HTTP 500" }
        : { status: "nothing_pending" },
    ),
  })(ctx("live"));
  check(
    "kfile-sync: ダウンロード失敗は outcome=error（理由付き）。他の日の処理は済んでいる",
    bad.outcome === "error" &&
      /2026-09-17/.test(bad.error) &&
      /HTTP 500/.test(bad.error) &&
      bad.report.days.length === 4,
    show(bad),
  );
  // 成績コード（BOA-553）: last_report に件数と状態を出す。列が無い（column_missing）は error
  const withCode = (code) => async (date) => ({
    date,
    downloads: 1,
    actualCourse: { updated: 2, status: "synced" },
    rank456: { updated: 0, pending: 0, status: "nothing_pending" },
    officialFinishCode: { updated: 84, pending: 84, ...code(date) },
  });
  return { calls, mk, ctx, withCode };
}

/** 元の verify の1つの塊 { } を割った 2/4 */
async function srjb5Scene2({ calls, mk, ctx, withCode }) {
  const fc = await createKFileSyncRun({
    syncDate: withCode(() => ({ status: "synced" })),
  })(ctx("live"));
  check(
    "kfile-sync: 成績コードの同期の件数・状態を last_report の各日に出し、書き込み件数に足す（4日×(進入2＋成績コード84)=344）",
    !fc.outcome &&
      fc.rowsWritten === 344 &&
      fc.report.days.every(
        (d) =>
          d.officialFinishCode?.status === "synced" &&
          d.officialFinishCode.updated === 84 &&
          d.officialFinishCode.pending === 84,
      ),
    show(fc.report.days[0]),
  );
  const fcMissing = await createKFileSyncRun({
    syncDate: withCode((d) =>
      d === "2026-09-18"
        ? { status: "column_missing", updated: 0, pending: 0 }
        : { status: "nothing_pending", updated: 0, pending: 0 },
    ),
  })(ctx("live"));
  check(
    "kfile-sync: 成績コードの列が無い（column_missing）は outcome=error（116 は適用済みなので、書き込みが止まっている）",
    fcMissing.outcome === "error" &&
      /成績コード/.test(fcMissing.error) &&
      /column_missing/.test(fcMissing.error),
    show(fcMissing),
  );
  const zero = await createKFileSyncRun({
    syncDate: mk(() => ({ status: "no_races_parsed" })),
  })(ctx("live"));
  check(
    "kfile-sync: Kファイルをダウンロードできたのにレースを1件も抽出できない（形式の変更）→ 0件エラー（error）",
    zero.outcome === "error" && /抽出できません/.test(zero.error),
    show(zero),
  );
  return { calls, mk, ctx };
}

/** 元の verify の1つの塊 { } を割った 3/4 */
async function srjb5Scene3({ calls, mk, ctx }) {
  {
    // probe: 任意の日のKファイルをダウンロード・展開・解析して件数を返すだけ（書き込み・同期なし）
    const before = calls.length;
    let asked = null;
    const probeRun = createKFileSyncRun({
      syncDate: mk(() => ({ status: "nothing_pending" })),
      fetchText: async (date, opts) => {
        asked = { date, hasFetchImpl: typeof opts.fetchImpl === "function" };
        return K_TEXT;
      },
    });
    const probeDb = kDb();
    const p = await probeRun({
      ...ctx("shadow"),
      client: probeDb,
      query: { probeDate: K_DATE },
    });
    check(
      "kfile-sync probe: ?probeDate= の日のKファイルを politeFetch でダウンロード・解析し、レース数を返す。同期は呼ばず、書き込みなし・対象日は処理済みにしない",
      asked?.date === K_DATE &&
        asked.hasFetchImpl &&
        p.body.probe.downloaded === true &&
        p.body.probe.races === parseKFileRankings(K_TEXT, K_DATE).length &&
        p.body.probe.races > 100 &&
        p.incomplete === true &&
        p.rowsWritten === 0 &&
        calls.length === before &&
        probeDb.writes.length === 0,
      show(p),
    );
    let bad = null;
    try {
      await probeRun({ ...ctx("shadow"), query: { probeDate: "2026-9-1" } });
    } catch (e) {
      bad = e;
    }
    check(
      "kfile-sync probe: 日付の形式が不正なら例外（ダウンロードしない）",
      bad !== null,
    );
  }
  // ラッパ経由: 対象日の冪等（完了したら12:00は何もしない・incompleteなら12:00がもう一度処理する）
  const run = createKFileSyncRun({
    syncDate: mk((d) => ({
      status: d === "2026-09-18" ? "kfile_unavailable" : "nothing_pending",
    })),
  });
  const store = createMemoryStore({
    rows: { kfile_sync: { job: "kfile_sync", mode: "live" } },
  });
  const at = (iso) => ({
    job: "kfile_sync",
    store,
    run,
    now: () => new Date(iso),
    client: {},
    politeFetch: () => {},
    worker: "w",
  });
  const r1 = await runScrapeJob(at("2026-09-18T22:00:00Z"));
   // 07:00 JST 9/19
  const after1 = store.state.get("kfile_sync").last_target_date;
  const callsBefore = calls.length;
  const r2 = await runScrapeJob(at("2026-09-19T03:00:00Z"));
   // 12:00 JST
  check(
    "kfile-sync（ラッパ経由）: 未公開で incomplete だった 07:00 の実行は対象日を処理済みにせず、12:00 の実行がもう一度処理する",
    r1.status === 200 &&
      after1 === undefined &&
      r2.body.skipped !== "already_done" &&
      calls.length > callsBefore,
    show({ r1: r1.body, after1, r2: r2.body }),
  );
  const store2 = createMemoryStore({
    rows: { kfile_sync: { job: "kfile_sync", mode: "live" } },
  });
  const okRun = createKFileSyncRun({
    syncDate: mk(() => ({ status: "nothing_pending" })),
  });
  return { calls, store2, okRun };
}

/** 元の verify の1つの塊 { } を割った 4/4 */
async function srjb5Scene4({ calls, store2, okRun }) {
  const cfg = (iso) => ({
    job: "kfile_sync",
    store: store2,
    run: okRun,
    now: () => new Date(iso),
    client: {},
    politeFetch: () => {},
    worker: "w",
  });
  await runScrapeJob(cfg("2026-09-18T22:00:00Z"));
  const c0 = calls.length;
  const again = await runScrapeJob(cfg("2026-09-19T03:00:00Z"));
  check(
    "kfile-sync（ラッパ経由）: 07:00 で完了していれば、12:00 は already_done で何もしない（last_target_date）",
    store2.state.get("kfile_sync").last_target_date === "2026-09-19" &&
      again.body.skipped === "already_done" &&
      calls.length === c0,
    show(again.body),
  );
  const off = createMemoryStore({
    rows: { kfile_sync: { job: "kfile_sync", mode: "off" } },
  });
  const c1 = calls.length;
  const offRes = await runScrapeJob({
    job: "kfile_sync",
    store: off,
    run: okRun,
    now: () => new Date("2026-09-18T22:00:00Z"),
    client: {},
    politeFetch: () => {},
    worker: "w",
  });
  check(
    "kfile-sync（ラッパ経由）: mode=off は何もしない（同期の呼び出し0回）",
    offRes.body.skipped === "mode_off" && calls.length === c1,
  );
}

async function srjb5Scene5() {
  {
    const s1 = await srjb5Scene1();
    const s2 = await srjb5Scene2(s1);
    const s3 = await srjb5Scene3(s2);
    await srjb5Scene4(s3);
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・show・same・K_TEXT） */
export async function runScrapeResultJobScenesB8(env) {
  ({ check, show, same, K_TEXT } = env);
  await srjb5Scene5();
}
