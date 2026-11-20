// X の「数字で見たら」（集計ランキングの画像1枚、format=research_image、マイグレーション 179・180、scripts/sns/push-research-image.js、hq XR01）の再現テスト。
// PGlite に 180 までのマイグレーションを当て、本番と同じ承認の関数（approve_sns_x_send、177）・送信の claim（transition_sns_x_send、
// transition_sns_send_139 は 180）で通す。外部接続なし。X へは何も送らない
import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { checkResearchBundle, pushResearchImage } from "../sns/push-research-image.js";
import {
  parseResearchId,
  researchTextReasons,
  RESEARCH_BANNED_WORDS,
} from "../../api/_lib/snsResearchImage.js";




import {
  runSnsResearchImageScenes1,
  runSnsResearchImageScenes2,
  runSnsResearchImageScenes3,
} from "./verifyData/sns-research-image-scenes-1.js";
import { runSnsResearchImageScenes4 } from "./verifyData/sns-research-image-scenes-2.js";

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

// ---- 後半の場面（verifyData/sns-research-image-scenes-1.js） ----
runSnsResearchImageScenes1({ db, first, all, DAY, ID, at, PUSHED_AT, OBSERVED, png, setClock, CAPTION, bundle, saved, store, push, transition, counts, NOTHING, theJob });

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

// ---- 後半の場面（verifyData/sns-research-image-scenes-1.js） ----
runSnsResearchImageScenes2({ db, first, all, DAY, ID, at, PUSHED_AT, OBSERVED, png, setClock, CAPTION, bundle, saved, store, push, transition, counts, NOTHING, theJob });

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

// ---- 後半の場面（verifyData/sns-research-image-scenes-1.js・sns-research-image-scenes-2.js） ----
runSnsResearchImageScenes3({ db, first, all, DAY, ID, at, PUSHED_AT, OBSERVED, png, setClock, CAPTION, bundle, saved, store, push, transition, counts, NOTHING, theJob });
runSnsResearchImageScenes4({ db, first, DAY, ID, at, PUSHED_AT, setClock, CAPTION, bundle, store, IMAGE, push, transition, counts, NOTHING, theJob });
