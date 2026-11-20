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
import { DATE, v3RaceDb } from "./verifyData/sns-today-plan-v3-race-db.js";
import { TODAY_NOTICE, TODAY_URL, runTodayPlan, todaySchedule } from "../lib/snsTodayPlanner.js";

import {
  loadTodayVariants,
  normalizeTodayExperiment,
  pickExperimentSide,
} from "../lib/snsTodayVariants.js";
import {
  digestOf,
  FEATURED_LINE,
  raceDbOf,
  runSnsTodayPlanScenes1,
  runSnsTodayPlanScenes2,
  runSnsTodayPlanScenes3,
  runSnsTodayPlanScenes4,
} from "./verifyData/sns-today-plan-scenes-1.js";
import {
  TYPE_VARIANTS,
  linkAt,
  runSnsTodayPlanScenes7,
  runSnsTodayPlanScenes8,
  runSnsTodayPlanScenes9,
  runSnsTodayPlanScenes10,
} from "./verifyData/sns-today-plan-scenes-3.js";
import { runSnsTodayPlanScenes5, runSnsTodayPlanScenes6 } from "./verifyData/sns-today-plan-scenes-2.js";
import { runSnsTodayPlanScenes11, runSnsTodayPlanScenes12 } from "./verifyData/sns-today-plan-scenes-4.js";
import { runSnsTodayPlanScenes13, runSnsTodayPlanScenes14 } from "./verifyData/sns-today-plan-scenes-5.js";
import { runSnsTodayPlanScenes15, runSnsTodayPlanScenes16 } from "./verifyData/sns-today-plan-scenes-6.js";
import { runSnsTodayPlanScenes17 } from "./verifyData/sns-today-plan-scenes-7.js";

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
  me = (await first("SELECT id FROM sns_approvers WHERE display_name='本人'"))
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
      me,
      await createXSnapshot(draft, loadMedia),
      draft.scheduled_at,
    ])
  ).r;
}

test("6:40 に一覧を撮って下書き・item（digest）を作り、本人が承認でき、7:00 に送る job ができる。送る直前の検査も通る", async () => {
  const notes = [];
  const saved = [];
  const headless = shooter();
  const result = await plan({ notes, saved, headless });
  const [draft] = await all("SELECT * FROM sns_drafts");
  const [item] = await all("SELECT * FROM sns_auto_send_items");
  assert.equal(result.report.items[0].outcome, "manual");
  assert.deepEqual(headless.inspects, [
    {
      url: TODAY_URL,
      context: { storageState: null },
      requiredSelectors: SCREEN_MARKERS.today,
    },
  ]);
  // 画像: 注目レース＋一覧の締切順、同じレースは1回、最大4枚の龍神ソナーの図（会場R 締切のラベルつき）
  assert.deepEqual(
    headless.calls.map((c) => [c.url, c.element, c.label]),
    [
      [
        `https://www.boat-ai.jp/race/${DATE}-04-12?tab=sonar&boat=1`,
        ".af-hep .af-dark",
        "平和島12R 20:35締切",
      ],
      [
        `https://www.boat-ai.jp/race/${DATE}-02-05?tab=sonar&boat=3`,
        ".af-hep .af-dark",
        "戸田5R 13:15締切",
      ],
      [
        `https://www.boat-ai.jp/race/${DATE}-04-03?tab=sonar&boat=1`,
        ".af-hep .af-dark",
        "平和島3R 14:15締切",
      ],
      [
        `https://www.boat-ai.jp/race/${DATE}-04-05?tab=sonar&boat=1`,
        ".af-hep .af-dark",
        "平和島5R 15:15締切",
      ],
    ],
  );
  // 図の前に待つのは条件のカードだけ（段の表示は展示の後に消える、2026-10-17 夜）
  assert.ok(
    headless.calls.every(
      (c) =>
        JSON.stringify(c.requiredSelectors) ===
        JSON.stringify(['[data-testid="analogy-fact-card"]']),
    ),
  );
  const revision = draft.source_data.digest.revision;
  assert.deepEqual(
    saved.map((x) => x.path),
    [1, 2, 3, 4].map((i) => `today/${DATE}/${revision}-${i}.png`),
  );
  assert.deepEqual(
    draft.source_data.image_paths,
    saved.map((x) => x.path),
  );
  assert.equal(draft.cover_image_path, saved[0].path);
  assert.equal(draft.send_lane, "A");
  assert.equal(draft.publish_blocked, false);
  assert.match(
    draft.caption_text,
    /^本日のデータ一覧（10月17日（土）\u300013会場 156レース）/,
  );
  assert.ok(
    draft.caption_text.includes(
      `）\n\n今日の一覧はこちら：https://www.boat-ai.jp/x/today?d=2037-10-17-a\n\n${FEATURED_LINE}\n\n${EXPECTED_LINES}\n\n過去の実績は当日の結果を保証しません。展示後は進入と展示タイムも確認してください。`,
    ),
    draft.caption_text,
  );
  for (const absent of [
    "イン崩れ",
    "AI",
    "逃がし",
    "フライング",
    "帰郷",
    "逃げ 1｜",
    "逃げ 4｜",
    "まくり 2｜",
    "まくり 4｜",
  ])
    assert.ok(!draft.caption_text.includes(absent), absent);
  assert.deepEqual(
    draft.source_data.digest.picks.map((p) => p.race_id),
    [
      `${DATE}-04-12`,
      `${DATE}-02-05`,
      `${DATE}-04-03`,
      `${DATE}-04-05`,
      `${DATE}-04-02`,
      `${DATE}-02-07`,
    ],
  );
  // リンクは見出しの直後（3行目）に1回だけ。末尾は注意書き（2026-10-22 オーナー「前倒しで押される形」）
  // utm_content は「日付-札」（実際に送った型、hq §10-5）
  const todayUrl = `https://www.boat-ai.jp/x/today?d=${DATE}-a`;
  const captionLines = draft.caption_text.split("\n");
  assert.equal(captionLines[1], "");
  assert.equal(captionLines[2], `今日の一覧はこちら：${todayUrl}`);
  assert.equal(captionLines[3], "");
  assert.equal(draft.caption_text.split(todayUrl).length, 2);
  assert.ok(draft.caption_text.endsWith(TODAY_NOTICE));
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
    ["today_digest", `${DATE}-a`],
  );
  assert.equal(
    tracking.tracking_url,
    `${TODAY_URL}?utm_source=x&utm_medium=social&utm_campaign=today_digest&utm_content=${DATE}-a`,
  );
  assert.equal(tracking.utm_source, "x");
  assert.equal(tracking.utm_medium, "social");
  assert.ok(!draft.caption_text.includes("utm_"));
  assert.equal(notes.length, 1);
  // 個別承認の画面は 2026-10-18 に撤去した。manual のときは送らないと知らせる
  assert.match(notes[0], /個別承認（mode=manual）なので送らない/);
  assert.match(
    notes[0],
    /画像1: https:\/\/signed\/today\/[^\n]+-1\.png\n画像2: [^\n]+\n画像3: [^\n]+\n画像4: [^\n]+-4\.png/,
  );
  // 本人の承認 → 7:45 の job
  const job = await approve(draft);
  assert.equal(job.state, "queued");
  assert.equal(new Date(job.scheduled_at).toISOString(), when.scheduled_at);
  assert.equal(job.auto_item_id, item.id);
  // 送る直前の検査: 一覧の版を読み直して一致すれば通る（長文の1投稿の印つき）、変わっていれば止まる
  const readCurrent = (digest, races = raceDbOf()) =>
    createReadCurrent({
      db: async (path) =>
        path.startsWith("sns_drafts")
          ? [{ bundle_import_id: null, source_data: draft.source_data }]
          : races(path),
      getDigest: async () => digest,
    });
  const preflight = (digest, races) =>
    createDeadlinePreflight({
      headless: createMockHeadless({ visibleSelectors: SCREEN_MARKERS.today }),
      markers: SCREEN_MARKERS,
      readCurrent: readCurrent(digest, races),
      now: () => at("07:01").getTime(),
    });
  const sent = { ...job, snapshot_text: JSON.stringify(job.snapshot) };
  await preflight(digestOf())(sent);
  await assert.rejects(preflight(digestOf(24))(sent), /source_changed/);
  // 載せた候補が送る前に欠場・中止になったら、その朝の投稿は送らない
  for (const races of [
    raceDbOf({ absent: [`${DATE}-04-03:1`] }),
    raceDbOf({ cancelled: [`${DATE}-02-07`] }),
  ])
    await assert.rejects(
      preflight(digestOf(), races)(sent),
      /race_unconfirmed_or_withdrawn/,
    );
});

// ---- 後半の場面（verifyData/sns-today-plan-scenes-1.js） ----
runSnsTodayPlanScenes3({ first, all, at, sqlStore, shooter, plan, approve });

test("vercel.json: sns-auto-plan の関数に /today の文言（ja の common.json）を同梱する", async () => {
  const vercel = JSON.parse(
    await readFile(new URL("../../vercel.json", import.meta.url), "utf8"),
  );
  assert.match(
    vercel.functions["api/cron/sns-auto-plan.js"].includeFiles,
    /src\/locales\/ja\/common\.json/,
  );
});

test("runbook の L2 の SQL（153-runbook.md）を流すと、承認した /today の job が 7:01 に claim まで進む。dry_run の間は claim しない", async () => {
  const runbook = await readFile(
    new URL("../../docs/db-migration/153-runbook.md", import.meta.url),
    "utf8",
  );
  const sql = runbook
    .split("<!-- l2-today-sql:start -->")[1]
    .split("<!-- l2-today-sql:end -->")[0]
    .replace(/```sql|```/g, "");
  await db.exec(
    "UPDATE sns_x_send_control SET period_start=NULL, period_end=NULL, reserved_microusd=0, paused=true",
  );
  // 本番の SQL の now() は、この日の 5:40（計画）→ 7:46（送る）の時計で流す
  await db.query("UPDATE test_clock SET value=$1", [at("06:40")]);
  await db.exec(sql.replaceAll("now()", "test_now()"));
  // runbook の期間（2026-10）は、テストの日付（2037 年。実際の時計で期限を判定する部品があるため未来に置く）に合わせて動かす
  await db.exec(
    "UPDATE sns_x_send_control SET period_start = test_now() - interval '1 day', period_end = test_now() + interval '30 days'",
  );
  await plan({ now: at("06:40") });
  const [draft] = await all("SELECT * FROM sns_drafts");
  const job = await approve(draft);
  // 試運転（dry_run=true）の間は claim しない
  await db.exec(
    "UPDATE sns_auto_send_control SET dry_run=true WHERE channel='x'",
  );
  await assert.rejects(
    first("SELECT transition_sns_x_send($1,'claim','{}') r", [job.id]),
    /dry_run/,
  );
  // 手順2（dry_run=false）の後は、7:45 を過ぎたら claim できる
  await db.query("UPDATE test_clock SET value=$1", [at("07:01")]);
  await db.exec(
    "UPDATE sns_auto_send_control SET dry_run=false WHERE channel='x'",
  );
  const claimed = (
    await first("SELECT transition_sns_x_send($1,'claim','{}') r", [job.id])
  ).r;
  assert.equal(claimed.state, "sending", JSON.stringify(claimed));
});

// ---- 後半の場面（verifyData/sns-today-plan-scenes-1.js・sns-today-plan-scenes-2.js） ----
runSnsTodayPlanScenes4({ first, all, at, sqlStore, shooter, plan, approve });
runSnsTodayPlanScenes5({ db, all, t, at, shooter, plan, approve });

test("160: X の画像は image_paths の数・順・種類とそろったときだけ承認できる。image_paths の無い下書きは今までどおり1つ", async () => {
  await plan();
  const [draft] = await all("SELECT * FROM sns_drafts");
  const snapshot = await createXSnapshot(draft, loadMedia);
  assert.equal(snapshot.media.length, 4);
  const tryApprove = (snap) =>
    db.query("SELECT approve_sns_x_send($1,$2,$3,NULL)", [draft.id, me, snap]);
  for (const [bad, why] of [
    [
      { ...snapshot, media: snapshot.media.slice(0, 3) },
      /画像の数・並びが不正です/,
    ],
    [
      {
        ...snapshot,
        media: [
          snapshot.media[1],
          snapshot.media[0],
          ...snapshot.media.slice(2),
        ],
      },
      /媒体のhash・サイズが不正です/,
    ],
    [
      {
        ...snapshot,
        media: snapshot.media.map((m, i) =>
          i === 2 ? { ...m, type: "video/mp4" } : m,
        ),
      },
      /媒体のhash・サイズが不正です/,
    ],
    [
      {
        ...snapshot,
        media: snapshot.media.map((m, i) =>
          i === 3 ? { ...m, size: 6_000_000 } : m,
        ),
      },
      /媒体のhash・サイズが不正です/,
    ],
  ])
    await assert.rejects(tryApprove(bad), why);
  // 5枚は作れない（image_paths が4枚を超える下書きは承認しない）
  await db.exec(
    "ALTER TABLE sns_drafts DISABLE TRIGGER USER; UPDATE sns_drafts SET source_data = jsonb_set(source_data, '{image_paths}', (source_data->'image_paths') || '[\"x/5.png\"]'::jsonb) WHERE id=$1; ALTER TABLE sns_drafts ENABLE TRIGGER USER;".replaceAll(
      "$1",
      `'${draft.id}'`,
    ),
  );
  await assert.rejects(tryApprove(snapshot), /画像の数・並びが不正です/);
  // image_paths の無い X の下書き（今までの1枚）は、今までどおり承認できる
  await db.exec(
    "ALTER TABLE sns_drafts DISABLE TRIGGER USER; UPDATE sns_drafts SET source_data = source_data - 'image_paths'; ALTER TABLE sns_drafts ENABLE TRIGGER USER;",
  );
  const [single] = await all("SELECT * FROM sns_drafts");
  const one = await createXSnapshot(single, loadMedia);
  assert.equal(one.media.length, 1);
  const job = (
    await first("SELECT approve_sns_x_send($1,$2,$3,NULL) r", [
      single.id,
      me,
      one,
    ])
  ).r;
  assert.equal(job.state, "queued");
});

// ---- 後半の場面（verifyData/sns-today-plan-scenes-2.js・sns-today-plan-scenes-3.js） ----
runSnsTodayPlanScenes6({ db, all, t, at, shooter, plan, approve });
runSnsTodayPlanScenes7({ db, first, all, at, trackingStore, shooter, plan });

test("171: /today の見出しの2案の行を入れる。もう一度当てても増えない。入れた後は案の uuid で tracking・下書きに札が入る", async () => {
  const sql = await readFile(
    new URL(
      "../../docs/db-migration/171_sns_today_heading_variants.sql",
      import.meta.url,
    ),
    "utf8",
  );
  // 本番の sns_template_variants は 039 で created_by を足している（この試験の土台は 039 を当てていない）
  await db.exec(
    "ALTER TABLE sns_template_variants ADD COLUMN IF NOT EXISTS created_by VARCHAR(10) NOT NULL DEFAULT 'human'",
  );
  await db.exec(
    "DELETE FROM sns_post_tracking; DELETE FROM sns_template_variants WHERE format='today_digest'",
  );
  // 同じ名前で別の id の行が先にあると、黙って成功せず全体を戻す（代わりの審査の P3）
  await db.exec(
    "INSERT INTO sns_template_variants(id, format, variant_name, composition_name) VALUES('11111111-1111-4111-8111-111111111111','today_digest','today-heading-a','X')",
  );
  await assert.rejects(db.exec(sql), /既存の行が食い違う/);
  // ファイルの BEGIN の中で落ちたので、psql と同じく戻す（db-apply は接続を閉じてトランザクション全体が戻る）
  await db.exec("ROLLBACK");
  await db.exec(
    "DELETE FROM sns_template_variants WHERE format='today_digest'",
  );
  await db.exec(sql);
  await db.exec(sql);
  const rows = await all(
    "SELECT id, variant_name, active FROM sns_template_variants WHERE format='today_digest' ORDER BY variant_name",
  );
  assert.deepEqual(
    rows.map((r) => [r.id, r.variant_name, r.active]),
    [
      ["0f88824e-c630-4f94-8c15-475297e4b242", "today-heading-a", true],
      ["be74c247-fa8f-442e-a29f-4d1d7866919a", "today-heading-b", true],
    ],
  );
  // 入れた後に config の uuid を入れると、札が tracking・下書きに入る
  const variants = {
    default: "本日のデータ一覧（{date}）",
    variants: [
      { id: "a", uuid: rows[0].id, heading: "本日のデータ一覧（{date}）" },
      { id: "b", uuid: rows[1].id, heading: "本日のデータ一覧（{date}）" },
    ],
  };
  await plan({ loadVariants: () => variants });
  const draft = await first("SELECT * FROM sns_drafts");
  assert.ok(rows.some((r) => r.id === draft.template_variant_id));
  // リポジトリの config の案 a・b の uuid は、171 が入れた行の id と同じ（2026-10-20 に本番へ適用済み）
  const config = JSON.parse(
    await readFile(
      new URL("../../config/today-variants.json", import.meta.url),
      "utf8",
    ),
  );
  // b は型 b（course_win、2026-10-27）に替えたので、見出しの案 b の行（171）の札は付けない（別の中身に同じ札を付けない）
  assert.deepEqual(
    config.variants.map((v) => [v.id, v.uuid]),
    [
      ["a", rows[0].id],
      ["b", null],
    ],
  );
});

// ---- 後半の場面（verifyData/sns-today-plan-scenes-3.js） ----
runSnsTodayPlanScenes8({ db, first, all, at, trackingStore, shooter, plan });
const putType = (day, typeId, post) =>
  db.query(
    "INSERT INTO sns_today_type_schedule(day, type_id, post) VALUES($1,$2,$3)",
    [day, typeId, post],
  );

// ---- 後半の場面（verifyData/sns-today-plan-scenes-3.js） ----
runSnsTodayPlanScenes9({ db, first, all, at, trackingStore, shooter, plan, putType });
const withAuto = async (fn) => {
  await db.exec(
    "UPDATE sns_auto_send_control SET mode='auto' WHERE channel='x'",
  );
  try {
    await fn();
  } finally {
    await db.exec(
      "UPDATE sns_auto_send_control SET mode='manual' WHERE channel='x'",
    );
  }
};

// ---- 後半の場面（verifyData/sns-today-plan-scenes-3.js・sns-today-plan-scenes-4.js） ----
runSnsTodayPlanScenes10({ db, first, all, at, trackingStore, shooter, plan, putType });
runSnsTodayPlanScenes11({ db, first, all, at, sqlStore, plan, putType, withAuto });

test("返信（link_position=reply、mode=auto）: 本文にリンクを置かず、リンクだけの子の下書き・item を作り、親の job につないで自動で承認する。子は親の公開の後に選ばれる", async () => {
  await putType(DATE, "t01-link-in-reply", {
    heading: "本日のデータ一覧（{date}）",
    link_position: "reply",
  });
  await withAuto(async () => {
    const notes = [];
    const result = await plan({ notes, loadVariants: () => TYPE_VARIANTS });
    assert.equal(result.report.items[0].outcome, "notified");
    const state = await sqlStore.todayState(DATE);
    const { draft: parent, item } = state;
    const { draft: child, item: childItem } = state.reply;
    assert.equal(linkAt(parent.caption_text), -1);
    assert.ok(!parent.caption_text.includes("今日の一覧はこちら"));
    assert.equal(
      child.caption_text,
      `今日の一覧はこちら：https://www.boat-ai.jp/x/today?d=${DATE}-a`,
    );
    assert.equal(child.source_data.today_reply.parent_draft_id, parent.id);
    assert.equal(child.source_data.image_paths, undefined);
    assert.equal(child.cover_image_path, null);
    assert.equal(child.source_data.content_type.id, "t01-link-in-reply");
    assert.equal(child.publish_blocked, false);
    assert.equal(result.report.items[0].reply_draft_id, child.id);
    assert.deepEqual([item.state, childItem.state], ["notified", "notified"]);
    assert.equal(childItem.race_id, `today:${DATE}:reply`);
    const parentJob = await first(
      "SELECT * FROM sns_x_send_jobs WHERE draft_id=$1",
      [parent.id],
    );
    const childJob = await first(
      "SELECT * FROM sns_x_send_jobs WHERE draft_id=$1",
      [child.id],
    );
    assert.equal(childJob.parent_job_id, parentJob.id);
    assert.equal(childJob.auto_item_id, childItem.id);
    assert.equal(
      childJob.scheduled_at.toISOString(),
      parentJob.scheduled_at.toISOString(),
    );
    assert.ok(
      notes.some((n) => n.includes("（自分への返信）今日の一覧はこちら：")),
    );
    // 送信の runner は親が posted の子だけを選ぶ
    const { pickDueJobs } = await import("../lib/snsSendRunner.js");
    assert.deepEqual(
      pickDueJobs([parentJob, childJob], [parentJob]).map((j) => j.id),
      [parentJob.id],
    );
    assert.deepEqual(
      pickDueJobs(
        [childJob],
        [{ ...parentJob, state: "posted", external_post_id: "123" }],
      ).map((j) => j.id),
      [childJob.id],
    );
    // 子の送る直前の検査（一覧の版の読み直し）は親と同じに通る
    const sent = {
      ...childJob,
      snapshot_text: JSON.stringify(childJob.snapshot),
    };
    await createDeadlinePreflight({
      headless: createMockHeadless({ visibleSelectors: SCREEN_MARKERS.today }),
      markers: SCREEN_MARKERS,
      readCurrent: createReadCurrent({
        db: async (path) =>
          path.startsWith("sns_drafts")
            ? [{ bundle_import_id: null, source_data: child.source_data }]
            : raceDbOf()(path),
        getDigest: async () => digestOf(),
      }),
      now: () => at("07:01").getTime(),
    })(sent);
    // 同じ版でもう一度走らせても何も書かない
    const again = await plan({
      now: at("06:50"),
      loadVariants: () => TYPE_VARIANTS,
    });
    assert.equal(again.report.items[0].outcome, "unchanged");
    // 一覧がやり直されたら、親も子も作り直して、同じ親の job につなぎ直す
    const rebuilt = await plan({
      now: at("06:55"),
      digest: digestOf(24),
      loadVariants: () => TYPE_VARIANTS,
    });
    assert.equal(rebuilt.report.items[0].outcome, "rebuilt");
    const child2 = await first("SELECT * FROM sns_drafts WHERE id=$1", [
      child.id,
    ]);
    assert.equal(child2.status, "approved");
    assert.equal(
      child2.source_data.digest.revision,
      rebuilt.report.items[0].revision,
    );
    const childJob2 = await first(
      "SELECT * FROM sns_x_send_jobs WHERE draft_id=$1",
      [child.id],
    );
    assert.equal(childJob2.state, "queued");
    assert.equal(childJob2.parent_job_id, parentJob.id);
    assert.equal((await all("SELECT * FROM sns_drafts")).length, 2);
  });
});

// ---- 後半の場面（verifyData/sns-today-plan-scenes-4.js） ----
runSnsTodayPlanScenes12({ db, first, all, at, sqlStore, plan, putType, withAuto });
test("返信: 送信の側（158・153 の transition）で、親の claim → 公開 → 子の claim が通る。子の予約も URL つきの額（system-architect の審査 P2-4）", async () => {
  const runbook = await readFile(
    new URL("../../docs/db-migration/153-runbook.md", import.meta.url),
    "utf8",
  );
  const sql = runbook
    .split("<!-- l2-today-sql:start -->")[1]
    .split("<!-- l2-today-sql:end -->")[0]
    .replace(/```sql|```/g, "");
  await db.exec(
    "UPDATE sns_x_send_control SET period_start=NULL, period_end=NULL, reserved_microusd=0, paused=true",
  );
  await db.query("UPDATE test_clock SET value=$1", [at("06:40")]);
  await db.exec(sql.replaceAll("now()", "test_now()"));
  await db.exec(
    "UPDATE sns_x_send_control SET period_start = test_now() - interval '1 day', period_end = test_now() + interval '30 days', daily_limit_x = 2",
  );
  await putType(DATE, "t01-link-in-reply", {
    heading: "本日のデータ一覧（{date}）",
    link_position: "reply",
  });
  await withAuto(async () => {
    await db.exec(
      "UPDATE sns_auto_send_control SET dry_run=false WHERE channel='x'",
    );
    try {
      await plan({ loadVariants: () => TYPE_VARIANTS });
      const state = await sqlStore.todayState(DATE);
      const parentJob = await first(
        "SELECT * FROM sns_x_send_jobs WHERE draft_id=$1",
        [state.draft.id],
      );
      const childJob = await first(
        "SELECT * FROM sns_x_send_jobs WHERE draft_id=$1",
        [state.reply.draft.id],
      );
      await db.query("UPDATE test_clock SET value=$1", [at("07:01")]);
      const claim = async (id) =>
        (await first("SELECT transition_sns_x_send($1,'claim','{}') r", [id]))
          .r;
      const parent = await claim(parentJob.id);
      assert.equal(parent.state, "sending", JSON.stringify(parent));
      await first("SELECT transition_sns_x_send($1,'begin_post','{}') r", [
        parentJob.id,
      ]);
      const done = (
        await first("SELECT transition_sns_x_send($1,'complete',$2) r", [
          parentJob.id,
          { id: "1234567890", posted_at: at("07:01").toISOString() },
        ])
      ).r;
      assert.equal(done.state, "posted", JSON.stringify(done));
      const child = await claim(childJob.id);
      assert.equal(child.state, "sending", JSON.stringify(child));
      // 子の予約も URL つきの額（thread_index=0）。親子で2本分
      const control = await first(
        "SELECT reserved_microusd::bigint r FROM sns_x_send_control",
      );
      assert.equal(Number(control.r), 500000);
    } finally {
      await db.exec(
        "UPDATE sns_auto_send_control SET dry_run=true WHERE channel='x'",
      );
    }
  });
});

// ---- 後半の場面（verifyData/sns-today-plan-scenes-5.js） ----
runSnsTodayPlanScenes13({ db, first, PNG, at, sqlStore, shooter, plan, putType, withAuto, abVariants });
/** DATE が型 b の日になる比べの設定（組の1日目か2日目かは乱数で決まるので、b になる方を選ぶ） */
function abVariants() {
  const base = {
    default: "本日のデータ一覧（{date}）",
    variants: [
      {
        id: "a",
        uuid: null,
        type_id: "today-a",
        heading: "本日のデータ一覧（{date}）",
      },
      {
        id: "b",
        uuid: null,
        type_id: "today-b-course-win",
        body: "course_win",
        heading: "【今日の注目データ】{date}",
      },
    ],
  };
  for (const start of [DATE, "2037-10-16"]) {
    const experiment = { id: "t-ab", start, pairs: 10, seed: "verify" };
    if (
      pickExperimentSide(normalizeTodayExperiment(experiment), DATE).side ===
      "b"
    )
      return { ...base, experiment };
  }
  throw new Error("b の日を作れない");
}

// ---- 後半の場面（verifyData/sns-today-plan-scenes-5.js・sns-today-plan-scenes-6.js） ----
runSnsTodayPlanScenes14({ db, first, PNG, at, sqlStore, shooter, plan, putType, withAuto, abVariants });
runSnsTodayPlanScenes15({ db, first, all, at, plan, abVariants });

// ---------- 型 v3「今日はこれだけ」（BOA-1314、オーナー 2026-11-04 承認） ----------
// 読み取りの模型 v3RaceDb は verifyData/sns-today-plan-v3-race-db.js

test("型 v3: リポジトリの config で 6:40 に文だけの下書きを作る（画像なし・撮影なし）。札は c、UTM は日付-c、承認すると 7:00 の job、送る直前の検査も通る", async () => {
  const notes = [];
  const headless = shooter();
  const saved = [];
  const result = await plan({
    notes,
    headless,
    saved,
    raceDb: v3RaceDb(),
    loadVariants: loadTodayVariants,
  });
  assert.equal(result.report.items[0].outcome, "manual");
  assert.equal(result.report.items[0].content_type, "today-c-digest");
  const draft = await first("SELECT * FROM sns_drafts");
  const lines = draft.caption_text.split("\n");
  assert.deepEqual(lines.slice(0, 3), [
    "10月17日（土）今日のボートレース 2場",
    "🏆 優勝戦 丸亀12R 20:15締切",
    `全レースの一覧 → https://www.boat-ai.jp/x/today?d=${DATE}-c`,
  ]);
  assert.match(
    draft.caption_text,
    /【逃げ率が高い選手】\n選手 241 A1\u300083%（50走）\n▶ 戸田4R 1号艇 12:02締切/,
  );
  assert.match(
    draft.caption_text,
    /【逃し率が高い選手】\n選手 262 A1\u300070%（40走）\n▶ 戸田6R 2号艇 14:02締切/,
  );
  assert.match(draft.caption_text, /▶ 戸田7R 4号艇 15:02締切/);
  assert.ok(draft.caption_text.endsWith("#ボートレース"));
  // 画像は無い（撮らない・保存しない・image_paths を持たない）。/today の表示の確認だけはする
  assert.equal(headless.calls.length, 0);
  assert.equal(headless.inspects.length, 1);
  assert.equal(saved.length, 0);
  assert.equal(draft.cover_image_path, null);
  assert.equal("image_paths" in draft.source_data, false);
  assert.deepEqual(
    [
      draft.source_data.content_type.id,
      draft.source_data.content_type.sent,
      draft.source_data.content_type.body,
      draft.source_data.today_variant.id,
    ],
    ["today-c-digest", "c", "digest_v3", "c"],
  );
  assert.equal(draft.source_data.digest_v3.send_at, "07:00");
  assert.deepEqual(draft.source_data.digest_v3.featured, {
    race_id: `${DATE}-15-12`,
    boat_number: null,
  });
  assert.equal(draft.source_data.deadline_queue.thread_length, 1);
  assert.equal(draft.scheduled_at.toISOString(), at("07:00").toISOString());
  const tracking = await first(
    "SELECT * FROM sns_post_tracking WHERE draft_id=$1",
    [draft.id],
  );
  assert.equal(tracking.utm_content, `${DATE}-c`);
  assert.equal(tracking.template_variant_id, null);
  assert.doesNotMatch(notes[0], /画像1:/);
  // 本人の承認（本文だけ）→ 7:00 の job。送る直前の検査は一覧の版と欠場・中止の読み直しで通る
  const job = await approve(draft);
  assert.equal(job.state, "queued");
  assert.equal(job.snapshot.media.length, 0);
  assert.equal(
    new Date(job.scheduled_at).toISOString(),
    at("07:00").toISOString(),
  );
  const preflight = (races) =>
    createDeadlinePreflight({
      headless: createMockHeadless({ visibleSelectors: SCREEN_MARKERS.today }),
      markers: SCREEN_MARKERS,
      readCurrent: createReadCurrent({
        db: async (path) =>
          path.startsWith("sns_drafts")
            ? [{ bundle_import_id: null, source_data: draft.source_data }]
            : races(path),
        getDigest: async () => digestOf(),
      }),
      now: () => at("07:01").getTime(),
    });
  const sent = { ...job, snapshot_text: JSON.stringify(job.snapshot) };
  await preflight(v3RaceDb())(sent);
  // 載せた優勝戦が中止・率の塊の艇が欠場になったら送らない
  for (const races of [
    v3RaceDb({ cancelled: [`${DATE}-15-12`] }),
    v3RaceDb({ absent: [`${DATE}-02-04:1`] }),
  ])
    await assert.rejects(
      preflight(races)(sent),
      /race_unconfirmed_or_withdrawn/,
    );
});

// ---- 後半の場面（verifyData/sns-today-plan-scenes-6.js・sns-today-plan-scenes-7.js） ----
runSnsTodayPlanScenes16({ db, first, all, at, plan, abVariants });
runSnsTodayPlanScenes17({ LEGACY_VARIANTS, first, all, at, sqlStore, plan, putType, withAuto });
