/**
 * verify-scrape-monitor.js - データ取得の監視・保守（scripts/lib/scrapeJobs/monitor.js・cleanup.js、
 * api/cron/scrape-*.js、vercel.json の crons、メタ監視）の検証。DBにもSlackにも接続しない。
 *
 * 確認すること:
 *   (a) 窓内取得率・遅延の集計（確定中止・shadow・未claimの他モードのジョブを分母に入れない。展示は許容幅ベース）
 *   (a3) 体重だけの窓（展示の発走60分前。BOA-500）は、窓内取得率（ジョブ別）の分母に入れず、期限切れを通知しない
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
  computeWindowStats,
  evaluateExpired,
  evaluateWindowRates,
  percentile,
} from "../lib/scrapeJobs/monitor.js";



import { SCRAPE_JOBS } from "../lib/scrapeJobs/registry.js";

import { runScrapeMonitorScenes1 } from "./verifyData/scrape-monitor-scenes-1.js";
import { runScrapeMonitorScenes2 } from "./verifyData/scrape-monitor-scenes-2.js";
import { runScrapeMonitorScenes3 } from "./verifyData/scrape-monitor-scenes-3.js";
import { runScrapeMonitorScenes4 } from "./verifyData/scrape-monitor-scenes-4.js";
import { runScrapeMonitorScenes5 } from "./verifyData/scrape-monitor-scenes-5.js";
import { runScrapeMonitorScenes6 } from "./verifyData/scrape-monitor-scenes-6.js";
import { runScrapeMonitorScenes7 } from "./verifyData/scrape-monitor-scenes-7.js";
import { runScrapeMonitorScenes8 } from "./verifyData/scrape-monitor-scenes-8.js";

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

// ---- 後半の場面（verifyData/scrape-monitor-scenes-1.js・scrape-monitor-scenes-2.js・scrape-monitor-scenes-3.js・scrape-monitor-scenes-4.js・scrape-monitor-scenes-5.js・scrape-monitor-scenes-6.js・scrape-monitor-scenes-7.js・scrape-monitor-scenes-8.js） ----
runScrapeMonitorScenes1({ check, show, DATE, at, iso, slot, doneOdds });
runScrapeMonitorScenes2({ check, show, at, slot });
await runScrapeMonitorScenes3({ check, show, at, iso, doneOdds });
await runScrapeMonitorScenes4({ check, show, DATE, at, iso, slot });
await runScrapeMonitorScenes5({ check, show, DATE, at, iso, slot });
runScrapeMonitorScenes6({ check, show, at, iso });
await runScrapeMonitorScenes7({ check, show, DATE, at, iso, slot, doneOdds });
await runScrapeMonitorScenes8({ check, show, at, iso });

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
          /^\/api\/cron\/[a-z0-9-]+$/.test(c.path) &&
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
    // 本文の字は読まず、export（config・default）で見る（config.maxDuration は Vercel がビルド時に読むリテラルそのもの）
    const mod = await import(`../../api/cron/${file}.js`);
    check(
      `api/cron/${file}.js: maxDuration(${mod.config?.maxDuration}) がレジストリの maxDurationSec(${def.maxDurationSec}) と一致し、ハンドラーを export する`,
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
