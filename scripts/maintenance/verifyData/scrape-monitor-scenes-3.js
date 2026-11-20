/**
 * verify-scrape-monitor.js の後半の場面（3/8）。verify ではない。
 * 判定と期待値は分ける前の verify-scrape-monitor.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import {
  classifyExpectedUnpublished,
  computeWindowStats,
  evaluateWindowRates,
  formatDailySummary,
  runMonitor,
} from "../../lib/scrapeJobs/monitor.js";
import { firstRaceIdSet } from "../../lib/scrapeJobs/expectedUnpublished.js";
import { SCRAPE_JOBS } from "../../lib/scrapeJobs/registry.js";
import { nv, D, later, LATER, t, R } from "./scrape-monitor-scenes-1.js";

let check, show, at, iso, doneOdds;

/** 元の verify の1つの塊 { } を割った 1/3 */
function scene1() {
  // 窓内取得率・日次サマリー: confirmed は分母から外して別枠、deferred も分母に入れず別枠、後続の窓も取れなかったものは欠落
  const hits = Array.from({ length: 20 }, () => doneOdds(1));
  const misses = Array.from({ length: 3 }, () => doneOdds(10));
  const conf = [nv(`${D}-01-03`), nv(`${D}-02-01`)];
  const defer = nv(`${D}-03-01`);
  const bad = nv(`${D}-04-01`);
  const siblingsAll = [
    ...later(`${D}-01-03`, [-30], "done", { outcome: "ok" }),
    ...later(`${D}-02-01`, [-15], "done", { outcome: "ok" }),
    ...later(`${D}-03-01`, LATER, "pending", { attempts: 0 }),
    ...later(`${D}-04-01`, LATER, "expired", {
      outcome: "no_values",
      attempts: 3,
    }),
  ];
  const allSlots = [...hits, ...misses, ...conf, defer, bad];
  const now2 = at("09:40");
  const map = classifyExpectedUnpublished(allSlots, {
    siblingSlots: [...allSlots, ...siblingsAll],
    now: now2,
  });
  const stats = computeWindowStats(allSlots, SCRAPE_JOBS, {
    expectedUnpublished: map,
  });
  const g = stats.find((s) => s.job === "odds" && s.offset_min === -60);
  check(
    "窓内取得率: confirmed は分母から外し expectedUnpublished、deferred は分母に入れず deferred、後続の窓も取れなかったものは欠落（expired）として数える",
    g.total === 24 &&
      g.hit === 20 &&
      g.expired === 1 &&
      g.expectedUnpublished === 2 &&
      g.deferred === 1,
    show(g),
  );
  const alertsRate = evaluateWindowRates(stats, D);
  check(
    "窓内取得率の警告（20/24）: 分母から外した想定内の未公開・保留の件数を、警告に含める（黙って除外しない）",
    alertsRate.length === 1 &&
      /発売開始の遅れ\(想定内の未公開\) 2件/.test(alertsRate[0].text) &&
      /判定保留 1件/.test(alertsRate[0].text),
    show(alertsRate.map((a) => a.text)),
  );
  const okOnly = [...hits, conf[0]];
  check(
    "想定内の未公開を分母から外すと、それだけでは窓内取得率は下がらない（20/20）",
    evaluateWindowRates(
      computeWindowStats(okOnly, SCRAPE_JOBS, {
        expectedUnpublished: classifyExpectedUnpublished(okOnly, {
          siblingSlots: siblingsAll,
          now: now2,
        }),
      }),
      D,
    ).length === 0,
  );
  const smText = formatDailySummary({
    date: D,
    stats7d: stats,
    statsDay: stats,
    jobStates: [{ job: "odds", mode: "live" }],
    now: now2,
  }).attachments[0].blocks[0].text.text;
  check(
    "日次サマリー: 想定内の未公開（分母から除外）の件数を、前日・直近7日で別枠に出す。保留があれば保留も出す",
    /発売開始の遅れ\(想定内・分母から除外\) 前日 2件・直近7日 2件/.test(
      smText,
    ) && /判定保留 前日 1件・直近7日 1件/.test(smText),
    smText,
  );
  return { hits, now2 };
}

/** 元の verify の1つの塊 { } を割った 2/3 */
async function scene2({ hits, now2 }) {
  const smZero = formatDailySummary({
    date: D,
    stats7d: computeWindowStats(hits),
    statsDay: computeWindowStats(hits),
    jobStates: [{ job: "odds", mode: "live" }],
    now: now2,
  }).attachments[0].blocks[0].text.text;
  check(
    "日次サマリー: 想定内の未公開が0件でも、oddsの行には別枠を出す（0件と明示）。保留が無ければ保留は出さない",
    /発売開始の遅れ\(想定内・分母から除外\) 前日 0件・直近7日 0件/.test(
      smZero,
    ) && !/判定保留/.test(smZero),
    smZero,
  );
  // 第1レースの決定（races の最小のレース番号）
  const fr = firstRaceIdSet([
    { race_id: `${D}-01-03`, race_date: D, venue_code: 1, race_number: 3 },
    { race_id: `${D}-01-04`, race_date: D, venue_code: 1, race_number: 4 },
    { race_id: `${D}-01-05`, race_date: D, venue_code: 1, race_number: null },
    { race_id: `${D}-02-01`, race_date: D, venue_code: 2, race_number: 1 },
    { race_id: `${D}-02-02`, race_date: D, venue_code: 2, race_number: 2 },
    {
      race_id: "2026-09-20-01-01",
      race_date: "2026-09-20",
      venue_code: 1,
      race_number: 1,
    },
  ]);
  check(
    "firstRaceIdSet: 会場×日ごとの最小のレース番号（race_id の末尾ではなく race_number で決める。日が違えば別。race_number が無い行は無視）",
    show([...fr].sort()) ===
      show([`${D}-01-03`, `${D}-02-01`, "2026-09-20-01-01"].sort()),
    show([...fr]),
  );
  // runMonitor: 想定内の未公開だけなら通知しない。後続の窓も取れなければ通知する
  const now3 = at("09:40");
  const posted3 = [];
  const fetch3 = async (url, init) => {
    posted3.push(JSON.parse(init.body));
    return new Response("ok", { status: 200 });
  };
  const jobState3 = {
    job: "odds",
    mode: "live",
    consecutive_failures: 0,
    last_error: null,
    last_tick_at: iso(new Date(now3.getTime() - 60000)),
  };
  const collect3 = (siblings) => async () => ({
    available: true,
    weekSlots: null,
    todaySlots: [],
    jobStates: [jobState3],
    expiredSlots: [t],
    oddsSlots: siblings,
  });
  const ctx3 = () => ({ now: () => now3, query: {}, state: null, client: {} });
  const env3 = { SLACK_WEBHOOK_URL: "https://hooks.example.test/x" };
  let res = await runMonitor(ctx3(), {
    collect: collect3([t, ...later(R, [-30], "done", { outcome: "ok" })]),
    env: env3,
    fetchImpl: fetch3,
  });
  check(
    "runMonitor: 想定内の未公開（後続の窓が取れている）だけなら、通知しない",
    res.body.alerts === 0 && posted3.length === 0,
    show(res.body),
  );
  return { posted3, fetch3, jobState3, collect3, ctx3, env3, res };
}

/** 元の verify の1つの塊 { } を割った 3/3 */
async function scene3({ posted3, fetch3, jobState3, collect3, ctx3, env3, res }) {
  res = await runMonitor(ctx3(), {
    collect: collect3([
      t,
      ...later(R, LATER, "expired", { outcome: "no_values", attempts: 3 }),
    ]),
    env: env3,
    fetchImpl: fetch3,
  });
  check(
    "runMonitor: 後続の窓も取れなければ通知する",
    res.body.alerts === 1 && posted3.length === 1,
    show(res.body),
  );
  res = await runMonitor(ctx3(), {
    collect: async () => ({
      available: true,
      weekSlots: null,
      todaySlots: [],
      jobStates: [jobState3],
      expiredSlots: [t],
    }),
    env: env3,
    fetchImpl: fetch3,
  });
  check(
    "runMonitor: オッズのスロットを渡さない入力（従来の形）でも、従来どおり通知する（例外にしない）",
    res.body.alerts === 1,
    show(res.body),
  );
}

async function scene4() {
  {
    const s1 = scene1();
    const s2 = await scene2(s1);
    await scene3(s2);
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・show・at・iso・doneOdds） */
export async function runScrapeMonitorScenes3(env) {
  ({ check, show, at, iso, doneOdds } = env);
  await scene4();
}
