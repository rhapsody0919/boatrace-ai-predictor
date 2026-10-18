#!/usr/bin/env node
/**
 * e2e-rerun.js - PR の E2E Smoke Test が落ちた・止まったまま終わらないときに、1回だけ再実行する。
 * 2回目も落ちたら再実行せず、オーケストレーターに上げる行を出す（2026-10-18 オーナー判断「案Z」）。
 *
 * 使い方:
 *   node scripts/maintenance/e2e-rerun.js              直近14日に更新されたオープンPR（draft を除く）を判定する（何もしない）
 *   node scripts/maintenance/e2e-rerun.js 1621 1630    指定したPRだけ判定する
 *   node scripts/maintenance/e2e-rerun.js --apply      判定どおりに再実行する
 *   --stuck-minutes=N                                  止まったとみなす shard の経過分（既定 50）
 *
 * 判定（judgeE2eRun）:
 *   - 成功              → 何もしない
 *   - 実行中            → 待つ。shard が stuck-minutes を超えて実行中なら「止まった」とみなす
 *   - 落ちた・止まった  → 1回目（attempt=1）なら再実行（gh run rerun --failed。止まったものは先に cancel）
 *                         2回目以降なら再実行せず「上げる」。1回目と同じ shard が落ちたかも書く
 *
 * 止まったとみなす既定の 50分: 直近30回の成功で shard の所要は最長 36分（2026-10-18 実測）。
 * e2e-shard には timeout-minutes が無く、止まると GitHub の既定の 6時間まで終わらない。
 *
 * ワークフロー（workflow_run で再実行するジョブ）にしなかった理由:
 *   - 「止まったまま終わらない」は、そのワークフローの中からは検知できない（自分が止まっている）。
 *     外から見るには定期実行のワークフローが要り、Actions の分を毎回使う
 *   - 2回目の失敗は人（オーケストレーター）への連絡で、ワークフローからはセッションに届かない
 *   - CI ゲートの変更（.github/workflows）にならず、見回りで社員が実行するだけで済む
 *
 * 検証: scripts/maintenance/verify-e2e-rerun.js
 */

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WORKFLOW = "e2e-smoke-test.yml";
const DEFAULT_STUCK_MINUTES = 50;
/** 落ちたとみなす結論。cancelled は止まったものを cancel した後の状態も含む。 */
const FAILED_CONCLUSIONS = new Set([
  "failure",
  "cancelled",
  "timed_out",
  "startup_failure",
]);
const CANCEL_WAIT_MS = 120_000;
/** PR を指定しないときに見る範囲。見回り（patrol.sh）と同じ直近14日。放置された古いPRを再実行しない */
const RECENT_DAYS = 14;
const CANCEL_POLL_MS = 5_000;

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

/** 落ちた・cancel されたジョブの名前（並びを揃える）。 */
export function failedJobNames(jobs) {
  return (jobs ?? [])
    .filter((j) => FAILED_CONCLUSIONS.has(j.conclusion))
    .map((j) => j.name)
    .sort();
}

/** 実行中のまま stuckMinutes を超えたジョブの名前。 */
export function stuckJobNames(jobs, now, stuckMinutes) {
  const limitMs = stuckMinutes * 60_000;
  return (jobs ?? [])
    .filter(
      (j) =>
        j.status === "in_progress" &&
        j.startedAt &&
        now - Date.parse(j.startedAt) > limitMs,
    )
    .map((j) => j.name)
    .sort();
}

/**
 * 1つの実行を判定する。gh の呼び出しとは分けてある（止める側・上げる側も固定の入力で検証するため）。
 *   run: { status, conclusion, attempt }（gh run view の値）
 *   jobs: 今の attempt のジョブ（{ name, status, conclusion, startedAt }）
 *   previousFailed: 1つ前の attempt で落ちたジョブの名前（attempt=1 なら不要）
 * 返り値: { action: "ok" | "wait" | "rerun" | "cancel-rerun" | "escalate" | "none", reason }
 */
export function judgeE2eRun({
  run,
  jobs,
  now,
  stuckMinutes = DEFAULT_STUCK_MINUTES,
  previousFailed = [],
}) {
  if (!run) {
    return {
      action: "none",
      reason:
        "この head の E2E Smoke Test の実行がありません（push 直後か、ワークフローが起動していない）",
    };
  }
  const attempt = run.attempt ?? 1;
  const retried = attempt >= 2;
  const escalate = (what, failed) => {
    const same =
      failed.length > 0 &&
      JSON.stringify(failed) === JSON.stringify(previousFailed);
    return {
      action: "escalate",
      reason:
        `再実行した後（attempt=${attempt}）も${what}: ${failed.join(", ") || "（ジョブ不明）"}。` +
        (same
          ? "1回目と同じジョブが落ちています。"
          : `1回目に落ちたのは ${previousFailed.join(", ") || "（不明）"}。`) +
        "これ以上は自動で再実行しません。オーケストレーターの判断に上げてください",
    };
  };

  if (run.status !== "completed") {
    const stuck = stuckJobNames(jobs, now, stuckMinutes);
    if (stuck.length === 0) {
      return {
        action: "wait",
        reason: `実行中（${run.status}、attempt=${attempt}）`,
      };
    }
    if (retried)
      return escalate(`${stuckMinutes}分を超えて止まっています`, stuck);
    return {
      action: "cancel-rerun",
      reason: `${stuck.join(", ")} が ${stuckMinutes}分を超えて実行中です。cancel して落ちたジョブだけ再実行します（1回目）`,
    };
  }
  if (run.conclusion === "success") {
    return { action: "ok", reason: `成功（attempt=${attempt}）` };
  }
  const failed = failedJobNames(jobs);
  if (retried) return escalate(`${run.conclusion} です`, failed);
  return {
    action: "rerun",
    reason: `${run.conclusion}（${failed.join(", ") || "ジョブ不明"}）。落ちたジョブだけ再実行します（1回目）`,
  };
}

/** gh を実行して標準出力を返す。失敗したら意味のあるメッセージ付きで投げる。 */
function gh(args) {
  try {
    return execFileSync("gh", args, {
      encoding: "utf8",
      cwd: repoRoot,
      timeout: 60_000,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (e) {
    const detail = String(e.stderr ?? e.message).trim();
    throw new Error(`gh ${args.join(" ")} が失敗: ${detail}`);
  }
}
const ghJson = (args) => JSON.parse(gh(args));

function listOpenPrs(now) {
  const since = now - RECENT_DAYS * 86_400_000;
  return ghJson([
    "pr",
    "list",
    "--state",
    "open",
    "--limit",
    "100",
    "--json",
    "number,headRefOid,isDraft,updatedAt",
  ]).filter((p) => !p.isDraft && Date.parse(p.updatedAt) >= since);
}

function prHead(pr) {
  return ghJson(["pr", "view", String(pr), "--json", "number,headRefOid"]);
}

/** その head の最新の E2E Smoke Test の実行と、判定に要るジョブ。無ければ null。 */
function latestRun(headSha) {
  const runs = ghJson([
    "run",
    "list",
    "--workflow",
    WORKFLOW,
    "--commit",
    headSha,
    "--limit",
    "5",
    "--json",
    "databaseId,createdAt",
  ]);
  if (runs.length === 0) return null;
  const { databaseId } = runs.sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  )[0];
  const view = ghJson([
    "run",
    "view",
    String(databaseId),
    "--json",
    "status,conclusion,attempt,jobs",
  ]);
  const previousFailed =
    view.attempt >= 2
      ? failedJobNames(
          ghJson([
            "run",
            "view",
            String(databaseId),
            "--attempt",
            String(view.attempt - 1),
            "--json",
            "jobs",
          ]).jobs,
        )
      : [];
  return { id: databaseId, run: view, jobs: view.jobs, previousFailed };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cancelAndWait(id) {
  gh(["run", "cancel", String(id)]);
  const deadline = Date.now() + CANCEL_WAIT_MS;
  while (Date.now() < deadline) {
    await sleep(CANCEL_POLL_MS);
    const status = gh([
      "run",
      "view",
      String(id),
      "--json",
      "status",
      "-q",
      ".status",
    ]);
    if (status === "completed") return;
  }
  throw new Error(
    `run ${id} を cancel したが ${CANCEL_WAIT_MS / 1000}秒で終わりません。手で gh run rerun ${id} --failed してください`,
  );
}

async function apply(action, id) {
  if (action === "cancel-rerun") await cancelAndWait(id);
  gh(["run", "rerun", String(id), "--failed"]);
}

function parseArgs(argv) {
  const prs = [];
  let applyMode = false;
  let stuckMinutes = DEFAULT_STUCK_MINUTES;
  for (const a of argv) {
    if (a === "--apply") applyMode = true;
    else if (a.startsWith("--stuck-minutes=")) {
      stuckMinutes = Number(a.split("=")[1]);
      if (!Number.isFinite(stuckMinutes) || stuckMinutes <= 0) {
        throw new Error(`--stuck-minutes は正の数: ${a}`);
      }
    } else if (/^\d+$/.test(a)) prs.push(Number(a));
    else throw new Error(`分からない引数: ${a}`);
  }
  return { prs, applyMode, stuckMinutes };
}

async function main() {
  const { prs, applyMode, stuckMinutes } = parseArgs(process.argv.slice(2));
  const now = Date.now();
  const targets = prs.length > 0 ? prs.map(prHead) : listOpenPrs(now);
  let errors = 0;
  for (const { number, headRefOid } of targets) {
    try {
      const found = latestRun(headRefOid);
      const verdict = judgeE2eRun({ ...(found ?? {}), now, stuckMinutes });
      const label = verdict.action === "escalate" ? "上げる" : verdict.action;
      const runRef = found ? ` run=${found.id}` : "";
      if (verdict.action === "ok" || verdict.action === "wait") {
        console.log(`#${number} ${label}${runRef}: ${verdict.reason}`);
        continue;
      }
      if (
        applyMode &&
        (verdict.action === "rerun" || verdict.action === "cancel-rerun")
      ) {
        await apply(verdict.action, found.id);
        console.log(`#${number} ${label} 実行済み${runRef}: ${verdict.reason}`);
      } else {
        const hint =
          verdict.action === "rerun" || verdict.action === "cancel-rerun"
            ? "（--apply で実行）"
            : "";
        console.log(`#${number} ${label}${runRef}: ${verdict.reason}${hint}`);
      }
    } catch (e) {
      errors += 1;
      console.error(`#${number} エラー: ${e.message}`);
    }
  }
  if (errors > 0) process.exit(1);
}

const invokedDirectly =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  main().catch((e) => {
    console.error(`e2e-rerun: ${e.message}`);
    process.exit(1);
  });
}
