// YouTube Shorts「節の機力」（setsu_kiryoku_short、BOA-1209、マイグレーション 193、scripts/sns/push-setsu-kiryoku-short.js）の再現テスト。
// PGlite に 189 までと 193 を当て、本番と同じ承認（approve_sns_x_send、177）・claim（transition_sns_x_send → transition_sns_send_139）・
// YouTube の送信（runYoutubeQueueJob、モックの adapter）で通す。外部接続なし。YouTube へは何も送らない
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";




import { SCREEN_MARKERS } from "../lib/snsScreenMarkers.js";
import {
  saved,
  runSnsSetsuKiryokuShortScenes1,
  runSnsSetsuKiryokuShortScenes2,
  runSnsSetsuKiryokuShortScenes3,
  runSnsSetsuKiryokuShortScenes4,
} from "./verifyData/sns-setsu-kiryoku-short-scenes-1.js";
import {
  runSnsSetsuKiryokuShortScenes5,
  runSnsSetsuKiryokuShortScenes6,
} from "./verifyData/sns-setsu-kiryoku-short-scenes-2.js";
import { runSnsSetsuKiryokuShortScenes7 } from "./verifyData/sns-setsu-kiryoku-short-scenes-3.js";
import { runSnsSetsuKiryokuShortScenes8 } from "./verifyData/sns-setsu-kiryoku-short-scenes-4.js";
import {
  runSnsSetsuKiryokuShortScenes9,
  runSnsSetsuKiryokuShortScenes10,
} from "./verifyData/sns-setsu-kiryoku-short-scenes-5.js";

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

// ---- 後半の場面（verifyData/sns-setsu-kiryoku-short-scenes-1.js） ----
runSnsSetsuKiryokuShortScenes1({ BASE_FILES, MIGRATION, MIGRATION_201, MD5_182, MD5_188, MD5_189, MD5_153_X, sqlOf, md5, bodyOf, forTest, guardedForTest, db, first, all, riskRules, PUSHED_AT, VIDEO, bundle });
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

// ---- 後半の場面（verifyData/sns-setsu-kiryoku-short-scenes-1.js） ----
runSnsSetsuKiryokuShortScenes2({ BASE_FILES, MIGRATION, MIGRATION_201, MD5_182, MD5_188, MD5_189, MD5_153_X, sqlOf, md5, bodyOf, forTest, guardedForTest, db, first, all, riskRules, PUSHED_AT, VIDEO, bundle });

const setClock = async (date) => {
  await db.query("UPDATE test_clock SET value=$1", [date.toISOString()]);
  await db.exec(
    "UPDATE sns_x_send_control SET daily_baseline_date=(test_now() AT TIME ZONE 'Asia/Tokyo')::date",
  );
  await db.exec(
    "UPDATE sns_youtube_quota_control SET baseline_day=(test_now() AT TIME ZONE 'America/Los_Angeles')::date",
  );
};

// ---- 後半の場面（verifyData/sns-setsu-kiryoku-short-scenes-1.js） ----
runSnsSetsuKiryokuShortScenes3({ BASE_FILES, MIGRATION, MIGRATION_201, MD5_182, MD5_188, MD5_189, MD5_153_X, sqlOf, md5, bodyOf, forTest, guardedForTest, db, first, all, riskRules, PUSHED_AT, VIDEO, bundle });
const storeSql = {
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

// ---- 後半の場面（verifyData/sns-setsu-kiryoku-short-scenes-1.js・sns-setsu-kiryoku-short-scenes-2.js） ----
runSnsSetsuKiryokuShortScenes4({ BASE_FILES, MIGRATION, MIGRATION_201, MD5_182, MD5_188, MD5_189, MD5_153_X, sqlOf, md5, bodyOf, forTest, guardedForTest, db, first, all, riskRules, PUSHED_AT, VIDEO, bundle, storeSql });
runSnsSetsuKiryokuShortScenes5({ db, first, riskRules, SAMPLE, DAY, NEXT, at, PUSHED_AT, SETSU_ID, VIDEO, bundle, setClock });

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

// ---- 後半の場面（verifyData/sns-setsu-kiryoku-short-scenes-2.js・sns-setsu-kiryoku-short-scenes-3.js・sns-setsu-kiryoku-short-scenes-4.js・sns-setsu-kiryoku-short-scenes-5.js） ----
runSnsSetsuKiryokuShortScenes6({ db, first, riskRules, SAMPLE, DAY, NEXT, at, PUSHED_AT, SETSU_ID, VIDEO, bundle, setClock });
runSnsSetsuKiryokuShortScenes7({ db, first, all, DAY, NEXT, at, PUSHED_AT, FINAL, SETSU_ID, VIDEO, bundle, setClock, sampleOf });
runSnsSetsuKiryokuShortScenes8({ db, first, all, riskRules, SAMPLE, DAY, at, PUSHED_AT, SETSU_ID, mp4, VIDEO, bundle });
runSnsSetsuKiryokuShortScenes9({ DAY, NEXT, at, PUSHED_AT, bundle, sampleOf });

test("会場のページの印（snsScreenMarkers の venue）は画面の部品に実在する data-testid", async () => {
  // 会場のページ（src/pages/VenueRaceListPage.jsx）と同じ props で2つの部品を jsdom に描き、印の各セレクタが
  // 描いた DOM でちょうど1件に当たることを見る（BOA-1410。本文の includes から置き換え）。
  // renderJsx は module hooks と jsdom の global を process 全体に入れるので、このテストの中で初めて読み、
  // 終わったら global を元に戻す（他のテストの前提を変えない）。
  // 会場カードの「もっと詳しく」が取りに行く fetch は、この間だけ拒否する偽に替える（通信しない。取得は失敗として畳まれる）
  const DOM_GLOBALS = [
    "window",
    "document",
    "navigator",
    "HTMLElement",
    "Node",
    "Event",
    "MouseEvent",
    "getComputedStyle",
    "localStorage",
    "sessionStorage",
    "requestAnimationFrame",
    "cancelAnimationFrame",
    "IS_REACT_ACT_ENVIRONMENT",
    "fetch",
  ];
  const saved = DOM_GLOBALS.map((k) => [
    k,
    Object.getOwnPropertyDescriptor(globalThis, k),
  ]);
  const views = [];
  try {
    globalThis.fetch = async () => {
      throw new Error("verify: 通信しない");
    };
    const { renderJsx } = await import("../lib/renderJsx.js");
    const component = (p) =>
      new URL(`../../src/components/venue/${p}`, import.meta.url);
    // 本日の会場のページは要約2行を出し、会場カードは畳んで（collapsible）出す。会場コードは数（1〜24）
    views.push(
      await renderJsx(component("VenueSummaryLines.jsx"), { venueCode: 13 }),
    );
    views.push(
      await renderJsx(component("VenueCharacteristicsCard.jsx"), {
        venueCode: 13,
        collapsible: true,
      }),
    );
    await views[1].act(() => new Promise((r) => setTimeout(r, 0)));
    const [summary, card] = views.map((v) => v.container);
    for (const [selector, inside, other] of [
      [SCREEN_MARKERS.venue[0], summary, card],
      [SCREEN_MARKERS.venue[1], card, summary],
    ]) {
      assert.equal(
        inside.querySelectorAll(selector).length,
        1,
        `${selector} が部品の描画にちょうど1件ない`,
      );
      assert.equal(
        other.querySelectorAll(selector).length,
        0,
        `${selector} が別の部品にも出る`,
      );
    }
  } finally {
    try {
      for (const v of views) await v.unmount();
    } finally {
      for (const [k, d] of saved) {
        if (d) Object.defineProperty(globalThis, k, d);
        else delete globalThis[k];
      }
    }
  }
  assert.deepEqual(SCREEN_MARKERS.venue, [
    '[data-testid="venue-summary-lines"]',
    '[data-testid="venue-characteristics-teaser"]',
  ]);
});

// ---- 後半の場面（verifyData/sns-setsu-kiryoku-short-scenes-5.js） ----
runSnsSetsuKiryokuShortScenes10({ DAY, NEXT, at, PUSHED_AT, bundle, sampleOf });
