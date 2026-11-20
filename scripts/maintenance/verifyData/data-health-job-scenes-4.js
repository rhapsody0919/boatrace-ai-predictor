/**
 * verify-data-health-job.js の後半の場面（4/5）。verify ではない。
 * 判定と期待値は分ける前の verify-data-health-job.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { COUNT_CHECKS } from "../../lib/dataHealth/checks.js";
import { evaluateJobStates, applyDedupe, THRESHOLDS } from "../../lib/scrapeJobs/monitor.js";
import { dates, makeCaller, show, coverageRow } from "./data-health-job-fixtures.js";
import { evaluateScenarios } from "./data-health-job-scenarios.js";
import { scenariosForJob } from "./data-health-job-for-job.js";
import { wrapperRun, liveRow, evalMod } from "./data-health-job-scenes-3.js";

let check, migrationSql, withMutant, mutateEachFile, runEntriesDuplicates, runCancellationWithResult;

const evalMutants = [
  [
    "閾値の比較を < から <= にする（ちょうど閾値も未達）",
    [['rate < threshold ? "breach"', 'rate <= threshold ? "breach"']],
  ],
  [
    "取得開始日を無視する",
    [["if (check.since && check.since > from) from = check.since;", ""]],
  ],
  [
    "確定ラグを無視する",
    [["to = addDaysToDateString(end, -(check.lagDays ?? 0));", "to = end;"]],
  ],
  [
    "母数の下限を無視する",
    [["if (denominator < minDenominator) {", "if (false) {"]],
  ],
  [
    "未導入の判定を外す",
    [
      [
        "if (!tableRows || tableRows[check.requiresTable] !== true) {",
        "if (false) {",
      ],
    ],
  ],
  [
    "pending を空テーブルの異常として扱う",
    [
      [
        'if (p.policy === "pending") return { ...base, status: "not_introduced" };',
        'if (p.policy === "pending") return { ...base, status: "empty" };',
      ],
    ],
  ],
  [
    "悪化の判定を外す（欠損が増えても通知しない）",
    [
      [
        "const worsened = prev !== undefined && b.missing > prev.missing;",
        "const worsened = false;",
      ],
    ],
  ],
  [
    "毎回通知する（状態を見ない）",
    [
      [
        "if (prev === undefined || worsened || remind || undelivered || nextDay) {",
        "if (true) {",
      ],
    ],
  ],
  [
    "継続中の再通知をしない",
    [["daysBetween(prev.lastAt, targetDate) >= REMIND_DAYS", "false"]],
  ],
  [
    "回復しても状態を消さない",
    [["if (!okKeys.has(key)) emitted[key] = state;", "emitted[key] = state;"]],
  ],
  [
    "前日の通知が届いていなくても再通知しない（配信確認を外す）",
    [["!deliveredKeys.has(prev.alertKey)", "false"]],
  ],
  [
    "週次の曜日を無視する",
    [
      [
        "return weekdayOf(targetDate) === check.cadence.weeklyOn;",
        "return true;",
      ],
    ],
  ],
];

const jobMutants = [
  [
    "shadow でも通知を出す",
    [['alerts: mode === "live" ? alerts : [],', "alerts,"]],
  ],
  [
    "shadow でも状態（emitted）を更新する",
    [['emitted: mode === "live" ? emitted : previousEmitted,', "emitted,"]],
  ],
  [
    "全ての関数が失敗しても成功にする",
    [["if (Object.keys(errors).length === attempted) {", "if (false) {"]],
  ],
  [
    "info の項目も通知する",
    [
      [
        'if (r.status === "breach" && r.severity === "alert") {',
        'if (r.status === "breach") {',
      ],
    ],
  ],
  [
    "失敗した関数の検査を通知しない",
    [
      [
        "if (errors[name]) {\n      breaches.push({",
        "if (false) {\n      breaches.push({",
      ],
    ],
  ],
  ["空テーブルを通知しない", [['if (r.status === "empty") {', "if (false) {"]]],
  [
    "共通原因の要約を付けない",
    [
      [
        "breaches.length >= COMMON_CAUSE_MIN_BREACHES && reconciled.length > 0",
        "false",
      ],
    ],
  ],
];

// jsonb はキーの順を並べ替えるため、列ごとの値で比べる
export const cancellationWithResultOk = (r) =>
  show(
    (r ?? []).map((x) => [
      x.d,
      x.races,
      x.confirmed_with_result,
      x.consistent_races,
    ]),
  ) ===
  show([
    ["2026-09-12", 6, 1, 5],
    ["2026-09-13", 2, 0, 2],
  ]);

async function scene1() {
  // ---------------------------------------------------------------------------
  // (g) scrape-monitor との接続
  // ---------------------------------------------------------------------------
  {
    const badRows = dates.map((d) =>
      coverageRow(d, d === "2026-09-18" ? { odds: 50 } : {}),
    );
    const { store } = await wrapperRun({
      rows: { data_health: { ...liveRow } },
      caller: makeCaller({ coverage: badRows }),
    });
    const row = store.state.get("data_health");
    // scrape-monitor の最初の tick（07:00 JST）と、その後の tick
    const tick1 = new Date("2026-09-21T22:00:30Z");
    const alerts1 = evaluateJobStates([row], tick1).filter(
      (a) => a.kind === "job_report",
    );
    check(
      "monitor: last_report.alerts が、job_report の通知（key に report:data_health:）になる",
      alerts1.length === 1 &&
        alerts1[0].key.startsWith("report:data_health:dh:coverage.odds:") &&
        alerts1[0].text.startsWith("data_health:") &&
        alerts1[0].text.includes("オッズ"),
      show(alerts1),
    );
    const first = applyDedupe(alerts1, {}, tick1);
    const later = new Date("2026-09-21T22:05:30Z");
    const second = applyDedupe(
      evaluateJobStates([row], later).filter((a) => a.kind === "job_report"),
      first.notified,
      later,
    );
    check(
      "monitor: 同じ通知は、次の tick（5分後）で再通知しない",
      first.toSend.length === 1 && second.toSend.length === 0,
    );
    const afterUntil = new Date("2026-09-22T05:00:00Z"); // 14:00 JST。until（起動+4時間）の後
    check(
      "monitor: until（4時間）を過ぎた通知は出さない（6時間おきの再通知が、1日1回の通知を繰り返さない）",
      evaluateJobStates([row], afterUntil).filter((a) => a.kind === "job_report")
        .length === 0,
    );
    const shadowRow = {
      ...row,
      mode: "shadow",
      last_report: { ...row.last_report, alerts: [] },
    };
    check(
      "monitor: shadow の間は、通知は出ない",
      evaluateJobStates([shadowRow], tick1).filter((a) => a.kind === "job_report")
        .length === 0,
    );
    // 日次の期限超過
    const overdue = evaluateJobStates(
      [{ ...liveRow, last_target_date: "2026-09-21" }],
      new Date("2026-09-22T00:31:00Z"),
    ).filter((a) => a.kind === "daily_overdue");
    const notOverdue = evaluateJobStates(
      [{ ...liveRow, last_target_date: "2026-09-21" }],
      new Date("2026-09-21T23:59:00Z"),
    ).filter((a) => a.kind === "daily_overdue");
    check(
      "monitor: 指定時刻（06:30 JST）から3時間（09:30 JST）を過ぎても対象日を処理していなければ、日次の期限超過として通知する",
      overdue.length === 1 &&
        overdue[0].text.includes("data_health") &&
        notOverdue.length === 0 &&
        THRESHOLDS.dailyOverdueHours === 3,
      show(overdue),
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・migrationSql・withMutant・mutateEachFile・runEntriesDuplicates・runCancellationWithResult） */
export async function runDataHealthJobScenes5(env) {
  ({ check, migrationSql, withMutant, mutateEachFile, runEntriesDuplicates, runCancellationWithResult } = env);
  await scene1();
}

async function scene2() {
  for (const [label, reps] of evalMutants) {
    const failed = await withMutant("evaluate.js", reps, async (mod) => {
      try {
        return (await evaluateScenarios(mod)).filter((r) => !r.pass);
      } catch (e) {
        return [{ label: `例外: ${e.message}` }];
      }
    });
    check(
      `変異検証（判定・通知の一意性）: ${label}`,
      failed.length > 0,
      "この変異を検知できない（検証が通ってしまう）",
    );
  }
  for (const [label, reps] of jobMutants) {
    const failed = await withMutant("job.js", reps, async (mod) => {
      try {
        return (await scenariosForJob(mod)).filter((r) => !r.pass);
      } catch (e) {
        return [{ label: `例外: ${e.message}` }];
      }
    });
    check(
      `変異検証（実行）: ${label}`,
      failed.length > 0,
      "この変異を検知できない（検証が通ってしまう）",
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・migrationSql・withMutant・mutateEachFile・runEntriesDuplicates・runCancellationWithResult） */
export async function runDataHealthJobScenes6(env) {
  ({ check, migrationSql, withMutant, mutateEachFile, runEntriesDuplicates, runCancellationWithResult } = env);
  await scene2();
}

async function scene3() {
  {
    const d = await runEntriesDuplicates(migrationSql);
    check(
      "data_health_entries_duplicates: 2レース以上が過去日と完全一致する会場×日だけを汚染と数える（1レースの偶然の一致・確定中止の複製元・結果の無い複製元は数えない）",
      d.venue_days === 4 && d.clean_venue_days === 3,
      show(d),
    );
  }
  for (const [label, mutate] of [
    [
      "出走表の複製検知: 1レースの一致でも汚染として数える",
      (x) => x.replace("having count(*) >= 2", "having count(*) >= 1"),
    ],
    [
      "出走表の複製検知: 複製元の確定中止（順延）を除外しない",
      (x) =>
        x.replace(
          "where r.race_date between (p_from - 21) and p_to\n    and r.cancellation_status is distinct from 'confirmed'",
          "where r.race_date between (p_from - 21) and p_to",
        ),
    ],
    [
      "出走表の複製検知: 複製元に結果があることを求めない",
      (x) => x.replace("and b.sig = a.sig and b.has_result", "and b.sig = a.sig"),
    ],
  ]) {
    const mutated = mutateEachFile(mutate);
    if (mutated === migrationSql)
      throw new Error(`SQLの変異の対象が見つかりません: ${label}`);
    let detected = false;
    try {
      const d = await runEntriesDuplicates(mutated);
      detected = !(d.venue_days === 4 && d.clean_venue_days === 3);
    } catch {
      detected = true;
    }
    check(
      `変異検証（SQL）: ${label}`,
      detected,
      "この変異を検知できない（検証が通ってしまう）",
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・migrationSql・withMutant・mutateEachFile・runEntriesDuplicates・runCancellationWithResult） */
export async function runDataHealthJobScenes7(env) {
  ({ check, migrationSql, withMutant, mutateEachFile, runEntriesDuplicates, runCancellationWithResult } = env);
  await scene3();
}

async function scene4() {
  {
    const r = await runCancellationWithResult(migrationSql);
    check(
      "data_health_cancellation_with_result: 確定中止かつ rank1 のある結果だけを誤検出と数える（本物の中止・rank1 が NULL の返還の行・tentative・中止でないレースは数えない）。分母は全レース",
      cancellationWithResultOk(r),
      show(r),
    );
    const { evaluateCountCheck } = evalMod;
    const chk = COUNT_CHECKS.find((c) => c.id === "cancellation.with_result");
    const breach = evaluateCountCheck(chk, r, { end: "2026-09-13" });
    const clean = evaluateCountCheck(chk, r.slice(1), { end: "2026-09-13" });
    check(
      "cancellation.with_result: 誤検出が1件でもあれば未達（閾値100%・母数の下限1）、0件なら正常",
      chk?.severity === "alert" &&
        chk.days === 14 &&
        breach.status === "breach" &&
        breach.missing === 1 &&
        breach.worst?.key === "2026-09-12" &&
        clean.status === "ok",
      show({ breach, clean }),
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・migrationSql・withMutant・mutateEachFile・runEntriesDuplicates・runCancellationWithResult） */
export async function runDataHealthJobScenes8(env) {
  ({ check, migrationSql, withMutant, mutateEachFile, runEntriesDuplicates, runCancellationWithResult } = env);
  await scene4();
}
