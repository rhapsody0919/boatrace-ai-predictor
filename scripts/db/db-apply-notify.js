#!/usr/bin/env node
/**
 * db-apply-notify.js - 本番 DB の自動の適用（ADR-0097）の定期の起動の結果を、Slack と元の PR に1回だけ出す。
 * 文は scripts/lib/dbReconcile.js の buildNotifyMessage が作る。出すものが無ければ何もしない。
 * 重複を避ける状態は持たず、時刻の窓（前回の定期の起動より後に足された SQL、6〜7時間の承認待ち）で1回にする。
 *
 * env: DB_APPLY_DRY_RUN・STATUS・FILE・PR・ADDED_AT・LABEL・REASONS（JSON）・APPLY_RESULT・STALE（JSON）
 *      SLACK_WEBHOOK_URL（Environment prod-jobs）・GITHUB_TOKEN（PR のコメントだけ）・GITHUB_REPOSITORY
 */
import { buildNotifyMessage } from "../lib/dbReconcile.js";

function fail(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}

function parseList(name) {
  const raw = process.env[name];
  if (!raw) return [];
  try {
    const value = JSON.parse(raw);
    if (Array.isArray(value) && value.every((v) => typeof v === "string"))
      return value;
  } catch {
    // 下で止める
  }
  fail(`${name} が文字列の配列の JSON でない`);
}

async function main() {
  const message = buildNotifyMessage({
    dryRun: process.env.DB_APPLY_DRY_RUN !== "false",
    status: process.env.STATUS ?? "",
    file: process.env.FILE ?? "",
    pr: process.env.PR ?? "",
    addedAt: process.env.ADDED_AT || null,
    label: process.env.LABEL ?? "",
    reasons: parseList("REASONS"),
    applyResult: process.env.APPLY_RESULT ?? "",
    stale: parseList("STALE"),
    now: new Date(),
  });
  if (!message) {
    console.log("知らせることは無い");
    return;
  }
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

  const pr = process.env.PR ?? "";
  const repo = process.env.GITHUB_REPOSITORY ?? "";
  if (/^\d+$/.test(pr) && /^[\w.-]+\/[\w.-]+$/.test(repo) && process.env.FILE) {
    const res = await fetch(
      `https://api.github.com/repos/${repo}/issues/${pr}/comments`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ body: message }),
      },
    );
    if (!res.ok) fail(`PR #${pr} へのコメントが ${res.status} を返した`);
  }
}

main().catch((err) => fail(`通知に失敗: ${err.message}`));
