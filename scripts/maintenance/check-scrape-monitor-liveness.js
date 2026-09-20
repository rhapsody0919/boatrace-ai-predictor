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
 * 予定表のテーブルが無い（マイグレーション072が未適用）間は、確認をスキップして exit 0。
 *
 * 判定（evaluateMonitorLiveness）:
 *   - 運用窓（JST 07:10〜23:59）の外は判定しない（GitHubの遅延で、窓の外に実行された場合）
 *   - scrape-monitor の行が無い: 有効な取得ジョブがあれば異常、無ければ「まだ起動していない」で正常
 *   - last_tick_at が30分以上前（5分ごとの起動が6回途絶えた）: 異常
 *   - consecutive_failures が3以上（Slack通知の失敗等で、監視が失敗し続けている）: 異常
 */
import { pathToFileURL } from "node:url";
import { livenessCheckable } from "../lib/scrapeJobs/monitor.js";
import { isScrapeSchemaMissingError } from "../lib/scrapeJobs/schemaErrors.js";
import { SCRAPE_JOBS } from "../lib/scrapeJobs/registry.js";

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

async function main() {
  const { supabase } = await import("../lib/supabaseClient.js");
  if (!supabase) throw new Error("Supabase が設定されていません");
  const { data, error } = await supabase
    .from("scrape_job_state")
    .select(
      "job,mode,last_tick_at,last_success_at,last_error,consecutive_failures",
    );
  if (error) {
    if (isScrapeSchemaMissingError(error)) {
      console.log(
        "SKIP: 予定表・ジョブ状態のテーブルがありません（マイグレーション072が未適用）。監視の死活確認をスキップします",
      );
      process.exit(0);
    }
    throw new Error(`ジョブ状態の読み取りに失敗しました: ${error.message}`);
  }
  const result = evaluateMonitorLiveness({ now: new Date(), jobStates: data });
  if (result.status === "alert") {
    console.log(result.message);
    process.exit(1);
  }
  console.log(`${result.status === "skip" ? "SKIP" : "OK"}: ${result.message}`);
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
