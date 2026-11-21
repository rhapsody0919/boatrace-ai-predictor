// X の「数字で見たら」（集計ランキングの画像1枚、format=research_image、マイグレーション 179・180、scripts/sns/push-research-image.js、hq XR01）の再現テスト。
// PGlite に 180 までのマイグレーションを当て、本番と同じ承認の関数（approve_sns_x_send、177）・送信の claim（transition_sns_x_send、
// transition_sns_send_139 は 180）で通す。外部接続なし。X へは何も送らない
import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import {
  checkResearchBundle,
  pushResearchImage,
  researchStatus,
  resultLine,
  schedule,
} from "../sns/push-research-image.js";
import {
  parseResearchId,
  researchTextReasons,
  RESEARCH_BANNED_WORDS,
} from "../../api/_lib/snsResearchImage.js";
import { createReadCurrent } from "../../api/_lib/snsClaimCheck.js";
import {
  createDeadlinePreflight,
  createMockHeadless,
} from "../../api/_lib/snsDeadlineQueue.js";
import { createMockXAdapter, runXSendJob } from "../../api/_lib/snsXSend.js";
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
const DAY = "2037-10-28";
const SLUG = "not-wakunari";
const ID = `research:${DAY}:${SLUG}`;
const at = (hhmmss) => new Date(`${DAY}T${hhmmss}+09:00`);
// 15:00 に作って入れ、19:00 に送る。集計は 14:30
const PUSHED_AT = at("15:00:00");
const OBSERVED = at("14:30:00").toISOString();

/** 最小の PNG（署名と IHDR の幅・高さだけ。検査は IHDR だけを読む） */
function png(width = 1080, height = 1350, padding = 200) {
  const bytes = new Uint8Array(24 + padding);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  bytes[24] = padding % 251;
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
    "179_sns_research_image_items.sql",
    "180_sns_research_image_send.sql",
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
    UPDATE sns_auto_send_control SET mode='auto', dry_run=false, finals_image_enabled=false, research_image_enabled=(channel='x');
    UPDATE sns_x_send_control SET paused=false, timing_approved=true, max_source_age_seconds=14400, expiry_minutes=30, daily_limit_x=9, daily_limit_youtube=2, daily_baseline_date=(test_now() AT TIME ZONE 'Asia/Tokyo')::date, daily_external_count=0, period_start=test_now() - interval '1 day', period_end=test_now() + interval '30 days', budget_microusd=20000000, reserved_microusd=0, attempt_ceiling_microusd=250000, ceiling_x_url_microusd=250000, ceiling_x_plain_microusd=30000;`);
  await setClock(PUSHED_AT);
  saved.length = 0;
});
after(() => db.close());

const setClock = async (date) => {
  await db.query("UPDATE test_clock SET value=$1", [date.toISOString()]);
  await db.exec(
    "UPDATE sns_x_send_control SET daily_baseline_date=(test_now() AT TIME ZONE 'Asia/Tokyo')::date",
  );
};

const CAPTION =
  "【数字で見たら】5レースに1つは枠なりじゃない\n\n全国は 19.0%（直近1年 55,414レース）\nほぼ動かないのは江戸川だけ 1.6%\n\n地元の会場、体感と合ってた？";
const bundle = (patch = {}) => ({
  format: "research_image",
  date: DAY,
  slug: SLUG,
  send_time: "19:00",
  x_text: CAPTION,
  hashtags: ["#ボートレース"],
  images: [`${SLUG}.png`],
  source_observed_at: OBSERVED,
  review: { p0_count: 0, by: "machine" },
  ...patch,
});

const saved = [];
const store = {
  researchItems: (date) =>
    all(
      "SELECT id, state, draft_id, race_id, held_reason FROM sns_auto_send_items WHERE kind='research_image' AND race_id LIKE $1 ORDER BY created_at DESC",
      [`research:${date}:%`],
    ),
  controls: async () =>
    Object.fromEntries(
      (
        await all(
          "SELECT channel, mode, dry_run, auto_approver_id, research_image_enabled FROM sns_auto_send_control",
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
  jobForDraft: (draftId) =>
    first(
      "SELECT id, state, error_code, scheduled_at::text, expires_at::text, posted_at, external_post_id, external_post_url FROM sns_x_send_jobs WHERE draft_id=$1",
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
    first("UPDATE sns_drafts SET publish_blocked=$2 WHERE id=$1 RETURNING *", [
      id,
      patch.publish_blocked,
    ]),
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

const IMAGE = png();
const push = (b = bundle(), opts = {}, image = IMAGE) => {
  const f = {
    "/f/bundle.json": new TextEncoder().encode(JSON.stringify(b)),
    ...(image ? { [`/f/${SLUG}.png`]: image } : {}),
  };
  const notes = [];
  return pushResearchImage("/f", {
    store,
    readBytes: async (p) => {
      if (!f[p]) throw Object.assign(new Error("no file"), { code: "ENOENT" });
      return f[p];
    },
    notify: async (text) => notes.push(text),
    riskRules,
    now: PUSHED_AT,
    ...opts,
  }).then((r) => ({ ...r, notes }));
};
const transition = (jobId, action, result = {}) =>
  first("SELECT public.transition_sns_x_send($1,$2,$3::jsonb) r", [
    jobId,
    action,
    JSON.stringify(result),
  ]).then((row) => row.r);
const counts = async () => ({
  drafts: Number((await first("SELECT count(*) n FROM sns_drafts")).n),
  items: Number((await first("SELECT count(*) n FROM sns_auto_send_items")).n),
  jobs: Number((await first("SELECT count(*) n FROM sns_x_send_jobs")).n),
  saved: saved.length,
});
const NOTHING = { drafts: 0, items: 0, jobs: 0, saved: 0 };
const theJob = () => first("SELECT * FROM sns_x_send_jobs");

/** 送り手の読み直し（readCurrent）に PGlite の行を渡す（PostgREST の path を読み分ける） */
const readCurrent = createReadCurrent({
  db: async (p) => {
    const table = p.split("?")[0];
    const draftId = p.match(/(?:^|[?&])(?:id|draft_id)=eq\.([0-9a-f-]+)/)?.[1];
    if (table === "sns_drafts" && p.includes("select=platform"))
      return all(
        "SELECT platform, caption_text, hashtags, cover_image_path, video_storage_path FROM sns_drafts WHERE id=$1",
        [draftId],
      );
    if (table === "sns_drafts")
      return all(
        "SELECT bundle_import_id, source_data FROM sns_drafts WHERE id=$1",
        [draftId],
      );
    if (table === "sns_auto_send_items" && p.includes("state=eq.sent"))
      return all(
        "SELECT id FROM sns_auto_send_items WHERE kind='research_image' AND channel='x' AND race_id LIKE $1 AND state='sent'",
        [
          decodeURIComponent(p.match(/race_id=like\.([^&]+)/)[1]).replace(
            "*",
            "%",
          ),
        ],
      );
    if (table === "sns_auto_send_items")
      return all(
        "SELECT kind, race_id FROM sns_auto_send_items WHERE draft_id=$1",
        [draftId],
      );
    if (table === "sns_auto_send_control")
      return all(
        "SELECT research_image_enabled FROM sns_auto_send_control WHERE channel='x'",
      );
    return [];
  },
});
const preflightAt = (now, headless = null) =>
  createDeadlinePreflight({
    headless,
    markers: SCREEN_MARKERS,
    readCurrent,
    now: () => now.getTime(),
  });

test("180 の土台: 177 の transition_sns_send_139 の本文の md5 が本番（2026-10-27 の読み取り）と一致する", async () => {
  const body = async (file) => {
    const s = await readFile(
      new URL("../../docs/db-migration/" + file, import.meta.url),
      "utf8",
    );
    const i = s.indexOf(
      "CREATE OR REPLACE FUNCTION public.transition_sns_send_139",
    );
    const a = s.indexOf("AS $$", i) + 5;
    return s.slice(a, s.indexOf("$$;", a));
  };
  const md5 = (t) => createHash("md5").update(t).digest("hex");
  assert.equal(
    md5(await body("177_sns_finals_replies.sql")),
    "d70f142b2f3545d5660464b6c66aec59",
  );
  // 180 は 177 から research_image の行だけを足す（他の kind の行は同じ）
  const before177 = (await body("177_sns_finals_replies.sql")).split("\n");
  const after180 = (await body("180_sns_research_image_send.sql")).split("\n");
  const removed = before177.filter((line) => !after180.includes(line));
  assert.equal(removed.length, 5, removed.join("\n"));
  for (const line of removed)
    assert.match(
      line,
      /v_children INTEGER := 0;|v_expiry_min :=|ai\.kind IN \('digest','finals_image'\)|max_source_age_seconds/,
    );
});

test("179: research_image の item は X・variant=main・race_id は research:{日}:{slug} だけ。1日1本（別の slug も、送った後も入らない）。許可は既定 false・x の行だけ", async () => {
  const insert = (channel, raceId, variant = "main", state = "checking") =>
    db.query(
      `WITH draft AS (INSERT INTO sns_drafts(content_group_id,platform,language,format,caption_text)
         VALUES(gen_random_uuid(), $1, 'ja', 'research_image', '179') RETURNING id)
       INSERT INTO sns_auto_send_items(kind,variant,draft_id,channel,race_id,deadline_at,notify_by,veto_until,state)
       SELECT 'research_image', $3, id, $1, $2, test_now()+interval '3h', test_now(), test_now()+interval '1h', $4 FROM draft`,
      [channel, raceId, variant, state],
    );
  await assert.rejects(insert("youtube", ID), /kind_source/);
  await assert.rejects(insert("x", "2037-10-28-01-12"), /research_id/);
  await assert.rejects(insert("x", `research:${DAY}:Bad_Slug`), /research_id/);
  await assert.rejects(insert("x", ID, "finals"), /variant_scope|research_id/);
  await insert("x", ID);
  await assert.rejects(
    insert("x", `research:${DAY}:other-topic`),
    /sns_auto_send_items_research_day/,
  );
  // 別の日は入る
  await insert("x", "research:2037-10-30:other-topic");
  // 送った（sent）後も同じ日の2本目は入らない。止めた（stopped）・held_manual は外れる
  await db.exec(
    "UPDATE sns_auto_send_items SET state='sent', checks='{\"passed\":true}' WHERE race_id LIKE 'research:2037-10-28:%'",
  );
  await assert.rejects(
    insert("x", `research:${DAY}:third`),
    /sns_auto_send_items_research_day/,
  );
  await insert("x", `research:${DAY}:third`, "main", "held_manual");
  const def = await first(
    "SELECT column_default d FROM information_schema.columns WHERE table_name='sns_auto_send_control' AND column_name='research_image_enabled'",
  );
  assert.equal(def.d, "false");
  await assert.rejects(
    db.query(
      "UPDATE sns_auto_send_control SET research_image_enabled=true WHERE channel='youtube'",
    ),
    /research_image_x_only/,
  );
});

test("許可が off なら、検査が通っても何も書かない（DB・Storage・Slack とも。disabled・exit 3）。--dry-run も書かない", async () => {
  await db.exec(
    "UPDATE sns_auto_send_control SET research_image_enabled=false",
  );
  const off = await push();
  assert.equal(off.reasons, undefined);
  assert.equal(off.disabled, true);
  assert.deepEqual(await counts(), NOTHING);
  assert.deepEqual(off.notes, []);
  assert.equal(resultLine(off).code, 3);
  assert.match(resultLine(off).text, /^RESEARCH_RESULT .*"outcome":"disabled"/);
  await db.exec(
    "UPDATE sns_auto_send_control SET research_image_enabled=(channel='x')",
  );
  const dry = await push(bundle(), { dryRun: true });
  assert.equal(dry.dryRun, true);
  assert.equal(dry.disabled, false);
  assert.deepEqual(await counts(), NOTHING);
  assert.equal(resultLine(dry).code, 0);
});

test("許可が on・mode=auto: 画像1枚の job を 19:00 の予定に入れる（締切 21:00・期限 20:00）。race_id の代わりは research:{日}:{slug}", async () => {
  const result = await push();
  assert.equal(result.reasons, undefined);
  assert.equal(result.research_id, ID);
  assert.equal(result.send_at, at("19:00:00").toISOString());
  const item = await first("SELECT * FROM sns_auto_send_items");
  assert.deepEqual(
    [item.kind, item.variant, item.channel, item.state, item.race_id],
    ["research_image", "main", "x", "notified", ID],
  );
  assert.equal(item.deadline_at.toISOString(), at("21:00:00").toISOString());
  assert.equal(item.veto_until.toISOString(), at("19:00:00").toISOString());
  const job = await theJob();
  assert.equal(job.auto_item_id, item.id);
  assert.equal(job.scheduled_at.toISOString(), at("19:00:00").toISOString());
  assert.equal(job.expires_at.toISOString(), at("20:00:00").toISOString());
  const snapshot = JSON.parse(job.snapshot_text);
  assert.equal(snapshot.text, `${CAPTION}\n\n#ボートレース`);
  assert.equal(snapshot.media.length, 1);
  assert.equal(snapshot.media[0].type, "image/png");
  assert.equal(snapshot.queue.source_observed_at, OBSERVED);
  assert.equal(snapshot.queue.public_url, undefined);
  assert.equal(saved.length, 1);
  assert.match(result.notes[0], /19:00 に送る/);
  assert.match(result.notes[0], /research_image_enabled = false/);
  assert.equal(resultLine(result).code, 0);
  assert.match(resultLine(result).text, /"outcome":"queued"/);
  // 同じ日の2回目（別の題も）は何も作らず exit 4
  const again = await push(
    bundle({ slug: "other", images: ["other.png"] }),
    {},
    null,
  );
  assert.equal(again.already, true);
  assert.equal(resultLine(again).code, 4);
  assert.equal((await counts()).items, 1);
});

test("claim の時間の窓: 19:00 の前は送らない。19:00 に送れる（集計から4.5時間でも鮮度で止まらない）。20:00（期限）で deadline_expired", async () => {
  await push();
  const job = await theJob();
  await setClock(at("18:58:00"));
  await assert.rejects(
    transition(job.id, "claim"),
    /veto_window_open|claimできません/,
  );
  await setClock(at("19:00:00"));
  const r = await transition(job.id, "claim");
  assert.equal(r.state, "sending", r.error_code);
  // 期限の照合: 別の job で、期限の 20:00 に claim すると deadline_expired
  await db.exec(
    "DELETE FROM sns_x_send_jobs; DELETE FROM sns_auto_send_items;",
  );
  await setClock(PUSHED_AT);
  await push();
  await setClock(at("20:00:00"));
  const late = await transition((await theJob()).id, "claim");
  assert.equal(late.state, "held");
  assert.equal(late.error_code, "deadline_expired");
});

test("鮮度は research_image だけ24時間: 他の kind の4時間（max_source_age_seconds）は変わらない", async () => {
  await push();
  const job = await theJob();
  await setClock(at("19:00:00"));
  // research_image の item を digest に変えると、集計の 14:30 から4時間を越えて source_stale（他の kind の動きは今までどおり）
  await db.exec(
    "UPDATE sns_auto_send_items SET kind='digest', race_id='today:2037-10-28'",
  );
  // digest の期限は expiry_minutes=30（締切 21:00 の30分前）なので、期限の照合を通すために合わせる
  await db.query(
    "UPDATE sns_x_send_jobs SET expires_at=$2::timestamptz, snapshot=jsonb_set(snapshot,'{queue,expires_at}',to_jsonb($3::text)) WHERE id=$1",
    [job.id, at("20:30:00").toISOString(), at("20:30:00").toISOString()],
  );
  const r = await transition(job.id, "claim");
  assert.equal(r.state, "held");
  assert.equal(r.error_code, "source_stale");
});

test("claim の時も許可を見る: 承認の後に off にすると held（research_image_disabled）", async () => {
  await push();
  await db.exec(
    "UPDATE sns_auto_send_control SET research_image_enabled=false",
  );
  await setClock(at("19:00:00"));
  const r = await transition((await theJob()).id, "claim");
  assert.equal(r.state, "held");
  assert.equal(r.error_code, "research_image_disabled");
  const status = await researchStatus(DAY, { store, now: at("19:01:00") });
  assert.deepEqual(
    [status.research_id, status.job_state, status.error_code],
    [ID, "held", "research_image_disabled"],
  );
});

test("取り置き（180 の v_a_pending）: 通り道 B の claim は、今日まだ送っていない research_image の分を先に枠から引く", async () => {
  await push();
  await db.exec("UPDATE sns_x_send_control SET daily_limit_x=1");
  const me = (
    await first("SELECT id FROM sns_approvers WHERE display_name='本人'")
  ).id;
  const queue = {
    deadline_at: at("17:00:00").toISOString(),
    expires_at: at("16:30:00").toISOString(),
    source_revision: "r1",
    source_observed_at: PUSHED_AT.toISOString(),
  };
  const b = await first(
    `INSERT INTO sns_drafts(content_group_id,format,platform,language,caption_text,send_lane,publish_blocked,publication_hold_reasons,source_data)
     VALUES(gen_random_uuid(),'topic','x','ja','企画の投稿','B',false,'[]'::jsonb,jsonb_build_object('deadline_queue',$1::jsonb)) RETURNING *`,
    [queue],
  );
  const snapshot = {
    text: "企画の投稿",
    media: [],
    queue,
    source: {
      caption_text: "企画の投稿",
      hashtags: null,
      video_storage_path: null,
      cover_image_path: null,
      language: "ja",
    },
  };
  const bJob = (
    await first("SELECT approve_sns_x_send($1,$2,$3,$4) r", [
      b.id,
      me,
      snapshot,
      PUSHED_AT.toISOString(),
    ])
  ).r;
  await assert.rejects(transition(bJob.id, "claim"), /日次全体上限/);
  await db.exec("UPDATE sns_x_send_control SET daily_limit_x=2");
  assert.equal((await transition(bJob.id, "claim")).state, "sending");
});

test("検査: 禁止表現（各語・本文の「競艇」・risk-rules）・#競艇 のタグは可・加重280・リンク・置き場所・本文のハッシュタグ・画像1枚・P0・時刻", async () => {
  assert.deepEqual(checkResearchBundle(bundle(), riskRules), []);
  for (const word of RESEARCH_BANNED_WORDS)
    assert.match(
      checkResearchBundle(
        bundle({ x_text: `数字で見たら、${word}` }),
        riskRules,
      ).join(),
      /禁止表現/,
      word,
    );
  assert.match(
    checkResearchBundle(bundle({ x_text: "競艇の数字" }), riskRules).join(),
    /禁止表現/,
  );
  // 空白を挟んでも止める（送る直前は risk-rules を当てないので、この一覧だけで止まること）
  for (const caption of ["競　艇の数字", "万 舟 券の数字", "儲 かる数字"])
    assert.match(
      researchTextReasons({ caption, hashtags: [] }).join(),
      /禁止表現/,
      caption,
    );
  // ハッシュタグの #競艇 そのものは例外。#競艇場 は不可
  assert.deepEqual(
    checkResearchBundle(
      bundle({ hashtags: ["#ボートレース", "#競艇"] }),
      riskRules,
    ),
    [],
  );
  assert.match(
    checkResearchBundle(bundle({ hashtags: ["#競艇場"] }), riskRules).join(),
    /禁止表現/,
  );
  assert.match(
    checkResearchBundle(
      bundle({ hashtags: ["#a", "#b", "#c"] }),
      riskRules,
    ).join(),
    /hashtags/,
  );
  // 加重280（本文＋ハッシュタグの行）: 全角でちょうど280は通り、1字多いと超える
  // 「\n\n#ボートレース」は加重 2 + 1 + 6×2 = 15
  const fit = "あ".repeat((280 - 15 - 1) / 2) + "a"; // 132×2 + 1 + 15 = 280
  assert.deepEqual(checkResearchBundle(bundle({ x_text: fit }), riskRules), []);
  assert.match(
    checkResearchBundle(bundle({ x_text: `${fit}a` }), riskRules).join(),
    /280/,
  );
  for (const link of [
    "詳しくは https://www.boat-ai.jp/today",
    "詳しくは boat-ai.jp で",
  ])
    assert.match(
      checkResearchBundle(bundle({ x_text: link }), riskRules).join(),
      /リンク/,
      link,
    );
  assert.match(
    checkResearchBundle(bundle({ x_text: "全国は{value}%" }), riskRules).join(),
    /置き場所/,
  );
  assert.match(
    checkResearchBundle(
      bundle({ x_text: `${CAPTION}\n#ボートレース` }),
      riskRules,
    ).join(),
    /ハッシュタグ/,
  );
  assert.match(
    checkResearchBundle(
      bundle({ images: ["a.png", "b.png"] }),
      riskRules,
    ).join(),
    /1枚/,
  );
  assert.match(
    checkResearchBundle(bundle({ review: { p0_count: 1 } }), riskRules).join(),
    /P0/,
  );
  for (const send_time of ["07:59", "21:31", "7:00"])
    assert.match(
      checkResearchBundle(bundle({ send_time }), riskRules).join(),
      /send_time/,
      send_time,
    );
  assert.equal(parseResearchId(ID).slug, SLUG);
  assert.equal(parseResearchId("research:2037-10-28:Bad"), null);
  // 本文が空
  assert.deepEqual(researchTextReasons({ caption: "", hashtags: [] }), [
    "x_text が無い",
  ]);
});

test("検査（時刻・画像）: 今日でない・期限の10分前を過ぎた・集計が未来・期限までに24時間を越える・画像の大きさ。拒否は Slack に知らせて何も書かない", async () => {
  const reasonsOf = async (b, opts, image) =>
    (await push(b, opts, image)).reasons?.join() ?? "";
  assert.match(await reasonsOf(bundle({ date: "2037-10-29" })), /今日/);
  // 期限 20:00 の10分前（19:50）ちょうどは拒否、その1秒前は受け取る
  assert.match(
    await reasonsOf(bundle(), { now: at("19:50:00") }),
    /10分前を過ぎた/,
  );
  assert.match(
    await reasonsOf(
      bundle({ source_observed_at: at("15:30:00").toISOString() }),
    ),
    /今より後/,
  );
  // 期限 20:00 の24時間前ちょうどは古い
  assert.match(
    await reasonsOf(
      bundle({
        source_observed_at: new Date(
          at("20:00:00").getTime() - 86400000,
        ).toISOString(),
      }),
    ),
    /古い/,
  );
  // 時差の無い時刻は、Node と DB で別の時刻に読まれるので受け取らない
  assert.match(
    await reasonsOf(bundle({ source_observed_at: "2037-10-28T14:30:00" })),
    /時差/,
  );
  assert.match(await reasonsOf(bundle(), {}, png(1200, 1350)), /1080×1350/);
  assert.match(await reasonsOf(bundle(), {}, null), /無い/);
  assert.deepEqual(await counts(), NOTHING);
  const rejected = await push(bundle({ x_text: "儲かる数字" }));
  assert.match(rejected.notes[0], /検査で拒否/);
  assert.equal(resultLine(rejected).code, 1);
  // 19:49:59 は受け取る（送る時刻は今＋2分）
  const late = await push(bundle(), { now: at("19:49:59") });
  assert.equal(late.reasons, undefined);
  assert.equal(
    late.send_at,
    new Date(at("19:49:59").getTime() + 120000).toISOString(),
  );
});

test("X の日の上限: 受け取る時点でもう1本が入らなければ受け取らない", async () => {
  await db.exec(
    "UPDATE sns_x_send_control SET daily_limit_x=1, daily_external_count=1",
  );
  const result = await push();
  assert.match(result.reasons.join(), /日の上限/);
  assert.deepEqual(await counts(), NOTHING);
});

test("mode=manual なら held_manual で job を作らない（exit 5）", async () => {
  await db.exec("UPDATE sns_auto_send_control SET mode='manual'");
  const result = await push();
  assert.equal(result.job_id, undefined);
  assert.equal(
    (await first("SELECT state FROM sns_auto_send_items")).state,
    "held_manual",
  );
  assert.equal((await counts()).jobs, 0);
  assert.match(result.notes[0], /送らない/);
  assert.equal(resultLine(result).code, 5);
  // held_manual は1日1本から外れるので、自動に戻した後に入れ直せる
  await db.exec("UPDATE sns_auto_send_control SET mode='auto'");
  assert.ok((await push()).job_id);
});

test("自動の承認に失敗したら item を held_manual にし、結果の1行に失敗の理由を書く（exit 5）", async () => {
  const result = await push(bundle(), {
    store: { ...store, approve: async () => Promise.reject(new Error("承認の関数が拒否")) },
  });
  assert.equal(result.job_id, undefined);
  assert.equal((await first("SELECT state FROM sns_auto_send_items")).state, "held_manual");
  const line = resultLine(result);
  assert.equal(line.code, 5);
  assert.match(line.text, /自動の承認に失敗/);
});

test("送らずに終わった（held）job は作り直す: 前の item を stopped（superseded）にして新しい版を入れる", async () => {
  const firstPush = await push();
  await db.exec(
    "UPDATE sns_x_send_jobs SET state='held', error_code='research_image_disabled'",
  );
  const retried = await push(bundle({ x_text: `${CAPTION}！` }));
  assert.ok(retried.job_id);
  assert.notEqual(retried.job_id, firstPush.job_id);
  const old = await first(
    "SELECT state, stopped_via FROM sns_auto_send_items WHERE id=$1",
    [firstPush.item_id],
  );
  assert.deepEqual([old.state, old.stopped_via], ["stopped", "superseded"]);
});

test("送り手の読み直し（readCurrent）: 許可・同じ日に送った research_image・item の kind・本文・画像の数を DB から見る。public_check は none", async () => {
  await push();
  const draft = await first("SELECT * FROM sns_drafts");
  const current = await readCurrent(draft.id);
  assert.deepEqual(current, {
    withdrawn: false,
    cancelled: false,
    deadline_at: at("21:00:00").toISOString(),
    source_revision: draft.source_data.research_image.revision,
    public_check: "none",
  });
  assert.equal(
    current.source_revision,
    draft.source_data.deadline_queue.source_revision,
  );
  await db.exec(
    "UPDATE sns_auto_send_control SET research_image_enabled=false",
  );
  await assert.rejects(readCurrent(draft.id), /research_image_disabled/);
  await db.exec(
    "UPDATE sns_auto_send_control SET research_image_enabled=(channel='x')",
  );
  await db.exec("UPDATE sns_auto_send_items SET state='sent'");
  await assert.rejects(readCurrent(draft.id), /research_already_sent_today/);
  await db.exec("UPDATE sns_auto_send_items SET state='notified'");
  // 本文が変わって禁止表現・リンクが入ったら止める（下書きの書き換えは承認でも止まるが、読み直しでも見る）
  await db.exec("ALTER TABLE sns_drafts DISABLE TRIGGER USER");
  await db.query("UPDATE sns_drafts SET caption_text=$2 WHERE id=$1", [
    draft.id,
    "詳しくは boat-ai.jp",
  ]);
  await assert.rejects(readCurrent(draft.id), /research_text_rejected/);
  await db.query(
    "UPDATE sns_drafts SET caption_text=$2, source_data=jsonb_set(source_data,'{image_paths}',$3::jsonb) WHERE id=$1",
    [draft.id, CAPTION, JSON.stringify([draft.cover_image_path, "x.png"])],
  );
  await assert.rejects(readCurrent(draft.id), /research_image_count/);
  await db.query("UPDATE sns_drafts SET source_data=$2 WHERE id=$1", [
    draft.id,
    draft.source_data,
  ]);
  await db.exec("ALTER TABLE sns_drafts ENABLE TRIGGER USER");
  // item が research_image でない（race_id が違う）なら、リンク先の表示の確認を外さない
  await db.exec(
    "UPDATE sns_auto_send_items SET race_id='research:2037-10-28:other'",
  );
  await assert.rejects(readCurrent(draft.id), /research_item_mismatch/);
});

test("送る直前の検査（createDeadlinePreflight）: research_image はリンク先の表示を開かずに通る。送る文にリンクがあれば link_not_allowed。他の型は今までどおり表示を確かめる", async () => {
  await push();
  const job = await theJob();
  const headless = createMockHeadless({ fail: true });
  await preflightAt(at("19:00:00"), headless)(job);
  assert.equal(headless.calls.length, 0);
  await assert.rejects(preflightAt(at("20:00:00"))(job), /deadline_expired/);
  const linked = {
    ...job,
    snapshot_text: JSON.stringify({
      ...JSON.parse(job.snapshot_text),
      text: `${CAPTION} https://www.boat-ai.jp/today`,
    }),
  };
  await assert.rejects(preflightAt(at("19:00:00"))(linked), /link_not_allowed/);
  // public_check の無い readCurrent（他の型）はリンク先の表示を確かめる（headless が無ければ止まる）
  const other = createDeadlinePreflight({
    headless: null,
    markers: SCREEN_MARKERS,
    readCurrent: async () => ({
      withdrawn: false,
      cancelled: false,
      deadline_at: JSON.parse(job.snapshot_text).queue.deadline_at,
      source_revision: JSON.parse(job.snapshot_text).queue.source_revision,
    }),
    now: () => at("19:00:00").getTime(),
  });
  await assert.rejects(other(job), /public_check_unconfigured/);
});

test("送る: 19:00 に画像1枚と本文を X に渡し、送った後は item が sent・状態に tweet id が出る", async () => {
  await push();
  const job = await theJob();
  await setClock(at("19:00:00"));
  const x = createMockXAdapter({ postId: "1890000000000000101" });
  const done = await runXSendJob(job.id, {
    store: {
      transition: (id, action, r = {}) => transition(id, action, r),
    },
    x,
    wait: async () => {},
    loadMedia: async () => IMAGE,
    preflight: preflightAt(at("19:00:00")),
    now: () => at("19:00:00").getTime(),
  });
  assert.equal(done.state, "posted", done.error_code);
  const post = x.calls.find((c) => c.method === "createPost");
  assert.equal(post.payload.text, `${CAPTION}\n\n#ボートレース`);
  assert.equal(post.payload.mediaIds.length, 1);
  assert.equal(
    (await first("SELECT state FROM sns_auto_send_items")).state,
    "sent",
  );
  const status = await researchStatus(DAY, { store });
  assert.deepEqual(
    [status.research_id, status.item_state, status.job_state, status.tweet_id],
    [ID, "sent", "posted", "1890000000000000101"],
  );
  // 送った後の同じ日の2本目は入らない
  assert.equal(
    (
      await push(
        bundle({ slug: "next", images: ["next.png"] }),
        { now: at("19:10:00") },
        null,
      )
    ).already,
    true,
  );
});

test("記録: 送る前の検査で落ちた job（claim されず queued）は、送り手の最後の報告の precheck の理由を precheck_reason に出す", async () => {
  await push();
  const job = await theJob();
  const report = {
    alerts: [
      { key: "precheck:other:x", text: "別の job" },
      { key: `precheck:${job.id}:research_text_rejected`, text: "検査で止まった" },
    ],
  };
  const status = await researchStatus(DAY, {
    store: { ...store, sendReport: async () => report },
    now: at("19:10:00"),
  });
  assert.equal(status.precheck_reason, "research_text_rejected");
  // 報告を読めなくても状態は返す
  const broken = await researchStatus(DAY, {
    store: { ...store, sendReport: async () => Promise.reject(new Error("HTTP 500")) },
    now: at("19:10:00"),
  });
  assert.equal(broken.precheck_reason, null);
  assert.equal(broken.job_state, "queued");
});

test("記録: 送る時刻を過ぎて queued のまま（claim が日の上限で投げている）なら blocked_hint に日の上限を出す", async () => {
  await push();
  await db.exec("UPDATE sns_x_send_control SET daily_external_count=9");
  const status = await researchStatus(DAY, { store, now: at("19:10:00") });
  assert.equal(status.job_state, "queued");
  assert.match(status.blocked_hint, /日の上限/);
  // schedule は純粋関数（送る時刻・締切・期限）
  const when = schedule(bundle(), PUSHED_AT);
  assert.deepEqual(
    [when.send_at, when.deadline_at, when.expires_at],
    [at("19:00:00"), at("21:00:00"), at("20:00:00")].map((d) =>
      d.toISOString(),
    ),
  );
});
