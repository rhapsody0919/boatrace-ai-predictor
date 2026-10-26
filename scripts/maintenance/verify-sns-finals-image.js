// 優勝戦の「思考の順」の画像投稿（format=finals_image、マイグレーション 176、scripts/sns/push-finals-image.js、hq FT02）の再現テスト。
// PGlite に 176 までのマイグレーションを当て、本番と同じ承認の関数（approve_sns_x_send、160）・送信の claim（transition_sns_x_send、
// transition_sns_send_139 は 176）で通す。外部接続なし。X へは何も送らない
import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import {
  BANNED_WORDS,
  imageNamesOf,
  resultLine,
  waitForSend,
  checkFinalsImage,
  checkImages,
  finalsStatus,
  pngSize,
  pushFinalsImage,
  checkFinalsReply,
} from "../sns/push-finals-image.js";
import { createReadCurrent } from "../../api/_lib/snsClaimCheck.js";
import {
  createMockXAdapter,
  createXSnapshot,
  pollDurationMinutes,
  pollOptionsIssue,
  runXSendJob,
} from "../../api/_lib/snsXSend.js";
import { createXApiAdapter } from "../../api/_lib/xApiAdapter.js";
import { pickDueJobs } from "../lib/snsSendRunner.js";
import { createHash } from "node:crypto";
import {
  createDeadlinePreflight,
  createMockHeadless,
} from "../../api/_lib/snsDeadlineQueue.js";
import { SCREEN_MARKERS } from "../lib/snsScreenMarkers.js";

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
const draftOf = (part) =>
  first(
    "SELECT * FROM sns_drafts WHERE source_data->'finals_image'->>'part'=$1",
    [part],
  );

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
const counts = async () => ({
  drafts: Number((await first("SELECT count(*) n FROM sns_drafts")).n),
  items: Number((await first("SELECT count(*) n FROM sns_auto_send_items")).n),
  jobs: Number((await first("SELECT count(*) n FROM sns_x_send_jobs")).n),
  saved: saved.length,
});
const NOTHING = { drafts: 0, items: 0, jobs: 0, saved: 0 };

test("176: finals_image の item は X だけ・variant=finals だけ。finals_image でない item は finals にできない。許可は既定 false", async () => {
  const insert = (kind, channel, variant) =>
    db.query(
      `WITH draft AS (INSERT INTO sns_drafts(content_group_id,platform,language,format,caption_text)
         VALUES(gen_random_uuid(), $2, 'ja', $1, '176') RETURNING id)
       INSERT INTO sns_auto_send_items(kind,variant,draft_id,channel,race_id,deadline_at,notify_by,veto_until)
       SELECT $1, $3, id, $2, 'r176', test_now()+interval '3h', test_now(), test_now()+interval '1h' FROM draft`,
      [kind, channel, variant],
    );
  await assert.rejects(
    insert("finals_image", "youtube", "finals"),
    /kind_source|variant_scope/,
  );
  await assert.rejects(insert("finals_image", "x", "main"), /variant_scope/);
  await assert.rejects(insert("full_picture", "x", "finals"), /variant_scope/);
  await insert("finals_image", "x", "finals");
  // 同じ優勝戦の全貌（full_picture・x・main）とは両立する
  await insert("full_picture", "x", "main");
  // 生きている finals_image は1レース1件（一意の索引 race_id・channel・variant）
  await assert.rejects(
    insert("finals_image", "x", "finals"),
    /sns_auto_send_items_race_channel/,
  );
  const def = await first(
    "SELECT column_default d FROM information_schema.columns WHERE table_name='sns_auto_send_control' AND column_name='finals_image_enabled'",
  );
  assert.equal(def.d, "false");
  // 許可は x の行だけ
  await assert.rejects(
    db.query(
      "UPDATE sns_auto_send_control SET finals_image_enabled=true WHERE channel='youtube'",
    ),
    /finals_image_x_only/,
  );
});

test("許可が off なら、検査が通っても何も書かない（DB・Storage・Slack とも。disabled で返り、CLI は exit 3）", async () => {
  await db.exec("UPDATE sns_auto_send_control SET finals_image_enabled=false");
  const result = await push();
  assert.equal(result.reasons, undefined);
  assert.equal(result.disabled, true);
  assert.equal(result.enabled, false);
  assert.deepEqual(await counts(), NOTHING);
  assert.deepEqual(result.notes, []);
  // off の間の拒否も Slack に流さない（--dry-run と同じ）
  const rejected = await push(bundle({ review: { p0_count: 1 } }));
  assert.match(rejected.reasons.join(), /P0/);
  assert.deepEqual(rejected.notes, []);
});

test("--dry-run は許可が on でも何も書かない", async () => {
  const result = await push(bundle(), { dryRun: true });
  assert.equal(result.dryRun, true);
  assert.equal(result.enabled, true);
  assert.equal(result.disabled, false);
  assert.deepEqual(await counts(), NOTHING);
});

test("許可が on・mode=auto なら、画像4枚を1件の job にして今すぐ送る予定に入れる（期限は締切の5分前）。claim は待たずにでき、日次の枠に1本で数える", async () => {
  const result = await push();
  assert.equal(result.reasons, undefined);
  assert.equal(result.send_at, NOW.toISOString());
  const item = await first(
    "SELECT * FROM sns_auto_send_items WHERE variant='finals'",
  );
  assert.deepEqual(
    [item.kind, item.variant, item.channel, item.state],
    ["finals_image", "finals", "x", "notified"],
  );
  const job = await first(MAIN_JOB);
  const auto = (
    await first(
      "SELECT auto_approver_id FROM sns_auto_send_control WHERE channel='x'",
    )
  ).auto_approver_id;
  assert.equal(job.approver_id, auto);
  assert.equal(job.auto_item_id, item.id);
  assert.equal(job.scheduled_at.toISOString(), NOW.toISOString());
  assert.equal(job.expires_at.toISOString(), "2037-10-26T07:25:00.000Z");
  assert.equal(job.parent_job_id, null);
  const snapshot = JSON.parse(job.snapshot_text);
  assert.deepEqual(
    snapshot.media.map((m) => [m.path.split("/").at(-1), m.type]),
    NAMES.map((name) => [name, "image/png"]),
  );
  assert.equal(snapshot.text, bundle().x_text);
  assert.equal(snapshot.queue.thread_length, undefined);
  assert.equal(saved.length, 4);
  assert.match(result.notes[0], /今すぐ送る/);
  assert.match(result.notes[0], /finals_image_enabled = false/);
  // 送る時刻＝今。全貌の veto（60分前）を待たない
  const r = await claim(job.id);
  assert.equal(r.state, "sending");
  assert.deepEqual(r.attempt_channels, ["x"]);
});

test("claim の時も許可を見る: 承認の後に off にすると held（finals_image_disabled）で送らない", async () => {
  await push();
  const job = await first(MAIN_JOB_ID);
  await db.exec("UPDATE sns_auto_send_control SET finals_image_enabled=false");
  const r = await claim(job.id);
  assert.equal(r.state, "held");
  assert.equal(r.error_code, "finals_image_disabled");
});

test("claim の時間の窓: 締切の5分前（期限）を過ぎたら deadline_expired。全貌など finals_image でない job の期限は30分前のまま", async () => {
  await push();
  const job = await first(MAIN_JOB_ID);
  await setClock(at("16:25:00"));
  const r = await claim(job.id);
  assert.equal(r.state, "held");
  assert.equal(r.error_code, "deadline_expired");
  // finals_image でない job に5分前の期限を入れると、今までどおり deadline_policy_changed
  await db.exec(
    "UPDATE sns_auto_send_items SET kind='full_picture', variant='main' WHERE variant='finals'",
  );
  await db.exec(
    "UPDATE sns_x_send_jobs SET state='queued', error_code=NULL WHERE parent_job_id IS NULL",
  );
  await setClock(at("16:20:00"));
  const other = await claim(job.id);
  assert.equal(other.error_code, "deadline_policy_changed");
});

test("締切の15分前を過ぎて届いたら受け取らない（15分前ちょうどは拒否、その1秒前は受け取る。投票のリプを期限までに送る分を残す）", async () => {
  const late = await push(bundle(), { now: at("16:15:00") });
  assert.match(late.reasons.join(), /15分前を過ぎた/);
  assert.deepEqual(await counts(), NOTHING);
  const ok = await push(bundle(), { now: at("16:14:59") });
  assert.equal(ok.reasons, undefined);
  assert.ok(ok.job_id);
});

test("検査: 禁止表現（各語と risk-rules）・加重280・置き場所・別レースのリンク・P0・deadline が無い", () => {
  assert.deepEqual(checkFinalsImage(bundle(), riskRules), []);
  for (const word of BANNED_WORDS)
    assert.match(
      checkFinalsImage(bundle({ x_text: `優勝戦、${word}` }), riskRules).join(),
      /禁止表現/,
      word,
    );
  // 加重280: 全角140字はちょうど、141字は超える
  assert.deepEqual(
    checkFinalsImage(bundle({ x_text: "あ".repeat(140) }), riskRules),
    [],
  );
  assert.match(
    checkFinalsImage(bundle({ x_text: "あ".repeat(141) }), riskRules).join(),
    /280/,
  );
  assert.match(
    checkFinalsImage(bundle({ x_text: "予想は{answer}" }), riskRules).join(),
    /置き場所/,
  );
  assert.match(
    checkFinalsImage(
      bundle({
        x_text: "優勝戦 https://www.boat-ai.jp/race/2037-10-26-01-12?tab=sonar",
      }),
      riskRules,
    ).join(),
    /リンク/,
  );
  assert.deepEqual(
    checkFinalsImage(
      bundle({
        x_text: `優勝戦 https://www.boat-ai.jp/race/${RACE}?tab=sonar`,
      }),
      riskRules,
    ),
    [],
  );
  assert.match(
    checkFinalsImage(
      bundle({ review: { p0_count: 1, by: "machine" } }),
      riskRules,
    ).join(),
    /P0/,
  );
  assert.match(
    checkFinalsImage(bundle({ deadline: DEADLINE }), riskRules).join(),
    /deadline/,
  );
  assert.match(
    checkFinalsImage(bundle({ format: "full_picture" }), riskRules).join(),
    /format/,
  );
});

test("検査: 画像は4枚・PNG・1080×1350・1〜5,000,000 バイト", () => {
  assert.deepEqual(checkImages(NAMES, IMAGES()), []);
  assert.deepEqual(pngSize(png(1080, 1350)), { width: 1080, height: 1350 });
  const missing = IMAGES();
  delete missing[NAMES[2]];
  assert.match(checkImages(NAMES, missing).join(), /3-q3.png が無い/);
  assert.match(
    checkImages(NAMES, { ...IMAGES(), [NAMES[1]]: png(1080, 1440) }).join(),
    /1080×1350 でない/,
  );
  assert.match(
    checkImages(NAMES, { ...IMAGES(), [NAMES[0]]: new Uint8Array(300) }).join(),
    /PNG でない/,
  );
  assert.match(
    checkImages(NAMES, {
      ...IMAGES(),
      [NAMES[3]]: png(1080, 1350, 5000000),
    }).join(),
    /大きさが不正/,
  );
  assert.deepEqual(
    checkImages(NAMES, {
      ...IMAGES(),
      [NAMES[3]]: png(1080, 1350, 5000000 - 24),
    }),
    [],
  );
  // images は4つ・名前の形・この順。ほかの名前（HTML 等）は読まない
  assert.deepEqual(checkFinalsImage(bundle(), riskRules), []);
  for (const images of [
    NAMES.slice(0, 3),
    [NAMES[1], NAMES[0], NAMES[2], NAMES[3]],
    ["1-map.png", "2-q12.png", "3-q3.png", "4-routes.png"],
    [...NAMES.slice(0, 3), `${RACE}-4-routes.html`],
    undefined,
  ])
    assert.match(
      checkFinalsImage(bundle({ images }), riskRules).join(),
      /images が/,
    );
});

test("レースの検査: 中止・今日でない・優勝戦でない・deadline が races と違う・同じレースの finals_image がある（送った後も）", async () => {
  await db.exec("UPDATE races SET cancellation_status='cancelled'");
  assert.match((await push()).reasons.join(), /中止/);
  await db.exec("UPDATE races SET cancellation_status=NULL");
  assert.match(
    (
      await push(bundle(), { now: new Date("2037-10-25T16:15:00+09:00") })
    ).reasons.join(),
    /今日のレースでない/,
  );
  await db.exec("UPDATE race_conditions SET race_stage='準優勝戦'");
  assert.match((await push()).reasons.join(), /優勝戦でない/);
  await db.exec("UPDATE race_conditions SET race_stage='優勝戦'");
  assert.match(
    (await push(bundle({ deadline: "16:31" }))).reasons.join(),
    /deadline が races/,
  );
  assert.deepEqual(await counts(), NOTHING);
  // 1本目は通り、2本目以降（起こす係が2分ごとに呼ぶ）は何も作らず今の状態を返す（exit 4）。送った（sent）後も同じ
  const firstPush = await push();
  assert.ok(firstPush.job_id);
  const again = await push();
  assert.equal(again.already, true);
  assert.match(again.reason, /既にある（item notified・job queued）/);
  assert.equal(again.status.job_id, firstPush.job_id);
  assert.equal(resultLine(RACE, again).code, 4);
  // 本投稿と投票のリプの2つ
  assert.equal(Number((await first("SELECT count(*) n FROM sns_drafts")).n), 2);
  await db.exec("UPDATE sns_auto_send_items SET state='sent'");
  assert.match((await push()).reason, /既にある（item sent/);
  // 自動の job が送らずに終わった（held）なら、前の item を superseded で止めて作り直す（期限までのやり直し）
  await db.exec(
    "UPDATE sns_auto_send_items SET state='notified'; UPDATE sns_x_send_jobs SET state='held', error_code='source_stale'",
  );
  const retried = await push();
  assert.ok(retried.job_id);
  assert.notEqual(retried.job_id, firstPush.job_id);
  assert.deepEqual(
    (
      await all(
        "SELECT state, stopped_via FROM sns_auto_send_items ORDER BY created_at, state",
      )
    )
      .map((r) => [r.state, r.stopped_via])
      .sort(),
    // 本投稿と投票のリプを対で止めて作り直す
    [
      ["notified", null],
      ["notified", null],
      ["stopped", "superseded"],
      ["stopped", "superseded"],
    ],
  );
  // 送っている途中（reconcile）は作り直さない
  await db.exec(
    "UPDATE sns_x_send_jobs SET state='reconcile' WHERE id='" +
      retried.job_id +
      "'",
  );
  assert.equal((await push()).already, true);
});

test("許可が on で拒否したら Slack に理由を知らせる", async () => {
  const result = await push(bundle({ x_text: "儲かる優勝戦" }));
  assert.match(result.reasons.join(), /儲か/);
  assert.match(result.notes[0], /検査で拒否/);
});

test("mode=manual なら本投稿も投票のリプも held_manual で job を作らない（投票のリプの無い本投稿だけを出さない）", async () => {
  await db.exec("UPDATE sns_auto_send_control SET mode='manual'");
  const result = await push();
  assert.equal(result.job_id, undefined);
  assert.deepEqual(
    (await all("SELECT state FROM sns_auto_send_items ORDER BY variant")).map(
      (r) => r.state,
    ),
    ["held_manual", "held_manual"],
  );
  assert.equal((await counts()).jobs, 0);
  assert.match(result.notes[0], /送らない/);
});

/** 送り手の読み直し（readCurrent）に PGlite の行を渡す */
const readCurrent = createReadCurrent({
  db: async (p) => {
    const table = p.split("?")[0];
    if (table === "sns_drafts")
      return all(
        "SELECT bundle_import_id, source_data FROM sns_drafts WHERE id=$1",
        [p.match(/id=eq\.([0-9a-f-]+)/)[1]],
      );
    if (table === "races")
      return all(
        "SELECT race_date::text, start_time::text, cancellation_status FROM races",
      );
    if (table === "race_conditions")
      return all("SELECT race_stage FROM race_conditions");
    if (table === "sns_auto_send_items")
      return all(
        "SELECT id FROM sns_auto_send_items WHERE kind='finals_image' AND variant=$1 AND state='sent'",
        [p.match(/variant=eq\.([a-z_]+)/)[1]],
      );
    if (table === "sns_auto_send_control")
      return all(
        "SELECT finals_image_enabled FROM sns_auto_send_control WHERE channel='x'",
      );
    return [];
  },
});

test("送り手の claim の前の検査（readCurrent）: 許可が off・優勝戦でない・送った finals_image がある・中止なら送らない", async () => {
  await push();
  const draft = await draftOf("main");
  const current = await readCurrent(draft.id);
  assert.deepEqual(current, {
    withdrawn: false,
    cancelled: false,
    deadline_at: DEADLINE,
    source_revision: draft.source_data.finals_image.revision,
  });
  assert.equal(
    current.source_revision,
    draft.source_data.deadline_queue.source_revision,
  );
  await db.exec("UPDATE sns_auto_send_control SET finals_image_enabled=false");
  await assert.rejects(readCurrent(draft.id), /finals_image_disabled/);
  await db.exec(
    "UPDATE sns_auto_send_control SET finals_image_enabled=true WHERE channel='x'",
  );
  await db.exec("UPDATE race_conditions SET race_stage='準優勝戦'");
  await assert.rejects(readCurrent(draft.id), /not_finals/);
  await db.exec("UPDATE race_conditions SET race_stage='優勝戦'");
  await db.exec("UPDATE sns_auto_send_items SET state='sent'");
  await assert.rejects(readCurrent(draft.id), /finals_already_sent/);
  await db.exec("UPDATE sns_auto_send_items SET state='notified'");
  await db.exec("UPDATE races SET cancellation_status='cancelled'");
  assert.equal((await readCurrent(draft.id)).cancelled, true);
});

test("送る直前の検査（createDeadlinePreflight）: 期限（締切の5分前）の前は通り、過ぎたら deadline_expired", async () => {
  await push();
  const job = await first(MAIN_JOB);
  const preflight = (now) =>
    createDeadlinePreflight({
      headless: createMockHeadless({
        visibleSelectors: SCREEN_MARKERS["race-sonar"],
      }),
      markers: SCREEN_MARKERS,
      readCurrent,
      now: () => now.getTime(),
    })(job);
  await preflight(at("16:24:59"));
  await assert.rejects(preflight(at("16:25:00")), /deadline_expired/);
});

test("記録: 送った後は送った時刻・tweet id を返す", async () => {
  await push();
  const job = await first(MAIN_JOB_ID);
  await claim(job.id);
  await first(
    "SELECT public.transition_sns_x_send($1,'begin_post','{}'::jsonb)",
    [job.id],
  );
  await first("SELECT public.transition_sns_x_send($1,'complete',$2::jsonb)", [
    job.id,
    JSON.stringify({
      id: "1890000000000000001",
      posted_at: "2037-10-26T07:16:30Z",
    }),
  ]);
  const status = await finalsStatus(RACE, { store });
  assert.equal(status.job_state, "posted");
  assert.equal(status.item_state, "sent");
  assert.equal(status.tweet_id, "1890000000000000001");
  assert.equal(status.tweet_url, "https://x.com/i/status/1890000000000000001");
  assert.equal(
    new Date(status.posted_at).toISOString(),
    "2037-10-26T07:16:30.000Z",
  );
});

test("X の日の上限に入らないときは受け取らない（claim と同じ数え方: 今日の X の試行＋他経路＋1）", async () => {
  await db.exec(
    "UPDATE sns_x_send_control SET daily_limit_x=2, daily_external_count=1",
  );
  // 今日の X の試行1件（YouTube の試行は数えない）
  await db.exec(`WITH d AS (INSERT INTO sns_drafts(content_group_id,platform,language,format,caption_text)
      VALUES(gen_random_uuid(),'x','ja','today_digest','x') RETURNING id)
    INSERT INTO sns_x_send_jobs(draft_id,state,snapshot,snapshot_text,approved_hash,approver_id,approved_at,scheduled_at,attempt_dates,attempt_channels)
    SELECT id,'posted','{}'::jsonb,'{}','h',(SELECT id FROM sns_approvers LIMIT 1),test_now(),test_now(),
      ARRAY[(test_now() AT TIME ZONE 'Asia/Tokyo')::date,(test_now() AT TIME ZONE 'Asia/Tokyo')::date],ARRAY['x','youtube'] FROM d`);
  const full = await push();
  assert.match(
    full.reasons.join(),
    /日の上限 2 に2本が入らない（今日の試行 1・他経路 1・予約の子 0）/,
  );
  assert.equal(
    Number((await first("SELECT count(*) n FROM sns_auto_send_items")).n),
    0,
  );
  // 本投稿は投票のリプと対で2本分: 1＋1＋2 は上限3に入らない（本投稿だけなら入るが、受け取らない）
  await db.exec("UPDATE sns_x_send_control SET daily_limit_x=3");
  assert.match((await push()).reasons.join(), /日の上限 3 に2本が入らない/);
  await db.exec("UPDATE sns_x_send_control SET daily_limit_x=4");
  assert.ok((await push()).job_id);
  await db.exec("UPDATE sns_x_send_control SET daily_baseline_date=NULL");
  await db.exec(
    "DELETE FROM sns_x_send_jobs WHERE auto_item_id IS NOT NULL; DELETE FROM sns_auto_send_items",
  );
  assert.match((await push()).reasons.join(), /daily_baseline_date/);
});

test("179: 優勝戦の取り置きに入らないときは受け取らない（本投稿は投票と対で2本）。179 の前（404）は日の上限だけで決める", async () => {
  const asked = [];
  store.xSlotRoom = async (kind, need) => {
    asked.push([kind, need]);
    return {
      ok: false,
      reason: "kind_slot_full",
      kind,
      need,
      limit: 8,
      reserve: 3,
      booked: 2,
      others_booked: 5,
      held_for_others: 0,
      external: 0,
    };
  };
  try {
    const full = await push();
    assert.deepEqual(asked, [["finals_image", 2]]);
    assert.match(
      full.reasons.join(),
      /X の日の枠に finals_image（2本）が入らない/,
    );
    assert.equal(
      Number((await first("SELECT count(*) n FROM sns_auto_send_items")).n),
      0,
    );
    store.xSlotRoom = async () => {
      throw new Error("DB 操作に失敗: HTTP 404 POST rpc/sns_x_slot_room");
    };
    assert.ok((await push()).job_id);
  } finally {
    delete store.xSlotRoom;
  }
});

test("CLI の結果の1行と exit: 送った 0・拒否 1・許可 off 3・既にある 4・送れなかった 5。最後の行は FINALS_RESULT の JSON", () => {
  const posted = resultLine(
    RACE,
    { job_id: "j1" },
    {
      job_id: "j1",
      job_state: "posted",
      tweet_id: "189",
      tweet_url: "https://x.com/i/status/189",
      posted_at: "2037-10-26T07:16:30Z",
      error_code: null,
      poll: {
        job_id: "j2",
        job_state: "posted",
        tweet_id: "190",
        error_code: null,
      },
    },
  );
  assert.equal(posted.code, 0);
  const postedLine = JSON.parse(posted.text.slice("FINALS_RESULT ".length));
  assert.deepEqual(
    [
      postedLine.part,
      postedLine.poll_job_id,
      postedLine.poll_job_state,
      postedLine.poll_tweet_id,
    ],
    ["main", "j2", "posted", "190"],
  );
  // 本投稿は出たが投票のリプが出ていない（held 等）は 5（hq が知らせる）
  const noPoll = resultLine(
    RACE,
    { job_id: "j1" },
    {
      job_id: "j1",
      job_state: "posted",
      poll: {
        job_id: "j2",
        job_state: "held",
        error_code: "parent_not_posted",
      },
    },
  );
  assert.equal(noPoll.code, 5);
  assert.match(noPoll.text, /"outcome":"poll_not_posted"/);
  // 展示後のリプ（part=reply）は投票を見ない
  assert.equal(
    resultLine(
      RACE,
      { part: "reply", job_id: "j3" },
      { job_id: "j3", job_state: "posted" },
    ).code,
    0,
  );
  assert.match(
    posted.text,
    /^FINALS_RESULT \{.*"outcome":"posted".*"tweet_id":"189".*"job_id":"j1"|^FINALS_RESULT \{.*"job_id":"j1".*"tweet_id":"189"/,
  );
  assert.equal(
    JSON.parse(posted.text.slice("FINALS_RESULT ".length)).posted_at,
    "2037-10-26T07:16:30Z",
  );
  assert.equal(resultLine(RACE, { reasons: ["x"] }).code, 1);
  const off = resultLine(RACE, { dryRun: true, disabled: true });
  assert.equal(off.code, 3);
  assert.match(off.text, /finals_image_enabled/);
  assert.equal(resultLine(RACE, { dryRun: true, disabled: false }).code, 0);
  assert.equal(
    resultLine(
      RACE,
      { job_id: "j1" },
      { job_id: "j1", job_state: "held", error_code: "deadline_expired" },
    ).code,
    5,
  );
  assert.equal(resultLine(RACE, { draft_id: "d", item_id: "i" }).code, 5); // 個別承認・承認の失敗
  // --no-wait は予定に入れたら 0。待ったのに送れていない（止められた・要照合のまま）は 5
  assert.equal(resultLine(RACE, { job_id: "j1" }).code, 0);
  assert.equal(
    resultLine(RACE, { job_id: "j1" }, { job_id: "j1", job_state: "reconcile" })
      .code,
    5,
  );
  assert.equal(
    resultLine(RACE, { job_id: "j1" }, null, { waited: true }).code,
    5,
  );
  assert.ok(!posted.text.includes("\n"));
});

test("待つ: 送り手が送り終えたら（posted）返し、送らないまま期限＋90秒を過ぎたら返す", async () => {
  await push();
  const job = await first(MAIN_JOB_ID);
  let clock = NOW.getTime();
  let sleeps = 0;
  // 2回目の確かめで送り手が送り終えた
  const draftId = (await draftOf("main")).id;
  const status = await waitForSend(RACE, {
    store,
    draftId,
    expiresAt: "2037-10-26T07:25:00.000Z",
    now: () => new Date(clock),
    sleep: async (sec) => {
      sleeps += 1;
      clock += sec * 1000;
      if (sleeps === 1) {
        await claim(job.id);
        await first(
          "SELECT public.transition_sns_x_send($1,'begin_post','{}'::jsonb)",
          [job.id],
        );
        await first(
          "SELECT public.transition_sns_x_send($1,'complete',$2::jsonb)",
          [
            job.id,
            JSON.stringify({
              id: "1890000000000000002",
              posted_at: "2037-10-26T07:15:30Z",
            }),
          ],
        );
      }
    },
  });
  assert.equal(status.job_state, "posted");
  assert.equal(status.tweet_id, "1890000000000000002");
  assert.equal(sleeps, 1);
  // 送っている途中（reconcile）は待ち続ける
  await db.exec("UPDATE sns_x_send_jobs SET state='reconcile'");
  let polls = 0;
  clock = NOW.getTime();
  const inFlight = await waitForSend(RACE, {
    store,
    draftId,
    expiresAt: "2037-10-26T07:25:00.000Z",
    now: () => new Date(clock),
    sleep: async (sec) => {
      polls += 1;
      clock += sec * 1000;
      if (polls === 2)
        await db.exec("UPDATE sns_x_send_jobs SET state='posted'");
    },
  });
  assert.equal(inFlight.job_state, "posted");
  assert.equal(polls, 2);
  // 送られないまま（queued）期限を過ぎた
  await db.exec(
    "UPDATE sns_x_send_jobs SET state='queued', external_post_id=NULL, posted_at=NULL, external_post_url=NULL",
  );
  clock = Date.parse("2037-10-26T07:26:31.000Z");
  const late = await waitForSend(RACE, {
    store,
    draftId,
    expiresAt: "2037-10-26T07:25:00.000Z",
    now: () => new Date(clock),
    sleep: async () => assert.fail("期限＋90秒の後は待たない"),
  });
  assert.equal(late.job_state, "queued");
});
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
const replyBundle = (patch = {}) => ({
  format: "finals_reply",
  race_id: RACE,
  x_text:
    "展示を見た後の4枚（16:30締切）\n進入は枠なり\n予想は変わった？ リプで教えて！\n#ボートレース",
  deadline: "16:30",
  images: NAMES,
  review: { p0_count: 0, by: "machine" },
  ...patch,
});
const clearRows = () =>
  db.exec(
    "DELETE FROM sns_metric_jobs; UPDATE sns_x_send_jobs SET parent_job_id=NULL; DELETE FROM sns_x_send_jobs; DELETE FROM sns_auto_send_items; ALTER TABLE sns_drafts DISABLE TRIGGER USER; DELETE FROM sns_drafts; ALTER TABLE sns_drafts ENABLE TRIGGER USER;",
  );
/** 本投稿を 14:00 に受け取り、送り手が送り終えた（投票のリプは queued のまま）ところまで進める */
async function postMain() {
  await setClock(at("14:02:00"));
  const main = await push(bundle(), { now: at("14:00:00") });
  await post(main.job_id, "1890000000000000010", "2037-10-26T05:01:00Z");
  return main;
}

test("177: variant の finals_poll・finals_reply は kind=finals_image・X だけ。種類ごとに1レース1件", async () => {
  const insert = (kind, channel, variant) =>
    db.query(
      `WITH draft AS (INSERT INTO sns_drafts(content_group_id,platform,language,format,caption_text)
         VALUES(gen_random_uuid(), $2, 'ja', $1, '177') RETURNING id)
       INSERT INTO sns_auto_send_items(kind,variant,draft_id,channel,race_id,deadline_at,notify_by,veto_until)
       SELECT $1, $3, id, $2, 'r177', test_now()+interval '3h', test_now(), test_now()+interval '1h' FROM draft`,
      [kind, channel, variant],
    );
  await assert.rejects(
    insert("full_picture", "x", "finals_poll"),
    /variant_scope/,
  );
  await assert.rejects(
    insert("finals_image", "youtube", "finals_reply"),
    /kind_source|variant_scope/,
  );
  await assert.rejects(
    insert("finals_image", "x", "finals_other"),
    /variant_check/,
  );
  for (const variant of ["finals", "finals_poll", "finals_reply"])
    await insert("finals_image", "x", variant);
  await assert.rejects(
    insert("finals_image", "x", "finals_poll"),
    /sns_auto_send_items_race_channel/,
  );
  await assert.rejects(
    insert("finals_image", "x", "finals_reply"),
    /sns_auto_send_items_race_channel/,
  );
});

test("投票の検査: 4択・各25字まで（コードポイント）・空と重なりなし、poll_text は本投稿と同じ検査", () => {
  assert.equal(pollOptionsIssue(POLL), null);
  assert.equal(pollOptionsIssue(["あ".repeat(25), "い"]), null);
  assert.match(pollOptionsIssue(["あ".repeat(26), "い"]), /25字/);
  assert.match(pollOptionsIssue(["a"]), /2〜4個/);
  assert.match(pollOptionsIssue(["a", "b", "c", "d", "e"]), /2〜4個/);
  assert.match(pollOptionsIssue(["a", " "]), /空/);
  assert.match(pollOptionsIssue(["a", "a"]), /重なって/);
  assert.match(pollOptionsIssue(undefined), /2〜4個/);
  // 本投稿の bundle は4択ちょうど
  assert.deepEqual(checkFinalsImage(bundle(), riskRules), []);
  assert.match(
    checkFinalsImage(bundle({ poll: POLL.slice(0, 3) }), riskRules).join(),
    /4個でない/,
  );
  assert.match(
    checkFinalsImage(bundle({ poll: undefined }), riskRules).join(),
    /選択肢/,
  );
  assert.match(
    checkFinalsImage(
      bundle({
        poll: [...POLL.slice(0, 3), "あ".repeat(26)],
      }),
      riskRules,
    ).join(),
    /25字/,
  );
  assert.match(
    checkFinalsImage(bundle({ poll_text: "" }), riskRules).join(),
    /poll_text が無い/,
  );
  assert.match(
    checkFinalsImage(bundle({ poll_text: "儲かる投票" }), riskRules).join(),
    /poll_text の禁止表現/,
  );
  assert.match(
    checkFinalsImage(bundle({ poll_text: "あ".repeat(141) }), riskRules).join(),
    /poll_text が X の加重280/,
  );
  // 展示後のリプは投票を持たず、本文・画像・P0 を本投稿と同じに見る
  assert.deepEqual(checkFinalsReply(replyBundle(), riskRules), []);
  assert.match(
    checkFinalsReply(replyBundle({ x_text: "競艇の展示" }), riskRules).join(),
    /禁止表現/,
  );
  assert.match(
    checkFinalsReply(replyBundle({ format: "finals_image" }), riskRules).join(),
    /format/,
  );
  assert.match(
    checkFinalsReply(
      replyBundle({ images: NAMES.slice(0, 3) }),
      riskRules,
    ).join(),
    /images が/,
  );
});

test("投票の時間: 送る時の今から締切までの分（切り捨て）、最小5・最大10080", () => {
  assert.equal(pollDurationMinutes(DEADLINE, at("16:16:00").getTime()), 14);
  assert.equal(pollDurationMinutes(DEADLINE, at("16:16:30").getTime()), 13);
  assert.equal(pollDurationMinutes(DEADLINE, at("16:27:00").getTime()), 5);
  assert.equal(pollDurationMinutes(DEADLINE, at("16:40:00").getTime()), 5);
  assert.equal(
    pollDurationMinutes(DEADLINE, Date.parse("2037-10-01T00:00:00Z")),
    10080,
  );
  assert.equal(pollDurationMinutes(DEADLINE, at("13:30:00").getTime()), 180);
  assert.throws(() => pollDurationMinutes("x", 0), /poll_closes_at_invalid/);
});

test("本投稿の push は投票のリプも作る: 媒体なし・x_poll（締切で閉じる）・本投稿の job を親に持つ・期限は締切の5分前。runner は親が posted になるまで選ばない", async () => {
  const result = await push();
  assert.ok(result.job_id);
  assert.ok(result.poll_job_id);
  const main = await first(MAIN_JOB);
  const poll = await first(POLL_JOB);
  assert.equal(poll.id, result.poll_job_id);
  assert.equal(poll.parent_job_id, main.id);
  assert.equal(poll.expires_at.toISOString(), "2037-10-26T07:25:00.000Z");
  assert.equal(poll.scheduled_at.toISOString(), NOW.toISOString());
  const pollItem = await first(
    "SELECT * FROM sns_auto_send_items WHERE variant='finals_poll'",
  );
  assert.deepEqual(
    [pollItem.kind, pollItem.state, pollItem.race_id],
    ["finals_image", "notified", RACE],
  );
  assert.equal(poll.auto_item_id, pollItem.id);
  const snapshot = JSON.parse(poll.snapshot_text);
  assert.deepEqual(snapshot.media, []);
  assert.deepEqual(snapshot.poll, { options: POLL, closes_at: DEADLINE });
  assert.equal(snapshot.text, bundle().poll_text);
  assert.equal(snapshot.queue.parent_job_id, main.id);
  const pollDraft = await draftOf("poll");
  assert.equal(pollDraft.publish_blocked, false);
  assert.equal(pollDraft.cover_image_path, null);
  assert.equal(pollDraft.source_data.image_paths, undefined);
  // 送り手は親が posted で tweet id のある子だけを選ぶ
  const parentsOf = () =>
    all(
      "SELECT id, state, external_post_id FROM sns_x_send_jobs WHERE parent_job_id IS NULL",
    );
  const queued = () =>
    all(
      "SELECT * FROM sns_x_send_jobs WHERE state='queued' ORDER BY parent_job_id NULLS FIRST",
    );
  assert.deepEqual(
    pickDueJobs(await queued(), await parentsOf()).map((j) => j.id),
    [main.id],
  );
  await post(main.id, "1890000000000000011", "2037-10-26T07:16:00Z");
  assert.deepEqual(
    pickDueJobs(await queued(), await parentsOf()).map((j) => j.id),
    [poll.id],
  );
  // 本投稿を送った（item sent）後も、投票のリプの送る直前の読み直しは止まらない（自分の種類だけを見る）
  assert.equal(
    (
      await first(
        "SELECT state FROM sns_auto_send_items WHERE variant='finals'",
      )
    ).state,
    "sent",
  );
  const current = await readCurrent(pollDraft.id);
  assert.equal(
    current.source_revision,
    pollDraft.source_data.deadline_queue.source_revision,
  );
  await db.exec(
    "UPDATE sns_auto_send_items SET state='sent' WHERE variant='finals_poll'",
  );
  await assert.rejects(readCurrent(pollDraft.id), /finals_already_sent/);
});

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

test("投票のリプは本投稿と対で枠を取る: 子の分の空きが無ければ本投稿も claim できない。本投稿を送った後は子の枠を他の親の job に使わせない", async () => {
  await setClock(at("14:02:00"));
  const main = await push(bundle(), { now: at("14:00:00") });
  // 受け取りの後に上限を1に下げると、本投稿の claim は子の分が入らず止まる（親だけ送らない）
  await db.exec("UPDATE sns_x_send_control SET daily_limit_x=1");
  await assert.rejects(claim(main.job_id), /日次全体上限/);
  assert.equal((await first(MAIN_JOB)).attempts, 0);
  // 上限2: 本投稿は通る
  await db.exec("UPDATE sns_x_send_control SET daily_limit_x=2");
  await post(main.job_id, "1890000000000000020", "2037-10-26T05:01:00Z");
  // 別の優勝戦の本投稿（親）を受け取る（上限4: 今日の試行1＋2）。上限を3に下げると、その claim は
  // 今日の試行1＋自分1＋自分の子1＋送った本投稿の子（投票のリプ、まだ claim していない）1＝4 で入らない
  const other = "2037-10-26-05-12";
  await db.query("INSERT INTO races VALUES($1,'2037-10-26','17:30:00',NULL)", [other]);
  await db.query("INSERT INTO race_conditions VALUES($1,'優勝戦')", [other]);
  const otherImages = Object.fromEntries(
    imageNamesOf(other).map((name, i) => [name, png(1080, 1350, 300 + i)]),
  );
  const otherBundle = bundle({ race_id: other, deadline: "17:30", images: imageNamesOf(other), poll_text: "あなたの予想は？\n#ボートレース" });
  // push の事前検査も claim と同じく予約の子を数える（上限3: 試行1＋予約の子1＋2 は入らない）
  await db.exec("UPDATE sns_x_send_control SET daily_limit_x=3");
  assert.match(
    (await push(otherBundle, { now: at("14:00:00") }, otherImages)).reasons.join(),
    /日の上限 3 に2本が入らない（今日の試行 1・他経路 0・予約の子 1）/,
  );
  await db.exec("UPDATE sns_x_send_control SET daily_limit_x=4");
  const second = await push(
    bundle({ race_id: other, deadline: "17:30", images: imageNamesOf(other), poll_text: "あなたの予想は？\n#ボートレース" }),
    { now: at("14:00:00") },
    otherImages,
  );
  assert.ok(second.job_id, JSON.stringify(second));
  await db.exec("UPDATE sns_x_send_control SET daily_limit_x=3");
  await assert.rejects(claim(second.job_id), /日次全体上限/);
  // 投票のリプ自身は入る（自分を予約から除く。子は他の子の枠を数えない）
  assert.equal((await claim(main.poll_job_id)).state, "sending");
});

test("展示後のリプ: 締切の25〜13分前だけ受け取り、本投稿（posted）へのリプで画像4枚。13分前ちょうどは受け取らない", async () => {
  const main = await postMain();
  for (const t of ["16:04:59", "16:17:00", "16:20:00"]) {
    await setClock(at(t));
    const r = await push(replyBundle(), { now: at(t) });
    assert.match(
      r.reasons.join(),
      t === "16:04:59" ? /25分前より前/ : /13分前を過ぎた/,
      t,
    );
  }
  assert.equal(
    Number(
      (
        await first(
          "SELECT count(*) n FROM sns_auto_send_items WHERE variant='finals_reply'",
        )
      ).n,
    ),
    0,
  );
  await setClock(at("16:16:59"));
  const reply = await push(replyBundle(), { now: at("16:16:59") });
  assert.equal(reply.part, "reply");
  assert.ok(reply.job_id, JSON.stringify(reply));
  const job = await first("SELECT * FROM sns_x_send_jobs WHERE id=$1", [
    reply.job_id,
  ]);
  assert.equal(job.parent_job_id, main.job_id);
  assert.equal(job.expires_at.toISOString(), "2037-10-26T07:25:00.000Z");
  const item = await first(
    "SELECT * FROM sns_auto_send_items WHERE variant='finals_reply'",
  );
  assert.deepEqual([item.kind, item.state], ["finals_image", "notified"]);
  const snapshot = JSON.parse(job.snapshot_text);
  assert.equal(snapshot.media.length, 4);
  assert.ok(snapshot.media.every((m) => m.path.includes("/reply-")));
  assert.equal(snapshot.text, replyBundle().x_text);
  assert.equal(snapshot.poll, undefined);
  // 送る直前の読み直しは、本投稿を送った後も止まらない
  assert.equal(
    (await readCurrent((await draftOf("reply")).id)).cancelled,
    false,
  );
  // 2回目は何もしない（exit 4）
  const again = await push(replyBundle(), { now: at("16:16:59") });
  assert.equal(again.already, true);
  assert.equal(resultLine(RACE, again).code, 4);
  assert.match(resultLine(RACE, again).text, /"part":"reply"/);
  assert.equal(
    (await finalsStatus(RACE, { store })).reply.job_id,
    reply.job_id,
  );
});

test("展示後のリプは本投稿が送られていなければ受け取らない（親が無い）。許可が off なら何も書かない", async () => {
  await setClock(at("16:10:00"));
  const none = await push(replyBundle(), { now: at("16:10:00") });
  assert.match(none.reasons.join(), /本投稿がまだ送られていない/);
  // 本投稿を受け取っただけ（未送信）でも同じ
  await push(bundle(), { now: at("16:10:00") });
  const pending = await push(replyBundle(), { now: at("16:10:00") });
  assert.match(pending.reasons.join(), /本投稿がまだ送られていない/);
  await clearRows();
  await postMain();
  await db.exec("UPDATE sns_auto_send_control SET finals_image_enabled=false");
  await setClock(at("16:10:00"));
  const before = Number((await first("SELECT count(*) n FROM sns_drafts")).n);
  const off = await push(replyBundle(), { now: at("16:10:00") });
  assert.equal(off.disabled, true);
  assert.equal(resultLine(RACE, off).code, 3);
  assert.equal(
    Number((await first("SELECT count(*) n FROM sns_drafts")).n),
    before,
  );
});

test("本投稿が日の上限で受け取れなければ、投票のリプも作らない（何も書かない）", async () => {
  await db.exec("UPDATE sns_x_send_control SET daily_limit_x=1");
  const result = await push();
  assert.match(result.reasons.join(), /2本が入らない/);
  assert.deepEqual(await counts(), NOTHING);
});

test("投票のリプの承認で落ちたら、本投稿も投票のリプも held_manual にして送らない（承認済みの本投稿の job は claim で止まる）", async () => {
  const failing = {
    ...store,
    updateDraft: async () => {
      throw new Error("下書きを更新できない");
    },
  };
  const result = await push(bundle(), { store: failing });
  assert.match(result.error, /下書きを更新できない/);
  assert.equal(result.job_id, undefined);
  assert.deepEqual(
    (await all("SELECT state FROM sns_auto_send_items ORDER BY variant")).map(
      (r) => r.state,
    ),
    ["held_manual", "held_manual"],
  );
  const r = await claim((await first(MAIN_JOB)).id);
  assert.equal(r.state, "held");
  assert.equal(r.error_code, "auto_stopped");
  assert.match(result.notes[0], /止めた/);
});

test("待つ（本投稿）: 本投稿が posted になった後、投票のリプが送り終わるまで待つ", async () => {
  const result = await push();
  const main = await first(MAIN_JOB);
  const poll = await first(POLL_JOB);
  let clock = NOW.getTime();
  let sleeps = 0;
  const status = await waitForSend(RACE, {
    store,
    draftId: result.draft_id,
    pollDraftId: result.poll_draft_id,
    expiresAt: "2037-10-26T07:25:00.000Z",
    now: () => new Date(clock),
    sleep: async (sec) => {
      sleeps += 1;
      clock += sec * 1000;
      if (sleeps === 1)
        await post(main.id, "1890000000000000030", "2037-10-26T07:15:30Z");
      if (sleeps === 2)
        await post(poll.id, "1890000000000000031", "2037-10-26T07:16:30Z");
    },
  });
  assert.equal(sleeps, 2);
  assert.equal(status.job_state, "posted");
  assert.equal(status.poll.job_state, "posted");
  assert.equal(status.poll.tweet_id, "1890000000000000031");
  assert.equal(resultLine(RACE, result, status).code, 0);
  const all3 = await finalsStatus(RACE, { store });
  assert.equal(all3.poll.tweet_id, "1890000000000000031");
  assert.equal(all3.reply, null);
});

test("177: 承認の関数は snapshot.poll と下書きの x_poll の一致を照合し、投票と媒体の同居を拒む", async () => {
  const failing = { ...store };
  let caught = null;
  failing.approve = async (a) => {
    if (a.p_snapshot.poll) {
      const bad = { ...a.p_snapshot, poll: { ...a.p_snapshot.poll, options: [...POLL.slice(0, 3), "E 5号艇"] } };
      caught = await store.approve({ ...a, p_snapshot: bad }).then(() => null, (e) => e);
      const withMedia = { ...a.p_snapshot, media: [{ path: "x.png", sha256: "a".repeat(64), size: 1, type: "image/png" }] };
      caught = [caught, await store.approve({ ...a, p_snapshot: withMedia }).then(() => null, (e) => e)];
      const noPoll = { ...a.p_snapshot };
      delete noPoll.poll;
      caught.push(await store.approve({ ...a, p_snapshot: noPoll }).then(() => null, (e) => e));
    }
    return store.approve(a);
  };
  const result = await push(bundle(), { store: failing });
  assert.ok(result.poll_job_id, JSON.stringify(result));
  assert.equal(caught.length, 3);
  for (const e of caught) assert.match(String(e?.message), /承認中に投票が変わりました/);
});

test("177: 期限を過ぎた子・素材でない YouTube の子は予約に入らない", async () => {
  await setClock(at("14:02:00"));
  const main = await push(bundle(), { now: at("14:00:00") });
  await db.exec("UPDATE sns_x_send_control SET daily_limit_x=2");
  await post(main.job_id, "1890000000000000040", "2037-10-26T05:01:00Z");
  // 投票のリプの期限を過ぎた扱いにすると、他の親の claim の予約から外れる
  await db.query("UPDATE sns_x_send_jobs SET expires_at=$2 WHERE id=$1", [main.poll_job_id, "2037-10-26T04:59:00Z"]);
  const other = "2037-10-26-05-12";
  await db.query("INSERT INTO races VALUES($1,'2037-10-26','17:30:00',NULL)", [other]);
  await db.query("INSERT INTO race_conditions VALUES($1,'優勝戦')", [other]);
  await db.exec("UPDATE sns_x_send_control SET daily_limit_x=3");
  const second = await push(
    bundle({ race_id: other, deadline: "17:30", images: imageNamesOf(other), poll_text: "あなたの予想は？\n#ボートレース" }),
    { now: at("14:00:00") },
    Object.fromEntries(imageNamesOf(other).map((n, i) => [n, png(1080, 1350, 400 + i)])),
  );
  assert.ok(second.job_id, JSON.stringify(second));
  // 試行1＋自分1＋自分の子1＝3。期限切れの子は数えない
  assert.equal((await claim(second.job_id)).state, "sending");
  // YouTube の子（全貌の Shorts）は X の予約に入らない
  await db.exec("UPDATE sns_x_send_jobs SET channel='youtube' WHERE id='" + second.poll_job_id + "'");
  const rows = await store.waitingChildren(at("14:00:00"));
  assert.ok(rows.every((r) => r.channel === "x"));
});
test("/code-review の指摘の固定: 送る時刻は受け取りの2分後（承認の途中で本投稿が claim されない）・月の予算も子の分を見る", async () => {
  await setClock(PUSHED_AT);
  const result = await push();
  assert.equal(result.send_at, NOW.toISOString());
  await assert.rejects(claim(result.job_id), /claimできません/);
  await setClock(NOW);
  // 予算: 本投稿だけなら入るが、投票のリプ（URL つきの額）の分は入らない
  await db.exec(
    "UPDATE sns_x_send_control SET reserved_microusd=budget_microusd-250000*2+1",
  );
  await assert.rejects(claim(result.job_id), /月額上限/);
  await db.exec(
    "UPDATE sns_x_send_control SET reserved_microusd=budget_microusd-250000*2",
  );
  assert.equal((await claim(result.job_id)).state, "sending");
});

test("/code-review の指摘の固定: begin_post は子の枠を数え直さない（claim の後に他の親の子が増えても止まらない）", async () => {
  await setClock(at("14:02:00"));
  const a = await push(bundle(), { now: at("14:00:00") });
  await db.exec("UPDATE sns_x_send_control SET daily_limit_x=2");
  assert.equal((await claim(a.job_id)).state, "sending");
  const other = "2037-10-26-05-12";
  await db.query("INSERT INTO races VALUES($1,'2037-10-26','17:30:00',NULL)", [
    other,
  ]);
  await db.query("INSERT INTO race_conditions VALUES($1,'優勝戦')", [other]);
  await db.exec("UPDATE sns_x_send_control SET daily_limit_x=4");
  const b = await push(
    bundle({
      race_id: other,
      deadline: "17:30",
      images: imageNamesOf(other),
      poll_text: "あなたの予想は？\n#ボートレース",
    }),
    { now: at("14:00:00") },
    Object.fromEntries(
      imageNamesOf(other).map((n, i) => [n, png(1080, 1350, 500 + i)]),
    ),
  );
  assert.equal((await claim(b.job_id)).state, "sending");
  await db.exec("UPDATE sns_x_send_control SET daily_limit_x=2");
  const begun = await first(
    "SELECT public.transition_sns_x_send($1,'begin_post','{}'::jsonb) r",
    [a.job_id],
  );
  assert.equal(begun.r.state, "reconcile");
});

test("/code-review の指摘の固定: 作り直すと前の投票のリプの job は取り消す。展示後のリプの親は item でなく posted の job で探す", async () => {
  const firstPush = await push();
  await db.exec(
    "UPDATE sns_x_send_jobs SET state='held', error_code='source_stale' WHERE parent_job_id IS NULL",
  );
  const retried = await push();
  assert.ok(retried.job_id);
  const old = await first(
    "SELECT state, error_code FROM sns_x_send_jobs WHERE id=$1",
    [firstPush.poll_job_id],
  );
  assert.deepEqual(
    [old.state, old.error_code],
    ["cancelled", "approval_invalidated"],
  );
  // 本投稿を送ったが item が sent でない（要照合の後で手で complete した等）
  await clearRows();
  const main = await postMain();
  await db.exec(
    "UPDATE sns_auto_send_items SET state='notified' WHERE variant='finals'",
  );
  await setClock(at("16:10:00"));
  const reply = await push(replyBundle(), { now: at("16:10:00") });
  assert.ok(reply.job_id, JSON.stringify(reply));
  assert.equal(
    (
      await first("SELECT parent_job_id FROM sns_x_send_jobs WHERE id=$1", [
        reply.job_id,
      ])
    ).parent_job_id,
    main.job_id,
  );
});
