// X の「節の機力」（kind=setsu_kiryoku、画像1枚＋本文、毎日 21:30、BOA-1209、マイグレーション 194、scripts/sns/push-setsu-kiryoku.js）の再現テスト。
// PGlite に 189 まで・193（Shorts の節の機力）・194 を当て、本番と同じ承認（approve_sns_x_send、177）・claim（transition_sns_x_send →
// transition_sns_send_139）で通す。194 の transition が 193 から4か所だけ変わること、検査（数字で見たらと同じ＋選手の名前と級）、
// 許可（setsu_kiryoku_enabled）・期限（21:30 から60分）・1日1本、送り手の読み直しを確かめる。外部接続なし。X へは何も送らない
import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import {
  checkResearchBundle,
  dryRunClock,
  pushSetsuKiryoku,
  pushResearchImage,
  researchStatus,
  resultLine,
  SETSU_TYPE,
} from "../sns/push-research-image.js";
import { setsuRacerReasons } from "../../api/_lib/snsResearchImage.js";
import { createReadCurrent } from "../../api/_lib/snsClaimCheck.js";
import { createDeadlinePreflight } from "../../api/_lib/snsDeadlineQueue.js";
import { HQ_KIND } from "../sns/x-slots-check.js";
import { SLOT_KINDS } from "../lib/snsXSlots.js";
import { SCREEN_MARKERS } from "../lib/snsScreenMarkers.js";

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
const storeOf = (kind, prefix, column) => ({
  researchItems: (date) =>
    all(
      "SELECT id, state, draft_id, race_id, held_reason FROM sns_auto_send_items WHERE kind=$1 AND race_id LIKE $2 ORDER BY created_at DESC",
      [kind, `${prefix}:${date}:%`],
    ),
  controls: async () =>
    Object.fromEntries(
      (
        await all(
          `SELECT channel, mode, dry_run, auto_approver_id, ${column} FROM sns_auto_send_control`,
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
});
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

test("検査: hq の見本の束は通る。選手の名前と級（racers を読む。本文からは拾わない）・形・送る時刻 21:30 だけ・集計の as_of", async () => {
  assert.deepEqual(checkResearchBundle(bundle(), riskRules, SETSU_TYPE), []);
  const reasons = (patch) =>
    checkResearchBundle(bundle(patch), riskRules, SETSU_TYPE).join(" / ");
  assert.match(reasons({ racers: [] }), /racers/);
  assert.match(reasons({ racers: undefined }), /racers/);
  assert.match(
    reasons({ racers: [{ name: "田中 イ" }, ...RACERS.slice(1)] }),
    /racers\[0\]（田中 イ）の級/,
  );
  assert.match(
    reasons({ racers: [{ name: "田中 イ", class: "A3" }] }),
    /の級が A1・A2・B1・B2 でない/,
  );
  assert.match(
    reasons({ racers: [{ name: " ", class: "A1" }] }),
    /racers\[0\] に名前が無い/,
  );
  // 級が画像にだけ出て本文に出ない選手がいても通る（本文から拾わない）
  assert.deepEqual(
    setsuRacerReasons([...RACERS, { name: "本文にいない 選手", class: "B2" }]),
    [],
  );
  assert.match(
    reasons({ format: "research_image" }),
    /format が setsu_kiryoku_image/,
  );
  assert.match(reasons({ kind: "research_image" }), /kind が setsu_kiryoku/);
  assert.match(reasons({ send_time: "21:00" }), /send_time が 21:30 でない/);
  assert.match(reasons({ send_time: "19:00" }), /send_time が 21:30 でない/);
  assert.match(
    reasons({ source_observed_at: "2037-11-02 12R まで" }),
    /as_of）の日 2037-11-02 が date/,
  );
  assert.match(reasons({ source_observed_at: "21時" }), /source_observed_at/);
  assert.match(
    reasons({ source_observed_at: "2037-11-03T21:00:00" }),
    /source_observed_at/,
  );
  assert.deepEqual(
    checkResearchBundle(
      bundle({ source_observed_at: "2037-11-03T21:00:00+09:00" }),
      riskRules,
      SETSU_TYPE,
    ),
    [],
  );
  // review は有れば P0 が0件であること（hq は出さない）
  assert.match(reasons({ review: { p0_count: 1 } }), /P0/);
  assert.deepEqual(
    checkResearchBundle(
      bundle({ review: { p0_count: 0, by: "machine" } }),
      riskRules,
      SETSU_TYPE,
    ),
    [],
  );
  assert.match(reasons({ images: ["other.png"] }), /images/);
  assert.match(reasons({ slug: "V15" }), /slug/);
  // 193 の Shorts の setsu:{日}:{会場2桁} と同じ race_id にならないよう、slug は英小文字で始める
  assert.match(reasons({ slug: "15", images: ["15.png"] }), /slug/);
});

test("検査: 禁止表現（本文の「競艇」・risk-rules）・#競艇 のタグは可・本文＋改行2つ＋タグで加重280・リンクなし・本文のハッシュタグ", async () => {
  const reasons = (patch) =>
    checkResearchBundle(bundle(patch), riskRules, SETSU_TYPE).join(" / ");
  for (const word of ["必ず当たる", "稼げる", "万舟券", "儲かる"])
    assert.match(reasons({ x_text: `${CAPTION}\n${word}` }), /禁止表現/);
  assert.match(reasons({ x_text: `${CAPTION}\n競 艇` }), /禁止表現: .*競艇/);
  assert.deepEqual(
    checkResearchBundle(
      bundle({ hashtags: ["#ボートレース", "#競艇"] }),
      riskRules,
      SETSU_TYPE,
    ),
    [],
  );
  assert.match(reasons({ hashtags: ["#競艇場"] }), /禁止表現/);
  assert.match(
    reasons({ x_text: `${CAPTION}\nboatrace.example.jp` }),
    /リンク/,
  );
  assert.match(reasons({ x_text: `${CAPTION} #ボートレース` }), /ハッシュタグ/);
  // 全角は2。本文＋"\n\n"（2）＋"#ボートレース"（1＋12）＝本文の重み＋15 が280まで
  const fit = "あ".repeat((280 - 15) >> 1);
  assert.deepEqual(
    checkResearchBundle(bundle({ x_text: fit }), riskRules, SETSU_TYPE),
    [],
  );
  assert.match(reasons({ x_text: `${fit}あ` }), /加重280/);
});

test("許可が off なら検査が通っても何も書かない（disabled・exit 3）。--dry-run も書かない。今日でない束の --dry-run は送る時刻の2分前の時計で通す", async () => {
  await db.exec("UPDATE sns_auto_send_control SET setsu_kiryoku_enabled=false");
  const off = await push();
  assert.equal(off.disabled, true);
  assert.deepEqual(await counts(), NOTHING);
  assert.deepEqual(off.notes, []);
  assert.equal(setsuLine(off).code, 3);
  assert.match(
    setsuLine(off).text,
    /^SETSU_RESULT .*"setsu_id":"setsu:2037-11-03:v15-final".*"outcome":"disabled"/,
  );
  await db.exec(
    "UPDATE sns_auto_send_control SET setsu_kiryoku_enabled=(channel='x')",
  );
  const dry = await push(bundle(), { dryRun: true });
  assert.equal(dry.dryRun, true);
  assert.equal(dry.simulated_now, undefined);
  assert.deepEqual(await counts(), NOTHING);
  assert.equal(setsuLine(dry).code, 0);
  // hq の見本（前日に作った明日の束）: 今日でなくても --dry-run は 21:28 の時計で検査を通す（日の上限は見ない）
  const ahead = await push(bundle(), {
    dryRun: true,
    now: at("15:00:00", "2037-11-02"),
  });
  assert.equal(ahead.dryRun, true);
  assert.equal(ahead.simulated_now, at("21:28:00").toISOString());
  assert.equal(ahead.limit_checked, false);
  assert.deepEqual(await counts(), NOTHING);
  assert.match(
    setsuLine(ahead).text,
    /"simulated_now":"2037-11-03T12:28:00.000Z"/,
  );
  // 数字で見たら（research_image）の --dry-run は今までどおり今日の束だけ
  const researchAhead = await pushResearchImage("/r", {
    store: researchStore,
    readBytes: readerOf({
      "/r/bundle.json": new TextEncoder().encode(
        JSON.stringify(researchBundle()),
      ),
      "/r/not-wakunari.png": IMAGE,
    }),
    riskRules,
    dryRun: true,
    now: at("15:00:00", "2037-11-02"),
  });
  assert.match(researchAhead.reasons.join(), /今日/);
  // 書く道（--dry-run でない）では今日でない束を拒む
  const notToday = await push(bundle(), { now: at("15:00:00", "2037-11-02") });
  assert.match(notToday.reasons.join(), /今日/);
  assert.equal(dryRunClock(bundle(), PUSHED_AT), null);
});

test("許可が on・mode=auto: 画像1枚の job を 21:30 の予定に入れる（締切 23:30・期限 22:30）。claim は 21:30 前は不可、21:30 に送れる、22:30 で deadline_expired", async () => {
  const result = await push();
  assert.equal(result.setsu_id, ID);
  assert.ok(result.job_id, JSON.stringify(result));
  assert.equal(result.send_at, at("21:30:00").toISOString());
  assert.equal(result.when.expires_at, at("22:30:00").toISOString());
  assert.match(result.notes.at(-1), /節の機力 setsu:2037-11-03:v15-final/);
  assert.match(result.notes.at(-1), /setsu_kiryoku_enabled = false/);
  assert.equal(setsuLine(result).code, 0);
  const draft = await first("SELECT * FROM sns_drafts");
  assert.equal(draft.format, "setsu_kiryoku");
  assert.equal(
    draft.cover_image_path.startsWith(`setsu-kiryoku/${DAY}/${SLUG}/`),
    true,
  );
  assert.deepEqual(draft.source_data.setsu_kiryoku.racers, RACERS);
  assert.equal(draft.source_data.setsu_kiryoku.as_of, `${DAY} 11R まで`);
  // as_of は時刻を持たないので、その日の 00:00 JST を集計の時刻にする（受け取りの時刻にしない。作り直しで新しく見えないように）
  assert.equal(
    draft.source_data.deadline_queue.source_observed_at,
    at("00:00:00").toISOString(),
  );
  const item = await first("SELECT * FROM sns_auto_send_items");
  assert.deepEqual(
    [item.kind, item.variant, item.race_id, item.state],
    ["setsu_kiryoku", "main", ID, "notified"],
  );
  await setClock(at("21:29:00"));
  await assert.rejects(
    transition(result.job_id, "claim"),
    /claimできません|veto_window_open/,
  );
  await setClock(at("21:30:00"));
  assert.equal((await transition(result.job_id, "claim")).state, "sending");
  // 同じ日の2本目は受け取らない（exit 4）
  const again = await push(
    bundle({ slug: "v04-motor-gap", images: ["v04-motor-gap.png"] }),
    { now: at("21:10:00") },
  );
  assert.equal(again.already, true);
  assert.equal(setsuLine(again).code, 4);
});

test("期限と許可: 22:30 で deadline_expired。承認の後に off にすると claim で held（setsu_kiryoku_disabled）", async () => {
  const late = await push();
  await setClock(at("22:30:00"));
  assert.equal(
    (await transition(late.job_id, "claim")).error_code,
    "deadline_expired",
  );
  await db.exec(
    "DELETE FROM sns_x_send_jobs; DELETE FROM sns_auto_send_items;",
  );
  await db.exec(
    "ALTER TABLE sns_drafts DISABLE TRIGGER USER; DELETE FROM sns_drafts; ALTER TABLE sns_drafts ENABLE TRIGGER USER;",
  );
  await setClock(PUSHED_AT);
  const result = await push();
  await db.exec("UPDATE sns_auto_send_control SET setsu_kiryoku_enabled=false");
  await setClock(at("21:31:00"));
  const held = await transition(result.job_id, "claim");
  assert.deepEqual(
    [held.state, held.error_code],
    ["held", "setsu_kiryoku_disabled"],
  );
  const status = await researchStatus(DAY, {
    store,
    now: at("21:32:00"),
    type: SETSU_TYPE,
  });
  assert.deepEqual(
    [status.setsu_id, status.job_state, status.error_code],
    [ID, "held", "setsu_kiryoku_disabled"],
  );
});

test("鮮度は24時間（research_image と同じ）: 集計から4時間を越えても止まらない。他の kind の4時間は変わらない（数字で見たらも今までどおり）", async () => {
  const result = await push(
    bundle({ source_observed_at: at("17:00:00").toISOString() }),
  );
  await setClock(at("21:30:00"));
  assert.equal((await transition(result.job_id, "claim")).state, "sending");
  // 数字で見たら（research_image）も 194 の後に今までどおり 19:00 に送れる
  const research = await pushResearchImage("/r", {
    store: researchStore,
    readBytes: readerOf({
      "/r/bundle.json": new TextEncoder().encode(
        JSON.stringify(researchBundle()),
      ),
      "/r/not-wakunari.png": IMAGE,
    }),
    riskRules,
    now: at("15:00:00"),
  });
  assert.ok(research.job_id, JSON.stringify(research));
  await setClock(at("19:00:00"));
  assert.equal((await transition(research.job_id, "claim")).state, "sending");
});

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

test("送り手の読み直し（readCurrent）と送る直前の検査: 許可・同じ日に送った setsu_kiryoku・item の kind・本文・画像の数・選手の名前と級。public_check は none でリンクを見る", async () => {
  const result = await push();
  const current = await readCurrent(result.draft_id);
  assert.equal(current.public_check, "none");
  assert.equal(current.withdrawn, false);
  const draft = await first("SELECT * FROM sns_drafts");
  assert.equal(
    current.source_revision,
    draft.source_data.setsu_kiryoku.revision,
  );
  await db.exec("UPDATE sns_auto_send_control SET setsu_kiryoku_enabled=false");
  await assert.rejects(readCurrent(result.draft_id), /setsu_kiryoku_disabled/);
  await db.exec(
    "UPDATE sns_auto_send_control SET setsu_kiryoku_enabled=(channel='x')",
  );
  await db.query(
    "UPDATE sns_drafts SET source_data=jsonb_set(source_data,'{setsu_kiryoku,racers}','[{\"name\":\"田中 イ\"}]') WHERE id=$1",
    [result.draft_id],
  );
  await assert.rejects(readCurrent(result.draft_id), /setsu_x_racers_invalid/);
  await db.query("UPDATE sns_drafts SET source_data=$2 WHERE id=$1", [
    result.draft_id,
    draft.source_data,
  ]);
  await db.query(
    "UPDATE sns_auto_send_items SET state='sent' WHERE draft_id=$1",
    [result.draft_id],
  );
  await assert.rejects(
    readCurrent(result.draft_id),
    /setsu_x_already_sent_today/,
  );
  await db.query(
    "UPDATE sns_auto_send_items SET state='notified' WHERE draft_id=$1",
    [result.draft_id],
  );
  await db.query("UPDATE sns_drafts SET caption_text=$2 WHERE id=$1", [
    result.draft_id,
    `${CAPTION}\n万舟券`,
  ]);
  await assert.rejects(readCurrent(result.draft_id), /setsu_x_text_rejected/);
  await db.query("UPDATE sns_drafts SET caption_text=$2 WHERE id=$1", [
    result.draft_id,
    CAPTION,
  ]);
  // 送る直前の検査: リンク先の表示を開かない（headless なし）。送る文にリンクがあれば止める
  const job = await first("SELECT * FROM sns_x_send_jobs");
  const preflight = createDeadlinePreflight({
    headless: null,
    markers: SCREEN_MARKERS,
    readCurrent,
    now: () => at("21:31:00").getTime(),
  });
  await preflight(job);
  const linked = {
    ...job,
    snapshot_text: JSON.stringify({
      ...JSON.parse(job.snapshot_text),
      text: `${CAPTION} https://www.boat-ai.jp/today`,
    }),
  };
  await assert.rejects(preflight(linked), /link_not_allowed/);
});

test("本番の取り置き（2026-11-02: digest1・finals3・research1 月水金・today_thinking6、上限11）: setsu の行なしだと月水金の 21:30 は kind_slot_full。オーナーの SQL（上限12・setsu 1）の後は送れる", async () => {
  // 2037-11-04 は水曜（JST）
  const WED = "2037-11-04";
  const reserves = async (limit, withSetsu) => {
    await db.exec(`DELETE FROM sns_x_kind_reserves;
      INSERT INTO sns_x_kind_reserves(kind, daily_count, weekdays) VALUES ('digest',1,NULL),('finals_image',3,NULL),('full_picture',0,NULL),
        ('research_image',1,'{1,3,5}'),('today_thinking',6,NULL)${withSetsu ? ",('setsu_kiryoku',1,NULL)" : ""};
      UPDATE sns_x_send_control SET daily_limit_x=${limit};`);
  };
  const run = async () => {
    await db.exec(
      "DELETE FROM sns_x_send_jobs; DELETE FROM sns_auto_send_items;",
    );
    await db.exec(
      "ALTER TABLE sns_drafts DISABLE TRIGGER USER; DELETE FROM sns_drafts; ALTER TABLE sns_drafts ENABLE TRIGGER USER;",
    );
    await setClock(at("21:05:00", WED));
    const result = await push(
      bundle({ date: WED, source_observed_at: `${WED} 11R まで` }),
      {
        now: at("21:05:00", WED),
      },
    );
    assert.ok(result.job_id, JSON.stringify(result));
    await setClock(at("21:30:00", WED));
    return transition(result.job_id, "claim");
  };
  await reserves(11, false);
  const held = await run();
  assert.deepEqual([held.state, held.error_code], ["held", "kind_slot_full"]);
  await reserves(12, true);
  assert.equal((await run()).state, "sending");
  // 月水金以外（木曜）の取り置きの合計は11で、上限12に1の空きが残る
  const room = await first(
    "SELECT public.sns_x_slot_room('setsu_kiryoku', 1, true, NULL, NULL) r",
  );
  assert.equal(room.r.reserved_total, 12);
  await setClock(at("21:05:00", "2037-11-05"));
  const thu = await first(
    "SELECT public.sns_x_slot_room('setsu_kiryoku', 1, true, NULL, NULL) r",
  );
  assert.equal(thu.r.reserved_total, 11);
});

test("X の日の枠: hq の出し物の名前 setsu_kiryoku と取り込みの出し物は kind setsu_kiryoku", () => {
  assert.equal(HQ_KIND.setsu_kiryoku, "setsu_kiryoku");
  assert.equal(SLOT_KINDS.setsuKiryoku, "setsu_kiryoku");
  assert.equal(SETSU_TYPE.kind, "setsu_kiryoku");
});

test("hq 33bd771 の形: source_observed_at は時差つき ISO、as_of は別の欄。ISO の時刻で鮮度を見る（古ければ拒む）、as_of は下書きに残す", async () => {
  const b = bundle({
    source_observed_at: at("21:02:00").toISOString().replace("Z", "+00:00"),
    as_of: `${DAY} 11R まで`,
  });
  assert.deepEqual(checkResearchBundle(b, riskRules, SETSU_TYPE), []);
  const result = await push(b);
  assert.ok(result.job_id, JSON.stringify(result));
  const draft = await first("SELECT * FROM sns_drafts");
  assert.equal(draft.source_data.setsu_kiryoku.as_of, `${DAY} 11R まで`);
  assert.equal(
    Date.parse(draft.source_data.deadline_queue.source_observed_at),
    at("21:02:00").getTime(),
  );
  // 集計の時刻が送る時刻の期限（22:30）より24時間以上前なら拒む（前の日の 22:00 に作った束）
  const stale = await push(
    bundle({
      slug: "v04-motor-gap",
      images: ["v04-motor-gap.png"],
      source_observed_at: "2037-11-02T22:00:00+09:00",
      as_of: `${DAY} 11R まで`,
    }),
  );
  assert.match(stale.reasons.join(), /source_observed_at が古い/);
  // 集計の時刻が今より後なら拒む
  const future = await push(
    bundle({ source_observed_at: "2037-11-03T21:10:00+09:00" }),
  );
  assert.match(future.reasons.join(), /今より後/);
});

test("当てる順: 193 の前に 194 を当てると先頭の照合で止まり、全体が戻る（kind・列・索引は増えない）", async () => {
  const pg = new PGlite();
  try {
    await pg.exec(
      "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;",
    );
    await pg.exec(
      "CREATE TABLE test_clock(value timestamptz); INSERT INTO test_clock VALUES(NULL); CREATE FUNCTION test_now() RETURNS timestamptz LANGUAGE sql AS 'SELECT coalesce(value,now()) FROM test_clock';",
    );
    await pg.exec(
      "CREATE TABLE scrape_job_state(job TEXT PRIMARY KEY, mode TEXT NOT NULL DEFAULT 'off' CHECK (mode IN ('off','shadow','live')));",
    );
    await pg.exec(`
      CREATE TABLE races(race_id VARCHAR PRIMARY KEY, race_date DATE, start_time TIME, cancellation_status TEXT, race_grade VARCHAR, race_number SMALLINT);
      CREATE TABLE race_conditions(race_id VARCHAR PRIMARY KEY, race_stage VARCHAR);`);
    const upTo189 = BASE_FILES.slice(0, -1);
    for (const [i, file] of upTo189.entries()) {
      const guard = GUARDS[file];
      await pg.exec(
        guard
          ? await guardedForTest(file, upTo189.slice(0, i), guard[0], guard[1])
          : forTest(await sqlOf(file)),
      );
    }
    // 194 の照合は試験の 193 の本文の md5 に差し替える（本番と同じく、189 の本文では一致しない）
    await assert.rejects(
      pg.exec(
        await guardedForTest(
          MIGRATION,
          BASE_FILES,
          "transition_sns_send_139",
          MD5_193,
        ),
      ),
      /194: transition_sns_send_139 の本文が 193 でない/,
    );
    await pg.exec("ROLLBACK").catch(() => {});
    const one = async (sql) => (await pg.query(sql)).rows[0];
    assert.equal(
      (
        await one(
          "SELECT count(*)::int n FROM pg_attribute WHERE attrelid='public.sns_auto_send_control'::regclass AND attname='setsu_kiryoku_enabled' AND NOT attisdropped",
        )
      ).n,
      0,
    );
    assert.equal(
      (
        await one(
          "SELECT count(*)::int n FROM pg_indexes WHERE indexname='sns_auto_send_items_setsu_x_day'",
        )
      ).n,
      0,
    );
    assert.doesNotMatch(
      (
        await one(
          "SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conname='sns_auto_send_items_kind_check'",
        )
      ).d,
      /setsu_kiryoku/,
    );
  } finally {
    await pg.close();
  }
});
