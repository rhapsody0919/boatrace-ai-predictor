#!/usr/bin/env node
/**
 * 夜の content-ops-nightly-check で、Linear の起票の失敗が理由つきで Slack に届くことを機械検査する。
 *
 * ## なぜ
 *
 * - check-revision-escalation.js は GraphQL の errors の message だけを例外にし、HTTP 400 では
 *   本文を読まずに捨てていた。無料枠の上限（USAGE_LIMIT_EXCEEDED）で失敗しても理由が分からない
 * - content-ops-nightly-check.yml の Slack 通知は if に暗黙の success() が付き、前のステップが
 *   失敗するとスキップされた。2026-09-11〜19 の失敗（401）は9晩とも Slack に出ず、
 *   その晩の滞留の通知も一緒に消えた（2026-10-18 調査）
 *
 * ## どう検査するか
 *
 * 1. ローカルに模擬サーバーを立て、LINEAR_API_URL をそこへ向けて graphqlRequest を呼ぶ。
 *    HTTP 400・200 のどちらの USAGE_LIMIT_EXCEEDED でも、例外のメッセージにコードが入ること
 * 2. ワークフローの各ステップを読み、エスカレーションのステップに id があり、
 *    通知のステップが always() 付きで、失敗時の通知がそのステップの失敗を条件にしていること
 */

import http from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const WORKFLOW = path.join(
  ROOT,
  ".github/workflows/content-ops-nightly-check.yml",
);

function startMock(status) {
  const server = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          errors: [
            {
              message:
                "You've exceeded the free issue limit for this workspace",
              extensions: { code: "USAGE_LIMIT_EXCEEDED" },
            },
          ],
        }),
      );
    });
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve({
        server,
        url: `http://127.0.0.1:${server.address().port}/graphql`,
      }),
    ),
  );
}

async function errorMessageFor(status) {
  const { server, url } = await startMock(status);
  try {
    // LINEAR_API_URL はモジュールの読み込み時に読むため、先に設定してから毎回読み直す
    process.env.LINEAR_API_URL = url;
    const mod = await import(
      `./content-ops-checks/check-revision-escalation.js?status=${status}`
    );
    await mod.graphqlRequest("test-key", "query { viewer { id } }", {});
    return null;
  } catch (error) {
    return error.message;
  } finally {
    server.close();
  }
}

/** ワークフローの steps を「- name:」単位の文字列に分ける */
function workflowSteps() {
  const text = readFileSync(WORKFLOW, "utf-8");
  return text
    .split(/\n(?= {6}- )/)
    .slice(1)
    .map((block) => ({
      name: (block.match(/name:\s*(.+)/) || [])[1]?.trim() ?? "",
      block,
    }));
}

function stepIf(step) {
  return (step.block.match(/^\s+if:\s*(.+)$/m) || [])[1]?.trim() ?? "";
}

const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok, detail });

for (const status of [400, 200]) {
  const message = await errorMessageFor(status);
  check(
    `graphqlRequest: HTTP ${status} の USAGE_LIMIT_EXCEEDED で、例外のメッセージにエラーコードが入る`,
    message !== null && message.includes("USAGE_LIMIT_EXCEEDED"),
    `message=${message}`,
  );
}

const steps = workflowSteps();
const escalation = steps.find((s) =>
  s.block.includes("check-revision-escalation.js"),
);
const escalationId = (escalation?.block.match(/^\s+id:\s*(\S+)/m) || [])[1];
check(
  "ワークフロー: エスカレーションのステップに id がある",
  Boolean(escalationId),
);

const notifySteps = steps.filter((s) => s.block.includes("SLACK_WEBHOOK_URL"));
check(
  "ワークフロー: Slack 通知のステップが2つ以上ある（滞留・エスカレーションの失敗）",
  notifySteps.length >= 2,
  `found=${notifySteps.map((s) => s.name).join(", ")}`,
);
for (const step of notifySteps) {
  check(
    `ワークフロー: 「${step.name}」の if が always() で始まる（前のステップの失敗でスキップされない）`,
    /^always\(\)/.test(stepIf(step)),
    `if=${stepIf(step)}`,
  );
}
check(
  "ワークフロー: エスカレーションの失敗を条件にした通知があり、失敗の理由を送る",
  Boolean(escalationId) &&
    notifySteps.some(
      (s) =>
        stepIf(s).includes(`steps.${escalationId}.outcome == 'failure'`) &&
        s.block.includes(`steps.${escalationId}.outputs.error`),
    ),
);

let failed = 0;
for (const r of results) {
  console.log(
    `${r.ok ? "OK  " : "FAIL"} ${r.name}${r.ok ? "" : `\n     ${r.detail}`}`,
  );
  if (!r.ok) failed++;
}
if (failed > 0) {
  console.error(`\n❌ ${failed}件失敗`);
  process.exit(1);
}
console.log(`\n✅ ${results.length}件すべて通過`);
