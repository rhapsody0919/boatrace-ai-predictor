/**
 * verify-sns-finals-image.js の後半の場面（5/5）。verify ではない。
 * 判定と期待値は分ける前の verify-sns-finals-image.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  imageNamesOf,
  checkFinalsImage,
  waitForSend,
  resultLine,
  finalsStatus,
} from "../../sns/push-finals-image.js";
import { clearRows, postMain, replyBundle } from "./sns-finals-image-scenes-3.js";
import { counts, draftOf } from "./sns-finals-image-scenes-1.js";

let db, first, all, riskRules, RACE, NOW, at, PUSHED_AT, png, setClock, bundle, POLL, MAIN_JOB, POLL_JOB, store, push, claim, post;

// ---- BOA-1208: 投票（poll・poll_text）と展示後のリプは任意（オーナー 2026-10-31 に投票のリプ・展示後のリプをやめた） ----

/** hq が poll・poll_text を外した後の束（本投稿の画像4枚＋本文の1本だけ） */
const noPollBundle = (patch = {}) => {
  const { poll: _poll, poll_text: _pollText, ...rest } = bundle(patch);
  return rest;
};

function scene1() {
  test("/code-review の指摘の固定: 送る時刻は受け取りの2分後（承認の途中で本投稿が claim されない）・月の予算も子の分を見る", async () => {
    await setClock(PUSHED_AT);
    const result = await push();
    assert.equal(result.send_at, NOW.toISOString());
    await assert.rejects(claim(result.job_id), /claimできません/);
    await setClock(NOW);
    // 予算: 本投稿だけなら入るが、投票のリプ（URL つきの額）の分は入らない
    await db.exec(
      "UPDATE sns_x_send_control SET reserved_microusd=budget_microusd-250000*2+1",
    );
    await assert.rejects(claim(result.job_id), /月額上限/);
    await db.exec(
      "UPDATE sns_x_send_control SET reserved_microusd=budget_microusd-250000*2",
    );
    assert.equal((await claim(result.job_id)).state, "sending");
  });
  test("/code-review の指摘の固定: begin_post は子の枠を数え直さない（claim の後に他の親の子が増えても止まらない）", async () => {
    await setClock(at("14:02:00"));
    const a = await push(bundle(), { now: at("14:00:00") });
    await db.exec("UPDATE sns_x_send_control SET daily_limit_x=2");
    assert.equal((await claim(a.job_id)).state, "sending");
    const other = "2037-10-26-05-12";
    await db.query("INSERT INTO races VALUES($1,'2037-10-26','17:30:00',NULL)", [
      other,
    ]);
    await db.query("INSERT INTO race_conditions VALUES($1,'優勝戦')", [other]);
    await db.exec("UPDATE sns_x_send_control SET daily_limit_x=4");
    const b = await push(
      bundle({
        race_id: other,
        deadline: "17:30",
        images: imageNamesOf(other),
        poll_text: "あなたの予想は？\n#ボートレース",
      }),
      { now: at("14:00:00") },
      Object.fromEntries(
        imageNamesOf(other).map((n, i) => [n, png(1080, 1350, 500 + i)]),
      ),
    );
    assert.equal((await claim(b.job_id)).state, "sending");
    await db.exec("UPDATE sns_x_send_control SET daily_limit_x=2");
    const begun = await first(
      "SELECT public.transition_sns_x_send($1,'begin_post','{}'::jsonb) r",
      [a.job_id],
    );
    assert.equal(begun.r.state, "reconcile");
  });
  test("/code-review の指摘の固定: 作り直すと前の投票のリプの job は取り消す。展示後のリプの親は item でなく posted の job で探す", async () => {
    const firstPush = await push();
    await db.exec(
      "UPDATE sns_x_send_jobs SET state='held', error_code='source_stale' WHERE parent_job_id IS NULL",
    );
    const retried = await push();
    assert.ok(retried.job_id);
    const old = await first(
      "SELECT state, error_code FROM sns_x_send_jobs WHERE id=$1",
      [firstPush.poll_job_id],
    );
    assert.deepEqual(
      [old.state, old.error_code],
      ["cancelled", "approval_invalidated"],
    );
    // 本投稿を送ったが item が sent でない（要照合の後で手で complete した等）
    await clearRows();
    const main = await postMain();
    await db.exec(
      "UPDATE sns_auto_send_items SET state='notified' WHERE variant='finals'",
    );
    await setClock(at("16:10:00"));
    const reply = await push(replyBundle(), { now: at("16:10:00") });
    assert.ok(reply.job_id, JSON.stringify(reply));
    assert.equal(
      (
        await first("SELECT parent_job_id FROM sns_x_send_jobs WHERE id=$1", [
          reply.job_id,
        ])
      ).parent_job_id,
      main.job_id,
    );
  });
}

function scene2() {
  test("BOA-1208 検査: poll・poll_text が無い束は通る。片方だけは拒否。両方あれば今までどおり4択・poll_text を見る", () => {
    assert.deepEqual(checkFinalsImage(noPollBundle(), riskRules), []);
    assert.deepEqual(
      checkFinalsImage(bundle({ poll: null, poll_text: null }), riskRules),
      [],
    );
    assert.match(
      checkFinalsImage(bundle({ poll: undefined }), riskRules).join(),
      /投票の選択肢/,
    );
    assert.match(
      checkFinalsImage(bundle({ poll_text: undefined }), riskRules).join(),
      /poll_text が無い/,
    );
    assert.deepEqual(checkFinalsImage(bundle(), riskRules), []);
    assert.match(
      checkFinalsImage(bundle({ poll: POLL.slice(0, 3) }), riskRules).join(),
      /4個でない/,
    );
  });
  test("BOA-1208 push: 投票の無い束は本投稿の下書き・item・job を1つずつだけ作り、投票のリプを作らない。日の上限は1本分で数える", async () => {
    const result = await push(noPollBundle());
    assert.equal(result.reasons, undefined, JSON.stringify(result));
    assert.ok(result.job_id);
    assert.equal(result.poll_draft_id, undefined);
    assert.equal(result.poll_item_id, undefined);
    assert.equal(result.poll_job_id, undefined);
    assert.deepEqual(await counts(), { drafts: 1, items: 1, jobs: 1, saved: 4 });
    assert.deepEqual(
      (await all("SELECT variant FROM sns_auto_send_items")).map(
        (r) => r.variant,
      ),
      ["finals"],
    );
    assert.equal(await first(POLL_JOB), undefined);
    assert.equal(await draftOf("poll"), undefined);
    assert.doesNotMatch(result.notes[0], /投票/);
    // 本投稿1本分: 上限2（今日の試行0＋他経路1＋1）に入る。投票ありの束は2本分で入らない
    await clearRows();
    await db.exec(
      "UPDATE sns_x_send_control SET daily_limit_x=2, daily_external_count=1",
    );
    assert.match((await push()).reasons.join(), /日の上限 2 に2本が入らない/);
    assert.ok((await push(noPollBundle())).job_id);
  });
  test("BOA-1208 取り置き: 投票の無い束は finals_image を1本で尋ねる（投票ありは2本のまま）", async () => {
    const asked = [];
    store.xSlotRoom = async (kind, need) => {
      asked.push([kind, need]);
      return { ok: true, kind, need };
    };
    try {
      assert.ok((await push(noPollBundle())).job_id);
      await clearRows();
      assert.ok((await push()).job_id);
      assert.deepEqual(asked, [
        ["finals_image", 1],
        ["finals_image", 2],
      ]);
    } finally {
      delete store.xSlotRoom;
    }
  });
  test("BOA-1208 mode=manual: 投票の無い束は本投稿の item だけを held_manual にする", async () => {
    await db.exec("UPDATE sns_auto_send_control SET mode='manual'");
    const result = await push(noPollBundle());
    assert.equal(result.job_id, undefined);
    assert.deepEqual(
      await all("SELECT variant, state, held_reason FROM sns_auto_send_items"),
      [
        {
          variant: "finals",
          state: "held_manual",
          held_reason: "自動モードでない",
        },
      ],
    );
    assert.match(result.notes[0], /自動モードでないので送らない$/m);
  });
}

function scene3() {
  test("BOA-1208 完了: poll も reply も無い束は、本投稿が posted になれば待ちを抜け exit 0（posted）。--status も poll・reply が null で完了", async () => {
    const result = await push(noPollBundle());
    const main = await first(MAIN_JOB);
    let clock = NOW.getTime();
    let sleeps = 0;
    const status = await waitForSend(RACE, {
      store,
      draftId: result.draft_id,
      // main() と同じ渡し方（投票の無い束は poll_draft_id が無い）
      pollDraftId: result.poll_draft_id ?? null,
      expiresAt: "2037-10-26T07:25:00.000Z",
      now: () => new Date(clock),
      sleep: async (sec) => {
        sleeps += 1;
        clock += sec * 1000;
        if (sleeps === 1)
          await post(main.id, "1890000000000000040", "2037-10-26T07:15:30Z");
      },
    });
    // 本投稿が posted になった次の確認で抜ける（投票のリプも展示後のリプも待たない）
    assert.equal(sleeps, 1);
    assert.equal(status.job_state, "posted");
    assert.equal(status.poll, undefined);
    const line = resultLine(RACE, result, status);
    assert.equal(line.code, 0);
    const parsed = JSON.parse(line.text.replace(/^FINALS_RESULT /, ""));
    assert.equal(parsed.outcome, "posted");
    assert.equal(parsed.reason, null);
    assert.equal(parsed.poll_job_id, null);
    // --status: 本投稿は送った。投票のリプ・展示後のリプは無い（null）で、待つものが無い
    const all3 = await finalsStatus(RACE, { store });
    assert.equal(all3.job_state, "posted");
    assert.equal(all3.tweet_id, "1890000000000000040");
    assert.equal(all3.poll, null);
    assert.equal(all3.reply, null);
    // --status の値を結果の行に通しても「投票のリプが出ていない」にならない
    assert.equal(resultLine(RACE, { part: "main" }, all3).code, 0);
  });
  test("BOA-1208 投票ありは今までどおり: 本投稿だけ posted なら poll_not_posted（exit 5）", async () => {
    const result = await push();
    const main = await first(MAIN_JOB);
    await post(main.id, "1890000000000000050", "2037-10-26T07:15:30Z");
    const status = await finalsStatus(RACE, { store });
    assert.equal(status.poll.job_state, "queued");
    const line = resultLine(RACE, result, status);
    assert.equal(line.code, 5);
    assert.match(line.text, /"outcome":"poll_not_posted"/);
  });
  test("BOA-1208 作り直し: 前の束に投票があって今度の束に無いときも、前の投票のリプの job を取り消す", async () => {
    const firstPush = await push();
    await db.exec(
      "UPDATE sns_x_send_jobs SET state='held', error_code='source_stale' WHERE parent_job_id IS NULL",
    );
    const retried = await push(noPollBundle());
    assert.ok(retried.job_id, JSON.stringify(retried));
    const old = await first(
      "SELECT state, error_code FROM sns_x_send_jobs WHERE id=$1",
      [firstPush.poll_job_id],
    );
    assert.deepEqual(
      [old.state, old.error_code],
      ["cancelled", "approval_invalidated"],
    );
    assert.equal(
      (
        await first(
          "SELECT state FROM sns_auto_send_items WHERE variant='finals_poll'",
        )
      ).state,
      "stopped",
    );
  });
  test('/code-review の指摘の固定（BOA-1208）: 空の印（poll:[]・poll_text:""・空白だけ）も投票なしとして通り、投票のリプを作らない', async () => {
    for (const patch of [
      { poll: [], poll_text: "" },
      { poll: [], poll_text: "  " },
      { poll: null, poll_text: "" },
    ])
      assert.deepEqual(
        checkFinalsImage(bundle(patch), riskRules),
        [],
        JSON.stringify(patch),
      );
    const result = await push(bundle({ poll: [], poll_text: "" }));
    assert.ok(result.job_id, JSON.stringify(result));
    assert.equal(result.poll_job_id, undefined);
    assert.deepEqual(
      (await all("SELECT variant FROM sns_auto_send_items")).map(
        (r) => r.variant,
      ),
      ["finals"],
    );
  });
}

function scene4() {
  test("/code-review の指摘の固定（BOA-1208）: 投票ありの束を投票なしで作り直して送ったら、--status の poll は null（前の試行の止めた投票のリプを出さない）で exit 0", async () => {
    await push();
    await db.exec(
      "UPDATE sns_x_send_jobs SET state='held', error_code='source_stale' WHERE parent_job_id IS NULL",
    );
    const retried = await push(noPollBundle());
    await post(retried.job_id, "1890000000000000070", "2037-10-26T07:15:30Z");
    const status = await finalsStatus(RACE, { store });
    assert.equal(status.job_state, "posted");
    assert.equal(status.tweet_id, "1890000000000000070");
    assert.equal(status.poll, null);
    assert.equal(resultLine(RACE, { part: "main" }, status).code, 0);
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（db・first・all・riskRules・RACE・NOW・at・PUSHED_AT・png・setClock・bundle・POLL・MAIN_JOB・POLL_JOB・store・push・claim・post） */
export function runSnsFinalsImageScenes8(env) {
  ({ db, first, all, riskRules, RACE, NOW, at, PUSHED_AT, png, setClock, bundle, POLL, MAIN_JOB, POLL_JOB, store, push, claim, post } = env);
  scene1();
  scene2();
  scene3();
  scene4();
}
