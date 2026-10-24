/**
 * Linear の起票の前の関所（scripts/lib/linearIssueGate.js）と、起票の全経路がそれを通ることを機械検査する。
 *
 * ## なぜ
 *
 * オーナーは Linear の無料プラン（未アーカイブ250件まで）に留まると決めた（hq 台帳 PL48、2026-10-20）。
 * 2026-09-28 に上限で起票が止まり、2026-10-18 時点で 228/250。起票の経路ごとに数えると数字と
 * 止め方がばらつくので、数える場所を1か所にし、230件以上・数えられないときは Slack に知らせて止める。
 *
 * ## どう検査するか
 *
 * - 関所の関数: 偽の request・notify を渡す（ネットワークを使わない）
 * - 各経路（check-revision-escalation.js・create-vup-linear-ticket.js）:
 *   globalThis.fetch を差し替え、230件なら issueCreate を送らないこと、229件なら送ること
 * - scripts/linear-cli.js は CLI なので verify-linear-cli.js が模擬サーバーで同じことを見る
 * - 抜け道の検知: api/・scripts/・src/ で issueCreate を送るファイルが、すべて関所を読み込んでいること
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertCanCreateIssue,
  countActiveIssues,
  issueGateDecision,
  LinearIssueGateError,
  LINEAR_ISSUE_GATE_CODE,
  slackNotifierFromEnv,
} from "../lib/linearIssueGate.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");

// 起票の経路が読む環境変数。実の Slack・Linear に向かないよう固定する
process.env.LINEAR_API_KEY = "test-key";
process.env.LINEAR_TEAM_ID = "t1";
process.env.LINEAR_API_URL = "https://linear.mock.invalid/graphql";
delete process.env.SLACK_WEBHOOK_URL;
delete process.env.SLACK_DIGEST_WEBHOOK_URL;

/** n 件を1ページで返す、件数の問い合わせの応答 */
function countPage(n, { hasNextPage = false, endCursor = null } = {}) {
  return {
    issues: {
      nodes: Array.from({ length: n }, (_, i) => ({ id: `a${i}` })),
      pageInfo: { hasNextPage, endCursor },
    },
  };
}

function recorder() {
  const calls = [];
  const notify = async (text) => {
    calls.push(text);
  };
  return { calls, notify };
}

// ---- 関所の関数 ----

test("issueGateDecision: 229件は起票してよく、230件は止める（文に件数・閾値・上限が入る）", () => {
  assert.deepEqual(issueGateDecision({ count: 229 }), {
    allowed: true,
    message: null,
  });
  const blocked = issueGateDecision({ count: 230 });
  assert.equal(blocked.allowed, false);
  assert.match(blocked.message, /未アーカイブ 230 件/);
  assert.match(blocked.message, /閾値 230 件/);
  assert.match(blocked.message, /上限 250 件/);
  assert.equal(issueGateDecision({ count: 230 }).allowed, false);
});

test("countActiveIssues: ページ送りで全件を数え、2ページ目に前のカーソルを渡す", async () => {
  const seen = [];
  const request = async (query, variables) => {
    assert.match(query, /CountActiveIssues/);
    seen.push(variables.after);
    return variables.after === null
      ? countPage(250, { hasNextPage: true, endCursor: "c1" })
      : countPage(30);
  };
  assert.equal(await countActiveIssues(request), 280);
  assert.deepEqual(seen, [null, "c1"]);
});

test("countActiveIssues: 応答の形が不正なら例外", async () => {
  await assert.rejects(
    countActiveIssues(async () => ({ issues: null })),
    /応答の形が不正/,
  );
});

test("assertCanCreateIssue: 閾値の下なら件数を返し、通知しない", async () => {
  const { calls, notify } = recorder();
  const count = await assertCanCreateIssue({
    request: async () => countPage(229),
    notify,
    source: "test",
  });
  assert.equal(count, 229);
  assert.equal(calls.length, 0);
});

test("assertCanCreateIssue: 230件以上なら通知してから LinearIssueGateError を投げる", async () => {
  const { calls, notify } = recorder();
  await assert.rejects(
    assertCanCreateIssue({
      request: async () => countPage(233),
      notify,
      source: "test",
    }),
    (error) =>
      error instanceof LinearIssueGateError &&
      error.code === LINEAR_ISSUE_GATE_CODE &&
      error.count === 233 &&
      error.threshold === 230,
  );
  assert.equal(calls.length, 1);
  assert.match(calls[0], /^\[test\]/);
  assert.match(calls[0], /未アーカイブ 233 件/);
  assert.match(calls[0], /閾値 230 件/);
});

test("assertCanCreateIssue: 数えられないときは止める（fail closed）、通知に理由が入る", async () => {
  const { calls, notify } = recorder();
  await assert.rejects(
    assertCanCreateIssue({
      request: async () => {
        throw new Error("HTTP 500");
      },
      notify,
      source: "test",
    }),
    (error) => error.code === LINEAR_ISSUE_GATE_CODE && error.count === null,
  );
  assert.equal(calls.length, 1);
  assert.match(calls[0], /数えられません（HTTP 500）/);
});

test("assertCanCreateIssue: 通知が失敗しても止める（通知の失敗で起票が通らない）", async () => {
  await assert.rejects(
    assertCanCreateIssue({
      request: async () => countPage(230),
      notify: async () => {
        throw new Error("Slack down");
      },
      source: "test",
    }),
    LinearIssueGateError,
  );
});

test("slackNotifierFromEnv: SLACK_WEBHOOK_URL を優先し、無ければ SLACK_DIGEST_WEBHOOK_URL、どちらも無ければ送らない", async () => {
  const posted = [];
  const fakeFetch = async (url, init) => {
    posted.push({ url, text: JSON.parse(init.body).text });
    return new Response("ok", { status: 200 });
  };
  await slackNotifierFromEnv(
    { SLACK_WEBHOOK_URL: "https://a", SLACK_DIGEST_WEBHOOK_URL: "https://b" },
    fakeFetch,
  )("止めた");
  await slackNotifierFromEnv(
    { SLACK_DIGEST_WEBHOOK_URL: "https://b" },
    fakeFetch,
  )("止めた");
  await slackNotifierFromEnv({}, fakeFetch)("止めた");
  assert.deepEqual(
    posted.map((p) => p.url),
    ["https://a", "https://b"],
  );
  assert.match(posted[0].text, /止めた/);
  await assert.rejects(
    slackNotifierFromEnv(
      { SLACK_WEBHOOK_URL: "https://a" },
      async () => new Response("x", { status: 500 }),
    )("止めた"),
    /HTTP 500/,
  );
});

// ---- 各経路が関所を通ること ----

/** Linear の GraphQL を模す fetch に差し替える。届いたクエリを返す */
async function withLinearFetch(activeCount, fn) {
  const original = globalThis.fetch;
  const queries = [];
  globalThis.fetch = async (url, init = {}) => {
    const { query } = JSON.parse(init.body);
    queries.push(query);
    const json = (data) =>
      new Response(JSON.stringify({ data }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    if (/CountActiveIssues/.test(query)) return json(countPage(activeCount));
    if (/OpenEscalations/.test(query)) return json({ issues: { nodes: [] } });
    if (/viewer/.test(query))
      return json({ viewer: { teams: { nodes: [{ id: "t1" }] } } });
    if (/labels/.test(query)) return json({ team: { labels: { nodes: [] } } });
    if (/issueCreate/.test(query))
      return json({
        issueCreate: {
          success: true,
          issue: { id: "i", identifier: "BOA-1", title: "t", url: "u" },
        },
      });
    throw new Error(`想定外のクエリ: ${query.slice(0, 80)}`);
  };
  try {
    await fn();
  } finally {
    globalThis.fetch = original;
  }
  return queries;
}

const sentCreate = (queries) => queries.some((q) => /issueCreate/.test(q));

const PATHS = [
  {
    name: "check-revision-escalation.js の createEscalationIssue",
    run: async () => {
      const { createEscalationIssue } =
        await import("./content-ops-checks/check-revision-escalation.js");
      return createEscalationIssue("test-key", {
        teamId: "t1",
        labelId: null,
        title: "t",
        description: "d",
      });
    },
  },
  {
    name: "create-vup-linear-ticket.js の createVupLinearTicket",
    run: async () => {
      const { createVupLinearTicket } =
        await import("../analysis/create-vup-linear-ticket.js");
      return createVupLinearTicket({ title: "t", description: "d" });
    },
  },
];

for (const p of PATHS) {
  test(`${p.name}: 230件なら issueCreate を送らず LinearIssueGateError`, async () => {
    let error = null;
    const queries = await withLinearFetch(230, async () => {
      try {
        await p.run();
      } catch (e) {
        error = e;
      }
    });
    assert.equal(error?.code, LINEAR_ISSUE_GATE_CODE);
    assert.equal(sentCreate(queries), false);
  });

  test(`${p.name}: 229件なら件数を数えてから issueCreate を送る`, async () => {
    const queries = await withLinearFetch(229, p.run);
    const countAt = queries.findIndex((q) => /CountActiveIssues/.test(q));
    const createAt = queries.findIndex((q) => /issueCreate/.test(q));
    assert.ok(countAt >= 0 && createAt > countAt, "数えてから起票する");
  });
}

test("夜間のジョブ（checkRevisionEscalation）: 関所が止めたら保留（例外にしない）で終わり、記録に残さず、その晩の残りは数えない", async () => {
  const { checkRevisionEscalation } =
    await import("./content-ops-checks/check-revision-escalation.js");
  const revision = (platform, code) => ({
    platform,
    revisionReasonCodes: [code],
    title: "t",
    revisionReasonFreetext: null,
  });
  const saved = [];
  const env = {
    key: process.env.LINEAR_API_KEY,
    team: process.env.LINEAR_TEAM_ID,
  };
  process.env.LINEAR_API_KEY = "test-key";
  process.env.LINEAR_TEAM_ID = "t1";
  let result;
  let queries;
  try {
    queries = await withLinearFetch(230, async () => {
      result = await checkRevisionEscalation({
        threshold: 2,
        loadRevisions: async () => [
          revision("x", "tone"),
          revision("x", "tone"),
          revision("youtube", "length"),
          revision("youtube", "length"),
        ],
        loadHistory: async () => ({ escalated: {} }),
        saveHistory: async (h) => saved.push(structuredClone(h)),
      });
    });
  } finally {
    if (env.key === undefined) delete process.env.LINEAR_API_KEY;
    else process.env.LINEAR_API_KEY = env.key;
    if (env.team === undefined) delete process.env.LINEAR_TEAM_ID;
    else process.env.LINEAR_TEAM_ID = env.team;
  }
  assert.equal(sentCreate(queries), false);
  assert.match(result.held.reason, /230/);
  assert.deepEqual(result.escalated, []);
  // 次の晩にもう一度数えるため、記録には残さない
  assert.deepEqual(saved, [{ escalated: {} }]);
  // 2つの組み合わせが閾値を超えていても、関所の件数の問い合わせ（＝Slack の通知）は1晩1回
  assert.equal(queries.filter((q) => /CountActiveIssues/.test(q)).length, 1);
});

// ---- 抜け道の検知 ----

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    if (name === "node_modules" || name.startsWith(".")) return [];
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(m?js|jsx)$/.test(name) ? [full] : [];
  });
}

test("issueCreate を送るファイルは、すべて linearIssueGate を読み込む（検査ファイルを除く）", () => {
  const offenders = ["api", "scripts", "src"]
    .flatMap((d) => walk(path.join(ROOT, d)))
    .filter((f) => !/\/scripts\/maintenance\/verify-[^/]+$/.test(f))
    .filter((f) => !f.endsWith("scripts/lib/linearIssueGate.js"))
    .filter((f) => /\bissueCreate\s*\(/.test(readFileSync(f, "utf-8")))
    .filter((f) => !/linearIssueGate\.js/.test(readFileSync(f, "utf-8")))
    .map((f) => path.relative(ROOT, f));
  assert.deepEqual(
    offenders,
    [],
    `起票の関所を通らない経路: ${offenders.join(", ")}`,
  );
});
