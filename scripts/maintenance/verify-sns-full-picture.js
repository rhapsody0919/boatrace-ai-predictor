// 全貌動画（format=full_picture）の受け取りと自動送信（マイグレーション 161、scripts/sns/push-full-picture.js、2026-10-18）の再現テスト。
// PGlite に 161 までのマイグレーションを当て、本番と同じ承認の関数（approve_sns_x_send、160）・送信の claim（transition_sns_send_139、158）で通す。外部接続なし
import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import {
  bakedDeadlineReasons,
  checkFullPicture,
  pushFullPicture,
  schedule,
  THUMBNAIL_MAX_BYTES,
} from "../sns/push-full-picture.js";
import { createReadCurrent } from "../../api/_lib/snsClaimCheck.js";
import { youtubeTagsOf } from "../../api/_lib/youtubeQueueAdapter.js";

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
  saveFile: async (p, bytes, contentType = "video/mp4") =>
    saved.push([p, bytes.byteLength, contentType]),
  insertDraft: (row) =>
    first(
      `INSERT INTO sns_drafts(content_group_id,platform,language,status,format,title,caption_text,hashtags,publish_blocked,
        publication_hold_reasons,send_lane,scheduled_at,video_storage_path,source_data,cover_image_path)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
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
        row.cover_image_path ?? null,
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
  // 本物の store と同じく、条件（前の state）に合う行がちょうど1つでなければ投げる
  updateItem: async (id, from, patch) => {
    const row = await first(
      "UPDATE sns_auto_send_items SET state=$3, stopped_at=coalesce($4,stopped_at), stopped_via=coalesce($5,stopped_via) WHERE id=$1 AND state=$2 RETURNING *",
      [
        id,
        from,
        patch.state,
        patch.stopped_at ?? null,
        patch.stopped_via ?? null,
      ],
    );
    if (!row) throw new Error(`item ${id} を更新できない`);
    return row;
  },
  liveFullPicture: async (raceId) => {
    const items = await all(
      `SELECT i.id, i.draft_id, i.channel, i.variant, i.state, i.deadline_at::text,
         d.source_data->'full_picture'->>'revision' AS revision
       FROM sns_auto_send_items i JOIN sns_drafts d ON d.id=i.draft_id
       WHERE i.race_id=$1 AND i.kind='full_picture' AND i.state NOT IN ('stopped','held_manual')`,
      [raceId],
    );
    for (const item of items)
      item.jobs = await all(
        "SELECT id, state, attempts FROM sns_x_send_jobs WHERE draft_id=$1",
        [item.draft_id],
      );
    return items;
  },
  holdJob: async (jobId, reason) => {
    if (store.failHold) throw new Error("hold_failed");
    return (
      await first("SELECT public.transition_sns_x_send($1,'hold',$2) r", [
        jobId,
        { reason },
      ])
    ).r;
  },
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

// opts.files: フォルダに足すファイル（サムネイル等、BOA-1172）
const push = (
  b = bundle(),
  { files: extra = {}, ...opts } = {},
  shorts = SHORTS,
) => {
  const f = { ...files(b, shorts), ...extra };
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

test("182: X の日の枠の全貌の取り置きに入らなければ、X の下書きを作らず YouTube だけ送る。182 の前（404）・読めないときは今のまま", async () => {
  const asked = [];
  store.xSlotRoom = async (kind, need) => {
    asked.push([kind, need]);
    return {
      ok: false,
      reason: "kind_slot_full",
      kind,
      need,
      limit: 8,
      reserve: 4,
      booked: 4,
      others_booked: 1,
      held_for_others: 3,
      external: 0,
    };
  };
  try {
    const result = await push();
    assert.deepEqual(asked, [["full_picture", 1]]);
    assert.deepEqual(Object.keys(result.channels), ["youtube"]);
    assert.ok(result.channels.youtube.job_id);
    assert.deepEqual(
      (await all("SELECT DISTINCT platform FROM sns_drafts")).map(
        (r) => r.platform,
      ),
      ["youtube"],
    );
    assert.ok(
      result.notes.some((n) => /x: 作らなかった.*全貌|full_picture/.test(n)),
    );
    // 182 の前（PostgREST の 404）は止めない
    await db.exec(
      "DELETE FROM sns_x_send_jobs; DELETE FROM sns_auto_send_items; ALTER TABLE sns_drafts DISABLE TRIGGER USER; DELETE FROM sns_drafts; ALTER TABLE sns_drafts ENABLE TRIGGER USER;",
    );
    store.xSlotRoom = async () => {
      throw new Error(
        "DB 操作に失敗: HTTP 404 POST rpc/sns_x_slot_room PGRST202",
      );
    };
    const before = await push();
    assert.ok(before.channels.x?.job_id);
  } finally {
    delete store.xSlotRoom;
  }
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

test("札（full_picture_variant、hq SQ08 v5）: bundle の札を送る下書き（X・完全版・Shorts）の source_data.full_picture_variant.id に写す。a・b 以外は受け取らない", async () => {
  const result = await push(bundleV2({ full_picture_variant: { id: "b" } }));
  assert.equal(result.reasons, undefined);
  const rows = (
    await all(
      "SELECT platform, source_data FROM sns_drafts WHERE format='full_picture' ORDER BY platform",
    )
  ).map((r) => r.source_data.full_picture_variant);
  assert.equal(rows.length, 3);
  assert.ok(
    rows.every((v) => v?.id === "b"),
    JSON.stringify(rows),
  );
  assert.ok(
    checkFullPicture(
      {
        ...bundleV2(),
        full_picture_variant: { id: "c" },
        review: { p0_count: 0 },
      },
      riskRules,
    ).some((r) => r.includes("full_picture_variant")),
  );
  // 札の無い bundle は今までどおり（source_data に札を書かない）
  assert.ok(
    !checkFullPicture(
      { ...bundleV2(), review: { p0_count: 0 } },
      riskRules,
    ).some((r) => r.includes("full_picture_variant")),
  );
});

test("投稿の型（content_type、hq PD02）: bundle の型の id を送る下書き（X・完全版・Shorts）の source_data.content_type.id に写す。id の無い型は受け取らない", async () => {
  const result = await push(
    bundleV2({
      content_type: { id: "e03-one-point-30s" },
      full_picture_variant: { id: "b" },
    }),
  );
  assert.equal(result.reasons, undefined);
  const rows = (
    await all("SELECT source_data FROM sns_drafts WHERE format='full_picture'")
  ).map((r) => r.source_data);
  assert.equal(rows.length, 3);
  assert.ok(
    rows.every(
      (d) =>
        d.content_type?.id === "e03-one-point-30s" &&
        d.full_picture_variant?.id === "b",
    ),
    JSON.stringify(rows.map((d) => d.content_type)),
  );
  assert.ok(
    checkFullPicture(
      { ...bundleV2(), content_type: {}, review: { p0_count: 0 } },
      riskRules,
    ).some((r) => r.includes("content_type")),
  );
  assert.ok(
    !checkFullPicture(
      { ...bundleV2(), review: { p0_count: 0 } },
      riskRules,
    ).some((r) => r.includes("content_type")),
    "型の無い bundle は今までどおり",
  );
});

test("完全版のタグ（youtube_full.tags、hq 契約 10/24 C1）: 完全版の下書きの hashtags に入り、承認の snapshot から YouTube の snippet.tags になる。X・Shorts には付けない", async () => {
  const base = bundleV2();
  // bundle.mjs と同じく、説明文の末尾にタグと同じハッシュタグ行がある
  const description = `${base.youtube_full.description}\n#ボートレース #龍神ソナー #思考アシスト`;
  const result = await push({
    ...base,
    youtube_full: {
      ...base.youtube_full,
      description,
      tags: ["ボートレース", "龍神ソナー", "思考アシスト", "龍神ソナー", ""],
    },
  });
  assert.equal(result.reasons, undefined);
  const job = (id) =>
    first(
      "SELECT j.snapshot_text, d.hashtags FROM sns_x_send_jobs j JOIN sns_drafts d ON d.id=j.draft_id WHERE j.id=$1",
      [id],
    );
  const full = await job(result.channels.youtube.job_id);
  assert.deepEqual(
    full.hashtags,
    ["#ボートレース", "#龍神ソナー", "#思考アシスト"],
    "重複と空は除く",
  );
  assert.deepEqual(youtubeTagsOf(JSON.parse(full.snapshot_text)), [
    "ボートレース",
    "龍神ソナー",
    "思考アシスト",
  ]);
  // 送る文（承認の snapshot の text）は bundle の説明文と同じ。末尾にタグの行が重ならない（代わりの審査 P2-1）
  const text = JSON.parse(full.snapshot_text).text;
  assert.equal(
    text.replace(
      /\n\n#ボートレース #龍神ソナー #思考アシスト$/,
      "\n#ボートレース #龍神ソナー #思考アシスト",
    ),
    description,
    "送る文は説明文と同じ（ハッシュタグ行の前の空行だけ違ってよい）",
  );
  assert.equal(
    text.match(/龍神ソナー/g).length,
    description.match(/龍神ソナー/g).length,
    "タグの語が増えない",
  );
  for (const ch of ["x", "shorts"])
    assert.deepEqual(
      (await job(result.channels[ch].job_id)).hashtags,
      [],
      `${ch} にタグは付けない`,
    );
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
  // 版の比べは、生きた item が無いうちに --dry-run で見る（入れた後は同じ締切の重複として拒否する、BOA-1201）
  const a = await push(bundleV2(), { dryRun: true });
  const b = await push(
    bundleV2(),
    { dryRun: true },
    new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 7]),
  );
  assert.notEqual(a.revision, undefined);
  assert.notEqual(a.revision, b.revision);
  const late = await push(bundleV2(), {
    now: new Date("2037-10-18T19:47:00+09:00"),
  });
  assert.equal(late.reasons, undefined);
  assert.equal(late.shortsLate, true);
  assert.deepEqual(Object.keys(late.channels), ["x", "youtube"]);
  assert.match(late.notes[0], /50分前を過ぎて届いたので作らなかった/);
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

test("BOA-1167: channels に x が無い束は x_text・full-x.mp4 を受けず、X の下書き・item・job・日の枠の確認を作らない。完全版→Shorts の時刻と親は変えない", async () => {
  const b = bundleV2({ channels: ["youtube", "shorts"], x_text: undefined });
  const f = files(b);
  delete f["/f/full-x.mp4"];
  const asked = [];
  store.xSlotRoom = async (kind, need) => {
    asked.push([kind, need]);
    return { ok: true };
  };
  const savedBefore = saved.length;
  let result;
  try {
    result = await push(b, {
      readBytes: async (p) => {
        if (!f[p]) throw new Error("no file");
        return f[p];
      },
    });
  } finally {
    delete store.xSlotRoom;
  }
  assert.equal(result.reasons, undefined);
  assert.deepEqual(asked, []);
  assert.equal(result.xSlot, null);
  assert.deepEqual(Object.keys(result.channels), ["youtube", "shorts"]);
  assert.deepEqual(
    (await all("SELECT DISTINCT platform FROM sns_drafts")).map(
      (r) => r.platform,
    ),
    ["youtube"],
  );
  assert.deepEqual(
    (
      await all(
        "SELECT channel, variant FROM sns_auto_send_items ORDER BY channel, variant",
      )
    ).map((i) => [i.channel, i.variant]),
    [
      ["youtube", "main"],
      ["youtube", "shorts"],
    ],
  );
  const jobs = await all(
    "SELECT id, parent_job_id, scheduled_at FROM sns_x_send_jobs ORDER BY scheduled_at",
  );
  assert.equal(jobs.length, 2);
  // 完全版は締切の60分前（19:36）の4分後、Shorts はさらに4分後で完全版を親に持つ（X があるときと同じ並び）
  assert.deepEqual(
    jobs.map((j) => j.scheduled_at.toISOString()),
    ["2037-10-18T10:40:00.000Z", "2037-10-18T10:44:00.000Z"],
  );
  assert.equal(jobs[1].parent_job_id, jobs[0].id);
  // full-x.mp4 は上げない
  assert.ok(
    saved.slice(savedBefore).every(([p]) => !p.endsWith("/full-x.mp4")),
  );
  assert.match(result.notes[0], /^x: 束の channels に無いので作らない$/m);
  // 版（revision）は bundle・完全版・Shorts の動画の順
  const { createHash } = await import("node:crypto");
  assert.equal(
    result.revision,
    createHash("sha256")
      .update(JSON.stringify(b))
      .update(VIDEO)
      .update(SHORTS)
      .digest("hex")
      .slice(0, 32),
  );
});

test("BOA-1167: channels の検査。x を外すことだけができ（完全版は必須・Shorts は版2と一致）、x を含めば x_text は今までどおり必須", () => {
  const bad = (b) =>
    checkFullPicture(b, riskRules).filter((r) => /channels/.test(r));
  for (const b of [
    bundleV2({ channels: ["shorts"] }),
    bundleV2({ channels: ["youtube"] }),
    bundleV2({ channels: ["youtube", "shorts", "shorts"] }),
    bundleV2({ channels: ["youtube", "shorts", "tiktok"] }),
    bundleV2({ channels: [] }),
    bundleV2({ channels: "youtube,shorts" }),
    bundle({ channels: ["youtube", "shorts"] }),
  ])
    assert.equal(bad(b).length, 1, JSON.stringify(b.channels));
  // 版1の X なし（完全版だけ）・X ありの明示・版2の X なしは通る
  for (const b of [
    bundle({ channels: ["youtube"], x_text: undefined }),
    bundle({ channels: ["x", "youtube"] }),
    bundleV2({ channels: ["youtube", "shorts"], x_text: undefined }),
    bundleV2({ channels: ["x", "youtube", "shorts"] }),
  ])
    assert.deepEqual(
      checkFullPicture(b, riskRules),
      [],
      JSON.stringify(b.channels),
    );
  // x を含む channels では x_text が要る。x を含まなければ x_text の禁止表現・置き場所も見ない
  assert.match(
    checkFullPicture(
      bundle({ channels: ["x", "youtube"], x_text: undefined }),
      riskRules,
    ).join(),
    /x_text が無い/,
  );
  assert.deepEqual(
    checkFullPicture(
      bundleV2({ channels: ["youtube", "shorts"], x_text: "{full_url}" }),
      riskRules,
    ),
    [],
  );
});

test("BOA-1167: channels に x が無い束で Shorts の item を作れなければ、Slack に「X・」を付けずに完全版は送ると書く", async () => {
  const b = bundleV2({ channels: ["youtube", "shorts"], x_text: undefined });
  store.failInsertItem = (row) => row.variant === "shorts";
  try {
    const result = await push(b);
    assert.deepEqual(Object.keys(result.channels), ["youtube"]);
    assert.match(
      result.notes[0],
      /作れなかったので作らなかった（完全版は送る）/,
    );
  } finally {
    store.failInsertItem = null;
  }
});

test("BOA-1167: channels に x が無い束で完全版の動画が無ければ拒否する（full-x.mp4 の有無は問わない）", async () => {
  const b = bundle({ channels: ["youtube"], x_text: undefined });
  const f = files(b);
  delete f["/f/full-youtube.mp4"];
  delete f["/f/full-x.mp4"];
  const result = await push(b, {
    readBytes: async (p) => {
      if (!f[p]) throw new Error("no file");
      return f[p];
    },
  });
  assert.deepEqual(result.reasons, ["full-youtube.mp4 が無い"]);
  assert.equal((await all("SELECT * FROM sns_drafts")).length, 0);
});

// BOA-909: 検査で拒否した束は理由を1回通知し、試運転では通知しない。
const rejectionCases = [
  ["欄", () => bundle({ x_text: undefined }), {}, /x_text/],
  ["P0", () => bundle({ review: { p0_count: 1 } }), {}, /P0/],
  ["機械", () => bundle({ qa: { machine: { verify: false } } }), {}, /機械/],
  ["動画欠落", bundleV2, { missingVideo: true }, /shorts.mp4 が無い/],
  ["レース無し", bundle, { race: null }, /レースが見つからない/],
  ["中止", bundle, { cancelled: true }, /レースが中止/],
  [
    "締切45分前",
    bundle,
    { now: new Date("2037-10-18T19:51:00+09:00") },
    /45分前/,
  ],
  [
    "複数理由",
    () => bundle({ x_text: undefined, review: { p0_count: 1 } }),
    {},
    /P0/,
  ],
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
      race: async (id) =>
        scenario.race === null
          ? null
          : {
              ...(await store.race(id)),
              ...(scenario.cancelled
                ? { cancellation_status: "confirmed" }
                : {}),
            },
    };
    const savedBefore = saved.length;
    let reasons;
    for (const dryRun of [false, true]) {
      const result = await push(b, {
        store: raceStore,
        readBytes,
        dryRun,
        now: scenario.now ?? NOW,
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

// BOA-1172: 型 f01 の完全版のサムネイル（bundle の youtube_full.thumbnail と bundle/thumb-full.png、run-full.mjs）
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13,
]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 1, 2]);
const withThumbnail = (b, thumbnail = "thumb-full.png") => ({
  ...b,
  youtube_full: { ...b.youtube_full, thumbnail },
});
const bundleF01 = (thumbnail) =>
  withThumbnail(bundleV2({ channels: ["youtube", "shorts"] }), thumbnail);
const draftOf = (jobId) =>
  first(
    "SELECT d.cover_image_path, d.video_storage_path, j.snapshot_text FROM sns_x_send_jobs j JOIN sns_drafts d ON d.id=j.draft_id WHERE j.id=$1",
    [jobId],
  );
const clearSent = () =>
  db.exec(
    "UPDATE sns_x_send_jobs SET parent_job_id=NULL; DELETE FROM sns_youtube_quota_attempts; DELETE FROM sns_x_send_jobs; DELETE FROM sns_auto_send_items; ALTER TABLE sns_drafts DISABLE TRIGGER USER; DELETE FROM sns_drafts; ALTER TABLE sns_drafts ENABLE TRIGGER USER;",
  );

test("BOA-1172: f01 の束のサムネイルは完全版の下書きの cover_image_path に入り、承認の snapshot の media が2つになる。Shorts には付けない", async () => {
  for (const [bytes, ext, type] of [
    [PNG, "png", "image/png"],
    [JPEG, "jpg", "image/jpeg"],
  ]) {
    await clearSent();
    const savedBefore = saved.length;
    const result = await push(bundleF01(), {
      files: { "/f/thumb-full.png": bytes },
    });
    assert.equal(result.reasons, undefined, ext);
    const cover = `full-picture/${RACE}/${result.revision}/thumb-full.${ext}`;
    // 保存の拡張子と Content-Type は中身（先頭のバイト列）で決める
    assert.deepEqual(
      saved.slice(savedBefore).find(([p]) => p === cover),
      [cover, bytes.byteLength, type],
      ext,
    );
    const full = await draftOf(result.channels.youtube.job_id);
    assert.equal(full.cover_image_path, cover, ext);
    const snapshot = JSON.parse(full.snapshot_text);
    assert.deepEqual(
      snapshot.media.map((m) => [m.path, m.type, m.size]),
      [
        [full.video_storage_path, "video/mp4", VIDEO.byteLength],
        [cover, type, bytes.byteLength],
      ],
      ext,
    );
    assert.equal(snapshot.source.cover_image_path, cover, ext);
    const shorts = await draftOf(result.channels.shorts.job_id);
    assert.equal(shorts.cover_image_path, null, `${ext}: Shorts には付けない`);
    assert.equal(JSON.parse(shorts.snapshot_text).media.length, 1, ext);
    assert.equal(result.channels.x, undefined);
  }
});

test("BOA-1172: X も出す束でも、サムネイルは完全版だけ。版（revision）は動画の後にサムネイルを足した sha256", async () => {
  const { createHash } = await import("node:crypto");
  const b = withThumbnail(bundleV2());
  const expected = createHash("sha256")
    .update(JSON.stringify(b))
    .update(VIDEO)
    .update(VIDEO)
    .update(SHORTS)
    .update(PNG)
    .digest("hex")
    .slice(0, 32);
  const thumb = { "/f/thumb-full.png": PNG };
  assert.equal(
    (await push(b, { files: thumb, dryRun: true })).revision,
    expected,
  );
  // サムネイルだけ違えば版も変わる（前の版の承認と同じ path を上書きしない）
  assert.notEqual(
    (await push(b, { files: { "/f/thumb-full.png": JPEG }, dryRun: true }))
      .revision,
    expected,
  );
  const result = await push(b, { files: thumb });
  assert.equal(result.reasons, undefined);
  assert.equal(
    (await draftOf(result.channels.x.job_id)).cover_image_path,
    null,
  );
  assert.match(
    (await draftOf(result.channels.youtube.job_id)).cover_image_path,
    /\/thumb-full\.png$/,
  );
});

test("BOA-1172: 欄の無い束は今までどおり（cover なし・media は1つ・版の式も同じ）。フォルダに画像があっても読まない", async () => {
  const { createHash } = await import("node:crypto");
  const b = bundleV2();
  const expected = createHash("sha256")
    .update(JSON.stringify(b))
    .update(VIDEO)
    .update(VIDEO)
    .update(SHORTS)
    .digest("hex")
    .slice(0, 32);
  const savedBefore = saved.length;
  const result = await push(b, { files: { "/f/thumb-full.png": PNG } });
  assert.equal(result.reasons, undefined);
  assert.equal(result.revision, expected);
  const full = await draftOf(result.channels.youtube.job_id);
  assert.equal(full.cover_image_path, null);
  assert.equal(JSON.parse(full.snapshot_text).media.length, 1);
  assert.ok(saved.slice(savedBefore).every(([p]) => !p.includes("thumb")));
});

test("BOA-1172: サムネイルの欄があるのに画像が無い・PNG でも JPEG でもない・空・上限を超える・名前に区切りがあるときは束ごと拒否する", async () => {
  const big = new Uint8Array(THUMBNAIL_MAX_BYTES + 1);
  big.set(PNG);
  const gif = new TextEncoder().encode("GIF89a0000");
  const cases = [
    ["画像が無い", bundleF01(), {}, /thumb-full\.png が無い/],
    [
      "GIF",
      bundleF01(),
      { "/f/thumb-full.png": gif },
      /PNG でも JPEG でもない/,
    ],
    [
      "空",
      bundleF01(),
      { "/f/thumb-full.png": new Uint8Array() },
      /大きさが不正（0 バイト）/,
    ],
    ["上限を超える", bundleF01(), { "/f/thumb-full.png": big }, /大きさが不正/],
    [
      "上の階層",
      bundleF01("../thumb-full.png"),
      { "/thumb-full.png": PNG },
      /ファイル名でない/,
    ],
    [
      "下の階層",
      bundleF01("a/thumb-full.png"),
      { "/f/a/thumb-full.png": PNG },
      /ファイル名でない/,
    ],
    ["\\ を含む", bundleF01("a\\thumb-full.png"), {}, /ファイル名でない/],
    ["..", bundleF01(".."), {}, /ファイル名でない/],
    ["空の名前", bundleF01(""), {}, /ファイル名でない/],
    ["文字列でない", bundleF01(true), {}, /ファイル名でない/],
  ];
  await clearSent();
  for (const [label, b, extra, expected] of cases) {
    const savedBefore = saved.length;
    const result = await push(b, { files: extra });
    assert.ok(result.reasons?.length, label);
    assert.match(result.reasons.join("\n"), expected, label);
    assert.equal(saved.length, savedBefore, `${label}: 何も保存しない`);
  }
  assert.equal((await all("SELECT * FROM sns_x_send_jobs")).length, 0);
  // 上限ちょうどは通る（承認の snapshot のカバーの上限と同じ）
  const edge = new Uint8Array(THUMBNAIL_MAX_BYTES);
  edge.set(PNG);
  assert.equal(
    (
      await push(bundleF01(), {
        files: { "/f/thumb-full.png": edge },
        dryRun: true,
      })
    ).reasons,
    undefined,
  );
});

// BOA-1201: 締切が延びたら、作り手が作り直した束（題・説明文の「締切HH:MM」が変わる）を push し直し、前の束を差し替える
const remade = (hm = "20:44") =>
  bundleV2({
    youtube_full: {
      title: `若松12R 締切${hm}、逃げ一本でいい？`,
      description: `10/18（日）若松12R 締切${hm}\nhttps://www.boat-ai.jp/race/${RACE}?tab=sonar&utm_source=youtube`,
    },
  });
const itemsAndJobs = () =>
  all(
    `SELECT i.id, i.channel, i.variant, i.state, i.stopped_via, i.deadline_at, j.id AS job_id, j.state AS job_state, j.error_code
     FROM sns_auto_send_items i LEFT JOIN sns_x_send_jobs j ON j.auto_item_id=i.id ORDER BY i.created_at, i.channel, i.variant`,
  );

test("BOA-1201: 同じレースの全貌が同じ締切で入っていれば、作り直した束でも重複として拒否し、何も書かない", async () => {
  await push(bundleV2());
  const drafts = (await all("SELECT id FROM sns_drafts")).length;
  const savedBefore = saved.length;
  const again = await push(remade("20:36"));
  assert.match(
    again.reasons.join(),
    /同じレースの全貌が同じ締切 20:36 で既に入っている（重複）/,
  );
  assert.match(again.notes[0], /検査で拒否した/);
  assert.equal((await all("SELECT id FROM sns_drafts")).length, drafts);
  assert.equal(saved.length, savedBefore);
  assert.ok((await itemsAndJobs()).every((r) => r.state === "notified"));
});

test("BOA-1201: 締切が違い、前の job が queued かつ試行0なら、前の item を stopped（superseded）・job を held（superseded）にしてから新しい束を入れる", async () => {
  await push(bundleV2());
  const old = await itemsAndJobs();
  assert.equal(old.length, 3);
  const oldX = await first(
    "SELECT draft_id FROM sns_auto_send_items WHERE channel='x'",
  );
  await db.query("UPDATE races SET start_time='20:44:00'");
  // 作り直していない（版が同じ）束は、前の締切が焼き込まれたままなので拒否する
  assert.match(
    (await push(bundleV2())).reasons.join(),
    /締切が 20:36→20:44 に変わったのに束が前と同じ版/,
  );
  // --dry-run は差し替えを書かない（何を差し替えるかだけ返す）
  const dry = await push(remade(), { dryRun: true });
  assert.deepEqual(dry.replacing, { from: "20:36", to: "20:44", items: 3 });
  assert.deepEqual(await itemsAndJobs(), old);
  // X の日の枠は、前の X の下書きの job を数えずに確かめる
  const asked = [];
  store.xSlotRoom = async (kind, need, draftId) => {
    asked.push(draftId);
    return { ok: true };
  };
  let result;
  try {
    result = await push(remade());
  } finally {
    delete store.xSlotRoom;
  }
  assert.equal(result.reasons, undefined);
  assert.deepEqual(asked, [oldX.draft_id]);
  const rows = await itemsAndJobs();
  const before = rows.filter((r) => old.some((o) => o.id === r.id));
  const after = rows.filter((r) => !old.some((o) => o.id === r.id));
  assert.deepEqual(
    before.map((r) => [
      r.channel,
      r.variant,
      r.state,
      r.stopped_via,
      r.job_state,
      r.error_code,
    ]),
    [
      ["x", "main", "stopped", "superseded", "held", "superseded"],
      ["youtube", "main", "stopped", "superseded", "held", "superseded"],
      ["youtube", "shorts", "stopped", "superseded", "held", "superseded"],
    ],
  );
  assert.deepEqual(
    after.map((r) => [
      r.channel,
      r.variant,
      r.state,
      r.deadline_at.toISOString(),
      r.job_state,
    ]),
    [
      ["x", "main", "notified", "2037-10-18T11:44:00.000Z", "queued"],
      ["youtube", "main", "notified", "2037-10-18T11:44:00.000Z", "queued"],
      ["youtube", "shorts", "notified", "2037-10-18T11:44:00.000Z", "queued"],
    ],
  );
  assert.deepEqual(result.replacing, {
    from: "20:36",
    to: "20:44",
    items: 3,
    held_jobs: 3,
  });
  assert.match(
    result.notes[0],
    /締切 20:36→20:44 で差し替えた（前の item 3件を stopped（superseded）、job 3件を held（superseded））/,
  );
  assert.match(result.notes[0], /x: 19:44 に自動で送る/);
});

test("BOA-1201: 前の job が sending・posted（送信を始めた・送った）なら、締切が違っても差し替えずに拒否する", async () => {
  await push(bundleV2());
  const old = await itemsAndJobs();
  const drafts = (await all("SELECT id FROM sns_drafts")).length;
  await db.query("UPDATE races SET start_time='20:44:00'");
  const xJob = old.find((r) => r.channel === "x").job_id;
  for (const [state, extra] of [
    ["sending", ""],
    ["posted", ", external_post_id='1234567890', posted_at=test_now()"],
  ]) {
    await db.query(
      `UPDATE sns_x_send_jobs SET state=$2, attempts=1${extra} WHERE id=$1`,
      [xJob, state],
    );
    const result = await push(remade());
    assert.match(
      result.reasons.join(),
      new RegExp(
        `前の束の送信が始まっているので差し替えない（x の job ${xJob} が ${state}（試行 1））`,
      ),
      state,
    );
    assert.equal((await all("SELECT id FROM sns_drafts")).length, drafts);
    assert.ok(
      (await itemsAndJobs()).every((r) => r.state === "notified"),
      state,
    );
  }
});

test("BOA-1201: 前の item を止めた後に job の hold が落ちたら、新しい item を作らない（止めた item の job は claim で auto_stopped）", async () => {
  await push(bundleV2());
  const drafts = (await all("SELECT id FROM sns_drafts")).length;
  await db.query("UPDATE races SET start_time='20:44:00'");
  store.failHold = true;
  let result;
  try {
    result = await push(remade());
  } finally {
    store.failHold = false;
  }
  assert.match(
    result.reasons.join(),
    /前の束（締切 20:36）の差し替えに失敗したので、新しい束を作らない: hold_failed/,
  );
  assert.match(result.notes[0], /検査で拒否した/);
  const rows = await itemsAndJobs();
  assert.equal(rows.length, 3);
  assert.ok(
    rows.every((r) => r.state === "stopped" && r.job_state === "queued"),
  );
  assert.equal((await all("SELECT id FROM sns_drafts")).length, drafts);
  // 残った queued の job は、item が止まっているので claim で auto_stopped になり、外へ出ない
  // （held にした後、下書きを公開保留に戻すので 148 のガードが job を取り消す）
  const claimed = await first(
    "SELECT public.transition_sns_x_send($1,'claim','{}'::jsonb) r",
    [rows.find((r) => r.channel === "x").job_id],
  );
  assert.deepEqual(
    [claimed.r.state, claimed.r.error_code],
    ["cancelled", "auto_stopped"],
  );
});

test("BOA-1201: 文に焼き込んだ締切が今の締切と違う束は、初回でも差し替えでも拒否する。合う束・締切の文が無い束は通る", async () => {
  // 初回（前の item が無い）: 締切が 20:44 に延びた後に、20:36 の材料で作った束が届く
  await db.query("UPDATE races SET start_time='20:44:00'");
  const first1 = await push(remade("20:36"));
  assert.deepEqual(first1.reasons, [
    "束の締切 20:36 が今の締切 20:44 と違う（作り直す。youtube_full.title・youtube_full.description）",
  ]);
  assert.match(first1.notes[0], /検査で拒否した/);
  assert.equal((await all("SELECT id FROM sns_drafts")).length, 0);
  // --dry-run でも同じく拒否する
  assert.match(
    (await push(remade("20:36"), { dryRun: true })).reasons.join(),
    /束の締切 20:36 が今の締切 20:44 と違う/,
  );
  // 締切が合う束は通る
  assert.equal((await push(remade("20:44"))).reasons, undefined);
  assert.equal((await all("SELECT id FROM sns_drafts")).length, 3);

  // 差し替え: 20:44 の束が入った後に 20:50 へ延び、版は違うが締切が古いまま（20:44）の束が届く
  await db.query("UPDATE races SET start_time='20:50:00'");
  const staleRemade = remade("20:44");
  staleRemade.youtube_full.title += "（作り直し）";
  const second = await push(staleRemade);
  assert.deepEqual(second.reasons, [
    "束の締切 20:44 が今の締切 20:50 と違う（作り直す。youtube_full.title・youtube_full.description）",
  ]);
  assert.equal((await all("SELECT id FROM sns_drafts")).length, 3);
  assert.ok((await itemsAndJobs()).every((r) => r.state === "notified"));
  // 締切の文が無い束は今までどおり見ない（差し替えの判定に進む）
  assert.equal((await push(bundleV2())).reasons, undefined);
});

test("BOA-1201: 締切の文は x_text・完全版・Shorts の題と説明文を全部見て、時の0埋めの違いは同じと扱う", () => {
  const at = (hm) => `2037-10-18T${hm}:00+09:00`;
  const all5 = bundleV2({
    x_text: `9/1 締切9:05\nhttps://www.boat-ai.jp/race/${RACE}`,
    youtube_full: { title: "締切09:05", description: "締切9:05" },
    youtube_shorts: { title: "締切9:05", description: "締切09:05 {full_url}" },
  });
  assert.deepEqual(bakedDeadlineReasons(all5, at("09:05")), []);
  assert.deepEqual(bakedDeadlineReasons(all5, at("09:06")), [
    "束の締切 09:05 が今の締切 09:06 と違う（作り直す。x_text・youtube_full.title・youtube_full.description・youtube_shorts.title・youtube_shorts.description）",
  ]);
  // 違う時刻が2つあれば、時刻ごとに理由を出す
  assert.deepEqual(
    bakedDeadlineReasons(
      bundleV2({
        youtube_shorts: {
          title: "締切20:30",
          description: "締切20:36 {full_url}",
        },
      }),
      at("20:44"),
    ),
    [
      "束の締切 20:30 が今の締切 20:44 と違う（作り直す。youtube_shorts.title）",
      "束の締切 20:36 が今の締切 20:44 と違う（作り直す。youtube_shorts.description）",
    ],
  );
  // 版1では youtube_shorts を、X を外した束では x_text を見ない（送らない文）
  assert.deepEqual(
    bakedDeadlineReasons(
      bundle({
        youtube_shorts: { title: "締切20:30", description: "締切20:30" },
      }),
      at("20:44"),
    ),
    [],
  );
  assert.deepEqual(
    bakedDeadlineReasons(
      bundleV2({ channels: ["youtube", "shorts"], x_text: "締切20:30" }),
      at("20:44"),
    ),
    [],
  );
  // 締切の文が無い束は見ない
  assert.deepEqual(bakedDeadlineReasons(bundleV2(), at("20:44")), []);
});

test("BOA-1201: 試行1以上でも held・failed の job（外へ出ていない）は差し替えを止めない。hold は queued の job だけにかける", async () => {
  await push(bundleV2());
  const old = await itemsAndJobs();
  await db.query("UPDATE races SET start_time='20:44:00'");
  const jobOf = (channel, variant) =>
    old.find((r) => r.channel === channel && r.variant === variant).job_id;
  // 締切が延びて、送る直前の検査の deadline_changed で held になった X（claim 済みで試行1）と、POST の前に落ちた完全版
  await db.query(
    "UPDATE sns_x_send_jobs SET state='held', attempts=1, error_code='deadline_changed' WHERE id=$1",
    [jobOf("x", "main")],
  );
  await db.query(
    "UPDATE sns_x_send_jobs SET state='failed', attempts=1, error_code='pre_post_failed' WHERE id=$1",
    [jobOf("youtube", "main")],
  );
  const result = await push(remade());
  assert.equal(result.reasons, undefined);
  assert.equal(result.replacing.held_jobs, 1);
  const rows = await itemsAndJobs();
  assert.deepEqual(
    rows
      .filter((r) => old.some((o) => o.id === r.id))
      .map((r) => [r.channel, r.variant, r.state, r.job_state, r.error_code]),
    [
      ["x", "main", "stopped", "held", "deadline_changed"],
      ["youtube", "main", "stopped", "failed", "pre_post_failed"],
      ["youtube", "shorts", "stopped", "held", "superseded"],
    ],
  );
  assert.equal(rows.filter((r) => r.state === "notified").length, 3);
});
