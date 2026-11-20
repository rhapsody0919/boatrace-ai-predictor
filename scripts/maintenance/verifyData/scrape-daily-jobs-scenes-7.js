/**
 * verify-scrape-daily-jobs.js の後半の場面（7/9）。verify ではない。
 * 判定と期待値は分ける前の verify-scrape-daily-jobs.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { createMemoryStore } from "../../lib/scrapeJobs/testing/memoryStore.js";
import { runRacerProfilesJob } from "../../lib/racerProfilesJob.js";
import { summaryOf } from "./scrape-daily-jobs-scenes-6.js";

let check, show, same, jst, liveRow, runJob, throwingFetch, strictClient;

/** 元の verify の1つの塊 { } を割った 1/6 */
async function scene1() {
  const at = (t) => jst(`2026-10-${t}`);
  const stubSync = (...summaries) => {
    const calls = [];
    const fn = async (args) => {
      calls.push(args);
      return {
        summary: summaries[Math.min(calls.length - 1, summaries.length - 1)],
      };
    };
    fn.calls = calls;
    return fn;
  };
  const runIt = (store, sync, when, { query, mode } = {}) => {
    if (mode) store.state.get("racer_profiles").mode = mode;
    return runJob({
      job: "racer_profiles",
      run: (ctx) =>
        runRacerProfilesJob(ctx, { sync, log: () => {}, logError: () => {} }),
      store,
      client: strictClient(),
      politeFetch: throwingFetch(),
      at: when,
      query,
    });
  };
  const newStore = (extra = {}) =>
    createMemoryStore({
      rows: { racer_profiles: { ...liveRow("racer_profiles"), ...extra } },
    });
  // BOA-1152: 新人だけの回・全員の回とも、完了したサイクルの母数で通知を判定する。
  for (const month of [5, 10, 11]) {
    for (const [targets, failed, expected] of [
      [20, 2, false],
      [20, 4, false],
      [20, 5, true],
      [99, 5, true],
      [100, 5, false],
      [100, 6, true],
      [1600, 80, false],
      [1600, 81, true],
    ]) {
      const store = newStore();
      const when = jst(`2026-${String(month).padStart(2, "0")}-02T03:00:00`);
      const sync = stubSync(
        summaryOf({
          processed: targets,
          attempts: targets,
          fail: failed,
          remaining: 0,
        }),
      );
      const result = await runIt(store, sync, when);
      const row = store.state.get("racer_profiles");
      const alerts = row.last_report?.alerts;
      const alert = alerts?.[0];
      check(
        `選手プロフィール 通知母数: ${month}月 ${targets}人中${failed}人失敗は通知${expected ? "あり" : "なし"}`,
        result.status === 200 &&
          row.cursor.done === true &&
          row.last_report.cycle.seasonTargets === targets &&
          row.last_report.cycle.seasonFailed === failed &&
          alerts.length === (expected ? 1 : 0) &&
          (!expected ||
            (alert.key === "season_fail_rate" &&
              alert.text === `選手期別成績の失敗率が${((failed / targets) * 100).toFixed(1)}%（${failed}/${targets}人、上限5%）。対象日 ${row.cursor.targetDate}` &&
              alert.until ===
                new Date(when.getTime() + 2 * 24 * 3600 * 1000).toISOString())),
        show({ result, report: row.last_report }),
      );
    }
  }
  // 先頭 → 中間 → 最後。処理済みは最後のチャンクの完了時だけ
  const store = newStore();
  return { at, stubSync, runIt, newStore, store };
}

/** 元の verify の1つの塊 { } を割った 2/6 */
async function scene2({ at, stubSync, runIt, newStore, store }) {
  const sync = stubSync(
    summaryOf({ processed: 110, last: 4099, remaining: 1500 }),
    summaryOf({ processed: 110, last: 4321, remaining: 800 }),
    summaryOf({
      processed: 800,
      last: 5210,
      remaining: 0,
      fail: 200,
      attempts: 1627,
    }),
  );
  const r1 = await runIt(store, sync, at("02T03:00:00"));
  const row = store.state.get("racer_profiles");
  check(
    "選手プロフィール 1回目: 先頭(afterRacerId=null)から、同時4・上限300人・politeFetch(再試行は無効)で処理。cursor に最後の登録番号(4099)。対象日は処理済みにしない",
    r1.status === 200 &&
      sync.calls[0].options.afterRacerId === null &&
      sync.calls[0].options.limit === 300 &&
      sync.calls[0].options.concurrency === 4 &&
      sync.calls[0].deps.fetchRetries === 0 &&
      row.cursor.afterRacerId === 4099 &&
      row.cursor.done === false &&
      row.cursor.targetDate === "2026-10-02" &&
      row.cursor.mode === "live" &&
      row.last_target_date === undefined &&
      r1.body.incomplete === true,
    show({ cursor: row.cursor, body: r1.body }),
  );
  const r2 = await runIt(store, sync, at("02T03:10:00"));
  check(
    "選手プロフィール 2回目(10分後): 前回の最後の登録番号(4099)より後から再開し、cursor が前進する(4321)。まだ処理済みにしない",
    r2.status === 200 &&
      sync.calls[1].options.afterRacerId === 4099 &&
      row.cursor.afterRacerId === 4321 &&
      row.cursor.stats.chunks === 2 &&
      row.last_target_date === undefined,
    show(row.cursor),
  );
  const r3 = await runIt(store, sync, at("02T03:20:00"));
  return { at, stubSync, runIt, newStore, store, sync, row, r3 };
}

/** 元の verify の1つの塊 { } を割った 3/6 */
async function scene3({ at, stubSync, runIt, newStore, store, sync, row, r3 }) {
  check(
    "選手プロフィール 最後のチャンク(残り0): 対象日を処理済みにする。cursor は done。失敗率が5%超なら last_report.alerts に通知(期限つき)",
    r3.status === 200 &&
      r3.body.done === true &&
      row.last_target_date === "2026-10-02" &&
      row.cursor.done === true &&
      row.last_report.alerts.length === 1 &&
      row.last_report.alerts[0].key === "season_fail_rate" &&
      new Date(row.last_report.alerts[0].until) > at("02T03:20:00") &&
      new Date(row.last_report.alerts[0].until) < at("05T00:00:00"),
    show({ report: row.last_report, cursor: row.cursor }),
  );
  const r4 = await runIt(store, sync, at("02T03:30:00"));
  check(
    "選手プロフィール: 処理済みの対象日の以降の起動(03:30〜05:50)は、何もしない(取得しない・sync を呼ばない)",
    r4.body.skipped === "already_done" && sync.calls.length === 3,
    show(r4.body),
  );
  const sync2 = stubSync(
    summaryOf({ processed: 110, last: 1500, remaining: 900 }),
  );
  await runIt(store, sync2, jst("2026-11-02T03:00:00"));
  check(
    "選手プロフィール: 翌月(対象日が変わる)は、前月の cursor を引き継がず、先頭から",
    sync2.calls[0].options.afterRacerId === null &&
      row.cursor.targetDate === "2026-11-02" &&
      row.cursor.afterRacerId === 1500,
    show(row.cursor),
  );
  // モード違いの cursor は引き継がない（shadow の進捗を live が使わない）
  {
    const store = newStore({
      cursor: {
        targetDate: "2026-10-02",
        mode: "shadow",
        afterRacerId: 4500,
        done: false,
        stats: {},
      },
    });
    const sync = stubSync(summaryOf());
    await runIt(store, sync, at("02T03:00:00"));
    check(
      "選手プロフィール: shadow の cursor は、live に引き継がない(先頭から処理する)",
      sync.calls[0].options.afterRacerId === null &&
        sync.calls[0].options.dryRun === false,
      show(sync.calls[0].options),
    );
  }
  return { at, stubSync, runIt, newStore };
}

/** 元の verify の1つの塊 { } を割った 4/6 */
async function scene4({ at, stubSync, runIt, newStore }) {
  // shadow: dryRun・cursor は shadow 専用・完了後は sync を呼ばない・対象日を処理済みにしない
  {
    const store = newStore({ mode: "shadow" });
    const sync = stubSync(
      summaryOf({ processed: 300, last: 5000, remaining: 0 }),
    );
    await runIt(store, sync, at("02T03:00:00"));
    const row = store.state.get("racer_profiles");
    const before = sync.calls.length;
    await runIt(store, sync, at("02T03:10:00"));
    check(
      "選手プロフィール shadow: dryRun(書かない)で処理・cursor.mode=shadow・完了後の起動は sync を呼ばない・対象日を処理済みにしない",
      sync.calls[0].options.dryRun === true &&
        row.cursor.mode === "shadow" &&
        row.cursor.done === true &&
        sync.calls.length === before &&
        row.last_target_date === undefined,
      show(row.cursor),
    );
  }
  // 系統的な失敗（連続失敗・新規プロフィールの保存のDBエラー）: エラー・cursor を進めない
  for (const [label, summary] of [
    [
      "連続20件の失敗で中断",
      summaryOf({ processed: 40, aborted: true, remaining: 1500 }),
    ],
    ["新規選手のプロフィール保存のDBエラー", summaryOf({ saveErrors: 2 })],
  ]) {
    const prior = {
      targetDate: "2026-10-02",
      mode: "live",
      afterRacerId: 4099,
      done: false,
      stats: {},
    };
    const store = newStore({ cursor: prior });
    const res = await runIt(store, stubSync(summary), at("02T03:10:00"));
    const row = store.state.get("racer_profiles");
    check(
      `選手プロフィール: ${label}は、エラー(500)。cursor は進めず、次の起動が同じチャンクをやり直す`,
      res.status === 500 &&
        same(row.cursor, prior) &&
        row.consecutive_failures === 1,
      show({ body: res.body, cursor: row.cursor }),
    );
  }
  // 散発的な失敗(4%程度)は、進捗を止めない
  {
    const store = newStore();
    const res = await runIt(
      store,
      stubSync(summaryOf({ processed: 110, fail: 6, remaining: 1500 })),
      at("02T03:00:00"),
    );
    check(
      "選手プロフィール: 散発的な失敗(6/110)は、進捗を止めない(200・cursor 前進)",
      res.status === 200 &&
        store.state.get("racer_profiles").cursor.afterRacerId === 4099,
      show(res.body),
    );
  }
  return { at, stubSync, runIt, newStore };
}

/** 元の verify の1つの塊 { } を割った 5/6 */
async function scene5({ at, stubSync, runIt, newStore }) {
  // 0件エラーは、十分な母数(10人以上)があるときだけ
  {
    const store = newStore();
    const res = await runIt(
      store,
      stubSync(
        summaryOf({
          processed: 300,
          attempts: 300,
          fail: 300,
          remaining: 1000,
        }),
      ),
      at("02T03:00:00"),
    );
    check(
      "選手プロフィール: 期別成績を300人取得して1件も解析できなかった(0件)は、エラー(500)",
      res.status === 500 && /0件/.test(res.body.error ?? ""),
      show(res.body),
    );
    const prior = {
      targetDate: "2026-10-02",
      mode: "live",
      afterRacerId: 5200,
      done: false,
      stats: {},
    };
    const store2 = newStore({ cursor: prior });
    const res2 = await runIt(
      store2,
      stubSync(
        summaryOf({
          processed: 3,
          attempts: 3,
          fail: 3,
          last: 5210,
          remaining: 0,
        }),
      ),
      at("02T03:30:00"),
    );
    check(
      "選手プロフィール: 最後の数人(3人)が失敗しても、母数が小さいため0件エラーにせず、サイクルを完了する",
      res2.status === 200 &&
        store2.state.get("racer_profiles").cursor.done === true,
      show(res2.body),
    );
  }
  // 最初のチャンクで対象が0人はエラー。再開後に対象が0人(全員処理済み)は完了
  {
    const store = newStore();
    const res = await runIt(
      store,
      stubSync(summaryOf({ processed: 0, targetCount: 0, remaining: 0 })),
      at("02T03:00:00"),
    );
    check(
      "選手プロフィール: 最初のチャンクで対象選手が0人は、エラー(0件を成功にしない)",
      res.status === 500 && /対象選手が0件/.test(res.body.error ?? ""),
      show(res.body),
    );
    const store2 = newStore({
      cursor: {
        targetDate: "2026-10-02",
        mode: "live",
        afterRacerId: 5210,
        done: false,
        stats: {},
      },
    });
    const res2 = await runIt(
      store2,
      stubSync(summaryOf({ processed: 0, targetCount: 0, remaining: 0 })),
      at("02T03:40:00"),
    );
    check(
      "選手プロフィール: 再開後に対象が0人(前回までに全員処理済み)は、完了として対象日を処理済みにする",
      res2.status === 200 &&
        store2.state.get("racer_profiles").last_target_date === "2026-10-02",
      show(res2.body),
    );
  }
  return { at, stubSync, runIt, newStore };
}

/** 元の verify の1つの塊 { } を割った 6/6 */
async function scene6({ at, stubSync, runIt, newStore }) {
  // 手動の動作確認: ?chunk=N
  {
    const store = newStore();
    const sync = stubSync(summaryOf({ processed: 5, remaining: 1600 }));
    await runIt(store, sync, at("02T03:00:00"), { query: { chunk: "5" } });
    const bad = await runIt(
      newStore(),
      stubSync(summaryOf()),
      at("02T03:00:00"),
      {
        query: { chunk: "abc" },
      },
    );
    check(
      "選手プロフィール: ?chunk=5 で1回の処理人数を5人にできる。不正な値は、無視せずエラー(500)",
      sync.calls[0].options.limit === 5 &&
        bad.status === 500 &&
        /chunk/.test(bad.body.error ?? ""),
      show(bad.body),
    );
  }
}

async function scene7() {
  {
    const s1 = await scene1();
    const s2 = await scene2(s1);
    const s3 = await scene3(s2);
    const s4 = await scene4(s3);
    const s5 = await scene5(s4);
    await scene6(s5);
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・show・same・jst・liveRow・runJob・throwingFetch・strictClient） */
export async function runScrapeDailyJobsScenes9(env) {
  ({ check, show, same, jst, liveRow, runJob, throwingFetch, strictClient } = env);
  await scene7();
}
