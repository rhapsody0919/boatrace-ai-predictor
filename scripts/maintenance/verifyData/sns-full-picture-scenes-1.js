/**
 * verify-sns-full-picture.js の後半の場面（1/5）。verify ではない。
 * 判定と期待値は分ける前の verify-sns-full-picture.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { schedule, checkFullPicture } from "../../sns/push-full-picture.js";

let db, first, all, riskRules, bundle, bundleV2, store, push;

function scene1() {
  test("締切の45分前を過ぎた・中止のレースは受け取らない。--dry-run は書かない", async () => {
    const late = await push(bundle(), {
      now: new Date("2037-10-18T19:57:00+09:00"),
    });
    assert.match(late.reasons.join(), /45分前/);
    const dry = await push(bundle(), { dryRun: true });
    assert.equal(dry.dryRun, true);
    assert.equal((await all("SELECT * FROM sns_drafts")).length, 0);
    await db.query("UPDATE races SET cancellation_status='confirmed'");
    assert.match((await push()).reasons.join(), /中止/);
    // 60分前を過ぎて45分前より前なら、送るのは今から5分後
    assert.equal(
      schedule("2037-10-18T11:36:00.000Z", new Date("2037-10-18T19:45:00+09:00"))
        .send_at,
      "2037-10-18T10:50:00.000Z",
    );
  });
  test("182: X の日の枠の全貌の取り置きに入らなければ、X の下書きを作らず YouTube だけ送る。182 の前（404）・読めないときは今のまま", async () => {
    const asked = [];
    store.xSlotRoom = async (kind, need) => {
      asked.push([kind, need]);
      return {
        ok: false,
        reason: "kind_slot_full",
        kind,
        need,
        limit: 8,
        reserve: 4,
        booked: 4,
        others_booked: 1,
        held_for_others: 3,
        external: 0,
      };
    };
    try {
      const result = await push();
      assert.deepEqual(asked, [["full_picture", 1]]);
      assert.deepEqual(Object.keys(result.channels), ["youtube"]);
      assert.ok(result.channels.youtube.job_id);
      assert.deepEqual(
        (await all("SELECT DISTINCT platform FROM sns_drafts")).map(
          (r) => r.platform,
        ),
        ["youtube"],
      );
      assert.ok(
        result.notes.some((n) => /x: 作らなかった.*全貌|full_picture/.test(n)),
      );
      // 182 の前（PostgREST の 404）は止めない
      await db.exec(
        "DELETE FROM sns_x_send_jobs; DELETE FROM sns_auto_send_items; ALTER TABLE sns_drafts DISABLE TRIGGER USER; DELETE FROM sns_drafts; ALTER TABLE sns_drafts ENABLE TRIGGER USER;",
      );
      store.xSlotRoom = async () => {
        throw new Error(
          "DB 操作に失敗: HTTP 404 POST rpc/sns_x_slot_room PGRST202",
        );
      };
      const before = await push();
      assert.ok(before.channels.x?.job_id);
    } finally {
      delete store.xSlotRoom;
    }
  });
  test("mode=manual なら item を manual にして個別承認に回す。承認に失敗したら manual に戻す", async () => {
    await db.exec(
      "UPDATE sns_auto_send_control SET mode='manual' WHERE channel='youtube'",
    );
    store.failApprove = true;
    try {
      const result = await push();
      assert.equal(result.channels.youtube.auto, false);
      assert.match(result.channels.x.error, /approve_failed/);
    } finally {
      store.failApprove = false;
    }
    const items = await all(
      "SELECT channel, state FROM sns_auto_send_items ORDER BY channel",
    );
    assert.deepEqual(
      items.map((i) => i.state),
      ["manual", "manual"],
    );
    assert.equal((await all("SELECT * FROM sns_x_send_jobs")).length, 0);
  });
}

function scene2() {
  test("送信の claim: 送る時刻（締切の60分前）より前は veto_window_open で待ち、過ぎたら claim できる（自動送信の承認者の job）", async () => {
    await db.exec(
      "UPDATE sns_x_send_control SET paused=false, timing_approved=true, max_source_age_seconds=14400, daily_limit_x=2, daily_limit_youtube=2, daily_baseline_date=(test_now() AT TIME ZONE 'Asia/Tokyo')::date, daily_external_count=0, period_start=test_now() - interval '1 day', period_end=test_now() + interval '30 days', budget_microusd=20000000, reserved_microusd=0, attempt_ceiling_microusd=250000, ceiling_x_url_microusd=250000, ceiling_x_plain_microusd=30000",
    );
    await push();
    const job = await first(
      "SELECT j.id FROM sns_x_send_jobs j JOIN sns_drafts d ON d.id=j.draft_id WHERE d.platform='x'",
    );
    await assert.rejects(
      db.query("SELECT public.transition_sns_x_send($1,'claim','{}'::jsonb)", [
        job.id,
      ]),
      /veto_window_open/,
    );
    await db.query("UPDATE test_clock SET value=$1", [
      new Date("2037-10-18T19:37:00+09:00").toISOString(),
    ]);
    const r = await first(
      "SELECT public.transition_sns_x_send($1,'claim','{}'::jsonb) r",
      [job.id],
    );
    assert.equal(r.r.state, "sending");
  });
  test("172: 全貌の YouTube は完全版（main）と Shorts の item を1レースに1件ずつ持てる。Shorts は全貌の YouTube だけ", async () => {
    const insert = (channel, variant, kind = "full_picture") =>
      db.query(
        `WITH draft AS (INSERT INTO sns_drafts(content_group_id,platform,language,format,caption_text)
           VALUES(gen_random_uuid(), $2, 'ja', 'full_picture', '172') RETURNING id)
         INSERT INTO sns_auto_send_items(kind,draft_id,channel,race_id,deadline_at,notify_by,veto_until,variant)
         VALUES($1, (SELECT id FROM draft), $2, 'r172', test_now()+interval '3h', test_now(), test_now()+interval '1h', $3)`,
        [kind, channel, variant],
      );
    await insert("youtube", "main");
    await insert("youtube", "shorts");
    await assert.rejects(insert("youtube", "shorts"), /race_channel/);
    await assert.rejects(insert("x", "shorts"), /variant_scope/);
    await assert.rejects(insert("youtube", "other"), /variant/);
    const def = await first(
      "SELECT indexdef FROM pg_indexes WHERE indexname='sns_auto_send_items_race_channel'",
    );
    assert.match(def.indexdef, /\(race_id, channel, variant\)/);
  });
}

function scene3() {
  test("bundle の版2: Shorts の下書きを足し、親（完全版の job）を待って完全版の4分後に送る。版1は今までどおり2件", async () => {
    const result = await push(bundleV2());
    assert.equal(result.reasons, undefined);
    const items = await all(
      "SELECT channel, variant, state FROM sns_auto_send_items ORDER BY channel, variant",
    );
    assert.deepEqual(
      items.map((i) => [i.channel, i.variant, i.state]),
      [
        ["x", "main", "notified"],
        ["youtube", "main", "notified"],
        ["youtube", "shorts", "notified"],
      ],
    );
    const full = await first("SELECT * FROM sns_x_send_jobs WHERE id=$1", [
      result.channels.youtube.job_id,
    ]);
    const shorts = await first("SELECT * FROM sns_x_send_jobs WHERE id=$1", [
      result.channels.shorts.job_id,
    ]);
    // Shorts は完全版の job を親に持つ（承認の snapshot にも入る）。送る時刻は完全版の4分後
    assert.equal(shorts.parent_job_id, full.id);
    assert.equal(JSON.parse(shorts.snapshot_text).queue.parent_job_id, full.id);
    assert.equal(full.scheduled_at.toISOString(), "2037-10-18T10:40:00.000Z");
    assert.equal(shorts.scheduled_at.toISOString(), "2037-10-18T10:44:00.000Z");
    // 承認する文は置き場所つき（送る時に完全版の URL に置き換える）
    assert.match(JSON.parse(shorts.snapshot_text).text, /\{full_url\}/);
    assert.equal(
      JSON.parse(shorts.snapshot_text).youtube_title,
      "若松12R、49秒で全貌",
    );
    assert.match(
      result.notes[0],
      /youtube（Shorts）: 19:44 に自動で送る（完全版の公開の後/,
    );
    // 親が未公開の間、Shorts の claim は parent_not_posted で止まる
    await db.exec(
      "UPDATE sns_x_send_control SET paused=false, timing_approved=true, max_source_age_seconds=14400, daily_limit_x=2, daily_limit_youtube=3, daily_baseline_date=(test_now() AT TIME ZONE 'Asia/Tokyo')::date, daily_external_count=0, period_start=test_now() - interval '1 day', period_end=test_now() + interval '30 days', budget_microusd=20000000, reserved_microusd=0, attempt_ceiling_microusd=250000, ceiling_x_url_microusd=250000, ceiling_x_plain_microusd=30000",
    );
    await db.query("UPDATE test_clock SET value=$1", [
      new Date("2037-10-18T19:45:00+09:00").toISOString(),
    ]);
    const claimed = await first(
      "SELECT public.transition_sns_x_send($1,'claim','{}'::jsonb) r",
      [shorts.id],
    );
    assert.equal(claimed.r.error_code, "parent_not_posted");
    // 本番の claim（158）は、YouTube の親（完全版）が posted で外部 ID があれば、Shorts の claim を通す
    await db.exec(
      "UPDATE sns_youtube_quota_control SET verified=true, baseline_day=(test_now() AT TIME ZONE 'America/Los_Angeles')::date, upload_limit=10, general_limit=10000, external_uploads=0, external_general=0",
    );
    await db.query(
      "UPDATE sns_x_send_jobs SET state='queued', error_code=NULL WHERE id=$1",
      [shorts.id],
    );
    await db.query(
      "UPDATE sns_x_send_jobs SET state='posted', external_post_id='fullvideo01', posted_at=test_now() WHERE id=$1",
      [full.id],
    );
    const again = await first(
      "SELECT public.transition_sns_x_send($1,'claim','{}'::jsonb) r",
      [shorts.id],
    );
    assert.equal(again.r.state, "sending");
  });
}

function scene4() {
  test("札（full_picture_variant、hq SQ08 v5）: bundle の札を送る下書き（X・完全版・Shorts）の source_data.full_picture_variant.id に写す。a・b 以外は受け取らない", async () => {
    const result = await push(bundleV2({ full_picture_variant: { id: "b" } }));
    assert.equal(result.reasons, undefined);
    const rows = (
      await all(
        "SELECT platform, source_data FROM sns_drafts WHERE format='full_picture' ORDER BY platform",
      )
    ).map((r) => r.source_data.full_picture_variant);
    assert.equal(rows.length, 3);
    assert.ok(
      rows.every((v) => v?.id === "b"),
      JSON.stringify(rows),
    );
    assert.ok(
      checkFullPicture(
        {
          ...bundleV2(),
          full_picture_variant: { id: "c" },
          review: { p0_count: 0 },
        },
        riskRules,
      ).some((r) => r.includes("full_picture_variant")),
    );
    // 札の無い bundle は今までどおり（source_data に札を書かない）
    assert.ok(
      !checkFullPicture(
        { ...bundleV2(), review: { p0_count: 0 } },
        riskRules,
      ).some((r) => r.includes("full_picture_variant")),
    );
  });
  test("投稿の型（content_type、hq PD02）: bundle の型の id を送る下書き（X・完全版・Shorts）の source_data.content_type.id に写す。id の無い型は受け取らない", async () => {
    const result = await push(
      bundleV2({
        content_type: { id: "e03-one-point-30s" },
        full_picture_variant: { id: "b" },
      }),
    );
    assert.equal(result.reasons, undefined);
    const rows = (
      await all("SELECT source_data FROM sns_drafts WHERE format='full_picture'")
    ).map((r) => r.source_data);
    assert.equal(rows.length, 3);
    assert.ok(
      rows.every(
        (d) =>
          d.content_type?.id === "e03-one-point-30s" &&
          d.full_picture_variant?.id === "b",
      ),
      JSON.stringify(rows.map((d) => d.content_type)),
    );
    assert.ok(
      checkFullPicture(
        { ...bundleV2(), content_type: {}, review: { p0_count: 0 } },
        riskRules,
      ).some((r) => r.includes("content_type")),
    );
    assert.ok(
      !checkFullPicture(
        { ...bundleV2(), review: { p0_count: 0 } },
        riskRules,
      ).some((r) => r.includes("content_type")),
      "型の無い bundle は今までどおり",
    );
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（db・first・all・riskRules・bundle・bundleV2・store・push） */
export function runSnsFullPictureScenes1(env) {
  ({ db, first, all, riskRules, bundle, bundleV2, store, push } = env);
  scene1();
  scene2();
  scene3();
  scene4();
}
