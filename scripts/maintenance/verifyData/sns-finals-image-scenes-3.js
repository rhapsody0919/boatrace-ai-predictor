/**
 * verify-sns-finals-image.js の後半の場面（3/5）。verify ではない。
 * 判定と期待値は分ける前の verify-sns-finals-image.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resultLine,
  waitForSend,
  checkFinalsImage,
  checkFinalsReply,
} from "../../sns/push-finals-image.js";
import { pollOptionsIssue, pollDurationMinutes } from "../../../api/_lib/snsXSend.js";
import { draftOf } from "./sns-finals-image-scenes-1.js";

let db, first, riskRules, RACE, DEADLINE, NAMES, NOW, at, setClock, bundle, POLL, MAIN_JOB_ID, store, push, claim, post;

export const replyBundle = (patch = {}) => ({
  format: "finals_reply",
  race_id: RACE,
  x_text:
    "展示を見た後の4枚（16:30締切）\n進入は枠なり\n予想は変わった？ リプで教えて！\n#ボートレース",
  deadline: "16:30",
  images: NAMES,
  review: { p0_count: 0, by: "machine" },
  ...patch,
});

export const clearRows = () =>
  db.exec(
    "DELETE FROM sns_metric_jobs; UPDATE sns_x_send_jobs SET parent_job_id=NULL; DELETE FROM sns_x_send_jobs; DELETE FROM sns_auto_send_items; ALTER TABLE sns_drafts DISABLE TRIGGER USER; DELETE FROM sns_drafts; ALTER TABLE sns_drafts ENABLE TRIGGER USER;",
  );

/** 本投稿を 14:00 に受け取り、送り手が送り終えた（投票のリプは queued のまま）ところまで進める */
export async function postMain() {
  await setClock(at("14:02:00"));
  const main = await push(bundle(), { now: at("14:00:00") });
  await post(main.job_id, "1890000000000000010", "2037-10-26T05:01:00Z");
  return main;
}

function scene1() {
  test("CLI の結果の1行と exit: 送った 0・拒否 1・許可 off 3・既にある 4・送れなかった 5。最後の行は FINALS_RESULT の JSON", () => {
    const posted = resultLine(
      RACE,
      { job_id: "j1" },
      {
        job_id: "j1",
        job_state: "posted",
        tweet_id: "189",
        tweet_url: "https://x.com/i/status/189",
        posted_at: "2037-10-26T07:16:30Z",
        error_code: null,
        poll: {
          job_id: "j2",
          job_state: "posted",
          tweet_id: "190",
          error_code: null,
        },
      },
    );
    assert.equal(posted.code, 0);
    const postedLine = JSON.parse(posted.text.slice("FINALS_RESULT ".length));
    assert.deepEqual(
      [
        postedLine.part,
        postedLine.poll_job_id,
        postedLine.poll_job_state,
        postedLine.poll_tweet_id,
      ],
      ["main", "j2", "posted", "190"],
    );
    // 本投稿は出たが投票のリプが出ていない（held 等）は 5（hq が知らせる）
    const noPoll = resultLine(
      RACE,
      { job_id: "j1" },
      {
        job_id: "j1",
        job_state: "posted",
        poll: {
          job_id: "j2",
          job_state: "held",
          error_code: "parent_not_posted",
        },
      },
    );
    assert.equal(noPoll.code, 5);
    assert.match(noPoll.text, /"outcome":"poll_not_posted"/);
    // 展示後のリプ（part=reply）は投票を見ない
    assert.equal(
      resultLine(
        RACE,
        { part: "reply", job_id: "j3" },
        { job_id: "j3", job_state: "posted" },
      ).code,
      0,
    );
    assert.match(
      posted.text,
      /^FINALS_RESULT \{.*"outcome":"posted".*"tweet_id":"189".*"job_id":"j1"|^FINALS_RESULT \{.*"job_id":"j1".*"tweet_id":"189"/,
    );
    assert.equal(
      JSON.parse(posted.text.slice("FINALS_RESULT ".length)).posted_at,
      "2037-10-26T07:16:30Z",
    );
    assert.equal(resultLine(RACE, { reasons: ["x"] }).code, 1);
    const off = resultLine(RACE, { dryRun: true, disabled: true });
    assert.equal(off.code, 3);
    assert.match(off.text, /finals_image_enabled/);
    assert.equal(resultLine(RACE, { dryRun: true, disabled: false }).code, 0);
    assert.equal(
      resultLine(
        RACE,
        { job_id: "j1" },
        { job_id: "j1", job_state: "held", error_code: "deadline_expired" },
      ).code,
      5,
    );
    assert.equal(resultLine(RACE, { draft_id: "d", item_id: "i" }).code, 5); // 個別承認・承認の失敗
    // --no-wait は予定に入れたら 0。待ったのに送れていない（止められた・要照合のまま）は 5
    assert.equal(resultLine(RACE, { job_id: "j1" }).code, 0);
    assert.equal(
      resultLine(RACE, { job_id: "j1" }, { job_id: "j1", job_state: "reconcile" })
        .code,
      5,
    );
    assert.equal(
      resultLine(RACE, { job_id: "j1" }, null, { waited: true }).code,
      5,
    );
    assert.ok(!posted.text.includes("\n"));
  });
}

function scene2() {
  test("待つ: 送り手が送り終えたら（posted）返し、送らないまま期限＋90秒を過ぎたら返す", async () => {
    await push();
    const job = await first(MAIN_JOB_ID);
    let clock = NOW.getTime();
    let sleeps = 0;
    // 2回目の確かめで送り手が送り終えた
    const draftId = (await draftOf("main")).id;
    const status = await waitForSend(RACE, {
      store,
      draftId,
      expiresAt: "2037-10-26T07:25:00.000Z",
      now: () => new Date(clock),
      sleep: async (sec) => {
        sleeps += 1;
        clock += sec * 1000;
        if (sleeps === 1) {
          await claim(job.id);
          await first(
            "SELECT public.transition_sns_x_send($1,'begin_post','{}'::jsonb)",
            [job.id],
          );
          await first(
            "SELECT public.transition_sns_x_send($1,'complete',$2::jsonb)",
            [
              job.id,
              JSON.stringify({
                id: "1890000000000000002",
                posted_at: "2037-10-26T07:15:30Z",
              }),
            ],
          );
        }
      },
    });
    assert.equal(status.job_state, "posted");
    assert.equal(status.tweet_id, "1890000000000000002");
    assert.equal(sleeps, 1);
    // 送っている途中（reconcile）は待ち続ける
    await db.exec("UPDATE sns_x_send_jobs SET state='reconcile'");
    let polls = 0;
    clock = NOW.getTime();
    const inFlight = await waitForSend(RACE, {
      store,
      draftId,
      expiresAt: "2037-10-26T07:25:00.000Z",
      now: () => new Date(clock),
      sleep: async (sec) => {
        polls += 1;
        clock += sec * 1000;
        if (polls === 2)
          await db.exec("UPDATE sns_x_send_jobs SET state='posted'");
      },
    });
    assert.equal(inFlight.job_state, "posted");
    assert.equal(polls, 2);
    // 送られないまま（queued）期限を過ぎた
    await db.exec(
      "UPDATE sns_x_send_jobs SET state='queued', external_post_id=NULL, posted_at=NULL, external_post_url=NULL",
    );
    clock = Date.parse("2037-10-26T07:26:31.000Z");
    const late = await waitForSend(RACE, {
      store,
      draftId,
      expiresAt: "2037-10-26T07:25:00.000Z",
      now: () => new Date(clock),
      sleep: async () => assert.fail("期限＋90秒の後は待たない"),
    });
    assert.equal(late.job_state, "queued");
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（db・first・riskRules・RACE・DEADLINE・NAMES・NOW・at・setClock・bundle・POLL・MAIN_JOB_ID・store・push・claim） */
export function runSnsFinalsImageScenes4(env) {
  ({ db, first, riskRules, RACE, DEADLINE, NAMES, NOW, at, setClock, bundle, POLL, MAIN_JOB_ID, store, push, claim } = env);
  scene1();
  scene2();
}

function scene3() {
  test("177: variant の finals_poll・finals_reply は kind=finals_image・X だけ。種類ごとに1レース1件", async () => {
    const insert = (kind, channel, variant) =>
      db.query(
        `WITH draft AS (INSERT INTO sns_drafts(content_group_id,platform,language,format,caption_text)
           VALUES(gen_random_uuid(), $2, 'ja', $1, '177') RETURNING id)
         INSERT INTO sns_auto_send_items(kind,variant,draft_id,channel,race_id,deadline_at,notify_by,veto_until)
         SELECT $1, $3, id, $2, 'r177', test_now()+interval '3h', test_now(), test_now()+interval '1h' FROM draft`,
        [kind, channel, variant],
      );
    await assert.rejects(
      insert("full_picture", "x", "finals_poll"),
      /variant_scope/,
    );
    await assert.rejects(
      insert("finals_image", "youtube", "finals_reply"),
      /kind_source|variant_scope/,
    );
    await assert.rejects(
      insert("finals_image", "x", "finals_other"),
      /variant_check/,
    );
    for (const variant of ["finals", "finals_poll", "finals_reply"])
      await insert("finals_image", "x", variant);
    await assert.rejects(
      insert("finals_image", "x", "finals_poll"),
      /sns_auto_send_items_race_channel/,
    );
    await assert.rejects(
      insert("finals_image", "x", "finals_reply"),
      /sns_auto_send_items_race_channel/,
    );
  });
  test("投票の検査: 4択・各25字まで（コードポイント）・空と重なりなし、poll_text は本投稿と同じ検査", () => {
    assert.equal(pollOptionsIssue(POLL), null);
    assert.equal(pollOptionsIssue(["あ".repeat(25), "い"]), null);
    assert.match(pollOptionsIssue(["あ".repeat(26), "い"]), /25字/);
    assert.match(pollOptionsIssue(["a"]), /2〜4個/);
    assert.match(pollOptionsIssue(["a", "b", "c", "d", "e"]), /2〜4個/);
    assert.match(pollOptionsIssue(["a", " "]), /空/);
    assert.match(pollOptionsIssue(["a", "a"]), /重なって/);
    assert.match(pollOptionsIssue(undefined), /2〜4個/);
    // 本投稿の bundle は4択ちょうど
    assert.deepEqual(checkFinalsImage(bundle(), riskRules), []);
    assert.match(
      checkFinalsImage(bundle({ poll: POLL.slice(0, 3) }), riskRules).join(),
      /4個でない/,
    );
    assert.match(
      checkFinalsImage(bundle({ poll: undefined }), riskRules).join(),
      /選択肢/,
    );
    assert.match(
      checkFinalsImage(
        bundle({
          poll: [...POLL.slice(0, 3), "あ".repeat(26)],
        }),
        riskRules,
      ).join(),
      /25字/,
    );
    assert.match(
      checkFinalsImage(bundle({ poll_text: "" }), riskRules).join(),
      /poll_text が無い/,
    );
    assert.match(
      checkFinalsImage(bundle({ poll_text: "儲かる投票" }), riskRules).join(),
      /poll_text の禁止表現/,
    );
    assert.match(
      checkFinalsImage(bundle({ poll_text: "あ".repeat(141) }), riskRules).join(),
      /poll_text が X の加重280/,
    );
    // 展示後のリプは投票を持たず、本文・画像・P0 を本投稿と同じに見る
    assert.deepEqual(checkFinalsReply(replyBundle(), riskRules), []);
    assert.match(
      checkFinalsReply(replyBundle({ x_text: "競艇の展示" }), riskRules).join(),
      /禁止表現/,
    );
    assert.match(
      checkFinalsReply(replyBundle({ format: "finals_image" }), riskRules).join(),
      /format/,
    );
    assert.match(
      checkFinalsReply(
        replyBundle({ images: NAMES.slice(0, 3) }),
        riskRules,
      ).join(),
      /images が/,
    );
  });
}

function scene4() {
  test("投票の時間: 送る時の今から締切までの分（切り捨て）、最小5・最大10080", () => {
    assert.equal(pollDurationMinutes(DEADLINE, at("16:16:00").getTime()), 14);
    assert.equal(pollDurationMinutes(DEADLINE, at("16:16:30").getTime()), 13);
    assert.equal(pollDurationMinutes(DEADLINE, at("16:27:00").getTime()), 5);
    assert.equal(pollDurationMinutes(DEADLINE, at("16:40:00").getTime()), 5);
    assert.equal(
      pollDurationMinutes(DEADLINE, Date.parse("2037-10-01T00:00:00Z")),
      10080,
    );
    assert.equal(pollDurationMinutes(DEADLINE, at("13:30:00").getTime()), 180);
    assert.throws(() => pollDurationMinutes("x", 0), /poll_closes_at_invalid/);
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（db・first・riskRules・RACE・DEADLINE・NAMES・NOW・at・setClock・bundle・POLL・MAIN_JOB_ID・store・push・claim・post） */
export function runSnsFinalsImageScenes5(env) {
  ({ db, first, riskRules, RACE, DEADLINE, NAMES, NOW, at, setClock, bundle, POLL, MAIN_JOB_ID, store, push, claim, post } = env);
  scene3();
  scene4();
}
