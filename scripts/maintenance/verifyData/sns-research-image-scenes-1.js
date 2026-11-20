/**
 * verify-sns-research-image.js の後半の場面（1/2）。verify ではない。
 * 判定と期待値は分ける前の verify-sns-research-image.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { resultLine, researchStatus } from "../../sns/push-research-image.js";
import { parseResearchId, researchTextReasons } from "../../../api/_lib/snsResearchImage.js";
import { createDeadlinePreflight } from "../../../api/_lib/snsDeadlineQueue.js";
import { SCREEN_MARKERS } from "../../lib/snsScreenMarkers.js";

let db, first, PUSHED_AT, OBSERVED, readMigration, setClock, bundle, store, push, transition, readCurrent, sriT1;

export const DAY = "2037-10-28";

export const SLUG = "not-wakunari";

export const ID = `research:${DAY}:${SLUG}`;

export const at = (hhmmss) => new Date(`${DAY}T${hhmmss}+09:00`);

/** 最小の PNG（署名と IHDR の幅・高さだけ。検査は IHDR だけを読む） */
export function png(width = 1080, height = 1350, padding = 200) {
  const bytes = new Uint8Array(24 + padding);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  bytes[24] = padding % 251;
  return bytes;
}

export const CAPTION =
  "【数字で見たら】5レースに1つは枠なりじゃない\n\n全国は 19.0%（直近1年 55,414レース）\nほぼ動かないのは江戸川だけ 1.6%\n\n地元の会場、体感と合ってた？";

export const saved = [];

export const counts = async () => ({
  drafts: Number((await first("SELECT count(*) n FROM sns_drafts")).n),
  items: Number((await first("SELECT count(*) n FROM sns_auto_send_items")).n),
  jobs: Number((await first("SELECT count(*) n FROM sns_x_send_jobs")).n),
  saved: saved.length,
});

export const NOTHING = { drafts: 0, items: 0, jobs: 0, saved: 0 };

export const theJob = () => first("SELECT * FROM sns_x_send_jobs");

export const preflightAt = (now, headless = null) =>
  createDeadlinePreflight({
    headless,
    markers: SCREEN_MARKERS,
    readCurrent,
    now: () => now.getTime(),
  });

/** test("検査: 禁止表現（各語・本文の「競艇」・risk-rules）・#競艇 のタグは可・加重280・リンク・置き場所・本文のハッシュ の中身を割った 2/2 */
function sriT2() {
  assert.equal(parseResearchId(ID).slug, SLUG);
  assert.equal(parseResearchId("research:2037-10-28:Bad"), null);
  // 本文が空
  assert.deepEqual(researchTextReasons({ caption: "", hashtags: [] }), [
    "x_text が無い",
  ]);
}

/** verify から呼ぶ入口。env は verify 側の束縛（db・first・sriT1） */
export function runSnsResearchImageScenes1(env) {
  ({ db, first, sriT1 } = env);

}

/** verify から呼ぶ入口。env は verify 側の束縛（db・first・PUSHED_AT・OBSERVED・sriT1） */
export function runSnsResearchImageScenes2(env) {
  ({ db, first, PUSHED_AT, OBSERVED, sriT1 } = env);

}

function sri1Scene1() {
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
    await db.exec(`
    CREATE TABLE races(race_id VARCHAR PRIMARY KEY, race_date DATE, start_time TIME, cancellation_status TEXT);
    CREATE TABLE race_conditions(race_id VARCHAR PRIMARY KEY, race_stage VARCHAR);`);
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
      "179_sns_research_image_items.sql",
      "180_sns_research_image_send.sql",
    ])
      await db.exec((await readMigration(file)).replaceAll("now()", "test_now()"));
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（db・first・PUSHED_AT・OBSERVED・readMigration・sriT1） */
export function runSnsResearchImageScenes3(env) {
  ({ db, first, PUSHED_AT, OBSERVED, readMigration, sriT1 } = env);
  sri1Scene1();
}

function sri1Scene2() {
  after(() => db.close());
}

/** verify から呼ぶ入口。env は verify 側の束縛（db・first・PUSHED_AT・OBSERVED・readMigration・sriT1） */
export function runSnsResearchImageScenes4(env) {
  ({ db, first, PUSHED_AT, OBSERVED, readMigration, sriT1 } = env);
  sri1Scene2();
}

/** verify から呼ぶ入口。env は verify 側の束縛（db・first・PUSHED_AT・OBSERVED・readMigration・setClock・sriT1） */
export function runSnsResearchImageScenes5(env) {
  ({ db, first, PUSHED_AT, OBSERVED, readMigration, setClock, sriT1 } = env);

}

/** verify から呼ぶ入口。env は verify 側の束縛（db・first・PUSHED_AT・OBSERVED・readMigration・setClock・bundle・sriT1） */
export function runSnsResearchImageScenes6(env) {
  ({ db, first, PUSHED_AT, OBSERVED, readMigration, setClock, bundle, sriT1 } = env);

}

/** verify から呼ぶ入口。env は verify 側の束縛（db・first・PUSHED_AT・OBSERVED・readMigration・setClock・bundle・store・push・transition・sriT1） */
export function runSnsResearchImageScenes7(env) {
  ({ db, first, PUSHED_AT, OBSERVED, readMigration, setClock, bundle, store, push, transition, sriT1 } = env);

}

/** verify から呼ぶ入口。env は verify 側の束縛（db・first・PUSHED_AT・OBSERVED・readMigration・setClock・bundle・store・push・transition・readCurrent・sriT1） */
export function runSnsResearchImageScenes8(env) {
  ({ db, first, PUSHED_AT, OBSERVED, readMigration, setClock, bundle, store, push, transition, readCurrent, sriT1 } = env);

}

function sri1Scene3() {
  test("179: research_image の item は X・variant=main・race_id は research:{日}:{slug} だけ。1日1本（別の slug も、送った後も入らない）。許可は既定 false・x の行だけ", async () => {
    const insert = (channel, raceId, variant = "main", state = "checking") =>
      db.query(
        `WITH draft AS (INSERT INTO sns_drafts(content_group_id,platform,language,format,caption_text)
         VALUES(gen_random_uuid(), $1, 'ja', 'research_image', '179') RETURNING id)
       INSERT INTO sns_auto_send_items(kind,variant,draft_id,channel,race_id,deadline_at,notify_by,veto_until,state)
       SELECT 'research_image', $3, id, $1, $2, test_now()+interval '3h', test_now(), test_now()+interval '1h', $4 FROM draft`,
        [channel, raceId, variant, state],
      );
    await assert.rejects(insert("youtube", ID), /kind_source/);
    await assert.rejects(insert("x", "2037-10-28-01-12"), /research_id/);
    await assert.rejects(insert("x", `research:${DAY}:Bad_Slug`), /research_id/);
    await assert.rejects(insert("x", ID, "finals"), /variant_scope|research_id/);
    await insert("x", ID);
    await assert.rejects(
      insert("x", `research:${DAY}:other-topic`),
      /sns_auto_send_items_research_day/,
    );
    // 別の日は入る
    await insert("x", "research:2037-10-30:other-topic");
    // 送った（sent）後も同じ日の2本目は入らない。止めた（stopped）・held_manual は外れる
    await db.exec(
      "UPDATE sns_auto_send_items SET state='sent', checks='{\"passed\":true}' WHERE race_id LIKE 'research:2037-10-28:%'",
    );
    await assert.rejects(
      insert("x", `research:${DAY}:third`),
      /sns_auto_send_items_research_day/,
    );
    await insert("x", `research:${DAY}:third`, "main", "held_manual");
    const def = await first(
      "SELECT column_default d FROM information_schema.columns WHERE table_name='sns_auto_send_control' AND column_name='research_image_enabled'",
    );
    assert.equal(def.d, "false");
    await assert.rejects(
      db.query(
        "UPDATE sns_auto_send_control SET research_image_enabled=true WHERE channel='youtube'",
      ),
      /research_image_x_only/,
    );
  });
  test("許可が off なら、検査が通っても何も書かない（DB・Storage・Slack とも。disabled・exit 3）。--dry-run も書かない", async () => {
    await db.exec(
      "UPDATE sns_auto_send_control SET research_image_enabled=false",
    );
    const off = await push();
    assert.equal(off.reasons, undefined);
    assert.equal(off.disabled, true);
    assert.deepEqual(await counts(), NOTHING);
    assert.deepEqual(off.notes, []);
    assert.equal(resultLine(off).code, 3);
    assert.match(resultLine(off).text, /^RESEARCH_RESULT .*"outcome":"disabled"/);
    await db.exec(
      "UPDATE sns_auto_send_control SET research_image_enabled=(channel='x')",
    );
    const dry = await push(bundle(), { dryRun: true });
    assert.equal(dry.dryRun, true);
    assert.equal(dry.disabled, false);
    assert.deepEqual(await counts(), NOTHING);
    assert.equal(resultLine(dry).code, 0);
  });
}

function sri1Scene4() {
  test("許可が on・mode=auto: 画像1枚の job を 19:00 の予定に入れる（締切 21:00・期限 20:00）。race_id の代わりは research:{日}:{slug}", async () => {
    const result = await push();
    assert.equal(result.reasons, undefined);
    assert.equal(result.research_id, ID);
    assert.equal(result.send_at, at("19:00:00").toISOString());
    const item = await first("SELECT * FROM sns_auto_send_items");
    assert.deepEqual(
      [item.kind, item.variant, item.channel, item.state, item.race_id],
      ["research_image", "main", "x", "notified", ID],
    );
    assert.equal(item.deadline_at.toISOString(), at("21:00:00").toISOString());
    assert.equal(item.veto_until.toISOString(), at("19:00:00").toISOString());
    const job = await theJob();
    assert.equal(job.auto_item_id, item.id);
    assert.equal(job.scheduled_at.toISOString(), at("19:00:00").toISOString());
    assert.equal(job.expires_at.toISOString(), at("20:00:00").toISOString());
    const snapshot = JSON.parse(job.snapshot_text);
    assert.equal(snapshot.text, `${CAPTION}\n\n#ボートレース`);
    assert.equal(snapshot.media.length, 1);
    assert.equal(snapshot.media[0].type, "image/png");
    assert.equal(snapshot.queue.source_observed_at, OBSERVED);
    assert.equal(snapshot.queue.public_url, undefined);
    assert.equal(saved.length, 1);
    assert.match(result.notes[0], /19:00 に送る/);
    assert.match(result.notes[0], /research_image_enabled = false/);
    assert.equal(resultLine(result).code, 0);
    assert.match(resultLine(result).text, /"outcome":"queued"/);
    // 同じ日の2回目（別の題も）は何も作らず exit 4
    const again = await push(
      bundle({ slug: "other", images: ["other.png"] }),
      {},
      null,
    );
    assert.equal(again.already, true);
    assert.equal(resultLine(again).code, 4);
    assert.equal((await counts()).items, 1);
  });
  test("claim の時間の窓: 19:00 の前は送らない。19:00 に送れる（集計から4.5時間でも鮮度で止まらない）。20:00（期限）で deadline_expired", async () => {
    await push();
    const job = await theJob();
    await setClock(at("18:58:00"));
    await assert.rejects(
      transition(job.id, "claim"),
      /veto_window_open|claimできません/,
    );
    await setClock(at("19:00:00"));
    const r = await transition(job.id, "claim");
    assert.equal(r.state, "sending", r.error_code);
    // 期限の照合: 別の job で、期限の 20:00 に claim すると deadline_expired
    await db.exec(
      "DELETE FROM sns_x_send_jobs; DELETE FROM sns_auto_send_items;",
    );
    await setClock(PUSHED_AT);
    await push();
    await setClock(at("20:00:00"));
    const late = await transition((await theJob()).id, "claim");
    assert.equal(late.state, "held");
    assert.equal(late.error_code, "deadline_expired");
  });
  test("鮮度は research_image だけ24時間: 他の kind の4時間（max_source_age_seconds）は変わらない", async () => {
    await push();
    const job = await theJob();
    await setClock(at("19:00:00"));
    // research_image の item を digest に変えると、集計の 14:30 から4時間を越えて source_stale（他の kind の動きは今までどおり）
    await db.exec(
      "UPDATE sns_auto_send_items SET kind='digest', race_id='today:2037-10-28'",
    );
    // digest の期限は expiry_minutes=30（締切 21:00 の30分前）なので、期限の照合を通すために合わせる
    await db.query(
      "UPDATE sns_x_send_jobs SET expires_at=$2::timestamptz, snapshot=jsonb_set(snapshot,'{queue,expires_at}',to_jsonb($3::text)) WHERE id=$1",
      [job.id, at("20:30:00").toISOString(), at("20:30:00").toISOString()],
    );
    const r = await transition(job.id, "claim");
    assert.equal(r.state, "held");
    assert.equal(r.error_code, "source_stale");
  });
  test("claim の時も許可を見る: 承認の後に off にすると held（research_image_disabled）", async () => {
    await push();
    await db.exec(
      "UPDATE sns_auto_send_control SET research_image_enabled=false",
    );
    await setClock(at("19:00:00"));
    const r = await transition((await theJob()).id, "claim");
    assert.equal(r.state, "held");
    assert.equal(r.error_code, "research_image_disabled");
    const status = await researchStatus(DAY, { store, now: at("19:01:00") });
    assert.deepEqual(
      [status.research_id, status.job_state, status.error_code],
      [ID, "held", "research_image_disabled"],
    );
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（db・first・PUSHED_AT・OBSERVED・readMigration・setClock・bundle・store・push・transition・readCurrent・sriT1） */
export function runSnsResearchImageScenes9(env) {
  ({ db, first, PUSHED_AT, OBSERVED, readMigration, setClock, bundle, store, push, transition, readCurrent, sriT1 } = env);
  sri1Scene3();
  sri1Scene4();
}

function sri1Scene5() {
  test("検査: 禁止表現（各語・本文の「競艇」・risk-rules）・#競艇 のタグは可・加重280・リンク・置き場所・本文のハッシュタグ・画像1枚・P0・時刻", async () => {
    sriT1();
    sriT2();
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（db・first・PUSHED_AT・OBSERVED・readMigration・setClock・bundle・store・push・transition・readCurrent・sriT1） */
export function runSnsResearchImageScenes10(env) {
  ({ db, first, PUSHED_AT, OBSERVED, readMigration, setClock, bundle, store, push, transition, readCurrent, sriT1 } = env);
  sri1Scene5();
}
