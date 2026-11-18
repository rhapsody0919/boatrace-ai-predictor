import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { actionFeedback } from "../../src/pages/admin/sns-hub/actionFeedback.js";
import {
  closeSharedDb,
  fixture,
  headSha,
  id,
} from "./verifyData/sns-existing-fixes-fixture.js";

// 固定ダミー設定のみ。実envファイル/ネットワークは一切使用しない。
for (const name of [
  "SUPABASE_SERVICE_KEY",
  "SNS_HUB_BASIC_AUTH_USER",
  "SNS_HUB_BASIC_AUTH_PASSWORD",
  "YOUTUBE_CLIENT_ID",
  "YOUTUBE_CLIENT_SECRET",
  "YOUTUBE_REFRESH_TOKEN",
  "GITHUB_MERGE_TOKEN",
])
  process.env[name] = "mock";
process.env.SUPABASE_URL = "https://mock.invalid";
process.env.SNS_YOUTUBE_ROUTINE_FIRE_URL = "";
process.env.SNS_YOUTUBE_ROUTINE_FIRE_TOKEN = "";
const { default: youtube } =
  await import("../../api/admin/sns-hub/drafts/[id]/publish-youtube.js");
const { default: blog } =
  await import("../../api/admin/sns-hub/drafts/[id]/merge-blog-pr.js");
const root = new URL("../../", import.meta.url);
const approveSource = (
  await readFile(
    new URL("api/admin/sns-hub/drafts/[id]/approve.js", root),
    "utf8",
  )
)
  .replace(
    /"[^"\n]+risk-rules\.json"/,
    JSON.stringify(
      "data:text/javascript," +
        encodeURIComponent("export default {rules:[]};"),
    ),
  )
  .replace(
    /"[^"\n]+(?:lib\/riskRuleMatcher|_lib\/snsBundleValidation|_lib\/snsHubHelpers|_lib\/adminAuth)\.js"/g,
    (m) =>
      JSON.stringify(
        new URL(m.slice(1, -1), new URL("api/admin/sns-hub/drafts/[id]/", root))
          .href,
      ),
  );
const { default: approve } = await import(
  "data:text/javascript," + encodeURIComponent(approveSource)
);
const { default: preview } =
  await import("../../api/admin/sns-hub/drafts/[id]/blog-pr-preview.js");
const { default: archiveDraft } =
  await import("../../api/admin/sns-hub/drafts/[id]/archive.js");
const { default: markPosted } =
  await import("../../api/admin/sns-hub/drafts/[id]/mark-posted.js");
const approverId = "00000000-0000-4000-8000-000000000002";
function request(action, body = {}, auth = true) {
  return new Request(
    `https://local.invalid/api/admin/sns-hub/drafts/${id}/${action}`,
    {
      method: action === "blog-pr-preview" ? "GET" : "POST",
      headers: auth
        ? {
            authorization: `Basic ${btoa("mock:mock")}`,
            "Content-Type": "application/json",
          }
        : {},
      ...(action !== "blog-pr-preview" && {
        body: JSON.stringify({ approverId, ...body }),
      }),
    },
  );
}
after(closeSharedDb);

test("同時YouTube承認は1回だけアップロードする", async () => {
  const f = await fixture();
  try {
    const results = await Promise.all([
      youtube(request("publish-youtube")),
      youtube(request("publish-youtube")),
    ]);
    assert.ok(results.some((r) => r.status === 200));
    assert.equal(f.counts().uploads, 1);
    assert.equal((await f.row()).status, "posted");
  } finally {
    await f.close();
  }
});

// 作り直し（redo）の口は SH01 R2 で消した。同時の承認2回で条件付き更新を確かめる
test("同時の通常承認は条件付き更新で片方のみ成功する", async () => {
  const f = await fixture();
  try {
    const results = await Promise.all([
      approve(request("approve")),
      approve(request("approve")),
    ]);
    assert.equal(results.filter((r) => r.status === 200).length, 1);
    assert.equal((await f.row()).status, "approved");
  } finally {
    await f.close();
  }
});

// blog（merge-blog-pr）は 2026-10-20 に停止した（ADR-0097、BOA-908）。停止の検査は下の「停止した merge-blog-pr」
for (const platform of ["youtube"]) {
  for (const failRpc of ["sns_record_external", "sns_finish_external"]) {
    test(`${platform}: 外部成功後${failRpc}失敗でも再送しない`, async () => {
      const f = await fixture(platform, { failRpc });
      try {
        const handler = youtube;
        const action = "publish-youtube";
        assert.equal((await handler(request(action, { headSha }))).status, 500);
        const row = await f.row();
        assert.equal(
          row.external_operation_state,
          failRpc === "sns_record_external" ? "reconcile" : "external_done",
        );
        if (failRpc === "sns_finish_external")
          assert.ok(row.external_operation_result.source_data);
        const retry = await handler(request(action, { headSha }));
        assert.equal(
          retry.status,
          failRpc === "sns_record_external" ? 409 : 200,
        );
        assert.equal(f.counts().uploads, 1);
        if (retry.status === 200)
          assert.equal((await f.row()).status, "posted");
      } finally {
        await f.close();
      }
    });
  }
}

test("YouTube応答消失とclaim応答消失は再送しない", async () => {
  for (const option of [{ uploadTimeout: true }, { loseClaimResponse: true }]) {
    const f = await fixture("youtube", option);
    try {
      assert.equal((await youtube(request("publish-youtube"))).status, 500);
      assert.equal((await youtube(request("publish-youtube"))).status, 409);
      assert.equal(f.counts().uploads, option.uploadTimeout ? 1 : 0);
    } finally {
      await f.close();
    }
  }
});

test("ブログの PR のプレビュー（GET）は固定版を返す", async () => {
  const f = await fixture("blog", { headSha: "c".repeat(40) });
  try {
    const result = await preview(request("blog-pr-preview"));
    assert.equal(result.headers.get("cache-control"), "no-store");
    const body = await result.json();
    assert.ok(body.previewUrl.endsWith(body.headSha));
    assert.deepEqual(f.counts(), { uploads: 0, merges: 0, ready: 0 });
  } finally {
    await f.close();
  }
});

// 管理画面からの記事の PR のマージは停止した（ADR-0034 → ADR-0097、BOA-908）。
// GITHUB_MERGE_TOKEN があっても読まず、GitHub（Ready 化・マージ）にも DB にも触れずに 410 を返す
test("停止した merge-blog-pr は鍵があっても GitHub と DB に触れず 410", async () => {
  const f = await fixture("blog");
  try {
    const before = await f.row();
    for (const body of [{ headSha }, {}]) {
      const res = await blog(request("merge-blog-pr", body));
      assert.equal(res.status, 410);
      assert.match((await res.json()).error, /停止/);
    }
    assert.deepEqual(f.counts(), { uploads: 0, merges: 0, ready: 0 });
    assert.deepEqual(await f.row(), before);
    assert.equal(
      (await blog(request("merge-blog-pr", { headSha }, false))).status,
      401,
      "未認証は停止の前に 401",
    );
  } finally {
    await f.close();
  }
});

test("claim中は承認・DB直接更新・削除を拒否、RPCは公開ロールに不可", async () => {
  const f = await fixture("youtube", { uploadTimeout: true });
  try {
    await youtube(request("publish-youtube"));
    assert.notEqual((await approve(request("approve"))).status, 200);
    await assert.rejects(f.db.query("UPDATE sns_drafts SET title='変更'"));
    await assert.rejects(f.db.query("DELETE FROM sns_drafts"));
    await assert.rejects(
      f.db.query("UPDATE sns_drafts SET external_operation_state=NULL"),
    );
    await assert.rejects(
      f.db.query("UPDATE sns_drafts SET external_operation_token=NULL"),
    );
    for (const role of ["anon", "authenticated"]) {
      const result = await f.db.query(
        `SELECT has_function_privilege($1,'sns_claim_external(uuid,jsonb,uuid,uuid)','EXECUTE') AS allowed`,
        [role],
      );
      assert.equal(result.rows[0].allowed, false);
    }
    assert.equal((await archiveDraft(request("archive"))).status, 409);
  } finally {
    await f.close();
  }
});

test("承認済み下書きが外部操作中のmark-postedは409（500固定ではない）", async () => {
  const f = await fixture();
  try {
    await f.db.query(
      "UPDATE sns_drafts SET status='approved', external_operation_state='reconcile'",
    );
    assert.equal((await markPosted(request("mark-posted"))).status, 409);
  } finally {
    await f.close();
  }
});

test("通知はrisk/thumbnailを保持し、サーバーの理由の文を出さない", () => {
  const messages = actionFeedback({
    riskWarnings: [{ id: "risk", matchedPattern: "対象" }],
    thumbnailWarning: "権限不足",
  });
  assert.equal(messages.length, 2);
  assert.match(messages[0], /リスク警告: 対象/);
  assert.equal(messages[1], "サムネイルを設定できませんでした。");
  assert.ok(!messages[1].includes("権限不足"));
});

test("未認証時は外部通信しない", async () => {
  const f = await fixture();
  try {
    assert.equal(
      (await youtube(request("publish-youtube", {}, false))).status,
      401,
    );
    assert.equal(
      (await preview(request("blog-pr-preview", {}, false))).status,
      401,
    );
    assert.deepEqual(f.counts(), { uploads: 0, merges: 0, ready: 0 });
  } finally {
    await f.close();
  }
});

test("同一スナップショットのclaimは1件だけ成功、変更後の版も拒否", async () => {
  const f = await fixture();
  try {
    const row = await f.row();
    const claims = await Promise.allSettled(
      [1, 2].map(() =>
        f.db.query("SELECT sns_claim_external($1,$2,$3,$4)", [
          id,
          row,
          crypto.randomUUID(),
          approverId,
        ]),
      ),
    );
    assert.equal(claims.filter((r) => r.status === "fulfilled").length, 1);
  } finally {
    await f.close();
  }
  const g = await fixture();
  try {
    const row = await g.row();
    await g.db.query("UPDATE sns_drafts SET title='変更'");
    await assert.rejects(
      g.db.query("SELECT sns_claim_external($1,$2,$3,$4)", [
        id,
        row,
        crypto.randomUUID(),
        approverId,
      ]),
    );
  } finally {
    await g.close();
  }
});

test("サムネ失敗を保存し、サムネ結果DB保存失敗でも動画を再送しない", async () => {
  for (const failRpc of [undefined, "sns_update_external_warning"]) {
    const f = await fixture("youtube", { thumbnail: true, failRpc });
    try {
      const first = await youtube(request("publish-youtube"));
      assert.equal(first.status, failRpc ? 500 : 200);
      const second = await youtube(request("publish-youtube"));
      assert.equal(second.status, 200);
      const result = await second.json();
      assert.equal(result.thumbnailWarning, failRpc ? "unconfirmed" : "failed");
      assert.deepEqual(
        actionFeedback(result),
        failRpc
          ? [
              "サムネイルの設定結果を確認できていません。YouTube Studio で確認してください。",
            ]
          : ["サムネイルを設定できませんでした。"],
      );
      assert.equal(result.data.source_data.youtube_video_id, "video-id");
      assert.equal(f.counts().uploads, 1);
      if (!failRpc)
        assert.equal(result.data.source_data.youtube_thumbnail_error, "failed");
    } finally {
      await f.close();
    }
  }
});

test("依頼1の公開保留列がある場合はフラグ解除だけで送信させない", async () => {
  const f = await fixture();
  try {
    await f.db.exec(
      "ALTER TABLE sns_drafts ADD COLUMN publish_blocked boolean DEFAULT false, ADD COLUMN bundle_import_id uuid, ADD COLUMN bundle_version_hash text, ADD COLUMN publication_hold_reasons jsonb DEFAULT '[]'",
    );
    for (const patch of [
      "publish_blocked=true",
      "publish_blocked=false,bundle_import_id='00000000-0000-4000-8000-000000000003'",
      "bundle_import_id=NULL,bundle_version_hash='hash'",
      "bundle_version_hash=NULL,publication_hold_reasons='[\"保留\"]'",
    ]) {
      await f.db.exec(`UPDATE sns_drafts SET ${patch}`);
      const row = await f.row();
      await assert.rejects(
        f.db.query("SELECT sns_claim_external($1,$2,$3,$4)", [
          id,
          row,
          crypto.randomUUID(),
          approverId,
        ]),
      );
    }
    assert.equal(f.counts().uploads, 0);
  } finally {
    await f.close();
  }
});

test("親画面の成功・例外通知は関数型更新で蓄積し、閉じる操作だけが消去する", async () => {
  const source = await readFile(
    new URL("../../src/pages/admin/SnsHubAdmin.jsx", import.meta.url),
    "utf8",
  );
  const updates = [...source.matchAll(/setActionMessages\(([^;]+)\);/g)].map(
    (match) => match[1],
  );
  assert.equal(updates.length, 2);
  assert.ok(
    // 整形（prettier）で `(previous) => [` と改行が入っても同じ関数型更新として扱う
    updates.every((update) =>
      /^\(?previous\)? => \[\s*\.\.\.previous,/.test(update),
    ),
  );
  assert.match(source, /onClick=\{\(\) => setActionMessages\(\[\]\)\}/);
  // 実画面に接続された各updaterを順に実行し、Reactの連続更新を再現する。
  let messages = [];
  for (const result of [
    { thumbnailWarning: "権限不足" },
    {},
    { riskWarnings: [{ id: "risk" }] },
  ]) {
    const next = actionFeedback(result);
    const updater = new Function("messages", `return (${updates[0]})`)(next);
    messages = updater(messages);
  }
  assert.equal(messages.length, 2);
  const err = { message: "内部エラー詳細" };
  for (const update of updates.slice(1))
    messages = new Function("err", `return (${update})`)(err)(messages);
  assert.deepEqual(messages.slice(-1), [
    "操作に失敗しました。最新状態を確認してください。",
  ]);
  assert.ok(
    !messages.some((message) => message.includes(err.message)),
    "生のエラー詳細は表示しない",
  );
  assert.equal(messages[0], "サムネイルを設定できませんでした。");
});

for (const thumbnailSuccess of [true, false]) {
  test(`サムネ待機中にDB反映だけ再試行しても結果を保存する（成功=${thumbnailSuccess}）`, async () => {
    let started, release;
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    const waiting = new Promise((resolve) => {
      started = resolve;
    });
    const f = await fixture("youtube", {
      thumbnail: true,
      thumbnailSuccess,
      thumbnailGate: async () => {
        started();
        await pending;
      },
    });
    let first;
    try {
      first = youtube(request("publish-youtube"));
      await waiting;
      assert.equal((await f.row()).external_operation_state, "external_done");
      assert.equal((await youtube(request("publish-youtube"))).status, 200);
      assert.equal((await f.row()).external_operation_state, "done");
      release();
      assert.equal((await first).status, 200);
      const row = await f.row();
      assert.equal(row.external_operation_state, "done");
      assert.equal(
        row.external_operation_result.thumbnailWarning,
        thumbnailSuccess ? null : row.source_data.youtube_thumbnail_error,
      );
      if (!thumbnailSuccess)
        assert.equal(row.source_data.youtube_thumbnail_error, "failed");
      else assert.equal(row.source_data.youtube_thumbnail_error, undefined);
      const retry = await (await youtube(request("publish-youtube"))).json();
      assert.equal(
        retry.thumbnailWarning ?? null,
        row.external_operation_result.thumbnailWarning,
      );
      assert.equal(f.counts().uploads, 1);
      await assert.rejects(
        f.db.query("SELECT sns_update_external_warning($1,$2,$3)", [
          id,
          crypto.randomUUID(),
          "別操作",
        ]),
      );
    } finally {
      release();
      if (first) await first;
      await f.close();
    }
  });
}
