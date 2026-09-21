#!/usr/bin/env node
/**
 * 汎用の日次監視 data_health（scripts/lib/dataHealth/）を、手元から、本番DBの読み取り専用で1回実行する。
 * Slackへは通知せず、DBにも書かない（scrape_job_state の last_report も更新しない）。
 *
 * 用途:
 *   - マイグレーション089（DB関数）の適用前に、登録した各SQLが本番で動き、期待どおりの値を返すことを確認する
 *     （関数と同じSQLを、日付リテラルにして実行する。scripts/lib/dataHealth/functions.js の renderInlineSql）
 *   - 閾値・除外の見直し（shadow の代わりの、手元の確認）
 *
 * 使い方:
 *   node scripts/maintenance/check-data-health.js [--target-date YYYY-MM-DD] [--weekly] [--json]
 *     --target-date  対象日（既定: 今日JST。評価の終端はその前日）
 *     --weekly       曜日によらず、週次の項目（月別の結果充足率）も実行する
 *     --json         結果をJSONで出す
 *
 * SQLの実行: Supabase Management API の read-only エンドポイント（data-health-report.js と同じ）。
 * 環境変数: SUPABASE_URL, SUPABASE_ACCESS_TOKEN（.env.local）。Disk IO予算への配慮: 関数ごとに逐次実行。
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import dotenv from "dotenv";
import { getTodayDateJST } from "../lib/dateUtils.js";
import { COUNT_CHECKS } from "../lib/dataHealth/checks.js";
import { runDataHealthChecks } from "../lib/dataHealth/job.js";
import { renderInlineSql } from "../lib/dataHealth/functions.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "../../.env.local"), quiet: true });

/** Management API の read-only エンドポイントで、SQLを1本実行する */
async function runSql(query) {
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  if (!accessToken || !supabaseUrl) {
    throw new Error(
      "SUPABASE_ACCESS_TOKEN と SUPABASE_URL が必要です（.env.local を確認）",
    );
  }
  const ref = new URL(supabaseUrl).hostname.split(".")[0];
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${ref}/database/query/read-only`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    },
  );
  const body = await res.text();
  if (!res.ok) {
    throw new Error(
      `SQL実行に失敗 (HTTP ${res.status}): ${body.slice(0, 300)}`,
    );
  }
  return JSON.parse(body);
}

/** 関数と同じSQLを実行して、関数の戻り値（jsonb）と同じ形にする */
export async function callFunctionInline(fn, args, sqlRunner = runSql) {
  const startedAt = Date.now();
  const rows = await sqlRunner(
    renderInlineSql(fn, { from: args.p_from, to: args.p_to }),
  );
  console.error(`  ${fn.name}: ${Date.now() - startedAt}ms`);
  return rows[0].result;
}

const pct = (v) =>
  v === undefined || v === null ? "-" : `${(v * 100).toFixed(1)}%`;

async function main(argv = process.argv.slice(2)) {
  const opts = { targetDate: getTodayDateJST(), weekly: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--target-date") opts.targetDate = argv[++i];
    else if (argv[i] === "--weekly") opts.weekly = true;
    else if (argv[i] === "--json") opts.json = true;
    else throw new Error(`未知の引数: ${argv[i]}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(opts.targetDate ?? "")) {
    throw new Error("--target-date は YYYY-MM-DD 形式です");
  }
  // 曜日によらず週次の項目も実行する: cadence を外した写しを使う
  const checks = opts.weekly
    ? COUNT_CHECKS.map((c) => ({ ...c, cadence: undefined }))
    : COUNT_CHECKS;
  const { report, breaches, alerts } = await runDataHealthChecks({
    targetDate: opts.targetDate,
    now: new Date(),
    mode: "live",
    callFunction: (fn, args) => callFunctionInline(fn, args),
    checks,
  });
  if (opts.json) {
    console.log(JSON.stringify({ report, breaches, alerts }, null, 2));
    return;
  }
  console.log(
    `対象日 ${report.targetDate}（評価の終端 ${report.period.end}）。未達 ${breaches.length}件`,
  );
  for (const r of report.checks) {
    console.log(
      `  ${r.status.padEnd(15)} ${r.id.padEnd(34)} ${pct(r.rate).padStart(7)}${
        r.num !== undefined ? `  (${r.num}/${r.den})` : ""
      }${r.detail ? `  ${r.detail}` : ""}`,
    );
  }
  for (const t of report.emptyTables) {
    console.log(`  空テーブル ${t.table}: ${t.status}（${t.policy}）`);
  }
  for (const b of breaches) console.log(`  [通知候補] ${b.text}`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error("check-data-health 実行中にエラー:", error.message);
    process.exit(1);
  });
}
