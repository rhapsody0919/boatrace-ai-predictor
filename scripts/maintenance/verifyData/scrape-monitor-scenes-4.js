/**
 * verify-scrape-monitor.js の後半の場面（4/8）。verify ではない。
 * 判定と期待値は分ける前の verify-scrape-monitor.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import {
  classifyExpectedUnpublished,
  computeWindowStats,
  evaluateDetectionLag,
  formatDailySummary,
  evaluateExpired,
  runMonitor,
} from "../../lib/scrapeJobs/monitor.js";
import {
  isExtensionSuccess,
  detectionLagOf,
  summarizeDetectionLags,
} from "../../lib/scrapeJobs/expectedUnpublished.js";
import { SCRAPE_JOBS } from "../../lib/scrapeJobs/registry.js";

let check, show, DATE, at, iso, slot;

/** 元の verify の1つの塊 { } を割った 1/5 */
function scene1() {
  const D = DATE;
  const active = new Set(["odds"]);
  const T = (hhmmss) => iso(new Date(`${D}T${hhmmss}+09:00`));
  // 延長で取得できた -60: 10:00発走・期限09:00。最初の試行 09:00:10、最後の試行 09:05:10、完了 09:05:20（窓 09:03 より後）
  const ext = (over = {}) =>
    slot("odds", -60, "done", {
      race_id: `${D}-06-05`,
      attempts: 6,
      outcome: "ok",
      first_attempt_at: T("09:00:10"),
      last_attempt_at: T("09:05:10"),
      done_at: T("09:05:20"),
      ...over,
    });
  const e1 = ext();
  check(
    "延長で取得できた: 完了（ok）・試行2回以上・完了が窓（期限+3分）より後・最初の試行は窓の中 → 発売開始の遅れ（confirmed）",
    isExtensionSuccess(e1) &&
      classifyExpectedUnpublished([e1]).get(`odds:${D}-06-05:-60`) ===
        "confirmed",
    show([...classifyExpectedUnpublished([e1])]),
  );
  // 対象外: 窓の中で完了（通常のヒット）・試行1回（未公開で再試行していない）・最初の試行が窓の後（自分の試行の遅れ）・
  // outcome が ok 以外・shadow・確定中止
  const notExt = [
    [
      "窓の中（09:02）で完了した通常のヒット",
      ext({ done_at: T("09:02:00"), last_attempt_at: T("09:01:50") }),
    ],
    [
      "試行1回で、窓の後に完了（未公開ではなく、取得側の遅れ）",
      ext({
        attempts: 1,
        first_attempt_at: T("09:10:00"),
        last_attempt_at: T("09:10:00"),
        done_at: T("09:10:10"),
      }),
    ],
    [
      "最初の試行が窓（09:03）の後（Cronの欠け等。発売開始の遅れの根拠が無い）",
      ext({
        attempts: 2,
        first_attempt_at: T("09:10:00"),
        last_attempt_at: T("09:11:00"),
        done_at: T("09:11:10"),
      }),
    ],
    [
      "outcome が skipped_have_data（既存データがあった）",
      ext({ outcome: "skipped_have_data" }),
    ],
    ["shadow", ext({ run_mode: "shadow" })],
    ["確定中止のレース", ext({ cancel: "confirmed" })],
    [
      "別の窓（-30）",
      slot("odds", -30, "done", {
        race_id: `${D}-06-05`,
        attempts: 6,
        outcome: "ok",
        first_attempt_at: T("09:30:10"),
        last_attempt_at: T("09:35:10"),
        done_at: T("09:35:20"),
      }),
    ],
    [
      "別のジョブ（result）",
      slot("result", -60, "done", {
        race_id: `${D}-06-05`,
        attempts: 6,
        outcome: "ok",
        first_attempt_at: T("09:00:10"),
        last_attempt_at: T("09:05:10"),
        done_at: T("09:05:20"),
      }),
    ],
  ];
  return { D, active, T, ext, e1, notExt };
}

/** 元の verify の1つの塊 { } を割った 2/5 */
function scene2({ D, active, T, ext, e1, notExt }) {
  for (const [label, target] of notExt) {
    check(
      `延長で取得できた扱いにしない: ${label}`,
      !isExtensionSuccess(target) &&
        classifyExpectedUnpublished([target]).size === 0,
      show([...classifyExpectedUnpublished([target])]),
    );
  }
  // 窓内取得率: 延長で取得できたものは、分母から外して別枠。通常のヒット・自分の遅れは分母に残る
  const hitSlot = ext({
    race_id: `${D}-06-01`,
    done_at: T("09:02:00"),
    last_attempt_at: T("09:01:50"),
    attempts: 2,
  });
  const lateOwn = ext({
    race_id: `${D}-06-02`,
    attempts: 1,
    first_attempt_at: T("09:10:00"),
    last_attempt_at: T("09:10:00"),
    done_at: T("09:10:10"),
  });
  const pool = [e1, hitSlot, lateOwn];
  const cls = classifyExpectedUnpublished(pool, {});
  const st = computeWindowStats(pool, SCRAPE_JOBS, {
    expectedUnpublished: cls,
  }).find((x) => x.job === "odds" && x.offset_min === -60);
  check(
    "窓内取得率: 延長で取得できた1件を分母から外して別枠（expectedUnpublished=1）。通常のヒット・取得側の遅れは分母に残る（total=2, hit=1）。窓内のヒットの判定は、延長後の許容幅（30分）ではなく3分",
    st.expectedUnpublished === 1 && st.total === 2 && st.hit === 1,
    show(st),
  );
  // 検知の遅れ: 延長で取得できた（試行6回）は、(最後−最初)÷(試行回数−1)＝平均の試行間隔。試行2回は、最後−最初（正確）
  const lag1 = detectionLagOf(e1, []);
  const two = ext({
    attempts: 2,
    first_attempt_at: T("09:02:30"),
    last_attempt_at: T("09:03:30"),
    done_at: T("09:03:40"),
  });
  const lag2 = detectionLagOf(two, []);
  check(
    "検知の遅れ（延長で取得）: 試行6回は平均の試行間隔（300秒÷5=1.0分）、試行2回は最後−最初（1.0分）",
    Math.abs(lag1.lagMin - 1) < 1e-9 &&
      lag1.basis === "extension" &&
      Math.abs(lag2.lagMin - 1) < 1e-9,
    show([lag1, lag2]),
  );
  // 延長しても取れず、後続の窓で取得できた（延長が効いていない場合。-60は09:03:10が最後の試行、-30は09:30:20に完了）
  const R2 = `${D}-07-03`;
  const gone = slot("odds", -60, "expired", {
    race_id: R2,
    attempts: 3,
    outcome: "no_values",
    first_attempt_at: T("09:00:10"),
    last_attempt_at: T("09:02:10"),
  });
  const l30 = slot("odds", -30, "done", {
    race_id: R2,
    attempts: 1,
    outcome: "ok",
    first_attempt_at: T("09:30:10"),
    last_attempt_at: T("09:30:10"),
    done_at: T("09:30:20"),
  });
  const lag3 = detectionLagOf(gone, [gone, l30]);
  return { D, active, T, ext, e1, pool, cls, R2, gone, l30, lag3 };
}

/** 元の verify の1つの塊 { } を割った 3/5 */
function scene3({ D, active, T, ext, e1, pool, cls, R2, gone, l30, lag3 }) {
  check(
    "検知の遅れ（延長が効かず後続の窓で取得）: 後続の窓の完了時刻 − -60の最後の試行（09:30:20 − 09:02:10 = 28.2分）",
    Math.abs(lag3.lagMin - (28 + 10 / 60)) < 1e-6 &&
      lag3.basis === "later_window",
    show(lag3),
  );
  const l30retry = slot("odds", -30, "done", {
    race_id: R2,
    attempts: 3,
    outcome: "ok",
    first_attempt_at: T("09:30:10"),
    last_attempt_at: T("09:32:10"),
    done_at: T("09:32:20"),
  });
  const lag4 = detectionLagOf(gone, [gone, l30retry]);
  check(
    "検知の遅れ（後続の窓が試行2回以上で完了）: その窓の最初の試行を、直前の未公開の試行の上限とする（09:32:20 − 09:30:10 = 2.2分）",
    Math.abs(lag4.lagMin - (2 + 10 / 60)) < 1e-6,
    show(lag4),
  );
  const lag5 = detectionLagOf({ ...gone, last_attempt_at: null }, [gone, l30]);
  check(
    "検知の遅れ: 時刻が残っていなければ計測不能（null）",
    lag5.lagMin === null,
  );
  // 集計: 5分以内の割合・p50/p95・計測不能
  const slotsLag = [
    e1,
    ext({
      race_id: `${D}-08-01`,
      attempts: 4,
      first_attempt_at: T("09:00:10"),
      last_attempt_at: T("09:03:10"),
      done_at: T("09:03:20"),
    }),
    ext({
      race_id: `${D}-08-02`,
      attempts: 3,
      first_attempt_at: T("09:00:10"),
      last_attempt_at: T("09:20:10"),
      done_at: T("09:20:20"),
    }),
    gone,
  ];
  const clsLag = classifyExpectedUnpublished(slotsLag, {
    siblingSlots: [gone, l30],
    now: at("09:40"),
  });
  const sum = summarizeDetectionLags(slotsLag, clsLag, [gone, l30]);
  check(
    "集計: confirmed 4件（延長3・後続の窓1）。うち試行4回の09:03:20は窓（09:03）の後だが延長で取得。平均間隔 e1=1.0・08-01=1.0・08-02=10.0分、後続の窓=28.2分 → 5分以内 2/4（50%）、5分超 2件・最大28.2分",
    sum.total === 4 &&
      sum.measured === 4 &&
      sum.within === 2 &&
      sum.over === 2 &&
      sum.unmeasured === 0 &&
      sum.rate === 0.5 &&
      Math.abs(sum.maxMin - (28 + 10 / 60)) < 1e-6 &&
      sum.byBasis.extension === 3 &&
      sum.byBasis.later_window === 1,
    show(sum),
  );
  const sumUn = summarizeDetectionLags(
    [gone],
    new Map([[`odds:${R2}:-60`, "confirmed"]]),
    [],
  );
  check(
    "集計: 後続の窓が無く測れないものは、計測不能として別に数える（5分以内の割合の分母に入れない）",
    sumUn.total === 1 &&
      sumUn.measured === 0 &&
      sumUn.unmeasured === 1 &&
      sumUn.rate === null,
    show(sumUn),
  );
  return { D, active, T, e1, pool, cls, R2, gone, l30, sum };
}

/** 元の verify の1つの塊 { } を割った 4/5 */
function scene4({ D, active, T, e1, pool, cls, R2, gone, l30, sum }) {
  // 警告: 5分超が1件でもあれば通知（最大・件数・レース）。無ければ通知しない
  const lagAlerts = evaluateDetectionLag(sum, D);
  check(
    "検知の遅れの警告: 5分超があれば1件（件数・最大・レースを含む）、無ければ通知しない",
    lagAlerts.length === 1 &&
      lagAlerts[0].key === `detection_lag:${D}` &&
      /2件\/4件/.test(lagAlerts[0].text) &&
      /28\.2分/.test(lagAlerts[0].text) &&
      evaluateDetectionLag(
        summarizeDetectionLags([e1], classifyExpectedUnpublished([e1]), []),
        D,
      ).length === 0,
    show(lagAlerts.map((a) => a.text)),
  );
  // 日次サマリー: 前日・直近7日の検知の遅れを出す（0件でも出す）
  const smLag = formatDailySummary({
    date: D,
    stats7d: computeWindowStats(pool, SCRAPE_JOBS, {
      expectedUnpublished: cls,
    }),
    statsDay: computeWindowStats(pool, SCRAPE_JOBS, {
      expectedUnpublished: cls,
    }),
    jobStates: [{ job: "odds", mode: "live" }],
    now: at("09:40"),
    detectionLagDay: sum,
    detectionLag7d: sum,
  }).attachments[0].blocks[0].text.text;
  check(
    "日次サマリー: 発売開始の検知の遅れ（5分以内 2/4・p95・最大・計測不能・延長/後続の窓の内訳）を、前日・直近7日で出す",
    /発売開始の検知の遅れ/.test(smLag) &&
      /5分以内 2\/4（50\.0%）/.test(smLag) &&
      /最大 28\.2分/.test(smLag) &&
      /延長で取得 3件・後続の窓で取得 1件/.test(smLag),
    smLag,
  );
  // -60の窓の延長中（未公開のまま許容幅30分以内）は、警告しない。-30が始まった後は、従来どおり警告する
  const inflight = slot("odds", -60, "pending", {
    race_id: R2,
    attempts: 5,
    outcome: "no_values",
    first_attempt_at: T("09:00:10"),
    last_attempt_at: T("09:04:10"),
  });
  check(
    "延長中の -60（09:10。期限+3分は過ぎたが、延長後の許容幅30分の内）は、期限切れとして警告しない",
    evaluateExpired([inflight], { activeJobs: active, now: at("09:10") })
      .length === 0,
  );
  check(
    "延長の終わり（09:30。-30の窓が始まる）を過ぎても未公開なら、従来どおり警告する（09:31）",
    evaluateExpired([inflight], { activeJobs: active, now: at("09:31") })
      .length === 1,
  );
  const noExtension = {
    ...SCRAPE_JOBS,
    odds: { ...SCRAPE_JOBS.odds, graceMinByOffset: undefined },
  };
  check(
    "変異検証: レジストリの延長（graceMinByOffset）が無ければ、09:10の未公開の -60 を、期限切れとして警告する（判定が延長を見ている）",
    evaluateExpired([inflight], {
      activeJobs: active,
      now: at("09:10"),
      registry: noExtension,
    }).length === 1,
  );
  // runMonitor: 延長で取得できたものだけなら通知しない。延長が効かず後続の窓で取得したもの（検知の遅れ5分超）は通知する
  const nowM = at("10:30");
  const postedM = [];
  const fetchM = async (url, init) => {
    postedM.push(JSON.parse(init.body));
    return new Response("ok", { status: 200 });
  };
  return { e1, gone, l30, nowM, postedM, fetchM };
}

/** 元の verify の1つの塊 { } を割った 5/5 */
async function scene5({ e1, gone, l30, nowM, postedM, fetchM }) {
  const jobStateM = {
    job: "odds",
    mode: "live",
    consecutive_failures: 0,
    last_error: null,
    last_tick_at: iso(new Date(nowM.getTime() - 60000)),
  };
  const collectM = (today, siblings) => async () => ({
    available: true,
    weekSlots: null,
    todaySlots: today,
    jobStates: [jobStateM],
    expiredSlots: today.filter((x) => x.status === "expired"),
    oddsSlots: siblings,
  });
  const ctxM = () => ({ now: () => nowM, query: {}, state: null, client: {} });
  const envM = { SLACK_WEBHOOK_URL: "https://hooks.example.test/x" };
  let resM = await runMonitor(ctxM(), {
    collect: collectM([e1], []),
    env: envM,
    fetchImpl: fetchM,
  });
  check(
    "runMonitor: 延長で取得できた -60（検知の遅れ約1分）だけなら、通知しない",
    resM.body.alerts === 0 && postedM.length === 0,
    show(resM.body),
  );
  resM = await runMonitor(ctxM(), {
    collect: collectM([gone, l30], [gone, l30]),
    env: envM,
    fetchImpl: fetchM,
  });
  check(
    "runMonitor: 延長が効かず後続の窓で取得（検知の遅れ約28分）した場合は、期限切れの警告ではなく、検知の遅れの警告を1件出す",
    resM.body.alerts === 1 &&
      postedM.length === 1 &&
      /発売開始の検知の遅れ/.test(
        postedM[0].attachments[0].blocks[0].text.text,
      ),
    show([resM.body, postedM.map((m) => m.text)]),
  );
}

async function scene6() {
  {
    const s1 = scene1();
    const s2 = scene2(s1);
    const s3 = scene3(s2);
    const s4 = scene4(s3);
    await scene5(s4);
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・show・DATE・at・iso・slot） */
export async function runScrapeMonitorScenes4(env) {
  ({ check, show, DATE, at, iso, slot } = env);
  await scene6();
}
