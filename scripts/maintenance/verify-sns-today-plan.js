// /today の画像つき X 投稿の計画（sns-pdca-loop tasks 19b、cron sns_auto_plan）の再現テスト。
// SQL158 までを PGlite に入れ（本番と同じ）、下書き・item の作成 → 本人の個別承認 → 送る直前の検査（一覧の版）までを通す。
// 一覧（morning_digest_*）・撮影・Storage はモック。外部接続なし。
import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { createXSnapshot } from "../../api/_lib/snsXSend.js";
import {
  createDeadlinePreflight,
  createMockHeadless,
} from "../../api/_lib/snsDeadlineQueue.js";
import { sendHolds } from "../../api/_lib/snsMobileApproval.js";
import { createReadCurrent } from "../../api/_lib/snsClaimCheck.js";
import { getJaT } from "../../api/_lib/botPage.js";
import { SCREEN_MARKERS } from "../lib/snsScreenMarkers.js";
import {
  TODAY_URL,
  createTodayStore,
  runTodayPlan,
  todaySchedule,
} from "../lib/snsTodayPlanner.js";

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
const DATE = "2026-10-17";
const at = (hhmm) => new Date(`${DATE}T${hhmm}:00+09:00`);
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
    DELETE FROM sns_post_tracking; DELETE FROM sns_mobile_reviews; DELETE FROM sns_x_send_jobs; DELETE FROM sns_auto_send_items;
    ALTER TABLE sns_drafts DISABLE TRIGGER USER; DELETE FROM sns_drafts; ALTER TABLE sns_drafts ENABLE TRIGGER USER;
    UPDATE test_clock SET value=NULL;`);
});
after(() => db.close());

// PostgREST の store と同じ契約を SQL で（URL の形は下の別のテストで確かめる）
const sqlStore = {
  async todayState(date) {
    return {
      draft:
        (await first(
          "SELECT * FROM sns_drafts WHERE send_lane='A' AND format='today_digest' AND source_data->'digest'->>'date'=$1 AND status<>'archived'",
          [date],
        )) ?? null,
      item:
        (await first(
          "SELECT * FROM sns_auto_send_items WHERE kind='digest' AND race_id=$1",
          [`today:${date}`],
        )) ?? null,
    };
  },
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
      `UPDATE sns_drafts SET caption_text=$2,cover_image_path=$3,source_data=$4,risk_flags=$5
       WHERE id=$1 AND status IN ('pending_review','approved') RETURNING *`,
      [
        id,
        p.caption_text,
        p.cover_image_path,
        p.source_data,
        JSON.stringify(p.risk_flags),
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
      "UPDATE sns_auto_send_items SET state=$3,checks=$4,held_reason=$5 WHERE id=$1 AND state=$2 RETURNING *",
      [id, from, p.state, p.checks, p.held_reason],
    );
    if (!row) throw new Error("item を更新できない");
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
const digestOf = (count = 25, reason = "1コースの逃げ切りの割合が高い") => ({
  day: {
    generated_at: `${DATE}T05:30:27Z`,
    venue_count: 13,
    race_count: 156,
    notes: {},
  },
  rows: [
    {
      section: "featured",
      rank: 1,
      race_id: `${DATE}-04-12`,
      venue_code: 4,
      race_number: 12,
      start_time: "16:20:00",
      reason,
    },
    ...Array.from({ length: count }, (_, i) => ({
      section: "nige",
      rank: i + 1,
      race_id: `${DATE}-04-${String((i % 12) + 1).padStart(2, "0")}`,
      venue_code: 4,
      race_number: (i % 12) + 1,
      start_time: "10:00:00",
    })),
  ],
});
function shooter({ fail = false } = {}) {
  const calls = [];
  return {
    calls,
    async screenshot(request) {
      calls.push(request);
      if (fail) throw new Error("screenshot_component_missing");
      return {
        finalUrl: request.url,
        png: PNG,
        visibleSelectors: request.requiredSelectors,
      };
    },
  };
}
async function plan({
  now = at("05:40"),
  mode = "live",
  digest = digestOf(),
  headless = shooter(),
  notes = [],
  saved = [],
} = {}) {
  return runTodayPlan(
    { mode, now: () => now },
    {
      store: sqlStore,
      getDigest: async (date) => {
        assert.equal(date, DATE);
        return digest;
      },
      t,
      headless,
      markers: SCREEN_MARKERS,
      riskRules,
      trackingStore,
      saveImage: async (path, bytes) => saved.push({ path, bytes }),
      signImage: async (path) => `https://signed/${path}`,
      notify: async (text) => notes.push(text),
    },
  );
}
const loadMedia = async () => PNG;
async function approve(draft) {
  const { r: revision } = await first(
    "SELECT sns_mobile_revision(d) r FROM sns_drafts d WHERE id=$1",
    [draft.id],
  );
  return (
    await first("SELECT approve_sns_mobile_channel($1,$2,$3,$4,$5,30) r", [
      draft.id,
      me,
      revision,
      await createXSnapshot(draft, loadMedia),
      draft.scheduled_at,
    ])
  ).r;
}

test("5:40 に一覧を撮って下書き・item（digest）を作り、本人が承認でき、7:45 に送る job ができる。送る直前の検査も通る", async () => {
  const notes = [];
  const saved = [];
  const headless = shooter();
  const result = await plan({ notes, saved, headless });
  const [draft] = await all("SELECT * FROM sns_drafts");
  const [item] = await all("SELECT * FROM sns_auto_send_items");
  assert.equal(result.report.items[0].outcome, "manual");
  assert.deepEqual(headless.calls, [
    { url: TODAY_URL, requiredSelectors: SCREEN_MARKERS.today },
  ]);
  assert.equal(
    saved[0].path,
    `today/${DATE}/${draft.source_data.digest.revision}.png`,
  );
  assert.equal(draft.cover_image_path, saved[0].path);
  assert.equal(draft.send_lane, "A");
  assert.equal(draft.publish_blocked, false);
  assert.match(
    draft.caption_text,
    /^本日のデータ一覧（10月17日（土）\u300013会場 156レース）/,
  );
  assert.match(draft.caption_text, /注目レース：平和島 12R（締切 16:20）/);
  assert.match(draft.caption_text, /逃げが堅い選手：25件/);
  assert.ok(
    draft.caption_text.endsWith(
      `${TODAY_URL}?utm_source=x&utm_medium=social&utm_campaign=today_digest&utm_content=${DATE}`,
    ),
  );
  assert.deepEqual(sendHolds(draft), []);
  assert.deepEqual(
    [
      item.kind,
      item.state,
      item.channel,
      item.race_id,
      item.draft_id,
      item.checks.passed,
    ],
    ["digest", "manual", "x", `today:${DATE}`, draft.id, true],
  );
  const when = todaySchedule(DATE);
  assert.equal(item.notify_by.toISOString(), when.notify_by);
  assert.equal(item.veto_until.toISOString(), when.veto_until);
  const tracking = await first(
    "SELECT * FROM sns_post_tracking WHERE draft_id=$1",
    [draft.id],
  );
  assert.deepEqual(
    [tracking.utm_campaign, tracking.utm_content],
    ["today_digest", DATE],
  );
  assert.equal(notes.length, 1);
  assert.match(notes[0], /7:45 までに個別承認の画面で承認/);
  assert.match(notes[0], /画像: https:\/\/signed\/today\//);
  // 本人の個別承認（140 の DB 側の条件も通る）→ 7:45 の job
  const job = await approve(draft);
  assert.equal(job.state, "queued");
  assert.equal(new Date(job.scheduled_at).toISOString(), when.scheduled_at);
  assert.equal(job.auto_item_id, item.id);
  // 送る直前の検査: 一覧の版を読み直して一致すれば通る（長文の1投稿の印つき）、変わっていれば止まる
  const readCurrent = (digest) =>
    createReadCurrent({
      db: async () => [
        { bundle_import_id: null, source_data: draft.source_data },
      ],
      getDigest: async () => digest,
    });
  const preflight = (digest) =>
    createDeadlinePreflight({
      headless: createMockHeadless({ visibleSelectors: SCREEN_MARKERS.today }),
      markers: SCREEN_MARKERS,
      readCurrent: readCurrent(digest),
      now: () => at("07:46").getTime(),
    });
  const sent = { ...job, snapshot_text: JSON.stringify(job.snapshot) };
  await preflight(digestOf())(sent);
  await assert.rejects(preflight(digestOf(24))(sent), /source_changed/);
});

test("同じ一覧でもう一度走らせても何も書かない。一覧がやり直されたら撮り直し、承認を外して知らせる", async () => {
  await plan();
  const [before] = await all("SELECT * FROM sns_drafts");
  const job = await approve(before);
  const notes = [];
  const again = await plan({ now: at("06:00"), notes });
  assert.equal(again.report.items[0].outcome, "unchanged");
  assert.equal(notes.length, 0);
  const rebuilt = await plan({ now: at("06:35"), digest: digestOf(24), notes });
  assert.equal(rebuilt.report.items[0].outcome, "rebuilt");
  const [after] = await all("SELECT * FROM sns_drafts");
  assert.equal(after.id, before.id);
  assert.notEqual(
    after.source_data.digest.revision,
    before.source_data.digest.revision,
  );
  assert.equal(
    after.source_data.deadline_queue.source_revision,
    after.source_data.digest.revision,
  );
  assert.match(after.caption_text, /逃げが堅い選手：24件/);
  assert.equal(after.status, "pending_review");
  assert.equal(
    (await first("SELECT state FROM sns_x_send_jobs WHERE id=$1", [job.id]))
      .state,
    "cancelled",
  );
  assert.match(notes[0], /承認し直して/);
  assert.equal(
    (await all("SELECT * FROM sns_auto_send_items"))[0].state,
    "manual",
  );
});

test("5:30 より前・7:45 以降・一覧が未公開は何もしない。shadow は撮らず書かない", async () => {
  for (const now of [at("05:29"), at("07:45")])
    assert.equal(
      (await plan({ now })).report.items[0].reason,
      "outside_window",
    );
  assert.equal(
    (await plan({ digest: { day: { generated_at: null }, rows: [] } })).report
      .items[0].reason,
    "not_generated",
  );
  const headless = shooter();
  const notes = [];
  const shadow = await plan({ mode: "shadow", headless, notes });
  assert.equal(shadow.report.items[0].outcome, "manual");
  assert.equal(headless.calls.length, 0);
  assert.equal(notes.length, 0);
  assert.equal((await all("SELECT * FROM sns_drafts")).length, 0);
});

test("撮れなければ何も書かずに投げる（次の5分でやり直す）", async () => {
  const saved = [];
  await assert.rejects(
    plan({ headless: shooter({ fail: true }), saved }),
    /screenshot_component_missing/,
  );
  assert.equal(saved.length, 0);
  assert.equal((await all("SELECT * FROM sns_drafts")).length, 0);
  assert.equal((await all("SELECT * FROM sns_auto_send_items")).length, 0);
});

test("本文に禁止表現があれば held_manual。その後に一覧が変わっても作り直さない", async () => {
  const notes = [];
  await plan({ digest: digestOf(25, "競艇の1コース"), notes });
  const [item] = await all("SELECT * FROM sns_auto_send_items");
  assert.equal(item.state, "held_manual");
  assert.match(item.held_reason, /禁止表現/);
  assert.match(notes[0], /禁止表現があり、止めた/);
  const again = await plan({
    now: at("06:35"),
    digest: digestOf(24, "競艇の1コース"),
  });
  assert.equal(again.report.items[0].reason, "item_held_manual");
});

test("PostgREST の store: 今日の下書き・item の引き方、承認済みも書き換える条件、失敗は投げる", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({
      url: decodeURIComponent(String(url)),
      method: options.method ?? "GET",
    });
    if (String(url).includes("fail")) return new Response("", { status: 500 });
    if (options.method === "PATCH" && String(url).includes("none"))
      return new Response("[]");
    return new Response(JSON.stringify([{ id: "1" }]));
  };
  const store = createTodayStore({ url: "https://db", key: "k", fetchImpl });
  await store.todayState(DATE);
  assert.ok(
    calls.some((c) =>
      c.url.includes(
        `sns_drafts?send_lane=eq.A&format=eq.today_digest&source_data->digest->>date=eq.${DATE}`,
      ),
    ),
  );
  assert.ok(
    calls.some((c) =>
      c.url.includes(
        `sns_auto_send_items?kind=eq.digest&race_id=eq.today:${DATE}`,
      ),
    ),
  );
  await store.updateTodayDraft("d1", {});
  assert.ok(
    calls
      .at(-1)
      .url.endsWith("sns_drafts?id=eq.d1&status=in.(pending_review,approved)"),
  );
  await assert.rejects(store.updateTodayDraft("none", {}), /書き換えられない/);
  await assert.rejects(
    createTodayStore({ url: "https://fail", key: "k", fetchImpl }).todayState(
      DATE,
    ),
    /HTTP 500/,
  );
});

test("vercel.json: sns-auto-plan の関数に /today の文言（ja の common.json）を同梱する", async () => {
  const vercel = JSON.parse(
    await readFile(new URL("../../vercel.json", import.meta.url), "utf8"),
  );
  assert.match(
    vercel.functions["api/cron/sns-auto-plan.js"].includeFiles,
    /src\/locales\/ja\/common\.json/,
  );
});

test("承認の画面の指摘: /today の本文（加重で280超え）は、長文の1投稿として指摘しない", async () => {
  const { inspectDraft } = await import("../../api/_lib/snsEditAssist.js");
  await plan();
  const [draft] = await all("SELECT * FROM sns_drafts");
  const long = { ...draft, caption_text: draft.caption_text + "あ".repeat(200) };
  assert.equal(
    inspectDraft(long, []).find((f) => f.rule === "x-weighted-length"),
    undefined,
  );
});

test("runbook の L2 の SQL（153-runbook.md）を流すと、承認した /today の job が 7:45 に claim まで進む。dry_run の間は claim しない", async () => {
  const runbook = await readFile(new URL("../../docs/db-migration/153-runbook.md", import.meta.url), "utf8");
  const sql = runbook
    .split("<!-- l2-today-sql:start -->")[1]
    .split("<!-- l2-today-sql:end -->")[0]
    .replace(/```sql|```/g, "");
  await db.exec("UPDATE sns_x_send_control SET period_start=NULL, period_end=NULL, reserved_microusd=0, paused=true");
  // 本番の SQL の now() は、この日の 5:40（計画）→ 7:46（送る）の時計で流す
  await db.query("UPDATE test_clock SET value=$1", [at("05:40")]);
  await db.exec(sql.replaceAll("now()", "test_now()"));
  await plan({ now: at("05:40") });
  const [draft] = await all("SELECT * FROM sns_drafts");
  const job = await approve(draft);
  // 試運転（dry_run=true）の間は claim しない
  await db.exec("UPDATE sns_auto_send_control SET dry_run=true WHERE channel='x'");
  await assert.rejects(
    first("SELECT transition_sns_x_send($1,'claim','{}') r", [job.id]),
    /dry_run/,
  );
  // 手順2（dry_run=false）の後は、7:45 を過ぎたら claim できる
  await db.query("UPDATE test_clock SET value=$1", [at("07:46")]);
  await db.exec("UPDATE sns_auto_send_control SET dry_run=false WHERE channel='x'");
  const claimed = (await first("SELECT transition_sns_x_send($1,'claim','{}') r", [job.id])).r;
  assert.equal(claimed.state, "sending", JSON.stringify(claimed));
});

test("下書きを作った後に item の作成で落ちても、次の実行で item を作る（同じ版でも「変化なし」で止まらない）", async () => {
  const insertItem = sqlStore.insertItem;
  sqlStore.insertItem = async () => {
    throw new Error("item を作れない");
  };
  await assert.rejects(plan(), /item を作れない/);
  sqlStore.insertItem = insertItem;
  assert.equal((await all("SELECT * FROM sns_drafts")).length, 1);
  assert.equal((await all("SELECT * FROM sns_auto_send_items")).length, 0);
  const again = await plan({ now: at("05:45") });
  assert.equal(again.report.items[0].outcome, "manual");
  const [item] = await all("SELECT * FROM sns_auto_send_items");
  assert.equal(item.state, "manual");
  assert.equal((await all("SELECT * FROM sns_drafts")).length, 1);
});
