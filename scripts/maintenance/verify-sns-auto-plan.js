// SNS の自動送信の計画（sns-pdca-loop tasks 12 の前半、cron sns_auto_plan）の再現テスト。
// SQL154 までを PGlite に入れ（本番と同じ。158 は未適用の前提でも動くことを確かめる）、153 のトリガー・制約の上で
// item の作成 → 検査 → manual・held_manual → 公開保留の解除 → 本人の承認までを通す。数値の照合・表示の確認はモック。外部接続なし。
// 自動（mode=auto、全貌動画、2026-10-18 ユーザー決定）: 評価役の P0 が0件なら notified にして自動送信の承認者で承認する（X は親から順）。
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { createXSnapshot } from "../../api/_lib/snsXSend.js";
import { createMockHeadless } from "../../api/_lib/snsDeadlineQueue.js";
import { sendHolds } from "../../api/_lib/snsMobileApproval.js";
import { SCREEN_MARKERS } from "../lib/snsScreenMarkers.js";
import { runSnsAutoPlan } from "../lib/snsAutoPlanRunner.js";
import { SCRAPE_JOBS, activeMinutesOf } from "../lib/scrapeJobs/registry.js";
import {
  RACE,
  PRE_153,
  hash,
  manifest,
  CLAIMS,
  runSnsAutoPlanScenes1,
  runSnsAutoPlanScenes2,
  runSnsAutoPlanScenes3,
  runSnsAutoPlanScenes4,
  runSnsAutoPlanScenes5,
} from "./verifyData/sns-auto-plan-scenes-1.js";
import { runSnsAutoPlanScenes6 } from "./verifyData/sns-auto-plan-scenes-2.js";

const db = new PGlite();
const first = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const all = async (sql, args = []) => (await db.query(sql, args)).rows;
const loadMedia = async () => new Uint8Array([1, 2, 3]);
const riskRules = JSON.parse(
  await readFile(
    new URL("../../sns-video-studio/remotion/risk-rules.json", import.meta.url),
    "utf8",
  ),
).rules;
// JST 2037-10-16 12:00。締切（発走）は JST 15:00、送る時刻（止められる期限）は 14:00、失効は 14:30
const T0 = new Date("2037-10-16T03:00:00Z");

// ---- 後半の場面（verifyData/sns-auto-plan-scenes-1.js） ----
runSnsAutoPlanScenes1({ db, all, T0, addRace, importBundle, run });
const RACE_URL = `https://www.boat-ai.jp/race/${RACE}?tab=sonar`;

// ---- 後半の場面（verifyData/sns-auto-plan-scenes-1.js） ----
runSnsAutoPlanScenes2({ db, all, T0, RACE_URL, addRace, importBundle, run });
let me;

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
  // auto-plan が読む列だけ（本番の races・race_conditions と同じ名前・型）
  await db.exec(`
    CREATE TABLE races(race_id VARCHAR PRIMARY KEY, race_date DATE, start_time TIME, cancellation_status TEXT);
    CREATE TABLE race_conditions(race_id VARCHAR PRIMARY KEY, race_stage VARCHAR);`);
  for (const file of [
    ...PRE_153,
    "153_sns_auto_send.sql",
    "154_sns_tokens_metric_jobs.sql",
  ])
    await db.exec(
      (
        await readFile(
          new URL("../../docs/db-migration/" + file, import.meta.url),
          "utf8",
        )
      ).replaceAll("now()", "test_now()"),
    );
  me = (await first("SELECT id FROM sns_approvers WHERE display_name='本人'"))
    .id;
});

// ---- 後半の場面（verifyData/sns-auto-plan-scenes-1.js） ----
runSnsAutoPlanScenes3({ db, all, T0, RACE_URL, addRace, importBundle, run });

async function addRace(
  raceId,
  stage,
  { start = "15:00:00", cancelled = null } = {},
) {
  await db.query("INSERT INTO races VALUES($1,$2,$3,$4)", [
    raceId,
    raceId.slice(0, 10),
    start,
    cancelled,
  ]);
  await db.query("INSERT INTO race_conditions VALUES($1,$2)", [raceId, stage]);
}

// ---- 後半の場面（verifyData/sns-auto-plan-scenes-1.js） ----
runSnsAutoPlanScenes4({ db, all, T0, RACE_URL, addRace, importBundle, run });
async function importBundle({
  raceId = RACE,
  parent,
  createdAt,
  qa = { pass: true, numeric_claims_match: true, L0_hits: [] },
} = {}) {
  const bundle = {
    schema_version: "ryujin-preview/1",
    format: "race_full",
    title: "準優勝戦の全貌",
    script: "台本",
    race_id: raceId,
    screen_key: "race-sonar",
    template_variant_id: "tv1",
    claims: CLAIMS,
    x_thread: [
      {
        index: 0,
        text:
          parent ??
          `準優勝戦の全貌。\nhttps://www.boat-ai.jp/race/${raceId}?tab=sonar`,
        media: "draft-x.mp4",
      },
      { index: 1, text: "1号艇は今節の勝率が高い" },
    ],
  };
  const r = (
    await first(
      "SELECT import_sns_preview_bundle($1,'ryujin-preview/1',$2,$3,$4,'[]'::jsonb,'[]'::jsonb,'{}'::jsonb) r",
      [hash(), bundle, qa, manifest],
    )
  ).r;
  if (createdAt)
    await db.query("UPDATE sns_bundle_imports SET created_at=$2 WHERE id=$1", [
      r.content_group_id,
      createdAt,
    ]);
  return r.content_group_id;
}

// PostgREST の store と同じ契約を SQL で（URL の形は下の別のテストで確かめる）
const sqlStore = {
  calls: [],
  rpc: async (name) => {
    sqlStore.calls.push(name);
    return first(`SELECT public.${name}() r`);
  },
  controls: async () =>
    Object.fromEntries(
      (
        await all(
          "SELECT channel, mode, dry_run, auto_approver_id FROM sns_auto_send_control",
        )
      ).map((r) => [r.channel, r]),
    ),
  async todaysBundles(today) {
    const bundles = (
      await all(
        "SELECT id, bundle, qa, created_at FROM sns_bundle_imports WHERE schema_version='ryujin-preview/1' ORDER BY created_at DESC",
      )
    )
      .map((b) => ({ ...b, created_at: b.created_at.toISOString() }))
      .filter((b) => String(b.bundle?.race_id).startsWith(`${today}-`));
    const raceIds = bundles.map((b) => b.bundle.race_id);
    return {
      bundles,
      races: await all(
        "SELECT race_id, race_date::text, start_time::text, cancellation_status FROM races WHERE race_id = ANY($1)",
        [raceIds],
      ),
      stages: await all(
        "SELECT race_id, race_stage FROM race_conditions WHERE race_id = ANY($1)",
        [raceIds],
      ),
      drafts: await all(
        "SELECT * FROM sns_drafts WHERE bundle_import_id = ANY($1)",
        [bundles.map((b) => b.id)],
      ),
      items: await all(
        "SELECT * FROM sns_auto_send_items WHERE race_id = ANY($1)",
        [raceIds],
      ),
    };
  },
  hasPostedFormat: async (format, variant) =>
    Boolean(
      await first(
        "SELECT 1 FROM sns_drafts WHERE status='posted' AND format=$1 AND source_data->>'local_template_variant_id'=$2",
        [format, variant],
      ),
    ),
  jobsFor: (ids) =>
    all(
      "SELECT id, draft_id, state FROM sns_x_send_jobs WHERE draft_id = ANY($1)",
      [ids],
    ),
  insertItem: async (row) =>
    first(
      `INSERT INTO sns_auto_send_items(bundle_import_id,channel,race_id,deadline_at,notify_by,veto_until,state)
       VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [
        row.bundle_import_id,
        row.channel,
        row.race_id,
        row.deadline_at,
        row.notify_by,
        row.veto_until,
        row.state,
      ],
    ),
  async updateItem(id, fromState, patch) {
    const row = await first(
      `UPDATE sns_auto_send_items SET state=coalesce($3,state), checks=coalesce($4,checks), held_reason=coalesce($5,held_reason),
         stop_token_hash=coalesce($6,stop_token_hash), notified_at=coalesce($7,notified_at), updated_at=test_now()
       WHERE id=$1 AND state=$2 RETURNING *`,
      [
        id,
        fromState,
        patch.state ?? null,
        patch.checks ?? null,
        patch.held_reason ?? null,
        patch.stop_token_hash ?? null,
        patch.notified_at ?? null,
      ],
    );
    if (!row) throw new Error(`item ${id} を更新できない`);
    return row;
  },
  async updateDraft(id, patch) {
    const sets = Object.keys(patch).map((k, i) => `${k}=$${i + 2}`);
    const row = await first(
      `UPDATE sns_drafts SET ${sets.join(",")} WHERE id=$1 AND status='pending_review' RETURNING *`,
      [
        id,
        ...Object.values(patch).map((v) =>
          Array.isArray(v) && !v.length ? JSON.stringify(v) : v,
        ),
      ],
    );
    if (!row) throw new Error(`下書き ${id} を更新できない`);
    return row;
  },
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
const okClaims = async () => ({
  ok: true,
  revision: "rev1",
  observedAt: T0.toISOString(),
  results: [{ id: "c1", ok: true }],
});
const ctx = (mode = "live") => ({
  mode,
  now: () => T0,
  shouldStop: () => false,
});
async function run({
  mode = "live",
  checkClaims = okClaims,
  headless,
  notes = [],
  notify,
} = {}) {
  return runSnsAutoPlan(ctx(mode), {
    store: sqlStore,
    checkClaims,
    headless:
      headless ??
      createMockHeadless({ visibleSelectors: SCREEN_MARKERS["race-sonar"] }),
    markers: SCREEN_MARKERS,
    riskRules,
    trackingStore,
    notify: notify ?? (async (text) => notes.push(text)),
    approve: async (draft, approverId, scheduledAt) =>
      (
        await first("SELECT approve_sns_x_send($1,$2,$3,$4) r", [
          draft.id,
          approverId,
          await createXSnapshot(draft, loadMedia),
          scheduledAt,
        ])
      ).r,
  });
}
const items = () => all("SELECT * FROM sns_auto_send_items ORDER BY channel");
const drafts = (groupId, platform) =>
  all(
    "SELECT * FROM sns_drafts WHERE bundle_import_id=$1 AND platform=$2 ORDER BY thread_index",
    [groupId, platform],
  );

test("準優勝戦の素材 v1 から X・YouTube の item を作り、合格なら manual にして公開保留を外し、本人が承認できる", async () => {
  const group = await importBundle();
  const notes = [];
  const result = await run({ notes });
  const [x, yt] = await items();
  assert.deepEqual(
    [x.channel, x.state, yt.channel, yt.state],
    ["x", "manual", "youtube", "manual"],
  );
  // 締切は races から（JST 15:00）。事前通知の期限は3時間前、止められる期限は60分前
  assert.equal(x.deadline_at.toISOString(), "2037-10-16T06:00:00.000Z");
  assert.equal(x.notify_by.toISOString(), "2037-10-16T03:00:00.000Z");
  assert.equal(x.veto_until.toISOString(), "2037-10-16T05:00:00.000Z");
  assert.equal(x.checks.passed, true);
  assert.equal(x.checks.dry_run, true);
  assert.equal(x.checks.new_format, true);
  const thread = await drafts(group, "x");
  const tracking = await first(
    "SELECT * FROM sns_post_tracking WHERE draft_id=$1",
    [thread[0].id],
  );
  assert.equal(tracking.utm_campaign, "race-full");
  assert.equal(tracking.utm_content, thread[0].id);
  assert.ok(thread[0].caption_text.includes(tracking.tracking_url));
  assert.ok(tracking.tracking_url.startsWith(`${RACE_URL}&utm_source=x`));
  for (const d of [...thread, ...(await drafts(group, "youtube"))]) {
    // スレッドの子は公開保留のまま（親の job につなぐ前に単独で承認・送信されないため）
    const child = d.platform === "x" && d.thread_index > 0;
    assert.equal(d.publish_blocked, child);
    assert.deepEqual(d.publication_hold_reasons, []);
    assert.equal(d.source_data.claim_check.revision, "rev1");
    assert.equal(d.source_data.deadline_queue.source_revision, "rev1");
    assert.equal(
      d.source_data.deadline_queue.deadline_at,
      "2037-10-16T06:00:00.000Z",
    );
    assert.equal(
      d.source_data.deadline_queue.expires_at,
      "2037-10-16T05:30:00.000Z",
    );
    assert.equal(d.source_data.release_evidence.status, "released");
    assert.deepEqual(sendHolds(d), child ? ["公開保留素材"] : []);
  }
  assert.equal(
    (await drafts(group, "youtube"))[0].source_data.deadline_queue.youtube_mode,
    "immediate",
  );
  assert.equal(
    thread[0].source_data.deadline_queue.public_url,
    tracking.tracking_url,
  );
  // 送る直前の検査が長文の1投稿を許すかの印（子のあるスレッドは 2 なので280まで）
  assert.equal(thread[0].source_data.deadline_queue.thread_length, 2);
  assert.equal(
    (await drafts(group, "youtube"))[0].source_data.deadline_queue
      .thread_length,
    undefined,
  );
  // 本人の承認（個別承認の画面と同じ関数）が通り、job ができる（dry_run の間は送信の側が claim の前で止める）
  const job = (
    await first("SELECT approve_sns_x_send($1,$2,$3,NULL) r", [
      thread[0].id,
      me,
      await createXSnapshot(thread[0], loadMedia),
    ])
  ).r;
  assert.equal(job.state, "queued");
  assert.equal(job.auto_item_id, x.id);
  await assert.rejects(
    db.query("SELECT approve_sns_x_send($1,$2,$3,NULL)", [
      thread[1].id,
      me,
      await createXSnapshot(thread[1], loadMedia),
    ]),
    /承認できません/,
  );
  assert.equal(result.rowsWritten, 2);
  assert.equal(notes.length, 2);
  // 個別承認の画面は 2026-10-18 に撤去した。manual のチャネルは送らないと知らせる
  assert.ok(notes.every((n) => n.includes("個別承認（mode=manual）なので送らない")));
});

// ---- 後半の場面（verifyData/sns-auto-plan-scenes-1.js） ----
runSnsAutoPlanScenes5({ db, all, T0, RACE_URL, addRace, importBundle, sqlStore, run, items, drafts });

test("cron の登録: sns_auto_plan は JST 5:30〜23:00 の中だけを死活の監視で見る、vercel.json に5分ごと", async () => {
  const active = activeMinutesOf(SCRAPE_JOBS.sns_auto_plan);
  assert.deepEqual(active, { start: 330, end: 1380 });
  assert.equal(SCRAPE_JOBS.sns_auto_plan.maxDurationSec, 300);
  const vercel = JSON.parse(
    await readFile(new URL("../../vercel.json", import.meta.url), "utf8"),
  );
  assert.ok(
    vercel.crons.some(
      (c) =>
        c.path === "/api/cron/sns-auto-plan" &&
        c.schedule === "*/5 20-23,0-13 * * *",
    ),
  );
  assert.match(
    vercel.functions["api/cron/sns-auto-plan.js"].includeFiles,
    /risk-rules\.json/,
  );
});

// ---- 後半の場面（verifyData/sns-auto-plan-scenes-2.js） ----
runSnsAutoPlanScenes6({ db, first, all, riskRules, T0, addRace, importBundle, sqlStore, trackingStore, okClaims, run, items });
