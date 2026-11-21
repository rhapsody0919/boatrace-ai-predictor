/**
 * verify-sns-finals-image.js の後半の場面（1/5）。verify ではない。
 * 判定と期待値は分ける前の verify-sns-finals-image.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { checkFinalsImage, BANNED_WORDS, checkImages, pngSize } from "../../sns/push-finals-image.js";

let db, first, riskRules, RACE, DEADLINE, NAMES, NOW, at, png, setClock, bundle, IMAGES, MAIN_JOB, MAIN_JOB_ID, saved, push, claim;

export const draftOf = (part) =>
  first(
    "SELECT * FROM sns_drafts WHERE source_data->'finals_image'->>'part'=$1",
    [part],
  );

export const counts = async () => ({
  drafts: Number((await first("SELECT count(*) n FROM sns_drafts")).n),
  items: Number((await first("SELECT count(*) n FROM sns_auto_send_items")).n),
  jobs: Number((await first("SELECT count(*) n FROM sns_x_send_jobs")).n),
  saved: saved.length,
});

export const NOTHING = { drafts: 0, items: 0, jobs: 0, saved: 0 };

/** verify から呼ぶ入口。env は verify 側の束縛（db・first・riskRules・RACE・DEADLINE・NAMES・NOW・at・png・setClock・bundle・IMAGES・MAIN_JOB・MAIN_JOB_ID） */
export function runSnsFinalsImageScenes1(env) {
  ({ db, first, riskRules, RACE, DEADLINE, NAMES, NOW, at, png, setClock, bundle, IMAGES, MAIN_JOB, MAIN_JOB_ID } = env);

}

function scene1() {
  test("176: finals_image の item は X だけ・variant=finals だけ。finals_image でない item は finals にできない。許可は既定 false", async () => {
    const insert = (kind, channel, variant) =>
      db.query(
        `WITH draft AS (INSERT INTO sns_drafts(content_group_id,platform,language,format,caption_text)
           VALUES(gen_random_uuid(), $2, 'ja', $1, '176') RETURNING id)
         INSERT INTO sns_auto_send_items(kind,variant,draft_id,channel,race_id,deadline_at,notify_by,veto_until)
         SELECT $1, $3, id, $2, 'r176', test_now()+interval '3h', test_now(), test_now()+interval '1h' FROM draft`,
        [kind, channel, variant],
      );
    await assert.rejects(
      insert("finals_image", "youtube", "finals"),
      /kind_source|variant_scope/,
    );
    await assert.rejects(insert("finals_image", "x", "main"), /variant_scope/);
    await assert.rejects(insert("full_picture", "x", "finals"), /variant_scope/);
    await insert("finals_image", "x", "finals");
    // 同じ優勝戦の全貌（full_picture・x・main）とは両立する
    await insert("full_picture", "x", "main");
    // 生きている finals_image は1レース1件（一意の索引 race_id・channel・variant）
    await assert.rejects(
      insert("finals_image", "x", "finals"),
      /sns_auto_send_items_race_channel/,
    );
    const def = await first(
      "SELECT column_default d FROM information_schema.columns WHERE table_name='sns_auto_send_control' AND column_name='finals_image_enabled'",
    );
    assert.equal(def.d, "false");
    // 許可は x の行だけ
    await assert.rejects(
      db.query(
        "UPDATE sns_auto_send_control SET finals_image_enabled=true WHERE channel='youtube'",
      ),
      /finals_image_x_only/,
    );
  });
  test("許可が off なら、検査が通っても何も書かない（DB・Storage・Slack とも。disabled で返り、CLI は exit 3）", async () => {
    await db.exec("UPDATE sns_auto_send_control SET finals_image_enabled=false");
    const result = await push();
    assert.equal(result.reasons, undefined);
    assert.equal(result.disabled, true);
    assert.equal(result.enabled, false);
    assert.deepEqual(await counts(), NOTHING);
    assert.deepEqual(result.notes, []);
    // off の間の拒否も Slack に流さない（--dry-run と同じ）
    const rejected = await push(bundle({ review: { p0_count: 1 } }));
    assert.match(rejected.reasons.join(), /P0/);
    assert.deepEqual(rejected.notes, []);
  });
  test("--dry-run は許可が on でも何も書かない", async () => {
    const result = await push(bundle(), { dryRun: true });
    assert.equal(result.dryRun, true);
    assert.equal(result.enabled, true);
    assert.equal(result.disabled, false);
    assert.deepEqual(await counts(), NOTHING);
  });
  test("許可が on・mode=auto なら、画像4枚を1件の job にして今すぐ送る予定に入れる（期限は締切の5分前）。claim は待たずにでき、日次の枠に1本で数える", async () => {
    const result = await push();
    assert.equal(result.reasons, undefined);
    assert.equal(result.send_at, NOW.toISOString());
    const item = await first(
      "SELECT * FROM sns_auto_send_items WHERE variant='finals'",
    );
    assert.deepEqual(
      [item.kind, item.variant, item.channel, item.state],
      ["finals_image", "finals", "x", "notified"],
    );
    const job = await first(MAIN_JOB);
    const auto = (
      await first(
        "SELECT auto_approver_id FROM sns_auto_send_control WHERE channel='x'",
      )
    ).auto_approver_id;
    assert.equal(job.approver_id, auto);
    assert.equal(job.auto_item_id, item.id);
    assert.equal(job.scheduled_at.toISOString(), NOW.toISOString());
    assert.equal(job.expires_at.toISOString(), "2037-10-26T07:25:00.000Z");
    assert.equal(job.parent_job_id, null);
    const snapshot = JSON.parse(job.snapshot_text);
    assert.deepEqual(
      snapshot.media.map((m) => [m.path.split("/").at(-1), m.type]),
      NAMES.map((name) => [name, "image/png"]),
    );
    assert.equal(snapshot.text, bundle().x_text);
    assert.equal(snapshot.queue.thread_length, undefined);
    assert.equal(saved.length, 4);
    assert.match(result.notes[0], /今すぐ送る/);
    assert.match(result.notes[0], /finals_image_enabled = false/);
    // 送る時刻＝今。全貌の veto（60分前）を待たない
    const r = await claim(job.id);
    assert.equal(r.state, "sending");
    assert.deepEqual(r.attempt_channels, ["x"]);
  });
}

function scene2() {
  test("claim の時も許可を見る: 承認の後に off にすると held（finals_image_disabled）で送らない", async () => {
    await push();
    const job = await first(MAIN_JOB_ID);
    await db.exec("UPDATE sns_auto_send_control SET finals_image_enabled=false");
    const r = await claim(job.id);
    assert.equal(r.state, "held");
    assert.equal(r.error_code, "finals_image_disabled");
  });
  test("claim の時間の窓: 締切の5分前（期限）を過ぎたら deadline_expired。全貌など finals_image でない job の期限は30分前のまま", async () => {
    await push();
    const job = await first(MAIN_JOB_ID);
    await setClock(at("16:25:00"));
    const r = await claim(job.id);
    assert.equal(r.state, "held");
    assert.equal(r.error_code, "deadline_expired");
    // finals_image でない job に5分前の期限を入れると、今までどおり deadline_policy_changed
    await db.exec(
      "UPDATE sns_auto_send_items SET kind='full_picture', variant='main' WHERE variant='finals'",
    );
    await db.exec(
      "UPDATE sns_x_send_jobs SET state='queued', error_code=NULL WHERE parent_job_id IS NULL",
    );
    await setClock(at("16:20:00"));
    const other = await claim(job.id);
    assert.equal(other.error_code, "deadline_policy_changed");
  });
  test("締切の15分前を過ぎて届いたら受け取らない（15分前ちょうどは拒否、その1秒前は受け取る。投票のリプを期限までに送る分を残す）", async () => {
    const late = await push(bundle(), { now: at("16:15:00") });
    assert.match(late.reasons.join(), /15分前を過ぎた/);
    assert.deepEqual(await counts(), NOTHING);
    const ok = await push(bundle(), { now: at("16:14:59") });
    assert.equal(ok.reasons, undefined);
    assert.ok(ok.job_id);
  });
  test("検査: 禁止表現（各語と risk-rules）・加重280・置き場所・別レースのリンク・P0・deadline が無い", () => {
    assert.deepEqual(checkFinalsImage(bundle(), riskRules), []);
    for (const word of BANNED_WORDS)
      assert.match(
        checkFinalsImage(bundle({ x_text: `優勝戦、${word}` }), riskRules).join(),
        /禁止表現/,
        word,
      );
    // 加重280: 全角140字はちょうど、141字は超える
    assert.deepEqual(
      checkFinalsImage(bundle({ x_text: "あ".repeat(140) }), riskRules),
      [],
    );
    assert.match(
      checkFinalsImage(bundle({ x_text: "あ".repeat(141) }), riskRules).join(),
      /280/,
    );
    assert.match(
      checkFinalsImage(bundle({ x_text: "予想は{answer}" }), riskRules).join(),
      /置き場所/,
    );
    assert.match(
      checkFinalsImage(
        bundle({
          x_text: "優勝戦 https://www.boat-ai.jp/race/2037-10-26-01-12?tab=sonar",
        }),
        riskRules,
      ).join(),
      /リンク/,
    );
    assert.deepEqual(
      checkFinalsImage(
        bundle({
          x_text: `優勝戦 https://www.boat-ai.jp/race/${RACE}?tab=sonar`,
        }),
        riskRules,
      ),
      [],
    );
    assert.match(
      checkFinalsImage(
        bundle({ review: { p0_count: 1, by: "machine" } }),
        riskRules,
      ).join(),
      /P0/,
    );
    assert.match(
      checkFinalsImage(bundle({ deadline: DEADLINE }), riskRules).join(),
      /deadline/,
    );
    assert.match(
      checkFinalsImage(bundle({ format: "full_picture" }), riskRules).join(),
      /format/,
    );
  });
}

function scene3() {
  test("検査: 画像は4枚・PNG・1080×1350・1〜5,000,000 バイト", () => {
    assert.deepEqual(checkImages(NAMES, IMAGES()), []);
    assert.deepEqual(pngSize(png(1080, 1350)), { width: 1080, height: 1350 });
    const missing = IMAGES();
    delete missing[NAMES[2]];
    assert.match(checkImages(NAMES, missing).join(), /3-q3.png が無い/);
    assert.match(
      checkImages(NAMES, { ...IMAGES(), [NAMES[1]]: png(1080, 1440) }).join(),
      /1080×1350 でない/,
    );
    assert.match(
      checkImages(NAMES, { ...IMAGES(), [NAMES[0]]: new Uint8Array(300) }).join(),
      /PNG でない/,
    );
    assert.match(
      checkImages(NAMES, {
        ...IMAGES(),
        [NAMES[3]]: png(1080, 1350, 5000000),
      }).join(),
      /大きさが不正/,
    );
    assert.deepEqual(
      checkImages(NAMES, {
        ...IMAGES(),
        [NAMES[3]]: png(1080, 1350, 5000000 - 24),
      }),
      [],
    );
    // images は4つ・名前の形・この順。ほかの名前（HTML 等）は読まない
    assert.deepEqual(checkFinalsImage(bundle(), riskRules), []);
    for (const images of [
      NAMES.slice(0, 3),
      [NAMES[1], NAMES[0], NAMES[2], NAMES[3]],
      ["1-map.png", "2-q12.png", "3-q3.png", "4-routes.png"],
      [...NAMES.slice(0, 3), `${RACE}-4-routes.html`],
      undefined,
    ])
      assert.match(
        checkFinalsImage(bundle({ images }), riskRules).join(),
        /images が/,
      );
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（db・first・riskRules・RACE・DEADLINE・NAMES・NOW・at・png・setClock・bundle・IMAGES・MAIN_JOB・MAIN_JOB_ID・saved・push・claim） */
export function runSnsFinalsImageScenes2(env) {
  ({ db, first, riskRules, RACE, DEADLINE, NAMES, NOW, at, png, setClock, bundle, IMAGES, MAIN_JOB, MAIN_JOB_ID, saved, push, claim } = env);
  scene1();
  scene2();
  scene3();
}
