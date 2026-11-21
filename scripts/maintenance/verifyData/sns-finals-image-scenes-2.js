/**
 * verify-sns-finals-image.js の後半の場面（2/5）。verify ではない。
 * 判定と期待値は分ける前の verify-sns-finals-image.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { resultLine, finalsStatus } from "../../sns/push-finals-image.js";
import { createReadCurrent } from "../../../api/_lib/snsClaimCheck.js";
import { createDeadlinePreflight, createMockHeadless } from "../../../api/_lib/snsDeadlineQueue.js";
import { SCREEN_MARKERS } from "../../lib/snsScreenMarkers.js";
import { counts, NOTHING, draftOf } from "./sns-finals-image-scenes-1.js";

let db, first, all, RACE, DEADLINE, at, bundle, MAIN_JOB, MAIN_JOB_ID, store, push, claim;
export let readCurrent;

function scene1() {
  test("レースの検査: 中止・今日でない・優勝戦でない・deadline が races と違う・同じレースの finals_image がある（送った後も）", async () => {
    await db.exec("UPDATE races SET cancellation_status='cancelled'");
    assert.match((await push()).reasons.join(), /中止/);
    await db.exec("UPDATE races SET cancellation_status=NULL");
    assert.match(
      (
        await push(bundle(), { now: new Date("2037-10-25T16:15:00+09:00") })
      ).reasons.join(),
      /今日のレースでない/,
    );
    await db.exec("UPDATE race_conditions SET race_stage='準優勝戦'");
    assert.match((await push()).reasons.join(), /優勝戦でない/);
    await db.exec("UPDATE race_conditions SET race_stage='優勝戦'");
    assert.match(
      (await push(bundle({ deadline: "16:31" }))).reasons.join(),
      /deadline が races/,
    );
    assert.deepEqual(await counts(), NOTHING);
    // 1本目は通り、2本目以降（起こす係が2分ごとに呼ぶ）は何も作らず今の状態を返す（exit 4）。送った（sent）後も同じ
    const firstPush = await push();
    assert.ok(firstPush.job_id);
    const again = await push();
    assert.equal(again.already, true);
    assert.match(again.reason, /既にある（item notified・job queued）/);
    assert.equal(again.status.job_id, firstPush.job_id);
    assert.equal(resultLine(RACE, again).code, 4);
    // 本投稿と投票のリプの2つ
    assert.equal(Number((await first("SELECT count(*) n FROM sns_drafts")).n), 2);
    await db.exec("UPDATE sns_auto_send_items SET state='sent'");
    assert.match((await push()).reason, /既にある（item sent/);
    // 自動の job が送らずに終わった（held）なら、前の item を superseded で止めて作り直す（期限までのやり直し）
    await db.exec(
      "UPDATE sns_auto_send_items SET state='notified'; UPDATE sns_x_send_jobs SET state='held', error_code='source_stale'",
    );
    const retried = await push();
    assert.ok(retried.job_id);
    assert.notEqual(retried.job_id, firstPush.job_id);
    assert.deepEqual(
      (
        await all(
          "SELECT state, stopped_via FROM sns_auto_send_items ORDER BY created_at, state",
        )
      )
        .map((r) => [r.state, r.stopped_via])
        .sort(),
      // 本投稿と投票のリプを対で止めて作り直す
      [
        ["notified", null],
        ["notified", null],
        ["stopped", "superseded"],
        ["stopped", "superseded"],
      ],
    );
    // 送っている途中（reconcile）は作り直さない
    await db.exec(
      "UPDATE sns_x_send_jobs SET state='reconcile' WHERE id='" +
        retried.job_id +
        "'",
    );
    assert.equal((await push()).already, true);
  });
  test("許可が on で拒否したら Slack に理由を知らせる", async () => {
    const result = await push(bundle({ x_text: "儲かる優勝戦" }));
    assert.match(result.reasons.join(), /儲か/);
    assert.match(result.notes[0], /検査で拒否/);
  });
  test("mode=manual なら本投稿も投票のリプも held_manual で job を作らない（投票のリプの無い本投稿だけを出さない）", async () => {
    await db.exec("UPDATE sns_auto_send_control SET mode='manual'");
    const result = await push();
    assert.equal(result.job_id, undefined);
    assert.deepEqual(
      (await all("SELECT state FROM sns_auto_send_items ORDER BY variant")).map(
        (r) => r.state,
      ),
      ["held_manual", "held_manual"],
    );
    assert.equal((await counts()).jobs, 0);
    assert.match(result.notes[0], /送らない/);
  });
}

function scene2() {
  /** 送り手の読み直し（readCurrent）に PGlite の行を渡す */
  readCurrent = createReadCurrent({
    db: async (p) => {
      const table = p.split("?")[0];
      if (table === "sns_drafts")
        return all(
          "SELECT bundle_import_id, source_data FROM sns_drafts WHERE id=$1",
          [p.match(/id=eq\.([0-9a-f-]+)/)[1]],
        );
      if (table === "races")
        return all(
          "SELECT race_date::text, start_time::text, cancellation_status FROM races",
        );
      if (table === "race_conditions")
        return all("SELECT race_stage FROM race_conditions");
      if (table === "sns_auto_send_items")
        return all(
          "SELECT id FROM sns_auto_send_items WHERE kind='finals_image' AND variant=$1 AND state='sent'",
          [p.match(/variant=eq\.([a-z_]+)/)[1]],
        );
      if (table === "sns_auto_send_control")
        return all(
          "SELECT finals_image_enabled FROM sns_auto_send_control WHERE channel='x'",
        );
      return [];
    },
  });
  test("送り手の claim の前の検査（readCurrent）: 許可が off・優勝戦でない・送った finals_image がある・中止なら送らない", async () => {
    await push();
    const draft = await draftOf("main");
    const current = await readCurrent(draft.id);
    assert.deepEqual(current, {
      withdrawn: false,
      cancelled: false,
      deadline_at: DEADLINE,
      source_revision: draft.source_data.finals_image.revision,
    });
    assert.equal(
      current.source_revision,
      draft.source_data.deadline_queue.source_revision,
    );
    await db.exec("UPDATE sns_auto_send_control SET finals_image_enabled=false");
    await assert.rejects(readCurrent(draft.id), /finals_image_disabled/);
    await db.exec(
      "UPDATE sns_auto_send_control SET finals_image_enabled=true WHERE channel='x'",
    );
    await db.exec("UPDATE race_conditions SET race_stage='準優勝戦'");
    await assert.rejects(readCurrent(draft.id), /not_finals/);
    await db.exec("UPDATE race_conditions SET race_stage='優勝戦'");
    await db.exec("UPDATE sns_auto_send_items SET state='sent'");
    await assert.rejects(readCurrent(draft.id), /finals_already_sent/);
    await db.exec("UPDATE sns_auto_send_items SET state='notified'");
    await db.exec("UPDATE races SET cancellation_status='cancelled'");
    assert.equal((await readCurrent(draft.id)).cancelled, true);
  });
  test("送る直前の検査（createDeadlinePreflight）: 期限（締切の5分前）の前は通り、過ぎたら deadline_expired", async () => {
    await push();
    const job = await first(MAIN_JOB);
    const preflight = (now) =>
      createDeadlinePreflight({
        headless: createMockHeadless({
          visibleSelectors: SCREEN_MARKERS["race-sonar"],
        }),
        markers: SCREEN_MARKERS,
        readCurrent,
        now: () => now.getTime(),
      })(job);
    await preflight(at("16:24:59"));
    await assert.rejects(preflight(at("16:25:00")), /deadline_expired/);
  });
}

function scene3() {
  test("記録: 送った後は送った時刻・tweet id を返す", async () => {
    await push();
    const job = await first(MAIN_JOB_ID);
    await claim(job.id);
    await first(
      "SELECT public.transition_sns_x_send($1,'begin_post','{}'::jsonb)",
      [job.id],
    );
    await first("SELECT public.transition_sns_x_send($1,'complete',$2::jsonb)", [
      job.id,
      JSON.stringify({
        id: "1890000000000000001",
        posted_at: "2037-10-26T07:16:30Z",
      }),
    ]);
    const status = await finalsStatus(RACE, { store });
    assert.equal(status.job_state, "posted");
    assert.equal(status.item_state, "sent");
    assert.equal(status.tweet_id, "1890000000000000001");
    assert.equal(status.tweet_url, "https://x.com/i/status/1890000000000000001");
    assert.equal(
      new Date(status.posted_at).toISOString(),
      "2037-10-26T07:16:30.000Z",
    );
  });
  test("X の日の上限に入らないときは受け取らない（claim と同じ数え方: 今日の X の試行＋他経路＋1）", async () => {
    await db.exec(
      "UPDATE sns_x_send_control SET daily_limit_x=2, daily_external_count=1",
    );
    // 今日の X の試行1件（YouTube の試行は数えない）
    await db.exec(`WITH d AS (INSERT INTO sns_drafts(content_group_id,platform,language,format,caption_text)
        VALUES(gen_random_uuid(),'x','ja','today_digest','x') RETURNING id)
      INSERT INTO sns_x_send_jobs(draft_id,state,snapshot,snapshot_text,approved_hash,approver_id,approved_at,scheduled_at,attempt_dates,attempt_channels)
      SELECT id,'posted','{}'::jsonb,'{}','h',(SELECT id FROM sns_approvers LIMIT 1),test_now(),test_now(),
        ARRAY[(test_now() AT TIME ZONE 'Asia/Tokyo')::date,(test_now() AT TIME ZONE 'Asia/Tokyo')::date],ARRAY['x','youtube'] FROM d`);
    const full = await push();
    assert.match(
      full.reasons.join(),
      /日の上限 2 に2本が入らない（今日の試行 1・他経路 1・予約の子 0）/,
    );
    assert.equal(
      Number((await first("SELECT count(*) n FROM sns_auto_send_items")).n),
      0,
    );
    // 本投稿は投票のリプと対で2本分: 1＋1＋2 は上限3に入らない（本投稿だけなら入るが、受け取らない）
    await db.exec("UPDATE sns_x_send_control SET daily_limit_x=3");
    assert.match((await push()).reasons.join(), /日の上限 3 に2本が入らない/);
    await db.exec("UPDATE sns_x_send_control SET daily_limit_x=4");
    assert.ok((await push()).job_id);
    await db.exec("UPDATE sns_x_send_control SET daily_baseline_date=NULL");
    await db.exec(
      "DELETE FROM sns_x_send_jobs WHERE auto_item_id IS NOT NULL; DELETE FROM sns_auto_send_items",
    );
    assert.match((await push()).reasons.join(), /daily_baseline_date/);
  });
  test("182: 優勝戦の取り置きに入らないときは受け取らない（本投稿は投票と対で2本）。182 の前（404）は日の上限だけで決める", async () => {
    const asked = [];
    store.xSlotRoom = async (kind, need) => {
      asked.push([kind, need]);
      return {
        ok: false,
        reason: "kind_slot_full",
        kind,
        need,
        limit: 8,
        reserve: 3,
        booked: 2,
        others_booked: 5,
        held_for_others: 0,
        external: 0,
      };
    };
    try {
      const full = await push();
      assert.deepEqual(asked, [["finals_image", 2]]);
      assert.match(
        full.reasons.join(),
        /X の日の枠に finals_image（2本）が入らない/,
      );
      assert.equal(
        Number((await first("SELECT count(*) n FROM sns_auto_send_items")).n),
        0,
      );
      store.xSlotRoom = async () => {
        throw new Error("DB 操作に失敗: HTTP 404 POST rpc/sns_x_slot_room");
      };
      assert.ok((await push()).job_id);
    } finally {
      delete store.xSlotRoom;
    }
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（db・first・all・RACE・DEADLINE・at・bundle・MAIN_JOB・MAIN_JOB_ID・store・push・claim） */
export function runSnsFinalsImageScenes3(env) {
  ({ db, first, all, RACE, DEADLINE, at, bundle, MAIN_JOB, MAIN_JOB_ID, store, push, claim } = env);
  scene1();
  scene2();
  scene3();
}
