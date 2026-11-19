// 優勝戦の「思考の順」の画像投稿（format=finals_image、マイグレーション 176、scripts/sns/push-finals-image.js、hq FT02）の再現テスト。
// PGlite に 176 までのマイグレーションを当て、本番と同じ承認の関数（approve_sns_x_send、160）・送信の claim（transition_sns_x_send、
// transition_sns_send_139 は 176）で通す。外部接続なし。X へは何も送らない
import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { imageNamesOf, pushFinalsImage } from "../sns/push-finals-image.js";

import { createMockXAdapter, createXSnapshot, runXSendJob } from "../../api/_lib/snsXSend.js";
import { createXApiAdapter } from "../../api/_lib/xApiAdapter.js";

import { createHash } from "node:crypto";


import { runSnsFinalsImageScenes1, runSnsFinalsImageScenes2 } from "./verifyData/sns-finals-image-scenes-1.js";
import { runSnsFinalsImageScenes3 } from "./verifyData/sns-finals-image-scenes-2.js";
import { runSnsFinalsImageScenes4, runSnsFinalsImageScenes5 } from "./verifyData/sns-finals-image-scenes-3.js";
import { runSnsFinalsImageScenes6, runSnsFinalsImageScenes7 } from "./verifyData/sns-finals-image-scenes-4.js";
import { runSnsFinalsImageScenes8 } from "./verifyData/sns-finals-image-scenes-5.js";

const db = new PGlite();
const first = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const all = async (sql, args = []) => (await db.query(sql, args)).rows;
const riskRules = JSON.parse(
  await readFile(
    new URL("../../sns-video-studio/remotion/risk-rules.json", import.meta.url),
    "utf8",
  ),
).rules;
const RACE = "2037-10-26-20-12";
// 締切 16:30 JST。画像は 16:15 に届く
const DEADLINE = "2037-10-26T07:30:00.000Z";
const NAMES = imageNamesOf(RACE);
const NOW = new Date("2037-10-26T16:15:00+09:00");
const at = (hhmmss) => new Date(`2037-10-26T${hhmmss}+09:00`);
const PUSHED_AT = at("16:13:00");

/** 最小の PNG（署名と IHDR の幅・高さだけ。検査は IHDR だけを読む） */
function png(width = 1080, height = 1350, padding = 200) {
  const bytes = new Uint8Array(24 + padding);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  bytes[24] = padding % 251; // 画像ごとにハッシュを変える
  return bytes;
}

before(async () => {
  await db.exec(
    "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;",
  );
  await db.exec(
    "CREATE TABLE test_clock(value timestamptz); INSERT INTO test_clock VALUES(NULL); CREATE FUNCTION test_now() RETURNS timestamptz LANGUAGE sql AS 'SELECT coalesce(value,now()) FROM test_clock';",
  );
  await db.exec(
    "CREATE TABLE scrape_job_state(job TEXT PRIMARY KEY, mode TEXT NOT NULL DEFAULT 'off' CHECK (mode IN ('off','shadow','live')));",
  );
  await db.exec(`
    CREATE TABLE races(race_id VARCHAR PRIMARY KEY, race_date DATE, start_time TIME, cancellation_status TEXT);
    CREATE TABLE race_conditions(race_id VARCHAR PRIMARY KEY, race_stage VARCHAR);`);
  for (const file of [
    "035_sns_marketing_hub_schema.sql",
    "042_content_drafts_columns.sql",
    "135_sns_preview_bundle_import.sql",
    "136_sns_metric_observations.sql",
    "137_sns_x_send.sql",
    "138_sns_external_operations.sql",
    "139_sns_deadline_queue.sql",
    "140_sns_mobile_approval.sql",
    "145_sns_edit_assist.sql",
    "146_sns_shorts_send.sql",
    "147_sns_draft_diff.sql",
    "148_sns_posted_approval_guard.sql",
    "153_sns_auto_send.sql",
    "154_sns_tokens_metric_jobs.sql",
    "158_sns_lanes_digest_period.sql",
    "160_sns_x_multiple_images.sql",
    "161_sns_full_picture_items.sql",
    "172_sns_full_picture_shorts.sql",
    "176_sns_finals_image_items.sql",
    "177_sns_finals_replies.sql",
  ])
    await db.exec(
      (
        await readFile(
          new URL("../../docs/db-migration/" + file, import.meta.url),
          "utf8",
        )
      ).replaceAll("now()", "test_now()"),
    );
});
beforeEach(async () => {
  await db.exec(`
    DELETE FROM sns_metric_jobs; UPDATE sns_x_send_jobs SET parent_job_id=NULL; DELETE FROM sns_youtube_quota_attempts; DELETE FROM sns_x_send_jobs; DELETE FROM sns_auto_send_items;
    ALTER TABLE sns_drafts DISABLE TRIGGER USER; DELETE FROM sns_drafts; ALTER TABLE sns_drafts ENABLE TRIGGER USER;
    DELETE FROM races; DELETE FROM race_conditions;
    UPDATE sns_auto_send_control SET mode='auto', dry_run=false, finals_image_enabled=(channel='x');
    UPDATE sns_x_send_control SET paused=false, timing_approved=true, max_source_age_seconds=14400, daily_limit_x=6, daily_limit_youtube=2, daily_baseline_date=(test_now() AT TIME ZONE 'Asia/Tokyo')::date, daily_external_count=0, period_start=test_now() - interval '1 day', period_end=test_now() + interval '30 days', budget_microusd=20000000, reserved_microusd=0, attempt_ceiling_microusd=250000, ceiling_x_url_microusd=250000, ceiling_x_plain_microusd=30000;`);
  await setClock(NOW);
  await db.query("INSERT INTO races VALUES($1,'2037-10-26','16:30:00',NULL)", [
    RACE,
  ]);
  await db.query("INSERT INTO race_conditions VALUES($1,'優勝戦')", [RACE]);
  saved.length = 0;
});
after(() => db.close());

const setClock = (date) =>
  db.query("UPDATE test_clock SET value=$1", [date.toISOString()]);

const bundle = (patch = {}) => ({
  format: "finals_image",
  race_id: RACE,
  x_text:
    "若松12R 優勝戦。展示を見た直前の思考の順\n\nあなたの予想はA〜Dのどれ？ リプで教えて！ レース後に答え合わせします",
  deadline: "16:30",
  images: NAMES,
  review: { p0_count: 0, by: "machine" },
  poll: POLL,
  poll_text: "あなたの予想は？ 締切16:30まで投票できます\n#ボートレース",
  ...patch,
});
const IMAGES = () =>
  Object.fromEntries(NAMES.map((name, i) => [name, png(1080, 1350, 200 + i)]));

/** hq の finals_sheet.py の poll_options の形（艇番・名前・道、25字まで） */
const POLL = [
  "A 1号艇 山田太郎（イン逃げ）",
  "B 2号艇 佐藤次郎（差し）",
  "C 3号艇 鈴木三郎（まくり）",
  "D 4号艇 田中四郎（まくり差し）",
];

const MAIN_JOB = "SELECT * FROM sns_x_send_jobs WHERE parent_job_id IS NULL";
const MAIN_JOB_ID =
  "SELECT id FROM sns_x_send_jobs WHERE parent_job_id IS NULL";
const POLL_JOB =
  "SELECT * FROM sns_x_send_jobs WHERE parent_job_id IS NOT NULL";

// ---- 後半の場面（verifyData/sns-finals-image-scenes-1.js） ----
runSnsFinalsImageScenes1({ db, first, riskRules, RACE, DEADLINE, NAMES, NOW, at, png, setClock, bundle, IMAGES, MAIN_JOB, MAIN_JOB_ID });

const saved = [];
const store = {
  race: (id) =>
    first(
      "SELECT race_id, race_date::text, start_time::text, cancellation_status FROM races WHERE race_id=$1",
      [id],
    ),
  stage: async (id) =>
    (
      await first("SELECT race_stage FROM race_conditions WHERE race_id=$1", [
        id,
      ])
    )?.race_stage ?? null,
  finalsItems: (id, variant) =>
    all(
      "SELECT id, state, draft_id FROM sns_auto_send_items WHERE kind='finals_image' AND variant=$2 AND race_id=$1 ORDER BY created_at DESC",
      [id, variant],
    ),
  controls: async () =>
    Object.fromEntries(
      (
        await all(
          "SELECT channel, mode, dry_run, auto_approver_id, finals_image_enabled FROM sns_auto_send_control",
        )
      ).map((r) => [r.channel, r]),
    ),
  sendControl: () =>
    first(
      "SELECT daily_limit, daily_limit_x, daily_baseline_date::text, daily_external_count FROM sns_x_send_control",
    ),
  jobsAttemptedOn: (day) =>
    all(
      "SELECT id, state, attempt_dates::text[] attempt_dates, attempt_channels FROM sns_x_send_jobs WHERE $1::date = ANY(attempt_dates)",
      [day],
    ),
  waitingChildren: (now) =>
    all(
      `SELECT j.id, j.state, j.channel, j.attempts, j.expires_at::text, j.parent_job_id, d.bundle_import_id
         FROM sns_x_send_jobs j JOIN sns_drafts d ON d.id=j.draft_id
        WHERE j.state='queued' AND j.attempts=0 AND j.channel='x' AND j.parent_job_id IS NOT NULL AND j.expires_at > $1`,
      [now.toISOString()],
    ),
  jobForDraft: (draftId) =>
    first(
      "SELECT id, state, error_code, posted_at, external_post_id, external_post_url FROM sns_x_send_jobs WHERE draft_id=$1",
      [draftId],
    ),
  saveFile: async (p, bytes) => saved.push([p, bytes.byteLength]),
  insertDraft: (row) =>
    first(
      `INSERT INTO sns_drafts(content_group_id,platform,language,status,format,title,caption_text,hashtags,publish_blocked,
        publication_hold_reasons,send_lane,scheduled_at,cover_image_path,source_data)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [
        row.content_group_id,
        row.platform,
        row.language,
        row.status,
        row.format,
        row.title,
        row.caption_text,
        row.hashtags,
        row.publish_blocked,
        JSON.stringify(row.publication_hold_reasons),
        row.send_lane,
        row.scheduled_at,
        row.cover_image_path,
        row.source_data,
      ],
    ),
  insertItem: (row) =>
    first(
      `INSERT INTO sns_auto_send_items(kind,variant,draft_id,channel,race_id,deadline_at,notify_by,veto_until,state,checks,notified_at,stop_token_hash,held_reason)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [
        row.kind,
        row.variant,
        row.draft_id,
        row.channel,
        row.race_id,
        row.deadline_at,
        row.notify_by,
        row.veto_until,
        row.state,
        row.checks,
        row.notified_at ?? null,
        row.stop_token_hash ?? null,
        row.held_reason ?? null,
      ],
    ),
  updateItem: async (id, from, patch) => {
    const row = await first(
      "UPDATE sns_auto_send_items SET state=$3, stopped_at=$4, stopped_via=$5, held_reason=$6 WHERE id=$1 AND state=$2 RETURNING *",
      [
        id,
        from,
        patch.state,
        patch.stopped_at ?? null,
        patch.stopped_via ?? null,
        patch.held_reason ?? null,
      ],
    );
    if (!row) throw new Error(`item ${id} を更新できない`);
    return row;
  },
  updateDraft: (id, patch) =>
    first(
      "UPDATE sns_drafts SET source_data=coalesce($2, source_data), publish_blocked=$3 WHERE id=$1 RETURNING *",
      [id, patch.source_data ?? null, patch.publish_blocked],
    ),
  approve: async (a) =>
    (
      await first("SELECT public.approve_sns_x_send($1,$2,$3,$4) r", [
        a.p_draft_id,
        a.p_approver_id,
        a.p_snapshot,
        a.p_scheduled_at,
      ])
    ).r,
};

const push = (b = bundle(), opts = {}, images = IMAGES()) => {
  const f = {
    "/f/bundle.json": new TextEncoder().encode(JSON.stringify(b)),
    ...Object.fromEntries(
      Object.entries(images).map(([name, bytes]) => [`/f/${name}`, bytes]),
    ),
  };
  const notes = [];
  return pushFinalsImage("/f", {
    store,
    readBytes: async (p) => {
      if (!f[p]) throw new Error("no file");
      return f[p];
    },
    notify: async (text) => notes.push(text),
    riskRules,
    // 送る時刻は受け取りの2分後（SEND_DELAY_SEC）。既定は 16:13 に受け取り、16:15（NOW）に送る
    now: PUSHED_AT,
    ...opts,
  }).then((r) => ({ ...r, notes }));
};
const claim = (jobId) =>
  first("SELECT public.transition_sns_x_send($1,'claim','{}'::jsonb) r", [
    jobId,
  ]).then((row) => row.r);

// ---- 後半の場面（verifyData/sns-finals-image-scenes-1.js・sns-finals-image-scenes-2.js・sns-finals-image-scenes-3.js） ----
runSnsFinalsImageScenes2({ db, first, riskRules, RACE, DEADLINE, NAMES, NOW, at, png, setClock, bundle, IMAGES, MAIN_JOB, MAIN_JOB_ID, saved, push, claim });
runSnsFinalsImageScenes3({ db, first, all, RACE, DEADLINE, at, bundle, MAIN_JOB, MAIN_JOB_ID, store, push, claim });
runSnsFinalsImageScenes4({ db, first, riskRules, RACE, DEADLINE, NAMES, NOW, at, setClock, bundle, POLL, MAIN_JOB_ID, store, push, claim });
// ---- 177: 本投稿へのリプ2つ（投票のリプ・展示後のリプ） ----

const post = async (jobId, tweetId, postedAt) => {
  await claim(jobId);
  await first(
    "SELECT public.transition_sns_x_send($1,'begin_post','{}'::jsonb)",
    [jobId],
  );
  await first("SELECT public.transition_sns_x_send($1,'complete',$2::jsonb)", [
    jobId,
    JSON.stringify({ id: tweetId, posted_at: postedAt }),
  ]);
};

// ---- 後半の場面（verifyData/sns-finals-image-scenes-3.js・sns-finals-image-scenes-4.js） ----
runSnsFinalsImageScenes5({ db, first, riskRules, RACE, DEADLINE, NAMES, NOW, at, setClock, bundle, POLL, MAIN_JOB_ID, store, push, claim, post });
runSnsFinalsImageScenes6({ db, first, all, RACE, DEADLINE, NOW, at, png, setClock, bundle, POLL, MAIN_JOB, POLL_JOB, store, push, claim, post });

test("投票のリプを送る: 本投稿へのリプで poll.options と duration_minutes（送る時から締切まで）を X に渡し、媒体は上げない", async () => {
  await push();
  const main = await first(MAIN_JOB);
  const poll = await first(POLL_JOB);
  await post(main.id, "1890000000000000012", "2037-10-26T07:16:00Z");
  await setClock(at("16:16:00"));
  const x = createMockXAdapter({ postId: "1890000000000000013" });
  const sendStore = {
    transition: async (id, action, r = {}) =>
      (
        await first("SELECT public.transition_sns_x_send($1,$2,$3::jsonb) r", [
          id,
          action,
          JSON.stringify(r),
        ])
      ).r,
    parent: (id) =>
      first("SELECT external_post_id FROM sns_x_send_jobs WHERE id=$1", [id]),
  };
  const done = await runXSendJob(poll.id, {
    store: sendStore,
    x,
    wait: async () => {},
    loadMedia: async () => assert.fail("投票のリプに媒体は無い"),
    preflight: async () => {},
    now: () => at("16:16:00").getTime(),
  });
  assert.equal(done.state, "posted");
  assert.deepEqual(
    x.calls.map((c) => c.method),
    ["createPost"],
  );
  assert.deepEqual(x.calls[0].payload, {
    text: bundle().poll_text,
    mediaIds: [],
    replyTo: "1890000000000000012",
    poll: { options: POLL, duration_minutes: 14 },
  });
  // 本番の adapter: POST /2/tweets の本文に poll を入れる。投票と媒体は同居させない
  const bodies = [];
  const real = createXApiAdapter({
    accessToken: "tok",
    fetchImpl: async (url, options) => {
      bodies.push(JSON.parse(options.body));
      return new Response(
        JSON.stringify({ data: { id: "1890000000000000014" } }),
        { status: 201 },
      );
    },
  });
  await real.createPost({
    text: "t",
    replyTo: "1890000000000000012",
    poll: { options: POLL, duration_minutes: 14 },
  });
  assert.deepEqual(bodies[0], {
    text: "t",
    reply: { in_reply_to_tweet_id: "1890000000000000012" },
    poll: { options: POLL, duration_minutes: 14 },
  });
  await assert.rejects(
    real.createPost({
      text: "t",
      mediaIds: ["m1"],
      poll: { options: POLL, duration_minutes: 14 },
    }),
    /投票と媒体/,
  );
  // 下書きに投票と画像が両方あれば snapshot を作らない（承認の前に止める）
  await assert.rejects(
    createXSnapshot(
      {
        platform: "x",
        language: "ja",
        caption_text: "t",
        hashtags: [],
        cover_image_path: "a.png",
        source_data: { x_poll: { options: POLL, closes_at: DEADLINE } },
      },
      async () => new Uint8Array(10),
    ),
    /同じ投稿に載せられない/,
  );
  // 承認した snapshot の投票の形が壊れていたら、begin_post の前に保留（X へは何も送らない）
  const broken = JSON.parse((await first(POLL_JOB)).snapshot_text);
  broken.poll.options = ["only"];
  const text = JSON.stringify(broken);
  const actions = [];
  const x2 = createMockXAdapter();
  await assert.rejects(
    runXSendJob("j-broken", {
      store: {
        transition: async (id, action, r) => {
          actions.push([action, r?.reason ?? null]);
          return {
            id,
            state: "sending",
            channel: "x",
            snapshot_text: text,
            approved_hash: createHash("sha256").update(text).digest("hex"),
          };
        },
      },
      x: x2,
      wait: async () => {},
      loadMedia: async () => new Uint8Array(1),
      preflight: async () => {},
    }),
    /poll_invalid/,
  );
  assert.deepEqual(x2.calls, []);
  assert.deepEqual(actions, [["claim", null], ["hold", "poll_invalid"]]);
});

// ---- 後半の場面（verifyData/sns-finals-image-scenes-4.js・sns-finals-image-scenes-5.js） ----
runSnsFinalsImageScenes7({ db, first, all, RACE, DEADLINE, NOW, at, png, setClock, bundle, POLL, MAIN_JOB, POLL_JOB, store, push, claim, post });
runSnsFinalsImageScenes8({ db, first, all, riskRules, RACE, NOW, at, PUSHED_AT, png, setClock, bundle, POLL, MAIN_JOB, POLL_JOB, store, push, claim, post });
