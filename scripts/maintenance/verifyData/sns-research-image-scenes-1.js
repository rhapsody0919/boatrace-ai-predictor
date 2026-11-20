/**
 * verify-sns-research-image.js の後半の場面（1/2）。verify ではない。
 * 判定と期待値は分ける前の verify-sns-research-image.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { resultLine, researchStatus } from "../../sns/push-research-image.js";
import { createReadCurrent } from "../../../api/_lib/snsClaimCheck.js";
import { createDeadlinePreflight } from "../../../api/_lib/snsDeadlineQueue.js";
import { SCREEN_MARKERS } from "../../lib/snsScreenMarkers.js";

let db, first, all, DAY, ID, at, PUSHED_AT, OBSERVED, png, setClock, CAPTION, bundle, saved, store, push, transition, counts, NOTHING, theJob;
export let readCurrent;

export const preflightAt = (now, headless = null) =>
  createDeadlinePreflight({
    headless,
    markers: SCREEN_MARKERS,
    readCurrent,
    now: () => now.getTime(),
  });

function sri1Scene1() {
  /** 送り手の読み直し（readCurrent）に PGlite の行を渡す（PostgREST の path を読み分ける） */
  readCurrent = createReadCurrent({
    db: async (p) => {
      const table = p.split("?")[0];
      const draftId = p.match(/(?:^|[?&])(?:id|draft_id)=eq\.([0-9a-f-]+)/)?.[1];
      if (table === "sns_drafts" && p.includes("select=platform"))
        return all(
          "SELECT platform, caption_text, hashtags, cover_image_path, video_storage_path FROM sns_drafts WHERE id=$1",
          [draftId],
        );
      if (table === "sns_drafts")
        return all(
          "SELECT bundle_import_id, source_data FROM sns_drafts WHERE id=$1",
          [draftId],
        );
      if (table === "sns_auto_send_items" && p.includes("state=eq.sent"))
        return all(
          "SELECT id FROM sns_auto_send_items WHERE kind='research_image' AND channel='x' AND race_id LIKE $1 AND state='sent'",
          [
            decodeURIComponent(p.match(/race_id=like\.([^&]+)/)[1]).replace(
              "*",
              "%",
            ),
          ],
        );
      if (table === "sns_auto_send_items")
        return all(
          "SELECT kind, race_id FROM sns_auto_send_items WHERE draft_id=$1",
          [draftId],
        );
      if (table === "sns_auto_send_control")
        return all(
          "SELECT research_image_enabled FROM sns_auto_send_control WHERE channel='x'",
        );
      return [];
    },
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（db・first・all・DAY・ID・at・PUSHED_AT・OBSERVED・png・setClock・CAPTION・bundle・saved・store・push・transition・counts・NOTHING・theJob） */
export function runSnsResearchImageScenes1(env) {
  ({ db, first, all, DAY, ID, at, PUSHED_AT, OBSERVED, png, setClock, CAPTION, bundle, saved, store, push, transition, counts, NOTHING, theJob } = env);
  sri1Scene1();
}

function sri1Scene2() {
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

function sri1Scene3() {
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

function sri1Scene4() {
  test("取り置き（180 の v_a_pending）: 通り道 B の claim は、今日まだ送っていない research_image の分を先に枠から引く", async () => {
    await push();
    await db.exec("UPDATE sns_x_send_control SET daily_limit_x=1");
    const me = (
      await first("SELECT id FROM sns_approvers WHERE display_name='本人'")
    ).id;
    const queue = {
      deadline_at: at("17:00:00").toISOString(),
      expires_at: at("16:30:00").toISOString(),
      source_revision: "r1",
      source_observed_at: PUSHED_AT.toISOString(),
    };
    const b = await first(
      `INSERT INTO sns_drafts(content_group_id,format,platform,language,caption_text,send_lane,publish_blocked,publication_hold_reasons,source_data)
     VALUES(gen_random_uuid(),'topic','x','ja','企画の投稿','B',false,'[]'::jsonb,jsonb_build_object('deadline_queue',$1::jsonb)) RETURNING *`,
      [queue],
    );
    const snapshot = {
      text: "企画の投稿",
      media: [],
      queue,
      source: {
        caption_text: "企画の投稿",
        hashtags: null,
        video_storage_path: null,
        cover_image_path: null,
        language: "ja",
      },
    };
    const bJob = (
      await first("SELECT approve_sns_x_send($1,$2,$3,$4) r", [
        b.id,
        me,
        snapshot,
        PUSHED_AT.toISOString(),
      ])
    ).r;
    await assert.rejects(transition(bJob.id, "claim"), /日次全体上限/);
    await db.exec("UPDATE sns_x_send_control SET daily_limit_x=2");
    assert.equal((await transition(bJob.id, "claim")).state, "sending");
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（db・first・all・DAY・ID・at・PUSHED_AT・OBSERVED・png・setClock・CAPTION・bundle・saved・store・push・transition・counts・NOTHING・theJob） */
export function runSnsResearchImageScenes2(env) {
  ({ db, first, all, DAY, ID, at, PUSHED_AT, OBSERVED, png, setClock, CAPTION, bundle, saved, store, push, transition, counts, NOTHING, theJob } = env);
  sri1Scene2();
  sri1Scene3();
  sri1Scene4();
}

function sri1Scene5() {
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
}

/** verify から呼ぶ入口。env は verify 側の束縛（db・first・all・DAY・ID・at・PUSHED_AT・OBSERVED・png・setClock・CAPTION・bundle・saved・store・push・transition・counts・NOTHING・theJob） */
export function runSnsResearchImageScenes3(env) {
  ({ db, first, all, DAY, ID, at, PUSHED_AT, OBSERVED, png, setClock, CAPTION, bundle, saved, store, push, transition, counts, NOTHING, theJob } = env);
  sri1Scene5();
}
