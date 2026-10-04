#!/usr/bin/env node
/**
 * scripts/linear-cli.js の失敗の扱いと、完了時のアーカイブを機械検査する。
 *
 * ## なぜ
 *
 * - 2026-09-28、Linear の無料枠の上限（USAGE_LIMIT_EXCEEDED）で create が失敗したのに、
 *   起票できたと思って進みかけた。失敗が終了コードで分からないと、パイプや tail 越しでは気づけない
 * - 2026-10-02、完了したチケットはアーカイブする運用に決めた（無料枠の上限はアーカイブして
 *   いないチケット数で数えられる）。update で状態の種類（state.type）が完了・取り消しに
 *   変わったら、続けて issueArchive を呼ぶ
 *
 * ## どう検査するか
 *
 * ローカルに Linear API の模擬サーバーを立て、LINEAR_API_URL をそこへ向けて CLI を実際に
 * 起動する。終了コードと、模擬サーバーに届いた操作（mutation）の順序を見る。外部ネットワーク・
 * 実 Linear には触れない。
 */

import http from "node:http";
import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CLI = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../linear-cli.js",
);

const STATES = [
  { id: "s-todo", name: "Todo", type: "unstarted" },
  { id: "s-prog", name: "In Progress", type: "started" },
  { id: "s-done", name: "Done", type: "completed" },
  { id: "s-cancel", name: "Canceled", type: "canceled" },
  { id: "s-dup", name: "Duplicate", type: "canceled" },
];

/** シナリオごとに応答を変える模擬サーバー。届いた操作を calls に積む */
function startMock() {
  const state = { scenario: {}, calls: [] };
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const { query, variables } = JSON.parse(body);
      const reply = (status, payload) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
      };
      const op =
        (query.match(/\b(mutation|query)\s+(\w+)/) || [])[2] ?? "viewer";
      state.calls.push(op);

      if (/viewer/.test(query)) {
        return reply(200, {
          data: {
            viewer: {
              id: "u1",
              name: "test",
              teams: { nodes: [{ id: "t1", key: "BOA", name: "boat" }] },
            },
          },
        });
      }
      if (op === "GetStates") {
        return reply(200, { data: { workflowStates: { nodes: STATES } } });
      }
      if (op === "GetIssue") {
        return reply(200, {
          data: {
            issues: {
              nodes: [
                {
                  id: "i1",
                  identifier: "BOA-1",
                  title: "t",
                  description: "",
                  state: { id: "s-todo", name: "Todo" },
                  createdAt: "2026-10-01T00:00:00Z",
                  updatedAt: "2026-10-01T00:00:00Z",
                  url: "u",
                },
              ],
            },
          },
        });
      }
      if (op === "UpdateIssue") {
        const s = STATES.find((x) => x.id === variables.input.stateId);
        return reply(200, {
          data: {
            issueUpdate: {
              success: true,
              issue: {
                id: "i1",
                identifier: "BOA-1",
                title: "t",
                state: { name: s.name, type: s.type },
              },
            },
          },
        });
      }
      if (op === "CreateComment") {
        return reply(200, {
          data: {
            commentCreate: {
              success: state.scenario.commentFails !== true,
              comment: { id: "c1", body: "b" },
            },
          },
        });
      }
      if (op === "ArchiveIssue") {
        if (state.scenario.archive === "graphqlError") {
          return reply(200, {
            errors: [{ message: "boom", extensions: { code: "INTERNAL" } }],
          });
        }
        return reply(200, {
          data: {
            issueArchive: { success: state.scenario.archive !== "fail" },
          },
        });
      }
      if (op === "CreateIssue") {
        if (state.scenario.create === "usageLimit") {
          // 2026-09-28 に実際に返った形（HTTP 400 と 200 の両方を試す）
          return reply(state.scenario.status ?? 400, {
            errors: [
              {
                message:
                  "You've exceeded the free issue limit for this workspace",
                extensions: { code: "USAGE_LIMIT_EXCEEDED" },
              },
            ],
          });
        }
        return reply(200, {
          data: {
            issueCreate: {
              success: true,
              issue: {
                id: "i2",
                identifier: "BOA-2",
                title: variables.input.title,
                description: "",
                state: { name: "Todo" },
                url: "u",
              },
            },
          },
        });
      }
      return reply(400, { errors: [{ message: `unknown op ${op}` }] });
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () =>
      resolve({
        server,
        state,
        url: `http://127.0.0.1:${server.address().port}/graphql`,
      }),
    );
  });
}

function runCli(url, args) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [CLI, ...args],
      {
        env: {
          ...process.env,
          LINEAR_API_KEY: "test-key",
          LINEAR_API_URL: url,
        },
        timeout: 30000,
      },
      (error, stdout, stderr) =>
        resolve({ code: error ? (error.code ?? 1) : 0, stdout, stderr }),
    );
  });
}

const CASES = [
  {
    name: "create: 無料枠の上限（HTTP 400）なら終了コード1で、エラーコードを出す",
    scenario: { create: "usageLimit", status: 400 },
    args: ["create", "タイトル", "説明"],
    expect: ({ code, stderr }) =>
      code !== 0 && stderr.includes("USAGE_LIMIT_EXCEEDED"),
  },
  {
    name: "create: 無料枠の上限（HTTP 200 で errors）でも終了コード1",
    scenario: { create: "usageLimit", status: 200 },
    args: ["create", "タイトル", "説明"],
    expect: ({ code, stderr }) =>
      code !== 0 && stderr.includes("USAGE_LIMIT_EXCEEDED"),
  },
  {
    name: "create: 成功なら終了コード0",
    scenario: {},
    args: ["create", "タイトル", "説明"],
    expect: ({ code, stdout }) => code === 0 && stdout.includes("BOA-2"),
  },
  {
    name: "update Done＋コメント: 状態変更 → コメント → アーカイブの順で呼び、終了コード0",
    scenario: {},
    args: ["update", "BOA-1", "Done", "PR #1 でマージ済み"],
    expect: ({ code }, calls) => {
      const order = calls.filter((c) =>
        ["UpdateIssue", "CreateComment", "ArchiveIssue"].includes(c),
      );
      return (
        code === 0 &&
        JSON.stringify(order) ===
          JSON.stringify(["UpdateIssue", "CreateComment", "ArchiveIssue"])
      );
    },
  },
  {
    name: "update In Progress: アーカイブしない",
    scenario: {},
    args: ["update", "BOA-1", "In Progress"],
    expect: ({ code }, calls) => code === 0 && !calls.includes("ArchiveIssue"),
  },
  {
    name: "update Duplicate（種類は canceled）: 名前でなく種類で判定してアーカイブする",
    scenario: {},
    args: ["update", "BOA-1", "Duplicate"],
    expect: ({ code }, calls) => code === 0 && calls.includes("ArchiveIssue"),
  },
  {
    name: "update Done: アーカイブが success:false なら終了コード1",
    scenario: { archive: "fail" },
    args: ["update", "BOA-1", "Done"],
    expect: ({ code, stderr }) => code !== 0 && stderr.includes("アーカイブ"),
  },
  {
    name: "update Done: アーカイブが GraphQL エラーなら終了コード1",
    scenario: { archive: "graphqlError" },
    args: ["update", "BOA-1", "Done"],
    expect: ({ code, stderr }) => code !== 0 && stderr.includes("INTERNAL"),
  },
  {
    name: "update: コメントの追加に失敗したら終了コード1（以前は0のまま続けていた）",
    scenario: { commentFails: true },
    args: ["update", "BOA-1", "In Progress", "コメント"],
    expect: ({ code }) => code !== 0,
  },
];

async function main() {
  const mock = await startMock();
  const failures = [];
  try {
    for (const c of CASES) {
      mock.state.scenario = c.scenario;
      mock.state.calls = [];
      const result = await runCli(mock.url, c.args);
      if (!c.expect(result, mock.state.calls)) {
        failures.push(
          `${c.name}\n      終了コード=${result.code} 操作=${mock.state.calls.join(",")}\n      stderr=${result.stderr.trim().slice(0, 300)}`,
        );
      }
    }
  } finally {
    mock.server.close();
  }
  if (failures.length > 0) {
    console.error("NG: linear-cli.js の失敗の扱い・アーカイブ");
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(
    `OK: linear-cli.js の失敗の扱い・完了時のアーカイブ（${CASES.length}ケース）`,
  );
}

main().catch((error) => {
  console.error("verify-linear-cli.js の実行に失敗:", error);
  process.exit(1);
});
