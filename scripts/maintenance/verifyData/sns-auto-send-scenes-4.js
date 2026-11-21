/**
 * verify-sns-auto-send.js の後半の場面（4/4）。verify ではない。
 * 判定と期待値は分ける前の verify-sns-auto-send.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { digestDraft, digestItem } from "./sns-auto-send-scenes-3.js";
import { approve, autoApprover, postX, DEADLINE, hash, job, importBundle, createItem, approveThread, prepare, me } from "./sns-auto-send-scenes-1.js";

let db, first, at, setClock, transition;

/** test("158: /today の item は下書き1件を指し、自動送信の承認者で承認でき、止めると下書きが公開保留に戻る", asy の中身を割った 1/1 */
async function sas8271() {
  const d = await digestDraft();
  const item = await digestItem(d.id);
  const j = await approve(d, autoApprover, at(60));
  assert.equal(j.auto_item_id, item.id);
  await setClock(61);
  const posted = await postX(j.id, "8001");
  assert.equal(posted.state, "posted");
  assert.equal(
    (
      await first("SELECT state FROM sns_auto_send_items WHERE id=$1", [
        item.id,
      ])
    ).state,
    "sent",
  );

  await setClock(0);
  const d2 = await digestDraft();
  const item2 = await first(
    `INSERT INTO sns_auto_send_items(kind,draft_id,channel,race_id,deadline_at,notify_by,veto_until,state,checks,stop_token_hash,notified_at)
     VALUES('digest',$1,'x','today:2026-10-14',$2,$3,$4,'notified',$5,$6,$7) RETURNING *`,
    [
      d2.id,
      at(DEADLINE),
      at(DEADLINE - 180),
      at(DEADLINE - 60),
      { passed: true },
      hash(),
      at(0),
    ],
  );
  const j2 = await approve(d2, autoApprover, at(60));
  await first("SELECT stop_sns_auto_item($1,'link') r", [item2.id]);
  assert.equal((await job(j2.id)).state, "cancelled");
  const blocked = await first(
    "SELECT status, publish_blocked FROM sns_drafts WHERE id=$1",
    [d2.id],
  );
  assert.deepEqual(blocked, {
    status: "pending_review",
    publish_blocked: true,
  });
}

/** test("158: 通り道 B は、今日まだ送っていない A の本数を先に枠から引く（A を先に入れる）", async () => { の中身を割った 1/1 */
async function sas8961() {
  // A: 6件のスレッドが notified で、まだ claim していない
  const r = await importBundle({ threads: 6 });
  await db.query(
    "UPDATE sns_drafts SET send_lane='A' WHERE bundle_import_id=$1",
    [r.content_group_id],
  );
  await createItem(r.content_group_id, "x");
  await approveThread(r.content_group_id);
  // B: 本人が個別承認した1件
  const b = await first(
    "INSERT INTO sns_drafts(content_group_id,format,platform,language,caption_text,send_lane) VALUES(gen_random_uuid(),'topic','x','ja','企画の投稿','B') RETURNING *",
  );
  const bJob = await approve(await prepare(b.id), me, at(0));
  await db.exec("UPDATE sns_x_send_control SET daily_limit_x=6");
  await setClock(1);
  await assert.rejects(transition(bJob.id, "claim"), /日次全体上限/);
  await db.exec("UPDATE sns_x_send_control SET daily_limit_x=7");
  assert.equal((await transition(bJob.id, "claim")).state, "sending");
  // 通り道の無い（今までの）下書きは今までどおり A の予定を引かない
  const legacy = await first(
    "INSERT INTO sns_drafts(content_group_id,format,platform,language,caption_text) VALUES(gen_random_uuid(),'short','x','ja','今までの投稿') RETURNING *",
  );
  const legacyJob = await approve(await prepare(legacy.id), me, at(0));
  assert.equal((await transition(legacyJob.id, "claim")).state, "sending");
}

/** test("158: B の差し引きは、承認前の A・検査中の A・/today を数え、別の日の A と held_manual は数えな の中身を割った 1/1 */
async function sas10231() {
  // 今日: 承認前の A（2件のスレッド、検査中）と /today（notified、承認前）→ 3件
  const r = await importBundle({ threads: 2 });
  await db.query(
    "UPDATE sns_drafts SET send_lane='A' WHERE bundle_import_id=$1",
    [r.content_group_id],
  );
  await createItem(r.content_group_id, "x", "checking");
  const today = await digestDraft();
  await digestItem(today.id);
  // 別の日（明日が締切）の A と、検査に落ちた A は数えない
  const tomorrow = await importBundle({ threads: 3, raceId: "R7" });
  await db.query(
    "UPDATE sns_drafts SET send_lane='A' WHERE bundle_import_id=$1",
    [tomorrow.content_group_id],
  );
  await db.query(
    `INSERT INTO sns_auto_send_items(bundle_import_id,channel,race_id,deadline_at,notify_by,veto_until,state,checks,stop_token_hash,notified_at)
     VALUES($1,'x','R7',$2,$3,$4,'notified','{"passed":true}',$5,$6)`,
    [
      tomorrow.content_group_id,
      at(DEADLINE + 1440),
      at(DEADLINE + 1260),
      at(DEADLINE + 1380),
      hash(),
      at(0),
    ],
  );
  const failed = await importBundle({ threads: 3, raceId: "R8" });
  await db.query(
    "UPDATE sns_drafts SET send_lane='A' WHERE bundle_import_id=$1",
    [failed.content_group_id],
  );
  await createItem(failed.content_group_id, "x", "held_manual", "R8");

  const b = await first(
    "INSERT INTO sns_drafts(content_group_id,format,platform,language,caption_text,send_lane) VALUES(gen_random_uuid(),'topic','x','ja','企画','B') RETURNING *",
  );
  const bJob = await approve(await prepare(b.id), me, at(0));
  await setClock(1);
  await db.exec("UPDATE sns_x_send_control SET daily_limit_x=3");
  await assert.rejects(transition(bJob.id, "claim"), /日次全体上限/);
  await db.exec("UPDATE sns_x_send_control SET daily_limit_x=4");
  assert.equal((await transition(bJob.id, "claim")).state, "sending");
  // claim の後に A が増えても、begin_post では引き直さない
  const more = await digestDraft();
  await db.query(
    `INSERT INTO sns_auto_send_items(kind,draft_id,channel,race_id,deadline_at,notify_by,veto_until,state,checks,stop_token_hash,notified_at)
     VALUES('digest',$1,'x','today:extra',$2,$3,$4,'notified','{"passed":true}',$5,$6)`,
    [
      more.id,
      at(DEADLINE),
      at(DEADLINE - 180),
      at(DEADLINE - 60),
      hash(),
      at(0),
    ],
  );
  await transition(bJob.id, "check");
  assert.equal((await transition(bJob.id, "begin_post")).state, "reconcile");
}

function sas4Scene1() {
  test("158: /today の item は下書き1件を指し、自動送信の承認者で承認でき、止めると下書きが公開保留に戻る", async () => {
    await sas8271();
  });
  test("158: item の種類と元の組み合わせを CHECK で守る（digest は bundle を持たず X だけ、race は bundle が要る）", async () => {
    const r = await importBundle({ threads: 1 });
    const d = await digestDraft();
    const insert = (kind, bundle, draftId, channel = "x") =>
      db.query(
        `INSERT INTO sns_auto_send_items(kind,bundle_import_id,draft_id,channel,race_id,deadline_at,notify_by,veto_until)
       VALUES($1,$2,$3,$4,'R9',$5,$6,$7)`,
        [
          kind,
          bundle,
          draftId,
          channel,
          at(DEADLINE),
          at(DEADLINE - 180),
          at(DEADLINE - 60),
        ],
      );
    await assert.rejects(insert("digest", r.content_group_id, d.id), /check/i);
    await assert.rejects(insert("digest", null, d.id, "youtube"), /check/i);
    await assert.rejects(insert("race", null, null), /check/i);
    await insert("digest", null, d.id);
    await assert.rejects(insert("digest", null, d.id), /unique|duplicate/i);
  });
  test("158: 通り道 B は、今日まだ送っていない A の本数を先に枠から引く（A を先に入れる）", async () => {
    await sas8961();
  });
  test("158: 月の切り替えは期間が終わってから同じ額で進み、止まっていた月の分も追いつく", async () => {
    await db.exec(
      "UPDATE sns_x_send_control SET budget_microusd=130000000, reserved_microusd=5000",
    );
    assert.equal(
      (await first("SELECT roll_sns_x_send_period() r")).r.rolled,
      false,
    );
    await db.query("UPDATE test_clock SET value='2026-12-15T00:00:00Z'");
    const rolled = (await first("SELECT roll_sns_x_send_period() r")).r;
    assert.equal(rolled.rolled, true);
    const c = await first(
      "SELECT period_start, period_end, reserved_microusd, budget_microusd FROM sns_x_send_control",
    );
    assert.equal(
      new Date(c.period_start).toISOString(),
      "2026-12-01T00:00:00.000Z",
    );
    assert.equal(
      new Date(c.period_end).toISOString(),
      "2027-01-01T00:00:00.000Z",
    );
    assert.equal(Number(c.reserved_microusd), 0);
    assert.equal(Number(c.budget_microusd), 130000000);
    await db.exec(
      "UPDATE sns_x_send_control SET period_start=NULL, period_end=NULL",
    );
    assert.deepEqual((await first("SELECT roll_sns_x_send_period() r")).r, {
      rolled: false,
      reason: "period_unset",
    });
  });
  test("158: UTM の campaign に today_digest を使える", async () => {
    const d = await digestDraft();
    await db.query(
      "INSERT INTO sns_post_tracking(draft_id,race_url,tracking_url,utm_campaign,utm_content,release_evidence) VALUES($1,'https://www.boat-ai.jp/today','https://www.boat-ai.jp/today?utm_campaign=today_digest','today_digest','2026-10-13','{}')",
      [d.id],
    );
    await assert.rejects(
      db.query(
        "INSERT INTO sns_post_tracking(draft_id,race_url,tracking_url,utm_campaign,utm_content,release_evidence) VALUES($1,'u','u','other','x','{}')",
        [(await digestDraft()).id],
      ),
      /check/i,
    );
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（db・first・at・setClock・transition） */
export function runSnsAutoSendScenes6(env) {
  ({ db, first, at, setClock, transition } = env);
  sas4Scene1();
}

function sas4Scene2() {
  test("158: B の差し引きは、承認前の A・検査中の A・/today を数え、別の日の A と held_manual は数えない。claim のときだけ引く", async () => {
    await sas10231();
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（db・first・at・setClock・transition） */
export function runSnsAutoSendScenes7(env) {
  ({ db, first, at, setClock, transition } = env);
  sas4Scene2();
}
