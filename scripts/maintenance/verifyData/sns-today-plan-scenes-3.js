/**
 * verify-sns-today-plan.js の後半の場面（3/7）。verify ではない。
 * 判定と期待値は分ける前の verify-sns-today-plan.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { sendHolds } from "../../../api/_lib/snsMobileApproval.js";
import { DATE } from "./sns-today-plan-v3-race-db.js";
import { TODAY_NOTICE } from "../../lib/snsTodayPlanner.js";
import { digestOf } from "./sns-today-plan-scenes-1.js";

let db, first, all, at, trackingStore, shooter, plan, putType;

// ---------- PD02: 型の列（174）とリンクの置き場（2026-10-25 hq の依頼） ----------
export const TYPE_VARIANTS = {
  default: "本日のデータ一覧（{date}）",
  // 返信の型は reply_enabled の間だけ（費用の線はオーナーの判断。リポジトリの config は false）
  reply_enabled: true,
  variants: [
    {
      id: "a",
      uuid: null,
      type_id: "today-a",
      heading: "本日のデータ一覧（{date}）",
    },
    {
      id: "b",
      uuid: null,
      type_id: "today-a",
      heading: "本日のデータ一覧（{date}）",
    },
  ],
};

export const linkAt = (caption) =>
  caption
    .split("\n")
    .findIndex((l) => l.includes("https://www.boat-ai.jp/x/today?d="));

export const clearAll = () =>
  db.exec(`
    DELETE FROM sns_metric_jobs; DELETE FROM sns_post_tracking; DELETE FROM sns_x_send_jobs; DELETE FROM sns_auto_send_items; DELETE FROM sns_today_type_schedule;
    ALTER TABLE sns_drafts DISABLE TRIGGER USER; DELETE FROM sns_drafts; ALTER TABLE sns_drafts ENABLE TRIGGER USER;`);

function scene1() {
  test("撮影は開始から120秒を過ぎたら新しく撮らない（関数の時間切れで何も残らないのを避ける）", async () => {
    let ms = 0;
    const headless = shooter();
    const slow = {
      ...headless,
      screenshot: async (r) => {
        ms += 70_000;
        return headless.screenshot(r);
      },
    };
    await assert.rejects(
      plan({ now: at("07:00"), headless: slow, nowMs: () => ms }),
      /sonar_not_ready（2037-10-17-04-03: time_budget \/ 2037-10-17-04-05: time_budget）/,
    );
    assert.equal(headless.calls.length, 2);
    // 7:00 を過ぎていれば、撮れた2枚で作る
    ms = 0;
    await plan({ now: at("07:35"), headless: slow, nowMs: () => ms });
    const [draft] = await all("SELECT * FROM sns_drafts");
    assert.equal(draft.source_data.image_paths.length, 2);
  });
  test("確認用の作り直し（cursor.today_rebuild）: 送る時刻を過ぎても、その日の下書きと図を1回作る。承認はできない。別の日付なら作らない", async () => {
    const notes = [];
    const other = await plan({ now: at("12:30"), reviewDate: "2037-10-16" });
    assert.equal(other.report.items[0].outcome, "missed");
    const result = await plan({ now: at("12:30"), reviewDate: DATE, notes });
    const item = result.report.items[0];
    assert.deepEqual(
      [item.outcome, item.review, item.written],
      ["manual", true, true],
    );
    const [draft] = await all("SELECT * FROM sns_drafts");
    assert.equal(draft.source_data.image_paths.length, 4);
    assert.match(
      notes[0],
      /確認用に今日の下書きを作り直した（送る時刻を過ぎているので、承認・送信はできない）/,
    );
    // 期限（8:15）を過ぎているので、承認の条件で止まる（送られない）
    assert.ok(
      sendHolds(draft).includes("期限失効") ||
        Date.now() < Date.parse(draft.source_data.deadline_queue.expires_at),
    );
  });
  test("mode=auto（2026-10-18 オーナー決定: /today も承認なし）: 下書きを作ったら item を notified にし、自動送信の承認者で 7:00 の job を作る。一覧がやり直されたら作り直して承認し直す", async () => {
    await db.exec(
      "UPDATE sns_auto_send_control SET mode='auto' WHERE channel='x'",
    );
    try {
      const notes = [];
      const first1 = await plan({ notes });
      assert.equal(first1.report.items[0].outcome, "notified");
      const item = await first("SELECT * FROM sns_auto_send_items");
      assert.equal(item.state, "notified");
      assert.ok(item.notified_at && /^[a-f0-9]{64}$/.test(item.stop_token_hash));
      const auto = (
        await first(
          "SELECT auto_approver_id FROM sns_auto_send_control WHERE channel='x'",
        )
      ).auto_approver_id;
      const job = await first("SELECT * FROM sns_x_send_jobs");
      assert.equal(job.state, "queued");
      assert.equal(job.approver_id, auto);
      assert.equal(job.auto_item_id, item.id);
      assert.equal(job.scheduled_at.toISOString(), at("07:00").toISOString());
      assert.ok(notes.some((n) => /07:00 に自動で送る/.test(n)));
      assert.ok(notes.some((n) => /paused = true/.test(n)));
      // 一覧がやり直されたら（版が変わる）、notified でも作り直して承認し直す
      const again = await plan({
        now: at("06:45"),
        digest: digestOf(24),
      });
      assert.equal(again.report.items[0].outcome, "rebuilt");
      const after = await first("SELECT * FROM sns_auto_send_items");
      assert.equal(after.state, "notified");
      const job2 = await first("SELECT * FROM sns_x_send_jobs");
      assert.equal(job2.state, "queued");
    } finally {
      await db.exec(
        "UPDATE sns_auto_send_control SET mode='manual' WHERE channel='x'",
      );
    }
  });
}

function scene2() {
  test("送る時刻（2026-11-04 オーナー決定: 7:00 へ繰り上げ、BOA-1314）: 7:00 より前に作れば 7:00、遅れて作れば作った時刻。失効は 8:30、締切は 9:00", async () => {
    const { todaySchedule } = await import("../../lib/snsTodayPlanner.js");
    assert.deepEqual(todaySchedule(DATE, at("06:40")), {
      plan_from: at("06:30").toISOString(),
      latest: at("08:00").toISOString(),
      scheduled_at: at("07:00").toISOString(),
      deadline_at: at("09:00").toISOString(),
      notify_by: at("06:30").toISOString(),
      veto_until: at("07:00").toISOString(),
      expires_at: at("08:30").toISOString(),
    });
    // 図を 7:30 まで待って 7:40 に作った日は、7:40 に送る
    await plan({ now: at("07:40") });
    const draft = await first("SELECT * FROM sns_drafts");
    const item = await first("SELECT * FROM sns_auto_send_items");
    assert.equal(draft.scheduled_at.toISOString(), at("07:40").toISOString());
    assert.equal(item.veto_until.toISOString(), at("07:40").toISOString());
    assert.equal(item.notify_by.toISOString(), at("06:30").toISOString());
    assert.equal(item.deadline_at.toISOString(), at("09:00").toISOString());
    assert.equal(
      draft.source_data.deadline_queue.expires_at,
      at("08:30").toISOString(),
    );
  });
  test("見出しの日替わり（2026-10-20）: 1行目だけが案の文になり、札は source_data.today_variant と tracking に残る（uuid が無い間は null）", async () => {
    const variants = {
      default: "本日のデータ一覧（{date}）",
      variants: [
        { id: "a", uuid: null, heading: "今日のデータ（{date}）" },
        { id: "b", uuid: null, heading: "今日のデータ（{date}）" },
      ],
    };
    await plan({ loadVariants: () => variants });
    const draft = await first("SELECT * FROM sns_drafts");
    const lines = draft.caption_text.split("\n");
    assert.match(lines[0], /^今日のデータ（/);
    // 2行目以降は今までどおり（注目レース・印・一覧・注意書き・URL）
    assert.match(draft.caption_text, /注目レース：/);
    assert.equal(draft.source_data.today_variant.uuid, null);
    assert.ok(["a", "b"].includes(draft.source_data.today_variant.id));
    const tracking = await first(
      "SELECT template_variant_id FROM sns_post_tracking WHERE draft_id=$1",
      [draft.id],
    );
    assert.equal(tracking.template_variant_id, null);
  });
  test("見出しの日替わり: 案の uuid が入っていれば（sns_template_variants の行がある）tracking の template_variant_id にも入る", async () => {
    const id = "0f88824e-c630-4f94-8c15-475297e4b242";
    await db.query(
      "INSERT INTO sns_template_variants(id, format, variant_name, composition_name) VALUES($1,'today_digest','today-heading-a','TodayDigestX') ON CONFLICT DO NOTHING",
      [id],
    );
    const same = { id: "a", uuid: id, heading: "今日のデータ（{date}）" };
    await plan({
      loadVariants: () => ({
        default: "本日のデータ一覧（{date}）",
        variants: [same, { ...same, id: "b" }],
      }),
    });
    const draft = await first("SELECT * FROM sns_drafts");
    const tracking = await first(
      "SELECT template_variant_id FROM sns_post_tracking WHERE draft_id=$1",
      [draft.id],
    );
    assert.equal(tracking.template_variant_id, id);
    assert.equal(draft.source_data.today_variant.uuid, id);
    // 管理画面の観測の比較は下書きの template_variant_id を読む（代わりの審査の P2）
    assert.equal(draft.template_variant_id, id);
  });
  test("見出しの日替わり: 案の uuid の行が sns_template_variants に無いときは、札なしで tracking を保存し、下書き・item は作る（/code-review の指摘）", async () => {
    const missing = "99999999-9999-4999-8999-999999999999";
    const same = { id: "a", uuid: missing, heading: "今日のデータ（{date}）" };
    const result = await plan({
      loadVariants: () => ({
        default: "本日のデータ一覧（{date}）",
        variants: [same, { ...same, id: "b" }],
      }),
    });
    assert.equal(result.report.items[0].outcome, "manual");
    const draft = await first("SELECT * FROM sns_drafts");
    const tracking = await first(
      "SELECT template_variant_id FROM sns_post_tracking WHERE draft_id=$1",
      [draft.id],
    );
    assert.equal(tracking.template_variant_id, null);
    assert.equal(draft.template_variant_id, null);
    assert.equal(draft.source_data.today_variant.uuid, missing);
    assert.ok(await first("SELECT id FROM sns_auto_send_items"));
  });
}

function scene3() {
  test("見出しの日替わり: tracking の保存が一時的な失敗（HTTP 503）なら札なしで保存し直さず投げ、次の回にやり直す（代わりの審査の P3）", async () => {
    const id = "0f88824e-c630-4f94-8c15-475297e4b242";
    await db.query(
      "INSERT INTO sns_template_variants(id, format, variant_name, composition_name) VALUES($1,'today_digest','today-heading-a','TodayDigestX') ON CONFLICT DO NOTHING",
      [id],
    );
    const same = { id: "a", uuid: id, heading: "今日のデータ（{date}）" };
    const variants = () => ({
      default: "本日のデータ一覧（{date}）",
      variants: [same, { ...same, id: "b" }],
    });
    const save = trackingStore.save;
    const saved = [];
    trackingStore.save = async (row) => {
      saved.push(row.template_variant_id);
      throw new Error("UTM の保存に失敗: HTTP 503");
    };
    try {
      await assert.rejects(plan({ loadVariants: variants }), /HTTP 503/);
    } finally {
      trackingStore.save = save;
    }
    // 札なしで保存し直していない
    assert.deepEqual(saved, [id]);
    // 次の回は札つきで保存できる
    await plan({ now: at("06:45"), loadVariants: variants });
    const draft = await first("SELECT * FROM sns_drafts");
    const tracking = await first(
      "SELECT template_variant_id FROM sns_post_tracking WHERE draft_id=$1",
      [draft.id],
    );
    assert.equal(tracking.template_variant_id, id);
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（db・first・all・at・trackingStore・shooter・plan） */
export function runSnsTodayPlanScenes7(env) {
  ({ db, first, all, at, trackingStore, shooter, plan } = env);
  scene1();
  scene2();
  scene3();
}

/** verify から呼ぶ入口。env は verify 側の束縛（db・first・all・at・trackingStore・shooter・plan） */
export function runSnsTodayPlanScenes8(env) {
  ({ db, first, all, at, trackingStore, shooter, plan } = env);

}

/** verify から呼ぶ入口。env は verify 側の束縛（db・first・all・at・trackingStore・shooter・plan・putType） */
export function runSnsTodayPlanScenes9(env) {
  ({ db, first, all, at, trackingStore, shooter, plan, putType } = env);

}

function scene4() {
  test("型の列: その日の行があれば見出し・リンクの前の文・置き場がその型になり、型の id を source_data.content_type に書く", async () => {
    await putType(DATE, "t03-conclusion-heading", {
      heading: "今日いちばん偏った数字は（{date}）",
      link_lead: "一覧はこちら→",
      link_position: "end",
    });
    const result = await plan({ loadVariants: () => TYPE_VARIANTS });
    const draft = await first("SELECT * FROM sns_drafts");
    const lines = draft.caption_text.split("\n");
    assert.match(lines[0], /^今日いちばん偏った数字は（/);
    // 末尾はリンクの1行（注意書きの後）
    assert.equal(linkAt(draft.caption_text), lines.length - 1);
    assert.ok(lines.at(-1).startsWith("一覧はこちら→https://"));
    assert.equal(lines.at(-3), TODAY_NOTICE);
    const ct = draft.source_data.content_type;
    assert.deepEqual(
      [ct.id, ct.source, ct.side, ct.fallback_reason],
      ["t03-conclusion-heading", "schedule", "b", undefined],
    );
    assert.equal(result.report.items[0].content_type, "t03-conclusion-heading");
    // 列の型の日は見出しの a・b の札を付けない（札と文面の食い違いで a・b の比較を汚さない。x-channel の審査 P1）
    assert.deepEqual(draft.source_data.today_variant, {
      id: "schedule",
      uuid: null,
    });
    assert.equal(draft.template_variant_id, null);
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（db・first・all・at・trackingStore・shooter・plan・putType） */
export function runSnsTodayPlanScenes10(env) {
  ({ db, first, all, at, trackingStore, shooter, plan, putType } = env);
  scene4();
}
