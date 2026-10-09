import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { createXSnapshot } from "../../api/_lib/snsXSend.js";
import {
  runYoutubeQueueJob,
  createMockYoutubeAdapter,
  deadlineSchedule,
  reconcileYoutubeJob,
  reconcileSendJob,
  runYoutubePublishJob,
} from "../../api/_lib/snsDeadlineQueue.js";
const db = new PGlite();
const first = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const bytes = new Uint8Array([1, 2, 3]);
const loadMedia = async () => bytes;
const store = {
  async transition(id, action, result = {}) {
    return (
      await first("SELECT transition_sns_x_send($1,$2,$3) result", [
        id,
        action,
        result,
      ])
    ).result;
  },
};
let approver;
before(async () => {
  await db.exec(
    "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;",
  );
  await db.exec(
    "CREATE TABLE test_clock(value timestamptz); INSERT INTO test_clock VALUES(NULL); CREATE FUNCTION test_now() RETURNS timestamptz LANGUAGE sql AS 'SELECT coalesce(value,now()) FROM test_clock';",
  );
  for (const file of [
    "035_sns_marketing_hub_schema.sql",
    "042_content_drafts_columns.sql",
    "135_sns_preview_bundle_import.sql",
    "137_sns_x_send.sql",
    "139_sns_deadline_queue.sql",
    "140_sns_mobile_approval.sql",
    "145_sns_edit_assist.sql",
  ]) {
    await db.exec(
      (
        await readFile(
          new URL("../../docs/db-migration/" + file, import.meta.url),
          "utf8",
        )
      ).replaceAll("now()", "test_now()"),
    );
  }
  if (!process.env.SNS_SHORTS_BASELINE)
    await db.exec(
      (
        await readFile(
          new URL(
            "../../docs/db-migration/146_sns_shorts_send.sql",
            import.meta.url,
          ),
          "utf8",
        )
      ).replaceAll("now()", "test_now()"),
    );
  approver = (
    await first("SELECT id FROM sns_approvers WHERE display_name='本人'")
  ).id;
});
beforeEach(async () => {
  if (!process.env.SNS_SHORTS_BASELINE)
    await db.exec(
      "DELETE FROM sns_youtube_quota_reads; DELETE FROM sns_youtube_quota_attempts",
    );
  await db.exec("DELETE FROM sns_x_send_jobs; DELETE FROM sns_drafts");
});
after(() => db.close());
async function enable(uploadLimit = 100, generalLimit = 10000) {
  await db.exec(
    "UPDATE test_clock SET value=NULL; UPDATE sns_x_send_control SET paused=false,timing_approved=true,daily_limit=1000,daily_baseline_date=(now() AT TIME ZONE 'Asia/Tokyo')::date,daily_external_count=0,max_source_age_seconds=3600,period_start=date_trunc('month',now()),period_end=date_trunc('month',now())+interval '1 month',attempt_ceiling_microusd=1,reserved_microusd=0;",
  );
  if (!process.env.SNS_SHORTS_BASELINE)
    await db.query(
      "UPDATE sns_youtube_quota_control SET verified=true,baseline_day=(now() AT TIME ZONE 'America/Los_Angeles')::date,upload_limit=$1,general_limit=$2,external_uploads=0,external_general=0",
      [uploadLimit, generalLimit],
    );
}
async function job(cover = null) {
  const current = Date.parse((await first("SELECT test_now() t")).t);
  const deadline_at = new Date(current + 7200000).toISOString();
  const q = {
    deadline_at,
    ...deadlineSchedule(deadline_at),
    youtube_mode: "scheduled",
    source_revision: "v1",
    source_observed_at: new Date(current).toISOString(),
  };
  const d = await first(
    "INSERT INTO sns_drafts(content_group_id,format,platform,language,title,caption_text,video_storage_path,cover_image_path,source_data) VALUES(gen_random_uuid(),'short','youtube','ja','発見','観測した件数','a.mp4',$1,$2) RETURNING *",
    [cover, { deadline_queue: q }],
  );
  return (
    await first("SELECT approve_sns_x_send($1,$2,$3,now()) result", [
      d.id,
      approver,
      await createXSnapshot(d, loadMedia),
    ])
  ).result;
}
const run = (j, youtube = createMockYoutubeAdapter(), extra = {}) =>
  runYoutubeQueueJob(j.id, {
    store,
    youtube,
    loadMedia,
    preflight: async () => {},
    ...extra,
  });
test("Shorts: 非公開応答はpostedにせず要照合、upload成功を公開時刻と推測しない", async () => {
  await enable();
  const j = await job();
  const youtube = createMockYoutubeAdapter({ privacyStatus: "private" });
  await assert.rejects(run(j, youtube));
  assert.equal(
    (await first("SELECT state FROM sns_x_send_jobs WHERE id=$1", [j.id]))
      .state,
    "reconcile",
  );
});
test("Shorts: カバー同一パスの上書きも承認snapshotに含め、送信前に拒否", async () => {
  await enable();
  const j = await job("cover.jpg");
  assert.equal(j.snapshot.media.length, 2);
  const youtube = createMockYoutubeAdapter();
  await assert.rejects(
    run(j, youtube, {
      loadMedia: async (path) =>
        path === "cover.jpg" ? new Uint8Array([9]) : bytes,
    }),
    /媒体/,
  );
  assert.equal(youtube.calls.length, 0);
});
test("Shorts: 上限超過・設定未確認は外部呼出しゼロ、予約は返金しない", async () => {
  await enable(1);
  const a = await job(),
    b = await job();
  await run(a);
  const youtube = createMockYoutubeAdapter();
  await assert.rejects(run(b, youtube), /quota/);
  assert.equal(youtube.calls.length, 0);
  await enable();
  await db.exec("UPDATE sns_youtube_quota_control SET verified=false");
  await assert.rejects(run(await job()), /quota/);
});
test("Shorts: 成功のID/URL/実公開時刻と、PT日付・呼出し前の消費記録", async () => {
  await enable();
  const j = await job();
  const result = await run(j);
  assert.equal(
    result.external_post_url,
    "https://www.youtube.com/watch?v=abcdefghijk",
  );
  assert.equal(result.state, "posted");
  const reservations = await first(
    "SELECT * FROM sns_youtube_quota_attempts WHERE job_id=$1",
    [j.id],
  );
  assert.equal(reservations.upload_reserved, 1);
  assert.equal(reservations.general_reserved, 104);
  assert.equal(reservations.upload_calls_started, 1);
  assert.equal(reservations.general_units_started, 52);
  assert.equal(
    new Date(result.posted_at).toISOString(),
    new Date(
      (
        await first("SELECT posted_at FROM sns_drafts WHERE id=$1", [
          j.draft_id,
        ])
      ).posted_at,
    ).toISOString(),
  );
  assert.deepEqual(reservations.calls, [
    "videos.insert",
    "videos.update",
    "videos.list",
  ]);
  assert.deepEqual(
    reservations.quota_day,
    (await first("SELECT (now() AT TIME ZONE 'America/Los_Angeles')::date d"))
      .d,
  );
});
test("Shorts: DB完了応答失敗・upload応答喪失でも再送しない、候補IDを残す", async () => {
  await enable();
  const j = await job();
  await assert.rejects(
    run(j, createMockYoutubeAdapter(), {
      store: {
        async transition(id, a, r) {
          if (a === "complete") throw new Error("db_lost");
          return store.transition(id, a, r);
        },
      },
    }),
    /db_lost/,
  );
  const uncertain = await first("SELECT * FROM sns_x_send_jobs WHERE id=$1", [
    j.id,
  ]);
  assert.equal(uncertain.state, "reconcile");
  assert.equal(uncertain.external_post_id, "abcdefghijk");
  await assert.rejects(run(uncertain), /claim/);
  const lost = await job();
  await assert.rejects(
    run(lost, createMockYoutubeAdapter({ failAt: "upload" })),
  );
  assert.equal(
    (await first("SELECT state FROM sns_x_send_jobs WHERE id=$1", [lost.id]))
      .state,
    "reconcile",
  );
});
test("Shorts: 本文編集は再承認、lease切れ・停止・PT日付跨ぎは後続呼出しを止める", async () => {
  await enable();
  const edited = await job();
  await db.query("UPDATE sns_drafts SET title='編集' WHERE id=$1", [
    edited.draft_id,
  ]);
  assert.equal(
    (await first("SELECT state FROM sns_x_send_jobs WHERE id=$1", [edited.id]))
      .state,
    "cancelled",
  );
  for (const sql of [
    "UPDATE sns_x_send_control SET paused=true",
    "UPDATE test_clock SET value=now()+interval '1 day'",
  ]) {
    await enable();
    const j = await job();
    const youtube = createMockYoutubeAdapter({
      afterUpload: async () => db.exec(sql),
    });
    await assert.rejects(run(j, youtube));
    assert.equal(
      (await first("SELECT state FROM sns_x_send_jobs WHERE id=$1", [j.id]))
        .state,
      "reconcile",
    );
    assert.equal(
      youtube.calls.some((c) => c.method === "videos.list"),
      false,
    );
  }
});
test("Shorts: 一般枠・手動API分も集計、再承認でも試行台帳を消さない、RLS", async () => {
  await enable(100, 51);
  await db.exec("UPDATE sns_youtube_quota_control SET external_general=51");
  const j = await job();
  await assert.rejects(run(j), /quota/);
  await enable();
  const failed = await job();
  await assert.rejects(
    run(failed, createMockYoutubeAdapter(), {
      preflight: async () => {
        throw new Error("source_changed");
      },
    }),
  );
  assert.equal(
    (await first("SELECT state FROM sns_x_send_jobs WHERE id=$1", [failed.id]))
      .state,
    "held",
  );
  const d = await first("SELECT * FROM sns_drafts WHERE id=$1", [
    failed.draft_id,
  ]);
  await first("SELECT approve_sns_x_send($1,$2,$3,now()) result", [
    d.id,
    approver,
    await createXSnapshot(d, loadMedia),
  ]);
  assert.equal(
    (
      await first(
        "SELECT count(*) n FROM sns_youtube_quota_attempts WHERE job_id=$1",
        [failed.id],
      )
    ).n,
    1,
  );
  await db.exec("SET ROLE authenticated");
  await assert.rejects(
    db.exec("SELECT * FROM sns_youtube_quota_attempts"),
    /permission denied/,
  );
  await db.exec("RESET ROLE");
});

test("Shorts: 期限後・停止中の照合は読取枠を消費、未確認なら再送せず要照合", async () => {
  await enable();
  const j = await job();
  await assert.rejects(run(j, createMockYoutubeAdapter({ failAt: "upload" })));
  await db.exec(
    "UPDATE sns_x_send_control SET paused=true; UPDATE sns_x_send_jobs SET lease_until=now()-interval '1 day',expires_at=now()-interval '1 day'",
  );
  const uncertain = await first("SELECT * FROM sns_x_send_jobs WHERE id=$1", [
    j.id,
  ]);
  assert.equal(
    (
      await reconcileYoutubeJob(uncertain, {
        store,
        lookup: async () => ({ confirmed: false }),
      })
    ).state,
    "reconcile",
  );
  assert.equal(
    (await first("SELECT count(*) n FROM sns_youtube_quota_reads")).n,
    1,
  );
  const result = await reconcileYoutubeJob(uncertain, {
    store,
    lookup: async () => ({
      confirmed: true,
      privacyStatus: "public",
      id: "abcdefghijk",
      posted_at: new Date().toISOString(),
    }),
  });
  assert.equal(result.state, "posted");
  assert.equal(
    (await first("SELECT count(*) n FROM sns_youtube_quota_reads")).n,
    2,
  );
});

test("Shorts: service_roleの公開RPCだけ利用可、旧内部RPCでクォータを迂回できない", async () => {
  await enable();
  const j = await job();
  await db.exec("SET ROLE service_role");
  try {
    await assert.rejects(
      first("SELECT transition_sns_send_139($1,$2,$3)", [j.id, "claim", {}]),
      /permission denied/,
    );
    assert.equal((await run(j)).state, "posted");
  } finally {
    await db.exec("RESET ROLE");
  }
});
test("Shorts: カバー送信は50 units、同じAPI呼出しの再試行は拒否", async () => {
  await enable();
  const j = await job("cover.png");
  await run(j);
  const a = await first(
    "SELECT * FROM sns_youtube_quota_attempts WHERE job_id=$1",
    [j.id],
  );
  assert.deepEqual(a.calls, [
    "videos.insert",
    "thumbnails.set",
    "videos.update",
    "videos.list",
  ]);
  assert.equal(a.general_units_started, 102);
  const other = await job();
  await store.transition(other.id, "claim");
  await store.transition(other.id, "begin_post");
  await store.transition(other.id, "youtube_call", { method: "videos.insert" });
  await assert.rejects(
    store.transition(other.id, "youtube_call", { method: "videos.insert" }),
    /not_planned/,
  );
});

test("F01: 汎用YouTube照合も台帳で停止しlookupを呼ばない", async () => {
  await enable();
  const j = await job();
  await assert.rejects(run(j, createMockYoutubeAdapter({ failAt: "upload" })));
  const uncertain = await first("SELECT * FROM sns_x_send_jobs WHERE id=$1", [
    j.id,
  ]);
  let calls = 0;
  const lookup = async () => {
    calls++;
    return { confirmed: false };
  };
  await db.exec("UPDATE sns_youtube_quota_control SET verified=false");
  await assert.rejects(reconcileSendJob(uncertain, { store, lookup }), /quota/);
  assert.equal(calls, 0);
  await enable(100, 104);
  await assert.rejects(
    reconcileSendJob(uncertain, { store, lookup }),
    /quota_limit/,
  );
  assert.equal(calls, 0);
  await enable();
  await reconcileSendJob(uncertain, { store, lookup });
  assert.equal(calls, 1);
  assert.equal(
    (await first("SELECT count(*) n FROM sns_youtube_quota_reads")).n,
    1,
  );
});
test("案B: private insert→処理確認→別lease→public update→実公開確認", async () => {
  await enable();
  const j = await job();
  const youtube = createMockYoutubeAdapter();
  await run(j, youtube);
  assert.deepEqual(
    youtube.calls.map((c) => c.method),
    ["videos.insert", "videos.list:processing", "videos.update", "videos.list"],
  );
  assert.equal(youtube.calls[0].payload.privacyStatus, "private");
  assert.equal(
    (await first("SELECT general_reserved FROM sns_youtube_quota_attempts"))
      .general_reserved,
    104,
  );
});

test("案B: upload lease失効後も公開段階で新しいlease、期限失効なら非公開残置", async () => {
  await enable();
  const j = await job();
  const youtube = createMockYoutubeAdapter({
    afterUpload: async () =>
      db.exec(
        "UPDATE sns_x_send_jobs SET lease_until=now()-interval '1 second' WHERE state='reconcile'",
      ),
  });
  assert.equal((await run(j, youtube)).state, "posted");
  await enable();
  const expired = await job();
  const adapter = createMockYoutubeAdapter({
    videoId: "expired0001",
    afterUpload: async () =>
      db.exec(
        "UPDATE sns_x_send_jobs SET expires_at=now() WHERE state='reconcile'",
      ),
  });
  await assert.rejects(run(expired, adapter));
  const saved = await first("SELECT * FROM sns_x_send_jobs WHERE id=$1", [
    expired.id,
  ]);
  assert.equal(saved.youtube_stage, "private_retained");
  assert.equal(saved.external_post_id, "expired0001");
  assert(!adapter.calls.some((c) => c.method === "videos.update"));
  assert.equal(saved.state, "reconcile");
});
test("案B: 処理pollは最大3回、公開前の最新検査不合格で非公開残置", async () => {
  await enable();
  const j = await job();
  const youtube = createMockYoutubeAdapter({ processingStatus: "processing" });
  let pending = await run(j, youtube);
  assert.equal(pending.state, "reconcile");
  for (let n = 0; n < 2; n++)
    pending = await runYoutubePublishJob(pending, {
      store,
      youtube,
      preflight: async () => {},
    });
  await assert.rejects(
    runYoutubePublishJob(pending, {
      store,
      youtube,
      preflight: async () => {},
    }),
    /poll_limit/,
  );
  assert.equal(
    youtube.calls.filter((c) => c.method === "videos.list:processing").length,
    3,
  );
  assert.equal(
    (
      await first(
        "SELECT general_units_started FROM sns_youtube_quota_attempts",
      )
    ).general_units_started,
    3,
  );
  assert.equal(
    (await first("SELECT youtube_stage FROM sns_x_send_jobs")).youtube_stage,
    "private_retained",
  );
  await enable();
  const other = await job();
  const adapter = createMockYoutubeAdapter({ videoId: "blocked0001" });
  let inspected = 0;
  await assert.rejects(
    run(other, adapter, {
      preflight: async () => {
        if (++inspected === 3) throw new Error("public_component_missing");
      },
    }),
    /public_component_missing/,
  );
  assert(!adapter.calls.some((c) => c.method === "videos.update"));
  assert.equal(
    (
      await first("SELECT youtube_stage FROM sns_x_send_jobs WHERE id=$1", [
        other.id,
      ])
    ).youtube_stage,
    "private_retained",
  );
});
test("案B: update応答喪失後は非公開と断定せず、再公開更新を拒否", async () => {
  await enable();
  const j = await job();
  const youtube = createMockYoutubeAdapter({ failAt: "update" });
  await assert.rejects(run(j, youtube));
  const pending = await first("SELECT * FROM sns_x_send_jobs WHERE id=$1", [
    j.id,
  ]);
  assert.equal(pending.youtube_stage, "update_started");
  await assert.rejects(store.transition(j.id, "youtube_publish_begin"));
  await assert.rejects(store.transition(j.id, "youtube_retain"));
  assert.equal(
    (
      await reconcileSendJob(pending, {
        store,
        lookup: async () => ({
          confirmed: true,
          id: "abcdefghijk",
          privacyStatus: "public",
          posted_at: new Date().toISOString(),
        }),
      })
    ).state,
    "posted",
  );
});

test("案B: upload後の承認失効はpublic updateなしで非公開残置", async () => {
  await enable();
  const j = await job();
  const youtube = createMockYoutubeAdapter({
    afterUpload: async () =>
      db.query("UPDATE sns_drafts SET x_approved_hash=NULL WHERE id=$1", [
        j.draft_id,
      ]),
  });
  await assert.rejects(run(j, youtube), /guard/);
  assert(!youtube.calls.some((c) => c.method === "videos.update"));
  assert.equal(
    (await first("SELECT youtube_stage FROM sns_x_send_jobs")).youtube_stage,
    "private_retained",
  );
});
test("案B: PTだけ跨ぐ試行は処理poll前に停止（JST・期限・leaseは有効）", async () => {
  await enable();
  const tomorrow = new Date(Date.now() + 86400000);
  tomorrow.setUTCHours(6, 59, 59, 0);
  await db.query("UPDATE test_clock SET value=$1", [tomorrow.toISOString()]);
  await db.exec(
    "UPDATE sns_x_send_control SET daily_baseline_date=(test_now() AT TIME ZONE 'Asia/Tokyo')::date; UPDATE sns_youtube_quota_control SET baseline_day=(test_now() AT TIME ZONE 'America/Los_Angeles')::date",
  );
  const j = await job();
  const youtube = createMockYoutubeAdapter({
    afterUpload: async () =>
      db.exec("UPDATE test_clock SET value=value+interval '2 seconds'"),
  });
  await assert.rejects(run(j, youtube), /quota_unconfirmed/);
  assert(!youtube.calls.some((c) => c.method === "videos.list:processing"));
  const saved = await first(
    "SELECT lease_until>test_now() lease_valid, expires_at>test_now() deadline_valid,(locked_at AT TIME ZONE 'Asia/Tokyo')::date=(test_now() AT TIME ZONE 'Asia/Tokyo')::date jst_valid FROM sns_x_send_jobs WHERE id=$1",
    [j.id],
  );
  assert.deepEqual(saved, {
    lease_valid: true,
    deadline_valid: true,
    jst_valid: true,
  });
});

test("案B: JSTだけ跨いだuploadは当日baseline更新済みでも公開せず残置", async () => {
  await enable();
  const tomorrow = new Date(Date.now() + 86400000);
  tomorrow.setUTCHours(14, 59, 59, 0);
  await db.query("UPDATE test_clock SET value=$1", [tomorrow.toISOString()]);
  await db.exec(
    "UPDATE sns_x_send_control SET daily_baseline_date=(test_now() AT TIME ZONE 'Asia/Tokyo')::date; UPDATE sns_youtube_quota_control SET baseline_day=(test_now() AT TIME ZONE 'America/Los_Angeles')::date",
  );
  const j = await job();
  const youtube = createMockYoutubeAdapter({
    afterUpload: async () =>
      db.exec(
        "UPDATE test_clock SET value=value+interval '2 seconds'; UPDATE sns_x_send_control SET daily_baseline_date=(test_now() AT TIME ZONE 'Asia/Tokyo')::date",
      ),
  });
  await assert.rejects(run(j, youtube), /guard/);
  assert(!youtube.calls.some((c) => c.method === "videos.update"));
  const saved = await first("SELECT * FROM sns_x_send_jobs WHERE id=$1", [
    j.id,
  ]);
  assert.equal(saved.youtube_stage, "private_retained");
  assert.equal(
    (
      await first(
        "SELECT baseline_day=(test_now() AT TIME ZONE 'America/Los_Angeles')::date same FROM sns_youtube_quota_control",
      )
    ).same,
    true,
  );
});

test("案B: 処理確認がpublic/未確認を返した場合は非公開と断定しない", async () => {
  await enable();
  const j = await job();
  const youtube = createMockYoutubeAdapter();
  youtube.processing = async () => ({
    confirmed: true,
    id: "abcdefghijk",
    privacyStatus: "public",
    processingStatus: "succeeded",
  });
  await assert.rejects(run(j, youtube), /processing_unconfirmed/);
  const saved = await first("SELECT * FROM sns_x_send_jobs WHERE id=$1", [
    j.id,
  ]);
  assert.equal(saved.state, "reconcile");
  assert.equal(saved.youtube_stage, "uploaded");
  assert(!youtube.calls.some((c) => c.method === "videos.update"));
});

test("案B: 動画処理失敗は公開せず非公開残置を記録する", async () => {
  await enable();
  const j = await job();
  const youtube = createMockYoutubeAdapter({ processingStatus: "failed" });
  await assert.rejects(run(j, youtube), /processing_failed/);
  assert(!youtube.calls.some((c) => c.method === "videos.update"));
  assert.equal(
    (await first("SELECT youtube_stage FROM sns_x_send_jobs")).youtube_stage,
    "private_retained",
  );
});

test("非公開残置のreconcileをオーナーが手動でcancelled後、再承認・再uploadが成功する（youtube_stage・external_post_idのリセット漏れ対策）", async () => {
  await enable();
  const j = await job();
  const youtube = createMockYoutubeAdapter({ processingStatus: "failed" });
  await assert.rejects(run(j, youtube), /processing_failed/);
  const stuck = await first("SELECT * FROM sns_x_send_jobs WHERE id=$1", [
    j.id,
  ]);
  assert.equal(stuck.state, "reconcile");
  assert.equal(stuck.youtube_stage, "private_retained");
  assert.ok(stuck.external_post_id);
  // reconcile中の下書き編集はguard_sns_x_approvalで拒否される（照合完了までのブロック）ため、
  // オーナーが非公開残置の動画をYouTube上で手動削除したうえで、job行自体を手動でcancelledへ戻す
  // （DeadlineQueuePanelの「非公開のまま残置・削除はオーナー操作」案内が示す回復経路）。
  await db.exec(
    `UPDATE sns_x_send_jobs SET state='cancelled' WHERE id='${j.id}'`,
  );
  const d = await first("SELECT * FROM sns_drafts WHERE id=$1", [j.draft_id]);
  const reapproved = (
    await first("SELECT approve_sns_x_send($1,$2,$3,now()) result", [
      d.id,
      approver,
      await createXSnapshot(d, loadMedia),
    ])
  ).result;
  assert.equal(reapproved.state, "queued");
  assert.equal(
    reapproved.youtube_stage,
    null,
    "再承認でyoutube_stageがリセットされる",
  );
  assert.equal(
    reapproved.external_post_id,
    null,
    "再承認でexternal_post_idがリセットされる",
  );
  const retry = createMockYoutubeAdapter({ videoId: "newupload01" });
  const posted = await run(reapproved, retry);
  assert.equal(
    posted.state,
    "posted",
    "リセット漏れだと2回目のuploadedがstale guardで例外になり、動画が追跡不能のまま残る",
  );
  assert.equal(posted.external_post_id, "newupload01");
});
