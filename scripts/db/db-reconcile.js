#!/usr/bin/env node
/**
 * db-reconcile.js - 本番 DB の自動の適用（ADR-0097）の突き合わせ。master の HEAD を checkout した Actions の上で動かす。
 * 次に当てるマイグレーションを1本選び、結果を JSON で標準出力と $GITHUB_OUTPUT に出す。DB には触らない。
 *
 *   status=busy      db-apply の他の run が動いている・承認を待っている（何もしない）
 *   status=none      当てるものが無い
 *   status=selected  file を当ててよい（判定 classifyMigration は呼び出し側が当てる時点で行う）
 *   status=blocked   番号の順で次のファイルが5点の検査を通らない（当てずに通知する）
 * ほかに出すもの: reasons（JSON）・pending（未処理のファイルを最大10本、試運転の評価用、JSON）・stale（6時間以上承認を待つ run の URL、JSON）
 *
 * env:
 *   GITHUB_TOKEN           読み取りだけ（actions・contents・pull-requests）
 *   GITHUB_REPOSITORY      owner/repo
 *   GITHUB_RUN_ID          自分の run（busy の判定から除く）
 *   DB_APPLY_SWITCH_SHA    切り替えのコミット。これより後に足されたファイルだけを見る（workflow に固定する）
 *   REVIEWER_BOT_USER_ID   審査の App の bot ユーザーの数値の ID
 *
 * 手順は docs/operation/db-apply.md「自動の適用」。
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MIGRATION_PATH_RE } from "../lib/dbApplySql.js";
import {
  evaluateCandidate,
  isBusy,
  ledgerRowAddedAsUnapplied,
  ledgerState,
  pendingCandidates,
  pickNext,
  staleWaitingRuns,
} from "../lib/dbReconcile.js";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const LEDGER_PATH = "docs/db-migration/APPLIED.md";

function fail(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}

function requireEnv(name, re) {
  const value = process.env[name];
  if (!value || !re.test(value)) fail(`env ${name} が無いか、形が違う`);
  return value;
}

const git = (...args) =>
  execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();

/** 失敗は握りつぶさず止める（取れない事実を「無い」と扱うと、検査が通る側に倒れうるため） */
async function api(repo, token, pathAndQuery) {
  const res = await fetch(
    `https://api.github.com/repos/${repo}${pathAndQuery}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );
  if (!res.ok) fail(`GitHub API ${pathAndQuery} が ${res.status} を返した`);
  return res.json();
}

/** ページを全部たどる（配列を返す API だけ） */
async function apiAll(repo, token, pathAndQuery) {
  const out = [];
  for (let page = 1; page <= 20; page += 1) {
    const sep = pathAndQuery.includes("?") ? "&" : "?";
    const items = await api(
      repo,
      token,
      `${pathAndQuery}${sep}per_page=100&page=${page}`,
    );
    out.push(...items);
    if (items.length < 100) return out;
  }
  fail(`GitHub API ${pathAndQuery} が20ページを超えた`);
}

async function main() {
  const token = requireEnv("GITHUB_TOKEN", /^\S+$/);
  const repo = requireEnv("GITHUB_REPOSITORY", /^[\w.-]+\/[\w.-]+$/);
  const runId = requireEnv("GITHUB_RUN_ID", /^\d+$/);
  const switchSha = requireEnv("DB_APPLY_SWITCH_SHA", /^[0-9a-f]{40}$/);
  const reviewerUserId = Number(requireEnv("REVIEWER_BOT_USER_ID", /^\d+$/));

  // db-apply の他の run が動いている・待っているなら何もしない
  const runs = [];
  for (const status of [
    "in_progress",
    "queued",
    "waiting",
    "requested",
    "pending",
  ]) {
    const res = await api(
      repo,
      token,
      `/actions/workflows/db-apply.yml/runs?status=${status}&per_page=100`,
    );
    runs.push(...res.workflow_runs);
  }
  // 重いものの承認待ちが6時間を超えたら知らせる（busy でも数える。承認待ちの run があると busy になるため）
  const stale = staleWaitingRuns(runs, new Date());
  if (isBusy(runs, runId)) return output({ status: "busy", stale });

  const head = git("rev-parse", "HEAD");
  try {
    git("merge-base", "--is-ancestor", switchSha, head);
  } catch {
    fail(`切り替えのコミット ${switchSha} が master の HEAD の祖先でない（取り出しが浅いか、SHA の固定が誤り）`);
  }
  const ledger = readFileSync(path.join(ROOT, LEDGER_PATH), "utf8");

  // 切り替えより後の first-parent のコミットで足された（A）マイグレーション
  const log = git(
    "log",
    "--first-parent",
    "--diff-filter=A",
    "--name-only",
    "--format=@%H",
    `${switchSha}..${head}`,
    "--",
    "docs/db-migration/",
  );
  const addCommitsByFile = new Map();
  let current = null;
  for (const line of log.split("\n")) {
    if (line.startsWith("@")) current = line.slice(1);
    else if (MIGRATION_PATH_RE.test(line)) {
      addCommitsByFile.set(line, [
        ...(addCommitsByFile.get(line) ?? []),
        current,
      ]);
    }
  }

  const candidates = [];
  for (const [file, addCommits] of addCommitsByFile) {
    const fileName = path.basename(file);
    const state = ledgerState(ledger, fileName);
    if (state !== null && state !== "未適用") {
      candidates.push({ file, ledgerState: state, evaluation: null });
      continue;
    }
    if (!existsSync(path.join(ROOT, file))) {
      candidates.push({ file, ledgerState: state, existsAtHead: false, evaluation: null });
      continue;
    }
    const commit = addCommits[0];
    const masterBlob = existsSync(path.join(ROOT, file))
      ? git("rev-parse", `HEAD:${file}`)
      : null;
    const commitParents =
      git("rev-list", "--parents", "-n", "1", commit).split(" ").length - 1;
    const ledgerDiff = git("diff", `${commit}^1`, commit, "--", LEDGER_PATH);
    const prs = (await api(repo, token, `/commits/${commit}/pulls`)).map(
      (p) => ({
        number: p.number,
        merged: p.merged_at !== null,
        baseRef: p.base.ref,
        mergeCommitSha: p.merge_commit_sha,
        headSha: p.head.sha,
      }),
    );
    const pr = prs.find(
      (p) => p.merged && p.baseRef === "master" && p.mergeCommitSha === commit,
    );
    let headBlob = null;
    let reviews = [];
    if (pr) {
      const contents = await api(
        repo,
        token,
        `/contents/${file}?ref=${pr.headSha}`,
      );
      headBlob = contents.sha ?? null;
      reviews = (await apiAll(repo, token, `/pulls/${pr.number}/reviews`)).map(
        (r) => ({
          userId: r.user?.id ?? -1,
          state: r.state,
          commitId: r.commit_id,
        }),
      );
    }
    const runbook = `docs/db-migration/${fileName.split("_")[0]}-runbook.md`;
    candidates.push({
      file,
      ledgerState: state,
      evaluation: evaluateCandidate({
        file,
        addCommits,
        commitParents,
        ledgerState: state,
        ledgerRowAddedInCommit: ledgerRowAddedAsUnapplied(ledgerDiff, fileName),
        runbookExists: existsSync(path.join(ROOT, runbook)),
        prs,
        headBlob,
        masterBlob,
        reviews,
        reviewerUserId,
      }),
    });
  }
  // pending は試運転の評価用（先頭の1本だけでなく、未処理のファイルを最大10本）
  return output({ ...pickNext(candidates), pending: pendingCandidates(candidates), stale });
}

function output(result) {
  console.log(JSON.stringify(result, null, 2));
  const file = process.env.GITHUB_OUTPUT;
  if (file) {
    appendFileSync(
      file,
      [
        `status=${result.status}`,
        `file=${result.file ?? ""}`,
        `pr=${result.pr ?? ""}`,
        `pending=${JSON.stringify(result.pending ?? [])}`,
        `reasons=${JSON.stringify(result.reasons ?? [])}`,
        `stale=${JSON.stringify(result.stale ?? [])}`,
        "",
      ].join("\n"),
    );
  }
}

main().catch((err) => fail(`突き合わせに失敗: ${err.message}`));
