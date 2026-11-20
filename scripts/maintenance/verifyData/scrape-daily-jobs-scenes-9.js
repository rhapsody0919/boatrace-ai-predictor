/**
 * verify-scrape-daily-jobs.js の後半の場面（9/9）。verify ではない。
 * 判定と期待値は分ける前の verify-scrape-daily-jobs.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { isScheduledDate, SCRAPE_JOBS, validateRegistry } from "../../lib/scrapeJobs/registry.js";
import { evaluateJobStates } from "../../lib/scrapeJobs/monitor.js";

let check, show, same, jst;

/** 元の verify の1つの塊 { } を割った 1/2 */
function scene1() {
  const overdue = (job, lastTarget, when, mode = "live") =>
    evaluateJobStates(
      [{ job, mode, consecutive_failures: 0, last_target_date: lastTarget }],
      jst(when),
    ).filter((a) => a.kind === "daily_overdue");
  check(
    "監視: 日次ジョブ(得点率)が、指定時刻の3時間後を過ぎても対象日を処理していなければ、従来どおり通知する",
    overdue("point_rank", "2026-09-18", "2026-09-19T22:30:00").length === 0 &&
      overdue("point_rank", "2026-09-18", "2026-09-20T01:10:00").length === 1 &&
      overdue("point_rank", "2026-09-19", "2026-09-20T01:10:00").length === 0,
  );
  check(
    "監視: 月次ジョブ(選手プロフィール)は、起動する日(JST 毎月2日、5月・11月は9日・16日も)の指定時刻(03:00)の3時間後(06:00)まで未処理なら通知する",
    overdue("racer_profiles", "2026-09-02", "2026-10-02T04:00:00").length ===
      0 &&
      overdue("racer_profiles", "2026-09-02", "2026-10-02T06:10:00").length ===
        1 &&
      overdue("racer_profiles", "2026-04-02", "2026-05-09T07:00:00").length ===
        1 &&
      overdue("racer_profiles", "2026-10-02", "2026-10-02T07:00:00").length ===
        0,
  );
  check(
    "監視: 月次ジョブを、起動しない日(毎月3日以降・6月の9日等)に、日次の未処理として誤報しない",
    overdue("racer_profiles", "2026-09-02", "2026-09-20T15:00:00").length ===
      0 &&
      overdue("racer_profiles", "2026-05-02", "2026-06-09T07:00:00").length ===
        0 &&
      overdue("racer_profiles", null, "2026-09-05T07:00:00").length === 0,
  );
  const reportAlerts = (row, when = "2026-09-19T23:00:00") =>
    evaluateJobStates([{ consecutive_failures: 0, ...row }], jst(when)).filter(
      (a) => a.kind === "job_report",
    );
  const a1 = reportAlerts({
    job: "venue_motor_stats",
    mode: "live",
    last_report: {
      alerts: [
        {
          key: "drift:23",
          text: "会場公式サイトの構造変化の疑い 唐津: table_not_found が14日連続",
        },
      ],
    },
  });
  check(
    "監視: last_report.alerts は、ジョブ名つきの通知(key: report:{job}:{key})になる。shadow でも通知し、off は通知しない",
    a1.length === 1 &&
      a1[0].key === "report:venue_motor_stats:drift:23" &&
      /唐津/.test(a1[0].text) &&
      reportAlerts({
        job: "venue_motor_stats",
        mode: "shadow",
        last_report: { alerts: [{ key: "k", text: "t" }] },
      }).length === 1 &&
      reportAlerts({
        job: "venue_motor_stats",
        mode: "off",
        last_report: { alerts: [{ key: "k", text: "t" }] },
      }).length === 0,
    show(a1),
  );
  return { reportAlerts };
}

/** 元の verify の1つの塊 { } を割った 2/2 */
function scene2({ reportAlerts }) {
  check(
    "監視: until を過ぎた通知は出さない（月次の1回きりの事象が、last_report が残る間ずっと再通知されない）。形式が不正な項目は無視",
    reportAlerts(
      {
        job: "racer_profiles",
        mode: "live",
        last_report: {
          alerts: [
            {
              key: "season_fail_rate",
              text: "t",
              until: "2026-10-03T00:00:00.000Z",
            },
          ],
        },
      },
      "2026-10-02T12:00:00",
    ).length === 1 &&
      reportAlerts(
        {
          job: "racer_profiles",
          mode: "live",
          last_report: {
            alerts: [
              {
                key: "season_fail_rate",
                text: "t",
                until: "2026-10-03T00:00:00.000Z",
              },
            ],
          },
        },
        "2026-10-20T12:00:00",
      ).length === 0 &&
      reportAlerts({
        job: "racer_profiles",
        mode: "live",
        last_report: { alerts: [{ key: 1 }, null, "x"] },
      }).length === 0,
  );
  check(
    "レジストリ: isScheduledDate（runDaysOfMonth）。毎日のジョブは常に true。レジストリ全体が検査を通る",
    isScheduledDate(SCRAPE_JOBS.point_rank, "2026-09-20") === true &&
      isScheduledDate(SCRAPE_JOBS.racer_profiles, "2026-09-02") === true &&
      isScheduledDate(SCRAPE_JOBS.racer_profiles, "2026-09-01") === false &&
      isScheduledDate(SCRAPE_JOBS.racer_profiles, "2026-09-09") === false &&
      isScheduledDate(SCRAPE_JOBS.racer_profiles, "2026-05-09") === true &&
      isScheduledDate(SCRAPE_JOBS.racer_profiles, "2026-11-16") === true &&
      isScheduledDate(SCRAPE_JOBS.racer_profiles, "2026-06-16") === false &&
      same(validateRegistry(), []),
    show(validateRegistry()),
  );
  check(
    "レジストリ: runDaysOfMonth の不正な定義は検査で検出する",
    validateRegistry({
      x: {
        kind: "daily",
        targetTimeJst: "09:00",
        leaseSec: 60,
        maxDurationSec: 60,
        hosts: [],
        runDaysOfMonth: { default: [] },
      },
    }).length === 1,
  );
}

function scene3() {
  {
    const s1 = scene1();
    scene2(s1);
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・show・same・jst） */
export function runScrapeDailyJobsScenes11(env) {
  ({ check, show, same, jst } = env);
  scene3();
}
