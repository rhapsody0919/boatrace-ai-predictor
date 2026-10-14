// SNS の自動送信の計画（sns-pdca-loop tasks 12 の前半、cron sns_auto_plan）の再現テスト。
// SQL154 までを PGlite に入れ（本番と同じ。158 は未適用の前提でも動くことを確かめる）、153 のトリガー・制約の上で
// item の作成 → 検査 → manual・held_manual → 公開保留の解除 → 本人の承認までを通す。数値の照合・表示の確認はモック。外部接続なし。
import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { createXSnapshot } from "../../api/_lib/snsXSend.js";
import { createMockHeadless } from "../../api/_lib/snsDeadlineQueue.js";
import { sendHolds } from "../../api/_lib/snsMobileApproval.js";
import { SCREEN_MARKERS } from "../lib/snsScreenMarkers.js";
import {
  createAutoPlanStore,
  planCandidates,
  runSnsAutoPlan,
} from "../lib/snsAutoPlanRunner.js";
import { SCRAPE_JOBS, activeMinutesOf } from "../lib/scrapeJobs/registry.js";

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
// JST 2026-10-16 12:00。締切（発走）は JST 15:00、送る時刻（止められる期限）は 14:00、失効は 14:30
const T0 = new Date("2026-10-16T03:00:00Z");
const RACE = "2026-10-16-04-12";
const RACE_URL = `https://www.boat-ai.jp/race/${RACE}?tab=sonar`;
const PRE_153 = [
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
];
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
beforeEach(async () => {
  await db.exec(`
    DELETE FROM sns_post_tracking; UPDATE sns_x_send_jobs SET parent_job_id=NULL; DELETE FROM sns_x_send_jobs;
    DELETE FROM sns_auto_send_items;
    ALTER TABLE sns_drafts DISABLE TRIGGER USER; DELETE FROM sns_drafts; ALTER TABLE sns_drafts ENABLE TRIGGER USER;
    DELETE FROM sns_bundle_imports; DELETE FROM races; DELETE FROM race_conditions;
    UPDATE sns_auto_send_control SET mode='manual', dry_run=true;
    UPDATE sns_x_send_control SET schedule_minutes=60, expiry_minutes=30;`);
  await db.query("UPDATE test_clock SET value=$1", [T0.toISOString()]);
  await addRace(RACE, "準優勝戦");
});
after(() => db.close());

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
const hash = () => randomBytes(32).toString("hex");
const manifest = [
  { name: "draft.mp4", storage_path: "b/draft.mp4" },
  { name: "draft-x.mp4", storage_path: "b/draft-x.mp4" },
  { name: "scene-1.png", storage_path: "b/scene-1.png" },
];
const CLAIMS = [
  {
    id: "c1",
    text: "1号艇の勝率",
    value: 7.12,
    source: {
      endpoint: `/api/analogy/facts/${RACE}`,
      path: ["facts", 0, "value"],
    },
  },
];
async function importBundle({ raceId = RACE, parent, createdAt } = {}) {
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
      [
        hash(),
        bundle,
        { pass: true, numeric_claims_match: true, L0_hits: [] },
        manifest,
      ],
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
        await all("SELECT channel, mode, dry_run FROM sns_auto_send_control")
      ).map((r) => [r.channel, r]),
    ),
  async todaysBundles(today) {
    const bundles = (
      await all(
        "SELECT id, bundle, created_at FROM sns_bundle_imports WHERE schema_version='ryujin-preview/1' ORDER BY created_at DESC",
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
      `UPDATE sns_auto_send_items SET state=coalesce($3,state), checks=coalesce($4,checks), held_reason=coalesce($5,held_reason), updated_at=test_now()
       WHERE id=$1 AND state=$2 RETURNING *`,
      [
        id,
        fromState,
        patch.state ?? null,
        patch.checks ?? null,
        patch.held_reason ?? null,
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
    notify: async (text) => notes.push(text),
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
  assert.equal(x.deadline_at.toISOString(), "2026-10-16T06:00:00.000Z");
  assert.equal(x.notify_by.toISOString(), "2026-10-16T03:00:00.000Z");
  assert.equal(x.veto_until.toISOString(), "2026-10-16T05:00:00.000Z");
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
      "2026-10-16T06:00:00.000Z",
    );
    assert.equal(
      d.source_data.deadline_queue.expires_at,
      "2026-10-16T05:30:00.000Z",
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
  assert.ok(notes.every((n) => n.includes("試運転中")));
});

test("同じ素材でもう一度走らせても item・下書き・通知は増えない", async () => {
  const group = await importBundle();
  await run();
  const before = await drafts(group, "x");
  const notes = [];
  const result = await run({ notes });
  assert.equal((await items()).length, 2);
  assert.deepEqual(await drafts(group, "x"), before);
  assert.equal(result.rowsWritten, 0);
  assert.equal(notes.length, 0);
});

test("優勝戦・準優勝戦以外・中止・送る時刻を過ぎたレースは item を作らない", async () => {
  await addRace("2026-10-16-05-01", "予選");
  await addRace("2026-10-16-06-12", "優勝戦", { cancelled: "confirmed" });
  await addRace("2026-10-16-07-12", "優勝戦", { start: "12:59:00" });
  await addRace("2026-10-16-08-12", "ツッキー優勝戦");
  for (const raceId of [
    "2026-10-16-05-01",
    "2026-10-16-06-12",
    "2026-10-16-07-12",
    "2026-10-16-08-12",
  ])
    await importBundle({ raceId });
  const result = await run();
  assert.equal((await items()).length, 0);
  assert.deepEqual(result.report.items.map((i) => i.reason).sort(), [
    "not_final_stage",
    "not_final_stage",
    "race_cancelled",
    "too_late",
  ]);
});

test("数値の照合が合わなければ held_manual にし、下書き・UTM の表は変えない", async () => {
  const group = await importBundle();
  const notes = [];
  await run({
    notes,
    checkClaims: async () => ({
      ok: false,
      revision: null,
      observedAt: T0.toISOString(),
      results: [{ id: "c1", ok: false, reason: "value_mismatch" }],
    }),
  });
  const [x] = await items();
  assert.equal(x.state, "held_manual");
  assert.match(x.held_reason, /数値の照合: c1 value_mismatch/);
  const [parent] = await drafts(group, "x");
  assert.equal(parent.publish_blocked, true);
  assert.equal(parent.caption_text.includes("utm_"), false);
  assert.equal((await all("SELECT * FROM sns_post_tracking")).length, 0);
  assert.equal(notes.length, 2);
  assert.ok(notes[0].includes("止めた"));
});

test("UTM を差し込んだ後の本文に禁止表現があれば held_manual", async () => {
  await importBundle({ parent: `競艇の準優勝戦。\n${RACE_URL}` });
  await run();
  const [x, yt] = await items();
  assert.equal(x.state, "held_manual");
  assert.match(x.held_reason, /禁止表現/);
  assert.equal(yt.state, "manual");
});

test("取得の失敗だけなら checking のままやり直し、3回目で held_manual。途中で通れば manual", async () => {
  await importBundle();
  const failing = async () => ({
    ok: false,
    revision: null,
    observedAt: T0.toISOString(),
    results: [{ id: "c1", ok: false, reason: "fetch_failed: HTTP 503" }],
  });
  await run({ checkClaims: failing });
  assert.deepEqual(
    (await items()).map((i) => [i.state, i.checks.attempts]),
    [
      ["checking", 1],
      ["checking", 1],
    ],
  );
  await run({ checkClaims: failing });
  await run();
  assert.deepEqual(
    (await items()).map((i) => i.state),
    ["manual", "manual"],
  );

  await db.exec(
    "DELETE FROM sns_post_tracking; UPDATE sns_x_send_jobs SET parent_job_id=NULL; DELETE FROM sns_x_send_jobs; DELETE FROM sns_auto_send_items; ALTER TABLE sns_drafts DISABLE TRIGGER USER; DELETE FROM sns_drafts; ALTER TABLE sns_drafts ENABLE TRIGGER USER; DELETE FROM sns_bundle_imports;",
  );
  await importBundle();
  for (let i = 0; i < 3; i++) await run({ checkClaims: failing });
  assert.deepEqual(
    (await items()).map((i) => [i.state, i.checks.attempts]),
    [
      ["held_manual", 3],
      ["held_manual", 3],
    ],
  );
});

test("リンク先の表示の印が見えなければ held_manual（やり直さない）", async () => {
  await importBundle();
  await run({ headless: createMockHeadless({ visibleSelectors: [] }) });
  const [x] = await items();
  assert.equal(x.state, "held_manual");
  assert.match(x.held_reason, /リンク先の表示: public_component_missing/);
});

test("shadow は検査だけで、item・下書き・UTM の表・Slack に書かない", async () => {
  const group = await importBundle();
  const notes = [];
  sqlStore.calls.length = 0;
  const result = await run({ mode: "shadow", notes });
  assert.equal((await items()).length, 0);
  assert.equal((await drafts(group, "x"))[0].publish_blocked, true);
  assert.equal((await all("SELECT * FROM sns_post_tracking")).length, 0);
  assert.equal(notes.length, 0);
  assert.deepEqual(
    result.report.items.map((i) => i.outcome),
    ["manual", "manual"],
  );
  assert.equal(sqlStore.calls.length, 0);
});

test("manual にした後で公開保留を外せずに落ちたものは、次の実行で外す", async () => {
  const group = await importBundle();
  await run();
  await db.exec(
    "ALTER TABLE sns_drafts DISABLE TRIGGER USER; UPDATE sns_drafts SET publish_blocked=true; ALTER TABLE sns_drafts ENABLE TRIGGER USER;",
  );
  const result = await run();
  assert.deepEqual(
    (await drafts(group, "x")).map((d) => d.publish_blocked),
    [false, true],
  );
  assert.equal((await drafts(group, "youtube"))[0].publish_blocked, false);
  assert.deepEqual(
    result.report.items.filter((i) => i.outcome === "unblocked").length,
    2,
  );
});

test("158 が未適用で月の切り替えの関数が無くても、知らせて item の計画は続ける", async () => {
  sqlStore.calls.length = 0;
  await importBundle();
  const result = await run();
  assert.deepEqual(sqlStore.calls, [
    "roll_sns_send_baselines",
    "roll_sns_x_send_period",
  ]);
  assert.deepEqual(
    result.report.alerts.map((a) => a.key),
    ["roll:roll_sns_x_send_period"],
  );
  assert.equal((await items()).length, 2);
});

test("同じレースの素材が2つあれば新しい方を使い、別の素材の item が生きていれば作らない", async () => {
  const older = await importBundle({ createdAt: "2026-10-15T00:00:00Z" });
  const newer = await importBundle({ createdAt: "2026-10-16T00:00:00Z" });
  await run();
  assert.ok((await items()).every((i) => i.bundle_import_id === newer));
  const rows = await sqlStore.todaysBundles("2026-10-16");
  const plans = planCandidates(
    { ...rows, bundles: rows.bundles.filter((b) => b.id === older) },
    T0,
  );
  assert.equal(plans.todo.length, 0);
});

test("PostgREST の store: URL・条件付きの更新・失敗は投げる", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, method: options.method ?? "GET", body: options.body });
    if (url.includes("fail")) return new Response("", { status: 500 });
    if (options.method === "PATCH" && url.includes("none"))
      return new Response("[]");
    if (url.includes("sns_bundle_imports"))
      return new Response(
        JSON.stringify([
          { id: "b1", bundle: { race_id: RACE }, created_at: "x" },
          { id: "b2", bundle: { race_id: "2026-10-15-01-01" } },
        ]),
      );
    return new Response(JSON.stringify([{ id: "1" }]));
  };
  const store = createAutoPlanStore({ url: "https://db", key: "k", fetchImpl });
  const rows = await store.todaysBundles("2026-10-16");
  assert.deepEqual(
    rows.bundles.map((b) => b.id),
    ["b1"],
  );
  const urls = calls.map((c) => decodeURIComponent(c.url));
  assert.ok(
    urls[0].includes(
      "schema_version=eq.ryujin-preview/1&created_at=gte.2026-10-12T15:00:00.000Z",
    ),
  );
  assert.ok(urls.some((u) => u.includes(`races?race_id=in.("${RACE}")`)));
  assert.ok(
    urls.some((u) => u.includes('sns_drafts?bundle_import_id=in.("b1")')),
  );
  await store.updateItem("i1", "checking", { state: "manual" });
  assert.ok(
    calls.at(-1).url.endsWith("sns_auto_send_items?id=eq.i1&state=eq.checking"),
  );
  await store.updateDraft("d1", { publish_blocked: false });
  assert.ok(
    calls.at(-1).url.endsWith("sns_drafts?id=eq.d1&status=eq.pending_review"),
  );
  await assert.rejects(store.updateDraft("none", {}), /更新できない/);
  await assert.rejects(store.rpc("fail"), /HTTP 500/);
});

test("cron の登録: sns_auto_plan は JST 5:30〜21:00 の中だけを死活の監視で見る、vercel.json に5分ごと", async () => {
  const active = activeMinutesOf(SCRAPE_JOBS.sns_auto_plan);
  assert.deepEqual(active, { start: 330, end: 1260 });
  assert.equal(SCRAPE_JOBS.sns_auto_plan.maxDurationSec, 300);
  const vercel = JSON.parse(
    await readFile(new URL("../../vercel.json", import.meta.url), "utf8"),
  );
  assert.ok(
    vercel.crons.some(
      (c) =>
        c.path === "/api/cron/sns-auto-plan" &&
        c.schedule === "*/5 20-23,0-11 * * *",
    ),
  );
  assert.match(
    vercel.functions["api/cron/sns-auto-plan.js"].includeFiles,
    /risk-rules\.json/,
  );
});

const failingFetch = async () => ({
  ok: false,
  revision: null,
  observedAt: T0.toISOString(),
  results: [{ id: "c1", ok: false, reason: "fetch_failed: HTTP 503" }],
});

test("やり直し中（checking）の古い素材の item は、新しい素材が入ったら閉じ、次の実行で新しい素材の item を作る", async () => {
  await importBundle({ createdAt: "2026-10-15T00:00:00Z" });
  await run({ checkClaims: failingFetch });
  assert.deepEqual(
    (await items()).map((i) => i.state),
    ["checking", "checking"],
  );
  const newer = await importBundle({ createdAt: "2026-10-16T00:00:00Z" });
  await run();
  assert.deepEqual((await items()).map((i) => i.state).sort(), [
    "held_manual",
    "held_manual",
  ]);
  await run();
  const live = (await items()).filter((i) => i.state === "manual");
  assert.equal(live.length, 2);
  assert.ok(live.every((i) => i.bundle_import_id === newer));
});

test("やり直し中（checking）の item は、送る時刻を過ぎたら held_manual に閉じる", async () => {
  await importBundle();
  await run({ checkClaims: failingFetch });
  const late = new Date("2026-10-16T05:00:00Z");
  await runSnsAutoPlan(
    { mode: "live", now: () => late, shouldStop: () => false },
    {
      store: sqlStore,
      checkClaims: okClaims,
      headless: createMockHeadless({
        visibleSelectors: SCREEN_MARKERS["race-sonar"],
      }),
      markers: SCREEN_MARKERS,
      riskRules,
      trackingStore,
    },
  );
  const rows = await items();
  assert.deepEqual(
    rows.map((i) => i.state),
    ["held_manual", "held_manual"],
  );
  assert.match(rows[0].held_reason, /too_late/);
});

test("1つの素材の検査が例外で落ちても、ほかのレースの item は作る", async () => {
  await addRace("2026-10-16-09-11", "優勝戦");
  await importBundle({ raceId: "2026-10-16-09-11" });
  await importBundle();
  const result = await run({
    checkClaims: async ({ raceId }) => {
      if (raceId === RACE) throw new Error("boom");
      return okClaims();
    },
  });
  assert.deepEqual(
    result.report.alerts
      .filter((a) => a.key.startsWith("plan:"))
      .map((a) => a.key),
    [`plan:${RACE}`],
  );
  assert.ok((await items()).every((i) => i.race_id === "2026-10-16-09-11"));
  assert.equal((await items()).length, 2);
});

test("YouTube だけ mode=auto でも、自動は未実装と知らせる", async () => {
  await db.exec(
    "UPDATE sns_auto_send_control SET mode='auto' WHERE channel='youtube'",
  );
  const result = await run();
  assert.ok(
    result.report.alerts.some((a) => a.key === "auto_unimplemented:youtube"),
  );
  assert.ok(
    !result.report.alerts.some((a) => a.key === "auto_unimplemented:x"),
  );
});
