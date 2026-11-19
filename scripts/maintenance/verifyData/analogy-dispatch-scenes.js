/**
 * verify-analogy-dispatch.js の後半の場面。verify ではない。
 * 判定と期待値は分ける前の verify-analogy-dispatch.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { createAnalogyDispatchRun } from "../../lib/analogyDispatch.js";
import { STALE_AFTER_MS, createDbApplyDispatchRun } from "../../lib/dbApplyDispatch.js";
import { SCRAPE_JOBS } from "../../lib/scrapeJobs/registry.js";

let check, same, vercel, readWorkflow, at, fakeFetch, ctxOf, wiringOf, wired, ENV;

/** 元の verify の1つの塊 { } を割った 1/4 */
async function scene1() {
  const now = at("12:17");
  const hoursAgo = (h) =>
    new Date(now.getTime() - h * 3600 * 1000).toISOString();
  // GitHub の偽物: POST は dispatch、GET は runs・jobs を返す
  const fakeGh = ({
    runs = [],
    jobsOf = {},
    getStatus = 200,
    hang = false,
  } = {}) => {
    const calls = [];
    const f = async (url, init = {}) => {
      calls.push({ url, init });
      if (init.method === "POST")
        return { ok: true, status: 204, text: async () => "" };
      // GitHub が返らない: 期限（signal）で打ち切られるまで待つ。本物のソケットの代わりに、プロセスを生かすタイマーを置く
      // （AbortSignal.timeout のタイマーは unref なので、これが無いと打ち切りの前にプロセスが終わる）。打ち切られなければ5秒で失敗
      if (hang)
        return new Promise((_, reject) => {
          const keep = setTimeout(
            () => reject(new Error("打ち切られなかった")),
            5000,
          );
          init.signal?.addEventListener("abort", () => {
            clearTimeout(keep);
            reject(new Error("timeout"));
          });
        });
      const jobsOfRun = /\/runs\/(\d+)\/jobs/.exec(url);
      const body = jobsOfRun
        ? { jobs: jobsOf[jobsOfRun[1]] ?? [] }
        : { workflow_runs: runs };
      return {
        ok: getStatus === 200,
        status: getStatus,
        json: async () => body,
        text: async () => "boom",
      };
    };
    f.calls = calls;
    f.posts = () => calls.filter((c) => c.init.method === "POST");
    f.gets = () => calls.filter((c) => c.init.method !== "POST");
    return f;
  };
  // 前の起動（last_tick_at）は既定で1時間前（毎時の起動が続いている）
  const ctxG = (mode, liveSince, lastTick = hoursAgo(1)) => ({
    now: () => now,
    client: null,
    mode,
    state: liveSince
      ? { last_report: { liveSince }, last_tick_at: lastTick }
      : null,
  });
  const runG = (f) => createDbApplyDispatchRun({ fetchImpl: f, env: ENV });
  const job = (name, conclusion, completedHoursAgo) => ({
    name,
    conclusion,
    completed_at:
      completedHoursAgo == null ? null : hoursAgo(completedHoursAgo),
  });
  check(STALE_AFTER_MS === 3 * 3600 * 1000, "(g) 見張りの窓は3時間");
  let f = fakeGh();
  let r = await runG(f)(ctxG("live", null));
  check(
    r.outcome !== "error" &&
      f.posts().length === 1 &&
      f.posts()[0].url.endsWith("/workflows/db-apply.yml/dispatches") &&
      same(JSON.parse(f.posts()[0].init.body), {
        ref: "master",
        inputs: { mode: "reconcile" },
      }) &&
      f.gets().length === 0 &&
      r.report?.liveSince === now.toISOString(),
    "(g) 初回の live: db-apply.yml を master・mode=reconcile で起動し、liveSince を今にする（3時間以内なので見張らない）",
    JSON.stringify({ r, calls: f.calls.map((c) => c.url) }),
  );
  return { now, hoursAgo, fakeGh, ctxG, runG, job, f, r };
}

/** 元の verify の1つの塊 { } を割った 2/4 */
async function scene2({ now, hoursAgo, fakeGh, ctxG, runG, job, f, r }) {
  f = fakeGh();
  r = await runG(f)(ctxG("live", hoursAgo(2)));
  check(
    r.outcome !== "error" &&
      f.gets().length === 0 &&
      r.report?.liveSince === hoursAgo(2),
    "(g) live の最初の起動から3時間以内は見張らない（liveSince は前の値を引き継ぐ）",
    JSON.stringify(r),
  );
  f = fakeGh({
    runs: [{ id: 11 }, { id: 10 }],
    jobsOf: {
      11: [job("reconcile", "skipped", 0.1)],
      10: [job("reconcile", "success", 1), job("judge", "skipped", 1)],
    },
  });
  r = await runG(f)(ctxG("live", hoursAgo(5)));
  const runsUrl = decodeURIComponent(f.gets()[0]?.url ?? "");
  check(
    r.outcome !== "error" &&
      f.posts().length === 1 &&
      runsUrl.includes(
        `/workflows/db-apply.yml/runs?created=>=${hoursAgo(3)}`,
      ) &&
      r.report?.watch?.found === true,
    "(g) 直近3時間に reconcile の job が success の run があれば成功（直近3時間の run を見る）",
    JSON.stringify({ r, runsUrl }),
  );
  f = fakeGh({
    runs: [{ id: 21 }, { id: 20 }],
    // 21: REVIEWER_BOT_USER_ID が空で skipped（run の結論は success になる）。20: reconcile がまだ終わっていない
    jobsOf: {
      21: [job("reconcile", "skipped", 0.2), job("judge", "skipped", 0.2)],
      20: [job("reconcile", null, null)],
    },
  });
  r = await runG(f)(ctxG("live", hoursAgo(5)));
  check(
    r.outcome === "error" &&
      /reconcile の job が success/.test(r.error) &&
      f.posts().length === 1,
    "(g) reconcile が skipped・未完了の run しか無ければ、起動した上で失敗にする（run の結論でなく job で数える）",
    JSON.stringify(r),
  );
  f = fakeGh({
    runs: [{ id: 31 }],
    jobsOf: { 31: [job("reconcile", "success", 3.5)] },
  });
  r = await runG(f)(ctxG("live", hoursAgo(5)));
  check(
    r.outcome === "error" && f.posts().length === 1,
    "(g) 3時間より前に終わった reconcile の成功は数えない",
    JSON.stringify(r),
  );
  f = fakeGh({ runs: [] });
  r = await runG(f)(ctxG("live", hoursAgo(5)));
  check(
    r.outcome === "error" && f.posts().length === 1,
    "(g) 直近3時間に run が1本も無ければ失敗にする（dispatch が run を作っていない）",
    JSON.stringify(r),
  );
  f = fakeGh({ getStatus: 403 });
  r = await runG(f)(ctxG("live", hoursAgo(5)));
  return { now, hoursAgo, fakeGh, ctxG, runG, f, r };
}

/** 元の verify の1つの塊 { } を割った 3/4 */
async function scene3({ now, hoursAgo, fakeGh, ctxG, runG, f, r }) {
  check(
    r.outcome === "error" &&
      /見張れなかった/.test(r.error) &&
      /HTTP 403/.test(r.error) &&
      f.posts().length === 1,
    "(g) run を読めないときも起動はし、失敗にする（黙らない）",
    JSON.stringify(r),
  );
  f = fakeGh({ hang: true });
  r = await createDbApplyDispatchRun({
    fetchImpl: f,
    env: ENV,
    watchTimeoutMs: 50,
  })(ctxG("live", hoursAgo(5)));
  check(
    r.outcome === "error" &&
      /見張れなかった/.test(r.error) &&
      f.posts().length === 1,
    "(g) GitHub の読み取りが返らないときは期限で打ち切り、起動した上で失敗にする（関数の上限で黙らない）",
    JSON.stringify(r),
  );
  f = fakeGh();
  r = await createDbApplyDispatchRun({ fetchImpl: f, env: {} })(
    ctxG("live", hoursAgo(5)),
  );
  check(
    r.outcome === "error" &&
      /GITHUB_ACTIONS_DISPATCH_TOKEN/.test(r.error) &&
      f.calls.length === 0,
    "(g) トークン未設定は失敗にする",
    JSON.stringify(r),
  );
  f = fakeGh({ runs: [] });
  r = await runG(f)(ctxG("live", hoursAgo(30), hoursAgo(24)));
  check(
    r.outcome !== "error" &&
      f.gets().length === 0 &&
      r.report?.liveSince === now.toISOString(),
    "(g) off から戻したとき（前の起動が2.5時間より前）は liveSince を今にし、すぐには知らせない",
    JSON.stringify(r),
  );
  f = fakeGh({ runs: [] });
  r = await runG(f)(ctxG("live", hoursAgo(5), hoursAgo(2)));
  check(
    r.outcome === "error" && f.gets().length === 1,
    "(g) 失敗が続く間（毎時の起動は来ている）は liveSince を引き継いで知らせ続ける（Vercel Cron の1回の抜けも許す）",
    JSON.stringify(r),
  );
  f = fakeGh();
  r = await runG(f)(ctxG("shadow", hoursAgo(5)));
  return { f, r };
}

/** 元の verify の1つの塊 { } を割った 4/4 */
async function scene4({ f, r }) {
  check(
    r.report?.wouldDispatch === true &&
      f.calls.length === 0 &&
      r.report?.liveSince === undefined,
    "(g) shadow は起動も見張りもしない（liveSince を残さないので、live にした時点から3時間を数え直す）",
    JSON.stringify(r),
  );
  const def = SCRAPE_JOBS.db_apply_dispatch;
  check(
    def?.kind === "monitor" && def.failureAlertAfter === 1,
    "(g) db_apply_dispatch: monitor・failureAlertAfter 1",
  );
  const w = await wiringOf(() => import("../../../api/cron/db-apply-dispatch.js"));
  check(
    same(w, wired(def, "db_apply_dispatch", "db_apply_reconcile")),
    "(g) api/cron/db-apply-dispatch.js: maxDuration がレジストリと一致し、モードのゲートを掛ける",
    JSON.stringify(w),
  );
  // run は毎回作る関数なので、createDbApplyDispatchRun() が作る物と同じ関数か（同じ本文か）でも見る
  check(
    String(w.run) === String(createDbApplyDispatchRun()),
    "(g) api/cron/db-apply-dispatch.js: run は createDbApplyDispatchRun() で作る",
  );
  const crons = vercel.crons
    .filter((c) => c.path === "/api/cron/db-apply-dispatch")
    .map((c) => c.schedule);
  check(
    same(crons, ["17 * * * *"]),
    "(g) vercel.json: 毎時17分に1本",
    JSON.stringify(crons),
  );
  const wf = readWorkflow("db-apply.yml");
  const schedules = [...wf.matchAll(/^ {4}- cron: "([^"]+)"$/gm)].map(
    (m) => m[1],
  );
  check(
    same(schedules, ["47 * * * *"]),
    "(g) db-apply.yml の schedule は予備の毎時47分だけ（dispatch の17分と重ねない。重なると互いを busy と見て両方とも何もしない）",
    JSON.stringify(schedules),
  );
  const modeBlock = /^ {6}mode:\n((?: {8}.*\n)+)/m.exec(wf)?.[1] ?? "";
  check(
    /type: choice/.test(modeBlock) &&
      /default: manual/.test(modeBlock) &&
      /- manual\n {10}- reconcile/.test(modeBlock),
    "(g) db-apply.yml の mode は choice（manual・reconcile）で、既定は manual（人の起動は今までどおり手で当てる）",
    modeBlock,
  );
}

async function scene5() {
  // ---------------------------------------------------------------- (f)
  {
    const f = fakeFetch();
    const r = await createAnalogyDispatchRun("in_caution_nightly", {
      fetchImpl: f,
      env: ENV,
    })(ctxOf(at("02:30")));
    check(
      r.report?.dispatched === true &&
        f.calls[0]?.url.endsWith(
          "/workflows/in-caution-nightly.yml/dispatches",
        ) &&
        same(JSON.parse(f.calls[0].init.body), { ref: "master", inputs: {} }),
      "(f) in_caution_nightly は in-caution-nightly.yml を inputs 空（直近14日・時間外は書かない）で起動する",
      JSON.stringify(f.calls[0]),
    );
    const def = SCRAPE_JOBS.in_caution_dispatch;
    check(
      def?.kind === "monitor" && def.failureAlertAfter === 1,
      "(f) in_caution_dispatch: monitor・failureAlertAfter 1",
    );
    const w = await wiringOf(
      () => import("../../../api/cron/in-caution-dispatch.js"),
    );
    check(
      same(w, wired(def, "in_caution_dispatch", "in_caution_nightly")),
      "(f) api/cron/in-caution-dispatch.js: maxDuration がレジストリと一致し、モードのゲートを掛ける",
      JSON.stringify(w),
    );
    const crons = vercel.crons
      .filter((c) => c.path === "/api/cron/in-caution-dispatch")
      .map((c) => c.schedule);
    check(
      same(crons, ["30 17 * * *"]),
      "(f) vercel.json: JST 2:30（UTC 17:30）に1本（結果の確定の後、races-init の前）",
      JSON.stringify(crons),
    );
    const wf = readWorkflow("in-caution-nightly.yml");
    check(
      !/^\s*schedule:/m.test(wf) &&
        /group:\s*in-caution-nightly/.test(wf) &&
        /if: failure\(\)/.test(wf),
      "(f) in-caution-nightly.yml: schedule を使わない・concurrency・失敗は Slack",
    );
  }
  {
    const s1 = await scene1();
    const s2 = await scene2(s1);
    const s3 = await scene3(s2);
    await scene4(s3);
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・same・vercel・readWorkflow・at・fakeFetch・ctxOf・wiringOf・wired・ENV） */
export async function runAnalogyDispatchScenes1(env) {
  ({ check, same, vercel, readWorkflow, at, fakeFetch, ctxOf, wiringOf, wired, ENV } = env);
  await scene5();
}
