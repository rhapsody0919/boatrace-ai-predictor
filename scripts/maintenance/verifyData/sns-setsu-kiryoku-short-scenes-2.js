/**
 * verify-sns-setsu-kiryoku-short.js の後半の場面（2/5）。verify ではない。
 * 判定と期待値は分ける前の verify-sns-setsu-kiryoku-short.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resultLine,
  checkShortBundle,
  schedule,
  checkTiming,
  setsuStatus,
} from "../../sns/push-setsu-kiryoku-short.js";
import { createMockYoutubeAdapter, runYoutubeQueueJob } from "../../../api/_lib/snsDeadlineQueue.js";
import { push, counts, NOTHING, theJob, saved, transition, venueHeadless, preflightAt, store } from "./sns-setsu-kiryoku-short-scenes-1.js";

let db, first, riskRules, SAMPLE, DAY, NEXT, at, PUSHED_AT, SETSU_ID, VIDEO, bundle, setClock;

export const insertSetsuItem = (channel, raceId, variant = "main") =>
  db.query(
    `WITH draft AS (INSERT INTO sns_drafts(content_group_id,platform,language,format,caption_text)
       VALUES(gen_random_uuid(), $1, 'ja', 'setsu_kiryoku_short', '201') RETURNING id)
     INSERT INTO sns_auto_send_items(kind,variant,draft_id,channel,race_id,deadline_at,notify_by,veto_until,state)
     SELECT 'setsu_kiryoku_short', $3, id, $1, $2, test_now()+interval '3h', test_now(), test_now()+interval '1h', 'checking' FROM draft`,
    [channel, raceId, variant],
  );

export const markSent = (where) =>
  db.exec(
    `UPDATE sns_auto_send_items SET state='sent', checks='{"passed":true}' WHERE ${where}`,
  );

function skst2Scene1() {
  test("193: setsu_kiryoku_short の item は YouTube・variant=main・race_id は setsu:{日}:{会場コード} だけ。1日1本（別の会場も、送った後も入らない）。許可は既定 false・youtube の行だけ", async () => {
    const insert = (channel, raceId, variant = "main", state = "checking") =>
      db.query(
        `WITH draft AS (INSERT INTO sns_drafts(content_group_id,platform,language,format,caption_text)
         VALUES(gen_random_uuid(), $1, 'ja', 'setsu_kiryoku_short', '193') RETURNING id)
       INSERT INTO sns_auto_send_items(kind,variant,draft_id,channel,race_id,deadline_at,notify_by,veto_until,state)
       SELECT 'setsu_kiryoku_short', $3, id, $1, $2, test_now()+interval '3h', test_now(), test_now()+interval '1h', $4 FROM draft`,
        [channel, raceId, variant, state],
      );
    await assert.rejects(insert("x", SETSU_ID), /kind_source/);
    await assert.rejects(insert("youtube", `setsu:${DAY}:25`), /setsu_id/);
    await assert.rejects(
      insert("youtube", `setsu:${DAY}:13`, "shorts"),
      /variant_scope|setsu_id/,
    );
    await insert("youtube", SETSU_ID);
    await assert.rejects(insert("youtube", `setsu:${DAY}:01`), /setsu_day/);
    await db.exec(
      `UPDATE sns_auto_send_items SET state='sent', checks='{"passed":true}'`,
    );
    await assert.rejects(insert("youtube", `setsu:${DAY}:01`), /setsu_day/);
    // 止めた・個別承認に回したものは数えない。次の日は入る
    await db.exec("UPDATE sns_auto_send_items SET state='held_manual'");
    await insert("youtube", `setsu:${DAY}:01`);
    await insert("youtube", `setsu:${NEXT}:01`);
    await assert.rejects(
      db.exec(
        "UPDATE sns_auto_send_control SET setsu_kiryoku_short_enabled=true WHERE channel='x'",
      ),
      /youtube_only/,
    );
    const col = await first(
      "SELECT column_default FROM information_schema.columns WHERE table_name='sns_auto_send_control' AND column_name='setsu_kiryoku_short_enabled'",
    );
    assert.equal(col.column_default, "false");
  });
  test("許可が off なら、検査が通っても何も書かない（DB・Storage・Slack とも。disabled・exit 3）。--dry-run も書かない（exit 0）", async () => {
    await db.exec(
      "UPDATE sns_auto_send_control SET setsu_kiryoku_short_enabled=false",
    );
    const off = await push();
    assert.equal(off.disabled, true, JSON.stringify(off.reasons));
    assert.deepEqual(off.notes, []);
    assert.equal(resultLine(off).code, 3);
    assert.deepEqual(await counts(), NOTHING);
    await db.exec(
      "UPDATE sns_auto_send_control SET setsu_kiryoku_short_enabled=(channel='youtube')",
    );
    const dry = await push(bundle(), { dryRun: true });
    assert.equal(dry.dryRun, true);
    assert.equal(dry.disabled, false);
    assert.equal(dry.public_url, "https://www.boat-ai.jp/venue/13");
    assert.deepEqual(
      [dry.video.width, dry.video.height, dry.video.durationSec],
      [1080, 1920, 17],
    );
    assert.equal(resultLine(dry).code, 0);
    assert.deepEqual(await counts(), NOTHING);
  });
}

function skst2Scene2() {
  test("許可が on・mode=auto: 動画1本の YouTube の job を送る時刻の予定に入れる。題・説明欄は bundle の値のまま。期限は送る時刻＋60分、締切は期限＋expiry_minutes", async () => {
    const r = await push();
    assert.equal(r.reasons, undefined, JSON.stringify(r.reasons));
    assert.equal(r.setsu_id, SETSU_ID);
    const draft = await first("SELECT * FROM sns_drafts");
    assert.equal(draft.platform, "youtube");
    assert.equal(draft.format, "setsu_kiryoku_short");
    assert.equal(draft.title, SAMPLE.youtube.title);
    assert.equal(draft.caption_text, SAMPLE.youtube.description);
    assert.deepEqual(draft.hashtags, []);
    assert.match(
      draft.video_storage_path,
      /^setsu-kiryoku-short\/2037-11-01\/13\/[0-9a-f]{32}\.mp4$/,
    );
    const job = await theJob();
    assert.equal(job.channel, "youtube");
    assert.equal(job.state, "queued");
    const snap = JSON.parse(job.snapshot_text);
    assert.equal(snap.youtube_title, SAMPLE.youtube.title);
    assert.equal(
      snap.text,
      SAMPLE.youtube.description,
      "送る文は説明欄そのもの（ハッシュタグの行を足さない）",
    );
    assert.equal(snap.media.length, 1);
    assert.equal(snap.media[0].type, "video/mp4");
    const sendAt = new Date(PUSHED_AT.getTime() + 120000);
    assert.equal(new Date(job.scheduled_at).toISOString(), sendAt.toISOString());
    assert.equal(
      snap.queue.expires_at,
      new Date(sendAt.getTime() + 60 * 60000).toISOString(),
    );
    assert.equal(
      snap.queue.deadline_at,
      new Date(sendAt.getTime() + 90 * 60000).toISOString(),
    );
    assert.equal(snap.queue.public_url, "https://www.boat-ai.jp/venue/13");
    assert.equal(snap.queue.screen_key, "venue");
    assert.equal(snap.queue.youtube_mode, "immediate");
    const item = await first("SELECT * FROM sns_auto_send_items");
    assert.deepEqual(
      [item.kind, item.variant, item.channel, item.race_id, item.state],
      ["setsu_kiryoku_short", "main", "youtube", SETSU_ID, "notified"],
    );
    assert.equal(saved.length, 1);
    assert.match(r.notes[0], /setsu_kiryoku_short_enabled = false/);
    assert.equal(resultLine(r, null, { waited: false }).code, 0);
  });
  test("send_time があれば、その時刻に送る（今＋2分より後なら）。送る時刻の15分前より早い・22:00 を過ぎる時刻・今日でない日・期限の10分前の後は受け取らない", async () => {
    // 15分前より早い受け取りは拒否（ちょうど15分前は通す）
    const early = await push(bundle({ send_time: "21:41" }));
    assert.ok(
      early.reasons?.some((x) => x.includes("15分前より早い")),
      JSON.stringify(early.reasons),
    );
    const r = await push(bundle({ send_time: "21:40" }));
    assert.equal(r.reasons, undefined, JSON.stringify(r.reasons));
    assert.equal(
      new Date((await theJob()).scheduled_at).toISOString(),
      at("21:40:00").toISOString(),
    );
    assert.ok(
      checkShortBundle(bundle({ send_time: "22:30" }), riskRules).some((x) =>
        x.includes("send_time"),
      ),
    );
    const late = await push(bundle(), { now: at("21:59:00") });
    assert.ok(
      late.reasons.some((x) => x.includes("22:00")),
      JSON.stringify(late.reasons),
    );
    const other = await push(bundle(), { now: at("21:00:00", NEXT) });
    assert.ok(other.reasons.some((x) => x.includes("今日")));
    const when = schedule(bundle(), PUSHED_AT, 30);
    assert.ok(
      checkTiming(bundle(), when, new Date(Date.parse(when.latest)), {
        observedAt: PUSHED_AT.toISOString(),
        maxAgeSec: 14400,
      }).some((x) => x.includes("10分前")),
    );
    // 集計の時刻: 今より後・期限までに鮮度の線（4時間）を越えるものは受け取らない
    const stale = await push(
      bundle({ source_observed_at: at("18:20:00").toISOString() }),
    );
    assert.ok(
      stale.reasons.some((x) => x.includes("古い")),
      JSON.stringify(stale.reasons),
    );
    const future = await push(
      bundle({ source_observed_at: at("21:30:00").toISOString() }),
    );
    assert.ok(future.reasons.some((x) => x.includes("今より後")));
  });
}

function skst2Scene3() {
  test("claim: 送る時刻の前は通らない。送る時刻に sending になり、YouTube のクォータ（1 upload・104 units）を予約する。許可を off にすると held（setsu_kiryoku_short_disabled）", async () => {
    await push();
    const job = await theJob();
    // 送る時刻（veto_until と同じ）の前は通らない
    await assert.rejects(
      transition(job.id, "claim"),
      /veto_window_open|claimできません/,
    );
    await setClock(new Date(Date.parse(job.scheduled_at)));
    const claimed = await transition(job.id, "claim");
    assert.equal(claimed.state, "sending");
    const quota = await first(
      "SELECT upload_reserved, general_reserved FROM sns_youtube_quota_attempts WHERE job_id=$1",
      [job.id],
    );
    assert.deepEqual([quota.upload_reserved, quota.general_reserved], [1, 104]);
    // 許可は claim のたびに見る（承認の後に off にした）
    await db.exec(
      "DELETE FROM sns_youtube_quota_attempts; UPDATE sns_x_send_jobs SET state='queued', attempts=0, attempt_dates='{}', attempt_channels='{}', lease_until=NULL, locked_at=NULL",
    );
    await db.exec(
      "UPDATE sns_auto_send_control SET setsu_kiryoku_short_enabled=false",
    );
    const held = await transition(job.id, "claim");
    assert.deepEqual(
      [held.state, held.error_code],
      ["held", "setsu_kiryoku_short_disabled"],
    );
  });
  test("他の kind の claim は 189 と同じ: YouTube の全貌（full_picture）は setsu の許可が off でも止めない", async () => {
    await db.exec(
      "UPDATE sns_auto_send_control SET setsu_kiryoku_short_enabled=false",
    );
    // 同じ下書きを full_picture の item にしたものは、許可の行に当たらない
    await db.exec(
      "UPDATE sns_auto_send_control SET setsu_kiryoku_short_enabled=(channel='youtube')",
    );
    await push();
    const job = await theJob();
    await db.exec(`ALTER TABLE sns_auto_send_items DROP CONSTRAINT sns_auto_send_items_setsu_id;
    UPDATE sns_auto_send_items SET kind='full_picture', race_id='2037-11-01-13-12'`);
    await db.exec(
      "UPDATE sns_auto_send_control SET setsu_kiryoku_short_enabled=false",
    );
    await setClock(new Date(Date.parse(job.scheduled_at)));
    assert.equal((await transition(job.id, "claim")).state, "sending");
    await db.exec(`DELETE FROM sns_youtube_quota_attempts; DELETE FROM sns_x_send_jobs; DELETE FROM sns_auto_send_items;
    ALTER TABLE sns_auto_send_items ADD CONSTRAINT sns_auto_send_items_setsu_id CHECK (
      kind <> 'setsu_kiryoku_short' OR (race_id ~ '^setsu:[0-9]{4}-[0-9]{2}-[0-9]{2}:(0[1-9]|1[0-9]|2[0-4])$' AND variant IN ('main', 'border')))`);
  });
}

function skst2Scene4() {
  test("送る: 送る時刻に動画を YouTube に上げて公開し、item が sent・状態に動画の URL が出る。同じ日の2本目（別の会場も）は作らない（exit 4）", async () => {
    await push();
    const job = await theJob();
    const sendAt = new Date(Date.parse(job.scheduled_at));
    await setClock(sendAt);
    const youtube = createMockYoutubeAdapter({
      videoId: "setsuvideo1",
      postedAt: sendAt.toISOString(),
    });
    const headless = venueHeadless();
    const done = await runYoutubeQueueJob(job.id, {
      store: { transition: (id, action, r = {}) => transition(id, action, r) },
      youtube,
      loadMedia: async () => VIDEO,
      preflight: preflightAt(sendAt, headless),
    });
    assert.equal(done.state, "posted", done.error_code);
    const upload = youtube.calls.find(
      (c) => c.method === "videos.insert",
    ).payload;
    assert.equal(
      upload.title ??
        upload.snapshot?.youtube_title ??
        JSON.parse(job.snapshot_text).youtube_title,
      SAMPLE.youtube.title,
    );
    assert.ok(
      headless.calls.length > 0 &&
        headless.calls.every((c) => c.url === "https://www.boat-ai.jp/venue/13"),
    );
    assert.equal(
      (await first("SELECT state FROM sns_auto_send_items")).state,
      "sent",
    );
    const status = await setsuStatus(DAY, { store });
    assert.deepEqual(
      [status.setsu_id, status.item_state, status.job_state, status.video_id],
      [SETSU_ID, "sent", "posted", "setsuvideo1"],
    );
    const again = await push(bundle(), { now: at("21:40:00") });
    assert.equal(again.already, true);
    assert.equal(resultLine(again).code, 4);
    // 別の会場の束も、同じ日は作らない（1日1本）
    const other = await push(
      bundle({
        venue: "住之江",
        youtube: {
          ...SAMPLE.youtube,
          description: SAMPLE.youtube.description.replace(
            "/venue/13",
            "/venue/12",
          ),
        },
      }),
      { now: at("21:40:00") },
    );
    assert.equal(other.already, true, JSON.stringify(other.reasons));
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（db・first・riskRules・SAMPLE・DAY・NEXT・at・PUSHED_AT・SETSU_ID・VIDEO・bundle・setClock） */
export function runSnsSetsuKiryokuShortScenes5(env) {
  ({ db, first, riskRules, SAMPLE, DAY, NEXT, at, PUSHED_AT, SETSU_ID, VIDEO, bundle, setClock } = env);
  skst2Scene1();
  skst2Scene2();
  skst2Scene3();
  skst2Scene4();
}

/** verify から呼ぶ入口。env は verify 側の束縛（db・first・riskRules・SAMPLE・DAY・NEXT・at・PUSHED_AT・SETSU_ID・VIDEO・bundle・setClock） */
export function runSnsSetsuKiryokuShortScenes6(env) {
  ({ db, first, riskRules, SAMPLE, DAY, NEXT, at, PUSHED_AT, SETSU_ID, VIDEO, bundle, setClock } = env);

}
