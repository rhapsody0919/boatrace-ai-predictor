// /today の対象レースの思考投稿（today_thinking、BOA-1169、マイグレーション 189、scripts/sns/push-finals-image.js）の再現テスト。
// PGlite に 188 までと 189 を当て、本番と同じ承認（approve_sns_x_send、177）・claim（transition_sns_x_send → transition_sns_send_139）で通す。
// 189 の transition が 188 から3か所だけ変わり、優勝戦・数字で見たら・/today の claim が 188 と同じ結果になることを、
// 188 までを当てた別の PGlite と並べて確かめる。外部接続なし。X へは何も送らない
import { before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { imageNamesOf, pushFinalsImage } from "../sns/push-finals-image.js";
import { todayPicksOf } from "../sns/today-picks.js";

import { runSnsTodayThinkingScenes1 } from "./verifyData/sns-today-thinking-scenes-1.js";
import { runSnsTodayThinkingScenes2 } from "./verifyData/sns-today-thinking-scenes-2.js";
import { runSnsTodayThinkingScenes3 } from "./verifyData/sns-today-thinking-scenes-3.js";

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
  "188_sns_x_cost_by_url.sql",
];
const MIGRATION = "189_sns_today_thinking.sql";
/** 182 の transition_sns_send_139 の本文の md5（本番の md5(prosrc) と一致を確認済み、188 の先頭の照合） */
const MD5_182 = "c2b4835c416ff6e824a43fe9025c6518";
/** 188 の transition_sns_send_139 の本文の md5（189 の先頭の照合） */
const MD5_188 = "ce1cd6fa756be8887f4033ab635a706b";

const sqlOf = (file) =>
  readFile(new URL("../../docs/db-migration/" + file, import.meta.url), "utf8");
const md5 = (t) => createHash("md5").update(t).digest("hex");
/** ファイルの transition_sns_send_139 の本文（AS $$〜$$; の間。md5(prosrc) と同じ範囲） */
const transitionBody = (s) => {
  const i = s.indexOf(
    "CREATE OR REPLACE FUNCTION public.transition_sns_send_139",
  );
  const a = s.indexOf("AS $$", i) + 5;
  return s.slice(a, s.indexOf("$$;", a));
};
/** PGlite の時計に合わせて now() を test_now() にする（本文の md5 も変わるので、188・189 の照合の値をこちらの土台の本文の md5 にそろえる） */
const forTest = (s) => s.replaceAll("now()", "test_now()");
/** md5 で土台を照合するマイグレーションを、試験の土台（now() を test_now() にした本文）の md5 に差し替える */
async function guardedForTest(file, baseFile, baseMd5) {
  const base = md5(transitionBody(forTest(await sqlOf(baseFile))));
  const text = forTest(await sqlOf(file));
  const guard = `md5(prosrc) = '${baseMd5}'`;
  assert.equal(text.split(guard).length, 2, `${file} の照合の md5 は1か所`);
  return text.replace(guard, `md5(prosrc) = '${base}'`);
}
const migration189ForTest = () =>
  guardedForTest(MIGRATION, BASE_FILES.at(-1), MD5_188);

async function openDb(with189) {
  const pg = new PGlite();
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
  for (const file of BASE_FILES)
    await pg.exec(
      file === "188_sns_x_cost_by_url.sql"
        ? await guardedForTest(file, "182_sns_x_kind_reserves.sql", MD5_182)
        : forTest(await sqlOf(file)),
    );
  if (with189) await pg.exec(await migration189ForTest());
  return pg;
}

const db = await openDb(true);
const first = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const all = async (sql, args = []) => (await db.query(sql, args)).rows;
const riskRules = JSON.parse(
  await readFile(
    new URL("../../sns-video-studio/remotion/risk-rules.json", import.meta.url),
    "utf8",
  ),
).rules;
const RACE = "2037-10-26-12-08";
const OTHER_RACE = "2037-10-26-12-09";
const DAY = "2037-10-26";
// 締切 16:30 JST
const DEADLINE = "2037-10-26T07:30:00.000Z";
const NAMES = imageNamesOf(RACE);
const at = (hhmmss) => new Date(`${DAY}T${hhmmss}+09:00`);
const NOW = at("16:15:00");
const PUSHED_AT = at("16:13:00");

function png(width = 1080, height = 1350, padding = 200) {
  const bytes = new Uint8Array(24 + padding);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  bytes[24] = padding % 251;
  return bytes;
}

const setClock = (date, pg = db) =>
  pg.query("UPDATE test_clock SET value=$1", [date.toISOString()]);

const CONTROL_SQL = `
  UPDATE sns_auto_send_control SET mode='auto', dry_run=false, finals_image_enabled=(channel='x'), research_image_enabled=(channel='x');
  UPDATE sns_x_send_control SET paused=false, timing_approved=true, max_source_age_seconds=14400, expiry_minutes=30, daily_limit_x=11, daily_limit_youtube=2,
    daily_baseline_date=(test_now() AT TIME ZONE 'Asia/Tokyo')::date, daily_external_count=0, period_start=test_now() - interval '1 day',
    period_end=test_now() + interval '30 days', budget_microusd=20000000, reserved_microusd=0, attempt_ceiling_microusd=250000,
    ceiling_x_url_microusd=250000, ceiling_x_plain_microusd=30000;
  DELETE FROM sns_x_kind_reserves;
  INSERT INTO sns_x_kind_reserves(kind, daily_count) VALUES ('full_picture',0),('digest',1),('finals_image',3),('today_thinking',6);
  INSERT INTO sns_x_kind_reserves(kind, daily_count, weekdays) VALUES ('research_image',1,'{1,3,5}');`;
const CLEAR_SQL = `
  DELETE FROM sns_metric_jobs; UPDATE sns_x_send_jobs SET parent_job_id=NULL; DELETE FROM sns_youtube_quota_attempts; DELETE FROM sns_x_send_jobs; DELETE FROM sns_auto_send_items;
  ALTER TABLE sns_drafts DISABLE TRIGGER USER; DELETE FROM sns_drafts; ALTER TABLE sns_drafts ENABLE TRIGGER USER;
  DELETE FROM races; DELETE FROM race_conditions;`;

/** /today の X 投稿の下書き（today-picks.js の型 a: 注目レース＋一覧） */
const TODAY_DRAFT = {
  id: "00000000-0000-4000-8000-000000000001",
  status: "posted",
  caption_text: "注目レース：若松8R\n一覧",
  source_data: {
    digest: {
      date: DAY,
      picks: [
        { race_id: OTHER_RACE, boat_number: 1 },
        { race_id: RACE, boat_number: 3 },
      ],
    },
  },
};
const sttState = { picks: undefined };
const saved = [];
const stageCalls = [];
const store = {
  race: (id) =>
    first(
      "SELECT race_id, race_date::text, start_time::text, cancellation_status, race_grade, race_number FROM races WHERE race_id=$1",
      [id],
    ),
  stage: async (id) => {
    stageCalls.push(id);
    return (
      (
        await first("SELECT race_stage FROM race_conditions WHERE race_id=$1", [
          id,
        ])
      )?.race_stage ?? null
    );
  },
  finalsItems: (id, variant, kind = "finals_image") =>
    all(
      "SELECT id, state, draft_id FROM sns_auto_send_items WHERE kind=$3 AND variant=$2 AND race_id=$1 ORDER BY created_at DESC",
      [id, variant, kind],
    ),
  controls: async (flag = "finals_image_enabled") =>
    Object.fromEntries(
      (
        await all(
          `SELECT channel, mode, dry_run, auto_approver_id, ${flag} FROM sns_auto_send_control`,
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
  xSlotRoom: async (kind, need, draftId = null) => {
    slotAsked.push([kind, need]);
    return (
      await first("SELECT sns_x_slot_room($1,$2,true,NULL,$3) r", [
        kind,
        need,
        draftId,
      ])
    ).r;
  },
  todayPicks: async (date) => {
    assert.equal(date, DAY);
    return sttState.picks;
  },
  twelfthRaces: (date) =>
    all(
      "SELECT race_id, race_grade, start_time::text FROM races WHERE race_date=$1 AND race_number=12 ORDER BY race_id",
      [date],
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
const slotAsked = [];

before(async () => {
  await setClock(NOW);
});
beforeEach(async () => {
  await db.exec(CLEAR_SQL);
  await setClock(NOW);
  await db.exec(CONTROL_SQL);
  await db.exec(
    "UPDATE sns_auto_send_control SET today_thinking_enabled=(channel='x')",
  );
  await db.query(
    "INSERT INTO races VALUES($1,$3,'16:30:00',NULL),($2,$3,'16:58:00',NULL)",
    [RACE, OTHER_RACE, DAY],
  );
  // 段は一般戦（優勝戦でない）。思考投稿は段を見ない
  await db.query("INSERT INTO race_conditions VALUES($1,'一般')", [RACE]);
  sttState.picks = todayPicksOf(DAY, TODAY_DRAFT, [
    { race_id: RACE, race_date: DAY, start_time: "16:30:00" },
    { race_id: OTHER_RACE, race_date: DAY, start_time: "16:58:00" },
  ]);
  saved.length = 0;
  stageCalls.length = 0;
  slotAsked.length = 0;
});
after(() => db.close());

const POLL = [
  "A 1号艇 山田太郎（イン逃げ）",
  "B 2号艇 佐藤次郎（差し）",
  "C 3号艇 鈴木三郎（まくり）",
  "D 4号艇 田中四郎（まくり差し）",
];
const bundle = (patch = {}) => ({
  format: "today_thinking_image",
  race_id: RACE,
  x_text:
    "若松8R。展示を見る前の思考の順\n\nあなたの予想はA〜Dのどれ？ リプで教えて！ レース後に答え合わせします",
  deadline: "16:30",
  images: NAMES,
  review: { p0_count: 0, by: "machine" },
  poll: POLL,
  poll_text: "あなたの予想は？ 締切16:30まで投票できます\n#ボートレース",
  ...patch,
});
const replyBundle = (patch = {}) => ({
  format: "today_thinking_reply",
  race_id: RACE,
  x_text:
    "展示を見た後の4枚（16:30締切）\n進入は枠なり\n予想は変わった？ リプで教えて！\n#ボートレース",
  deadline: "16:30",
  images: NAMES,
  review: { p0_count: 0, by: "machine" },
  ...patch,
});
const IMAGES = (names = NAMES) =>
  Object.fromEntries(names.map((name, i) => [name, png(1080, 1350, 200 + i)]));
const push = (b = bundle(), opts = {}, deps = store) => {
  const f = {
    "/f/bundle.json": new TextEncoder().encode(JSON.stringify(b)),
    ...Object.fromEntries(
      Object.entries(IMAGES(b.images ?? NAMES)).map(([name, bytes]) => [
        `/f/${name}`,
        bytes,
      ]),
    ),
  };
  const notes = [];
  return pushFinalsImage("/f", {
    store: deps,
    readBytes: async (p) => {
      if (!f[p]) throw new Error("no file");
      return f[p];
    },
    notify: async (text) => notes.push(text),
    riskRules,
    now: PUSHED_AT,
    ...opts,
  }).then((r) => ({ ...r, notes }));
};
const transition = async (jobId, action, result = {}, pg = db) =>
  (
    await pg.query("SELECT public.transition_sns_x_send($1,$2,$3::jsonb) r", [
      jobId,
      action,
      JSON.stringify(result),
    ])
  ).rows[0].r;
const claim = (jobId) => transition(jobId, "claim");
async function post(jobId, tweetId, postedAt) {
  await claim(jobId);
  await transition(jobId, "begin_post");
  await transition(jobId, "complete", { id: tweetId, posted_at: postedAt });
}
const counts = async () => ({
  drafts: Number((await first("SELECT count(*) n FROM sns_drafts")).n),
  items: Number((await first("SELECT count(*) n FROM sns_auto_send_items")).n),
  jobs: Number((await first("SELECT count(*) n FROM sns_x_send_jobs")).n),
  saved: saved.length,
});
const NOTHING = { drafts: 0, items: 0, jobs: 0, saved: 0 };

/** 送り手の読み直し（readCurrent）に PGlite の行を渡す。読んだ表を残す */
const readTables = [];

// ---- 後半の場面（verifyData/sns-today-thinking-scenes-1.js・sns-today-thinking-scenes-2.js・sns-today-thinking-scenes-3.js） ----
runSnsTodayThinkingScenes1({
  BASE_FILES,
  MIGRATION,
  MD5_182,
  MD5_188,
  sqlOf,
  md5,
  transitionBody,
  migration189ForTest,
  db,
  first,
  all,
  RACE,
  DEADLINE,
  at,
  NOW,
  setClock,
  saved,
  stageCalls,
  store,
  slotAsked,
  POLL,
  replyBundle,
  push,
  transition,
  claim,
  post,
  readTables,
});
runSnsTodayThinkingScenes2({
  db,
  first,
  riskRules,
  RACE,
  OTHER_RACE,
  DAY,
  CLEAR_SQL,
  TODAY_DRAFT,
  sttState,
  stageCalls,
  bundle,
  replyBundle,
  push,
  claim,
  counts,
  NOTHING,
});
runSnsTodayThinkingScenes3({
  openDb,
  db,
  first,
  all,
  riskRules,
  RACE,
  DAY,
  DEADLINE,
  at,
  NOW,
  setClock,
  CONTROL_SQL,
  CLEAR_SQL,
  store,
  slotAsked,
  bundle,
  push,
  transition,
  claim,
  post,
  counts,
  NOTHING,
  readTables,
});
