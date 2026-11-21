// X の「節の機力」（kind=setsu_kiryoku、画像1枚＋本文、毎日 21:30、BOA-1209、マイグレーション 194、scripts/sns/push-setsu-kiryoku.js）の再現テスト。
// PGlite に 189 まで・193（Shorts の節の機力）・194 を当て、本番と同じ承認（approve_sns_x_send、177）・claim（transition_sns_x_send →
// transition_sns_send_139）で通す。194 の transition が 193 から4か所だけ変わること、検査（数字で見たらと同じ＋選手の名前と級）、
// 許可（setsu_kiryoku_enabled）・期限（21:30 から60分）・1日1本、送り手の読み直しを確かめる。外部接続なし。X へは何も送らない
import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { pushSetsuKiryoku, resultLine, SETSU_TYPE } from "../sns/push-research-image.js";

import { createReadCurrent } from "../../api/_lib/snsClaimCheck.js";




import { runSnsSetsuKiryokuXScenes1, runSnsSetsuKiryokuXScenes2 } from "./verifyData/sns-setsu-kiryoku-x-scenes-1.js";
import { runSnsSetsuKiryokuXScenes3, makeStoreOf } from "./verifyData/sns-setsu-kiryoku-x-scenes-2.js";

const BASE_FILES = [
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
  "182_sns_x_kind_reserves.sql",
  "186_sns_youtube_close_private.sql",
  "188_sns_x_cost_by_url.sql",
  "189_sns_today_thinking.sql",
  "193_sns_setsu_kiryoku_short.sql",
];
const MIGRATION = "194_sns_setsu_kiryoku_x.sql";
/** 本文の md5（本番の md5(prosrc)）。182・188・189 は verify-sns-today-thinking.js と同じ値（189 は 2026-11-02 に本番を読み取りで確認） */
const MD5_182 = "c2b4835c416ff6e824a43fe9025c6518";
const MD5_188 = "ce1cd6fa756be8887f4033ab635a706b";
const MD5_189 = "96c809c05e1675d24feee596516db777";
/** 193 の本文（194 の先頭の照合）と 194 の本文（適用後の確認） */
const MD5_193 = "db961c46ca726a574b15e79c9f249d14";
const MD5_194 = "8d4f3caa34e30dda934e9b8698d970f4";
const MD5_153_X = "5ae12380ba47e6256388eec8691a603f";

const sqlOf = (file) =>
  readFile(new URL("../../docs/db-migration/" + file, import.meta.url), "utf8");
const md5 = (t) => createHash("md5").update(t).digest("hex");
const bodyOf = (s, fn) => {
  const i = s.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}(`);
  const a = s.indexOf("AS $$", i) + 5;
  return s.slice(a, s.indexOf("$$;", a));
};
const lastBody = async (files, fn) => {
  let body = null;
  for (const f of files) {
    const s = await sqlOf(f);
    if (s.includes(`CREATE OR REPLACE FUNCTION public.${fn}(`))
      body = bodyOf(s, fn);
  }
  return body;
};
const forTest = (s) => s.replaceAll("now()", "test_now()");
/** md5 で土台を照合するマイグレーションの照合の値を、試験の土台（now() を test_now() にした本文）の md5 に差し替える */
async function guardedForTest(file, baseFiles, fn, baseMd5) {
  const base = md5(forTest(await lastBody(baseFiles, fn)));
  const text = forTest(await sqlOf(file));
  const guards = [
    `md5(prosrc) = '${baseMd5}'`,
    `IS DISTINCT FROM '${baseMd5}'`,
  ];
  const guard = guards.find((g) => text.includes(g));
  assert.ok(guard, `${file} に照合の md5 ${baseMd5} が無い`);
  assert.equal(text.split(guard).length, 2, `${file} の照合の md5 は1か所`);
  return text.replace(guard, guard.replace(baseMd5, base));
}
const GUARDS = {
  "186_sns_youtube_close_private.sql": ["transition_sns_x_send", MD5_153_X],
  "188_sns_x_cost_by_url.sql": ["transition_sns_send_139", MD5_182],
  "189_sns_today_thinking.sql": ["transition_sns_send_139", MD5_188],
  "193_sns_setsu_kiryoku_short.sql": ["transition_sns_send_139", MD5_189],
  [MIGRATION]: ["transition_sns_send_139", MD5_193],
};

const db = new PGlite();
const first = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const all = async (sql, args = []) => (await db.query(sql, args)).rows;
const riskRules = JSON.parse(
  await readFile(
    new URL("../../sns-video-studio/remotion/risk-rules.json", import.meta.url),
    "utf8",
  ),
).rules;
const DAY = "2037-11-03";
const SLUG = "v15-final";
const ID = `setsu:${DAY}:${SLUG}`;
const at = (hhmmss, day = DAY) => new Date(`${day}T${hhmmss}+09:00`);
// hq は 21:00 の後に作り、すぐ push する。21:30 に送る
const PUSHED_AT = at("21:05:00");

function png(width = 1080, height = 1350, padding = 200) {
  const bytes = new Uint8Array(24 + padding);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  bytes[24] = padding % 251;
  return bytes;
}

/** hq の setsu_sheet.py（ed68ee4）の出力と同じ形（SK04 の試験の合成データで作った見本の束の値） */
const CAPTION =
  "【節の機力】ボートレース丸亀の優勝戦、今節いちばん足が来てるのは田中 イ A1（3号艇）\n\n3号艇 田中 イ A1は展示タイム1位 7走中4回\n1号艇 鈴木 ゥ A2は展示タイム1位 7走中3回\n\n明日の優勝戦、この並びは続く？";
const RACERS = [
  { name: "田中 イ", class: "A1" },
  { name: "佐藤 ウ", class: "B1" },
  { name: "鈴木 ゥ", class: "A2" },
  { name: "高橋 ェ", class: "A1" },
  { name: "伊藤 エ", class: "B2" },
  { name: "渡辺 ォ", class: "B1" },
];
const researchBundle = () => ({
  format: "research_image",
  date: DAY,
  slug: "not-wakunari",
  send_time: "19:00",
  x_text:
    "【数字で見たら】5レースに1つは枠なりじゃない\n\n地元の会場、体感と合ってた？",
  hashtags: ["#ボートレース"],
  images: ["not-wakunari.png"],
  source_observed_at: at("14:30:00").toISOString(),
  review: { p0_count: 0, by: "machine" },
});
const bundle = (patch = {}) => ({
  format: "setsu_kiryoku_image",
  kind: "setsu_kiryoku",
  date: DAY,
  slug: SLUG,
  meet_id: "15-2037-10-30",
  neta: "final",
  x_text: CAPTION,
  hashtags: ["#ボートレース"],
  images: [`${SLUG}.png`],
  send_time: "21:30",
  source_observed_at: `${DAY} 11R まで`,
  racers: RACERS,
  ...patch,
});

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
    CREATE TABLE races(race_id VARCHAR PRIMARY KEY, race_date DATE, start_time TIME, cancellation_status TEXT, race_grade VARCHAR, race_number SMALLINT);
    CREATE TABLE race_conditions(race_id VARCHAR PRIMARY KEY, race_stage VARCHAR);
    CREATE TABLE race_entries(race_id VARCHAR, is_absent BOOLEAN);
    CREATE TABLE exhibition_data(race_id VARCHAR, is_absent BOOLEAN);`);
  const files = [...BASE_FILES, MIGRATION];
  for (const [i, file] of files.entries()) {
    const guard = GUARDS[file];
    await db.exec(
      guard
        ? await guardedForTest(file, files.slice(0, i), guard[0], guard[1])
        : forTest(await sqlOf(file)),
    );
  }
});
beforeEach(async () => {
  await db.exec(`
    DELETE FROM sns_metric_jobs; UPDATE sns_x_send_jobs SET parent_job_id=NULL; DELETE FROM sns_youtube_quota_reads; DELETE FROM sns_youtube_quota_attempts;
    DELETE FROM sns_x_send_jobs; DELETE FROM sns_auto_send_items; DELETE FROM sns_x_kind_reserves;
    ALTER TABLE sns_drafts DISABLE TRIGGER USER; DELETE FROM sns_drafts; ALTER TABLE sns_drafts ENABLE TRIGGER USER;
    UPDATE sns_auto_send_control SET mode='auto', dry_run=false, finals_image_enabled=false, research_image_enabled=(channel='x'),
      today_thinking_enabled=false, setsu_kiryoku_short_enabled=false, setsu_kiryoku_enabled=(channel='x');
    UPDATE sns_x_send_control SET paused=false, timing_approved=true, max_source_age_seconds=14400, expiry_minutes=30, daily_limit_x=12, daily_limit_youtube=2,
      daily_external_count=0, period_start=test_now() - interval '1 day', period_end=test_now() + interval '30 days', budget_microusd=20000000,
      reserved_microusd=0, attempt_ceiling_microusd=250000, ceiling_x_url_microusd=250000, ceiling_x_plain_microusd=30000;`);
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

const saved = [];
const storeOf = makeStoreOf({ all, first, saved });
const store = storeOf("setsu_kiryoku", "setsu", "setsu_kiryoku_enabled");
const researchStore = storeOf(
  "research_image",
  "research",
  "research_image_enabled",
);

const IMAGE = png();
const filesOf = (b, image) => ({
  "/f/bundle.json": new TextEncoder().encode(JSON.stringify(b)),
  ...(image ? { [`/f/${b.images?.[0]}`]: image } : {}),
});
const readerOf = (f) => async (p) => {
  if (!f[p]) throw Object.assign(new Error("no file"), { code: "ENOENT" });
  return f[p];
};
const push = (b = bundle(), opts = {}, image = IMAGE) => {
  const notes = [];
  return pushSetsuKiryoku("/f", {
    store,
    readBytes: readerOf(filesOf(b, image)),
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
const setsuLine = (r, s = null) =>
  resultLine(r, s, { waited: Boolean(s), type: SETSU_TYPE });

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
        "SELECT id FROM sns_auto_send_items WHERE kind=$1 AND channel='x' AND race_id LIKE $2 AND state='sent'",
        [
          p.match(/kind=eq\.([a-z_]+)/)[1],
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
    if (table === "sns_auto_send_control") {
      const column = p.match(/select=([a-z_]+)/)[1];
      return all(
        `SELECT ${column} FROM sns_auto_send_control WHERE channel='x'`,
      );
    }
    return [];
  },
});

test("194 の土台と本文: 193 の本文の md5、194 の本文の md5、193 から変わるのは4か所（期限・鮮度・許可・A の予定）だけ", async () => {
  const s193 = bodyOf(
    await sqlOf("193_sns_setsu_kiryoku_short.sql"),
    "transition_sns_send_139",
  );
  const s194 = bodyOf(await sqlOf(MIGRATION), "transition_sns_send_139");
  assert.equal(md5(s193), MD5_193);
  assert.equal(md5(s194), MD5_194);
  const a = s193.split("\n");
  const b = s194.split("\n");
  const removed = a.filter((l) => !b.includes(l));
  const added = b.filter((l) => !a.includes(l));
  assert.equal(removed.length, 3, removed.join("\n"));
  assert.match(removed.join("\n"), /v_expiry_min/);
  assert.match(removed.join("\n"), /v_max_age :=/);
  assert.match(removed.join("\n"), /ai\.kind IN/);
  assert.ok(
    added.every((l) => /setsu_kiryoku|^\s*--/.test(l)),
    added.join("\n"),
  );
  assert.ok(added.some((l) => /reason:='setsu_kiryoku_disabled'/.test(l)));
  // 193 の Shorts の許可の行は残る
  assert.match(s194, /setsu_kiryoku_short_disabled/);
});

test("194: setsu_kiryoku の item は X・variant=main・race_id は setsu:{日}:{slug} だけ。1日1本。Shorts（193）の同じ日の item とは両立。許可は既定 false・x の行だけ", async () => {
  const insert = (channel, raceId, kind = "setsu_kiryoku", variant = "main") =>
    db.query(
      `WITH d AS (INSERT INTO sns_drafts(content_group_id,platform,language,status,format,title,caption_text)
         VALUES(gen_random_uuid(),$1,'ja','pending_review',$3,'t','c') RETURNING id)
       INSERT INTO sns_auto_send_items(kind,variant,draft_id,channel,race_id,deadline_at,notify_by,veto_until,state)
       SELECT $3,$4,id,$1,$2,test_now()+interval '2 hours',test_now()-interval '1 minute',test_now()+interval '1 minute','held_manual' FROM d RETURNING id`,
      [channel, raceId, kind, variant],
    );
  const live = (id) =>
    db.query("UPDATE sns_auto_send_items SET state='checking' WHERE id=$1", [
      id,
    ]);
  await assert.rejects(insert("youtube", ID), /kind_source/);
  await assert.rejects(insert("x", `setsu:${DAY}:Bad_Slug`), /setsu_x_id/);
  await assert.rejects(insert("x", "2037-11-03-15-12"), /setsu_x_id/);
  await assert.rejects(
    insert("x", ID, "setsu_kiryoku", "finals"),
    /variant|setsu_x_id/,
  );
  const one = (await insert("x", ID)).rows[0].id;
  await live(one);
  const two = (await insert("x", `setsu:${DAY}:v04-motor-gap`)).rows[0].id;
  await assert.rejects(live(two), /sns_auto_send_items_setsu_x_day/);
  // 送った（sent）後も同じ日は2本目が入らない
  await db.query(
    `UPDATE sns_auto_send_items SET state='sent', checks='{"passed":true}' WHERE id=$1`,
    [one],
  );
  await assert.rejects(live(two), /sns_auto_send_items_setsu_x_day/);
  // 次の日は入る。Shorts（youtube・setsu:{日}:{会場}）の同じ日の item とも両立する
  await live((await insert("x", `setsu:2037-11-04:${SLUG}`)).rows[0].id);
  await live(
    (await insert("youtube", `setsu:${DAY}:15`, "setsu_kiryoku_short")).rows[0]
      .id,
  );
  await db.exec(
    "UPDATE sns_auto_send_control SET setsu_kiryoku_enabled=DEFAULT",
  );
  assert.deepEqual(
    await all(
      "SELECT channel, setsu_kiryoku_enabled FROM sns_auto_send_control ORDER BY channel",
    ),
    [
      { channel: "x", setsu_kiryoku_enabled: false },
      { channel: "youtube", setsu_kiryoku_enabled: false },
    ],
  );
  await assert.rejects(
    db.exec(
      "UPDATE sns_auto_send_control SET setsu_kiryoku_enabled=true WHERE channel='youtube'",
    ),
    /setsu_kiryoku_x_only/,
  );
});

// ---- 後半の場面（verifyData/sns-setsu-kiryoku-x-scenes-1.js） ----
runSnsSetsuKiryokuXScenes1({ db, first, riskRules, DAY, SLUG, ID, at, PUSHED_AT, CAPTION, RACERS, researchBundle, bundle, setClock, store, researchStore, IMAGE, readerOf, push, transition, counts, NOTHING, setsuLine, readCurrent });

test("取り置き（v_a_pending）: 通り道 B の claim は、今日まだ送っていない setsu_kiryoku の分を先に枠から引く", async () => {
  const result = await push();
  assert.ok(result.job_id);
  const me = (
    await first("SELECT id FROM sns_approvers WHERE display_name='本人'")
  ).id;
  const queue = {
    deadline_at: at("23:00:00").toISOString(),
    expires_at: at("22:30:00").toISOString(),
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
  const job = (
    await first("SELECT approve_sns_x_send($1,$2,$3,$4) r", [
      b.id,
      me,
      snapshot,
      PUSHED_AT.toISOString(),
    ])
  ).r;
  await db.exec("UPDATE sns_x_send_control SET daily_limit_x=1");
  await assert.rejects(transition(job.id, "claim"), /日次全体上限です/);
  await db.exec("UPDATE sns_x_send_control SET daily_limit_x=2");
  assert.equal((await transition(job.id, "claim")).state, "sending");
});

// ---- 後半の場面（verifyData/sns-setsu-kiryoku-x-scenes-1.js・sns-setsu-kiryoku-x-scenes-2.js） ----
runSnsSetsuKiryokuXScenes2({ db, first, riskRules, DAY, SLUG, ID, at, PUSHED_AT, CAPTION, RACERS, researchBundle, bundle, setClock, store, researchStore, IMAGE, readerOf, push, transition, counts, NOTHING, setsuLine, readCurrent });
runSnsSetsuKiryokuXScenes3({ BASE_FILES, MIGRATION, MD5_193, sqlOf, forTest, guardedForTest, GUARDS, db, first, riskRules, DAY, at, bundle, setClock, push, transition });
