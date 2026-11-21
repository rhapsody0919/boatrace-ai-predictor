/**
 * verify-sns-setsu-kiryoku-short.js の後半の場面（3/5）。verify ではない。
 * 判定と期待値は分ける前の verify-sns-setsu-kiryoku-short.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { resultLine, setsuStatus } from "../../sns/push-setsu-kiryoku-short.js";
import {
  runYoutubeQueueJob,
  createMockYoutubeAdapter,
  createMockHeadless,
} from "../../../api/_lib/snsDeadlineQueue.js";
import { SCREEN_MARKERS } from "../../lib/snsScreenMarkers.js";
import { insertSetsuItem, markSent } from "./sns-setsu-kiryoku-short-scenes-2.js";
import { push, transition, preflightAt, readCurrent, counts, store, theJob } from "./sns-setsu-kiryoku-short-scenes-1.js";

let db, first, all, DAY, NEXT, at, PUSHED_AT, FINAL, SETSU_ID, VIDEO, bundle, setClock, sampleOf;

function skst3Scene1() {
  test("201: 1日1本は版（border・main）ごと。同じ日・同じ会場でも border と main は両方入る。main の2本目・border の2本目は入らない。border は setsu_kiryoku_short の youtube だけ", async () => {
    await insertSetsuItem("youtube", SETSU_ID, "border");
    await insertSetsuItem("youtube", SETSU_ID, "main");
    await assert.rejects(
      insertSetsuItem("youtube", `setsu:${DAY}:01`, "main"),
      /setsu_day/,
    );
    await assert.rejects(
      insertSetsuItem("youtube", `setsu:${DAY}:01`, "border"),
      /setsu_day/,
    );
    // 送った後も数える。個別承認に回した（held_manual）版は数えない（もう一方の版は数えたまま）
    await markSent("true");
    await assert.rejects(
      insertSetsuItem("youtube", `setsu:${DAY}:01`, "border"),
      /setsu_day/,
    );
    await db.exec(
      "UPDATE sns_auto_send_items SET state='held_manual' WHERE variant='border'",
    );
    await insertSetsuItem("youtube", `setsu:${DAY}:01`, "border");
    await assert.rejects(
      insertSetsuItem("youtube", `setsu:${DAY}:01`, "main"),
      /setsu_day/,
    );
    // 次の日は両方入る
    await insertSetsuItem("youtube", `setsu:${NEXT}:01`, "border");
    await insertSetsuItem("youtube", `setsu:${NEXT}:01`, "main");
    await assert.rejects(
      insertSetsuItem("x", `setsu:${NEXT}:02`, "border"),
      /kind_source|variant_scope/,
    );
    await assert.rejects(
      insertSetsuItem("youtube", `setsu:${NEXT}:13`, "shorts"),
      /variant_scope|setsu_id/,
    );
    // border は他の kind に使えない
    await assert.rejects(
      db.query(
        `WITH draft AS (INSERT INTO sns_drafts(content_group_id,platform,language,format,caption_text)
         VALUES(gen_random_uuid(), 'youtube', 'ja', 'full_picture', '201') RETURNING id)
       INSERT INTO sns_auto_send_items(kind,variant,draft_id,channel,race_id,deadline_at,notify_by,veto_until,state)
       SELECT 'full_picture', 'border', id, 'youtube', $1, test_now()+interval '3h', test_now(), test_now()+interval '1h', 'checking' FROM draft`,
        [FINAL],
      ),
      /variant_scope/,
    );
  });
}

function skst3Scene2() {
  test("BOA-1249: 朝 08:00 の border（準優に残れるか）と 21:30 の節の機力を同じ日に両方受けて送る。border 以外の2本目・border の2本目は作らない（exit 4）", async () => {
    const border = await sampleOf("border");
    const motor = await sampleOf("motor_gap");
    const morning = at("07:50:00");
    await setClock(morning);
    const b = await push(
      {
        ...border,
        date: DAY,
        send_time: "08:00",
        source_observed_at: `${DAY}T07:30:00+09:00`,
      },
      { now: morning },
    );
    assert.equal(b.reasons, undefined, JSON.stringify(b.reasons));
    assert.ok(b.job_id);
    const bItem = await first(
      "SELECT variant, race_id FROM sns_auto_send_items WHERE id=$1",
      [b.item_id],
    );
    assert.deepEqual([bItem.variant, bItem.race_id], ["border", SETSU_ID]);
    // border を 08:00 に送る（item が sent になる）
    const bJob = await first("SELECT * FROM sns_x_send_jobs WHERE id=$1", [
      b.job_id,
    ]);
    const bSendAt = new Date(Date.parse(bJob.scheduled_at));
    await setClock(bSendAt);
    const posted = await runYoutubeQueueJob(bJob.id, {
      store: { transition: (id, action, r = {}) => transition(id, action, r) },
      youtube: createMockYoutubeAdapter({
        videoId: "borderVid01",
        postedAt: bSendAt.toISOString(),
      }),
      loadMedia: async () => VIDEO,
      preflight: preflightAt(bSendAt),
    });
    assert.equal(posted.state, "posted", posted.error_code);
    assert.equal(
      (
        await first("SELECT state FROM sns_auto_send_items WHERE id=$1", [
          b.item_id,
        ])
      ).state,
      "sent",
    );
    // 21:25 に節の機力（final_gap、版 main）を受ける。同じ日・同じ会場でも通る
    await setClock(PUSHED_AT);
    const k = await push();
    assert.equal(k.reasons, undefined, JSON.stringify(k.reasons));
    assert.equal(k.already, undefined, k.reason);
    assert.ok(k.job_id);
    // 送る直前の読み直しも、朝に送った border を「同じ日に送った」と数えない
    assert.equal((await readCurrent(k.draft_id)).cancelled, false);
    // border 以外の2本目（別の型 motor_gap も版は main）は作らない
    const again = await push(
      { ...motor, date: DAY, source_observed_at: `${DAY}T21:00:00+09:00` },
      { now: at("21:26:00") },
    );
    assert.equal(again.already, true, JSON.stringify(again.reasons));
    assert.equal(resultLine(again).code, 4);
    // border の2本目も作らない（朝に送った border が sent）
    const borderAgain = await push(
      { ...border, date: DAY, source_observed_at: `${DAY}T21:00:00+09:00` },
      { now: at("21:26:00") },
    );
    assert.equal(borderAgain.already, true, JSON.stringify(borderAgain.reasons));
    assert.equal(resultLine(borderAgain).code, 4);
    // setsu_id は同じなので、結果の行に版を出す（どちらの動画の話か hq が分かる）
    assert.match(resultLine(borderAgain).text, /"variant":"border"/);
    assert.match(resultLine(again).text, /"variant":"main"/);
    assert.equal(borderAgain.status.video_id, "borderVid01");
    assert.equal((await counts()).jobs, 2);
    // 版ごとの状態（--status <日> border|main）
    const st = await setsuStatus(DAY, { store, variant: "border" });
    assert.deepEqual([st.item_state, st.video_id], ["sent", "borderVid01"]);
    assert.equal(
      (await setsuStatus(DAY, { store, variant: "main" })).job_id,
      k.job_id,
    );
  });
}

function skst3Scene3() {
  test("201 の読み直し: 下書きの型と item の版が違えば setsu_item_mismatch。別の版で送った item は数えず、同じ版で送った item は setsu_already_sent_today", async () => {
    await push();
    const draft = await first("SELECT * FROM sns_drafts");
    await db.exec(
      "ALTER TABLE sns_auto_send_items DISABLE TRIGGER USER; UPDATE sns_auto_send_items SET variant='border'",
    );
    await assert.rejects(readCurrent(draft.id), /setsu_item_mismatch/);
    await db.exec(
      "UPDATE sns_auto_send_items SET variant='main'; ALTER TABLE sns_auto_send_items ENABLE TRIGGER USER",
    );
    await insertSetsuItem("youtube", `setsu:${DAY}:01`, "border");
    await markSent("variant='border'");
    await readCurrent(draft.id);
    await insertSetsuItem("youtube", `setsu:${NEXT}:01`, "main");
    await markSent(`race_id='setsu:${NEXT}:01'`);
    await readCurrent(draft.id);
    await db.exec("UPDATE sns_x_send_jobs SET state='cancelled'");
    await markSent(`race_id='${SETSU_ID}'`);
    await assert.rejects(readCurrent(draft.id), /setsu_already_sent_today/);
  });
  test("二重送信: 同じ束を2回入れても2本目は作らない。送らずに終わった（held）job は作り直す（前の item を stopped（superseded）にする）", async () => {
    await push();
    const second = await push(bundle(), { now: at("21:26:00") });
    assert.equal(second.already, true);
    assert.equal((await counts()).jobs, 1);
    await db.exec(
      "UPDATE sns_x_send_jobs SET state='held', error_code='deadline_expired'",
    );
    const retry = await push(bundle(), { now: at("21:27:00") });
    assert.equal(retry.reasons, undefined, JSON.stringify(retry.reasons));
    assert.ok(retry.job_id);
    const items = await all(
      "SELECT state, stopped_via FROM sns_auto_send_items ORDER BY created_at",
    );
    assert.deepEqual(
      items.map((i) => [i.state, i.stopped_via]),
      [
        ["stopped", "superseded"],
        ["notified", null],
      ],
    );
  });
  test("二重送信（同じ優勝戦）: 前夜（eve）に出した優勝戦は、当日（today）に同じ会場・同じ優勝戦の日で出さない", async () => {
    // 前夜: date は優勝戦の前日、final_date が優勝戦の日（出走表はまだ無いので優勝戦の照合はしない）
    const prev = "2037-10-31";
    await setClock(at("21:25:00", prev));
    const eve = await push(bundle({ date: prev, final_date: DAY, when: "eve" }), {
      now: at("21:25:00", prev),
    });
    assert.equal(eve.reasons, undefined, JSON.stringify(eve.reasons));
    await db.exec(
      `UPDATE sns_auto_send_items SET state='sent', checks='{"passed":true}'; UPDATE sns_x_send_jobs SET state='posted', external_post_id='setsuvideo2', posted_at=test_now()`,
    );
    await setClock(PUSHED_AT);
    const today = await push();
    assert.ok(
      today.reasons?.some((x) => x.includes("同じ優勝戦")),
      JSON.stringify(today),
    );
    assert.equal(resultLine(today).code, 1);
  });
}

function skst3Scene4() {
  test("優勝戦が今日の型: その日のその会場の優勝戦が DB に無い・中止・欠場があれば受け取らない。送る直前の読み直しも中止・欠場を返す", async () => {
    await push();
    const draft = await first("SELECT * FROM sns_drafts");
    const current = await readCurrent(draft.id);
    assert.deepEqual(current, {
      withdrawn: false,
      cancelled: false,
      deadline_at: draft.source_data.deadline_queue.deadline_at,
      source_revision: draft.source_data.setsu_kiryoku_short.revision,
    });
    await db.query(
      "UPDATE races SET cancellation_status='confirmed' WHERE race_id=$1",
      [FINAL],
    );
    assert.equal((await readCurrent(draft.id)).cancelled, true);
    const job = await theJob();
    await assert.rejects(
      preflightAt(new Date(Date.parse(job.scheduled_at)))(job),
      /race_unconfirmed_or_withdrawn/,
    );
    await db.exec("DELETE FROM sns_x_send_jobs; DELETE FROM sns_auto_send_items");
    const cancelled = await push();
    assert.ok(cancelled.reasons.includes("優勝戦が中止"));
    await db.query("UPDATE races SET cancellation_status=NULL WHERE race_id=$1", [
      FINAL,
    ]);
    await db.query("INSERT INTO race_entries VALUES($1, true)", [FINAL]);
    assert.ok((await push()).reasons.includes("優勝戦に欠場がある"));
    await db.exec("DELETE FROM race_conditions");
    assert.ok(
      (await push()).reasons.some((x) => x.includes("優勝戦が DB に無い")),
    );
  });
  test("送り手の読み直し（readCurrent）: 許可・同じ日に送った setsu_kiryoku_short・item の kind と日と会場を DB から見る。リンク先は会場のページの印で確かめる", async () => {
    await push();
    const draft = await first("SELECT * FROM sns_drafts");
    await db.exec(
      "UPDATE sns_auto_send_control SET setsu_kiryoku_short_enabled=false",
    );
    await assert.rejects(readCurrent(draft.id), /setsu_kiryoku_short_disabled/);
    await db.exec(
      "UPDATE sns_auto_send_control SET setsu_kiryoku_short_enabled=(channel='youtube')",
    );
    await db.exec("UPDATE sns_auto_send_items SET state='sent'");
    await assert.rejects(readCurrent(draft.id), /setsu_already_sent_today/);
    await db.exec("UPDATE sns_auto_send_items SET state='notified'");
    await db.exec(
      `ALTER TABLE sns_auto_send_items DISABLE TRIGGER USER; UPDATE sns_auto_send_items SET race_id='setsu:${DAY}:12'`,
    );
    await assert.rejects(readCurrent(draft.id), /setsu_item_mismatch/);
    await db.exec(
      `UPDATE sns_auto_send_items SET race_id='${SETSU_ID}'; ALTER TABLE sns_auto_send_items ENABLE TRIGGER USER`,
    );
    // 会場のページの印が片方でも見えなければ送らない
    const job = await theJob();
    const sendAt = new Date(Date.parse(job.scheduled_at));
    await preflightAt(sendAt)(job);
    await assert.rejects(
      preflightAt(
        sendAt,
        createMockHeadless({ visibleSelectors: [SCREEN_MARKERS.venue[0]] }),
      )(job),
      /public_component_missing/,
    );
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（db・first・all・DAY・NEXT・at・PUSHED_AT・FINAL・SETSU_ID・VIDEO・bundle・setClock・sampleOf） */
export function runSnsSetsuKiryokuShortScenes7(env) {
  ({ db, first, all, DAY, NEXT, at, PUSHED_AT, FINAL, SETSU_ID, VIDEO, bundle, setClock, sampleOf } = env);
  skst3Scene1();
  skst3Scene2();
  skst3Scene3();
  skst3Scene4();
}
