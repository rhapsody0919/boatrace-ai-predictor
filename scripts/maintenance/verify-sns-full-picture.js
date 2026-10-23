// 全貌動画（format=full_picture）の受け取りと自動送信（マイグレーション 161、scripts/sns/push-full-picture.js、2026-10-18）の再現テスト。
// PGlite に 161 までのマイグレーションを当て、本番と同じ承認の関数（approve_sns_x_send、160）・送信の claim（transition_sns_send_139、158）で通す。外部接続なし
import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import {
  checkFullPicture,
  pushFullPicture,
  schedule,
} from "../sns/push-full-picture.js";
import { createReadCurrent } from "../../api/_lib/snsClaimCheck.js";

const db = new PGlite();
const first = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const all = async (sql, args = []) => (await db.query(sql, args)).rows;
const riskRules = JSON.parse(
  await readFile(
    new URL("../../sns-video-studio/remotion/risk-rules.json", import.meta.url),
    "utf8",
  ),
).rules;
const RACE = "2037-10-18-20-12";
// 締切 20:36 JST。素材は 19:20 に届く
const NOW = new Date("2037-10-18T19:20:00+09:00");
const VIDEO = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 1, 2, 3]);

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
    DELETE FROM races;
    UPDATE sns_auto_send_control SET mode='auto', dry_run=false;`);
  await db.query("UPDATE test_clock SET value=$1", [NOW.toISOString()]);
  await db.query("INSERT INTO races VALUES($1,$2,'20:36:00',NULL)", [
    RACE,
    RACE.slice(0, 10),
  ]);
});
after(() => db.close());

const bundle = (patch = {}) => ({
  format: "full_picture",
  race_id: RACE,
  x_text: `若松12R、逃げ一本でいい？\n\nhttps://www.boat-ai.jp/race/${RACE}?tab=sonar&sonar=similar&utm_source=x&utm_medium=social`,
  youtube_full: {
    title: "若松12R、逃げ一本でいい？",
    description: `若松12R の全貌。\nhttps://www.boat-ai.jp/race/${RACE}?tab=sonar&utm_source=youtube`,
  },
  shorts: { title: "若松12R", description: "短縮版" },
  review: {
    p0_count: 0,
    p1_count: 2,
    reviewer: "test",
    checked_at: NOW.toISOString(),
  },
  qa: { machine: { sceneContract: true, verify: true }, bannedWords: [] },
  ...patch,
});

const SHORTS = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 9, 9, 9]);
const files = (b, shorts = SHORTS) => ({
  "/f/bundle.json": new TextEncoder().encode(JSON.stringify(b)),
  "/f/full-x.mp4": VIDEO,
  "/f/full-youtube.mp4": VIDEO,
  ...(shorts ? { "/f/shorts.mp4": shorts } : {}),
});
// bundle の版 2（Shorts つき、BOA-912）
const bundleV2 = (patch = {}) =>
  bundle({
    bundle_version: 2,
    youtube_shorts: {
      title: "若松12R、49秒で全貌",
      description: "入口版。完全版は {full_url} で",
    },
    qa: {
      machine: {
        sceneContract: true,
        verify: true,
        shorts_vertical: true,
        shorts_max_60s: true,
      },
      bannedWords: [],
    },
    ...patch,
  });

const saved = [];
const store = {
  race: (id) =>
    first(
      "SELECT race_id, race_date::text, start_time::text, cancellation_status FROM races WHERE race_id=$1",
      [id],
    ),
  controls: async () =>
    Object.fromEntries(
      (
        await all(
          "SELECT channel, mode, dry_run, auto_approver_id FROM sns_auto_send_control",
        )
      ).map((r) => [r.channel, r]),
    ),
  saveFile: async (p, bytes) => saved.push([p, bytes.byteLength]),
  insertDraft: (row) =>
    first(
      `INSERT INTO sns_drafts(content_group_id,platform,language,status,format,title,caption_text,hashtags,publish_blocked,
        publication_hold_reasons,send_lane,scheduled_at,video_storage_path,source_data)
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
        row.video_storage_path,
        row.source_data,
      ],
    ),
  insertItem: (row) =>
    store.failInsertItem?.(row)
      ? Promise.reject(new Error("item_insert_failed"))
      : first(
          `INSERT INTO sns_auto_send_items(kind,draft_id,channel,race_id,deadline_at,notify_by,veto_until,state,checks,notified_at,stop_token_hash,variant)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,coalesce($12,'main')) RETURNING *`,
          [
            row.kind,
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
            row.variant ?? null,
          ],
        ),
  updateItem: (id, from, patch) =>
    first(
      "UPDATE sns_auto_send_items SET state=$3 WHERE id=$1 AND state=$2 RETURNING *",
      [id, from, patch.state],
    ),
  approve: async (a) => {
    if (
      store.failApprove === true ||
      (typeof store.failApprove === "function" && store.failApprove(a))
    )
      throw new Error("approve_failed");
    return (
      await first("SELECT public.approve_sns_x_send($1,$2,$3,$4) r", [
        a.p_draft_id,
        a.p_approver_id,
        a.p_snapshot,
        a.p_scheduled_at,
      ])
    ).r;
  },
  setParentJob: (draft, parentJobId) =>
    first(
      "UPDATE sns_drafts SET source_data = jsonb_set(source_data, '{deadline_queue,parent_job_id}', to_jsonb($2::text)) WHERE id=$1 RETURNING *",
      [draft.id, parentJobId],
    ),
};

const push = (b = bundle(), opts = {}, shorts = SHORTS) => {
  const f = files(b, shorts);
  const notes = [];
  return pushFullPicture("/f", {
    store,
    readBytes: async (p) => {
      if (!f[p]) throw new Error("no file");
      return f[p];
    },
    notify: async (text) => notes.push(text),
    riskRules,
    now: NOW,
    ...opts,
  }).then((r) => ({ ...r, notes }));
};

test("161: item の種類に full_picture を足し、下書きに直接ひもづく X・YouTube の item を作れる（race・digest の決まりは変えない）", async () => {
  const def = await first(
    "SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conname='sns_auto_send_items_kind_source'",
  );
  assert.match(def.d, /full_picture/);
  await assert.rejects(
    db.query(
      "INSERT INTO sns_auto_send_items(kind,channel,race_id,deadline_at,notify_by,veto_until) VALUES('full_picture','x','r',test_now()+interval '3h',test_now(),test_now()+interval '1h')",
    ),
    /kind_source/,
  );
});

test("hq のフォルダを受け取り、X・YouTube を自動送信の承認者で承認して job を作る。送る時刻は締切の60分前と5分後の遅い方", async () => {
  const result = await push();
  assert.equal(result.reasons, undefined);
  const items = await all("SELECT * FROM sns_auto_send_items ORDER BY channel");
  assert.deepEqual(
    items.map((i) => [i.kind, i.channel, i.state]),
    [
      ["full_picture", "x", "notified"],
      ["full_picture", "youtube", "notified"],
    ],
  );
  const auto = (
    await first(
      "SELECT auto_approver_id FROM sns_auto_send_control WHERE channel='x'",
    )
  ).auto_approver_id;
  const jobs = await all(
    "SELECT j.*, d.platform FROM sns_x_send_jobs j JOIN sns_drafts d ON d.id=j.draft_id ORDER BY d.platform",
  );
  assert.deepEqual(
    jobs.map((j) => [j.platform, j.state, j.approver_id === auto]),
    [
      ["x", "queued", true],
      ["youtube", "queued", true],
    ],
  );
  // 締切 20:36 の60分前は 19:36。今（19:20）から5分後の 19:25 より遅い。YouTube は X の4分後の 19:40
  // （送信の cron の1回の実行で両方を送ると、Chromium の確認の上限6回を超えるため。2026-10-18 レビューの指摘）
  assert.deepEqual(
    jobs.map((j) => [j.platform, j.scheduled_at.toISOString()]),
    [
      ["x", "2037-10-18T10:36:00.000Z"],
      ["youtube", "2037-10-18T10:40:00.000Z"],
    ],
  );
  // 失効は締切の30分前（expiry_minutes=30 と同じ）
  assert.ok(
    jobs.every(
      (j) => j.expires_at.toISOString() === "2037-10-18T11:06:00.000Z",
    ),
  );
  assert.equal(jobs[0].auto_item_id, items[0].id);
  assert.match(result.notes[0], /x: 19:36 に自動で送る/);
  assert.match(result.notes[0], /paused = true/);
  assert.equal(saved.length >= 2, true);
  // X の本文は hq の文のまま。YouTube の題・概要欄は youtube_full
  const yt = await first("SELECT * FROM sns_drafts WHERE platform='youtube'");
  assert.equal(yt.title, "若松12R、逃げ一本でいい？");
  assert.match(yt.caption_text, /若松12R の全貌/);
});

test("送る直前の読み直し（readCurrent）: 全貌動画の下書きは、レースの中止・欠場・締切と取り込んだ時の版を返す", async () => {
  await push();
  const x = await first("SELECT * FROM sns_drafts WHERE platform='x'");
  const readCurrent = createReadCurrent({
    db: async (p) => {
      if (p.startsWith("sns_drafts")) return [x];
      if (p.startsWith("races"))
        return [
          {
            race_date: "2037-10-18",
            start_time: "20:36:00",
            cancellation_status: null,
          },
        ];
      return [];
    },
  });
  const current = await readCurrent(x.id);
  assert.deepEqual(current, {
    withdrawn: false,
    cancelled: false,
    deadline_at: "2037-10-18T11:36:00.000Z",
    source_revision: x.source_data.full_picture.revision,
  });
  assert.equal(
    current.source_revision,
    x.source_data.deadline_queue.source_revision,
  );
});

test("P0 がある・機械の検査が通っていない・URL が別のレース・禁止表現・動画が無い素材は受け取らない", async () => {
  assert.match(
    checkFullPicture(bundle({ review: { p0_count: 1 } }), riskRules).join(),
    /P0/,
  );
  assert.match(
    checkFullPicture(
      bundle({ qa: { machine: { verify: false } } }),
      riskRules,
    ).join(),
    /機械の検査/,
  );
  assert.match(
    checkFullPicture(
      bundle({
        x_text: "https://www.boat-ai.jp/race/2037-10-18-01-01?tab=sonar",
      }),
      riskRules,
    ).join(),
    /URL/,
  );
  const result = await pushFullPicture("/f", {
    store,
    readBytes: async (p) => {
      if (p.endsWith("bundle.json"))
        return new TextEncoder().encode(JSON.stringify(bundle()));
      throw new Error("no file");
    },
    riskRules,
    now: NOW,
  });
  assert.match(result.reasons.join(), /full-x.mp4 が無い/);
  assert.equal((await all("SELECT * FROM sns_drafts")).length, 0);
});

test("締切の45分前を過ぎた・中止のレースは受け取らない。--dry-run は書かない", async () => {
  const late = await push(bundle(), {
    now: new Date("2037-10-18T19:57:00+09:00"),
  });
  assert.match(late.reasons.join(), /45分前/);
  const dry = await push(bundle(), { dryRun: true });
  assert.equal(dry.dryRun, true);
  assert.equal((await all("SELECT * FROM sns_drafts")).length, 0);
  await db.query("UPDATE races SET cancellation_status='confirmed'");
  assert.match((await push()).reasons.join(), /中止/);
  // 60分前を過ぎて45分前より前なら、送るのは今から5分後
  assert.equal(
    schedule("2037-10-18T11:36:00.000Z", new Date("2037-10-18T19:45:00+09:00"))
      .send_at,
    "2037-10-18T10:50:00.000Z",
  );
});

test("mode=manual なら item を manual にして個別承認に回す。承認に失敗したら manual に戻す", async () => {
  await db.exec(
    "UPDATE sns_auto_send_control SET mode='manual' WHERE channel='youtube'",
  );
  store.failApprove = true;
  try {
    const result = await push();
    assert.equal(result.channels.youtube.auto, false);
    assert.match(result.channels.x.error, /approve_failed/);
  } finally {
    store.failApprove = false;
  }
  const items = await all(
    "SELECT channel, state FROM sns_auto_send_items ORDER BY channel",
  );
  assert.deepEqual(
    items.map((i) => i.state),
    ["manual", "manual"],
  );
  assert.equal((await all("SELECT * FROM sns_x_send_jobs")).length, 0);
});

test("送信の claim: 送る時刻（締切の60分前）より前は veto_window_open で待ち、過ぎたら claim できる（自動送信の承認者の job）", async () => {
  await db.exec(
    "UPDATE sns_x_send_control SET paused=false, timing_approved=true, max_source_age_seconds=14400, daily_limit_x=2, daily_limit_youtube=2, daily_baseline_date=(test_now() AT TIME ZONE 'Asia/Tokyo')::date, daily_external_count=0, period_start=test_now() - interval '1 day', period_end=test_now() + interval '30 days', budget_microusd=20000000, reserved_microusd=0, attempt_ceiling_microusd=250000, ceiling_x_url_microusd=250000, ceiling_x_plain_microusd=30000",
  );
  await push();
  const job = await first(
    "SELECT j.id FROM sns_x_send_jobs j JOIN sns_drafts d ON d.id=j.draft_id WHERE d.platform='x'",
  );
  await assert.rejects(
    db.query("SELECT public.transition_sns_x_send($1,'claim','{}'::jsonb)", [
      job.id,
    ]),
    /veto_window_open/,
  );
  await db.query("UPDATE test_clock SET value=$1", [
    new Date("2037-10-18T19:37:00+09:00").toISOString(),
  ]);
  const r = await first(
    "SELECT public.transition_sns_x_send($1,'claim','{}'::jsonb) r",
    [job.id],
  );
  assert.equal(r.r.state, "sending");
});

test("172: 全貌の YouTube は完全版（main）と Shorts の item を1レースに1件ずつ持てる。Shorts は全貌の YouTube だけ", async () => {
  const insert = (channel, variant, kind = "full_picture") =>
    db.query(
      `WITH draft AS (INSERT INTO sns_drafts(content_group_id,platform,language,format,caption_text)
         VALUES(gen_random_uuid(), $2, 'ja', 'full_picture', '172') RETURNING id)
       INSERT INTO sns_auto_send_items(kind,draft_id,channel,race_id,deadline_at,notify_by,veto_until,variant)
       VALUES($1, (SELECT id FROM draft), $2, 'r172', test_now()+interval '3h', test_now(), test_now()+interval '1h', $3)`,
      [kind, channel, variant],
    );
  await insert("youtube", "main");
  await insert("youtube", "shorts");
  await assert.rejects(insert("youtube", "shorts"), /race_channel/);
  await assert.rejects(insert("x", "shorts"), /variant_scope/);
  await assert.rejects(insert("youtube", "other"), /variant/);
  const def = await first(
    "SELECT indexdef FROM pg_indexes WHERE indexname='sns_auto_send_items_race_channel'",
  );
  assert.match(def.indexdef, /\(race_id, channel, variant\)/);
});

test("bundle の版2: Shorts の下書きを足し、親（完全版の job）を待って完全版の4分後に送る。版1は今までどおり2件", async () => {
  const result = await push(bundleV2());
  assert.equal(result.reasons, undefined);
  const items = await all(
    "SELECT channel, variant, state FROM sns_auto_send_items ORDER BY channel, variant",
  );
  assert.deepEqual(
    items.map((i) => [i.channel, i.variant, i.state]),
    [
      ["x", "main", "notified"],
      ["youtube", "main", "notified"],
      ["youtube", "shorts", "notified"],
    ],
  );
  const full = await first("SELECT * FROM sns_x_send_jobs WHERE id=$1", [
    result.channels.youtube.job_id,
  ]);
  const shorts = await first("SELECT * FROM sns_x_send_jobs WHERE id=$1", [
    result.channels.shorts.job_id,
  ]);
  // Shorts は完全版の job を親に持つ（承認の snapshot にも入る）。送る時刻は完全版の4分後
  assert.equal(shorts.parent_job_id, full.id);
  assert.equal(JSON.parse(shorts.snapshot_text).queue.parent_job_id, full.id);
  assert.equal(full.scheduled_at.toISOString(), "2037-10-18T10:40:00.000Z");
  assert.equal(shorts.scheduled_at.toISOString(), "2037-10-18T10:44:00.000Z");
  // 承認する文は置き場所つき（送る時に完全版の URL に置き換える）
  assert.match(JSON.parse(shorts.snapshot_text).text, /\{full_url\}/);
  assert.equal(
    JSON.parse(shorts.snapshot_text).youtube_title,
    "若松12R、49秒で全貌",
  );
  assert.match(
    result.notes[0],
    /youtube（Shorts）: 19:44 に自動で送る（完全版の公開の後/,
  );
  // 親が未公開の間、Shorts の claim は parent_not_posted で止まる
  await db.exec(
    "UPDATE sns_x_send_control SET paused=false, timing_approved=true, max_source_age_seconds=14400, daily_limit_x=2, daily_limit_youtube=3, daily_baseline_date=(test_now() AT TIME ZONE 'Asia/Tokyo')::date, daily_external_count=0, period_start=test_now() - interval '1 day', period_end=test_now() + interval '30 days', budget_microusd=20000000, reserved_microusd=0, attempt_ceiling_microusd=250000, ceiling_x_url_microusd=250000, ceiling_x_plain_microusd=30000",
  );
  await db.query("UPDATE test_clock SET value=$1", [
    new Date("2037-10-18T19:45:00+09:00").toISOString(),
  ]);
  const claimed = await first(
    "SELECT public.transition_sns_x_send($1,'claim','{}'::jsonb) r",
    [shorts.id],
  );
  assert.equal(claimed.r.error_code, "parent_not_posted");
  // 本番の claim（158）は、YouTube の親（完全版）が posted で外部 ID があれば、Shorts の claim を通す
  await db.exec(
    "UPDATE sns_youtube_quota_control SET verified=true, baseline_day=(test_now() AT TIME ZONE 'America/Los_Angeles')::date, upload_limit=10, general_limit=10000, external_uploads=0, external_general=0",
  );
  await db.query(
    "UPDATE sns_x_send_jobs SET state='queued', error_code=NULL WHERE id=$1",
    [shorts.id],
  );
  await db.query(
    "UPDATE sns_x_send_jobs SET state='posted', external_post_id='fullvideo01', posted_at=test_now() WHERE id=$1",
    [full.id],
  );
  const again = await first(
    "SELECT public.transition_sns_x_send($1,'claim','{}'::jsonb) r",
    [shorts.id],
  );
  assert.equal(again.r.state, "sending");
});

test("bundle の版2の検査: 置き場所がちょうど1つ・題名が完全版と別・Shorts の機械の検査・shorts.mp4・版の値", async () => {
  const reasonsOf = (b) => checkFullPicture(b, riskRules).join();
  assert.equal(reasonsOf(bundleV2()), "");
  assert.match(
    reasonsOf(
      bundleV2({ youtube_shorts: { title: "a", description: "URL なし" } }),
    ),
    /ちょうど1つ/,
  );
  assert.match(
    reasonsOf(
      bundleV2({
        youtube_shorts: { title: "a", description: "{full_url} {full_url}" },
      }),
    ),
    /ちょうど1つ/,
  );
  assert.match(
    reasonsOf(
      bundleV2({
        youtube_shorts: {
          title: "若松12R、逃げ一本でいい？",
          description: "{full_url}",
        },
      }),
    ),
    /youtube_full.title と同じ/,
  );
  assert.match(
    reasonsOf(
      bundleV2({
        youtube_shorts: {
          title: "a",
          description: "{full_url}" + "あ".repeat(4980),
        },
      }),
    ),
    /5000字/,
  );
  assert.match(
    reasonsOf(bundleV2({ qa: { machine: { verify: true }, bannedWords: [] } })),
    /shorts_vertical/,
  );
  assert.match(
    reasonsOf(bundle({ bundle_version: 3 })),
    /bundle_version が不正/,
  );
  // 版1は youtube_shorts を見ない（今の bundle の shorts の欄があっても2件のまま）
  assert.equal(reasonsOf(bundle()), "");
  const missing = await push(bundleV2(), {}, null);
  assert.match(missing.reasons.join(), /shorts.mp4 が無い/);
  assert.equal((await all("SELECT * FROM sns_drafts")).length, 0);
});

test("bundle の版2: 締切の50分前を過ぎて届いたら Shorts だけ作らず、Slack に書く。版には shorts.mp4 も入る", async () => {
  const late = await push(bundleV2(), {
    now: new Date("2037-10-18T19:47:00+09:00"),
  });
  assert.equal(late.reasons, undefined);
  assert.equal(late.shortsLate, true);
  assert.deepEqual(Object.keys(late.channels), ["x", "youtube"]);
  assert.match(late.notes[0], /50分前を過ぎて届いたので作らなかった/);
  const a = await push(bundleV2(), { dryRun: true });
  const b = await push(
    bundleV2(),
    { dryRun: true },
    new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 7]),
  );
  assert.notEqual(a.revision, b.revision);
});

test("bundle の版2: 完全版の自動の承認に失敗したら、Shorts も自動では承認せず個別承認に回す", async () => {
  store.failApprove = (a) =>
    a.p_snapshot.youtube_title === "若松12R、逃げ一本でいい？";
  try {
    const result = await push(bundleV2());
    assert.match(result.channels.youtube.error, /approve_failed/);
    assert.match(
      result.channels.shorts.error,
      /完全版が自動で承認されなかった/,
    );
    assert.match(result.notes[0], /Shorts は個別承認では送れない/);
    assert.ok(result.channels.x.send_at);
  } finally {
    store.failApprove = false;
  }
  const items = await all(
    "SELECT channel, variant, state FROM sns_auto_send_items ORDER BY channel, variant",
  );
  assert.deepEqual(
    items.map((i) => i.state),
    ["notified", "manual", "manual"],
  );
});

test("bundle の版2: Shorts の item を作れなくても（172 が未適用等）、X と完全版は承認して送る。Shorts は作らなかったと Slack に書く", async () => {
  store.failInsertItem = (row) => row.variant === "shorts";
  try {
    const result = await push(bundleV2());
    assert.equal(result.reasons, undefined);
    assert.ok(result.channels.x.send_at);
    assert.ok(result.channels.youtube.send_at);
    assert.equal(result.channels.shorts, undefined);
    assert.match(result.shortsError, /item_insert_failed/);
    assert.match(result.notes[0], /Shorts）: 下書き・item を作れなかった/);
  } finally {
    store.failInsertItem = null;
  }
  assert.equal((await all("SELECT * FROM sns_x_send_jobs")).length, 2);
});

test("版1の bundle の版（revision）は、Shorts 対応の前と同じ式（bundle・X の動画・完全版の動画の順の sha256）", async () => {
  const { createHash } = await import("node:crypto");
  const b = bundle();
  const expected = createHash("sha256")
    .update(JSON.stringify(b))
    .update(VIDEO)
    .update(VIDEO)
    .digest("hex")
    .slice(0, 32);
  assert.equal((await push(b, { dryRun: true })).revision, expected);
});

test("完全版の URL の置き場所は Shorts の説明文だけ。X の本文・完全版に入っていたら受け取らない", async () => {
  const reasonsOf = (b) => checkFullPicture(b, riskRules).join();
  assert.match(
    reasonsOf(
      bundleV2({
        youtube_full: { title: "完全版", description: "続きは {full_url}" },
      }),
    ),
    /youtube_full.description に \{full_url\} がある/,
  );
  assert.match(
    reasonsOf(bundle({ x_text: bundle().x_text + " {full_url}" })),
    /x_text に \{full_url\} がある/,
  );
});

test("x_text の検査は1回だけ（{full_url} の欄のループに入れない）。x_text が無い bundle でも例外にせず理由を返す", async () => {
  const reasons = checkFullPicture(
    bundle({
      x_text: "https://www.boat-ai.jp/race/2037-10-18-01-01?tab=sonar",
    }),
    riskRules,
  );
  assert.equal(reasons.filter((r) => /このレースの URL/.test(r)).length, 1);
  const noText = checkFullPicture(bundle({ x_text: undefined }), riskRules);
  assert.deepEqual(
    noText.filter((r) => /x_text/.test(r)),
    ["x_text が無い・長すぎる"],
  );
});

// BOA-909: 検査で拒否した束は理由を1回通知し、試運転では通知しない。
const rejectionCases = [
  ["欄", () => bundle({ x_text: undefined }), {}, /x_text/],
  ["P0", () => bundle({ review: { p0_count: 1 } }), {}, /P0/],
  ["機械", () => bundle({ qa: { machine: { verify: false } } }), {}, /機械/],
  ["動画欠落", bundleV2, { missingVideo: true }, /shorts.mp4 が無い/],
  ["レース無し", bundle, { race: null }, /レースが見つからない/],
  ["中止", bundle, { cancelled: true }, /レースが中止/],
  ["締切45分前", bundle, { now: new Date("2037-10-18T19:51:00+09:00") }, /45分前/],
  ["複数理由", () => bundle({ x_text: undefined, review: { p0_count: 1 } }), {}, /P0/],
];
for (const [name, makeBundle, scenario, expected] of rejectionCases) {
  test(`BOA-909: ${name} の拒否理由と race_id を1回通知する（dry-run は通知しない）`, async () => {
    const b = makeBundle();
    const f = files(b);
    if (scenario.missingVideo) delete f["/f/shorts.mp4"];
    const readBytes = async (p) => {
      if (!f[p]) throw new Error("no file");
      return f[p];
    };
    const raceStore = {
      ...store,
      race: async (id) => scenario.race === null ? null : {
        ...(await store.race(id)),
        ...(scenario.cancelled ? { cancellation_status: "confirmed" } : {}),
      },
    };
    const savedBefore = saved.length;
    let reasons;
    for (const dryRun of [false, true]) {
      const result = await push(b, {
        store: raceStore, readBytes, dryRun, now: scenario.now ?? NOW,
      });
      assert.match(result.reasons.join("\n"), expected);
      assert.equal(result.notes.length, dryRun ? 0 : 1);
      if (!dryRun) {
        reasons = result.reasons;
        assert.ok(result.notes[0].includes(RACE));
        assert.ok(result.notes[0].includes(reasons.join("\n")));
      } else assert.deepEqual(result.reasons, reasons);
    }
    assert.equal(saved.length, savedBefore);
    assert.equal((await all("SELECT * FROM sns_drafts")).length, 0);
    assert.equal((await all("SELECT * FROM sns_auto_send_items")).length, 0);
    assert.equal((await all("SELECT * FROM sns_x_send_jobs")).length, 0);
  });
}

test("BOA-909: notify の同期例外・非同期拒否でも元の拒否理由を返す", async (t) => {
  const errors = [];
  t.mock.method(console, "error", (...args) => errors.push(args));
  const b = bundle({ x_text: undefined, review: { p0_count: 1 } });
  const reasons = checkFullPicture(b, riskRules);
  for (const asyncFailure of [false, true]) {
    let calls = 0;
    const result = await push(b, {
      notify: () => {
        calls++;
        if (asyncFailure) return Promise.reject(new Error("notify_failed"));
        throw new Error("notify_failed");
      },
    });
    assert.equal(calls, 1);
    assert.deepEqual(result.reasons, reasons);
  }
  assert.equal(errors.length, 2);
});
