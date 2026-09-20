/**
 * verify-scrape-monitor.js - データ取得の監視・保守（scripts/lib/scrapeJobs/monitor.js・cleanup.js、
 * api/cron/scrape-*.js、vercel.json の crons、メタ監視）の検証。DBにもSlackにも接続しない。
 *
 * 確認すること:
 *   (a) 窓内取得率・遅延の集計（確定中止・shadow・未claimの他モードのジョブを分母に入れない。展示は許容幅ベース）
 *   (b) expired・未実行の検知（1件でも）、窓内取得率の閾値（母数が小さいときは判定しない）
 *   (c) 死活（運用窓の開始直後は判定しない）・連続失敗・ブレーカー・0件エラー・日次ジョブの期限超過
 *   (d) 通知の重複抑制（expired・未実行は1スロットにつき1回、持続する状態は6時間おき）
 *   (e) runMonitor: 072未適用・有効なジョブなしでは何も通知しない（誤報なし）。異常があれば通知し、
 *       通知先が無ければ失敗にする。通知に失敗したら通知済みの記録を進めない。日次サマリーの投稿条件
 *   (f) scrape-cleanup: 2日以上前の未完了のexpired化と、60日超の削除
 *   (g) メタ監視（監視自体の死活）: 運用窓の外・行なし・鮮度・連続失敗
 *   (h) 共通ラッパ経由のHTTPハンドラー: 未認証は401、072未適用は200でskipped
 *   (i) api/cron/scrape-*.js と vercel.json の整合（cronのパスの実在・cron式・maxDurationとレジストリの一致）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  THRESHOLDS,
  aggregateByJob,
  applyDedupe,
  computeWindowStats,
  evaluateExpired,
  evaluateJobStates,
  evaluateWindowRates,
  formatAlertMessage,
  formatDailySummary,
  livenessCheckable,
  percentile,
  runMonitor,
} from "../lib/scrapeJobs/monitor.js";
import { cleanupCutoffs, runCleanup } from "../lib/scrapeJobs/cleanup.js";
import { createScrapeCronHandler } from "../lib/scrapeJobs/cronWrapper.js";
import { SCRAPE_JOBS } from "../lib/scrapeJobs/registry.js";
import {
  evaluateMonitorLiveness,
  MONITOR_STALE_MIN,
} from "./check-scrape-monitor-liveness.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "../..");

const printOut = console.log.bind(console);
const printErr = console.error.bind(console);
console.warn = () => {};
console.error = () => {};

let failures = 0;
function check(label, pass, detail = "") {
  if (pass) {
    printOut(`✅ ${label}`);
  } else {
    failures++;
    printErr(`❌ ${label}${detail ? ` (${detail})` : ""}`);
  }
}
const show = (v) => JSON.stringify(v);

const DATE = "2026-09-19";
// 2026-09-19 のレース（発走 10:00 JST）。期限は offset 分後
const at = (hhmm, date = DATE) => new Date(`${date}T${hhmm}:00+09:00`);
const iso = (d) => d.toISOString();

let seq = 0;
function slot(job, offset, status, over = {}) {
  seq++;
  const startTime = over.start_time ?? "10:00:00";
  return {
    job,
    race_id: over.race_id ?? `${DATE}-01-${String(seq).padStart(2, "0")}`,
    offset_min: offset,
    race_date: over.race_date ?? DATE,
    status,
    attempts: over.attempts ?? (status === "expired" ? 2 : 1),
    outcome: over.outcome ?? (status === "done" ? "ok" : null),
    run_mode: "run_mode" in over ? over.run_mode : "live",
    done_at: over.done_at ?? null,
    last_error: over.last_error ?? null,
    races: {
      start_time: startTime,
      cancellation_status: over.cancel ?? null,
    },
  };
}
// 10:00発走のオッズ -60（期限 09:00）を、delay分後に完了した done
const doneOdds = (delayMin, over = {}) =>
  slot("odds", -60, "done", {
    ...over,
    done_at: iso(new Date(at("09:00").getTime() + delayMin * 60000)),
  });

// ---------------------------------------------------------------------------
// (a) 集計
// ---------------------------------------------------------------------------
{
  const slots = [
    doneOdds(0.5),
    doneOdds(2.9),
    doneOdds(3.5), // 許容(3分)超 → ヒットではない
    slot("odds", -60, "expired", { attempts: 0 }), // 未実行
    slot("odds", -60, "expired", { attempts: 3 }),
    doneOdds(1, { run_mode: "shadow" }), // shadow は数えない
    doneOdds(1, { cancel: "confirmed" }), // 確定中止は数えない
    slot("odds", -60, "done", {
      outcome: "cancelled_race",
      done_at: iso(at("09:00")),
    }),
    slot("odds", -60, "pending"), // 未完了は数えない
    slot("odds", -30, "done", {
      done_at: iso(new Date(at("09:30").getTime() + 60000)),
    }),
  ];
  const stats = computeWindowStats(slots);
  const m60 = stats.find((s) => s.job === "odds" && s.offset_min === -60);
  check(
    "窓別の集計: 分母は live の done・expired（shadow・確定中止・未完了を除く）。許容幅3分のジョブは期限+3分でヒット判定",
    m60.total === 5 &&
      m60.hit === 2 &&
      m60.expired === 2 &&
      m60.unexecuted === 1,
    show(m60),
  );
  check(
    "遅延の p50・p95（分）",
    m60.delayP50Min === 2.9 && m60.delayP95Min === 3.5,
    show([m60.delayP50Min, m60.delayP95Min]),
  );
  check(
    "percentile: 空なら null、最近傍順位法",
    percentile([], 50) === null &&
      percentile([1, 2, 3, 4], 50) === 2 &&
      percentile([1, 2, 3, 4], 95) === 4,
  );
  const job = aggregateByJob(stats).find((j) => j.job === "odds");
  check(
    "ジョブ別の窓内取得率（窓を束ねる）",
    job.total === 6 && job.hit === 3 && Math.abs(job.rate - 0.5) < 1e-9,
    show(job),
  );

  // 展示（許容幅26分）は、期限〜期限+許容幅でヒット判定。3分ヒットも併記
  const expo = [
    slot("exhibition", -33, "done", {
      start_time: "10:00:00",
      done_at: iso(new Date(at("09:27").getTime() + 10 * 60000)), // 期限(09:27)+10分
    }),
    slot("exhibition", -33, "done", {
      done_at: iso(new Date(at("09:27").getTime() + 27 * 60000)), // 許容幅(26分)超
    }),
  ];
  const [e] = computeWindowStats(expo);
  check(
    "許容幅が3分より長いジョブは、期限+許容幅でヒット判定（3分内のヒットも別に持つ）",
    e.total === 2 && e.hit === 1 && e.hitTolerance === 0 && e.hitGrace === 1,
    show(e),
  );

  // off・shadow のジョブの、一度も claim されなかった expired は、live のジョブ以外では数えない
  const leftovers = [
    slot("odds", -60, "expired", { attempts: 0, run_mode: null }),
  ];
  check(
    "liveJobs を渡すと、live でないジョブの未claimのexpiredは分母に入れない",
    computeWindowStats(leftovers, SCRAPE_JOBS, { liveJobs: new Set() })
      .length === 0 &&
      computeWindowStats(leftovers, SCRAPE_JOBS, {
        liveJobs: new Set(["odds"]),
      })[0].total === 1,
  );
}

// ---------------------------------------------------------------------------
// (b) expired・未実行・窓内取得率の通知
// ---------------------------------------------------------------------------
{
  const active = new Set(["odds"]);
  const expired = [
    slot("odds", -60, "expired", { attempts: 0, race_id: "2026-09-19-01-01" }),
    slot("odds", -60, "expired", {
      attempts: 3,
      race_id: "2026-09-19-01-02",
      outcome: "error",
      last_error: "取得先が429",
    }),
    slot("odds", -60, "expired", {
      attempts: 2,
      cancel: "confirmed",
      race_id: "2026-09-19-01-03",
    }),
    slot("odds", -60, "expired", {
      attempts: 2,
      run_mode: "shadow",
      race_id: "2026-09-19-01-04",
    }),
    slot("result", 5, "expired", { attempts: 0, race_id: "2026-09-19-01-05" }), // result は off（有効でない）
  ];
  const alerts = evaluateExpired(expired, { activeJobs: active });
  check(
    "expired 1件ごとに通知。attempts=0 は『未実行』として区別する。確定中止・shadow・有効でないジョブは除く",
    alerts.length === 2 &&
      alerts[0].kind === "unexecuted" &&
      alerts[0].key === "unexecuted:odds:2026-09-19-01-01:-60" &&
      alerts[1].kind === "expired" &&
      /取得先が429/.test(alerts[1].text) &&
      /2026-09-19-01-02/.test(alerts[1].text) &&
      /-60/.test(alerts[1].text),
    show(alerts.map((a) => a.key)),
  );

  const many = (hit, total) =>
    computeWindowStats([
      ...Array.from({ length: hit }, () => doneOdds(1)),
      ...Array.from({ length: total - hit }, () => doneOdds(10)),
    ]);
  check(
    "窓内取得率 97.5%（39/40）は閾値98%未満で通知",
    evaluateWindowRates(many(39, 40), DATE).length === 1,
  );
  check(
    "窓内取得率 98%（49/50）は通知しない",
    evaluateWindowRates(many(49, 50), DATE).length === 0,
  );
  check(
    `母数が${THRESHOLDS.windowRateMinSamples}件未満では、率が低くても判定しない`,
    evaluateWindowRates(many(1, 10), DATE).length === 0,
  );
}

// ---------------------------------------------------------------------------
// (c) ジョブ状態
// ---------------------------------------------------------------------------
{
  const now = at("12:00");
  const minAgo = (m) => iso(new Date(now.getTime() - m * 60000));
  const base = (over) => ({
    mode: "live",
    consecutive_failures: 0,
    last_error: null,
    last_tick_at: minAgo(1),
    ...over,
  });
  const kinds = (rows, when = now) =>
    evaluateJobStates(rows, when).map(
      (a) => `${a.kind}:${a.key.split(":")[1]}`,
    );

  check("正常なジョブは通知なし", kinds([base({ job: "odds" })]).length === 0);
  check(
    "死活: last_tick_at が10分以上前で通知（9分前は通知しない）",
    show(kinds([base({ job: "odds", last_tick_at: minAgo(10) })])) ===
      '["liveness:odds"]' &&
      kinds([base({ job: "odds", last_tick_at: minAgo(9) })]).length === 0,
  );
  check(
    "死活: last_tick_at が未記録（有効化したのに一度も起動していない）でも通知",
    show(kinds([base({ job: "odds", last_tick_at: null })])) ===
      '["liveness:odds"]',
  );
  check(
    "死活: mode=off のジョブは判定しない（誤報なし）",
    kinds([base({ job: "odds", mode: "off", last_tick_at: null })]).length ===
      0,
  );
  check(
    "死活: 運用窓の開始直後（07:00〜07:09）と窓の外（00:30）は判定しない",
    kinds([base({ job: "odds", last_tick_at: minAgo(600) })], at("07:05"))
      .length === 0 &&
      kinds(
        [base({ job: "odds", last_tick_at: minAgo(600) })],
        at("00:30", "2026-09-20"),
      ).length === 0 &&
      kinds([base({ job: "odds", last_tick_at: minAgo(600) })], at("07:10"))
        .length === 1 &&
      livenessCheckable(at("23:59")) &&
      !livenessCheckable(at("06:59")),
  );
  check(
    "連続失敗: 3回以上で通知（2回は通知しない）",
    show(
      kinds([base({ job: "odds", consecutive_failures: 3, last_error: "x" })]),
    ) === '["failures:odds"]' &&
      kinds([base({ job: "odds", consecutive_failures: 2 })]).length === 0,
  );
  check(
    "0件エラー: last_error に『0件』を含む失敗中のジョブを通知",
    kinds([
      base({
        job: "odds",
        consecutive_failures: 1,
        last_error: "期待件数が6件なのに、解析できた行が0件でした",
      }),
    ]).includes("zero_rows:odds"),
  );
  check(
    "ブレーカー: 開いているホストを通知（期限を過ぎていれば通知しない）",
    show(
      kinds([
        {
          job: "host:boatrace.jp",
          mode: "off",
          breaker_open_until: iso(new Date(now.getTime() + 30000)),
          last_error: "HTTP 429",
        },
      ]),
    ) === '["breaker:host"]' &&
      kinds([
        { job: "host:boatrace.jp", mode: "off", breaker_open_until: minAgo(1) },
      ]).length === 0,
  );
  check(
    "監視・保守のジョブ（モードのゲートなし）も、連続失敗を通知する",
    kinds([
      {
        job: "scrape-monitor",
        mode: "off",
        consecutive_failures: 3,
        last_error: "Slack",
      },
    ]).length === 1,
  );

  // 日次ジョブの期限超過（point_rank は 22:00 指定。3時間後の 01:00 以降で未処理なら通知）
  const daily = (over) => ({
    job: "point_rank",
    mode: "live",
    consecutive_failures: 0,
    last_target_date: "2026-09-18",
    ...over,
  });
  const overdueNow = at("01:05", "2026-09-20"); // 対象日 2026-09-19 の 22:00 から 3時間5分
  check(
    "日次: 指定時刻から3時間を過ぎても対象日が未処理なら通知",
    evaluateJobStates([daily({})], overdueNow).some(
      (a) =>
        a.kind === "daily_overdue" &&
        a.key === "daily_overdue:point_rank:2026-09-19",
    ),
  );
  check(
    "日次: 対象日を処理済みなら通知しない。3時間以内でも通知しない。shadow では通知しない",
    evaluateJobStates([daily({ last_target_date: "2026-09-19" })], overdueNow)
      .length === 0 &&
      evaluateJobStates([daily({})], at("23:30")).filter(
        (a) => a.kind === "daily_overdue",
      ).length === 0 &&
      evaluateJobStates([daily({ mode: "shadow" })], overdueNow).length === 0,
  );
}

// ---------------------------------------------------------------------------
// (d) 重複抑制
// ---------------------------------------------------------------------------
{
  const now = at("12:00");
  const a = (key) => ({ key, kind: key.split(":")[0], text: key });
  let r = applyDedupe([a("expired:odds:r1:-60"), a("liveness:odds")], {}, now);
  check("初回はすべて送る", r.toSend.length === 2);
  const later = (h) => new Date(now.getTime() + h * 3600 * 1000);
  const r2 = applyDedupe(
    [a("expired:odds:r1:-60"), a("liveness:odds")],
    r.notified,
    later(1),
  );
  check("1時間後: 同じ内容は再通知しない", r2.toSend.length === 0);
  const r3 = applyDedupe(
    [a("expired:odds:r1:-60"), a("liveness:odds")],
    r2.notified,
    later(7),
  );
  check(
    "7時間後: 持続する状態（死活）は再通知するが、expired・未実行は再通知しない",
    r3.toSend.length === 1 && r3.toSend[0].key === "liveness:odds",
    show(r3.toSend.map((x) => x.key)),
  );
  const r4 = applyDedupe(
    [],
    { "old:key": iso(later(-100)), "new:key": iso(later(-1)) },
    now,
  );
  check(
    "72時間より古い記録は削除される",
    !("old:key" in r4.notified) && "new:key" in r4.notified,
  );
  const msg = formatAlertMessage([a("x")], now);
  check(
    "アラートのメッセージ: 件数と内容を含み、絵文字を使わない",
    /1件の異常/.test(msg.text) &&
      /・x/.test(msg.attachments[0].blocks[0].text.text) &&
      !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(show(msg)),
  );
}

// ---------------------------------------------------------------------------
// (e) runMonitor
// ---------------------------------------------------------------------------
{
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
    "072未適用: 何もせず skipped（通知なし・通知先の設定も要求しない）",
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
        ? builder("sweep", {
            data: [{ race_id: "a" }, { race_id: "b" }],
            error: null,
          })
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

// ---------------------------------------------------------------------------
// (g) メタ監視
// ---------------------------------------------------------------------------
{
  const now = at("09:30");
  const min = (m) => iso(new Date(now.getTime() - m * 60000));
  const monitor = (over) => ({
    job: "scrape-monitor",
    mode: "off",
    last_tick_at: min(3),
    consecutive_failures: 0,
    last_error: null,
    ...over,
  });
  const liveOdds = { job: "odds", mode: "live" };
  const ev = (jobStates, when = now) =>
    evaluateMonitorLiveness({ now: when, jobStates }).status;
  check("正常（3分前に起動）", ev([monitor({}), liveOdds]) === "ok");
  check(
    `異常: last_tick_at が${MONITOR_STALE_MIN}分以上前`,
    ev([monitor({ last_tick_at: min(MONITOR_STALE_MIN) })]) === "alert" &&
      ev([monitor({ last_tick_at: min(MONITOR_STALE_MIN - 1) })]) === "ok" &&
      ev([monitor({ last_tick_at: null })]) === "alert",
  );
  check(
    "異常: 連続失敗3回以上（Slack通知の失敗等）",
    ev([monitor({ consecutive_failures: 3, last_error: "Slack" })]) === "alert",
  );
  check(
    "行なし: 有効な取得ジョブがあれば異常、無ければ正常（まだ起動していない）",
    ev([liveOdds]) === "alert" &&
      ev([]) === "ok" &&
      ev([{ job: "odds", mode: "off" }]) === "ok",
  );
  check(
    "運用窓（JST 07:10〜23:59）の外は判定しない",
    ev([monitor({ last_tick_at: min(600) })], at("03:00")) === "skip",
  );
}

// ---------------------------------------------------------------------------
// (h) HTTPハンドラー
// ---------------------------------------------------------------------------
{
  const mkRes = () => {
    const res = { statusCode: 0, body: null };
    res.status = (c) => {
      res.statusCode = c;
      return res;
    };
    res.json = (b) => {
      res.body = b;
      return res;
    };
    return res;
  };
  const ORIGINAL = process.env.CRON_SECRET;
  process.env.CRON_SECRET = "s3cret";
  const missingClient = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: null,
            error: {
              code: "PGRST205",
              message:
                "Could not find the table 'public.scrape_job_state' in the schema cache",
            },
          }),
        }),
      }),
    }),
  };
  let ran = 0;
  const handler = createScrapeCronHandler({
    job: "scrape-monitor",
    run: async () => {
      ran++;
      return {};
    },
    getClient: async () => missingClient,
  });
  let res = mkRes();
  await handler({ headers: {}, query: {} }, res);
  check("未認証は401（処理しない）", res.statusCode === 401 && ran === 0);
  res = mkRes();
  await handler({ headers: { authorization: "Bearer wrong" }, query: {} }, res);
  check("認証が違えば401", res.statusCode === 401);
  res = mkRes();
  await handler(
    { headers: { authorization: "Bearer s3cret" }, query: {} },
    res,
  );
  check(
    "072未適用のDB: 認証済みでも、何もせず200（skipped）",
    res.statusCode === 200 &&
      res.body.skipped === "scrape_schema_not_applied" &&
      ran === 0,
    show(res.body),
  );
  const noClient = createScrapeCronHandler({
    job: "scrape-monitor",
    run: async () => ({}),
    getClient: async () => null,
  });
  res = mkRes();
  await noClient(
    { headers: { authorization: "Bearer s3cret" }, query: {} },
    res,
  );
  check("Supabase未設定は500", res.statusCode === 500);
  if (ORIGINAL === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = ORIGINAL;
}

// ---------------------------------------------------------------------------
// (i) api/cron と vercel.json の整合
// ---------------------------------------------------------------------------
{
  const vercel = JSON.parse(
    fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8"),
  );
  const crons = vercel.crons ?? [];
  const cronRe = /^(\S+ ){4}\S+$/;
  check(
    "vercel.json: crons が登録され、パスが api/cron/*.js として実在し、cron式が5フィールド",
    crons.length >= 3 &&
      crons.every(
        (c) =>
          /^\/api\/cron\/[a-z-]+$/.test(c.path) &&
          fs.existsSync(path.join(ROOT, `${c.path.slice(1)}.js`)) &&
          cronRe.test(c.schedule),
      ),
    show(crons),
  );
  const byPath = Object.fromEntries(crons.map((c) => [c.path, c.schedule]));
  check(
    "cron式（UTC）: monitor は JST 07:00〜23:59 の5分ごと、summary は JST 00:10、cleanup は JST 04:00",
    byPath["/api/cron/scrape-monitor"] === "*/5 22-23,0-14 * * *" &&
      byPath["/api/cron/scrape-summary"] === "10 15 * * *" &&
      byPath["/api/cron/scrape-cleanup"] === "0 19 * * *",
    show(byPath),
  );
  check(
    "疑似ジョブ（scrape-pseudo）はcronに登録しない（手動リクエストのみ）",
    !crons.some((c) => c.path.includes("pseudo")),
  );
  const files = {
    "scrape-monitor": SCRAPE_JOBS["scrape-monitor"],
    "scrape-summary": SCRAPE_JOBS["scrape-monitor"],
    "scrape-cleanup": SCRAPE_JOBS["scrape-cleanup"],
    "scrape-pseudo": SCRAPE_JOBS.pseudo,
  };
  for (const [file, def] of Object.entries(files)) {
    const src = fs.readFileSync(path.join(ROOT, `api/cron/${file}.js`), "utf8");
    const m = /maxDuration:\s*(\d+)/.exec(src);
    check(
      `api/cron/${file}.js: maxDuration(${m?.[1]}) がレジストリの maxDurationSec(${def.maxDurationSec}) と一致し、ハンドラーをexportする`,
      m && Number(m[1]) === def.maxDurationSec && /export default/.test(src),
    );
    const mod = await import(`../../api/cron/${file}.js`);
    check(
      `api/cron/${file}.js: 読み込めて、config.maxDuration と default の関数がある`,
      typeof mod.default === "function" &&
        mod.config?.maxDuration === def.maxDurationSec,
    );
  }
  const wf = fs.readFileSync(
    path.join(ROOT, ".github/workflows/scrape-monitor-liveness.yml"),
    "utf8",
  );
  check(
    "メタ監視のワークフロー: 日次（UTC 00:30）・手動実行・確認スクリプトの呼び出し・異常時のみSlack通知",
    /cron: '30 0 \* \* \*'/.test(wf) &&
      /workflow_dispatch/.test(wf) &&
      /check-scrape-monitor-liveness\.js/.test(wf) &&
      /if: steps\.check\.outputs\.exit_code != '0'/.test(wf),
  );
}

printOut(
  failures === 0 ? "\nALL PASS" : `\n${failures} 件の検証が失敗しました`,
);
process.exit(failures === 0 ? 0 : 1);
