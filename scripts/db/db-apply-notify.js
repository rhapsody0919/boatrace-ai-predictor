#!/usr/bin/env node
/**
 * db-apply-notify.js - 本番 DB の自動の適用（ADR-0097）の定期の起動の結果を、Slack と元の PR に出す。
 * 項目は scripts/lib/dbReconcile.js の buildNotifications が作る。
 * 印（key）のある項目は、元の PR のコメントに <!-- key --> を入れる。同じ印のコメントが既にあれば、PR にも Slack にも出さない。
 * 印の無い項目（job の失敗・承認待ちの6時間）は毎回 Slack に出す。
 *
 * env: DB_APPLY_DRY_RUN・STATUS・FILE・PR・LABEL・SHA256・REASONS・PENDING・JUDGED（JSON）・STALE（JSON）
 *      RESULT_RECONCILE・RESULT_JUDGE・RESULT_APPLY_AUTO・RESULT_APPLY_GATED・RESULT_RECORD
 *      SLACK_WEBHOOK_URL（Environment prod-jobs）・GITHUB_TOKEN（PR のコメントの読み書きだけ）・GITHUB_REPOSITORY・GITHUB_RUN_ID
 */
import { buildNotifications } from "../lib/dbReconcile.js";

function fail(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}

function parseJson(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  try {
    const value = JSON.parse(raw);
    if (Array.isArray(value)) return value;
  } catch {
    // 下で止める
  }
  fail(`${name} が配列の JSON でない`);
}

async function github(method, pathAndQuery, body) {
  const res = await fetch(`https://api.github.com${pathAndQuery}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
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
  return res.json();
}

async function main() {
  const repo = process.env.GITHUB_REPOSITORY ?? "";
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) fail("GITHUB_REPOSITORY の形が違う");
  const items = buildNotifications({
    dryRun: process.env.DB_APPLY_DRY_RUN !== "false",
    status: process.env.STATUS ?? "",
    file: process.env.FILE ?? "",
    pr: process.env.PR || null,
    label: process.env.LABEL ?? "",
    sha256: process.env.SHA256 ?? "",
    reasons: parseJson("REASONS", []),
    pending: parseJson("PENDING", []),
    judged: parseJson("JUDGED", []),
    results: {
      reconcile: process.env.RESULT_RECONCILE ?? "",
      judge: process.env.RESULT_JUDGE ?? "",
      applyAuto: process.env.RESULT_APPLY_AUTO ?? "",
      applyGated: process.env.RESULT_APPLY_GATED ?? "",
      record: process.env.RESULT_RECORD ?? "",
    },
    stale: parseJson("STALE", []),
    runUrl: `https://github.com/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}`,
    now: new Date(),
  });

  const toSlack = [];
  const commentsByPr = new Map();
  for (const item of items) {
    if (!item.key) {
      toSlack.push(item.text);
      continue;
    }
    if (!/^\d+$/.test(String(item.pr ?? ""))) {
      // PR が分からない項目は印を置けないので、毎回出すと重なる。Slack にも出さず、ログにだけ残す
      console.log(`PR が分からないので出さない: ${item.text}`);
      continue;
    }
    if (!commentsByPr.has(item.pr)) {
      const comments = await github(
        "GET",
        `/repos/${repo}/issues/${item.pr}/comments?per_page=100`,
      );
      commentsByPr.set(
        item.pr,
        comments.map((c) => c.body ?? ""),
      );
    }
    const marker = `<!-- ${item.key} -->`;
    if (commentsByPr.get(item.pr).some((b) => b.includes(marker))) continue;
    await github("POST", `/repos/${repo}/issues/${item.pr}/comments`, {
      body: `${item.text}\n\n${marker}`,
    });
    commentsByPr.get(item.pr).push(marker);
    toSlack.push(item.text);
  }

  if (toSlack.length === 0) {
    console.log("知らせることは無い");
    return;
  }
  const message = toSlack.join("\n\n");
  console.log(message);
  const webhook = process.env.SLACK_WEBHOOK_URL;
  if (!webhook)
    fail("SLACK_WEBHOOK_URL が無い（Environment prod-jobs を確認する）");
  const slack = await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: message }),
  });
  if (!slack.ok) fail(`Slack への送信が ${slack.status} を返した`);
}

main().catch((err) => fail(`通知に失敗: ${err.message}`));
