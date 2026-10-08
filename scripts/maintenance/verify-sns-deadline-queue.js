import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import {
  createXSnapshot,
  createMockXAdapter,
  runXSendJob,
  X_MEDIA_MAX_BYTES,
  YOUTUBE_MEDIA_MAX_BYTES,
} from "../../api/_lib/snsXSend.js";
import {
  deadlineSchedule,
  createDeadlinePreflight,
  createMockHeadless,
  checkPublicDisplay,
  reconcileSendJob,
  runYoutubeQueueJob,
  createMockYoutubeAdapter,
} from "../../api/_lib/snsDeadlineQueue.js";
const db = new PGlite();
const first = async (sql, args = []) => (await db.query(sql, args)).rows[0];
let approver;
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
  async parent(id) {
    return first("SELECT * FROM sns_x_send_jobs WHERE id=$1", [id]);
  },
};
const loadMedia = async () => new Uint8Array([1, 2, 3]);
before(async () => {
  await db.exec(
    "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;",
  );
  await db.exec(
    "CREATE TABLE test_clock(value timestamptz); INSERT INTO test_clock VALUES(NULL); CREATE FUNCTION test_now() RETURNS timestamptz LANGUAGE sql AS 'SELECT coalesce(value,now()) FROM test_clock';",
  );
  for (const f of [
    "035_sns_marketing_hub_schema.sql",
    "042_content_drafts_columns.sql",
    "135_sns_preview_bundle_import.sql",
    "137_sns_x_send.sql",
    "139_sns_deadline_queue.sql",
  ])
    await db.exec(
      (
        await readFile(
          new URL("../../docs/db-migration/" + f, import.meta.url),
          "utf8",
        )
      ).replaceAll("now()", "test_now()"),
    );
  approver = (
    await first("SELECT id FROM sns_approvers WHERE display_name='本人'")
  ).id;
});
after(() => db.close());
const queue = () => {
  const deadline_at = new Date(Date.now() + 7200000).toISOString();
  return {
    deadline_at,
    ...deadlineSchedule(deadline_at),
    source_observed_at: new Date().toISOString(),
    source_revision: "v1",
    public_url: "https://www.boat-ai.jp/race/test",
    screen_key: "sonar",
  };
};
async function job({
  q = queue(),
  platform = "x",
  text = "ボートレースの発見",
} = {}) {
  const d = await first(
    "INSERT INTO sns_drafts(content_group_id,format,platform,language,caption_text,source_data,title,video_storage_path) VALUES(gen_random_uuid(),'short',$1::varchar,'ja',$2,$3,'動画タイトル',CASE WHEN $1::varchar='youtube' THEN 'demo/a.mp4' ELSE NULL END) RETURNING *",
    [platform, text, { deadline_queue: q }],
  );
  const snapshot = await createXSnapshot(d, loadMedia);
  return (
    await first("SELECT approve_sns_x_send($1,$2,$3,now()) result", [
      d.id,
      approver,
      snapshot,
    ])
  ).result;
}
async function enable(limit = 1000) {
  await db.exec(
    `UPDATE sns_x_send_control SET paused=false,timing_approved=true,daily_limit=${limit},daily_baseline_date=(now() AT TIME ZONE 'Asia/Tokyo')::date,daily_external_count=0,max_source_age_seconds=3600,period_start=date_trunc('month',now()),period_end=date_trunc('month',now())+interval '1 month',attempt_ceiling_microusd=1,reserved_microusd=0`,
  );
}
function preflight(
  j,
  headless = createMockHeadless({ visibleSelectors: ["[data-sonar]"] }),
  extra = {},
) {
  return createDeadlinePreflight({
    headless,
    markers: { sonar: ["[data-sonar]"] },
    readCurrent: async () => ({
      withdrawn: false,
      cancelled: false,
      source_revision: "v1",
      deadline_at: j.snapshot.queue.deadline_at,
    }),
    ...extra,
  });
}
const run = (j, x, extra = {}) =>
  runXSendJob(j.id, {
    store,
    x,
    loadMedia,
    wait: async () => {},
    preflight: preflight(j),
    ...extra,
  });
test("設定未承認は保留、期限境界・期限欠落・鮮度を自動保留", async () => {
  const pending = await job();
  assert.equal(
    (await store.transition(pending.id, "claim")).error_code,
    "timing_pending_owner",
  );
  await enable();
  for (const [q, reason] of [
    [
      { ...queue(), expires_at: new Date(Date.now() - 1).toISOString() },
      "deadline_expired",
    ],
    [{ ...queue(), expires_at: null }, "deadline_missing"],
    [
      { ...queue(), source_observed_at: "2000-01-01T00:00:00Z" },
      "source_stale",
    ],
  ]) {
    const j = await job({ q });
    assert.equal((await store.transition(j.id, "claim")).error_code, reason);
  }
});
test("毎回ログインなしの公開表示検査、Preview・redirect・非表示・変更版は送らない", async () => {
  await enable();
  const j = await job(),
    browser = createMockHeadless({ visibleSelectors: ["[data-sonar]"] });
  const x = createMockXAdapter();
  assert.equal(
    (await run(j, x, { preflight: preflight(j, browser) })).state,
    "posted",
  );
  assert.equal(browser.calls.length, 2);
  assert.deepEqual(browser.calls[0].context, { storageState: null });
  for (const patch of [
    { public_url: "https://www.boat-ai.jp/race/test?preview=1" },
    { public_url: "https://www.boat-ai.jp/race/test?analogy=1" },
  ])
    await assert.rejects(
      checkPublicDisplay({ ...queue(), ...patch }, browser, {
        sonar: ["[data-sonar]"],
      }),
    );
  for (const opts of [
    { visibleSelectors: [] },
    {
      visibleSelectors: ["[data-sonar]"],
      finalUrl: "https://www.boat-ai.jp/login",
    },
    { fail: true },
  ]) {
    const held = await job(),
      adapter = createMockXAdapter();
    await assert.rejects(
      run(held, adapter, {
        preflight: preflight(held, createMockHeadless(opts)),
      }),
    );
    assert.equal(adapter.calls.length, 0);
    assert.equal(
      (await first("SELECT state FROM sns_x_send_jobs WHERE id=$1", [held.id]))
        .state,
      "held",
    );
  }
  const changed = await job();
  await assert.rejects(
    preflight(changed, browser, {
      readCurrent: async () => ({ withdrawn: true }),
    })(changed),
  );
});
test("加重文字数と未解決差し込みを拒否、URLは公式計数", async () => {
  await enable();
  for (const text of ["あ".repeat(141), "締切{HH:mm}", "本文 ${value}"]) {
    const j = await job({ text }),
      x = createMockXAdapter();
    await assert.rejects(run(j, x));
    assert.equal(x.calls.length, 0);
  }
  const j = await job({
    text: "あ".repeat(120) + " https://www.boat-ai.jp/" + "a".repeat(500),
  });
  await preflight(j)(j);
});
test("公開検査の待ち時間で失効しても送らない", async () => {
  const j = await job();
  let t = Date.now();
  const browser = {
    async inspect(req) {
      t = Date.parse(j.expires_at);
      return { finalUrl: req.url, visibleSelectors: ["[data-sonar]"] };
    },
  };
  await assert.rejects(
    preflight(j, browser, { now: () => t })(j),
    /deadline_expired/,
  );
});
test("日次全体上限をロックで守る、上限不明は止める", async () => {
  await enable();
  await db.exec("UPDATE sns_x_send_control SET daily_limit=NULL");
  const a = await job();
  await assert.rejects(store.transition(a.id, "claim"), /日次/);
  const count = Number(
    (
      await first(
        "SELECT count(*) n FROM sns_x_send_jobs WHERE channel='x' AND (locked_at AT TIME ZONE 'Asia/Tokyo')::date=(now() AT TIME ZONE 'Asia/Tokyo')::date",
      )
    ).n,
  );
  await enable(count + 1);
  const b = await job();
  const result = await Promise.allSettled([
    store.transition(a.id, "claim"),
    store.transition(b.id, "claim"),
  ]);
  assert.equal(result.filter((r) => r.status === "fulfilled").length, 1);
});
test("親が未公開なら子を保留、親成功後も子は個別承認しreply IDを渡す", async () => {
  await enable();
  const parent = await job();
  const q = { ...queue(), parent_job_id: parent.id };
  const child = await job({ q });
  assert.equal(
    (await store.transition(child.id, "claim")).error_code,
    "parent_not_posted",
  );
  await run(parent, createMockXAdapter({ postId: "1234567891" }));
  const d = await first("SELECT * FROM sns_drafts WHERE id=$1", [
    child.draft_id,
  ]);
  const approved = (
    await first("SELECT approve_sns_x_send($1,$2,$3,now()) result", [
      d.id,
      approver,
      await createXSnapshot(d, loadMedia),
    ])
  ).result;
  const x = createMockXAdapter({ postId: "1234567892" });
  await run(approved, x);
  assert.equal(x.calls.at(-1).payload.replyTo, "1234567891");
});
test("HTTP timeout・lease失効は要照合、1チャネル障害で他を再送しない", async () => {
  await enable();
  const failed = await job(),
    other = await job({
      platform: "youtube",
      q: { ...queue(), youtube_mode: "immediate" },
    });
  await assert.rejects(
    run(failed, createMockXAdapter({ failAt: "createPost" })),
  );
  const uncertain = await first("SELECT * FROM sns_x_send_jobs WHERE id=$1", [
    failed.id,
  ]);
  assert.equal(uncertain.state, "reconcile");
  assert.equal(
    (
      await reconcileSendJob(uncertain, {
        store,
        lookup: async () => ({ confirmed: false }),
      })
    ).state,
    "reconcile",
  );
  await assert.rejects(store.transition(failed.id, "claim"));
  assert.equal(
    (await first("SELECT state FROM sns_x_send_jobs WHERE id=$1", [other.id]))
      .state,
    "queued",
  );
  const youtube = createMockYoutubeAdapter();
  assert.equal(
    (
      await runYoutubeQueueJob(other.id, {
        store,
        youtube,
        loadMedia,
        preflight: preflight(other),
      })
    ).state,
    "posted",
  );
  const lease = await job();
  await store.transition(lease.id, "claim");
  await db.query(
    "UPDATE sns_x_send_jobs SET lease_until=now()-interval '1 second' WHERE id=$1",
    [lease.id],
  );
  await db.exec("SELECT sweep_sns_deadline_queue()");
  assert.equal(
    (await first("SELECT state FROM sns_x_send_jobs WHERE id=$1", [lease.id]))
      .state,
    "reconcile",
  );
});
test("source_data編集は再承認、権限を維持", async () => {
  await enable();
  const j = await job();
  await db.query("UPDATE sns_drafts SET source_data='{}' WHERE id=$1", [
    j.draft_id,
  ]);
  assert.equal(
    (await first("SELECT state FROM sns_x_send_jobs WHERE id=$1", [j.id]))
      .state,
    "cancelled",
  );
  await db.exec("SET ROLE authenticated");
  await assert.rejects(
    db.exec("SELECT sweep_sns_deadline_queue()"),
    /permission denied/,
  );
  await db.exec("RESET ROLE");
});

test("YouTube予約は時刻待ち、due時に再検査して公開、署名URLを保存しない", async () => {
  await enable();
  const j = await job({
    platform: "youtube",
    q: { ...queue(), youtube_mode: "scheduled" },
  });
  await db.query(
    "UPDATE sns_x_send_jobs SET scheduled_at=now()+interval '10 minutes' WHERE id=$1",
    [j.id],
  );
  const youtube = createMockYoutubeAdapter();
  youtube.publish = async (payload) => {
    youtube.calls.push(payload);
    return { id: "scheduled01", posted_at: new Date().toISOString() };
  };
  await assert.rejects(
    runYoutubeQueueJob(j.id, {
      store,
      youtube,
      loadMedia,
      preflight: preflight(j),
    }),
    /claim/,
  );
  assert.equal(youtube.calls.length, 0);
  await db.query("UPDATE sns_x_send_jobs SET scheduled_at=now() WHERE id=$1", [
    j.id,
  ]);
  let checked = 0;
  assert.equal(
    (
      await runYoutubeQueueJob(j.id, {
        store,
        youtube,
        loadMedia,
        preflight: async (current) => {
          checked++;
          await preflight(j)(current);
        },
      })
    ).state,
    "posted",
  );
  assert.equal(checked, 1);
  assert.equal(youtube.calls[0].privacyStatus, "public");
  assert.equal(youtube.calls[0].publishAt, null);
  assert.equal(youtube.calls[0].snapshot.media[0].path, "demo/a.mp4");
});
test("期限切れsweepと再承認後の版破損は外部呼出しゼロ", async () => {
  await enable();
  const expired = await job({
    q: { ...queue(), expires_at: new Date(Date.now() - 1).toISOString() },
  });
  await db.exec("SELECT sweep_sns_deadline_queue()");
  assert.equal(
    (await first("SELECT state FROM sns_x_send_jobs WHERE id=$1", [expired.id]))
      .state,
    "held",
  );
  const j = await job(),
    x = createMockXAdapter();
  const corrupt = {
    async transition(id, action, result) {
      const value = await store.transition(id, action, result);
      return action === "claim" ? { ...value, snapshot_text: "{}" } : value;
    },
  };
  await assert.rejects(run(j, x, { store: corrupt }), /hash/);
  assert.equal(x.calls.length, 0);
});

test("再承認してもheld・failed・cancelledの試行は日次枠から消えない", async () => {
  for (const action of ["hold", "fail", "cancel"]) {
    await enable();
    const a = await job();
    await store.transition(a.id, "claim");
    if (action === "cancel") {
      await store.transition(a.id, "hold");
      await db.query(
        "UPDATE sns_drafts SET source_data=source_data || '{\"changed\":true}'::jsonb WHERE id=$1",
        [a.draft_id],
      );
    } else await store.transition(a.id, action);
    const count = Number(
      (
        await first(
          "SELECT sum(attempts) n FROM sns_x_send_jobs WHERE channel='x'",
        )
      ).n,
    );
    await enable(count);
    const d = await first("SELECT * FROM sns_drafts WHERE id=$1", [a.draft_id]);
    await first("SELECT approve_sns_x_send($1,$2,$3,now()) result", [
      d.id,
      approver,
      await createXSnapshot(d, loadMedia),
    ]);
    await assert.rejects(store.transition(a.id, "claim"), /日次/);
    const b = await job();
    await assert.rejects(store.transition(b.id, "claim"), /日次/);
  }
});
test("begin_postでも当日の基準・上限を再検査し、日付またぎは保留", async () => {
  await enable();
  const a = await job();
  await store.transition(a.id, "claim");
  await db.exec(
    "UPDATE sns_x_send_control SET daily_baseline_date=daily_baseline_date-1",
  );
  await assert.rejects(store.transition(a.id, "begin_post"), /日次/);
  await enable(1);
  await db.exec("UPDATE sns_x_send_control SET daily_external_count=1");
  await assert.rejects(store.transition(a.id, "begin_post"), /日次/);
  await db.exec(
    "UPDATE test_clock SET value=date_trunc('day',now() AT TIME ZONE 'Asia/Tokyo') AT TIME ZONE 'Asia/Tokyo' + interval '23 hours 59 minutes'",
  );
  try {
    await enable();
    const t = (await first("SELECT test_now() t")).t;
    const deadline_at = new Date(Date.parse(t) + 7200000).toISOString();
    const b = await job({
      q: {
        ...queue(),
        deadline_at,
        ...deadlineSchedule(deadline_at),
        source_observed_at: new Date(t).toISOString(),
      },
    });
    await db.query(
      "UPDATE sns_x_send_jobs SET scheduled_at=test_now() WHERE id=$1",
      [b.id],
    );
    await store.transition(b.id, "claim");
    await db.exec("UPDATE test_clock SET value=value+interval '2 minutes'");
    await assert.rejects(store.transition(b.id, "begin_post"), /日次/);
    await db.exec(
      "UPDATE sns_x_send_control SET daily_baseline_date=(test_now() AT TIME ZONE 'Asia/Tokyo')::date",
    );
    assert.equal(
      (await store.transition(b.id, "begin_post")).error_code,
      "daily_claim_date_changed",
    );
  } finally {
    await db.exec("UPDATE test_clock SET value=NULL");
  }
});

test("媒体変更を伴う再承認でも試行時の媒体の日次枠を保持する", async () => {
  const original = "x",
    changed = "youtube";
  const baseline = {};
  for (const channel of [original, changed])
    baseline[channel] = Number(
      (
        await first(
          "SELECT sum(attempts) n FROM sns_x_send_jobs WHERE channel=$1",
          [channel],
        )
      ).n || 0,
    );
  await enable();
  const a = await job({ platform: original });
  await store.transition(a.id, "claim");
  await store.transition(a.id, "hold");
  const count = Number(
    (
      await first(
        "SELECT sum(attempts) n FROM sns_x_send_jobs WHERE channel=$1",
        [original],
      )
    ).n,
  );
  await enable(count);
  const d = await first(
    "UPDATE sns_drafts SET platform=$2,video_storage_path=CASE WHEN $2::varchar='youtube' THEN 'demo/a.mp4' ELSE NULL END WHERE id=$1 RETURNING *",
    [a.draft_id, changed],
  );
  const approved = (
    await first("SELECT approve_sns_x_send($1,$2,$3,now()) result", [
      d.id,
      approver,
      await createXSnapshot(d, loadMedia),
    ])
  ).result;
  assert.equal(approved.channel, changed);
  const b = await job({ platform: original });
  await assert.rejects(store.transition(b.id, "claim"), /日次/);
  // 変更先での試行も成功させ、両媒体の過去枠が次の再承認後も残ることを確認する。
  await enable();
  await store.transition(a.id, "claim");
  await store.transition(a.id, "hold");
  const back = await first(
    "UPDATE sns_drafts SET platform=$2,video_storage_path=CASE WHEN $2::varchar='youtube' THEN 'demo/a.mp4' ELSE NULL END WHERE id=$1 RETURNING *",
    [a.draft_id, original],
  );
  const restored = (
    await first("SELECT approve_sns_x_send($1,$2,$3,now()) result", [
      back.id,
      approver,
      await createXSnapshot(back, loadMedia),
    ])
  ).result;
  assert.deepEqual(restored.attempt_channels, ["x", "youtube"]);
  assert.equal(restored.attempt_dates.length, 2);
  for (const channel of [original, changed]) {
    const expected = baseline[channel] + 1;
    await enable(expected);
    const other = await job({ platform: channel });
    await assert.rejects(store.transition(other.id, "claim"), /日次/);
  }
});

test("YouTube動画はXの32MB上限を適用しない、Xは32MB超を拒否したまま", async () => {
  await enable();
  const overX = X_MEDIA_MAX_BYTES + 1024;
  // YouTubeはXの32MB上限より大きく、かつ500MB上限より十分小さいサイズで検証する（上限ぎりぎりの巨大配列確保を避ける）
  const overXButUnderYoutubeCap = X_MEDIA_MAX_BYTES + 8 * 1024 * 1024;
  assert.ok(overXButUnderYoutubeCap < YOUTUBE_MEDIA_MAX_BYTES);
  const bigMedia = async () => new Uint8Array(overX);
  const underCapMedia = async () => new Uint8Array(overXButUnderYoutubeCap);

  const xDraft = await first(
    "INSERT INTO sns_drafts(content_group_id,format,platform,language,caption_text,source_data,title,video_storage_path) VALUES(gen_random_uuid(),'short','x','ja',$1,$2,'動画タイトル','demo/a.mp4') RETURNING *",
    ["ボートレースの発見", { deadline_queue: queue() }],
  );
  await assert.rejects(createXSnapshot(xDraft, bigMedia), /媒体の容量/);

  const ytDraft = await first(
    "INSERT INTO sns_drafts(content_group_id,format,platform,language,caption_text,source_data,title,video_storage_path) VALUES(gen_random_uuid(),'short','youtube','ja',$1,$2,'動画タイトル','demo/a.mp4') RETURNING *",
    ["ボートレースの発見", { deadline_queue: queue() }],
  );
  const snapshot = await createXSnapshot(ytDraft, underCapMedia);
  assert.equal(snapshot.media[0].size, overXButUnderYoutubeCap);
  const approved = (
    await first("SELECT approve_sns_x_send($1,$2,$3,now()) result", [
      ytDraft.id,
      approver,
      snapshot,
    ])
  ).result;
  assert.equal(approved.state, "queued");
});
