// /today の画像つき X 投稿の計画（sns-pdca-loop tasks 19b、cron sns_auto_plan）の再現テスト。
// SQL158 までを PGlite に入れ（本番と同じ）、下書き・item の作成 → 本人の個別承認 → 送る直前の検査（一覧の版）までを通す。
// 一覧（morning_digest_*）・撮影・Storage はモック。外部接続なし。
import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { createXSnapshot } from "../../api/_lib/snsXSend.js";



import { getJaT } from "../../api/_lib/botPage.js";
import { SCREEN_MARKERS } from "../lib/snsScreenMarkers.js";
import { DATE } from "./verifyData/sns-today-plan-v3-race-db.js";
import { runTodayPlan } from "../lib/snsTodayPlanner.js";

import { loadTodayVariants } from "../lib/snsTodayVariants.js";
import {
  digestOf,
  raceDbOf,
  runSnsTodayPlanScenes1,
  runSnsTodayPlanScenes2,
} from "./verifyData/sns-today-plan-scenes-1.js";






import { runSnsTodayPlanScenesB1, runSnsTodayPlanScenesB2 } from "./verifyData/sns-today-plan-scenes-b-1.js";
import {
  runSnsTodayPlanScenesB3,
  runSnsTodayPlanScenesB4,
  runSnsTodayPlanScenesB5,
} from "./verifyData/sns-today-plan-scenes-b-2.js";
import { runSnsTodayPlanScenesB6, runSnsTodayPlanScenesB7 } from "./verifyData/sns-today-plan-scenes-b-3.js";

// 型 a・型 b（画像つき）の組み手の試験は、リポジトリの config から今の型（current、v3）を外した物で回す（v3 の試験は
// verify-sns-today-v3.js。v3 が入っても a・b の組み手は残す、BOA-1314）
const LEGACY_VARIANTS = (() => {
  const { current: _current, ...rest } = loadTodayVariants();
  return rest;
})();

const db = new PGlite();
const first = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const all = async (sql, args = []) => (await db.query(sql, args)).rows;
const PNG = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
const riskRules = JSON.parse(
  await readFile(
    new URL("../../sns-video-studio/remotion/risk-rules.json", import.meta.url),
    "utf8",
  ),
).rules;
const t = await getJaT();
const at = (hhmm) => new Date(`${DATE}T${hhmm}:00+09:00`);
const stpState = { me: undefined };

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
    "163_drop_sns_mobile_approval.sql",
    "174_sns_today_type_schedule.sql",
  ])
    await db.exec(
      (
        await readFile(
          new URL("../../docs/db-migration/" + file, import.meta.url),
          "utf8",
        )
      ).replaceAll("now()", "test_now()"),
    );
  stpState.me = (await first("SELECT id FROM sns_approvers WHERE display_name='本人'"))
    .id;
});
beforeEach(async () => {
  await db.exec(`
    DELETE FROM sns_metric_jobs; DELETE FROM sns_post_tracking; DELETE FROM sns_x_send_jobs; DELETE FROM sns_auto_send_items; DELETE FROM sns_today_type_schedule;
    ALTER TABLE sns_drafts DISABLE TRIGGER USER; DELETE FROM sns_drafts; ALTER TABLE sns_drafts ENABLE TRIGGER USER;
    UPDATE test_clock SET value=NULL;`);
});
after(() => db.close());

// PostgREST の store と同じ契約を SQL で（URL の形は下の別のテストで確かめる）
const sqlStore = {
  async todayState(date) {
    const draft =
      (await first(
        "SELECT * FROM sns_drafts WHERE send_lane='A' AND format='today_digest' AND source_data->'digest'->>'date'=$1 AND status<>'archived' AND source_data->'today_reply' IS NULL",
        [date],
      )) ?? null;
    const reply = draft
      ? await first(
          "SELECT * FROM sns_drafts WHERE source_data->'today_reply'->>'parent_draft_id'=$1 AND status<>'archived'",
          [draft.id],
        )
      : null;
    const itemOf = async (raceId) =>
      (await first(
        "SELECT * FROM sns_auto_send_items WHERE kind='digest' AND race_id=$1",
        [raceId],
      )) ?? null;
    return {
      draft,
      item: await itemOf(`today:${date}`),
      reply: reply
        ? { draft: reply, item: await itemOf(`today:${date}:reply`) }
        : null,
    };
  },
  typeSchedule: (date) =>
    first(
      "SELECT day::text AS day, type_id, post FROM sns_today_type_schedule WHERE day=$1",
      [date],
    ).then((row) => row ?? null),
  insertDraft: (row) =>
    first(
      `INSERT INTO sns_drafts(content_group_id,platform,language,status,format,title,caption_text,hashtags,cover_image_path,
         source_data,publish_blocked,publication_hold_reasons,risk_flags,send_lane,scheduled_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [
        row.content_group_id,
        row.platform,
        row.language,
        row.status,
        row.format,
        row.title,
        row.caption_text,
        row.hashtags,
        row.cover_image_path,
        row.source_data,
        row.publish_blocked,
        JSON.stringify(row.publication_hold_reasons),
        JSON.stringify(row.risk_flags),
        row.send_lane,
        row.scheduled_at,
      ],
    ),
  async updateTodayDraft(id, p) {
    const row = await first(
      // PostgREST の PATCH と同じく、渡した列だけを書く
      `UPDATE sns_drafts SET caption_text=coalesce($2,caption_text),cover_image_path=coalesce($3,cover_image_path),
         source_data=coalesce($4,source_data),risk_flags=coalesce($5,risk_flags),template_variant_id=coalesce($6,template_variant_id),
         publish_blocked=coalesce($7,publish_blocked)
       WHERE id=$1 AND status IN ('pending_review','approved') RETURNING *`,
      [
        id,
        p.caption_text ?? null,
        p.cover_image_path ?? null,
        p.source_data ?? null,
        p.risk_flags === undefined ? null : JSON.stringify(p.risk_flags),
        p.template_variant_id ?? null,
        p.publish_blocked ?? null,
      ],
    );
    if (!row) throw new Error("下書きを書き換えられない");
    return row;
  },
  insertItem: (row) =>
    first(
      `INSERT INTO sns_auto_send_items(kind,draft_id,channel,race_id,deadline_at,notify_by,veto_until,state,checks,held_reason)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [
        row.kind,
        row.draft_id,
        row.channel,
        row.race_id,
        row.deadline_at,
        row.notify_by,
        row.veto_until,
        row.state,
        row.checks,
        row.held_reason,
      ],
    ),
  async updateItem(id, from, p) {
    const row = await first(
      `UPDATE sns_auto_send_items SET state=$3,checks=coalesce($4,checks),held_reason=$5,
         notified_at=coalesce($6,notified_at),stop_token_hash=coalesce($7,stop_token_hash) WHERE id=$1 AND state=$2 RETURNING *`,
      [
        id,
        from,
        p.state,
        p.checks ?? null,
        p.held_reason ?? null,
        p.notified_at ?? null,
        p.stop_token_hash ?? null,
      ],
    );
    if (!row) throw new Error("item を更新できない");
    return row;
  },
  control: () =>
    first(
      "SELECT mode, dry_run, auto_approver_id FROM sns_auto_send_control WHERE channel='x'",
    ),
  // PostgREST の rpc と同じく、関数の返り値（job の JSON）を返す
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
const trackingStore = {
  save: (t) =>
    db.query(
      `INSERT INTO sns_post_tracking(draft_id,template_variant_id,race_url,tracking_url,utm_source,utm_medium,utm_campaign,utm_content,release_evidence)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (draft_id) DO NOTHING`,
      [
        t.draft_id,
        t.template_variant_id,
        t.race_url,
        t.tracking_url,
        t.utm_source,
        t.utm_medium,
        t.utm_campaign,
        t.utm_content,
        t.release_evidence,
      ],
    ),
};

// ---- 後半の場面（verifyData/sns-today-plan-scenes-1.js） ----
runSnsTodayPlanScenes1({ first, all, at, sqlStore, shooter, plan, approve });
const EXPECTED_LINES = [
  "［逃げ］全国で1コースに入ったとき逃げ切った割合70%以上の1号艇",
  "［まくり］そのコースでまくりで1着の割合25%以上の選手",
  "",
  "［まくり］戸田5R 13:15締切｜3号艇 まくり 1｜全国31走",
  "［逃げ］平和島3R 14:15締切｜1号艇 逃げ 3｜全国40走",
  "［逃げ］平和島5R 15:15締切｜1号艇 逃げ 5｜全国40走",
  "［逃げ］平和島2R 16:15締切｜1号艇 逃げ 2｜全国40走",
  "［まくり］戸田7R 18:15締切｜2号艇 まくり 3｜全国33走",
].join("\n");

// ---- 後半の場面（verifyData/sns-today-plan-scenes-1.js） ----
runSnsTodayPlanScenes2({ first, all, at, sqlStore, shooter, plan, approve });
// /today の確認（inspect）と、レースの龍神ソナーの図（screenshot）。notReady の race_id は図が無い（元データの作成前）
function shooter({ fail = false, notReady = [], todayMissing = false } = {}) {
  const calls = [];
  const inspects = [];
  return {
    calls,
    inspects,
    async inspect(request) {
      inspects.push(request);
      return {
        finalUrl: request.url,
        visibleSelectors: todayMissing ? [] : request.requiredSelectors,
      };
    },
    async screenshot(request) {
      calls.push(request);
      if (fail || notReady.some((id) => request.url.includes(id)))
        throw new Error("screenshot_component_missing");
      // 図ごとに中身の違う画像（hash で区別できるように）
      return {
        finalUrl: request.url,
        png: new Uint8Array([...PNG, calls.length]),
        visibleSelectors: request.requiredSelectors,
      };
    },
  };
}
async function plan({
  now = at("06:40"),
  mode = "live",
  digest = digestOf(),
  headless = shooter(),
  notes = [],
  saved = [],
  raceDb = raceDbOf(),
  nowMs,
  reviewDate,
  loadVariants,
} = {}) {
  return runTodayPlan(
    { mode, now: () => now },
    {
      store: sqlStore,
      getDigest: async (date) => {
        assert.equal(date, DATE);
        return digest;
      },
      raceDb,
      t,
      headless,
      markers: SCREEN_MARKERS,
      riskRules,
      trackingStore,
      saveImage: async (path, bytes) => saved.push({ path, bytes }),
      signImage: async (path) => `https://signed/${path}`,
      notify: async (text) => notes.push(text),
      ...(nowMs ? { nowMs } : {}),
      ...(reviewDate ? { reviewDate } : {}),
      loadVariants: loadVariants ?? (() => LEGACY_VARIANTS),
    },
  );
}
const loadMedia = async () => PNG;
// 本人の承認（個別承認の RPC は 163 で削除。承認そのものの approve_sns_x_send を使う）
async function approve(draft) {
  return (
    await first("SELECT approve_sns_x_send($1,$2,$3,$4) r", [
      draft.id,
      stpState.me,
      await createXSnapshot(draft, loadMedia),
      draft.scheduled_at,
    ])
  ).r;
}

// ---- 後半の場面（verifyData/sns-today-plan-scenes-b-1.js） ----
runSnsTodayPlanScenesB1({ db, first, all, t, at, sqlStore, EXPECTED_LINES, shooter, plan, approve, stpRb11 });

test("vercel.json: sns-auto-plan の関数に /today の文言（ja の common.json）を同梱する", async () => {
  const vercel = JSON.parse(
    await readFile(new URL("../../vercel.json", import.meta.url), "utf8"),
  );
  assert.match(
    vercel.functions["api/cron/sns-auto-plan.js"].includeFiles,
    /src\/locales\/ja\/common\.json/,
  );
});

/** test("runbook の L2 の SQL（153-runbook.md）を流すと、承認した /today の job が 7:01  の中身を割った 1/2 */
async function stpRb11() {
  const runbook = await readFile(
    new URL("../../docs/db-migration/153-runbook.md", import.meta.url),
    "utf8",
  );
  return { runbook };
}

// ---- 後半の場面（verifyData/sns-today-plan-scenes-b-1.js・sns-today-plan-scenes-b-2.js） ----
runSnsTodayPlanScenesB2({ db, first, all, t, at, sqlStore, EXPECTED_LINES, shooter, plan, approve, stpRb11 });
runSnsTodayPlanScenesB3({ db, first, all, t, at, stpState, sqlStore, trackingStore, shooter, plan, loadMedia, approve, stpVar1, stpVar3 });

/** test("171: /today の見出しの2案の行を入れる。もう一度当てても増えない。入れた後は案の uuid で tracking・下 の中身を割った 1/4 */
async function stpVar1() {
  const sql = await readFile(
    new URL(
      "../../docs/db-migration/171_sns_today_heading_variants.sql",
      import.meta.url,
    ),
    "utf8",
  );
  return { sql };
}

// ---- 後半の場面（verifyData/sns-today-plan-scenes-b-2.js） ----
runSnsTodayPlanScenesB4({ db, first, all, t, at, stpState, sqlStore, trackingStore, shooter, plan, loadMedia, approve, stpVar1, stpVar3 });

/** test("171: /today の見出しの2案の行を入れる。もう一度当てても増えない。入れた後は案の uuid で tracking・下 の中身を割った 3/4 */
async function stpVar3() {
  // リポジトリの config の案 a・b の uuid は、171 が入れた行の id と同じ（2026-10-20 に本番へ適用済み）
  const config = JSON.parse(
    await readFile(
      new URL("../../config/today-variants.json", import.meta.url),
      "utf8",
    ),
  );
  return { config };
}

// ---- 後半の場面（verifyData/sns-today-plan-scenes-b-2.js・sns-today-plan-scenes-b-3.js） ----
runSnsTodayPlanScenesB5({ db, first, all, t, at, stpState, sqlStore, trackingStore, shooter, plan, loadMedia, approve, stpVar1, stpVar3 });
runSnsTodayPlanScenesB6({ LEGACY_VARIANTS, db, first, all, PNG, at, sqlStore, shooter, plan, approve, stpRb21 });
/** test("返信: 送信の側（158・153 の transition）で、親の claim → 公開 → 子の claim が通る。子の予 の中身を割った 1/2 */
async function stpRb21() {
  const runbook = await readFile(
    new URL("../../docs/db-migration/153-runbook.md", import.meta.url),
    "utf8",
  );
  return { runbook };
}

// ---- 後半の場面（verifyData/sns-today-plan-scenes-b-3.js） ----
runSnsTodayPlanScenesB7({ LEGACY_VARIANTS, db, first, all, PNG, at, sqlStore, shooter, plan, approve, stpRb21 });
