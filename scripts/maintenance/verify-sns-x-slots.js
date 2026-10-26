// X の日の枠の出し物ごとの取り置き（マイグレーション 179、docs/design/x-daily-slots/plan.md）の再現テスト。
// PGlite に 177 までと 179 を当て、本番と同じ承認（approve_sns_x_send）・claim（transition_sns_x_send → transition_sns_send_139）で通す。
// 外部接続なし。X へは何も送らない
import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { createXSnapshot } from "../../api/_lib/snsXSend.js";
import { checkXSlot, slotDecision, slotRoomBody } from "../lib/snsXSlots.js";
import { hqReserveRows, reserveDiff } from "../sns/x-slots-check.js";

const db = new PGlite();
const first = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const all = async (sql, args = []) => (await db.query(sql, args)).rows;
const loadMedia = async () => new Uint8Array([1, 2, 3]);
// 2026-10-27（火）JST 12:00
const T0 = Date.parse("2026-10-27T03:00:00Z");
const at = (minutes) => new Date(T0 + minutes * 60000).toISOString();
const setClock = (minutes) =>
  db.query("UPDATE test_clock SET value=$1", [at(minutes)]);
const DEADLINE = 300; // 締切は T0+300分（17:00）
const hash = () => randomBytes(32).toString("hex");
let autoApprover;
let seq = 0;

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
    "161_sns_full_picture_items.sql",
    "172_sns_full_picture_shorts.sql",
    "176_sns_finals_image_items.sql",
    "177_sns_finals_replies.sql",
    "179_sns_x_kind_reserves.sql",
  ])
    await db.exec(
      (
        await readFile(
          new URL("../../docs/db-migration/" + file, import.meta.url),
          "utf8",
        )
      ).replaceAll("now()", "test_now()"),
    );
  autoApprover = (
    await first(
      "SELECT auto_approver_id id FROM sns_auto_send_control WHERE channel='x'",
    )
  ).id;
});
beforeEach(async () => {
  await db.exec(`
    DELETE FROM sns_metric_jobs; UPDATE sns_x_send_jobs SET parent_job_id=NULL; DELETE FROM sns_x_send_jobs; DELETE FROM sns_auto_send_items;
    ALTER TABLE sns_drafts DISABLE TRIGGER USER; DELETE FROM sns_drafts; ALTER TABLE sns_drafts ENABLE TRIGGER USER;
    DELETE FROM sns_x_kind_reserves;
    INSERT INTO sns_x_kind_reserves(kind, daily_count) VALUES ('full_picture',4),('digest',1),('finals_image',3);
    UPDATE sns_auto_send_control SET mode='auto', dry_run=false, finals_image_enabled=(channel='x');`);
  await setClock(0);
  await db.exec(`
    UPDATE sns_x_send_control SET paused=false,timing_approved=true,schedule_minutes=60,expiry_minutes=30,
      daily_limit=1000,daily_limit_x=8,daily_limit_youtube=2,daily_external_count=0,
      daily_baseline_date=(test_now() AT TIME ZONE 'Asia/Tokyo')::date,max_source_age_seconds=14400,
      period_start='2026-10-01T00:00:00Z',period_end='2026-11-01T00:00:00Z',budget_microusd=10000000,
      attempt_ceiling_microusd=1000,ceiling_x_url_microusd=10000,ceiling_x_plain_microusd=1000,reserved_microusd=0;`);
});
after(() => db.close());

const FORMAT = {
  full_picture: "full_picture",
  digest: "today_digest",
  finals_image: "finals_image",
};
const transition = async (id, action, result = {}) =>
  (
    await first("SELECT transition_sns_x_send($1,$2,$3) r", [
      id,
      action,
      result,
    ])
  ).r;

/**
 * 自動送信の承認者で承認した X の job（送る時刻は今）。kind=null は item の無い通り道 B の下書き（本人の承認は使わず、
 * 自動の承認者は item が要るので、B は item の無い job を直接 queued にする）
 */
async function makeJob(kind, { variant, parentJobId = null } = {}) {
  seq += 1;
  const draft = await first(
    `INSERT INTO sns_drafts(content_group_id,format,platform,language,caption_text,send_lane,publish_blocked,source_data)
     VALUES(gen_random_uuid(),$1,'x','ja',$2,'A',false,jsonb_build_object('deadline_queue',$3::jsonb)) RETURNING *`,
    [
      FORMAT[kind],
      `${kind} ${seq}`,
      {
        deadline_at: at(DEADLINE),
        expires_at: at(DEADLINE - (kind === "finals_image" ? 5 : 30)),
        source_revision: `r${seq}`,
        source_observed_at: at(0),
        ...(parentJobId ? { parent_job_id: parentJobId } : {}),
      },
    ],
  );
  await db.query(
    `INSERT INTO sns_auto_send_items(kind,draft_id,channel,variant,race_id,deadline_at,notify_by,veto_until,state,checks,stop_token_hash,notified_at)
     VALUES($1,$2,'x',$3,$4,$5,$6,$7,'notified',$8,$9,$10)`,
    [
      kind,
      draft.id,
      variant ?? (kind === "finals_image" ? "finals" : "main"),
      `R${seq}`,
      at(DEADLINE),
      at(-180),
      at(0),
      { passed: true },
      hash(),
      at(0),
    ],
  );
  return (
    await first("SELECT approve_sns_x_send($1,$2,$3,$4) r", [
      draft.id,
      autoApprover,
      await createXSnapshot(draft, loadMedia),
      at(0),
    ])
  ).r;
}
const claim = (job) => transition(job.id, "claim");
async function post(job) {
  await transition(job.id, "check");
  await transition(job.id, "begin_post");
  seq += 1;
  return transition(job.id, "complete", {
    id: String(9000 + seq),
    posted_at: at(1),
  });
}
const room = async (kind, need, withQueued = true) =>
  (
    await first("SELECT sns_x_slot_room($1,$2,$3,NULL) r", [
      kind,
      need,
      withQueued,
    ])
  ).r;
const attemptsToday = async () =>
  Number(
    (
      await first(
        `SELECT count(*) n FROM sns_x_send_jobs, LATERAL unnest(attempt_dates, attempt_channels) a(day, ch)
         WHERE ch='x' AND day=(test_now() AT TIME ZONE 'Asia/Tokyo')::date`,
      )
    ).n,
  );

/** 優勝戦の本投稿と投票のリプ（子）を承認し、本投稿を claim する */
async function finalsPair() {
  const main = await makeJob("finals_image");
  const poll = await makeJob("finals_image", {
    variant: "finals_poll",
    parentJobId: main.id,
  });
  return { main, poll, claimed: await claim(main) };
}

test("179: 全貌が取り置き4本を claim した後でも、優勝戦の3本（本投稿・投票・展示後のリプ）は claim できる。全貌の5本目は止まる", async () => {
  await setClock(1);
  for (let i = 0; i < 4; i++)
    assert.equal((await claim(await makeJob("full_picture"))).state, "sending");
  // 取り置きの合計8＝上限8なので、全貌の5本目は他の出し物の取り置きの残り（/today 1・優勝戦3）を使えない
  const fifth = await claim(await makeJob("full_picture"));
  assert.equal(fifth.state, "held");
  assert.equal(fifth.error_code, "kind_slot_full");
  // /today も取り置きの1本で通る
  assert.equal((await claim(await makeJob("digest"))).state, "sending");
  const { main, poll, claimed } = await finalsPair();
  assert.equal(claimed.state, "sending");
  await post(main);
  assert.equal((await claim(poll)).state, "sending");
  await post(poll);
  const reply = await makeJob("finals_image", {
    variant: "finals_reply",
    parentJobId: main.id,
  });
  assert.equal((await claim(reply)).state, "sending");
  // 合計は上限を越えない
  assert.equal(await attemptsToday(), 8);
});

test("179: 取り置かれていない残り（上限9−取り置き8）は先に来た出し物が使い、出し物ごとの上限（取り置き＋残り）で止まる", async () => {
  await db.exec("UPDATE sns_x_send_control SET daily_limit_x=9");
  await setClock(1);
  for (let i = 0; i < 5; i++)
    assert.equal((await claim(await makeJob("full_picture"))).state, "sending");
  assert.equal(
    (await claim(await makeJob("full_picture"))).error_code,
    "kind_slot_full",
  );
  // /today の2本目は残りが無いので止まる（取り置きの1本は使える）
  assert.equal((await claim(await makeJob("digest"))).state, "sending");
  assert.equal(
    (await claim(await makeJob("digest"))).error_code,
    "kind_slot_full",
  );
  const { claimed } = await finalsPair();
  assert.equal(claimed.state, "sending");
  assert.ok((await attemptsToday()) <= 9);
});

test("179: 親は自分の子の分も取り置きに入らなければ claim しない（優勝戦の本投稿と投票は2本で数える）", async () => {
  await db.exec(
    "UPDATE sns_x_kind_reserves SET daily_count=1 WHERE kind='finals_image'",
  );
  await db.exec("UPDATE sns_x_send_control SET daily_limit_x=6");
  await setClock(1);
  // 取り置き 全貌4・/today 1・優勝戦1＝6。優勝戦は1本分しか無いので、本投稿と投票の組は止まる
  const { main, claimed } = await finalsPair();
  assert.equal(claimed.state, "held");
  assert.equal(claimed.error_code, "kind_slot_full");
  // 親を止めたので、子（投票）は送られない（parent_not_posted）
  assert.equal(
    (await first("SELECT state FROM sns_x_send_jobs WHERE id=$1", [main.id]))
      .state,
    "held",
  );
});

test("179: 他の親の claim 済みの子は、その出し物の予定として数え、二重に数えない", async () => {
  await setClock(1);
  const { main, poll } = await finalsPair();
  await post(main);
  // 優勝戦は 本投稿1（試行）＋投票1（claim 済みの親の子）＝2、取り置き3 → 他の出し物から見て残り1
  const r = await room("full_picture", 1, false);
  assert.equal(r.held_for_others, 1 + 1); // /today 1 ＋ 優勝戦の残り1
  assert.equal(r.others_booked, 2);
  assert.equal(r.ok, true);
  assert.equal((await claim(poll)).state, "sending");
});

test("179: 取り込みの確かめ（with_queued）は、まだ claim していない今日の queued も数える", async () => {
  // 朝に全貌を4本受けた（まだ送る時刻でない）。5本目を受ける時点で止められる
  for (let i = 0; i < 4; i++) await makeJob("full_picture");
  const r = await room("full_picture", 1, true);
  assert.equal(r.booked, 4);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "kind_slot_full");
  // claim の数え方（queued を数えない）では入る
  assert.equal((await room("full_picture", 1, false)).ok, true);
  // 優勝戦の組は入る
  assert.equal((await room("finals_image", 2, true)).ok, true);
});

test("179: 曜日つきの取り置きは、その曜日（JST）だけ他の出し物から取っておく", async () => {
  await db.exec("UPDATE sns_x_send_control SET daily_limit_x=9");
  // 火曜（2026-10-27）。数字で見たら（仮の kind）を月水金に1本
  await db.exec(
    "INSERT INTO sns_x_kind_reserves(kind, daily_count, weekdays) VALUES ('research_image', 1, '{1,3,5}')",
  );
  await setClock(1);
  for (let i = 0; i < 4; i++) await claim(await makeJob("full_picture"));
  assert.equal((await room("full_picture", 1, false)).ok, true);
  await db.exec(
    "UPDATE sns_x_kind_reserves SET weekdays='{2}' WHERE kind='research_image'",
  );
  assert.equal((await room("full_picture", 1, false)).ok, false);
  // 曜日は 1〜7 だけ
  await assert.rejects(
    db.exec(
      "UPDATE sns_x_kind_reserves SET weekdays='{0}' WHERE kind='research_image'",
    ),
    /check/i,
  );
});

test("179: item の無い job（通り道 B）は、全部の出し物の取り置きの残りを空けて待つ", async () => {
  await db.exec("UPDATE sns_x_send_control SET daily_limit_x=9");
  const r = await room("", 1, false);
  assert.equal(r.held_for_others, 8);
  assert.equal(r.ok, true);
  await db.exec("UPDATE sns_x_send_control SET daily_limit_x=8");
  assert.equal((await room("", 1, false)).ok, false);
});

test("179: 他経路の本数と今日の基準の日も数える", async () => {
  await db.exec("UPDATE sns_x_send_control SET daily_external_count=1");
  assert.equal((await room("digest", 1, false)).ok, false);
  await db.exec(
    "UPDATE sns_x_send_control SET daily_external_count=0, daily_baseline_date='2026-10-26'",
  );
  const r = await room("digest", 1, false);
  assert.deepEqual([r.ok, r.reason], [false, "baseline_unconfirmed"]);
  // 基準が未確認のときの claim は 177 のとおり例外（取り置きの held にしない）
  await db.exec(
    "UPDATE sns_x_send_control SET daily_baseline_date=(test_now() AT TIME ZONE 'Asia/Tokyo')::date",
  );
  const j = await makeJob("digest");
  await db.exec(
    "UPDATE sns_x_send_control SET daily_baseline_date='2026-10-26'",
  );
  await setClock(1);
  await assert.rejects(claim(j), /日次全体上限・他経路の本数が未確認/);
  assert.equal(
    (await first("SELECT state FROM sns_x_send_jobs WHERE id=$1", [j.id]))
      .state,
    "queued",
  );
});

test("179: 表と関数の権限（匿名・authenticated に無い、service_role は読むだけ）", async () => {
  const grants = await all(
    "SELECT grantee, privilege_type FROM information_schema.role_table_grants WHERE table_name='sns_x_kind_reserves' AND grantee IN ('anon','authenticated','service_role') ORDER BY 1,2",
  );
  assert.deepEqual(grants, [
    { grantee: "service_role", privilege_type: "SELECT" },
  ]);
  const exec = await all(
    "SELECT r.rolname, has_function_privilege(r.rolname, 'public.sns_x_slot_room(text,integer,boolean,uuid,uuid)', 'EXECUTE') ok FROM pg_roles r WHERE r.rolname IN ('anon','authenticated','service_role') ORDER BY 1",
  );
  assert.deepEqual(
    exec.map((r) => [r.rolname, r.ok]),
    [
      ["anon", false],
      ["authenticated", false],
      ["service_role", true],
    ],
  );
});

// ---- 取り込みの確かめ（scripts/lib/snsXSlots.js） ----
test("snsXSlots: 止めるのは kind_slot_full のときだけ。関数が無い（179 の前）・読めないときは止めない（読めない理由は返す）", async () => {
  assert.equal(slotDecision({ ok: true, reason: null }).blocked, false);
  assert.equal(
    slotDecision({ ok: false, reason: "baseline_unconfirmed" }).blocked,
    false,
  );
  const full = slotDecision({
    ok: false,
    reason: "kind_slot_full",
    kind: "full_picture",
    need: 1,
    limit: 8,
    reserve: 4,
    booked: 4,
    others_booked: 0,
    held_for_others: 4,
    external: 0,
  });
  assert.equal(full.blocked, true);
  assert.match(full.reason, /full_picture（1本）が入らない/);
  assert.deepEqual(
    await checkXSlot(
      async () => {
        throw new Error(
          "DB 操作に失敗: HTTP 404 POST rpc/sns_x_slot_room PGRST202",
        );
      },
      "digest",
      1,
    ),
    { blocked: false, unavailable: true },
  );
  const failed = await checkXSlot(
    async () => {
      throw new Error("DB 操作に失敗: HTTP 500");
    },
    "digest",
    1,
  );
  assert.equal(failed.blocked, false);
  assert.match(failed.note, /確かめられない.*HTTP 500/);
  // rpc の本文（PostgREST は名前で渡す）は関数の引数の名前と同じ
  const body = slotRoomBody("digest", 2, null);
  const args = await first(
    "SELECT proargnames FROM pg_proc WHERE proname='sns_x_slot_room'",
  );
  assert.deepEqual(Object.keys(body), args.proargnames);
  // 取り置きの合計が上限を越える日は止めずに知らせる
  const over = slotDecision({
    ok: true,
    reason: null,
    over_reserved: true,
    reserved_total: 10,
    external: 0,
    limit: 9,
  });
  assert.equal(over.blocked, false);
  assert.match(over.note, /合計 10.*上限 9 を越えている/);
});

test("179: 出し物が NULL は拒む。作り直し（p_draft_id）はその下書きの前の版の job と子を数えない。取り置きの合計の越えを返す", async () => {
  await assert.rejects(
    first("SELECT sns_x_slot_room(NULL,1,true,NULL,NULL) r"),
    /出し物（kind）が無い/,
  );
  await db.exec("UPDATE sns_x_send_control SET daily_limit_x=9");
  // /today の返信の型（親と返信）の job が queued のまま、同じ下書きで作り直す
  const parent = await makeJob("digest");
  await makeJob("digest", { parentJobId: parent.id });
  for (let i = 0; i < 4; i++) await claim(await makeJob("full_picture"));
  // 数えると 0+2(自分の前の版)+4+3+2=11 で止まる。下書きで外すと 0+0+4+3+2=9 で入る
  assert.equal((await room("digest", 2, true)).ok, false);
  const r = (
    await first("SELECT sns_x_slot_room('digest',2,true,NULL,$1) r", [
      parent.draft_id,
    ])
  ).r;
  assert.equal(r.booked, 0);
  assert.equal(r.ok, true);
  assert.equal(r.reserved_total, 8);
  assert.equal(r.over_reserved, false);
  await db.exec("UPDATE sns_x_send_control SET daily_limit_x=7");
  assert.equal((await room("digest", 1, true)).over_reserved, true);
});

// ---- hq の config/x-slots.json との照合（scripts/sns/x-slots-check.js） ----
test("x-slots-check: hq の取り置きを表の行に直し、違いと越えを出す", () => {
  const config = {
    daily_limit_x: 9,
    reserve: {
      full_picture: 4,
      today: 1,
      finals: 3,
      research_rank: { count: 1, weekdays: ["mon", "wed", "fri"] },
    },
  };
  const { rows, unknown } = hqReserveRows(config, {
    research_rank: "research_image",
  });
  assert.deepEqual(unknown, []);
  assert.deepEqual(rows, [
    { kind: "full_picture", daily_count: 4, weekdays: null },
    { kind: "digest", daily_count: 1, weekdays: null },
    { kind: "finals_image", daily_count: 3, weekdays: null },
    { kind: "research_image", daily_count: 1, weekdays: [1, 3, 5] },
  ]);
  assert.deepEqual(hqReserveRows(config).unknown, ["research_rank"]);
  const diff = reserveDiff(
    rows,
    [
      { kind: "full_picture", daily_count: 4, weekdays: null },
      { kind: "digest", daily_count: 1, weekdays: null },
      { kind: "finals_image", daily_count: 3, weekdays: null },
    ],
    { hqLimit: 9, dbLimit: 8 },
  );
  assert.equal(diff.ok, false);
  assert.ok(diff.lines.some((l) => /research_image/.test(l)));
  assert.ok(diff.lines.some((l) => /daily_limit_x/.test(l)));
  assert.ok(
    diff.sql.some((s) => /INSERT INTO public\.sns_x_kind_reserves/.test(s)),
  );
  // 曜日ごとの取り置きの合計が上限を越えると知らせる
  const over = reserveDiff(rows, rows, { hqLimit: 8, dbLimit: 8 });
  assert.ok(over.lines.some((l) => /越える/.test(l)));
});
