/**
 * verify-scrape-monitor.js - データ取得の監視・保守（scripts/lib/scrapeJobs/monitor.js・cleanup.js、
 * api/cron/scrape-*.js、vercel.json の crons、メタ監視）の検証。DBにもSlackにも接続しない。
 *
 * 確認すること:
 *   (a) 窓内取得率・遅延の集計（確定中止・shadow・未claimの他モードのジョブを分母に入れない。展示は許容幅ベース）
 *   (b) expired・未実行の検知（1件でも）、窓内取得率の閾値（母数が小さいときは判定しない）
 *   (b2) 発売開始の遅れ（全レースの発走60分前のオッズの未公開。延長で取得できた、または後続の窓で公開が確認できたものだけ、
 *        警告・分母から外す。BOA-386・完了の定義Bの見直し）と、発売開始の検知の遅れ（5分以内の割合）の集計・警告
 *   (c) 死活（運用窓の開始直後は判定しない）・連続失敗・ブレーカー・0件エラー・日次ジョブの期限超過
 *   (d) 通知の重複抑制（expired・未実行は1スロットにつき1回、持続する状態は6時間おき）
 *   (e) runMonitor: 075未適用・有効なジョブなしでは何も通知しない（誤報なし）。異常があれば通知し、
 *       通知先が無ければ失敗にする。通知に失敗したら通知済みの記録を進めない。日次サマリーの投稿条件
 *   (f) scrape-cleanup: 2日以上前の未完了のexpired化と、60日超の削除
 *   (g) メタ監視（監視自体の死活）: 運用窓の外・行なし・鮮度・連続失敗
 *   (h) 共通ラッパ経由のHTTPハンドラー: 未認証は401、075未適用は200でskipped
 *   (i) api/cron/scrape-*.js と vercel.json の整合（cronのパスの実在・cron式・maxDurationとレジストリの一致）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  THRESHOLDS,
  aggregateByJob,
  applyDedupe,
  classifyExpectedUnpublished,
  collectMonitorInput,
  computeWindowStats,
  evaluateDetectionLag,
  evaluateExpired,
  evaluateJobStates,
  evaluateRacesPresent,
  evaluateWindowRates,
  formatAlertMessage,
  formatDailySummary,
  livenessCheckable,
  percentile,
  runMonitor,
} from "../lib/scrapeJobs/monitor.js";
import {
  detectionLagOf,
  firstRaceIdSet,
  isExtensionSuccess,
  summarizeDetectionLags,
} from "../lib/scrapeJobs/expectedUnpublished.js";
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
    first_attempt_at: over.first_attempt_at ?? null,
    last_attempt_at: over.last_attempt_at ?? null,
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
// (a2) 窓の外の補完のスロット（展示の発走の10分後。レジストリの catchupOffsets。BOA-382）
// ---------------------------------------------------------------------------
{
  const noCatchup = {
    ...SCRAPE_JOBS,
    exhibition: { ...SCRAPE_JOBS.exhibition, catchupOffsets: undefined },
  };
  // 10:00発走。-33 の期限は 09:27、補完（+10）の期限は 10:10
  const primaryDone = (delayMin) =>
    slot("exhibition", -33, "done", {
      done_at: iso(new Date(at("09:27").getTime() + delayMin * 60000)),
    });
  const catchupDone = () =>
    slot("exhibition", 10, "done", {
      outcome: "skipped_have_data",
      done_at: iso(new Date(at("10:10").getTime() + 30000)),
    });
  // -33: 60件のうち58件がヒット・2件が expired（96.7%）。補完: 取得済みの60件が即完了（ほぼ全てヒット）
  const slots = [
    ...Array.from({ length: 58 }, () => primaryDone(5)),
    slot("exhibition", -33, "expired", { attempts: 13 }),
    slot("exhibition", -33, "expired", { attempts: 13 }),
    ...Array.from({ length: 60 }, () => catchupDone()),
  ];
  const stats = computeWindowStats(slots);
  const catchupRow = stats.find((x) => x.offset_min === 10);
  check(
    "窓別の集計（computeWindowStats）には、補完の窓（+10）も残る（補完の完了数・遅延を見られる）",
    catchupRow?.total === 60 && catchupRow?.hit === 60,
    show(catchupRow),
  );
  const job = aggregateByJob(stats).find((j) => j.job === "exhibition");
  check(
    "ジョブ別の窓内取得率（aggregateByJob）は、補完の窓を束ねない（-33 の58/60=96.7%のまま。補完の即完了が、率を高く見せない）",
    job?.total === 60 &&
      job?.hit === 58 &&
      Math.abs(job.rate - 58 / 60) < 1e-9 &&
      evaluateWindowRates(stats, DATE).length === 1,
    show(job),
  );
  const mutantJob = aggregateByJob(stats, noCatchup).find(
    (j) => j.job === "exhibition",
  );
  check(
    "変異検証: 「補完の窓も束ねる」版では、率が 118/120=98.3% に水増しされ（閾値98%を超え）、上の検証が失敗する",
    mutantJob?.total === 120 &&
      mutantJob?.rate >= THRESHOLDS.windowRate &&
      !(mutantJob?.total === 60),
    show(mutantJob),
  );

  // 期限切れの通知: 補完が最後まで取れなかったレース。中止・順延の疑い（tentative・confirmed）は通知しない
  const active = new Set(["exhibition"]);
  const expiredCatchup = [
    slot("exhibition", 10, "expired", {
      attempts: 3,
      outcome: "no_values",
      last_error: "展示データが未公開です",
      race_id: "2026-09-19-02-01",
    }),
    slot("exhibition", 10, "expired", {
      attempts: 3,
      cancel: "tentative",
      race_id: "2026-09-19-02-02",
    }),
    slot("exhibition", 10, "expired", {
      attempts: 3,
      cancel: "confirmed",
      race_id: "2026-09-19-02-03",
    }),
    // -33 のスロットの期限切れは、従来どおり（中止・順延の疑いのレースも通知する。確定だけを除く）
    slot("exhibition", -33, "expired", {
      attempts: 13,
      cancel: "tentative",
      race_id: "2026-09-19-02-04",
    }),
    slot("exhibition", 10, "expired", {
      attempts: 0,
      race_id: "2026-09-19-02-05",
    }),
  ];
  const alerts = evaluateExpired(expiredCatchup, { activeJobs: active });
  check(
    "期限切れの通知: 補完が最後まで取れなかったレース（中止・順延の疑いなし）と未実行は通知する。補完の tentative・confirmed は通知しない。-33 の tentative は従来どおり通知する",
    show(alerts.map((a) => a.key).sort()) ===
      show(
        [
          "expired:exhibition:2026-09-19-02-01:10",
          "expired:exhibition:2026-09-19-02-04:-33",
          "unexecuted:exhibition:2026-09-19-02-05:10",
        ].sort(),
      ),
    show(alerts.map((a) => a.key)),
  );
  const mutantAlerts = evaluateExpired(expiredCatchup, {
    activeJobs: active,
    registry: noCatchup,
  });
  check(
    "変異検証: 「補完も、中止・順延の疑いのレースを通知する」版では、tentative の補完が通知され、上の検証が失敗する",
    mutantAlerts.some(
      (a) => a.key === "expired:exhibition:2026-09-19-02-02:10",
    ),
    show(mutantAlerts.map((a) => a.key)),
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

// claim に依存しない検知: 期限+許容幅を超えても pending のまま残っているスロット
{
  const now = at("12:00");
  const active = new Set(["odds", "result"]);
  const startAt = (hhmm) => `${hhmm}:00`;
  const slots = [
    // odds -60、10:00発走、期限09:00+許容幅3分=09:03。12:00には超過。pending・attempts=0 → 未実行
    slot("odds", -60, "pending", { attempts: 0, race_id: "2026-09-19-03-01" }),
    // 同じく超過。試行1回のpending → expired と同じ扱い
    slot("odds", -60, "pending", { attempts: 1, race_id: "2026-09-19-03-02" }),
    // まだ許容幅内（発走 12:30 → 期限11:30+3分=11:33 → 12:00には超過...）ではなく、期限前
    slot("odds", -60, "pending", {
      attempts: 0,
      race_id: "2026-09-19-03-03",
      start_time: startAt("14:00"),
    }),
    // running でリースが有効（処理中）→ 通知しない
    {
      ...slot("odds", -60, "running", {
        attempts: 1,
        race_id: "2026-09-19-03-04",
      }),
      lease_until: iso(new Date(now.getTime() + 30000)),
    },
    // running でリース切れ → 通知
    {
      ...slot("odds", -60, "running", {
        attempts: 1,
        race_id: "2026-09-19-03-05",
      }),
      lease_until: iso(new Date(now.getTime() - 30000)),
    },
    // 有効でないジョブ・確定中止 → 通知しない
    slot("pcexpect", -720, "pending", {
      attempts: 0,
      race_id: "2026-09-19-03-06",
    }),
    slot("odds", -60, "pending", {
      attempts: 0,
      cancel: "confirmed",
      race_id: "2026-09-19-03-07",
    }),
  ];
  const alerts = evaluateExpired(slots, { activeJobs: active, now });
  const keys = alerts.map((x) => x.key).sort();
  check(
    "claim に依存しない検知: pending・リース切れの running が期限+許容幅を超えたら、expired と同じキーで通知する（処理中・期限前・有効でないジョブ・確定中止は通知しない）",
    show(keys) ===
      show([
        "expired:odds:2026-09-19-03-02:-60",
        "expired:odds:2026-09-19-03-05:-60",
        "unexecuted:odds:2026-09-19-03-01:-60",
      ]) && alerts.every((x) => /まだexpired化されていない/.test(x.text)),
    show(keys),
  );
  check(
    "now を渡さなければ（従来の呼び出し）、pending は判定しない",
    evaluateExpired(slots, { activeJobs: active }).length === 0,
  );
}

// ---------------------------------------------------------------------------
// (b2) 発売開始の遅れ（想定内の未公開。BOA-386・完了の定義Bの見直し）: 全レースの、発走60分前のオッズの未公開
//      （延長で取得できた、または、後続の窓で公開が確認できたものだけを、警告・窓内取得率の対象外にする）
// ---------------------------------------------------------------------------
{
  const active = new Set(["odds", "result"]);
  const D = DATE;
  // 10:00発走。-60=09:00〜09:03、-30=09:30〜09:33、-15=09:45〜09:48、-10=09:50〜09:53、-5=09:55〜09:58、0=10:00〜10:03
  const LATER = [-30, -15, -10, -5, 0];
  const nv = (race, over = {}) =>
    slot("odds", -60, "expired", {
      race_id: race,
      attempts: 3,
      outcome: "no_values",
      last_error:
        "単勝オッズを解析できませんでした（未公開・中止・順延の可能性）",
      ...over,
    });
  const later = (race, offsets, status, over = {}) =>
    offsets.map((o) =>
      slot("odds", o, status, {
        race_id: race,
        ...(status === "done" ? { done_at: iso(at("09:31")) } : {}),
        ...over,
      }),
    );
  // 会場1の第1レースは、race_id の末尾が 03（末尾が 01 かどうかに依存しない）
  const R = `${D}-01-03`;
  const run = (target, siblings, now) => {
    const map = classifyExpectedUnpublished(target, {
      siblingSlots: siblings,
      now,
    });
    return {
      map,
      alerts: evaluateExpired(target, {
        activeJobs: active,
        now,
        expectedUnpublished: map,
      }),
    };
  };

  // 後続の窓（-30）が取れている: 想定内（confirmed）。警告なし
  const t = nv(R);
  let sib = [
    t,
    ...later(R, [-30], "done", { outcome: "ok" }),
    ...later(R, [-15, -10, -5, 0], "pending", { attempts: 0 }),
  ];
  let r = run([t], sib, at("09:40"));
  check(
    "発売開始の遅れ: -60が no_values で期限切れ、後続の窓（-30）が取れている → 警告しない（confirmed）",
    r.alerts.length === 0 && r.map.get(`odds:${R}:-60`) === "confirmed",
    show([...r.map]),
  );
  // -30 が失敗でも、-15 が取れていれば確認になる（-60 の未公開の後に公開された）。skipped_have_data も確認になる
  sib = [
    t,
    ...later(R, [-30], "expired", { outcome: "no_values", attempts: 3 }),
    ...later(R, [-15], "done", { outcome: "skipped_have_data" }),
  ];
  r = run([t], sib, at("09:50"));
  check(
    "後続の窓のどれか1つが取れていれば確認になる（-30 は失敗・-15 が skipped_have_data でも confirmed）",
    r.alerts.length === 0 && r.map.get(`odds:${R}:-60`) === "confirmed",
  );

  // 保留: 後続の窓がまだ期限+許容幅に達していない → 警告も欠落も保留
  sib = [t, ...later(R, LATER, "pending", { attempts: 0 })];
  r = run([t], sib, at("09:20"));
  check(
    "保留: 後続の窓がまだ来ていない間は、警告しない（deferred）",
    r.alerts.length === 0 && r.map.get(`odds:${R}:-60`) === "deferred",
  );
  sib = [
    t,
    ...later(R, [-30], "expired", { outcome: "no_values", attempts: 3 }),
    ...later(R, [-15, -10, -5, 0], "pending", { attempts: 0 }),
  ];
  r = run([t], sib, at("09:40"));
  check(
    "保留: -30 が失敗でも、-15 以降が未到来なら、なお保留（早すぎる警告をしない）",
    r.alerts.length === 0 && r.map.get(`odds:${R}:-60`) === "deferred",
  );

  // 後続の窓が全て過ぎても取れていない: 通常どおり警告する（本当に取れていない）
  sib = [
    t,
    ...later(R, LATER, "expired", { outcome: "no_values", attempts: 3 }),
  ];
  r = run([t], sib, at("10:30"));
  check(
    "後続の窓（-30〜0）も全て取れなかった → 通常どおり警告（expired:…:-60）",
    r.map.size === 0 && r.alerts.some((a) => a.key === `expired:odds:${R}:-60`),
    show(r.alerts.map((a) => a.key)),
  );
  sib = [t, ...later(R, LATER, "pending", { attempts: 0 })];
  r = run([t], sib, at("10:30"));
  check(
    "後続の窓が pending のまま期限+許容幅を過ぎている → 通常どおり警告",
    r.alerts.some((a) => a.key === `expired:odds:${R}:-60`),
  );
  r = run([t], [t], at("09:40"));
  check(
    "後続の窓のスロットが1件も無い（確認できない）→ 警告する",
    r.alerts.some((a) => a.key === `expired:odds:${R}:-60`),
  );

  // 第1レースに限らない（全レース）。race_id の末尾・レース番号に依存しない
  const notFirst = nv(`${D}-01-04`);
  r = run(
    [notFirst],
    [notFirst, ...later(`${D}-01-04`, [-30], "done", { outcome: "ok" })],
    at("09:40"),
  );
  check(
    "第1レース以外（第2レース以降）も、後続の窓が取れていれば、警告しない（confirmed。全レースが対象）",
    r.map.get(`odds:${D}-01-04:-60`) === "confirmed" && r.alerts.length === 0,
    show([...r.map]),
  );
  const suffix12 = nv(`${D}-05-12`);
  r = run(
    [suffix12],
    [suffix12, ...later(`${D}-05-12`, [-30], "done", { outcome: "ok" })],
    at("09:40"),
  );
  check(
    "12レースでも同じ（レース番号に依存しない）",
    r.map.get(`odds:${D}-05-12:-60`) === "confirmed" && r.alerts.length === 0,
  );

  // 結果・試行・窓・ジョブが違うものは対象外
  const okSib = (id) => later(id, [-30], "done", { outcome: "ok" });
  const cases = [
    ["未実行（attempts=0）", nv(R, { attempts: 0, outcome: null })],
    [
      "未実行（attempts=0。outcome が残っていても、未実行は想定内にしない）",
      nv(R, { attempts: 0 }),
    ],
    ["outcome=error", nv(R, { outcome: "error", last_error: "取得先が429" })],
    ["outcome=partial", nv(R, { outcome: "partial" })],
    [
      "別の窓（-30）",
      slot("odds", -30, "expired", {
        race_id: R,
        attempts: 3,
        outcome: "no_values",
      }),
    ],
    [
      "別のジョブ（result）",
      slot("result", -60, "expired", {
        race_id: R,
        attempts: 3,
        outcome: "no_values",
      }),
    ],
  ];
  for (const [label, target] of cases) {
    r = run([target], [target, ...okSib(R)], at("09:40"));
    check(
      `対象外（従来どおり警告）: ${label}`,
      r.map.size === 0 && r.alerts.length === 1,
      show(r.alerts.map((a) => a.key)),
    );
  }

  // 確定中止・shadow は、従来どおり警告しない（想定内の判定とは無関係に）
  const cancelled = nv(R, { cancel: "confirmed" });
  r = run([cancelled], [cancelled, ...okSib(R)], at("09:40"));
  check(
    "確定中止は、従来どおり警告しない",
    r.alerts.length === 0 && r.map.size === 0,
  );
  sib = [t, ...later(R, [-30], "done", { outcome: "ok", run_mode: "shadow" })];
  r = run([t], sib, at("10:30"));
  check(
    "shadow の後続の窓は、確認に使わない（警告する）",
    r.alerts.some((a) => a.key === `expired:odds:${R}:-60`),
  );
  sib = [t, ...later(R, [-30], "done", { outcome: "cancelled_race" })];
  r = run([t], sib, at("10:30"));
  check(
    "後続の窓が cancelled_race で完了したものは、公開の確認に使わない（警告する）",
    r.alerts.some((a) => a.key === `expired:odds:${R}:-60`),
  );

  check(
    "expectedUnpublished を渡さなければ、従来どおり警告する",
    evaluateExpired([t], { activeJobs: active, now: at("09:40") }).length === 1,
  );
  // -60 が pending のまま期限+許容幅を過ぎている（expired化されていない）場合も、同じ判定
  const pendingNv = nv(R, { status: "pending", attempts: 2 });
  sib = [pendingNv, ...later(R, [-30], "done", { outcome: "ok" })];
  r = run([pendingNv], sib, at("09:40"));
  check(
    "-60 が pending のまま期限+許容幅を超えた場合も、後続の窓が取れていれば警告しない",
    r.alerts.length === 0 && r.map.get(`odds:${R}:-60`) === "confirmed",
  );

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

// ---------------------------------------------------------------------------
// (b3) -60の窓の延長（未公開の間、-30の窓が始まるまで1分間隔で再試行）と、発売開始の検知の遅れ
// ---------------------------------------------------------------------------
{
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

// collectMonitorInput: 発売開始の遅れの判定に要る読み取りは、候補があるときだけ行う（5分ごとの読み取りを増やさない）
{
  const now = at("09:40");
  const reads = [];
  const fakeClient = (tables) => ({
    from(table) {
      const q = {
        table,
        filters: [],
        from: 0,
        to: Infinity,
        head: false,
        desc: "",
      };
      const api = {
        select(_cols, opts) {
          q.head = Boolean(opts?.head);
          return api;
        },
        eq(col, v) {
          q.filters.push((r) => r[col] === v);
          q.desc += `${col}=${v};`;
          return api;
        },
        gte(col, v) {
          q.filters.push((r) => r[col] >= v);
          return api;
        },
        gt(col, v) {
          q.filters.push((r) => r[col] > v);
          q.desc += `${col}>${v};`;
          return api;
        },
        in(col, vs) {
          q.filters.push((r) => vs.includes(r[col]));
          return api;
        },
        order() {
          return api;
        },
        range(from, to) {
          q.from = from;
          q.to = to;
          return api;
        },
        then(resolve) {
          reads.push(`${table}:${q.desc}`);
          const rows = (tables[table] ?? []).filter((r) =>
            q.filters.every((f) => f(r)),
          );
          resolve(
            q.head
              ? { count: rows.length, data: null, error: null }
              : { data: rows.slice(q.from, q.to + 1), error: null },
          );
        },
      };
      return api;
    },
  });
  const R = `${DATE}-01-03`;
  const cand = slot("odds", -60, "expired", {
    race_id: R,
    attempts: 3,
    outcome: "no_values",
  });
  const sibDone = slot("odds", -30, "done", {
    race_id: R,
    outcome: "ok",
    done_at: iso(at("09:31")),
  });
  const jobs = [{ job: "odds", mode: "live" }];

  reads.length = 0;
  let inp = await collectMonitorInput(
    fakeClient({
      scrape_job_state: jobs,
      scrape_slots: [
        slot("odds", -60, "done", { race_id: R, done_at: iso(at("09:01")) }),
      ],
      races: [],
    }),
    now,
    "tick",
  );
  check(
    "collectMonitorInput: 候補（-60のno_values・未完了、または試行2回以上で完了）が無ければ、オッズの後続の窓のスロットを追加で読まない",
    inp.oddsSlots.length === 0 &&
      !reads.some((x) => x.includes("job=odds") && x.includes("offset_min>")) &&
      inp.firstRaceIds === undefined,
    show(reads),
  );

  reads.length = 0;
  inp = await collectMonitorInput(
    fakeClient({
      scrape_job_state: jobs,
      scrape_slots: [cand, sibDone],
      races: [],
    }),
    now,
    "tick",
  );
  check(
    "collectMonitorInput: 候補があれば、オッズの後続の窓（-60より後）のスロットだけを追加で読む（全レース。racesの一覧は読まない）",
    inp.oddsSlots.length === 1 &&
      inp.oddsSlots[0].offset_min === -30 &&
      inp.oddsSlots[0].status === "done" &&
      reads.some(
        (x) => x.includes("job=odds") && x.includes("offset_min>-60"),
      ) &&
      reads.filter((x) => x.startsWith("races:")).length === 1,
    show(reads),
  );

  // 延長で取得できた（試行2回以上で完了）も、候補になる（後続の窓を読む）
  reads.length = 0;
  inp = await collectMonitorInput(
    fakeClient({
      scrape_job_state: jobs,
      scrape_slots: [
        slot("odds", -60, "done", {
          race_id: R,
          attempts: 5,
          first_attempt_at: iso(at("09:00")),
          last_attempt_at: iso(at("09:04")),
          done_at: iso(at("09:04")),
        }),
        sibDone,
      ],
      races: [],
    }),
    now,
    "tick",
  );
  check(
    "collectMonitorInput: 延長で取得できた（試行2回以上で完了）-60も候補になり、後続の窓を読む",
    inp.oddsSlots.length === 1,
    show(reads),
  );
}

// 当日のracesが無い
{
  const jobs = [{ job: "odds", mode: "live" }];
  const ev = (todayRaceCount, when, jobStates = jobs) =>
    evaluateRacesPresent({ jobStates, todayRaceCount, now: when });
  check(
    "当日のracesが0件（08:00以降・窓型ジョブが有効）: 通知。08:00前・racesあり・有効なジョブなしでは通知しない",
    ev(0, at("08:05")).length === 1 &&
      ev(0, at("08:05"))[0].key === "races_missing:2026-09-19" &&
      ev(0, at("07:30")).length === 0 &&
      ev(156, at("08:05")).length === 0 &&
      ev(0, at("08:05"), [{ job: "odds", mode: "off" }]).length === 0 &&
      ev(0, at("08:05"), [{ job: "point_rank", mode: "live" }]).length === 0,
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
    "0件エラー: 『10件』『20件』のような他の数字の末尾の0は、0件エラーとみなさない",
    !kinds([
      base({
        job: "odds",
        consecutive_failures: 1,
        last_error: "期待10件のうち20件を解析",
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
  const { message: msg, includedCount } = formatAlertMessage([a("x")], now);
  check(
    "アラートのメッセージ: 件数と内容を含み、絵文字を使わない",
    /1件の異常/.test(msg.text) &&
      includedCount === 1 &&
      /・x/.test(msg.attachments[0].blocks[0].text.text) &&
      !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(show(msg)),
  );
  // 多数のアラート: 本文の予算内に収め、載せなかった分は「ほかN件」にする
  const many = Array.from({ length: 200 }, (_, i) =>
    a(`expired:odds:2026-09-19-01-${i}:-60`),
  ).map((x) => ({ ...x, text: `${x.key} `.padEnd(120, "x") }));
  const big = formatAlertMessage(many, now);
  const bigText = big.message.attachments[0].blocks[0].text.text;
  check(
    "アラートが多数でも、本文は3000字以内に収め、載せなかった件数を明記する",
    bigText.length <= 3000 &&
      big.includedCount > 0 &&
      big.includedCount < 200 &&
      new RegExp(`ほか${200 - big.includedCount}件`).test(bigText),
    `${bigText.length}字、載せた${big.includedCount}件`,
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
    "075未適用のDB: 認証済みでも、何もせず200（skipped）",
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
  // cron式（UTC）を、JSTの起動時刻の集合に換算して確認する（式の文字列との比較にしない）
  const expandField = (field, max) => {
    const out = new Set();
    for (const part of field.split(",")) {
      const [range, step] = part.split("/");
      const [lo, hi] =
        range === "*"
          ? [0, max]
          : range.includes("-")
            ? range.split("-").map(Number)
            : [Number(range), step ? max : Number(range)];
      for (let v = lo; v <= hi; v += step ? Number(step) : 1) out.add(v);
    }
    return out;
  };
  const jstTimes = (schedule) => {
    const [min, hour] = schedule.split(" ");
    const times = [];
    for (const h of expandField(hour, 23))
      for (const m of expandField(min, 59)) times.push(((h + 9) % 24) * 60 + m); // UTC→JST（分）
    return times.sort((x, y) => x - y);
  };
  const mon = jstTimes(byPath["/api/cron/scrape-monitor"]);
  check(
    "cron式（UTC→JST換算）: scrape-monitor は JST 07:00〜23:55 の5分ごと（07:00・23:55を含み、06:55・00:00は含まない）",
    mon[0] === 7 * 60 &&
      mon.at(-1) === 23 * 60 + 55 &&
      mon.length === (23 - 7 + 1) * 12 &&
      mon.every((t, i) => i === 0 || t - mon[i - 1] === 5),
    `${mon.length}回、${mon[0]}〜${mon.at(-1)}`,
  );
  check(
    "cron式（UTC→JST換算）: scrape-summary は JST 00:10、scrape-cleanup は JST 04:00（各1回）",
    show(jstTimes(byPath["/api/cron/scrape-summary"])) === show([10]) &&
      show(jstTimes(byPath["/api/cron/scrape-cleanup"])) === show([4 * 60]),
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
