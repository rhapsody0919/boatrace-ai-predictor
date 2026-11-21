/**
 * verify-sns-finals-image.js の後半の場面（4/5）。verify ではない。
 * 判定と期待値は分ける前の verify-sns-finals-image.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { imageNamesOf, resultLine, finalsStatus, waitForSend } from "../../sns/push-finals-image.js";
import { pickDueJobs } from "../../lib/snsSendRunner.js";
import { draftOf, counts, NOTHING } from "./sns-finals-image-scenes-1.js";
import { readCurrent } from "./sns-finals-image-scenes-2.js";
import { postMain, replyBundle, clearRows } from "./sns-finals-image-scenes-3.js";

let db, first, all, RACE, DEADLINE, NOW, at, png, setClock, bundle, POLL, MAIN_JOB, POLL_JOB, store, push, claim, post;

function scene1() {
  test("本投稿の push は投票のリプも作る: 媒体なし・x_poll（締切で閉じる）・本投稿の job を親に持つ・期限は締切の5分前。runner は親が posted になるまで選ばない", async () => {
    const result = await push();
    assert.ok(result.job_id);
    assert.ok(result.poll_job_id);
    const main = await first(MAIN_JOB);
    const poll = await first(POLL_JOB);
    assert.equal(poll.id, result.poll_job_id);
    assert.equal(poll.parent_job_id, main.id);
    assert.equal(poll.expires_at.toISOString(), "2037-10-26T07:25:00.000Z");
    assert.equal(poll.scheduled_at.toISOString(), NOW.toISOString());
    const pollItem = await first(
      "SELECT * FROM sns_auto_send_items WHERE variant='finals_poll'",
    );
    assert.deepEqual(
      [pollItem.kind, pollItem.state, pollItem.race_id],
      ["finals_image", "notified", RACE],
    );
    assert.equal(poll.auto_item_id, pollItem.id);
    const snapshot = JSON.parse(poll.snapshot_text);
    assert.deepEqual(snapshot.media, []);
    assert.deepEqual(snapshot.poll, { options: POLL, closes_at: DEADLINE });
    assert.equal(snapshot.text, bundle().poll_text);
    assert.equal(snapshot.queue.parent_job_id, main.id);
    const pollDraft = await draftOf("poll");
    assert.equal(pollDraft.publish_blocked, false);
    assert.equal(pollDraft.cover_image_path, null);
    assert.equal(pollDraft.source_data.image_paths, undefined);
    // 送り手は親が posted で tweet id のある子だけを選ぶ
    const parentsOf = () =>
      all(
        "SELECT id, state, external_post_id FROM sns_x_send_jobs WHERE parent_job_id IS NULL",
      );
    const queued = () =>
      all(
        "SELECT * FROM sns_x_send_jobs WHERE state='queued' ORDER BY parent_job_id NULLS FIRST",
      );
    assert.deepEqual(
      pickDueJobs(await queued(), await parentsOf()).map((j) => j.id),
      [main.id],
    );
    await post(main.id, "1890000000000000011", "2037-10-26T07:16:00Z");
    assert.deepEqual(
      pickDueJobs(await queued(), await parentsOf()).map((j) => j.id),
      [poll.id],
    );
    // 本投稿を送った（item sent）後も、投票のリプの送る直前の読み直しは止まらない（自分の種類だけを見る）
    assert.equal(
      (
        await first(
          "SELECT state FROM sns_auto_send_items WHERE variant='finals'",
        )
      ).state,
      "sent",
    );
    const current = await readCurrent(pollDraft.id);
    assert.equal(
      current.source_revision,
      pollDraft.source_data.deadline_queue.source_revision,
    );
    await db.exec(
      "UPDATE sns_auto_send_items SET state='sent' WHERE variant='finals_poll'",
    );
    await assert.rejects(readCurrent(pollDraft.id), /finals_already_sent/);
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（db・first・all・RACE・DEADLINE・NOW・at・png・setClock・bundle・POLL・MAIN_JOB・POLL_JOB・store・push・claim・post） */
export function runSnsFinalsImageScenes6(env) {
  ({ db, first, all, RACE, DEADLINE, NOW, at, png, setClock, bundle, POLL, MAIN_JOB, POLL_JOB, store, push, claim, post } = env);
  scene1();
}

function scene2() {
  test("投票のリプは本投稿と対で枠を取る: 子の分の空きが無ければ本投稿も claim できない。本投稿を送った後は子の枠を他の親の job に使わせない", async () => {
    await setClock(at("14:02:00"));
    const main = await push(bundle(), { now: at("14:00:00") });
    // 受け取りの後に上限を1に下げると、本投稿の claim は子の分が入らず止まる（親だけ送らない）
    await db.exec("UPDATE sns_x_send_control SET daily_limit_x=1");
    await assert.rejects(claim(main.job_id), /日次全体上限/);
    assert.equal((await first(MAIN_JOB)).attempts, 0);
    // 上限2: 本投稿は通る
    await db.exec("UPDATE sns_x_send_control SET daily_limit_x=2");
    await post(main.job_id, "1890000000000000020", "2037-10-26T05:01:00Z");
    // 別の優勝戦の本投稿（親）を受け取る（上限4: 今日の試行1＋2）。上限を3に下げると、その claim は
    // 今日の試行1＋自分1＋自分の子1＋送った本投稿の子（投票のリプ、まだ claim していない）1＝4 で入らない
    const other = "2037-10-26-05-12";
    await db.query("INSERT INTO races VALUES($1,'2037-10-26','17:30:00',NULL)", [other]);
    await db.query("INSERT INTO race_conditions VALUES($1,'優勝戦')", [other]);
    const otherImages = Object.fromEntries(
      imageNamesOf(other).map((name, i) => [name, png(1080, 1350, 300 + i)]),
    );
    const otherBundle = bundle({ race_id: other, deadline: "17:30", images: imageNamesOf(other), poll_text: "あなたの予想は？\n#ボートレース" });
    // push の事前検査も claim と同じく予約の子を数える（上限3: 試行1＋予約の子1＋2 は入らない）
    await db.exec("UPDATE sns_x_send_control SET daily_limit_x=3");
    assert.match(
      (await push(otherBundle, { now: at("14:00:00") }, otherImages)).reasons.join(),
      /日の上限 3 に2本が入らない（今日の試行 1・他経路 0・予約の子 1）/,
    );
    await db.exec("UPDATE sns_x_send_control SET daily_limit_x=4");
    const second = await push(
      bundle({ race_id: other, deadline: "17:30", images: imageNamesOf(other), poll_text: "あなたの予想は？\n#ボートレース" }),
      { now: at("14:00:00") },
      otherImages,
    );
    assert.ok(second.job_id, JSON.stringify(second));
    await db.exec("UPDATE sns_x_send_control SET daily_limit_x=3");
    await assert.rejects(claim(second.job_id), /日次全体上限/);
    // 投票のリプ自身は入る（自分を予約から除く。子は他の子の枠を数えない）
    assert.equal((await claim(main.poll_job_id)).state, "sending");
  });
  test("展示後のリプ: 締切の25〜13分前だけ受け取り、本投稿（posted）へのリプで画像4枚。13分前ちょうどは受け取らない", async () => {
    const main = await postMain();
    for (const t of ["16:04:59", "16:17:00", "16:20:00"]) {
      await setClock(at(t));
      const r = await push(replyBundle(), { now: at(t) });
      assert.match(
        r.reasons.join(),
        t === "16:04:59" ? /25分前より前/ : /13分前を過ぎた/,
        t,
      );
    }
    assert.equal(
      Number(
        (
          await first(
            "SELECT count(*) n FROM sns_auto_send_items WHERE variant='finals_reply'",
          )
        ).n,
      ),
      0,
    );
    await setClock(at("16:16:59"));
    const reply = await push(replyBundle(), { now: at("16:16:59") });
    assert.equal(reply.part, "reply");
    assert.ok(reply.job_id, JSON.stringify(reply));
    const job = await first("SELECT * FROM sns_x_send_jobs WHERE id=$1", [
      reply.job_id,
    ]);
    assert.equal(job.parent_job_id, main.job_id);
    assert.equal(job.expires_at.toISOString(), "2037-10-26T07:25:00.000Z");
    const item = await first(
      "SELECT * FROM sns_auto_send_items WHERE variant='finals_reply'",
    );
    assert.deepEqual([item.kind, item.state], ["finals_image", "notified"]);
    const snapshot = JSON.parse(job.snapshot_text);
    assert.equal(snapshot.media.length, 4);
    assert.ok(snapshot.media.every((m) => m.path.includes("/reply-")));
    assert.equal(snapshot.text, replyBundle().x_text);
    assert.equal(snapshot.poll, undefined);
    // 送る直前の読み直しは、本投稿を送った後も止まらない
    assert.equal(
      (await readCurrent((await draftOf("reply")).id)).cancelled,
      false,
    );
    // 2回目は何もしない（exit 4）
    const again = await push(replyBundle(), { now: at("16:16:59") });
    assert.equal(again.already, true);
    assert.equal(resultLine(RACE, again).code, 4);
    assert.match(resultLine(RACE, again).text, /"part":"reply"/);
    assert.equal(
      (await finalsStatus(RACE, { store })).reply.job_id,
      reply.job_id,
    );
  });
}

function scene3() {
  test("展示後のリプは本投稿が送られていなければ受け取らない（親が無い）。許可が off なら何も書かない", async () => {
    await setClock(at("16:10:00"));
    const none = await push(replyBundle(), { now: at("16:10:00") });
    assert.match(none.reasons.join(), /本投稿がまだ送られていない/);
    // 本投稿を受け取っただけ（未送信）でも同じ
    await push(bundle(), { now: at("16:10:00") });
    const pending = await push(replyBundle(), { now: at("16:10:00") });
    assert.match(pending.reasons.join(), /本投稿がまだ送られていない/);
    await clearRows();
    await postMain();
    await db.exec("UPDATE sns_auto_send_control SET finals_image_enabled=false");
    await setClock(at("16:10:00"));
    const before = Number((await first("SELECT count(*) n FROM sns_drafts")).n);
    const off = await push(replyBundle(), { now: at("16:10:00") });
    assert.equal(off.disabled, true);
    assert.equal(resultLine(RACE, off).code, 3);
    assert.equal(
      Number((await first("SELECT count(*) n FROM sns_drafts")).n),
      before,
    );
  });
  test("本投稿が日の上限で受け取れなければ、投票のリプも作らない（何も書かない）", async () => {
    await db.exec("UPDATE sns_x_send_control SET daily_limit_x=1");
    const result = await push();
    assert.match(result.reasons.join(), /2本が入らない/);
    assert.deepEqual(await counts(), NOTHING);
  });
  test("投票のリプの承認で落ちたら、本投稿も投票のリプも held_manual にして送らない（承認済みの本投稿の job は claim で止まる）", async () => {
    const failing = {
      ...store,
      updateDraft: async () => {
        throw new Error("下書きを更新できない");
      },
    };
    const result = await push(bundle(), { store: failing });
    assert.match(result.error, /下書きを更新できない/);
    assert.equal(result.job_id, undefined);
    assert.deepEqual(
      (await all("SELECT state FROM sns_auto_send_items ORDER BY variant")).map(
        (r) => r.state,
      ),
      ["held_manual", "held_manual"],
    );
    const r = await claim((await first(MAIN_JOB)).id);
    assert.equal(r.state, "held");
    assert.equal(r.error_code, "auto_stopped");
    assert.match(result.notes[0], /止めた/);
  });
  test("待つ（本投稿）: 本投稿が posted になった後、投票のリプが送り終わるまで待つ", async () => {
    const result = await push();
    const main = await first(MAIN_JOB);
    const poll = await first(POLL_JOB);
    let clock = NOW.getTime();
    let sleeps = 0;
    const status = await waitForSend(RACE, {
      store,
      draftId: result.draft_id,
      pollDraftId: result.poll_draft_id,
      expiresAt: "2037-10-26T07:25:00.000Z",
      now: () => new Date(clock),
      sleep: async (sec) => {
        sleeps += 1;
        clock += sec * 1000;
        if (sleeps === 1)
          await post(main.id, "1890000000000000030", "2037-10-26T07:15:30Z");
        if (sleeps === 2)
          await post(poll.id, "1890000000000000031", "2037-10-26T07:16:30Z");
      },
    });
    assert.equal(sleeps, 2);
    assert.equal(status.job_state, "posted");
    assert.equal(status.poll.job_state, "posted");
    assert.equal(status.poll.tweet_id, "1890000000000000031");
    assert.equal(resultLine(RACE, result, status).code, 0);
    const all3 = await finalsStatus(RACE, { store });
    assert.equal(all3.poll.tweet_id, "1890000000000000031");
    assert.equal(all3.reply, null);
  });
}

function scene4() {
  test("177: 承認の関数は snapshot.poll と下書きの x_poll の一致を照合し、投票と媒体の同居を拒む", async () => {
    const failing = { ...store };
    let caught = null;
    failing.approve = async (a) => {
      if (a.p_snapshot.poll) {
        const bad = { ...a.p_snapshot, poll: { ...a.p_snapshot.poll, options: [...POLL.slice(0, 3), "E 5号艇"] } };
        caught = await store.approve({ ...a, p_snapshot: bad }).then(() => null, (e) => e);
        const withMedia = { ...a.p_snapshot, media: [{ path: "x.png", sha256: "a".repeat(64), size: 1, type: "image/png" }] };
        caught = [caught, await store.approve({ ...a, p_snapshot: withMedia }).then(() => null, (e) => e)];
        const noPoll = { ...a.p_snapshot };
        delete noPoll.poll;
        caught.push(await store.approve({ ...a, p_snapshot: noPoll }).then(() => null, (e) => e));
      }
      return store.approve(a);
    };
    const result = await push(bundle(), { store: failing });
    assert.ok(result.poll_job_id, JSON.stringify(result));
    assert.equal(caught.length, 3);
    for (const e of caught) assert.match(String(e?.message), /承認中に投票が変わりました/);
  });
  test("177: 期限を過ぎた子・素材でない YouTube の子は予約に入らない", async () => {
    await setClock(at("14:02:00"));
    const main = await push(bundle(), { now: at("14:00:00") });
    await db.exec("UPDATE sns_x_send_control SET daily_limit_x=2");
    await post(main.job_id, "1890000000000000040", "2037-10-26T05:01:00Z");
    // 投票のリプの期限を過ぎた扱いにすると、他の親の claim の予約から外れる
    await db.query("UPDATE sns_x_send_jobs SET expires_at=$2 WHERE id=$1", [main.poll_job_id, "2037-10-26T04:59:00Z"]);
    const other = "2037-10-26-05-12";
    await db.query("INSERT INTO races VALUES($1,'2037-10-26','17:30:00',NULL)", [other]);
    await db.query("INSERT INTO race_conditions VALUES($1,'優勝戦')", [other]);
    await db.exec("UPDATE sns_x_send_control SET daily_limit_x=3");
    const second = await push(
      bundle({ race_id: other, deadline: "17:30", images: imageNamesOf(other), poll_text: "あなたの予想は？\n#ボートレース" }),
      { now: at("14:00:00") },
      Object.fromEntries(imageNamesOf(other).map((n, i) => [n, png(1080, 1350, 400 + i)])),
    );
    assert.ok(second.job_id, JSON.stringify(second));
    // 試行1＋自分1＋自分の子1＝3。期限切れの子は数えない
    assert.equal((await claim(second.job_id)).state, "sending");
    // YouTube の子（全貌の Shorts）は X の予約に入らない
    await db.exec("UPDATE sns_x_send_jobs SET channel='youtube' WHERE id='" + second.poll_job_id + "'");
    const rows = await store.waitingChildren(at("14:00:00"));
    assert.ok(rows.every((r) => r.channel === "x"));
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（db・first・all・RACE・DEADLINE・NOW・at・png・setClock・bundle・POLL・MAIN_JOB・POLL_JOB・store・push・claim・post） */
export function runSnsFinalsImageScenes7(env) {
  ({ db, first, all, RACE, DEADLINE, NOW, at, png, setClock, bundle, POLL, MAIN_JOB, POLL_JOB, store, push, claim, post } = env);
  scene2();
  scene3();
  scene4();
}
