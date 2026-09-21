#!/usr/bin/env node
/**
 * データ取得の監視自体の死活確認（メタ監視。GitHub Actions: scrape-monitor-liveness.yml から呼ばれる）。
 *
 * api/cron/scrape-monitor.js（Vercel Cron、5分ごと）が動いていることを、scrape_job_state の
 * job='scrape-monitor' の行で確認する。監視が止まると、expired・未実行・死活の通知が全て黙るため、
 * 監視の死活は、監視の外（GitHub Actions）で見る（plan.md §6の2次）。GitHubのscheduleは数時間遅れるが、
 * 「監視の死活は1日単位で足りる」ため許容する（要判断(j)）。
 *
 * 異常を検知したら、Slack通知用のテキストをstdoutに出力し、exit code 1（ワークフロー側が通知する）。
 * 確認自体に失敗した場合（DB接続エラー等）も、監視が黙っていないことを確認できないため exit 1。
 * 予定表のテーブルが無い（マイグレーション075が未適用）間は、確認をスキップして exit 0。
 *
 * 判定（evaluateMonitorLiveness）:
 *   - 運用窓（JST 07:10〜23:59）の外は判定しない（GitHubの遅延で、窓の外に実行された場合）
 *   - scrape-monitor の行が無い: 有効な取得ジョブがあれば異常、無ければ「まだ起動していない」で正常
 *   - last_tick_at が30分以上前（5分ごとの起動が6回途絶えた）: 異常
 *   - consecutive_failures が3以上（Slack通知の失敗等で、監視が失敗し続けている）: 異常
 *
 * 汎用の日次監視 data_health（scrape_job_state の job='data_health'。件数の充足率・0件のテーブル）も、同じ日次の確認で見る
 * （evaluateDataHealthLiveness）。scrape-monitor が動いていれば、日次ジョブの期限超過（daily_overdue）で通知されるが、
 * scrape-monitor 自体が止まっていても、また data_health のCron・デプロイ・マイグレーション089が欠けていても、
 * 監視の外（ここ）で検知する。
 */
import { pathToFileURL } from "node:url";
import { THRESHOLDS, livenessCheckable } from "../lib/scrapeJobs/monitor.js";
import { isScrapeSchemaMissingError } from "../lib/scrapeJobs/schemaErrors.js";
import { SCRAPE_JOBS } from "../lib/scrapeJobs/registry.js";
import { resolveTargetDate } from "../lib/scrapeJobs/dailyJob.js";

export const MONITOR_STALE_MIN = 30;
export const MONITOR_MAX_FAILURES = 3;

/**
 * @param {{now: Date, jobStates: Array<Record<string, unknown>>}} input
 * @returns {{status: "ok"|"skip"|"alert", message: string}}
 */
export function evaluateMonitorLiveness({ now, jobStates }) {
  if (!livenessCheckable(now)) {
    return {
      status: "skip",
      message:
        "運用窓（JST 07:10〜23:59）の外に実行されたため、監視の死活は判定しません",
    };
  }
  const row = jobStates.find((r) => r.job === "scrape-monitor");
  const activeJobs = jobStates.filter(
    (r) =>
      !String(r.job).startsWith("host:") &&
      SCRAPE_JOBS[r.job]?.kind !== "monitor" &&
      (r.mode === "shadow" || r.mode === "live"),
  );
  if (!row) {
    return activeJobs.length > 0
      ? {
          status: "alert",
          message: `scrape-monitor の行が存在しません（監視が一度も起動していない）。有効な取得ジョブ: ${activeJobs.map((r) => r.job).join(", ")}`,
        }
      : {
          status: "ok",
          message:
            "scrape-monitor はまだ起動していませんが、有効な取得ジョブが無いため正常とします",
        };
  }
  const lastTick = row.last_tick_at ? new Date(String(row.last_tick_at)) : null;
  const ageMin = lastTick ? (now.getTime() - lastTick.getTime()) / 60000 : null;
  if (ageMin === null || ageMin >= MONITOR_STALE_MIN) {
    return {
      status: "alert",
      message: `scrape-monitor の last_tick_at が${ageMin === null ? "未記録" : `${Math.floor(ageMin)}分前（${lastTick.toISOString()}）`}。監視のCronが動いていない可能性があります（Vercel Cronの未配信・関数の障害・デプロイの失敗）`,
    };
  }
  const failures = Number(row.consecutive_failures ?? 0);
  if (failures >= MONITOR_MAX_FAILURES) {
    return {
      status: "alert",
      message: `scrape-monitor が${failures}回連続で失敗しています（最終エラー: ${row.last_error ?? "不明"}）。Slack通知の設定（SLACK_WEBHOOK_URL）を確認してください`,
    };
  }
  return {
    status: "ok",
    message: `scrape-monitor は正常です（last_tick_at ${Math.floor(ageMin)}分前、連続失敗${failures}回）`,
  };
}

const DATA_HEALTH_JOB = "data_health";

/**
 * @param {{now: Date, jobStates: Array<Record<string, unknown>>}} input
 * @returns {{status: "ok"|"skip"|"alert", message: string}}
 */
export function evaluateDataHealthLiveness({ now, jobStates }) {
  const def = SCRAPE_JOBS[DATA_HEALTH_JOB];
  const row = jobStates.find((r) => r.job === DATA_HEALTH_JOB);
  // off・shadow・行なしは、まだ有効化されていない（判定しない）。shadow は対象日を処理済みにしないため、鮮度で見る
  if (!row || row.mode === "off") {
    return {
      status: "ok",
      message: "data_health は有効化されていません（off）",
    };
  }
  if (!livenessCheckable(now)) {
    return {
      status: "skip",
      message: "運用窓の外に実行されたため、data_health の鮮度は判定しません",
    };
  }
  const targetDate = resolveTargetDate(now, def.targetTimeJst);
  const targetInstant = new Date(`${targetDate}T${def.targetTimeJst}:00+09:00`);
  const overdueHours = (now.getTime() - targetInstant.getTime()) / 3600000;
  if (overdueHours < THRESHOLDS.dailyOverdueHours) {
    return {
      status: "ok",
      message: `data_health の対象日 ${targetDate} は、指定時刻から${THRESHOLDS.dailyOverdueHours}時間以内のため、まだ判定しません`,
    };
  }
  const processed =
    row.mode === "live"
      ? row.last_target_date === targetDate
      : Boolean(row.last_success_at) &&
        new Date(String(row.last_success_at)).getTime() >=
          targetInstant.getTime();
  if (!processed) {
    return {
      status: "alert",
      message: `data_health（汎用の日次監視）が対象日 ${targetDate} を処理していません（mode=${row.mode}、最終成功 ${row.last_success_at ?? "なし"}、最終エラー: ${row.last_error ?? "なし"}）。Vercel Cronの未配信・デプロイの失敗・マイグレーション089の未適用の可能性があります`,
    };
  }
  return {
    status: "ok",
    message: `data_health は対象日 ${targetDate} を処理済みです`,
  };
}

async function main() {
  const { supabase } = await import("../lib/supabaseClient.js");
  if (!supabase) throw new Error("Supabase が設定されていません");
  const { data, error } = await supabase
    .from("scrape_job_state")
    .select(
      "job,mode,last_tick_at,last_success_at,last_target_date,last_error,consecutive_failures",
    );
  if (error) {
    if (isScrapeSchemaMissingError(error)) {
      console.log(
        "SKIP: 予定表・ジョブ状態のテーブルがありません（マイグレーション075が未適用）。監視の死活確認をスキップします",
      );
      process.exit(0);
    }
    throw new Error(`ジョブ状態の読み取りに失敗しました: ${error.message}`);
  }
  const now = new Date();
  const results = [
    evaluateMonitorLiveness({ now, jobStates: data }),
    evaluateDataHealthLiveness({ now, jobStates: data }),
  ];
  const alerts = results.filter((r) => r.status === "alert");
  if (alerts.length > 0) {
    console.log(alerts.map((r) => r.message).join("\n"));
    process.exit(1);
  }
  for (const result of results) {
    console.log(
      `${result.status === "skip" ? "SKIP" : "OK"}: ${result.message}`,
    );
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    // 確認自体の失敗も、監視が黙っていないことを確認できていないため、通知する
    console.log(`監視の死活確認に失敗しました: ${error.message}`);
    process.exit(1);
  });
}
