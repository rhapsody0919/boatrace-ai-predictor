/**
 * verify-sns-today-plan.js の後半の場面（2/3）。verify ではない。
 * 判定と期待値は分ける前の verify-sns-today-plan.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createXSnapshot } from "../../../api/_lib/snsXSend.js";
import { createDeadlinePreflight, createMockHeadless } from "../../../api/_lib/snsDeadlineQueue.js";
import { createReadCurrent } from "../../../api/_lib/snsClaimCheck.js";
import { SCREEN_MARKERS } from "../../lib/snsScreenMarkers.js";
import { DATE } from "./sns-today-plan-v3-race-db.js";
import { raceDbOf, digestOf } from "./sns-today-plan-scenes-1.js";
import {
  runSnsTodayPlanScenes7,
  runSnsTodayPlanScenes8,
  runSnsTodayPlanScenes9,
  runSnsTodayPlanScenes10,
  TYPE_VARIANTS,
  linkAt,
} from "./sns-today-plan-scenes-3.js";
import { runSnsTodayPlanScenes6 } from "./sns-today-plan-scenes-2.js";
import { runSnsTodayPlanScenes11 } from "./sns-today-plan-scenes-4.js";

let db, first, all, t, at, stpState, sqlStore, trackingStore, shooter, plan, loadMedia, approve, stpVar1, stpVar3;

/** test("171: /today の見出しの2案の行を入れる。もう一度当てても増えない。入れた後は案の uuid で tracking・下 の中身を割った 2/4 */
async function stpVar2({ sql }) {
  // 本番の sns_template_variants は 039 で created_by を足している（この試験の土台は 039 を当てていない）
  await db.exec(
    "ALTER TABLE sns_template_variants ADD COLUMN IF NOT EXISTS created_by VARCHAR(10) NOT NULL DEFAULT 'human'",
  );
  await db.exec(
    "DELETE FROM sns_post_tracking; DELETE FROM sns_template_variants WHERE format='today_digest'",
  );
  // 同じ名前で別の id の行が先にあると、黙って成功せず全体を戻す（代わりの審査の P3）
  await db.exec(
    "INSERT INTO sns_template_variants(id, format, variant_name, composition_name) VALUES('11111111-1111-4111-8111-111111111111','today_digest','today-heading-a','X')",
  );
  await assert.rejects(db.exec(sql), /既存の行が食い違う/);
  // ファイルの BEGIN の中で落ちたので、psql と同じく戻す（db-apply は接続を閉じてトランザクション全体が戻る）
  await db.exec("ROLLBACK");
  await db.exec(
    "DELETE FROM sns_template_variants WHERE format='today_digest'",
  );
  await db.exec(sql);
  await db.exec(sql);
  const rows = await all(
    "SELECT id, variant_name, active FROM sns_template_variants WHERE format='today_digest' ORDER BY variant_name",
  );
  assert.deepEqual(
    rows.map((r) => [r.id, r.variant_name, r.active]),
    [
      ["0f88824e-c630-4f94-8c15-475297e4b242", "today-heading-a", true],
      ["be74c247-fa8f-442e-a29f-4d1d7866919a", "today-heading-b", true],
    ],
  );
  // 入れた後に config の uuid を入れると、札が tracking・下書きに入る
  const variants = {
    default: "本日のデータ一覧（{date}）",
    variants: [
      { id: "a", uuid: rows[0].id, heading: "本日のデータ一覧（{date}）" },
      { id: "b", uuid: rows[1].id, heading: "本日のデータ一覧（{date}）" },
    ],
  };
  await plan({ loadVariants: () => variants });
  const draft = await first("SELECT * FROM sns_drafts");
  assert.ok(rows.some((r) => r.id === draft.template_variant_id));
  return { rows };
}

/** test("171: /today の見出しの2案の行を入れる。もう一度当てても増えない。入れた後は案の uuid で tracking・下 の中身を割った 4/4 */
function stpVar4({ config, rows }) {
  // b は型 b（course_win、2026-10-27）に替えたので、見出しの案 b の行（171）の札は付けない（別の中身に同じ札を付けない）
  assert.deepEqual(
    config.variants.map((v) => [v.id, v.uuid]),
    [
      ["a", rows[0].id],
      ["b", null],
    ],
  );
}

export const putType = (day, typeId, post) =>
  db.query(
    "INSERT INTO sns_today_type_schedule(day, type_id, post) VALUES($1,$2,$3)",
    [day, typeId, post],
  );

export const withAuto = async (fn) => {
  await db.exec(
    "UPDATE sns_auto_send_control SET mode='auto' WHERE channel='x'",
  );
  try {
    await fn();
  } finally {
    await db.exec(
      "UPDATE sns_auto_send_control SET mode='manual' WHERE channel='x'",
    );
  }
};

/** await withAuto(async () => { の中身を割った 1/2 */
async function stpReply1() {
  const notes = [];
  const result = await plan({ notes, loadVariants: () => TYPE_VARIANTS });
  assert.equal(result.report.items[0].outcome, "notified");
  const state = await sqlStore.todayState(DATE);
  const { draft: parent, item } = state;
  const { draft: child, item: childItem } = state.reply;
  assert.equal(linkAt(parent.caption_text), -1);
  assert.ok(!parent.caption_text.includes("今日の一覧はこちら"));
  assert.equal(
    child.caption_text,
    `今日の一覧はこちら：https://www.boat-ai.jp/x/today?d=${DATE}-a`,
  );
  assert.equal(child.source_data.today_reply.parent_draft_id, parent.id);
  assert.equal(child.source_data.image_paths, undefined);
  assert.equal(child.cover_image_path, null);
  assert.equal(child.source_data.content_type.id, "t01-link-in-reply");
  assert.equal(child.publish_blocked, false);
  assert.equal(result.report.items[0].reply_draft_id, child.id);
  assert.deepEqual([item.state, childItem.state], ["notified", "notified"]);
  assert.equal(childItem.race_id, `today:${DATE}:reply`);
  const parentJob = await first(
    "SELECT * FROM sns_x_send_jobs WHERE draft_id=$1",
    [parent.id],
  );
  const childJob = await first(
    "SELECT * FROM sns_x_send_jobs WHERE draft_id=$1",
    [child.id],
  );
  assert.equal(childJob.parent_job_id, parentJob.id);
  assert.equal(childJob.auto_item_id, childItem.id);
  assert.equal(
    childJob.scheduled_at.toISOString(),
    parentJob.scheduled_at.toISOString(),
  );
  assert.ok(
    notes.some((n) => n.includes("（自分への返信）今日の一覧はこちら：")),
  );
  // 送信の runner は親が posted の子だけを選ぶ
  const { pickDueJobs } = await import("../../lib/snsSendRunner.js");
  assert.deepEqual(
    pickDueJobs([parentJob, childJob], [parentJob]).map((j) => j.id),
    [parentJob.id],
  );
  assert.deepEqual(
    pickDueJobs(
      [childJob],
      [{ ...parentJob, state: "posted", external_post_id: "123" }],
    ).map((j) => j.id),
    [childJob.id],
  );
  // 子の送る直前の検査（一覧の版の読み直し）は親と同じに通る
  const sent = {
    ...childJob,
    snapshot_text: JSON.stringify(childJob.snapshot),
  };
  await createDeadlinePreflight({
    headless: createMockHeadless({ visibleSelectors: SCREEN_MARKERS.today }),
    markers: SCREEN_MARKERS,
    readCurrent: createReadCurrent({
      db: async (path) =>
        path.startsWith("sns_drafts")
          ? [{ bundle_import_id: null, source_data: child.source_data }]
          : raceDbOf()(path),
      getDigest: async () => digestOf(),
    }),
    now: () => at("07:01").getTime(),
  })(sent);
  // 同じ版でもう一度走らせても何も書かない
  const again = await plan({
    now: at("06:50"),
    loadVariants: () => TYPE_VARIANTS,
  });
  assert.equal(again.report.items[0].outcome, "unchanged");
  // 一覧がやり直されたら、親も子も作り直して、同じ親の job につなぎ直す
  const rebuilt = await plan({
    now: at("06:55"),
    digest: digestOf(24),
    loadVariants: () => TYPE_VARIANTS,
  });
  assert.equal(rebuilt.report.items[0].outcome, "rebuilt");
  const child2 = await first("SELECT * FROM sns_drafts WHERE id=$1", [
    child.id,
  ]);
  assert.equal(child2.status, "approved");
  return { child, parentJob, rebuilt, child2 };
}

/** await withAuto(async () => { の中身を割った 2/2 */
async function stpReply2({ child, child2, parentJob, rebuilt }) {
  assert.equal(
    child2.source_data.digest.revision,
    rebuilt.report.items[0].revision,
  );
  const childJob2 = await first(
    "SELECT * FROM sns_x_send_jobs WHERE draft_id=$1",
    [child.id],
  );
  assert.equal(childJob2.state, "queued");
  assert.equal(childJob2.parent_job_id, parentJob.id);
  assert.equal((await all("SELECT * FROM sns_drafts")).length, 2);
}

function stpb2Scene1() {
  test("160: X の画像は image_paths の数・順・種類とそろったときだけ承認できる。image_paths の無い下書きは今までどおり1つ", async () => {
    await plan();
    const [draft] = await all("SELECT * FROM sns_drafts");
    const snapshot = await createXSnapshot(draft, loadMedia);
    assert.equal(snapshot.media.length, 4);
    const tryApprove = (snap) =>
      db.query("SELECT approve_sns_x_send($1,$2,$3,NULL)", [draft.id, stpState.me, snap]);
    for (const [bad, why] of [
      [
        { ...snapshot, media: snapshot.media.slice(0, 3) },
        /画像の数・並びが不正です/,
      ],
      [
        {
          ...snapshot,
          media: [
            snapshot.media[1],
            snapshot.media[0],
            ...snapshot.media.slice(2),
          ],
        },
        /媒体のhash・サイズが不正です/,
      ],
      [
        {
          ...snapshot,
          media: snapshot.media.map((m, i) =>
            i === 2 ? { ...m, type: "video/mp4" } : m,
          ),
        },
        /媒体のhash・サイズが不正です/,
      ],
      [
        {
          ...snapshot,
          media: snapshot.media.map((m, i) =>
            i === 3 ? { ...m, size: 6_000_000 } : m,
          ),
        },
        /媒体のhash・サイズが不正です/,
      ],
    ])
      await assert.rejects(tryApprove(bad), why);
    // 5枚は作れない（image_paths が4枚を超える下書きは承認しない）
    await db.exec(
      "ALTER TABLE sns_drafts DISABLE TRIGGER USER; UPDATE sns_drafts SET source_data = jsonb_set(source_data, '{image_paths}', (source_data->'image_paths') || '[\"x/5.png\"]'::jsonb) WHERE id=$1; ALTER TABLE sns_drafts ENABLE TRIGGER USER;".replaceAll(
        "$1",
        `'${draft.id}'`,
      ),
    );
    await assert.rejects(tryApprove(snapshot), /画像の数・並びが不正です/);
    // image_paths の無い X の下書き（今までの1枚）は、今までどおり承認できる
    await db.exec(
      "ALTER TABLE sns_drafts DISABLE TRIGGER USER; UPDATE sns_drafts SET source_data = source_data - 'image_paths'; ALTER TABLE sns_drafts ENABLE TRIGGER USER;",
    );
    const [single] = await all("SELECT * FROM sns_drafts");
    const one = await createXSnapshot(single, loadMedia);
    assert.equal(one.media.length, 1);
    const job = (
      await first("SELECT approve_sns_x_send($1,$2,$3,NULL) r", [
        single.id,
        stpState.me,
        one,
      ])
    ).r;
    assert.equal(job.state, "queued");
  });
  // ---- 後半の場面（verifyData/sns-today-plan-scenes-2.js・sns-today-plan-scenes-3.js） ----
  runSnsTodayPlanScenes6({ db, all, t, at, shooter, plan, approve });
  runSnsTodayPlanScenes7({ db, first, all, at, trackingStore, shooter, plan });
}

/** verify から呼ぶ入口。env は verify 側の束縛（db・first・all・t・at・stpState・sqlStore・trackingStore・shooter・plan・loadMedia・approve・stpVar1・stpVar3） */
export function runSnsTodayPlanScenesB3(env) {
  ({ db, first, all, t, at, stpState, sqlStore, trackingStore, shooter, plan, loadMedia, approve, stpVar1, stpVar3 } = env);
  stpb2Scene1();
}

/** verify から呼ぶ入口。env は verify 側の束縛（db・first・all・t・at・stpState・sqlStore・trackingStore・shooter・plan・loadMedia・approve・stpVar1・stpVar3） */
export function runSnsTodayPlanScenesB4(env) {
  ({ db, first, all, t, at, stpState, sqlStore, trackingStore, shooter, plan, loadMedia, approve, stpVar1, stpVar3 } = env);

}

function stpb2Scene2() {
  test("171: /today の見出しの2案の行を入れる。もう一度当てても増えない。入れた後は案の uuid で tracking・下書きに札が入る", async () => {
    const { sql } = await stpVar1();
    const { rows } = await stpVar2({ sql });
    const { config } = await stpVar3();
    stpVar4({ config, rows });
  });
  // ---- 後半の場面（verifyData/sns-today-plan-scenes-3.js） ----
  runSnsTodayPlanScenes8({ db, first, all, at, trackingStore, shooter, plan });
  // ---- 後半の場面（verifyData/sns-today-plan-scenes-3.js） ----
  runSnsTodayPlanScenes9({ db, first, all, at, trackingStore, shooter, plan, putType });
  // ---- 後半の場面（verifyData/sns-today-plan-scenes-3.js・sns-today-plan-scenes-4.js） ----
  runSnsTodayPlanScenes10({ db, first, all, at, trackingStore, shooter, plan, putType });
  runSnsTodayPlanScenes11({ db, first, all, at, sqlStore, plan, putType, withAuto });
  test("返信（link_position=reply、mode=auto）: 本文にリンクを置かず、リンクだけの子の下書き・item を作り、親の job につないで自動で承認する。子は親の公開の後に選ばれる", async () => {
    await putType(DATE, "t01-link-in-reply", {
      heading: "本日のデータ一覧（{date}）",
      link_position: "reply",
    });
    await withAuto(async () => {
      const { child, parentJob, rebuilt, child2 } = await stpReply1();
      await stpReply2({ child, child2, parentJob, rebuilt });
    });
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（db・first・all・t・at・stpState・sqlStore・trackingStore・shooter・plan・loadMedia・approve・stpVar1・stpVar3） */
export function runSnsTodayPlanScenesB5(env) {
  ({ db, first, all, t, at, stpState, sqlStore, trackingStore, shooter, plan, loadMedia, approve, stpVar1, stpVar3 } = env);
  stpb2Scene2();
}
