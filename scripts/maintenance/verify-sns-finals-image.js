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
} from "../sns/push-finals-image.js";
import { createReadCurrent } from "../../api/_lib/snsClaimCheck.js";
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
  ...patch,
});
const IMAGES = () =>
  Object.fromEntries(
    NAMES.map((name, i) => [name, png(1080, 1350, 200 + i)]),
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
  finalsItems: (id) =>
    all(
      "SELECT id, state, draft_id FROM sns_auto_send_items WHERE kind='finals_image' AND race_id=$1 ORDER BY created_at DESC",
      [id],
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
      "SELECT attempt_dates::text[] attempt_dates, attempt_channels FROM sns_x_send_jobs WHERE $1::date = ANY(attempt_dates)",
      [day],
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
      `INSERT INTO sns_auto_send_items(kind,variant,draft_id,channel,race_id,deadline_at,notify_by,veto_until,state,checks,notified_at,stop_token_hash)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
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
      ],
    ),
  updateItem: (id, from, patch) =>
    first(
      "UPDATE sns_auto_send_items SET state=$3, stopped_at=$4, stopped_via=$5 WHERE id=$1 AND state=$2 RETURNING *",
      [id, from, patch.state, patch.stopped_at ?? null, patch.stopped_via ?? null],
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
    now: NOW,
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
    db.query("UPDATE sns_auto_send_control SET finals_image_enabled=true WHERE channel='youtube'"),
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
  const item = await first("SELECT * FROM sns_auto_send_items");
  assert.deepEqual(
    [item.kind, item.variant, item.channel, item.state],
    ["finals_image", "finals", "x", "notified"],
  );
  const job = await first("SELECT * FROM sns_x_send_jobs");
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
  const job = await first("SELECT id FROM sns_x_send_jobs");
  await db.exec("UPDATE sns_auto_send_control SET finals_image_enabled=false");
  const r = await claim(job.id);
  assert.equal(r.state, "held");
  assert.equal(r.error_code, "finals_image_disabled");
});

test("claim の時間の窓: 締切の5分前（期限）を過ぎたら deadline_expired。全貌など finals_image でない job の期限は30分前のまま", async () => {
  await push();
  const job = await first("SELECT id FROM sns_x_send_jobs");
  await setClock(at("16:25:00"));
  const r = await claim(job.id);
  assert.equal(r.state, "held");
  assert.equal(r.error_code, "deadline_expired");
  // finals_image でない job に5分前の期限を入れると、今までどおり deadline_policy_changed
  await db.exec(
    "UPDATE sns_auto_send_items SET kind='full_picture', variant='main'",
  );
  await db.exec("UPDATE sns_x_send_jobs SET state='queued', error_code=NULL");
  await setClock(at("16:20:00"));
  const other = await claim(job.id);
  assert.equal(other.error_code, "deadline_policy_changed");
});

test("締切の8分前を過ぎて届いたら受け取らない（8分前ちょうどは拒否、その1秒前は受け取る）", async () => {
  const late = await push(bundle(), { now: at("16:22:00") });
  assert.match(late.reasons.join(), /8分前を過ぎた/);
  assert.deepEqual(await counts(), NOTHING);
  const ok = await push(bundle(), { now: at("16:21:59") });
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
    checkImages(NAMES, { ...IMAGES(), [NAMES[3]]: png(1080, 1350, 5000000 - 24) }),
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
    assert.match(checkFinalsImage(bundle({ images }), riskRules).join(), /images が/);
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
    (
      await push(bundle({ deadline: "16:31" }))
    ).reasons.join(),
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
  assert.equal(Number((await first("SELECT count(*) n FROM sns_drafts")).n), 1);
  await db.exec("UPDATE sns_auto_send_items SET state='sent'");
  assert.match((await push()).reason, /既にある（item sent/);
  // 自動の job が送らずに終わった（held）なら、前の item を superseded で止めて作り直す（期限までのやり直し）
  await db.exec("UPDATE sns_auto_send_items SET state='notified'; UPDATE sns_x_send_jobs SET state='held', error_code='source_stale'");
  const retried = await push();
  assert.ok(retried.job_id);
  assert.notEqual(retried.job_id, firstPush.job_id);
  assert.deepEqual(
    (await all("SELECT state, stopped_via FROM sns_auto_send_items ORDER BY created_at, state")).map((r) => [r.state, r.stopped_via]).sort(),
    [["notified", null], ["stopped", "superseded"]],
  );
  // 送っている途中（reconcile）は作り直さない
  await db.exec("UPDATE sns_x_send_jobs SET state='reconcile' WHERE id='" + retried.job_id + "'");
  assert.equal((await push()).already, true);
});

test("許可が on で拒否したら Slack に理由を知らせる", async () => {
  const result = await push(bundle({ x_text: "儲かる優勝戦" }));
  assert.match(result.reasons.join(), /儲か/);
  assert.match(result.notes[0], /検査で拒否/);
});

test("mode=manual なら item は manual で job を作らない（個別承認に回す）", async () => {
  await db.exec("UPDATE sns_auto_send_control SET mode='manual'");
  const result = await push();
  assert.equal(result.job_id, undefined);
  assert.equal(
    (await first("SELECT state FROM sns_auto_send_items")).state,
    "manual",
  );
  assert.equal((await counts()).jobs, 0);
  assert.match(result.notes[0], /個別承認/);
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
        "SELECT id FROM sns_auto_send_items WHERE kind='finals_image' AND state='sent'",
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
  const draft = await first("SELECT * FROM sns_drafts");
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
  await db.exec("UPDATE sns_auto_send_control SET finals_image_enabled=true WHERE channel='x'");
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
  const job = await first("SELECT * FROM sns_x_send_jobs");
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
  const job = await first("SELECT id FROM sns_x_send_jobs");
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
  await db.exec("UPDATE sns_x_send_control SET daily_limit_x=2, daily_external_count=1");
  // 今日の X の試行1件（YouTube の試行は数えない）
  await db.exec(`WITH d AS (INSERT INTO sns_drafts(content_group_id,platform,language,format,caption_text)
      VALUES(gen_random_uuid(),'x','ja','today_digest','x') RETURNING id)
    INSERT INTO sns_x_send_jobs(draft_id,state,snapshot,snapshot_text,approved_hash,approver_id,approved_at,scheduled_at,attempt_dates,attempt_channels)
    SELECT id,'posted','{}'::jsonb,'{}','h',(SELECT id FROM sns_approvers LIMIT 1),test_now(),test_now(),
      ARRAY[(test_now() AT TIME ZONE 'Asia/Tokyo')::date,(test_now() AT TIME ZONE 'Asia/Tokyo')::date],ARRAY['x','youtube'] FROM d`);
  const full = await push();
  assert.match(full.reasons.join(), /日の上限 2 に入らない（今日の試行 1・他経路 1）/);
  assert.equal(Number((await first("SELECT count(*) n FROM sns_auto_send_items")).n), 0);
  await db.exec("UPDATE sns_x_send_control SET daily_limit_x=3");
  assert.ok((await push()).job_id);
  await db.exec("UPDATE sns_x_send_control SET daily_baseline_date=NULL");
  await db.exec("DELETE FROM sns_x_send_jobs WHERE auto_item_id IS NOT NULL; DELETE FROM sns_auto_send_items");
  assert.match((await push()).reasons.join(), /daily_baseline_date/);
});

test("CLI の結果の1行と exit: 送った 0・拒否 1・許可 off 3・既にある 4・送れなかった 5。最後の行は FINALS_RESULT の JSON", () => {
  const posted = resultLine(RACE, { job_id: "j1" }, {
    job_id: "j1", job_state: "posted", tweet_id: "189", tweet_url: "https://x.com/i/status/189", posted_at: "2037-10-26T07:16:30Z", error_code: null,
  });
  assert.equal(posted.code, 0);
  assert.match(posted.text, /^FINALS_RESULT \{.*"outcome":"posted".*"tweet_id":"189".*"job_id":"j1"|^FINALS_RESULT \{.*"job_id":"j1".*"tweet_id":"189"/);
  assert.equal(JSON.parse(posted.text.slice("FINALS_RESULT ".length)).posted_at, "2037-10-26T07:16:30Z");
  assert.equal(resultLine(RACE, { reasons: ["x"] }).code, 1);
  const off = resultLine(RACE, { dryRun: true, disabled: true });
  assert.equal(off.code, 3);
  assert.match(off.text, /finals_image_enabled/);
  assert.equal(resultLine(RACE, { dryRun: true, disabled: false }).code, 0);
  assert.equal(resultLine(RACE, { job_id: "j1" }, { job_id: "j1", job_state: "held", error_code: "deadline_expired" }).code, 5);
  assert.equal(resultLine(RACE, { draft_id: "d", item_id: "i" }).code, 5); // 個別承認・承認の失敗
  // --no-wait は予定に入れたら 0。待ったのに送れていない（止められた・要照合のまま）は 5
  assert.equal(resultLine(RACE, { job_id: "j1" }).code, 0);
  assert.equal(resultLine(RACE, { job_id: "j1" }, { job_id: "j1", job_state: "reconcile" }).code, 5);
  assert.equal(resultLine(RACE, { job_id: "j1" }, null, { waited: true }).code, 5);
  assert.ok(!posted.text.includes("\n"));
});

test("待つ: 送り手が送り終えたら（posted）返し、送らないまま期限＋90秒を過ぎたら返す", async () => {
  await push();
  const job = await first("SELECT id FROM sns_x_send_jobs");
  let clock = NOW.getTime();
  let sleeps = 0;
  // 2回目の確かめで送り手が送り終えた
  const draftId = (await first("SELECT id FROM sns_drafts")).id;
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
        await first("SELECT public.transition_sns_x_send($1,'begin_post','{}'::jsonb)", [job.id]);
        await first("SELECT public.transition_sns_x_send($1,'complete',$2::jsonb)", [
          job.id,
          JSON.stringify({ id: "1890000000000000002", posted_at: "2037-10-26T07:15:30Z" }),
        ]);
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
      if (polls === 2) await db.exec("UPDATE sns_x_send_jobs SET state='posted'");
    },
  });
  assert.equal(inFlight.job_state, "posted");
  assert.equal(polls, 2);
  // 送られないまま（queued）期限を過ぎた
  await db.exec("UPDATE sns_x_send_jobs SET state='queued', external_post_id=NULL, posted_at=NULL, external_post_url=NULL");
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
