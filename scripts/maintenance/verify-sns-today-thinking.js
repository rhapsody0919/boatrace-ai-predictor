// /today の対象レースの思考投稿（today_thinking、BOA-1169、マイグレーション 189、scripts/sns/push-finals-image.js）の再現テスト。
// PGlite に 188 までと 189 を当て、本番と同じ承認（approve_sns_x_send、177）・claim（transition_sns_x_send → transition_sns_send_139）で通す。
// 189 の transition が 188 から3か所だけ変わり、優勝戦・数字で見たら・/today の claim が 188 と同じ結果になることを、
// 188 までを当てた別の PGlite と並べて確かめる。外部接続なし。X へは何も送らない
import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import {
  checkFinalsImage,
  checkTodayThinkingImage,
  checkTodayThinkingReply,
  createRestStore,
  draftRow,
  finalsStatus,
  imageNamesOf,
  pushFinalsImage,
  resultLine,
  THINKING_URL_REASON,
  todayTargetReason,
} from "../sns/push-finals-image.js";
import { todayPicksOf } from "../sns/today-picks.js";
import { createReadCurrent } from "../../api/_lib/snsClaimCheck.js";
import { createXSnapshot } from "../../api/_lib/snsXSend.js";

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
/** PGlite の時計に合わせて now() を test_now() にする（本文の md5 も変わるので、189 の照合の値をこちらの 182 の本文の md5 にそろえる） */
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
    CREATE TABLE races(race_id VARCHAR PRIMARY KEY, race_date DATE, start_time TIME, cancellation_status TEXT);
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
let picks;
const saved = [];
const stageCalls = [];
const store = {
  race: (id) =>
    first(
      "SELECT race_id, race_date::text, start_time::text, cancellation_status FROM races WHERE race_id=$1",
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
    return picks;
  },
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
  picks = todayPicksOf(DAY, TODAY_DRAFT, [
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
const IMAGES = () =>
  Object.fromEntries(NAMES.map((name, i) => [name, png(1080, 1350, 200 + i)]));
const push = (b = bundle(), opts = {}, deps = store) => {
  const f = {
    "/f/bundle.json": new TextEncoder().encode(JSON.stringify(b)),
    ...Object.fromEntries(
      Object.entries(IMAGES()).map(([name, bytes]) => [`/f/${name}`, bytes]),
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
const readCurrent = createReadCurrent({
  db: async (p) => {
    const table = p.split("?")[0];
    readTables.push(table);
    if (table === "sns_drafts")
      return all(
        "SELECT bundle_import_id, source_data FROM sns_drafts WHERE id=$1",
        [p.match(/id=eq\.([0-9a-f-]+)/)[1]],
      );
    if (table === "races")
      return all(
        "SELECT race_date::text, start_time::text, cancellation_status FROM races WHERE race_id=$1",
        [decodeURIComponent(p.match(/race_id=eq\.([^&]+)/)[1])],
      );
    if (table === "sns_auto_send_items" && /draft_id=eq\./.test(p))
      return all("SELECT kind FROM sns_auto_send_items WHERE draft_id=$1", [
        p.match(/draft_id=eq\.([0-9a-f-]+)/)[1],
      ]);
    if (table === "sns_auto_send_items")
      return all(
        "SELECT id FROM sns_auto_send_items WHERE kind=$1 AND variant=$2 AND race_id=$3 AND state='sent'",
        [
          p.match(/kind=eq\.([a-z_]+)/)[1],
          p.match(/variant=eq\.([a-z_]+)/)[1],
          decodeURIComponent(p.match(/race_id=eq\.([^&]+)/)[1]),
        ],
      );
    if (table === "sns_auto_send_control")
      return all(
        `SELECT ${p.match(/select=([a-z_]+)/)[1]} FROM sns_auto_send_control WHERE channel='x'`,
      );
    return [];
  },
});

test("189 の土台: 188 の transition の本文の md5 が ce1cd6fa…（182 は c2b4835c…）。189 は 188 から3か所だけ変える（v_ceiling・v_rest は変えない）", async () => {
  assert.equal(
    md5(transitionBody(await sqlOf("182_sns_x_kind_reserves.sql"))),
    MD5_182,
  );
  const before = transitionBody(await sqlOf(BASE_FILES.at(-1)));
  const after = transitionBody(await sqlOf(MIGRATION));
  assert.equal(md5(before), MD5_188);
  // 行の差（最長共通部分列）。変わったまとまりが3つで、消えた行・足した行はこの3か所のものだけ
  const a = before.split("\n");
  const b = after.split("\n");
  const L = Array.from({ length: a.length + 1 }, () =>
    new Array(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      L[i][j] =
        a[i] === b[j]
          ? L[i + 1][j + 1] + 1
          : Math.max(L[i + 1][j], L[i][j + 1]);
  const removed = [];
  const added = [];
  let hunks = 0;
  let inHunk = false;
  for (let i = 0, j = 0; i < a.length || j < b.length;) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      inHunk = false;
      i++;
      j++;
      continue;
    }
    if (!inHunk) hunks++;
    inHunk = true;
    if (j < b.length && (i === a.length || L[i][j + 1] >= L[i + 1][j]))
      added.push(b[j++]);
    else removed.push(a[i++]);
  }
  assert.equal(hunks, 3, [...removed, "---", ...added].join("\n"));
  assert.equal(removed.length, 2, removed.join("\n"));
  for (const line of removed)
    assert.match(
      line,
      /v_expiry_min := CASE WHEN v_kind='finals_image' THEN 5|ai\.kind IN \('digest','finals_image','research_image'\)/,
    );
  assert.equal(added.length, 4, added.join("\n"));
  for (const line of added) assert.match(line, /today_thinking/);
  assert.ok(!added.some((line) => /v_ceiling|v_rest/.test(line)));
  // 189 の先頭は control → items の順に LOCK し、md5 で照合する（LIKE ではない）
  const text = await sqlOf(MIGRATION);
  const lockControl = text.indexOf(
    "LOCK TABLE public.sns_auto_send_control IN ACCESS EXCLUSIVE MODE;",
  );
  const lockItems = text.indexOf(
    "LOCK TABLE public.sns_auto_send_items IN ACCESS EXCLUSIVE MODE;",
  );
  assert.ok(text.indexOf("SET LOCAL lock_timeout = '10s';") < lockControl);
  assert.ok(lockControl > 0 && lockControl < lockItems);
  assert.ok(lockItems < text.indexOf("md5(prosrc) = '" + MD5_188 + "'"));
  // 取り置き・上限はマイグレーションに入れない（transition の本文の外。本文は claim で予約額を書く）
  const outside =
    text.slice(0, text.indexOf("CREATE OR REPLACE FUNCTION")) +
    text.slice(
      text.indexOf("REVOKE ALL ON FUNCTION public.transition_sns_send_139"),
    );
  assert.doesNotMatch(
    outside.replace(/--.*$/gm, ""),
    /sns_x_kind_reserves|sns_x_send_control|daily_limit_x/,
  );
});

test("189 の先頭の照合: transition の本文が 188 でなければ（189 を当てた後にもう一度当てても）全体を戻す", async () => {
  const again = await migration189ForTest();
  await assert.rejects(
    db.exec(again),
    /189: transition_sns_send_139 の本文が 188 でない/,
  );
  await db.exec("ROLLBACK");
  // 戻ったので列は1つ（2回足されていない）、CHECK も1組
  assert.equal(
    Number(
      (
        await first(
          "SELECT count(*) n FROM pg_attribute WHERE attrelid='public.sns_auto_send_control'::regclass AND attname='today_thinking_enabled' AND NOT attisdropped",
        )
      ).n,
    ),
    1,
  );
});

test("189: today_thinking の item は X・下書きにひもづく・variant は thinking 系だけ。finals と thinking は同じレースで両立。許可は既定 false・x の行だけ", async () => {
  const insert = (
    kind,
    channel,
    variant,
    { bundleImportId = null, raceId = "r189" } = {},
  ) =>
    db.query(
      `WITH draft AS (INSERT INTO sns_drafts(content_group_id,platform,language,format,caption_text)
         VALUES(gen_random_uuid(), $2, 'ja', 'today_thinking_image', '189') RETURNING id)
       INSERT INTO sns_auto_send_items(kind,variant,draft_id,channel,race_id,deadline_at,notify_by,veto_until,bundle_import_id)
       SELECT $1, $3, id, $2, $5, test_now()+interval '3h', test_now(), test_now()+interval '1h', $4 FROM draft`,
      [kind, channel, variant, bundleImportId, raceId],
    );
  await assert.rejects(
    insert("today_thinking", "youtube", "thinking"),
    /kind_source|variant_scope/,
  );
  await assert.rejects(insert("today_thinking", "x", "main"), /variant_scope/);
  await assert.rejects(
    insert("today_thinking", "x", "finals"),
    /variant_scope/,
  );
  await assert.rejects(
    insert("finals_image", "x", "thinking"),
    /variant_scope/,
  );
  await assert.rejects(insert("digest", "x", "thinking_poll"), /variant_scope/);
  await assert.rejects(
    insert("today_thinking", "x", "thinking", {
      bundleImportId: "00000000-0000-4000-8000-0000000000aa",
    }),
    /kind_source/,
  );
  for (const variant of ["thinking", "thinking_poll", "thinking_reply"])
    await insert("today_thinking", "x", variant);
  // 同じレースの優勝戦の3本・全貌（main）と両立し、種類ごとに1レース1件（一意の索引）
  for (const variant of ["finals", "finals_poll", "finals_reply"])
    await insert("finals_image", "x", variant);
  await insert("full_picture", "x", "main");
  await assert.rejects(
    insert("today_thinking", "x", "thinking"),
    /sns_auto_send_items_race_channel/,
  );
  // research_image の main も今までどおり入る
  await insert("research_image", "x", "main", {
    raceId: "research:2037-10-26:a",
  });
  const def = await first(
    "SELECT column_default d FROM information_schema.columns WHERE table_name='sns_auto_send_control' AND column_name='today_thinking_enabled'",
  );
  assert.equal(def.d, "false");
  await assert.rejects(
    db.query(
      "UPDATE sns_auto_send_control SET today_thinking_enabled=true WHERE channel='youtube'",
    ),
    /today_thinking_x_only/,
  );
});

test("push の3本: 本投稿（画像4枚）・投票のリプ・展示後のリプが下書き・item・job になる。キーは today_thinking だけ、Storage は today-thinking/", async () => {
  const main = await push();
  assert.equal(main.reasons, undefined, JSON.stringify(main));
  assert.equal(main.kind, "today_thinking");
  assert.ok(main.job_id && main.poll_job_id);
  // 段は読まない（race_conditions は一般戦のまま通る）
  assert.deepEqual(stageCalls, []);
  assert.deepEqual(slotAsked, [["today_thinking", 2]]);
  const items = await all(
    "SELECT kind, variant, state FROM sns_auto_send_items ORDER BY variant",
  );
  assert.deepEqual(
    items.map((i) => [i.kind, i.variant, i.state]),
    [
      ["today_thinking", "thinking", "notified"],
      ["today_thinking", "thinking_poll", "notified"],
    ],
  );
  const drafts = await all(
    "SELECT format, title, source_data FROM sns_drafts ORDER BY title",
  );
  for (const d of drafts) {
    assert.equal(d.format, "today_thinking_image");
    assert.deepEqual(
      Object.keys(d.source_data).filter((k) =>
        [
          "digest",
          "full_picture",
          "finals_image",
          "research_image",
          "today_thinking",
        ].includes(k),
      ),
      ["today_thinking"],
    );
    assert.equal(d.source_data.today_thinking.race_id, RACE);
    assert.equal(
      d.source_data.release_evidence.reference,
      "today_thinking_image",
    );
    assert.match(d.title, /^\/today 思考の順/);
  }
  assert.ok(saved.every(([p]) => p.startsWith(`today-thinking/${RACE}/`)));
  assert.equal(saved.length, 4);
  assert.match(main.notes[0], /\/today の思考投稿/);
  assert.match(main.notes[0], /today_thinking_enabled = false/);
  const mainJob = await first("SELECT * FROM sns_x_send_jobs WHERE id=$1", [
    main.job_id,
  ]);
  const pollJob = await first("SELECT * FROM sns_x_send_jobs WHERE id=$1", [
    main.poll_job_id,
  ]);
  assert.equal(pollJob.parent_job_id, mainJob.id);
  // 期限は締切の5分前（3本とも）
  assert.equal(mainJob.expires_at.toISOString(), "2037-10-26T07:25:00.000Z");
  assert.equal(pollJob.expires_at.toISOString(), "2037-10-26T07:25:00.000Z");
  assert.deepEqual(JSON.parse(pollJob.snapshot_text).poll, {
    options: POLL,
    closes_at: DEADLINE,
  });
  // 本投稿を送り、投票のリプを送る
  await setClock(NOW);
  await post(main.job_id, "1890000000000000021", "2037-10-26T07:15:30Z");
  await setClock(at("16:16:00"));
  const pollClaim = await claim(main.poll_job_id);
  assert.equal(pollClaim.state, "sending", JSON.stringify(pollClaim));
  await transition(main.poll_job_id, "begin_post");
  await transition(main.poll_job_id, "complete", {
    id: "1890000000000000022",
    posted_at: "2037-10-26T07:16:30Z",
  });
  // 展示後のリプ（締切の25〜13分前）
  await setClock(at("16:10:00"));
  const reply = await push(replyBundle(), { now: at("16:10:00") });
  assert.equal(reply.reasons, undefined, JSON.stringify(reply));
  assert.equal(reply.part, "reply");
  const replyJob = await first("SELECT * FROM sns_x_send_jobs WHERE id=$1", [
    reply.job_id,
  ]);
  assert.equal(replyJob.parent_job_id, main.job_id);
  assert.equal(JSON.parse(replyJob.snapshot_text).media.length, 4);
  assert.deepEqual(
    await first("SELECT kind, variant FROM sns_auto_send_items WHERE id=$1", [
      reply.item_id,
    ]),
    { kind: "today_thinking", variant: "thinking_reply" },
  );
  assert.ok(
    saved
      .slice(4)
      .every(
        ([p]) =>
          p.startsWith(`today-thinking/${RACE}/`) && p.includes("/reply-"),
      ),
  );
  const status = await finalsStatus(RACE, { store, kind: "today_thinking" });
  assert.equal(status.tweet_id, "1890000000000000021");
  assert.equal(status.poll.tweet_id, "1890000000000000022");
  assert.equal(status.reply.job_id, reply.job_id);
  // 優勝戦の記録は空のまま（種類で分かれる）
  assert.equal(await finalsStatus(RACE, { store }), null);
  // 2回目は何もしない（exit 4）、結果の行に kind
  const again = await push(replyBundle(), { now: at("16:10:00") });
  assert.equal(again.already, true);
  const line = resultLine(RACE, again);
  assert.equal(line.code, 4);
  assert.match(line.text, /^FINALS_RESULT \{.*"kind":"today_thinking"/);
});

test("/today の X 投稿の対象でないレース・その日の /today の投稿が無いときは受け取らない（何も書かない）", async () => {
  picks = todayPicksOf(DAY, {
    ...TODAY_DRAFT,
    source_data: { digest: { date: DAY, picks: [{ race_id: OTHER_RACE }] } },
  });
  const out = await push();
  assert.match(
    out.reasons.join(),
    /\/today の X 投稿の対象でない（2037-10-26-12-08）/,
  );
  assert.deepEqual(await counts(), NOTHING);
  assert.match(out.notes[0], /検査で拒否/);
  picks = todayPicksOf(DAY, null);
  assert.match(
    (await push()).reasons.join(),
    /その日の \/today の X 投稿が無い/,
  );
  assert.deepEqual(await counts(), NOTHING);
  // 純粋関数: 注目レース（featured）か一覧（list）にあれば通る
  assert.equal(
    todayTargetReason(
      { draft_id: "d", featured: { race_id: RACE }, list: [] },
      RACE,
    ),
    null,
  );
  assert.equal(
    todayTargetReason(
      { draft_id: "d", featured: null, list: [{ race_id: RACE }] },
      RACE,
    ),
    null,
  );
});

test("優勝戦の段を見ない: race_conditions が無くても・準優勝戦でも通る。優勝戦の束は今までどおり段を見る", async () => {
  await db.exec("DELETE FROM race_conditions");
  assert.ok((await push()).job_id);
  assert.deepEqual(stageCalls, []);
  await db.exec(CLEAR_SQL);
  await db.query("INSERT INTO races VALUES($1,$2,'16:30:00',NULL)", [
    RACE,
    DAY,
  ]);
  await db.query("INSERT INTO race_conditions VALUES($1,'準優勝戦')", [RACE]);
  const finals = await push(bundle({ format: "finals_image" }));
  assert.match(finals.reasons.join(), /優勝戦でない（race_stage=準優勝戦）/);
  assert.equal(finals.kind, "finals_image");
  assert.deepEqual(stageCalls, [RACE]);
});

test("本文に URL を付けない: today_thinking の3本は URL が1つでもあれば拒否。優勝戦の束はこのレースのページ1つなら今までどおり通る", async () => {
  const url = `https://www.boat-ai.jp/race/${RACE}?tab=sonar`;
  assert.deepEqual(checkTodayThinkingImage(bundle(), riskRules), []);
  assert.deepEqual(checkTodayThinkingReply(replyBundle(), riskRules), []);
  for (const b of [
    checkTodayThinkingImage(bundle({ x_text: `若松8R\n${url}` }), riskRules),
    checkTodayThinkingImage(bundle({ poll_text: `投票 ${url}` }), riskRules),
    checkTodayThinkingImage(
      bundle({ x_text: "詳しくは boat-ai.jp で" }),
      riskRules,
    ),
    checkTodayThinkingReply(
      replyBundle({ x_text: `展示後 ${url}` }),
      riskRules,
    ),
  ])
    assert.ok(
      b.some((r) => r.startsWith(THINKING_URL_REASON)),
      b.join(),
    );
  const out = await push(bundle({ x_text: `若松8R\n${url}` }));
  assert.match(out.reasons.join(), /today_thinking の本文に URL がある/);
  assert.equal(resultLine(RACE, out).code, 1);
  assert.deepEqual(await counts(), NOTHING);
  // 優勝戦: このレースのページ1つは通り、別のページ・2つは今までどおり拒否
  const finals = (patch) =>
    checkFinalsImage({ ...bundle(patch), format: "finals_image" }, riskRules);
  assert.deepEqual(finals({ x_text: `若松8R 優勝戦\n${url}` }), []);
  assert.match(
    finals({
      x_text: `若松8R\nhttps://www.boat-ai.jp/race/${OTHER_RACE}`,
    }).join(),
    /リンクがこのレースのページ1つでない/,
  );
});

test("許可が off: push は何も書かず disabled（exit 3、理由は today_thinking_enabled）。claim でも held（today_thinking_disabled）", async () => {
  await db.exec(
    "UPDATE sns_auto_send_control SET today_thinking_enabled=false",
  );
  const off = await push();
  assert.equal(off.disabled, true);
  assert.deepEqual(await counts(), NOTHING);
  assert.deepEqual(off.notes, []);
  const line = resultLine(RACE, off);
  assert.equal(line.code, 3);
  assert.match(line.text, /today_thinking_enabled/);
  assert.match(line.text, /"kind":"today_thinking"/);
  // 承認の後に off にすると claim で held
  await db.exec(
    "UPDATE sns_auto_send_control SET today_thinking_enabled=(channel='x')",
  );
  const on = await push();
  await db.exec(
    "UPDATE sns_auto_send_control SET today_thinking_enabled=false",
  );
  const r = await claim(on.job_id);
  assert.deepEqual(
    [r.state, r.error_code],
    ["held", "today_thinking_disabled"],
  );
  // 優勝戦の許可は今のまま（today_thinking の旗に引きずられない）
  assert.equal(
    (
      await first(
        "SELECT finals_image_enabled f FROM sns_auto_send_control WHERE channel='x'",
      )
    ).f,
    true,
  );
});

test("期限は締切の5分前: 過ぎたら deadline_expired。5分前でない期限は deadline_policy_changed", async () => {
  const out = await push();
  await setClock(at("16:25:00"));
  const late = await claim(out.job_id);
  assert.deepEqual([late.state, late.error_code], ["held", "deadline_expired"]);
  await db.exec(CLEAR_SQL);
  await db.query("INSERT INTO races VALUES($1,$2,'16:30:00',NULL)", [
    RACE,
    DAY,
  ]);
  await setClock(NOW);
  const again = await push();
  // 期限を締切の3分前にずらすと、today_thinking の5分と合わない
  await db.query(
    "UPDATE sns_x_send_jobs SET expires_at=expires_at + interval '2 minutes' WHERE id=$1",
    [again.job_id],
  );
  const changed = await claim(again.job_id);
  assert.equal(changed.error_code, "deadline_policy_changed");
});

test("取り置き: today_thinking の取り置きは本投稿と投票の2本で数え、入らなければ claim で held（kind_slot_full）", async () => {
  // 上限6・他の出し物の取り置き（digest 1・finals 3・research 月曜 1）＝5 なので、today_thinking は1本しか入らない
  await db.exec("UPDATE sns_x_send_control SET daily_limit_x=6");
  const room = (
    await first(
      "SELECT sns_x_slot_room('today_thinking', 2, true, NULL, NULL) r",
    )
  ).r;
  assert.deepEqual(
    [room.ok, room.reason, room.reserve],
    [false, "kind_slot_full", 6],
  );
  const out = await push();
  assert.match(
    out.reasons.join(),
    /X の日の枠に today_thinking（2本）が入らない/,
  );
  // 押し込んだ job も claim で held（作られた後に枠が埋まった場合）
  await db.exec("UPDATE sns_x_send_control SET daily_limit_x=11");
  const ok = await push();
  await db.exec("UPDATE sns_x_send_control SET daily_limit_x=6");
  const r = await claim(ok.job_id);
  assert.deepEqual([r.state, r.error_code], ["held", "kind_slot_full"]);
});

test("readCurrent の today_thinking の枝: 段を読まず、item の kind・許可・送ったかを見る。kind が食い違えば投げる", async () => {
  await push();
  const draft = await first(
    "SELECT * FROM sns_drafts WHERE source_data->'today_thinking'->>'part'='main'",
  );
  readTables.length = 0;
  assert.deepEqual(await readCurrent(draft.id), {
    withdrawn: false,
    cancelled: false,
    deadline_at: DEADLINE,
    source_revision: draft.source_data.today_thinking.revision,
  });
  assert.ok(!readTables.includes("race_conditions"));
  await db.exec(
    "UPDATE sns_auto_send_control SET today_thinking_enabled=false",
  );
  await assert.rejects(readCurrent(draft.id), /today_thinking_disabled/);
  await db.exec(
    "UPDATE sns_auto_send_control SET today_thinking_enabled=(channel='x')",
  );
  await db.exec(
    "UPDATE sns_auto_send_items SET state='sent' WHERE variant='thinking'",
  );
  await assert.rejects(readCurrent(draft.id), /thinking_already_sent/);
  // 投票のリプは自分の種類だけを見る（本投稿を送った後も止まらない）
  const pollDraft = await first(
    "SELECT * FROM sns_drafts WHERE source_data->'today_thinking'->>'part'='poll'",
  );
  assert.equal((await readCurrent(pollDraft.id)).cancelled, false);
  // 下書きは today_thinking のキーなのに item が別の kind（優勝戦）にひもづく
  await db.exec(
    "UPDATE sns_auto_send_items SET kind='finals_image', variant='finals_poll' WHERE variant='thinking_poll'",
  );
  await assert.rejects(readCurrent(pollDraft.id), /thinking_item_mismatch/);
  // 下書きに優勝戦のキーを入れない（入れると優勝戦の枝に振り分けられる）
  const row = draftRow(bundle(), {
    revision: "r",
    when: { send_at: "x", deadline_at: DEADLINE, expires_at: DEADLINE },
    observedAt: "o",
    kind: "today_thinking",
  });
  assert.equal(row.source_data.finals_image, undefined);
  assert.equal(row.source_data.digest, undefined);
});

test("マイグレーションの前（許可の列が無く PostgREST が 400）: 優勝戦は今のまま読め、思考投稿は off として扱う", async () => {
  const asked = [];
  const fetchImpl = async (url) => {
    asked.push(url);
    const select = new URL(url).searchParams.get("select") ?? "";
    if (select.includes("today_thinking_enabled"))
      return new Response('{"code":"42703"}', { status: 400 });
    const row = (channel) => ({
      channel,
      mode: "auto",
      dry_run: false,
      auto_approver_id: "a",
      ...(select.includes("finals_image_enabled")
        ? { finals_image_enabled: channel === "x" }
        : {}),
    });
    return new Response(JSON.stringify([row("x"), row("youtube")]), {
      status: 200,
    });
  };
  const rest = createRestStore({ url: "https://db.test", key: "k", fetchImpl });
  const finals = await rest.controls();
  assert.equal(finals.x.finals_image_enabled, true);
  assert.ok(!asked.some((u) => u.includes("today_thinking_enabled")));
  const thinking = await rest.controls("today_thinking_enabled");
  assert.equal(thinking.x.today_thinking_enabled, undefined);
  assert.equal(thinking.x.mode, "auto");
  await assert.rejects(
    rest.controls("x_enabled"),
    /許可の列 x_enabled を知らない/,
  );
  // 思考投稿の push は列が無いと off（何も書かない）
  const off = await push(bundle(), {}, { ...store, controls: () => thinking });
  assert.equal(off.disabled, true);
  assert.deepEqual(await counts(), NOTHING);
});

/** 188 まで・188＋189 の PGlite で同じ claim を並べる（優勝戦・数字で見たら・/today） */
async function claimScenario(pg) {
  const q = async (sql, args = []) => (await pg.query(sql, args)).rows[0];
  await pg.exec(CLEAR_SQL);
  await setClock(NOW, pg);
  await pg.exec(CONTROL_SQL);
  const approver = (
    await q(
      "SELECT auto_approver_id id FROM sns_auto_send_control WHERE channel='x'",
    )
  ).id;
  let seq = 0;
  const makeJob = async (kind, expiresBefore) => {
    seq += 1;
    const deadline = new Date(NOW.getTime() + 90 * 60000).toISOString();
    const draft = await q(
      `INSERT INTO sns_drafts(content_group_id,format,platform,language,caption_text,send_lane,publish_blocked,source_data)
       VALUES(gen_random_uuid(),$1,'x','ja',$2,'A',false,jsonb_build_object('deadline_queue',$3::jsonb)) RETURNING *`,
      [
        {
          finals_image: "finals_image",
          research_image: "research_image",
          digest: "today_digest",
        }[kind],
        `${kind} ${seq}`,
        {
          deadline_at: deadline,
          expires_at: new Date(
            Date.parse(deadline) - expiresBefore * 60000,
          ).toISOString(),
          source_revision: `r${seq}`,
          source_observed_at: NOW.toISOString(),
        },
      ],
    );
    await pg.query(
      `INSERT INTO sns_auto_send_items(kind,draft_id,channel,variant,race_id,deadline_at,notify_by,veto_until,state,checks,stop_token_hash,notified_at)
       VALUES($1,$2,'x',$3,$4,$5,$6,$7,'notified',$8,$9,$7)`,
      [
        kind,
        draft.id,
        kind === "finals_image" ? "finals" : "main",
        kind === "research_image"
          ? `research:2037-10-${10 + seq}:r${seq}`
          : `R${seq}`,
        deadline,
        new Date(NOW.getTime() - 60000).toISOString(),
        NOW.toISOString(),
        { passed: true },
        randomBytes(32).toString("hex"),
      ],
    );
    return (
      await q("SELECT approve_sns_x_send($1,$2,$3,$4) r", [
        draft.id,
        approver,
        await createXSnapshot(draft, async () => new Uint8Array([1, 2, 3])),
        NOW.toISOString(),
      ])
    ).r;
  };
  const claimOf = async (job) => {
    const r = await transition(job.id, "claim", {}, pg);
    return [r.state, r.error_code];
  };
  const out = [];
  out.push(await claimOf(await makeJob("finals_image", 5)));
  out.push(await claimOf(await makeJob("research_image", 60)));
  out.push(await claimOf(await makeJob("digest", 30)));
  // 期限の型が違う（5分の kind に30分）は deadline_policy_changed
  out.push(await claimOf(await makeJob("finals_image", 30)));
  out.push(await claimOf(await makeJob("digest", 5)));
  // 許可が off
  await pg.exec(
    "UPDATE sns_auto_send_control SET finals_image_enabled=false, research_image_enabled=false",
  );
  out.push(await claimOf(await makeJob("finals_image", 5)));
  out.push(await claimOf(await makeJob("research_image", 60)));
  await pg.exec(CONTROL_SQL);
  // 取り置き: finals の取り置き3を使い切った後の4本目は kind_slot_full
  for (let i = 0; i < 3; i++)
    out.push(await claimOf(await makeJob("finals_image", 5)));
  // 期限切れ
  const late = await makeJob("digest", 30);
  await setClock(new Date(NOW.getTime() + 61 * 60000), pg);
  await pg.exec(
    "UPDATE sns_x_send_control SET daily_baseline_date=(test_now() AT TIME ZONE 'Asia/Tokyo')::date",
  );
  out.push(await claimOf(late));
  return out;
}

test("優勝戦・数字で見たら・/today の claim は 188 と同じ結果（188 までを当てた PGlite と並べる）", async () => {
  const base = await openDb(false);
  try {
    const expected = await claimScenario(base);
    const actual = await claimScenario(db);
    assert.deepEqual(actual, expected);
    // 並べた結果が何も試していない（全部同じ状態）でないこと
    assert.deepEqual(
      [...new Set(expected.map(([s, e]) => `${s}:${e}`))].sort(),
      [
        "held:deadline_expired",
        "held:deadline_policy_changed",
        "held:finals_image_disabled",
        "held:kind_slot_full",
        "held:research_image_disabled",
        "sending:null",
      ],
    );
  } finally {
    await base.close();
  }
});
