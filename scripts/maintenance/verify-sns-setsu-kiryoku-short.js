// YouTube Shorts「節の機力」（setsu_kiryoku_short、BOA-1209、マイグレーション 193、scripts/sns/push-setsu-kiryoku-short.js）の再現テスト。
// PGlite に 189 までと 193 を当て、本番と同じ承認（approve_sns_x_send、177）・claim（transition_sns_x_send → transition_sns_send_139）・
// YouTube の送信（runYoutubeQueueJob、モックの adapter）で通す。外部接続なし。YouTube へは何も送らない
import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import {
  checkShortBundle,
  checkTiming,
  checkVideo,
  descriptionLink,
  dryRunClock,
  mp4Info,
  pushSetsuKiryokuShort,
  resultLine,
  schedule,
  setsuStatus,
  youtubeRoomReason,
} from "../sns/push-setsu-kiryoku-short.js";
import {
  parseSetsuId,
  venueCodeOf,
} from "../../api/_lib/snsSetsuKiryokuShort.js";
import { createReadCurrent } from "../../api/_lib/snsClaimCheck.js";
import {
  createDeadlinePreflight,
  createMockHeadless,
  createMockYoutubeAdapter,
  runYoutubeQueueJob,
} from "../../api/_lib/snsDeadlineQueue.js";
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
];
const MIGRATION = "193_sns_setsu_kiryoku_short.sql";
/** 1日1本を版（border・main）ごとにする（BOA-1249）。193 の後に当てる */
const MIGRATION_201 = "201_sns_setsu_border_short.sql";
/** 本文の md5（本番の md5(prosrc)）。182・188 は verify-sns-today-thinking.js と同じ値、189 は 2026-11-02 に本番を読み取りで確かめた */
const MD5_182 = "c2b4835c416ff6e824a43fe9025c6518";
const MD5_188 = "ce1cd6fa756be8887f4033ab635a706b";
const MD5_189 = "96c809c05e1675d24feee596516db777";
/** 186 は transition_sns_x_send の土台（153 の本文）の md5 を照合する */
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

const db = new PGlite();
const first = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const all = async (sql, args = []) => (await db.query(sql, args)).rows;
const riskRules = JSON.parse(
  await readFile(
    new URL("../../sns-video-studio/remotion/risk-rules.json", import.meta.url),
    "utf8",
  ),
).rules;
const SAMPLE = JSON.parse(
  await readFile(
    new URL(
      "../../sns-video-studio/remotion/src/setsuKiryoku/samples/final_gap.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const DAY = "2037-11-01";
const NEXT = "2037-11-02";
const at = (hhmmss, day = DAY) => new Date(`${day}T${hhmmss}+09:00`);
const PUSHED_AT = at("21:25:00");
const FINAL = `${DAY}-13-12`;
const SETSU_ID = `setsu:${DAY}:13`;

/** 最小の MP4（ftyp と moov の mvhd（尺）・trak の tkhd（幅・高さ）だけ。検査はこの3つだけを読む） */
function mp4({
  width = 1080,
  height = 1920,
  seconds = 17,
  pad = 64,
  rotate = false,
} = {}) {
  const box = (type, payload) => {
    const out = new Uint8Array(8 + payload.length);
    new DataView(out.buffer).setUint32(0, out.length);
    out.set(
      [...type].map((c) => c.charCodeAt(0)),
      4,
    );
    out.set(payload, 8);
    return out;
  };
  const cat = (...parts) => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) out.set(p, (o += p.length) - p.length);
    return out;
  };
  const ftyp = box("ftyp", new TextEncoder().encode("isom\0\0\0\0isom"));
  const mvhd = new Uint8Array(100);
  new DataView(mvhd.buffer).setUint32(12, 1000);
  new DataView(mvhd.buffer).setUint32(16, seconds * 1000);
  const tkhd = new Uint8Array(84);
  // 表示の行列（v0 の tkhd の40バイト目から）。a=1・b=0 は回転なし、a=0・b=1 は90度
  new DataView(tkhd.buffer).setInt32(40, rotate ? 0 : 65536);
  new DataView(tkhd.buffer).setInt32(44, rotate ? 65536 : 0);
  new DataView(tkhd.buffer).setUint32(76, width * 65536);
  new DataView(tkhd.buffer).setUint32(80, height * 65536);
  return cat(
    ftyp,
    box("moov", cat(box("mvhd", mvhd), box("trak", box("tkhd", tkhd)))),
    box("mdat", new Uint8Array(pad)),
  );
}
const VIDEO = mp4();

const bundle = (patch = {}) => ({
  ...SAMPLE,
  date: DAY,
  final_date: DAY,
  when: "today",
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
  for (const [i, file] of BASE_FILES.entries()) {
    const before = BASE_FILES.slice(0, i);
    const text =
      file === "186_sns_youtube_close_private.sql"
        ? await guardedForTest(file, before, "transition_sns_x_send", MD5_153_X)
        : file === "188_sns_x_cost_by_url.sql"
          ? await guardedForTest(
              file,
              before,
              "transition_sns_send_139",
              MD5_182,
            )
          : file === "189_sns_today_thinking.sql"
            ? await guardedForTest(
                file,
                before,
                "transition_sns_send_139",
                MD5_188,
              )
            : forTest(await sqlOf(file));
    await db.exec(text);
  }
  await db.exec(
    await guardedForTest(
      MIGRATION,
      BASE_FILES,
      "transition_sns_send_139",
      MD5_189,
    ),
  );
  await db.exec(forTest(await sqlOf(MIGRATION_201)));
});
beforeEach(async () => {
  await db.exec(`
    DELETE FROM sns_metric_jobs; UPDATE sns_x_send_jobs SET parent_job_id=NULL; DELETE FROM sns_youtube_quota_reads; DELETE FROM sns_youtube_quota_attempts;
    DELETE FROM sns_x_send_jobs; DELETE FROM sns_auto_send_items;
    ALTER TABLE sns_drafts DISABLE TRIGGER USER; DELETE FROM sns_drafts; ALTER TABLE sns_drafts ENABLE TRIGGER USER;
    DELETE FROM races; DELETE FROM race_conditions; DELETE FROM race_entries; DELETE FROM exhibition_data;
    UPDATE sns_auto_send_control SET mode='auto', dry_run=false, finals_image_enabled=false, research_image_enabled=false, today_thinking_enabled=false,
      setsu_kiryoku_short_enabled=(channel='youtube');
    UPDATE sns_x_send_control SET paused=false, timing_approved=true, max_source_age_seconds=14400, expiry_minutes=30, daily_limit_x=9, daily_limit_youtube=9,
      daily_external_count=0, period_start=test_now() - interval '1 day', period_end=test_now() + interval '30 days', budget_microusd=20000000,
      reserved_microusd=0, attempt_ceiling_microusd=250000, ceiling_x_url_microusd=250000, ceiling_x_plain_microusd=30000;
    UPDATE sns_youtube_quota_control SET verified=true, upload_limit=100, general_limit=10000, external_uploads=0, external_general=0;`);
  await db.query(
    "INSERT INTO races(race_id, race_date, start_time) VALUES($1, $2, '16:40')",
    [FINAL, DAY],
  );
  await db.query(
    "INSERT INTO race_conditions(race_id, race_stage) VALUES($1, '優勝戦')",
    [FINAL],
  );
  await setClock(PUSHED_AT);
  saved.length = 0;
});
after(() => db.close());

const setClock = async (date) => {
  await db.query("UPDATE test_clock SET value=$1", [date.toISOString()]);
  await db.exec(
    "UPDATE sns_x_send_control SET daily_baseline_date=(test_now() AT TIME ZONE 'Asia/Tokyo')::date",
  );
  await db.exec(
    "UPDATE sns_youtube_quota_control SET baseline_day=(test_now() AT TIME ZONE 'America/Los_Angeles')::date",
  );
};

const saved = [];
const store = {
  controls: async () =>
    Object.fromEntries(
      (
        await all(
          "SELECT channel, mode, dry_run, auto_approver_id, setsu_kiryoku_short_enabled FROM sns_auto_send_control",
        )
      ).map((r) => [r.channel, r]),
    ),
  sendControl: () =>
    first(
      "SELECT daily_limit, daily_limit_youtube, daily_baseline_date::text, daily_external_count, expiry_minutes, max_source_age_seconds FROM sns_x_send_control",
    ),
  setsuItems: (date) =>
    all(
      "SELECT id, state, draft_id, race_id, variant, held_reason FROM sns_auto_send_items WHERE kind='setsu_kiryoku_short' AND race_id LIKE $1 ORDER BY created_at DESC",
      [`setsu:${date}:%`],
    ),
  finalItems: (key) =>
    all(
      "SELECT i.id, i.state, i.draft_id, i.race_id FROM sns_auto_send_items i JOIN sns_drafts d ON d.id=i.draft_id WHERE d.format='setsu_kiryoku_short' AND d.source_data->'setsu_kiryoku_short'->>'final_key'=$1",
      [key],
    ),
  jobForDraft: (draftId) =>
    first(
      "SELECT id, draft_id, state, error_code, scheduled_at::text, expires_at::text, posted_at, external_post_id, external_post_url FROM sns_x_send_jobs WHERE draft_id=$1",
      [draftId],
    ),
  jobsAttemptedOn: (day) =>
    all(
      "SELECT id, state, attempt_dates::text[] attempt_dates, attempt_channels FROM sns_x_send_jobs WHERE $1::date = ANY(attempt_dates)",
      [day],
    ),
  queuedYoutubeJobs: (now) =>
    all(
      "SELECT id, draft_id, scheduled_at::text FROM sns_x_send_jobs WHERE channel='youtube' AND state='queued' AND attempts=0 AND expires_at > $1",
      [now.toISOString()],
    ),
  quotaControl: () =>
    first(
      "SELECT verified, baseline_day::text, upload_limit, general_limit, external_uploads, external_general FROM sns_youtube_quota_control",
    ),
  quotaUsed: async (day) => {
    const a = await first(
      "SELECT coalesce(sum(upload_reserved),0)::int u, coalesce(sum(general_reserved),0)::int g FROM sns_youtube_quota_attempts WHERE quota_day=$1",
      [day],
    );
    const r = await first(
      "SELECT coalesce(sum(units),0)::int n FROM sns_youtube_quota_reads WHERE quota_day=$1",
      [day],
    );
    return { uploads: a.u, general: a.g + r.n };
  },
  finalRace: async (date, venue) => {
    const final = await first(
      "SELECT race_id FROM race_conditions WHERE race_id LIKE $1 AND race_stage='優勝戦'",
      [`${date}-${venue}-%`],
    );
    if (!final) return null;
    const race = await first(
      "SELECT cancellation_status FROM races WHERE race_id=$1",
      [final.race_id],
    );
    const absent = await first(
      "SELECT (SELECT count(*) FROM race_entries WHERE race_id=$1 AND is_absent) + (SELECT count(*) FROM exhibition_data WHERE race_id=$1 AND is_absent) n",
      [final.race_id],
    );
    return race
      ? {
          race_id: final.race_id,
          cancelled: race.cancellation_status != null,
          withdrawn: Number(absent.n) > 0,
        }
      : null;
  },
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

const push = (b = bundle(), opts = {}, video = VIDEO) => {
  const f = {
    "/f/bundle.json": new TextEncoder().encode(JSON.stringify(b)),
    ...(video ? { [`/f/${b.video ?? `${b.variant}.mp4`}`]: video } : {}),
  };
  const notes = [];
  return pushSetsuKiryokuShort("/f", {
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
const likeOf = (p) =>
  decodeURIComponent(p.match(/race_id=like\.([^&]+)/)[1]).replace("*", "%");
const idOf = (p) => decodeURIComponent(p.match(/race_id=eq\.([^&]+)/)[1]);
const readCurrent = createReadCurrent({
  db: async (p) => {
    const table = p.split("?")[0];
    const draftId = p.match(/(?:^|[?&])(?:id|draft_id)=eq\.([0-9a-f-]+)/)?.[1];
    if (table === "sns_drafts")
      return all(
        "SELECT bundle_import_id, source_data FROM sns_drafts WHERE id=$1",
        [draftId],
      );
    if (table === "sns_auto_send_items" && p.includes("state=eq.sent"))
      return all(
        "SELECT id FROM sns_auto_send_items WHERE kind='setsu_kiryoku_short' AND channel='youtube' AND race_id LIKE $1 AND variant=$2 AND state='sent'",
        [likeOf(p), p.match(/variant=eq\.([a-z_]+)/)[1]],
      );
    if (table === "sns_auto_send_items")
      return all(
        "SELECT kind, race_id, variant FROM sns_auto_send_items WHERE draft_id=$1",
        [draftId],
      );
    if (table === "sns_auto_send_control")
      return all(
        "SELECT setsu_kiryoku_short_enabled FROM sns_auto_send_control WHERE channel='youtube'",
      );
    if (table === "race_conditions")
      return all(
        "SELECT race_id FROM race_conditions WHERE race_id LIKE $1 AND race_stage='優勝戦'",
        [likeOf(p)],
      );
    if (table === "races")
      return all("SELECT cancellation_status FROM races WHERE race_id=$1", [
        idOf(p),
      ]);
    if (table === "race_entries" || table === "exhibition_data")
      return all(`SELECT is_absent FROM ${table} WHERE race_id=$1`, [idOf(p)]);
    throw new Error(`読み直しの path が想定の外: ${p}`);
  },
});
const venueHeadless = () =>
  createMockHeadless({ visibleSelectors: SCREEN_MARKERS.venue });
const preflightAt = (now, headless = venueHeadless()) =>
  createDeadlinePreflight({
    headless,
    markers: SCREEN_MARKERS,
    readCurrent,
    now: () => now.getTime(),
  });

test("193 の土台: 189 の transition_sns_send_139 の本文の md5 が本番（2026-11-02 の読み取り）と一致し、193 は1つの ELSIF（と注記）だけを足す", async () => {
  const s189 = bodyOf(
    await sqlOf("189_sns_today_thinking.sql"),
    "transition_sns_send_139",
  );
  const s193 = bodyOf(await sqlOf(MIGRATION), "transition_sns_send_139");
  assert.equal(md5(s189), MD5_189);
  const a = s189.split("\n");
  const b = s193.split("\n");
  assert.deepEqual(
    a.filter((l) => !b.includes(l)),
    [],
    "189 の行は1行も消さない",
  );
  const added = b.filter((l) => !a.includes(l));
  assert.equal(added.length, 2, added.join("\n"));
  assert.match(added[0], /^\s+-- 193:/);
  assert.match(
    added[1],
    /ELSIF v_kind='setsu_kiryoku_short' AND \(SELECT setsu_kiryoku_short_enabled FROM public\.sns_auto_send_control WHERE channel='youtube'\) IS NOT TRUE THEN reason:='setsu_kiryoku_short_disabled';/,
  );
});

test("193: setsu_kiryoku_short の item は YouTube・variant=main・race_id は setsu:{日}:{会場コード} だけ。1日1本（別の会場も、送った後も入らない）。許可は既定 false・youtube の行だけ", async () => {
  const insert = (channel, raceId, variant = "main", state = "checking") =>
    db.query(
      `WITH draft AS (INSERT INTO sns_drafts(content_group_id,platform,language,format,caption_text)
         VALUES(gen_random_uuid(), $1, 'ja', 'setsu_kiryoku_short', '193') RETURNING id)
       INSERT INTO sns_auto_send_items(kind,variant,draft_id,channel,race_id,deadline_at,notify_by,veto_until,state)
       SELECT 'setsu_kiryoku_short', $3, id, $1, $2, test_now()+interval '3h', test_now(), test_now()+interval '1h', $4 FROM draft`,
      [channel, raceId, variant, state],
    );
  await assert.rejects(insert("x", SETSU_ID), /kind_source/);
  await assert.rejects(insert("youtube", `setsu:${DAY}:25`), /setsu_id/);
  await assert.rejects(
    insert("youtube", `setsu:${DAY}:13`, "shorts"),
    /variant_scope|setsu_id/,
  );
  await insert("youtube", SETSU_ID);
  await assert.rejects(insert("youtube", `setsu:${DAY}:01`), /setsu_day/);
  await db.exec(
    `UPDATE sns_auto_send_items SET state='sent', checks='{"passed":true}'`,
  );
  await assert.rejects(insert("youtube", `setsu:${DAY}:01`), /setsu_day/);
  // 止めた・個別承認に回したものは数えない。次の日は入る
  await db.exec("UPDATE sns_auto_send_items SET state='held_manual'");
  await insert("youtube", `setsu:${DAY}:01`);
  await insert("youtube", `setsu:${NEXT}:01`);
  await assert.rejects(
    db.exec(
      "UPDATE sns_auto_send_control SET setsu_kiryoku_short_enabled=true WHERE channel='x'",
    ),
    /youtube_only/,
  );
  const col = await first(
    "SELECT column_default FROM information_schema.columns WHERE table_name='sns_auto_send_control' AND column_name='setsu_kiryoku_short_enabled'",
  );
  assert.equal(col.column_default, "false");
});

test("許可が off なら、検査が通っても何も書かない（DB・Storage・Slack とも。disabled・exit 3）。--dry-run も書かない（exit 0）", async () => {
  await db.exec(
    "UPDATE sns_auto_send_control SET setsu_kiryoku_short_enabled=false",
  );
  const off = await push();
  assert.equal(off.disabled, true, JSON.stringify(off.reasons));
  assert.deepEqual(off.notes, []);
  assert.equal(resultLine(off).code, 3);
  assert.deepEqual(await counts(), NOTHING);
  await db.exec(
    "UPDATE sns_auto_send_control SET setsu_kiryoku_short_enabled=(channel='youtube')",
  );
  const dry = await push(bundle(), { dryRun: true });
  assert.equal(dry.dryRun, true);
  assert.equal(dry.disabled, false);
  assert.equal(dry.public_url, "https://www.boat-ai.jp/venue/13");
  assert.deepEqual(
    [dry.video.width, dry.video.height, dry.video.durationSec],
    [1080, 1920, 17],
  );
  assert.equal(resultLine(dry).code, 0);
  assert.deepEqual(await counts(), NOTHING);
});

test("許可が on・mode=auto: 動画1本の YouTube の job を送る時刻の予定に入れる。題・説明欄は bundle の値のまま。期限は送る時刻＋60分、締切は期限＋expiry_minutes", async () => {
  const r = await push();
  assert.equal(r.reasons, undefined, JSON.stringify(r.reasons));
  assert.equal(r.setsu_id, SETSU_ID);
  const draft = await first("SELECT * FROM sns_drafts");
  assert.equal(draft.platform, "youtube");
  assert.equal(draft.format, "setsu_kiryoku_short");
  assert.equal(draft.title, SAMPLE.youtube.title);
  assert.equal(draft.caption_text, SAMPLE.youtube.description);
  assert.deepEqual(draft.hashtags, []);
  assert.match(
    draft.video_storage_path,
    /^setsu-kiryoku-short\/2037-11-01\/13\/[0-9a-f]{32}\.mp4$/,
  );
  const job = await theJob();
  assert.equal(job.channel, "youtube");
  assert.equal(job.state, "queued");
  const snap = JSON.parse(job.snapshot_text);
  assert.equal(snap.youtube_title, SAMPLE.youtube.title);
  assert.equal(
    snap.text,
    SAMPLE.youtube.description,
    "送る文は説明欄そのもの（ハッシュタグの行を足さない）",
  );
  assert.equal(snap.media.length, 1);
  assert.equal(snap.media[0].type, "video/mp4");
  const sendAt = new Date(PUSHED_AT.getTime() + 120000);
  assert.equal(new Date(job.scheduled_at).toISOString(), sendAt.toISOString());
  assert.equal(
    snap.queue.expires_at,
    new Date(sendAt.getTime() + 60 * 60000).toISOString(),
  );
  assert.equal(
    snap.queue.deadline_at,
    new Date(sendAt.getTime() + 90 * 60000).toISOString(),
  );
  assert.equal(snap.queue.public_url, "https://www.boat-ai.jp/venue/13");
  assert.equal(snap.queue.screen_key, "venue");
  assert.equal(snap.queue.youtube_mode, "immediate");
  const item = await first("SELECT * FROM sns_auto_send_items");
  assert.deepEqual(
    [item.kind, item.variant, item.channel, item.race_id, item.state],
    ["setsu_kiryoku_short", "main", "youtube", SETSU_ID, "notified"],
  );
  assert.equal(saved.length, 1);
  assert.match(r.notes[0], /setsu_kiryoku_short_enabled = false/);
  assert.equal(resultLine(r, null, { waited: false }).code, 0);
});

test("send_time があれば、その時刻に送る（今＋2分より後なら）。送る時刻の15分前より早い・22:00 を過ぎる時刻・今日でない日・期限の10分前の後は受け取らない", async () => {
  // 15分前より早い受け取りは拒否（ちょうど15分前は通す）
  const early = await push(bundle({ send_time: "21:41" }));
  assert.ok(
    early.reasons?.some((x) => x.includes("15分前より早い")),
    JSON.stringify(early.reasons),
  );
  const r = await push(bundle({ send_time: "21:40" }));
  assert.equal(r.reasons, undefined, JSON.stringify(r.reasons));
  assert.equal(
    new Date((await theJob()).scheduled_at).toISOString(),
    at("21:40:00").toISOString(),
  );
  assert.ok(
    checkShortBundle(bundle({ send_time: "22:30" }), riskRules).some((x) =>
      x.includes("send_time"),
    ),
  );
  const late = await push(bundle(), { now: at("21:59:00") });
  assert.ok(
    late.reasons.some((x) => x.includes("22:00")),
    JSON.stringify(late.reasons),
  );
  const other = await push(bundle(), { now: at("21:00:00", NEXT) });
  assert.ok(other.reasons.some((x) => x.includes("今日")));
  const when = schedule(bundle(), PUSHED_AT, 30);
  assert.ok(
    checkTiming(bundle(), when, new Date(Date.parse(when.latest)), {
      observedAt: PUSHED_AT.toISOString(),
      maxAgeSec: 14400,
    }).some((x) => x.includes("10分前")),
  );
  // 集計の時刻: 今より後・期限までに鮮度の線（4時間）を越えるものは受け取らない
  const stale = await push(
    bundle({ source_observed_at: at("18:20:00").toISOString() }),
  );
  assert.ok(
    stale.reasons.some((x) => x.includes("古い")),
    JSON.stringify(stale.reasons),
  );
  const future = await push(
    bundle({ source_observed_at: at("21:30:00").toISOString() }),
  );
  assert.ok(future.reasons.some((x) => x.includes("今より後")));
});

test("claim: 送る時刻の前は通らない。送る時刻に sending になり、YouTube のクォータ（1 upload・104 units）を予約する。許可を off にすると held（setsu_kiryoku_short_disabled）", async () => {
  await push();
  const job = await theJob();
  // 送る時刻（veto_until と同じ）の前は通らない
  await assert.rejects(
    transition(job.id, "claim"),
    /veto_window_open|claimできません/,
  );
  await setClock(new Date(Date.parse(job.scheduled_at)));
  const claimed = await transition(job.id, "claim");
  assert.equal(claimed.state, "sending");
  const quota = await first(
    "SELECT upload_reserved, general_reserved FROM sns_youtube_quota_attempts WHERE job_id=$1",
    [job.id],
  );
  assert.deepEqual([quota.upload_reserved, quota.general_reserved], [1, 104]);
  // 許可は claim のたびに見る（承認の後に off にした）
  await db.exec(
    "DELETE FROM sns_youtube_quota_attempts; UPDATE sns_x_send_jobs SET state='queued', attempts=0, attempt_dates='{}', attempt_channels='{}', lease_until=NULL, locked_at=NULL",
  );
  await db.exec(
    "UPDATE sns_auto_send_control SET setsu_kiryoku_short_enabled=false",
  );
  const held = await transition(job.id, "claim");
  assert.deepEqual(
    [held.state, held.error_code],
    ["held", "setsu_kiryoku_short_disabled"],
  );
});

test("他の kind の claim は 189 と同じ: YouTube の全貌（full_picture）は setsu の許可が off でも止めない", async () => {
  await db.exec(
    "UPDATE sns_auto_send_control SET setsu_kiryoku_short_enabled=false",
  );
  // 同じ下書きを full_picture の item にしたものは、許可の行に当たらない
  await db.exec(
    "UPDATE sns_auto_send_control SET setsu_kiryoku_short_enabled=(channel='youtube')",
  );
  await push();
  const job = await theJob();
  await db.exec(`ALTER TABLE sns_auto_send_items DROP CONSTRAINT sns_auto_send_items_setsu_id;
    UPDATE sns_auto_send_items SET kind='full_picture', race_id='2037-11-01-13-12'`);
  await db.exec(
    "UPDATE sns_auto_send_control SET setsu_kiryoku_short_enabled=false",
  );
  await setClock(new Date(Date.parse(job.scheduled_at)));
  assert.equal((await transition(job.id, "claim")).state, "sending");
  await db.exec(`DELETE FROM sns_youtube_quota_attempts; DELETE FROM sns_x_send_jobs; DELETE FROM sns_auto_send_items;
    ALTER TABLE sns_auto_send_items ADD CONSTRAINT sns_auto_send_items_setsu_id CHECK (
      kind <> 'setsu_kiryoku_short' OR (race_id ~ '^setsu:[0-9]{4}-[0-9]{2}-[0-9]{2}:(0[1-9]|1[0-9]|2[0-4])$' AND variant IN ('main', 'border')))`);
});

test("送る: 送る時刻に動画を YouTube に上げて公開し、item が sent・状態に動画の URL が出る。同じ日の2本目（別の会場も）は作らない（exit 4）", async () => {
  await push();
  const job = await theJob();
  const sendAt = new Date(Date.parse(job.scheduled_at));
  await setClock(sendAt);
  const youtube = createMockYoutubeAdapter({
    videoId: "setsuvideo1",
    postedAt: sendAt.toISOString(),
  });
  const headless = venueHeadless();
  const done = await runYoutubeQueueJob(job.id, {
    store: { transition: (id, action, r = {}) => transition(id, action, r) },
    youtube,
    loadMedia: async () => VIDEO,
    preflight: preflightAt(sendAt, headless),
  });
  assert.equal(done.state, "posted", done.error_code);
  const upload = youtube.calls.find(
    (c) => c.method === "videos.insert",
  ).payload;
  assert.equal(
    upload.title ??
      upload.snapshot?.youtube_title ??
      JSON.parse(job.snapshot_text).youtube_title,
    SAMPLE.youtube.title,
  );
  assert.ok(
    headless.calls.length > 0 &&
      headless.calls.every((c) => c.url === "https://www.boat-ai.jp/venue/13"),
  );
  assert.equal(
    (await first("SELECT state FROM sns_auto_send_items")).state,
    "sent",
  );
  const status = await setsuStatus(DAY, { store });
  assert.deepEqual(
    [status.setsu_id, status.item_state, status.job_state, status.video_id],
    [SETSU_ID, "sent", "posted", "setsuvideo1"],
  );
  const again = await push(bundle(), { now: at("21:40:00") });
  assert.equal(again.already, true);
  assert.equal(resultLine(again).code, 4);
  // 別の会場の束も、同じ日は作らない（1日1本）
  const other = await push(
    bundle({
      venue: "住之江",
      youtube: {
        ...SAMPLE.youtube,
        description: SAMPLE.youtube.description.replace(
          "/venue/13",
          "/venue/12",
        ),
      },
    }),
    { now: at("21:40:00") },
  );
  assert.equal(other.already, true, JSON.stringify(other.reasons));
});

const sampleOf = async (name) =>
  JSON.parse(
    await readFile(
      new URL(
        `../../sns-video-studio/remotion/src/setsuKiryoku/samples/${name}.json`,
        import.meta.url,
      ),
      "utf8",
    ),
  );
const insertSetsuItem = (channel, raceId, variant = "main") =>
  db.query(
    `WITH draft AS (INSERT INTO sns_drafts(content_group_id,platform,language,format,caption_text)
       VALUES(gen_random_uuid(), $1, 'ja', 'setsu_kiryoku_short', '201') RETURNING id)
     INSERT INTO sns_auto_send_items(kind,variant,draft_id,channel,race_id,deadline_at,notify_by,veto_until,state)
     SELECT 'setsu_kiryoku_short', $3, id, $1, $2, test_now()+interval '3h', test_now(), test_now()+interval '1h', 'checking' FROM draft`,
    [channel, raceId, variant],
  );
const markSent = (where) =>
  db.exec(
    `UPDATE sns_auto_send_items SET state='sent', checks='{"passed":true}' WHERE ${where}`,
  );

test("201: 1日1本は版（border・main）ごと。同じ日・同じ会場でも border と main は両方入る。main の2本目・border の2本目は入らない。border は setsu_kiryoku_short の youtube だけ", async () => {
  await insertSetsuItem("youtube", SETSU_ID, "border");
  await insertSetsuItem("youtube", SETSU_ID, "main");
  await assert.rejects(
    insertSetsuItem("youtube", `setsu:${DAY}:01`, "main"),
    /setsu_day/,
  );
  await assert.rejects(
    insertSetsuItem("youtube", `setsu:${DAY}:01`, "border"),
    /setsu_day/,
  );
  // 送った後も数える。個別承認に回した（held_manual）版は数えない（もう一方の版は数えたまま）
  await markSent("true");
  await assert.rejects(
    insertSetsuItem("youtube", `setsu:${DAY}:01`, "border"),
    /setsu_day/,
  );
  await db.exec(
    "UPDATE sns_auto_send_items SET state='held_manual' WHERE variant='border'",
  );
  await insertSetsuItem("youtube", `setsu:${DAY}:01`, "border");
  await assert.rejects(
    insertSetsuItem("youtube", `setsu:${DAY}:01`, "main"),
    /setsu_day/,
  );
  // 次の日は両方入る
  await insertSetsuItem("youtube", `setsu:${NEXT}:01`, "border");
  await insertSetsuItem("youtube", `setsu:${NEXT}:01`, "main");
  await assert.rejects(
    insertSetsuItem("x", `setsu:${NEXT}:02`, "border"),
    /kind_source|variant_scope/,
  );
  await assert.rejects(
    insertSetsuItem("youtube", `setsu:${NEXT}:13`, "shorts"),
    /variant_scope|setsu_id/,
  );
  // border は他の kind に使えない
  await assert.rejects(
    db.query(
      `WITH draft AS (INSERT INTO sns_drafts(content_group_id,platform,language,format,caption_text)
         VALUES(gen_random_uuid(), 'youtube', 'ja', 'full_picture', '201') RETURNING id)
       INSERT INTO sns_auto_send_items(kind,variant,draft_id,channel,race_id,deadline_at,notify_by,veto_until,state)
       SELECT 'full_picture', 'border', id, 'youtube', $1, test_now()+interval '3h', test_now(), test_now()+interval '1h', 'checking' FROM draft`,
      [FINAL],
    ),
    /variant_scope/,
  );
});

test("BOA-1249: 朝 08:00 の border（準優に残れるか）と 21:30 の節の機力を同じ日に両方受けて送る。border 以外の2本目・border の2本目は作らない（exit 4）", async () => {
  const border = await sampleOf("border");
  const motor = await sampleOf("motor_gap");
  const morning = at("07:50:00");
  await setClock(morning);
  const b = await push(
    {
      ...border,
      date: DAY,
      send_time: "08:00",
      source_observed_at: `${DAY}T07:30:00+09:00`,
    },
    { now: morning },
  );
  assert.equal(b.reasons, undefined, JSON.stringify(b.reasons));
  assert.ok(b.job_id);
  const bItem = await first(
    "SELECT variant, race_id FROM sns_auto_send_items WHERE id=$1",
    [b.item_id],
  );
  assert.deepEqual([bItem.variant, bItem.race_id], ["border", SETSU_ID]);
  // border を 08:00 に送る（item が sent になる）
  const bJob = await first("SELECT * FROM sns_x_send_jobs WHERE id=$1", [
    b.job_id,
  ]);
  const bSendAt = new Date(Date.parse(bJob.scheduled_at));
  await setClock(bSendAt);
  const posted = await runYoutubeQueueJob(bJob.id, {
    store: { transition: (id, action, r = {}) => transition(id, action, r) },
    youtube: createMockYoutubeAdapter({
      videoId: "borderVid01",
      postedAt: bSendAt.toISOString(),
    }),
    loadMedia: async () => VIDEO,
    preflight: preflightAt(bSendAt),
  });
  assert.equal(posted.state, "posted", posted.error_code);
  assert.equal(
    (
      await first("SELECT state FROM sns_auto_send_items WHERE id=$1", [
        b.item_id,
      ])
    ).state,
    "sent",
  );
  // 21:25 に節の機力（final_gap、版 main）を受ける。同じ日・同じ会場でも通る
  await setClock(PUSHED_AT);
  const k = await push();
  assert.equal(k.reasons, undefined, JSON.stringify(k.reasons));
  assert.equal(k.already, undefined, k.reason);
  assert.ok(k.job_id);
  // 送る直前の読み直しも、朝に送った border を「同じ日に送った」と数えない
  assert.equal((await readCurrent(k.draft_id)).cancelled, false);
  // border 以外の2本目（別の型 motor_gap も版は main）は作らない
  const again = await push(
    { ...motor, date: DAY, source_observed_at: `${DAY}T21:00:00+09:00` },
    { now: at("21:26:00") },
  );
  assert.equal(again.already, true, JSON.stringify(again.reasons));
  assert.equal(resultLine(again).code, 4);
  // border の2本目も作らない（朝に送った border が sent）
  const borderAgain = await push(
    { ...border, date: DAY, source_observed_at: `${DAY}T21:00:00+09:00` },
    { now: at("21:26:00") },
  );
  assert.equal(borderAgain.already, true, JSON.stringify(borderAgain.reasons));
  assert.equal(resultLine(borderAgain).code, 4);
  // setsu_id は同じなので、結果の行に版を出す（どちらの動画の話か hq が分かる）
  assert.match(resultLine(borderAgain).text, /"variant":"border"/);
  assert.match(resultLine(again).text, /"variant":"main"/);
  assert.equal(borderAgain.status.video_id, "borderVid01");
  assert.equal((await counts()).jobs, 2);
  // 版ごとの状態（--status <日> border|main）
  const st = await setsuStatus(DAY, { store, variant: "border" });
  assert.deepEqual([st.item_state, st.video_id], ["sent", "borderVid01"]);
  assert.equal(
    (await setsuStatus(DAY, { store, variant: "main" })).job_id,
    k.job_id,
  );
});

test("201 の読み直し: 下書きの型と item の版が違えば setsu_item_mismatch。別の版で送った item は数えず、同じ版で送った item は setsu_already_sent_today", async () => {
  await push();
  const draft = await first("SELECT * FROM sns_drafts");
  await db.exec(
    "ALTER TABLE sns_auto_send_items DISABLE TRIGGER USER; UPDATE sns_auto_send_items SET variant='border'",
  );
  await assert.rejects(readCurrent(draft.id), /setsu_item_mismatch/);
  await db.exec(
    "UPDATE sns_auto_send_items SET variant='main'; ALTER TABLE sns_auto_send_items ENABLE TRIGGER USER",
  );
  await insertSetsuItem("youtube", `setsu:${DAY}:01`, "border");
  await markSent("variant='border'");
  await readCurrent(draft.id);
  await insertSetsuItem("youtube", `setsu:${NEXT}:01`, "main");
  await markSent(`race_id='setsu:${NEXT}:01'`);
  await readCurrent(draft.id);
  await db.exec("UPDATE sns_x_send_jobs SET state='cancelled'");
  await markSent(`race_id='${SETSU_ID}'`);
  await assert.rejects(readCurrent(draft.id), /setsu_already_sent_today/);
});

test("二重送信: 同じ束を2回入れても2本目は作らない。送らずに終わった（held）job は作り直す（前の item を stopped（superseded）にする）", async () => {
  await push();
  const second = await push(bundle(), { now: at("21:26:00") });
  assert.equal(second.already, true);
  assert.equal((await counts()).jobs, 1);
  await db.exec(
    "UPDATE sns_x_send_jobs SET state='held', error_code='deadline_expired'",
  );
  const retry = await push(bundle(), { now: at("21:27:00") });
  assert.equal(retry.reasons, undefined, JSON.stringify(retry.reasons));
  assert.ok(retry.job_id);
  const items = await all(
    "SELECT state, stopped_via FROM sns_auto_send_items ORDER BY created_at",
  );
  assert.deepEqual(
    items.map((i) => [i.state, i.stopped_via]),
    [
      ["stopped", "superseded"],
      ["notified", null],
    ],
  );
});

test("二重送信（同じ優勝戦）: 前夜（eve）に出した優勝戦は、当日（today）に同じ会場・同じ優勝戦の日で出さない", async () => {
  // 前夜: date は優勝戦の前日、final_date が優勝戦の日（出走表はまだ無いので優勝戦の照合はしない）
  const prev = "2037-10-31";
  await setClock(at("21:25:00", prev));
  const eve = await push(bundle({ date: prev, final_date: DAY, when: "eve" }), {
    now: at("21:25:00", prev),
  });
  assert.equal(eve.reasons, undefined, JSON.stringify(eve.reasons));
  await db.exec(
    `UPDATE sns_auto_send_items SET state='sent', checks='{"passed":true}'; UPDATE sns_x_send_jobs SET state='posted', external_post_id='setsuvideo2', posted_at=test_now()`,
  );
  await setClock(PUSHED_AT);
  const today = await push();
  assert.ok(
    today.reasons?.some((x) => x.includes("同じ優勝戦")),
    JSON.stringify(today),
  );
  assert.equal(resultLine(today).code, 1);
});

test("優勝戦が今日の型: その日のその会場の優勝戦が DB に無い・中止・欠場があれば受け取らない。送る直前の読み直しも中止・欠場を返す", async () => {
  await push();
  const draft = await first("SELECT * FROM sns_drafts");
  const current = await readCurrent(draft.id);
  assert.deepEqual(current, {
    withdrawn: false,
    cancelled: false,
    deadline_at: draft.source_data.deadline_queue.deadline_at,
    source_revision: draft.source_data.setsu_kiryoku_short.revision,
  });
  await db.query(
    "UPDATE races SET cancellation_status='confirmed' WHERE race_id=$1",
    [FINAL],
  );
  assert.equal((await readCurrent(draft.id)).cancelled, true);
  const job = await theJob();
  await assert.rejects(
    preflightAt(new Date(Date.parse(job.scheduled_at)))(job),
    /race_unconfirmed_or_withdrawn/,
  );
  await db.exec("DELETE FROM sns_x_send_jobs; DELETE FROM sns_auto_send_items");
  const cancelled = await push();
  assert.ok(cancelled.reasons.includes("優勝戦が中止"));
  await db.query("UPDATE races SET cancellation_status=NULL WHERE race_id=$1", [
    FINAL,
  ]);
  await db.query("INSERT INTO race_entries VALUES($1, true)", [FINAL]);
  assert.ok((await push()).reasons.includes("優勝戦に欠場がある"));
  await db.exec("DELETE FROM race_conditions");
  assert.ok(
    (await push()).reasons.some((x) => x.includes("優勝戦が DB に無い")),
  );
});

test("送り手の読み直し（readCurrent）: 許可・同じ日に送った setsu_kiryoku_short・item の kind と日と会場を DB から見る。リンク先は会場のページの印で確かめる", async () => {
  await push();
  const draft = await first("SELECT * FROM sns_drafts");
  await db.exec(
    "UPDATE sns_auto_send_control SET setsu_kiryoku_short_enabled=false",
  );
  await assert.rejects(readCurrent(draft.id), /setsu_kiryoku_short_disabled/);
  await db.exec(
    "UPDATE sns_auto_send_control SET setsu_kiryoku_short_enabled=(channel='youtube')",
  );
  await db.exec("UPDATE sns_auto_send_items SET state='sent'");
  await assert.rejects(readCurrent(draft.id), /setsu_already_sent_today/);
  await db.exec("UPDATE sns_auto_send_items SET state='notified'");
  await db.exec(
    `ALTER TABLE sns_auto_send_items DISABLE TRIGGER USER; UPDATE sns_auto_send_items SET race_id='setsu:${DAY}:12'`,
  );
  await assert.rejects(readCurrent(draft.id), /setsu_item_mismatch/);
  await db.exec(
    `UPDATE sns_auto_send_items SET race_id='${SETSU_ID}'; ALTER TABLE sns_auto_send_items ENABLE TRIGGER USER`,
  );
  // 会場のページの印が片方でも見えなければ送らない
  const job = await theJob();
  const sendAt = new Date(Date.parse(job.scheduled_at));
  await preflightAt(sendAt)(job);
  await assert.rejects(
    preflightAt(
      sendAt,
      createMockHeadless({ visibleSelectors: [SCREEN_MARKERS.venue[0]] }),
    )(job),
    /public_component_missing/,
  );
});

test("検査: 型の検査（checkBundle）をもう一度通す（禁止語・言い切り・数の照合・級・date と final_date）。題・説明欄・リンク・会場の形", async () => {
  assert.deepEqual(checkShortBundle(bundle(), riskRules), []);
  const reasonsOf = (patch) => checkShortBundle(bundle(patch), riskRules);
  const yt = (p) => ({ youtube: { ...SAMPLE.youtube, ...p } });
  // 型の検査
  assert.ok(
    reasonsOf(yt({ title: "必ず当たるモーター #Shorts" })).some((x) =>
      x.includes("禁止表現"),
    ),
  );
  assert.ok(
    reasonsOf(yt({ title: "足が良いモーター #Shorts" })).some((x) =>
      x.includes("言い切り"),
    ),
  );
  assert.ok(
    reasonsOf({ hero: { ...SAMPLE.hero, class: undefined } }).some((x) =>
      x.includes("級"),
    ),
  );
  assert.ok(
    reasonsOf({ final_date: "2037-11-02" }).some((x) =>
      x.includes("final_date"),
    ),
  );
  assert.ok(
    reasonsOf({
      hero: {
        ...SAMPLE.hero,
        motor_2rate: { ...SAMPLE.hero.motor_2rate, rank_from_bottom: 3 },
      },
    }).some((x) => x.includes("rank_from_bottom")),
  );
  // この口の検査
  assert.ok(reasonsOf({ venue: "尼ケ崎" }).some((x) => x.includes("24場")));
  assert.ok(
    reasonsOf(yt({ title: "2連率\nの話 #Shorts" })).some((x) =>
      x.includes("改行"),
    ),
  );
  assert.ok(
    reasonsOf(yt({ title: "あ".repeat(101) })).some((x) => x.includes("100字")),
  );
  assert.ok(
    reasonsOf(
      yt({
        description: `${SAMPLE.youtube.description}\n${"あ".repeat(1700)}`,
      }),
    ).some((x) => x.includes("5000バイト")),
  );
  assert.ok(
    reasonsOf(yt({ description: `${SAMPLE.youtube.description} <b>` })).some(
      (x) => x.includes("< >"),
    ),
  );
  assert.ok(
    reasonsOf(
      yt({
        description: SAMPLE.youtube.description.replace(
          "/venue/13",
          "/venue/12",
        ),
      }),
    ).some((x) => x.includes("この会場のページ")),
  );
  assert.ok(
    reasonsOf(
      yt({
        description: `${SAMPLE.youtube.description}\nhttps://www.boat-ai.jp/today`,
      }),
    ).some((x) => x.includes("ちょうど1つ")),
  );
  assert.ok(
    reasonsOf(
      yt({
        description: SAMPLE.youtube.description.replace(
          "utm_source=youtube",
          "ref=x",
        ),
      }),
    ).some((x) => x.includes("utm_")),
  );
  assert.ok(reasonsOf({ video: "../x.mp4" }).some((x) => x.includes("video")));
  assert.ok(
    reasonsOf({ source_observed_at: "2037-11-01 21:00" }).some((x) =>
      x.includes("ISO"),
    ),
  );
  assert.deepEqual(
    descriptionLink("https://www.boat-ai.jp/venue/1?utm_source=youtube", "01"),
    { url: "https://www.boat-ai.jp/venue/1", reasons: [] },
  );
  assert.equal(venueCodeOf("尼崎"), "13");
  assert.equal(venueCodeOf("桐生"), "01");
  assert.deepEqual(parseSetsuId(SETSU_ID), { date: DAY, venue: "13" });
  assert.equal(parseSetsuId(`setsu:${DAY}:00`), null);
  // 検査に落ちたら Slack に知らせて何も書かない
  const rejected = await push(bundle(yt({ title: "必ず当たる #Shorts" })));
  assert.ok(rejected.reasons.length);
  assert.equal(rejected.notes.length, 1);
  assert.deepEqual(await counts(), NOTHING);
});

test("動画の検査: MP4・縦・60秒まで・32 MiB まで。無い・横・長い・MP4 でないものは受け取らない", async () => {
  assert.deepEqual(mp4Info(VIDEO), {
    ftyp: true,
    width: 1080,
    height: 1920,
    durationSec: 17,
  });
  assert.deepEqual(checkVideo("v.mp4", VIDEO), []);
  assert.ok(
    checkVideo("v.mp4", mp4({ width: 1920, height: 1080 }))[0].includes("縦"),
  );
  // 表示の行列で90度回すものは、見える縦横で判定する
  assert.deepEqual(
    checkVideo("v.mp4", mp4({ width: 1920, height: 1080, rotate: true })),
    [],
  );
  assert.ok(checkVideo("v.mp4", mp4({ rotate: true }))[0].includes("縦"));
  assert.ok(checkVideo("v.mp4", mp4({ seconds: 61 }))[0].includes("60"));
  assert.deepEqual(
    checkVideo("v.mp4", mp4({ seconds: 60 })),
    [],
    "60秒ちょうどは通す",
  );
  assert.ok(checkVideo("v.mp4", new Uint8Array(64))[0].includes("MP4 でない"));
  assert.ok(
    checkVideo("v.mp4", new Uint8Array(32 * 1024 * 1024 + 1))[0].includes(
      "大きさ",
    ),
  );
  assert.ok(checkVideo("v.mp4", null)[0].includes("無い"));
  const none = await push(bundle(), {}, null);
  assert.ok(none.reasons.some((x) => x.includes("final_gap.mp4 が無い")));
  // video の欄で名前を変えられる
  const named = await push(bundle({ video: "short.mp4" }));
  assert.equal(named.reasons, undefined, JSON.stringify(named.reasons));
});

test("YouTube の日の上限とクォータ: ちょうど入る数は通し、1本多ければ受け取らない。まだ claim していない予定も数える", async () => {
  const now = PUSHED_AT;
  const today = "2037-11-01";
  const base = {
    sendControl: {
      daily_limit_youtube: 3,
      daily_baseline_date: today,
      daily_external_count: 0,
    },
    jobs: [
      { attempt_dates: [today, today], attempt_channels: ["youtube", "x"] },
    ],
    queued: [{ scheduled_at: now.toISOString() }],
    quota: {
      verified: true,
      baseline_day: "2037-11-01",
      upload_limit: 100,
      general_limit: 10000,
      external_uploads: 0,
      external_general: 0,
    },
    quotaUsed: { uploads: 0, general: 0 },
    now,
    sendAt: now.toISOString(),
  };
  assert.equal(youtubeRoomReason(base), null, "試行1＋予定1＋この1本＝3");
  assert.match(
    youtubeRoomReason({
      ...base,
      sendControl: { ...base.sendControl, daily_external_count: 1 },
    }),
    /日の上限 3/,
  );
  assert.match(
    youtubeRoomReason({
      ...base,
      sendControl: { ...base.sendControl, daily_baseline_date: "2037-10-31" },
    }),
    /確かめられていない/,
  );
  // クォータ（PT の日。PUSHED_AT は PT の 11/1 05:25）: 予約＋予定の分＋この1本の分
  const q = (general) =>
    youtubeRoomReason({ ...base, quotaUsed: { uploads: 0, general } });
  assert.equal(q(10000 - 104 * 2), null);
  assert.match(q(10000 - 104 * 2 + 1), /クォータ/);
  assert.match(
    youtubeRoomReason({ ...base, quota: { ...base.quota, verified: false } }),
    /確かめられていない/,
  );
  assert.equal(
    youtubeRoomReason({
      ...base,
      quota: { ...base.quota, baseline_day: "2037-10-31" },
      quotaUsed: { uploads: 999, general: 99999 },
    }),
    null,
    "クォータの日の前は数えない（claim が数える）",
  );
  // push の中でも同じ（DB の数）。今日の YouTube の試行で上限が埋まっていれば受け取らない
  await db.exec("UPDATE sns_x_send_control SET daily_limit_youtube=1");
  await db.exec(`WITH d AS (INSERT INTO sns_drafts(content_group_id,platform,language,format,caption_text) VALUES(gen_random_uuid(),'youtube','ja','full_picture','x') RETURNING id)
    INSERT INTO sns_x_send_jobs(draft_id,state,snapshot,snapshot_text,approved_hash,approver_id,approved_at,scheduled_at,channel,attempt_dates,attempt_channels,attempts)
    SELECT d.id,'posted','{}'::jsonb,'{}','h',c.auto_approver_id,test_now(),test_now(),'youtube',ARRAY['${today}'::date],ARRAY['youtube'],1
      FROM d, sns_auto_send_control c WHERE c.channel='youtube'`);
  const full = await push();
  assert.ok(
    full.reasons.some((x) => x.includes("YouTube の日の上限 1")),
    JSON.stringify(full.reasons),
  );
});

test("自動モードでなければ何も書かない（何度入れても下書きを積まない、exit 5）。自動の承認に失敗したら item を held_manual・下書きを公開保留にする。item が入らなければ下書きを公開保留にして投げる", async () => {
  await db.exec("UPDATE sns_auto_send_control SET mode='manual'");
  const manual = await push();
  await push(bundle(), { now: at("21:26:00") });
  assert.equal(manual.manual, true);
  assert.deepEqual(await counts(), NOTHING);
  assert.equal(resultLine(manual, null, { waited: false }).code, 5);
  assert.match(resultLine(manual).text, /mode が auto でない/);
  await db.exec("UPDATE sns_auto_send_control SET mode='auto'");
  // 試運転（dry_run=true）は結果に trial を立てる（CLI は待たない）
  await db.exec("UPDATE sns_auto_send_control SET dry_run=true");
  const trial = await push();
  assert.equal(trial.trial, true);
  await db.exec(
    "DELETE FROM sns_x_send_jobs; DELETE FROM sns_auto_send_items; UPDATE sns_auto_send_control SET dry_run=false",
  );
  await db.exec(
    "ALTER TABLE sns_drafts DISABLE TRIGGER USER; DELETE FROM sns_drafts; ALTER TABLE sns_drafts ENABLE TRIGGER USER",
  );
  // item が入らない（並行して入れた束が先に1日1本の索引に入った等）: 下書きを公開保留にして投げる
  const noItem = {
    ...store,
    insertItem: async () => {
      throw new Error("duplicate key value violates unique constraint");
    },
  };
  const g = {
    "/f/bundle.json": new TextEncoder().encode(JSON.stringify(bundle())),
    "/f/final_gap.mp4": VIDEO,
  };
  await assert.rejects(
    pushSetsuKiryokuShort("/f", {
      store: noItem,
      readBytes: async (p) => g[p],
      riskRules,
      now: PUSHED_AT,
    }),
    /duplicate key/,
  );
  assert.equal(
    (await first("SELECT publish_blocked FROM sns_drafts")).publish_blocked,
    true,
  );
  await db.exec(
    "ALTER TABLE sns_drafts DISABLE TRIGGER USER; DELETE FROM sns_drafts; ALTER TABLE sns_drafts ENABLE TRIGGER USER",
  );
  // 動画の読み取りの失敗は「無い」と書かず、原因を残す
  const unreadable = await pushSetsuKiryokuShort("/f", {
    store,
    readBytes: async (p) => {
      if (p.endsWith(".mp4")) throw new RangeError("too big");
      return g[p];
    },
    riskRules,
    now: PUSHED_AT,
  });
  assert.ok(unreadable.reasons[0].includes("読めない"), unreadable.reasons[0]);
  const failing = {
    ...store,
    approve: async () => {
      throw new Error("承認できない");
    },
  };
  const f = {
    "/f/bundle.json": new TextEncoder().encode(JSON.stringify(bundle())),
    "/f/final_gap.mp4": VIDEO,
  };
  const r = await pushSetsuKiryokuShort("/f", {
    store: failing,
    readBytes: async (p) => f[p],
    riskRules,
    now: at("21:26:00"),
  });
  assert.match(r.error, /承認できない/);
  const states = (
    await all("SELECT state FROM sns_auto_send_items ORDER BY created_at")
  ).map((i) => i.state);
  assert.deepEqual(states, ["held_manual"]);
  assert.equal(
    (await first("SELECT publish_blocked FROM sns_drafts")).publish_blocked,
    true,
    "承認に落ちた下書きは個別承認でも送れない形にする",
  );
  assert.equal(resultLine(r, null, { waited: false }).code, 5);
});

test("dry-run の時計: date が今日なら今、見本の束（今日でない）はその日の送る時刻（send_time、無ければ 21:30）の2分前", () => {
  assert.equal(dryRunClock(bundle(), PUSHED_AT), null);
  assert.equal(
    dryRunClock(bundle(), at("12:00:00", NEXT)).toISOString(),
    at("21:28:00").toISOString(),
  );
  assert.equal(
    dryRunClock(
      bundle({ send_time: "20:00" }),
      at("12:00:00", NEXT),
    ).toISOString(),
    at("19:58:00").toISOString(),
  );
});

test("会場のページの印（snsScreenMarkers の venue）は画面の部品に実在する data-testid", async () => {
  const src = async (p) =>
    readFile(
      new URL(`../../src/components/venue/${p}`, import.meta.url),
      "utf8",
    );
  assert.ok(
    (await src("VenueSummaryLines.jsx")).includes(
      'data-testid="venue-summary-lines"',
    ),
  );
  assert.ok(
    (await src("VenueCharacteristicsCard.jsx")).includes(
      'data-testid="venue-characteristics-teaser"',
    ),
  );
  assert.deepEqual(SCREEN_MARKERS.venue, [
    '[data-testid="venue-summary-lines"]',
    '[data-testid="venue-characteristics-teaser"]',
  ]);
});
