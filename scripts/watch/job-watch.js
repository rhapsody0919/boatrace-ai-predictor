#!/usr/bin/env node
/**
 * job-watch.js - 定期の job の見張り（.github/workflows/job-watch.yml、ADR-0097 の追記「定期の job の見張り」）。
 * Node の組み込みだけを使う（npm ci をしない）。
 *
 *   scan   見張る workflow の直近24時間の失敗を全部見回し、規則で分類して Issue に書く（actions: read・issues: write）。
 *          rerun するものを出力 reruns（JSON の run ID の配列）に出す。試運転（dryRun）の間は出さず、Issue に書くだけ。
 *          イベントを取りこぼしても次の見回りで拾うので、毎回全部を見る（冪等）
 *   rerun  reruns の各 run を当てる直前に確かめ直し（許可の一覧・1回目・失敗のまま）、失敗した job だけ rerun する（actions: write）
 *
 * env: GITHUB_TOKEN・GITHUB_REPOSITORY・RERUNS（rerun のときだけ）
 * 設定の正本は scripts/watch/job-watch.json。
 */
import { appendFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  classifyLog,
  decideRun,
  handledMarkers,
  jstDate,
  recoveryReruns,
  rerunBlockers,
  runMarker,
} from "../lib/jobWatch.js";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const CONFIG = JSON.parse(
  readFileSync(path.join(ROOT, "scripts/watch/job-watch.json"), "utf8"),
);
const KEY_LABEL = "job-watch-key";
const FAILURE_LABEL = "job-watch-failure";
const CANARY_PATH = ".github/workflows/key-canary.yml";
const LOG_TAIL = 200_000;

function fail(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}

const token = process.env.GITHUB_TOKEN;
const repo = process.env.GITHUB_REPOSITORY ?? "";
if (!token) fail("GITHUB_TOKEN が無い");
if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) fail("GITHUB_REPOSITORY の形が違う");

async function gh(method, pathAndQuery, body, { raw = false } = {}) {
  const res = await fetch(`https://api.github.com${pathAndQuery}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok)
    fail(
      `GitHub API ${method} ${pathAndQuery.split("?")[0]} が ${res.status} を返した`,
    );
  const text = await res.text();
  if (raw) return text;
  // rerun-failed-jobs・close 等は本文が空のことがある
  return text ? JSON.parse(text) : null;
}

async function listAll(pathAndQuery, key) {
  const out = [];
  for (let page = 1; page <= 10; page += 1) {
    const sep = pathAndQuery.includes("?") ? "&" : "?";
    const data = await gh(
      "GET",
      `${pathAndQuery}${sep}per_page=100&page=${page}`,
    );
    const items = key ? data[key] : data;
    out.push(...items);
    if (items.length < 100) return out;
  }
  return out;
}

const isProductionRun = (r) =>
  CONFIG.watched.includes(r.path) &&
  r.head_branch === "master" &&
  r.head_repository?.full_name === repo &&
  // push は master へのマージ・自動コミットで動くもの（Post-merge Checks・Regenerate Generated Docs 等）。
  // rerun の許可の一覧には入っていないので、知らせるだけになる
  (r.event === "schedule" || r.event === "workflow_dispatch" || r.event === "push");

async function failedJobLog(runId) {
  const jobs = await listAll(
    `/repos/${repo}/actions/runs/${runId}/jobs?filter=latest`,
    "jobs",
  );
  const texts = [];
  for (const j of jobs.filter(
    (x) => x.conclusion === "failure" || x.conclusion === "timed_out",
  )) {
    const text = await gh(
      "GET",
      `/repos/${repo}/actions/jobs/${j.id}/logs`,
      null,
      { raw: true },
    );
    texts.push(text.slice(-LOG_TAIL));
  }
  return texts.join("\n");
}

async function openIssue(label) {
  const issues = await gh(
    "GET",
    `/repos/${repo}/issues?labels=${label}&state=open&per_page=10`,
  );
  return issues.find((i) => !i.pull_request) ?? null;
}

async function issueTexts(issue) {
  if (!issue) return [];
  const comments = await listAll(
    `/repos/${repo}/issues/${issue.number}/comments`,
  );
  return [issue.body ?? "", ...comments.map((c) => c.body ?? "")];
}

const line = (r, reason) =>
  `- [${r.name} #${r.run_number}（${r.attempt}回目）](${r.html_url}) ${jstDate(r.createdAt)} ${reason}`;

async function writeIssue(label, title, intro, items) {
  if (items.length === 0) return;
  const issue = await openIssue(label);
  const text = items.map((x) => `${x.text}\n${x.marker}`).join("\n");
  if (!issue) {
    await gh("POST", `/repos/${repo}/issues`, {
      title,
      labels: [label],
      body: `${intro}\n\n${text}`,
    });
  } else {
    await gh("POST", `/repos/${repo}/issues/${issue.number}/comments`, {
      body: text,
    });
  }
}

async function scan() {
  const now = new Date();
  const since = new Date(now.getTime() - 24 * 3_600_000).toISOString();
  const rerunAllowed = new Set(CONFIG.rerunAllowed);
  const runs = (
    await listAll(
      // master だけに絞る（PR の CI の run を取らない）
      `/repos/${repo}/actions/runs?branch=master&created=%3E%3D${since}`,
      "workflow_runs",
    )
  )
    .filter(isProductionRun)
    .map((r) => ({ ...r, attempt: r.run_attempt, createdAt: r.created_at }));

  const keyIssue = await openIssue(KEY_LABEL);
  const failureIssue = await openIssue(FAILURE_LABEL);
  const done = handledMarkers([
    ...(await issueTexts(keyIssue)),
    ...(await issueTexts(failureIssue)),
  ]);

  // 同じ workflow の後の run が成功済み・動いているか（rerun しても重なるだけ）
  const newerRun = (r) =>
    runs.some(
      (o) =>
        o.path === r.path &&
        Date.parse(o.created_at) > Date.parse(r.created_at) &&
        (o.conclusion === "success" || o.status !== "completed"),
    );

  const failed = runs.filter(
    (r) =>
      r.status === "completed" &&
      (r.conclusion === "failure" || r.conclusion === "timed_out"),
  );
  const keyItems = [];
  const failureItems = [];
  const reruns = [];
  const classified = [];
  for (const r of failed) {
    const kinds = ["key", "failure", "rerun"].map((k) =>
      runMarker(r.id, r.attempt, k),
    );
    const alreadyNoted = kinds.some((m) => done.has(m));
    if (alreadyNoted) {
      // 既に書いた run のログは読み直さない。鍵の Issue に書いたものは、鍵が直った後の追い上げの候補にだけ入れる
      if (done.has(runMarker(r.id, r.attempt, "key"))) {
        classified.push({ ...r, category: "config", newerRun: newerRun(r) });
      }
      continue;
    }
    const category = classifyLog(await failedJobLog(r.id));
    const run = { ...r, category, newerRun: newerRun(r) };
    classified.push(run);
    const d = decideRun(run, { rerunAllowed, now });
    if (d.action === "key-issue") {
      keyItems.push({
        text: line(run, d.reason),
        marker: runMarker(r.id, r.attempt, "key"),
      });
    } else if (d.action === "rerun") {
      failureItems.push({
        text: line(
          run,
          CONFIG.dryRun
            ? `${d.reason}。試運転なので rerun していない（rerun するはずだった）`
            : d.reason,
        ),
        marker: runMarker(r.id, r.attempt, "rerun"),
      });
      if (!CONFIG.dryRun) reruns.push(r.id);
    } else {
      failureItems.push({
        text: line(run, d.reason),
        marker: runMarker(r.id, r.attempt, "failure"),
      });
    }
  }

  await writeIssue(
    KEY_LABEL,
    "定期の job: 鍵・設定の誤り（job-watch）",
    "Environment prod-jobs・ryujin-bot の鍵・設定の誤りで、定期の job が落ちている。鍵を直すと、カナリア（key-canary.yml、30分ごと）が成功した時点で、同じ日の失敗分のうち許可の一覧の workflow を1回ずつ rerun して、この Issue を閉じる。",
    keyItems,
  );
  await writeIssue(
    FAILURE_LABEL,
    "定期の job の失敗（job-watch）",
    "定期の job の失敗のうち、鍵・設定の誤り以外のもの。一時的な失敗は許可の一覧の workflow だけ1回 rerun する。直ったら閉じる。",
    failureItems,
  );

  // 鍵が直ったか: 開いた鍵の Issue より後に、カナリアが成功している
  if (keyIssue) {
    const canaryOk = runs.some(
      (r) =>
        r.path === CANARY_PATH &&
        r.conclusion === "success" &&
        Date.parse(r.created_at) > Date.parse(keyIssue.created_at),
    );
    if (canaryOk) {
      const targets = recoveryReruns(classified, { rerunAllowed, now });
      const body =
        `カナリアが成功した（鍵が直った）。` +
        (targets.length === 0
          ? "同じ日に rerun してよい失敗は無い。"
          : CONFIG.dryRun
            ? `試運転なので rerun していない。rerun するはずだったもの:\n${targets.map((r) => line(r, "")).join("\n")}`
            : `次を1回ずつ rerun する:\n${targets.map((r) => line(r, "")).join("\n")}`) +
        "\n日をまたいだ失敗・許可の一覧に無い失敗は、手で確かめる。";
      await gh("POST", `/repos/${repo}/issues/${keyIssue.number}/comments`, {
        body,
      });
      await gh("PATCH", `/repos/${repo}/issues/${keyIssue.number}`, {
        state: "closed",
      });
      if (!CONFIG.dryRun) reruns.push(...targets.map((r) => r.id));
    }
  }

  const out = process.env.GITHUB_OUTPUT;
  const value = JSON.stringify([...new Set(reruns)]);
  if (out) appendFileSync(out, `reruns=${value}\n`);
  console.log(
    `失敗 ${failed.length} 件（新しく書いた: 鍵 ${keyItems.length}・その他 ${failureItems.length}）、rerun ${value}`,
  );
}

async function rerun() {
  let ids;
  try {
    ids = JSON.parse(process.env.RERUNS ?? "[]");
  } catch {
    fail("RERUNS が JSON として読めない");
  }
  if (!Array.isArray(ids) || !ids.every((x) => Number.isInteger(x)))
    fail("RERUNS が数の配列でない");
  if (CONFIG.dryRun) fail("試運転の間は rerun しない");
  const rerunAllowed = new Set(CONFIG.rerunAllowed);
  const now = new Date();
  for (const id of ids) {
    // 当てる直前に確かめ直す（scan の出力を信じ切らない）
    const r = await gh("GET", `/repos/${repo}/actions/runs/${id}`);
    const run = {
      id,
      path: r.path,
      attempt: r.run_attempt,
      createdAt: r.created_at,
      category: "transient",
      newerRun: false,
    };
    const why = rerunBlockers(run, { rerunAllowed, now });
    if (
      !isProductionRun(r) ||
      r.status !== "completed" ||
      r.conclusion === "success" ||
      why.length > 0
    ) {
      console.log(
        `rerun しない: ${id}（${why.join("・") || "状態が変わった"}）`,
      );
      continue;
    }
    await gh("POST", `/repos/${repo}/actions/runs/${id}/rerun-failed-jobs`);
    console.log(`rerun した: ${r.name} #${r.run_number}`);
  }
}

const command = process.argv[2];
const main = command === "scan" ? scan : command === "rerun" ? rerun : null;
if (!main) fail("使い方: job-watch.js scan | rerun");
main().catch((err) => fail(`見張りで失敗: ${err.message}`));
