/**
 * SNS ハブ管理画面の「制作仕様の変更要望」で、Linear の起票が失敗したときに理由が分かり、
 * 入力した本文が消えないことを機械検査する。
 *
 * ## なぜ
 *
 * 2026-10-18 の調査で、Linear の無料枠の上限（USAGE_LIMIT_EXCEEDED）で起票が失敗すると、
 * request-spec-change.js が汎用の 500 を返し、画面は「処理を完了できませんでした…」だけを出して
 * 入力欄を閉じていた。上限が原因だと分からず、要望の本文もどこにも残らなかった。
 *
 * ## どう検査するか
 *
 * 1. fetch を差し替えて Supabase と Linear を模し、ハンドラーを直接呼ぶ。HTTP 400・200 の
 *    USAGE_LIMIT_EXCEEDED で、502 と code=LINEAR_USAGE_LIMIT_EXCEEDED が返ること
 * 2. specChangeFeedback（画面の通知と「入力欄を閉じてよいか」の判定）が、失敗では閉じないこと
 *
 * 入力欄が実際に残ることは e2e/sns-hub-spec-change.spec.js で見る。実 env・ネットワークは使わない。
 */

import test from "node:test";
import assert from "node:assert/strict";

for (const name of [
  "SUPABASE_SERVICE_KEY",
  "SNS_HUB_BASIC_AUTH_USER",
  "SNS_HUB_BASIC_AUTH_PASSWORD",
  "LINEAR_API_KEY",
  "LINEAR_TEAM_ID",
])
  process.env[name] = "mock";
process.env.SUPABASE_URL = "https://mock.invalid";
process.env.LINEAR_API_URL = "https://linear.mock.invalid/graphql";
// 起票を止めたときの通知は、実の Slack に送らずログだけにする
delete process.env.SLACK_WEBHOOK_URL;
delete process.env.SLACK_DIGEST_WEBHOOK_URL;

const { default: handler } =
  await import("../../api/admin/sns-hub/drafts/[id]/request-spec-change.js");
const { specChangeFeedback } =
  await import("../../src/pages/admin/sns-hub/specChangeFeedback.js");

const id = "00000000-0000-4000-8000-000000000001";

function request() {
  return new Request(
    `https://local.invalid/api/admin/sns-hub/drafts/${id}/request-spec-change`,
    {
      method: "POST",
      headers: {
        authorization: `Basic ${btoa("mock:mock")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        approverId: "a1",
        message: "BGMを軽快にしてほしい",
      }),
    },
  );
}

/** Supabase は下書きを返し、Linear は指定の応答を返す fetch に差し替える */
async function withMockFetch(linearReply, fn, { activeCount = 10 } = {}) {
  const original = globalThis.fetch;
  const linearCalls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const json = (data, status = 200) =>
      new Response(JSON.stringify(data), { status });
    if (u.hostname === "mock.invalid" && u.pathname === "/rest/v1/sns_drafts")
      return json([{ id, platform: "x", content_group_id: "g1" }]);
    if (u.hostname === "linear.mock.invalid") {
      const { query } = JSON.parse(init.body);
      linearCalls.push(query);
      // 起票の前の未アーカイブ件数（scripts/lib/linearIssueGate.js）
      if (/CountActiveIssues/.test(query))
        return json({
          data: {
            issues: {
              nodes: Array.from({ length: activeCount }, (_, i) => ({
                id: `a${i}`,
              })),
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        });
      if (/team\(id/.test(query))
        return json({ data: { team: { labels: { nodes: [] } } } });
      return linearReply(json);
    }
    throw new Error(`想定外の fetch: ${url}`);
  };
  try {
    return await fn(linearCalls);
  } finally {
    globalThis.fetch = original;
  }
}

const usageLimit = (status) => (json) =>
  json(
    {
      errors: [
        {
          message: "You've exceeded the free issue limit for this workspace",
          extensions: { code: "USAGE_LIMIT_EXCEEDED" },
        },
      ],
    },
    status,
  );

for (const status of [400, 200]) {
  test(`Linear が HTTP ${status} で USAGE_LIMIT_EXCEEDED を返したら、502 と上限のコードを返す`, async () => {
    await withMockFetch(usageLimit(status), async () => {
      const res = await handler(request());
      const body = await res.json();
      assert.equal(res.status, 502);
      assert.equal(body.code, "LINEAR_USAGE_LIMIT_EXCEEDED");
      assert.match(body.error, /無料枠の上限/);
    });
  });
}

test("Linear のほかのエラーは、コードを付けて LINEAR_ERROR を返す", async () => {
  await withMockFetch(
    (json) =>
      json({ errors: [{ message: "x", extensions: { code: "INTERNAL" } }] }),
    async () => {
      const res = await handler(request());
      const body = await res.json();
      assert.equal(res.status, 502);
      assert.equal(body.code, "LINEAR_ERROR");
      assert.match(body.error, /INTERNAL/);
    },
  );
});

test("起票できたら 200 で URL を返す", async () => {
  await withMockFetch(
    (json) =>
      json({
        data: {
          issueCreate: {
            success: true,
            issue: { id: "i", identifier: "BOA-1", title: "t", url: "u" },
          },
        },
      }),
    async () => {
      const res = await handler(request());
      const body = await res.json();
      assert.equal(res.status, 200);
      assert.equal(body.issue.url, "u");
    },
  );
});

test("未アーカイブが閾値の200件なら起票せず、503 と LINEAR_ISSUE_GATE_BLOCKED を返す", async () => {
  await withMockFetch(
    () => {
      throw new Error("起票の mutation が呼ばれた");
    },
    async (linearCalls) => {
      const res = await handler(request());
      const body = await res.json();
      assert.equal(res.status, 503);
      assert.equal(body.code, "LINEAR_ISSUE_GATE_BLOCKED");
      assert.match(body.error, /未アーカイブ 200 件/);
      assert.ok(!linearCalls.some((q) => /issueCreate/.test(q)));
    },
    { activeCount: 200 },
  );
});

test("specChangeFeedback: 閾値で止めたら閉じず、件数の文と本文を残したことを伝える（取得の経路 request() を通す。代わりの審査の P1）", async () => {
  const { requestSpecChange } = await import("../../src/services/snsHubService.js");
  const saved = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        error:
          "Linear の起票を止めました: 未アーカイブ 200 件が閾値 200 件以上です（無料枠の上限 250 件）。完了・取り消しのチケットをアーカイブしてから起票し直してください",
        code: "LINEAR_ISSUE_GATE_BLOCKED",
      }),
      { status: 503, headers: { "Content-Type": "application/json" } },
    );
  let error;
  try {
    await requestSpecChange("d1", { approverId: "a1", message: "本文" });
  } catch (e) {
    error = e;
  } finally {
    globalThis.fetch = saved;
  }
  const f = specChangeFeedback({ error });
  assert.doesNotMatch(f.message, /。。/);
  assert.doesNotMatch(f.message, /再読み込み/);
  assert.equal(f.closePanel, false);
  assert.equal(f.type, "error");
  assert.match(f.message, /未アーカイブ 200 件/);
  assert.match(f.message, /欄に残して/);
});

test("specChangeFeedback: 上限なら閉じず、上限と本文を残したことを伝える", () => {
  const f = specChangeFeedback({
    error: { code: "LINEAR_USAGE_LIMIT_EXCEEDED", message: "汎用" },
  });
  assert.equal(f.closePanel, false);
  assert.equal(f.type, "error");
  assert.match(f.message, /無料枠の上限/);
  assert.match(f.message, /欄に残して/);
});

test("specChangeFeedback: ほかの失敗・起票のスキップでも閉じない", () => {
  assert.equal(
    specChangeFeedback({ error: { code: "LINEAR_ERROR" } }).closePanel,
    false,
  );
  assert.equal(
    specChangeFeedback({ error: new Error("network") }).closePanel,
    false,
  );
  assert.equal(
    specChangeFeedback({
      result: { issue: { created: false, reason: "not_configured" } },
    }).closePanel,
    false,
  );
});

test("specChangeFeedback: 起票できたら閉じる", () => {
  const f = specChangeFeedback({ result: { issue: { created: true } } });
  assert.equal(f.closePanel, true);
  assert.equal(f.type, "success");
});
