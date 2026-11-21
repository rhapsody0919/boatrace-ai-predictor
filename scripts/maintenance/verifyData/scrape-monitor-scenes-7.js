/**
 * verify-scrape-monitor.js の後半の場面（7/8）。verify ではない。
 * 判定と期待値は分ける前の verify-scrape-monitor.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { runMonitor, formatDailySummary } from "../../lib/scrapeJobs/monitor.js";
import { cleanupCutoffs, runCleanup } from "../../lib/scrapeJobs/cleanup.js";

let check, show, DATE, at, iso, slot, doneOdds;

/** 元の verify の1つの塊 { } を割った 1/3 */
async function scene1() {
  const now = at("12:00");
  const jobState = (over) => ({
    job: "odds",
    mode: "live",
    consecutive_failures: 0,
    last_error: null,
    last_tick_at: iso(new Date(now.getTime() - 60000)),
    ...over,
  });
  const ctxOf = (over = {}) => ({
    now: () => now,
    query: {},
    state: null,
    client: {},
    ...over,
  });
  const collectOf = (input) => async () => ({
    available: true,
    weekSlots: null,
    todaySlots: [],
    expiredSlots: [],
    jobStates: [],
    ...input,
  });
  const posted = [];
  const fetchImpl = async (url, init) => {
    posted.push({ url, body: JSON.parse(init.body) });
    return new Response("ok", { status: 200 });
  };
  const env = { SLACK_WEBHOOK_URL: "https://hooks.example.test/x" };
  let r = await runMonitor(ctxOf(), {
    collect: async () => ({ available: false }),
    env: {},
    fetchImpl,
  });
  check(
    "075未適用: 何もせず skipped（通知なし・通知先の設定も要求しない）",
    r.body.skipped === "scrape_schema_not_applied" && posted.length === 0,
  );
  r = await runMonitor(ctxOf(), {
    collect: collectOf({
      jobStates: [jobState({ mode: "off", last_tick_at: null })],
    }),
    env: {},
    fetchImpl,
  });
  check(
    "有効な取得ジョブが無い（全て off）: 通知なし。SLACK_WEBHOOK_URL が無くても失敗にしない",
    r.body.alerts === 0 && r.body.sent === 0 && posted.length === 0,
  );
  // 日次サマリー: 有効なジョブが無ければ投稿しない
  r = await runMonitor(ctxOf({ query: { mode: "daily" } }), {
    collect: collectOf({ jobStates: [jobState({ mode: "off" })] }),
    env,
    fetchImpl,
  });
  check(
    "日次サマリー: 取得ジョブが1つも有効でない間は投稿しない",
    r.body.sent === 0 && posted.length === 0,
  );
  // 異常あり: 通知先なし → 失敗（成功に見せない）
  const withExpired = collectOf({
    jobStates: [jobState()],
    expiredSlots: [
      slot("odds", -60, "expired", {
        attempts: 0,
        race_id: "2026-09-19-02-01",
      }),
    ],
  });
  return { now, jobState, ctxOf, collectOf, posted, fetchImpl, env, r, withExpired };
}

/** 元の verify の1つの塊 { } を割った 2/3 */
async function scene2({ now, jobState, ctxOf, collectOf, posted, fetchImpl, env, r, withExpired }) {
  let threw;
  try {
    await runMonitor(ctxOf(), { collect: withExpired, env: {}, fetchImpl });
  } catch (e) {
    threw = e;
  }
  check(
    "異常があるのに SLACK_WEBHOOK_URL が無い: 例外（異常を通知できないことを成功に見せない）",
    threw && /SLACK_WEBHOOK_URL/.test(threw.message) && posted.length === 0,
  );
  // 多数の異常: 載せきれなかった分は、通知済みとして記録せず、次の実行で通知する
  {
    const overdue = Array.from({ length: 100 }, (_, i) =>
      slot("odds", -60, "expired", {
        attempts: 2,
        race_id: `2026-09-19-04-${String(i).padStart(2, "0")}`,
        last_error: "取得先が429を返し続けた".padEnd(80, "。"),
      }),
    );
    const posts = [];
    const fetchMany = async (url, init) => {
      posts.push(JSON.parse(init.body));
      return new Response("ok", { status: 200 });
    };
    const big = await runMonitor(ctxOf(), {
      collect: collectOf({ jobStates: [jobState()], expiredSlots: overdue }),
      env,
      fetchImpl: fetchMany,
    });
    const shown = Object.keys(big.report.notified).length;
    const text = posts[0].attachments[0].blocks[0].text.text;
    const next = await runMonitor(
      ctxOf({ state: { last_report: big.report } }),
      {
        collect: collectOf({ jobStates: [jobState()], expiredSlots: overdue }),
        env,
        fetchImpl: fetchMany,
      },
    );
    check(
      "多数の異常: 載せた件数だけを通知済みとして記録し、残りは次の実行で通知する（切り詰めた分を通知済みにして、72時間黙らない）",
      shown > 0 &&
        shown < 100 &&
        text.length <= 3000 &&
        new RegExp(`ほか${100 - shown}件`).test(text) &&
        next.body.sent === 1 &&
        Object.keys(next.report.notified).length > shown,
      `載せた${shown}件、次回の通知済み${Object.keys(next.report.notified).length}件`,
    );
    posts.length = 0;
  }
  // 異常あり: 通知 → 通知済みの記録を返す。次の実行では再通知しない
  r = await runMonitor(ctxOf(), { collect: withExpired, env, fetchImpl });
  check(
    "異常あり: Slackへ1通投稿し、通知済みの記録を返す",
    posted.length === 1 &&
      posted[0].url === env.SLACK_WEBHOOK_URL &&
      /未実行/.test(show(posted[0].body)) &&
      r.body.sent === 1 &&
      Object.keys(r.report.notified).length === 1,
    show(r.body),
  );
  const r2 = await runMonitor(ctxOf({ state: { last_report: r.report } }), {
    collect: withExpired,
    env,
    fetchImpl,
  });
  check(
    "同じ異常は、次の実行（5分後）で再通知しない",
    r2.body.sent === 0 && posted.length === 1,
  );
  // Slack が失敗: 例外。通知済みの記録は進まない（次の実行で再送）
  const failingFetch = async () => new Response("no", { status: 500 });
  let threw2;
  return { now, jobState, ctxOf, collectOf, posted, fetchImpl, env, r, withExpired, failingFetch, threw2 };
}

/** 元の verify の1つの塊 { } を割った 3/3 */
async function scene3({ now, jobState, ctxOf, collectOf, posted, fetchImpl, env, r, withExpired, failingFetch, threw2 }) {
  try {
    await runMonitor(ctxOf(), {
      collect: withExpired,
      env,
      fetchImpl: failingFetch,
    });
  } catch (e) {
    threw2 = e;
  }
  check(
    "Slackへの投稿の失敗は例外（通知できなかったことを実行の失敗として残す）",
    threw2 && /HTTP 500/.test(threw2.message),
  );
  // 日次サマリー
  const weekSlots = [
    doneOdds(1),
    doneOdds(1),
    doneOdds(10),
    slot("odds", -60, "done", {
      race_date: "2026-09-18",
      start_time: "10:00:00",
      done_at: iso(new Date(at("09:00", "2026-09-18").getTime() + 60000)),
    }),
  ];
  posted.length = 0;
  const dailyNow = at("00:10", "2026-09-20");
  r = await runMonitor(
    ctxOf({ now: () => dailyNow, query: { mode: "daily" } }),
    {
      collect: collectOf({
        jobStates: [
          jobState({ last_tick_at: iso(new Date(dailyNow.getTime() - 60000)) }),
        ],
        weekSlots,
      }),
      env,
      fetchImpl,
    },
  );
  const summaryText = show(posted.map((p) => p.body));
  check(
    "日次サマリー: 前日（2026-09-19）と直近7日の窓内取得率・遅延・モードを投稿する",
    r.body.sent === 1 &&
      /日次サマリー 2026-09-19/.test(summaryText) &&
      /odds: 前日 66\.7%/.test(summaryText) &&
      /直近7日 75\.0%/.test(summaryText) &&
      /odds=live/.test(summaryText),
    summaryText.slice(0, 400),
  );
  const s = formatDailySummary({
    date: DATE,
    stats7d: [],
    statsDay: [],
    jobStates: [],
    now,
  });
  check(
    "日次サマリー: 集計対象が無くても組み立てられる",
    /集計対象のスロットなし/.test(show(s)),
  );
}

async function scene4() {
  {
    const s1 = await scene1();
    const s2 = await scene2(s1);
    await scene3(s2);
  }
  // ---------------------------------------------------------------------------
  // (f) cleanup
  // ---------------------------------------------------------------------------
  {
    const c = cleanupCutoffs(at("04:00", "2026-09-20"));
    check(
      "cleanup の基準日: 2日以上前 = race_date < 前日、保持期間 = 60日前より古い",
      c.today === "2026-09-20" &&
        c.staleBefore === "2026-09-19" &&
        c.retentionBefore === "2026-07-22",
      show(c),
    );
    const calls = [];
    const builder = (kind, result) => {
      const b = { kind, ops: [] };
      for (const m of ["update", "delete", "in", "lt", "select"]) {
        b[m] = (...args) => {
          b.ops.push([m, ...args]);
          return b;
        };
      }
      b.then = (resolve, reject) => {
        calls.push(b);
        return Promise.resolve(result).then(resolve, reject);
      };
      return b;
    };
    let n = 0;
    const client = {
      from: () =>
        n++ === 0
          ? builder("sweep", { data: null, count: 2, error: null })
          : builder("delete", { data: null, count: 5, error: null }),
    };
    const r = await runCleanup({ client, now: () => at("04:00", "2026-09-20") });
    check(
      "cleanup: 古い未完了を expired にし（pending・running・race_date<前日）、保持期間を過ぎた行を削除する",
      r.body.staleExpired === 2 &&
        r.body.deleted === 5 &&
        r.rowsWritten === 7 &&
        calls[0].ops.some(
          (o) =>
            o[0] === "in" &&
            o[1] === "status" &&
            show(o[2]) === '["pending","running"]',
        ) &&
        calls[0].ops.some(
          (o) => o[0] === "lt" && o[1] === "race_date" && o[2] === "2026-09-19",
        ) &&
        calls[0].ops[0][1].status === "expired" &&
        calls[1].ops.some(
          (o) => o[0] === "lt" && o[1] === "race_date" && o[2] === "2026-07-22",
        ),
      show(r.body),
    );
    let threw;
    try {
      await runCleanup({
        client: {
          from: () =>
            builder("sweep", { data: null, error: { message: "boom" } }),
        },
        now: () => at("04:00", "2026-09-20"),
      });
    } catch (e) {
      threw = e;
    }
    check(
      "cleanup: DBエラーは握りつぶさず例外",
      threw && /boom/.test(threw.message),
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・show・DATE・at・iso・slot・doneOdds） */
export async function runScrapeMonitorScenes7(env) {
  ({ check, show, DATE, at, iso, slot, doneOdds } = env);
  await scene4();
}
