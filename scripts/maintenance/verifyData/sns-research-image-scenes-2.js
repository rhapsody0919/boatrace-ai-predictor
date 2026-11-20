/**
 * verify-sns-research-image.js の後半の場面（2/2）。verify ではない。
 * 判定と期待値は分ける前の verify-sns-research-image.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { resultLine, researchStatus, schedule } from "../../sns/push-research-image.js";
import { createMockHeadless, createDeadlinePreflight } from "../../../api/_lib/snsDeadlineQueue.js";
import { createMockXAdapter, runXSendJob } from "../../../api/_lib/snsXSend.js";
import { SCREEN_MARKERS } from "../../lib/snsScreenMarkers.js";
import { at, png, counts, NOTHING, CAPTION, theJob, preflightAt, DAY, ID } from "./sns-research-image-scenes-1.js";

let db, first, PUSHED_AT, setClock, bundle, store, IMAGE, push, transition, readCurrent;

function sri2Scene1() {
  test("検査（時刻・画像）: 今日でない・期限の10分前を過ぎた・集計が未来・期限までに24時間を越える・画像の大きさ。拒否は Slack に知らせて何も書かない", async () => {
    const reasonsOf = async (b, opts, image) =>
      (await push(b, opts, image)).reasons?.join() ?? "";
    assert.match(await reasonsOf(bundle({ date: "2037-10-29" })), /今日/);
    // 期限 20:00 の10分前（19:50）ちょうどは拒否、その1秒前は受け取る
    assert.match(
      await reasonsOf(bundle(), { now: at("19:50:00") }),
      /10分前を過ぎた/,
    );
    assert.match(
      await reasonsOf(
        bundle({ source_observed_at: at("15:30:00").toISOString() }),
      ),
      /今より後/,
    );
    // 期限 20:00 の24時間前ちょうどは古い
    assert.match(
      await reasonsOf(
        bundle({
          source_observed_at: new Date(
            at("20:00:00").getTime() - 86400000,
          ).toISOString(),
        }),
      ),
      /古い/,
    );
    // 時差の無い時刻は、Node と DB で別の時刻に読まれるので受け取らない
    assert.match(
      await reasonsOf(bundle({ source_observed_at: "2037-10-28T14:30:00" })),
      /時差/,
    );
    assert.match(await reasonsOf(bundle(), {}, png(1200, 1350)), /1080×1350/);
    assert.match(await reasonsOf(bundle(), {}, null), /無い/);
    assert.deepEqual(await counts(), NOTHING);
    const rejected = await push(bundle({ x_text: "儲かる数字" }));
    assert.match(rejected.notes[0], /検査で拒否/);
    assert.equal(resultLine(rejected).code, 1);
    // 19:49:59 は受け取る（送る時刻は今＋2分）
    const late = await push(bundle(), { now: at("19:49:59") });
    assert.equal(late.reasons, undefined);
    assert.equal(
      late.send_at,
      new Date(at("19:49:59").getTime() + 120000).toISOString(),
    );
  });
  test("X の日の上限: 受け取る時点でもう1本が入らなければ受け取らない", async () => {
    await db.exec(
      "UPDATE sns_x_send_control SET daily_limit_x=1, daily_external_count=1",
    );
    const result = await push();
    assert.match(result.reasons.join(), /日の上限/);
    assert.deepEqual(await counts(), NOTHING);
  });
  test("mode=manual なら held_manual で job を作らない（exit 5）", async () => {
    await db.exec("UPDATE sns_auto_send_control SET mode='manual'");
    const result = await push();
    assert.equal(result.job_id, undefined);
    assert.equal(
      (await first("SELECT state FROM sns_auto_send_items")).state,
      "held_manual",
    );
    assert.equal((await counts()).jobs, 0);
    assert.match(result.notes[0], /送らない/);
    assert.equal(resultLine(result).code, 5);
    // held_manual は1日1本から外れるので、自動に戻した後に入れ直せる
    await db.exec("UPDATE sns_auto_send_control SET mode='auto'");
    assert.ok((await push()).job_id);
  });
  test("自動の承認に失敗したら item を held_manual にし、結果の1行に失敗の理由を書く（exit 5）", async () => {
    const result = await push(bundle(), {
      store: { ...store, approve: async () => Promise.reject(new Error("承認の関数が拒否")) },
    });
    assert.equal(result.job_id, undefined);
    assert.equal((await first("SELECT state FROM sns_auto_send_items")).state, "held_manual");
    const line = resultLine(result);
    assert.equal(line.code, 5);
    assert.match(line.text, /自動の承認に失敗/);
  });
  test("送らずに終わった（held）job は作り直す: 前の item を stopped（superseded）にして新しい版を入れる", async () => {
    const firstPush = await push();
    await db.exec(
      "UPDATE sns_x_send_jobs SET state='held', error_code='research_image_disabled'",
    );
    const retried = await push(bundle({ x_text: `${CAPTION}！` }));
    assert.ok(retried.job_id);
    assert.notEqual(retried.job_id, firstPush.job_id);
    const old = await first(
      "SELECT state, stopped_via FROM sns_auto_send_items WHERE id=$1",
      [firstPush.item_id],
    );
    assert.deepEqual([old.state, old.stopped_via], ["stopped", "superseded"]);
  });
}

function sri2Scene2() {
  test("送り手の読み直し（readCurrent）: 許可・同じ日に送った research_image・item の kind・本文・画像の数を DB から見る。public_check は none", async () => {
    await push();
    const draft = await first("SELECT * FROM sns_drafts");
    const current = await readCurrent(draft.id);
    assert.deepEqual(current, {
      withdrawn: false,
      cancelled: false,
      deadline_at: at("21:00:00").toISOString(),
      source_revision: draft.source_data.research_image.revision,
      public_check: "none",
    });
    assert.equal(
      current.source_revision,
      draft.source_data.deadline_queue.source_revision,
    );
    await db.exec(
      "UPDATE sns_auto_send_control SET research_image_enabled=false",
    );
    await assert.rejects(readCurrent(draft.id), /research_image_disabled/);
    await db.exec(
      "UPDATE sns_auto_send_control SET research_image_enabled=(channel='x')",
    );
    await db.exec("UPDATE sns_auto_send_items SET state='sent'");
    await assert.rejects(readCurrent(draft.id), /research_already_sent_today/);
    await db.exec("UPDATE sns_auto_send_items SET state='notified'");
    // 本文が変わって禁止表現・リンクが入ったら止める（下書きの書き換えは承認でも止まるが、読み直しでも見る）
    await db.exec("ALTER TABLE sns_drafts DISABLE TRIGGER USER");
    await db.query("UPDATE sns_drafts SET caption_text=$2 WHERE id=$1", [
      draft.id,
      "詳しくは boat-ai.jp",
    ]);
    await assert.rejects(readCurrent(draft.id), /research_text_rejected/);
    await db.query(
      "UPDATE sns_drafts SET caption_text=$2, source_data=jsonb_set(source_data,'{image_paths}',$3::jsonb) WHERE id=$1",
      [draft.id, CAPTION, JSON.stringify([draft.cover_image_path, "x.png"])],
    );
    await assert.rejects(readCurrent(draft.id), /research_image_count/);
    await db.query("UPDATE sns_drafts SET source_data=$2 WHERE id=$1", [
      draft.id,
      draft.source_data,
    ]);
    await db.exec("ALTER TABLE sns_drafts ENABLE TRIGGER USER");
    // item が research_image でない（race_id が違う）なら、リンク先の表示の確認を外さない
    await db.exec(
      "UPDATE sns_auto_send_items SET race_id='research:2037-10-28:other'",
    );
    await assert.rejects(readCurrent(draft.id), /research_item_mismatch/);
  });
  test("送る直前の検査（createDeadlinePreflight）: research_image はリンク先の表示を開かずに通る。送る文にリンクがあれば link_not_allowed。他の型は今までどおり表示を確かめる", async () => {
    await push();
    const job = await theJob();
    const headless = createMockHeadless({ fail: true });
    await preflightAt(at("19:00:00"), headless)(job);
    assert.equal(headless.calls.length, 0);
    await assert.rejects(preflightAt(at("20:00:00"))(job), /deadline_expired/);
    const linked = {
      ...job,
      snapshot_text: JSON.stringify({
        ...JSON.parse(job.snapshot_text),
        text: `${CAPTION} https://www.boat-ai.jp/today`,
      }),
    };
    await assert.rejects(preflightAt(at("19:00:00"))(linked), /link_not_allowed/);
    // public_check の無い readCurrent（他の型）はリンク先の表示を確かめる（headless が無ければ止まる）
    const other = createDeadlinePreflight({
      headless: null,
      markers: SCREEN_MARKERS,
      readCurrent: async () => ({
        withdrawn: false,
        cancelled: false,
        deadline_at: JSON.parse(job.snapshot_text).queue.deadline_at,
        source_revision: JSON.parse(job.snapshot_text).queue.source_revision,
      }),
      now: () => at("19:00:00").getTime(),
    });
    await assert.rejects(other(job), /public_check_unconfigured/);
  });
}

function sri2Scene3() {
  test("送る: 19:00 に画像1枚と本文を X に渡し、送った後は item が sent・状態に tweet id が出る", async () => {
    await push();
    const job = await theJob();
    await setClock(at("19:00:00"));
    const x = createMockXAdapter({ postId: "1890000000000000101" });
    const done = await runXSendJob(job.id, {
      store: {
        transition: (id, action, r = {}) => transition(id, action, r),
      },
      x,
      wait: async () => {},
      loadMedia: async () => IMAGE,
      preflight: preflightAt(at("19:00:00")),
      now: () => at("19:00:00").getTime(),
    });
    assert.equal(done.state, "posted", done.error_code);
    const post = x.calls.find((c) => c.method === "createPost");
    assert.equal(post.payload.text, `${CAPTION}\n\n#ボートレース`);
    assert.equal(post.payload.mediaIds.length, 1);
    assert.equal(
      (await first("SELECT state FROM sns_auto_send_items")).state,
      "sent",
    );
    const status = await researchStatus(DAY, { store });
    assert.deepEqual(
      [status.research_id, status.item_state, status.job_state, status.tweet_id],
      [ID, "sent", "posted", "1890000000000000101"],
    );
    // 送った後の同じ日の2本目は入らない
    assert.equal(
      (
        await push(
          bundle({ slug: "next", images: ["next.png"] }),
          { now: at("19:10:00") },
          null,
        )
      ).already,
      true,
    );
  });
  test("記録: 送る前の検査で落ちた job（claim されず queued）は、送り手の最後の報告の precheck の理由を precheck_reason に出す", async () => {
    await push();
    const job = await theJob();
    const report = {
      alerts: [
        { key: "precheck:other:x", text: "別の job" },
        { key: `precheck:${job.id}:research_text_rejected`, text: "検査で止まった" },
      ],
    };
    const status = await researchStatus(DAY, {
      store: { ...store, sendReport: async () => report },
      now: at("19:10:00"),
    });
    assert.equal(status.precheck_reason, "research_text_rejected");
    // 報告を読めなくても状態は返す
    const broken = await researchStatus(DAY, {
      store: { ...store, sendReport: async () => Promise.reject(new Error("HTTP 500")) },
      now: at("19:10:00"),
    });
    assert.equal(broken.precheck_reason, null);
    assert.equal(broken.job_state, "queued");
  });
  test("記録: 送る時刻を過ぎて queued のまま（claim が日の上限で投げている）なら blocked_hint に日の上限を出す", async () => {
    await push();
    await db.exec("UPDATE sns_x_send_control SET daily_external_count=9");
    const status = await researchStatus(DAY, { store, now: at("19:10:00") });
    assert.equal(status.job_state, "queued");
    assert.match(status.blocked_hint, /日の上限/);
    // schedule は純粋関数（送る時刻・締切・期限）
    const when = schedule(bundle(), PUSHED_AT);
    assert.deepEqual(
      [when.send_at, when.deadline_at, when.expires_at],
      [at("19:00:00"), at("21:00:00"), at("20:00:00")].map((d) =>
        d.toISOString(),
      ),
    );
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（db・first・PUSHED_AT・setClock・bundle・store・IMAGE・push・transition・readCurrent） */
export function runSnsResearchImageScenes11(env) {
  ({ db, first, PUSHED_AT, setClock, bundle, store, IMAGE, push, transition, readCurrent } = env);
  sri2Scene1();
  sri2Scene2();
  sri2Scene3();
}
