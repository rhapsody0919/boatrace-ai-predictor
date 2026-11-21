/**
 * verify-sns-auto-send.js の後半の場面（3/4）。verify ではない。
 * 判定と期待値は分ける前の verify-sns-auto-send.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { importBundle, createItem, approveThread, drafts, approve, prepare, autoApprover, DEADLINE, me, postX, reserved, hash } from "./sns-auto-send-scenes-1.js";

let db, first, all, at, setClock, transition;

/** test("veto_until（締切60分前）より前は X も YouTube も claim しない", async () => { の中身を割った 1/1 */
async function sas5361() {
  const r = await importBundle({ threads: 1 });
  await createItem(r.content_group_id, "x");
  await createItem(r.content_group_id, "youtube");
  const [xJob] = await approveThread(r.content_group_id);
  const [yt] = await drafts(r.content_group_id, "youtube");
  // 送る時刻を前にずらしても、止められる期限より前は claim しない
  const ytJob = await approve(await prepare(yt.id), autoApprover, at(10));
  await db.query("UPDATE sns_x_send_jobs SET scheduled_at=$1", [at(10)]);
  await setClock(30);
  await assert.rejects(transition(xJob.id, "claim"), /veto_window_open/);
  await assert.rejects(transition(ytJob.id, "claim"), /veto_window_open/);
  await setClock(60);
  assert.equal((await transition(xJob.id, "claim")).state, "sending");
  assert.equal((await transition(ytJob.id, "claim")).state, "sending");
}

/** test("個別承認の経路（bundle 由来でない本人の承認）は dry_run=false で今までどおり送れる", async ()  の中身を割った 1/1 */
async function sas5631() {
  const d = await first(
    "INSERT INTO sns_drafts(content_group_id,format,platform,language,caption_text) VALUES(gen_random_uuid(),'short','x','ja','手動の投稿') RETURNING *",
  );
  const prepared = await first(
    "UPDATE sns_drafts SET source_data=jsonb_build_object('deadline_queue',$2::jsonb) WHERE id=$1 RETURNING *",
    [
      d.id,
      {
        deadline_at: at(DEADLINE),
        expires_at: at(DEADLINE - 30),
        source_observed_at: at(0),
      },
    ],
  );
  const j = await approve(prepared, me, at(0));
  assert.equal(j.auto_item_id, null);
  // veto_until は自動送信の承認者の job だけに効く
  const posted = await postX(j.id, "5001");
  assert.equal(posted.state, "posted");
  assert.equal(await reserved(), 200000);
}

// ---- 158: /today（digest）の item・通り道 A/B・月の切り替えの自動化 ----
export async function digestDraft(lane = "A") {
  const draft = await first(
    "INSERT INTO sns_drafts(content_group_id,format,platform,language,caption_text,send_lane) VALUES(gen_random_uuid(),'today_digest','x','ja','本日のデータ一覧',$1) RETURNING *",
    [lane],
  );
  return prepare(draft.id);
}

export async function digestItem(draftId, state = "notified") {
  return first(
    `INSERT INTO sns_auto_send_items(kind,draft_id,channel,race_id,deadline_at,notify_by,veto_until,state,checks,stop_token_hash,notified_at)
     VALUES('digest',$1,'x','today:2026-10-13',$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [
      draftId,
      at(DEADLINE),
      at(DEADLINE - 180),
      at(DEADLINE - 60),
      state,
      { passed: true },
      hash(),
      state === "notified" ? at(0) : null,
    ],
  );
}

function sas3Scene1() {
  test("veto_until（締切60分前）より前は X も YouTube も claim しない", async () => {
    await sas5361();
  });
  test("子は親が posted になるまで claim しない", async () => {
    const r = await importBundle({ threads: 2 });
    await createItem(r.content_group_id, "x");
    const [, child] = await approveThread(r.content_group_id);
    await setClock(62);
    const held = await transition(child.id, "claim");
    assert.equal(held.state, "held");
    assert.equal(held.error_code, "parent_not_posted");
  });
  test("個別承認の経路（bundle 由来でない本人の承認）は dry_run=false で今までどおり送れる", async () => {
    await sas5631();
  });
  test("基準日は日付が変わったときだけ当日にし、未設定・未確認なら触らない", async () => {
    await db.exec(
      "UPDATE sns_x_send_control SET daily_baseline_date='2026-10-12',daily_external_count=2; UPDATE sns_youtube_quota_control SET baseline_day='2026-10-11',external_uploads=1,external_general=50",
    );
    const rolled = (await first("SELECT roll_sns_send_baselines() r")).r;
    assert.equal(rolled.x_rolled, true);
    assert.equal(rolled.youtube_rolled, true);
    const c = await first(
      "SELECT daily_baseline_date::text d,daily_external_count n FROM sns_x_send_control",
    );
    assert.deepEqual(c, { d: "2026-10-13", n: 0 });
    const q = await first(
      "SELECT baseline_day::text d,external_uploads u,external_general g FROM sns_youtube_quota_control",
    );
    assert.deepEqual(q, { d: "2026-10-12", u: 0, g: 0 });
    assert.equal(
      (await first("SELECT roll_sns_send_baselines() r")).r.x_rolled,
      false,
    );
    await db.exec(
      "UPDATE sns_x_send_control SET daily_baseline_date=NULL; UPDATE sns_youtube_quota_control SET verified=false,baseline_day='2026-10-11'",
    );
    const none = (await first("SELECT roll_sns_send_baselines() r")).r;
    assert.equal(none.x_rolled, false);
    assert.equal(none.youtube_rolled, false);
  });
  test("月の切り替えは今の期間が終わってからだけ、予約額を0に戻す", async () => {
    await db.exec("UPDATE sns_x_send_control SET reserved_microusd=5000");
    await assert.rejects(
      db.query(
        "SELECT renew_sns_x_send_period('2026-11-01T00:00:00Z','2026-12-01T00:00:00Z')",
      ),
      /period_overlaps_current/,
    );
    await db.query("UPDATE test_clock SET value='2026-11-01T00:00:01Z'");
    await db.query(
      "SELECT renew_sns_x_send_period('2026-11-01T00:00:00Z','2026-12-01T00:00:00Z')",
    );
    const c = await first(
      "SELECT reserved_microusd r, period_end FROM sns_x_send_control",
    );
    assert.equal(Number(c.r), 0);
    assert.equal(
      new Date(c.period_end).toISOString(),
      "2026-12-01T00:00:00.000Z",
    );
  });
  test("reserve_sns_x_read は月の残りの送信分を割るときは false", async () => {
    // 10/13 12:00 JST から 11/1 まで残り約19日。1日 30万 microusd を残すと 570万
    await db.exec("UPDATE sns_x_send_control SET reserved_microusd=4000000");
    assert.equal(
      (await first("SELECT reserve_sns_x_read(1000, 300000) r")).r,
      true,
    );
    assert.equal(
      (await first("SELECT reserve_sns_x_read(1000, 320000) r")).r,
      false,
    );
    assert.equal(await reserved(), 4001000);
  });
}

function sas3Scene2() {
  test("posted になると 48h・7d の取り込みジョブが2件でき、累積値は15分以内だけ保存できる", async () => {
    const r = await importBundle({ threads: 1 });
    await createItem(r.content_group_id, "x");
    const [only] = await approveThread(r.content_group_id);
    await setClock(61);
    const posted = await postX(only.id, "6001");
    const jobs = await all(
      `SELECT "window" w, source, due_at FROM sns_metric_jobs WHERE draft_id=$1 ORDER BY due_at`,
      [only.draft_id],
    );
    assert.deepEqual(
      jobs.map((j) => [j.w, j.source, new Date(j.due_at).toISOString()]),
      [
        [
          "48h",
          "x-api",
          new Date(Date.parse(posted.posted_at) + 48 * 3600000).toISOString(),
        ],
        [
          "7d",
          "x-api",
          new Date(Date.parse(posted.posted_at) + 168 * 3600000).toISOString(),
        ],
      ],
    );
    const end = new Date(Date.parse(posted.posted_at) + 48 * 3600000);
    const observe = (minutes) => {
      const observed = new Date(end.getTime() + minutes * 60000).toISOString();
      return db.query("SELECT append_sns_metric_observation($1,$2)", [
        only.draft_id,
        {
          window: "48h",
          observed_at: observed,
          period_start: posted.posted_at,
          period_end: end.toISOString(),
          data_through: observed,
          source: "x-api",
          metric_name: "impressions",
          metric_value: 10,
          definition: "累積",
          measurement_kind: "snapshot",
        },
      ]);
    };
    await observe(14);
    await assert.rejects(observe(16), /tolerance|check/i);
  });
  test("暦日の値は同じ日・対象・指標で1行（draft_id が NULL でも重複しない）", async () => {
    const row = [
      "2026-10-12",
      "youtube",
      null,
      null,
      "youtube-analytics",
      "views",
      5,
      "PT の暦日",
      at(0),
    ];
    const insert = `INSERT INTO sns_channel_daily(day,channel,draft_id,utm_content,source,metric_name,metric_value,definition,observed_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`;
    await db.query(insert, row);
    await assert.rejects(db.query(insert, row), /duplicate|unique/i);
  });
  test("138 の外部操作の途中の下書きがあっても止める操作は失敗しない", async () => {
    const r = await importBundle({ threads: 2 });
    const item = await createItem(r.content_group_id, "x");
    const [, child] = await drafts(r.content_group_id, "x");
    await db.query(
      "UPDATE sns_drafts SET external_operation_state='reconcile', external_operation_token=gen_random_uuid() WHERE id=$1",
      [child.id],
    );
    const stopped = await first("SELECT stop_sns_auto_item($1,'link') r", [
      item.id,
    ]);
    assert.deepEqual(stopped.r, { state: "stopped", already_started: 1 });
    const [parent] = await drafts(r.content_group_id, "x");
    assert.equal(parent.publish_blocked, true);
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（db・first・all・at・setClock・transition） */
export function runSnsAutoSendScenes4(env) {
  ({ db, first, all, at, setClock, transition } = env);
  sas3Scene1();
  sas3Scene2();
}

function sas3Scene3() {
  test("月の上限額は $200 まで設定でき、L3 の設定（1日16レース×6件）で送れる", async () => {
    await db.exec("UPDATE sns_x_send_control SET budget_microusd=200000000");
    await assert.rejects(
      db.query("UPDATE sns_x_send_control SET budget_microusd=200000001"),
      /check/i,
    );
    // 153-runbook.md の L3 の設定
    await db.exec(
      "UPDATE sns_x_send_control SET budget_microusd=120000000, ceiling_x_url_microusd=250000, ceiling_x_plain_microusd=30000, daily_limit_x=96, daily_limit_youtube=16",
    );
    const r = await importBundle({ threads: 6 });
    await createItem(r.content_group_id, "x");
    const jobs = await approveThread(r.content_group_id);
    for (const [i, j] of jobs.entries()) {
      await setClock(61 + i);
      assert.equal((await postX(j.id, String(7000 + i))).state, "posted");
    }
    assert.equal(await reserved(), 250000 + 5 * 30000);
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（db・first・all・at・setClock・transition） */
export function runSnsAutoSendScenes5(env) {
  ({ db, first, all, at, setClock, transition } = env);
  sas3Scene3();
}
