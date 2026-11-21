// X の日の枠の出し物ごとの取り置き（マイグレーション 182、docs/design/x-daily-slots/plan.md）の再現テスト。
// PGlite に 180（#1978 の「数字で見たら」）までと 182 を当て、本番と同じ承認（approve_sns_x_send）・claim（transition_sns_x_send → transition_sns_send_139）で通す。
// 外部接続なし。X へは何も送らない
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { setupSnsDb } from "./verifyData/sns-db-setup.js";
import { createXSnapshot } from "../../api/_lib/snsXSend.js";


import { runSnsXSlotsScenes1, runSnsXSlotsScenes2 } from "./verifyData/sns-x-slots-scenes-1.js";
import { runSnsXSlotsScenes3 } from "./verifyData/sns-x-slots-scenes-2.js";

const db = new PGlite();
const first = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const all = async (sql, args = []) => (await db.query(sql, args)).rows;
const loadMedia = async () => new Uint8Array([1, 2, 3]);
// 2026-10-27（火）JST 12:00
const T0 = Date.parse("2026-10-27T03:00:00Z");
// 曜日を変えるテストだけ base を動かす（終わったら T0 に戻す）
let base = T0;
const at = (minutes) => new Date(base + minutes * 60000).toISOString();
const setClock = (minutes) =>
  db.query("UPDATE test_clock SET value=$1", [at(minutes)]);
const DEADLINE = 300; // 締切は T0+300分（17:00）
const hash = () => randomBytes(32).toString("hex");
let autoApprover;
let seeded;
let seq = 0;

before(async () => {
  await setupSnsDb(db, {
    base: import.meta.url,
    files: [
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
      "182_sns_x_kind_reserves.sql",
    ],
  });
  seeded = await all(
    "SELECT kind, daily_count, weekdays FROM sns_x_kind_reserves ORDER BY kind",
  );
  autoApprover = (
    await first(
      "SELECT auto_approver_id id FROM sns_auto_send_control WHERE channel='x'",
    )
  ).id;
});

// ---- 後半の場面（verifyData/sns-x-slots-scenes-1.js） ----
runSnsXSlotsScenes1({ db, first, all, setClock, makeJob, post, finalsPair });

const FORMAT = {
  full_picture: "full_picture",
  digest: "today_digest",
  finals_image: "finals_image",
  research_image: "research_image",
};
const transition = async (id, action, result = {}) =>
  (
    await first("SELECT transition_sns_x_send($1,$2,$3) r", [
      id,
      action,
      result,
    ])
  ).r;

/**
 * 自動送信の承認者で承認した X の job（送る時刻は今）。kind=null は item の無い通り道 B の下書き（本人の承認は使わず、
 * 自動の承認者は item が要るので、B は item の無い job を直接 queued にする）
 */
async function makeJob(kind, { variant, parentJobId = null } = {}) {
  seq += 1;
  const draft = await first(
    `INSERT INTO sns_drafts(content_group_id,format,platform,language,caption_text,send_lane,publish_blocked,source_data)
     VALUES(gen_random_uuid(),$1,'x','ja',$2,'A',false,jsonb_build_object('deadline_queue',$3::jsonb)) RETURNING *`,
    [
      FORMAT[kind],
      `${kind} ${seq}`,
      {
        deadline_at: at(DEADLINE),
        expires_at: at(
          DEADLINE -
            (kind === "finals_image" ? 5 : kind === "research_image" ? 60 : 30),
        ),
        source_revision: `r${seq}`,
        source_observed_at: at(0),
        ...(parentJobId ? { parent_job_id: parentJobId } : {}),
      },
    ],
  );
  await db.query(
    `INSERT INTO sns_auto_send_items(kind,draft_id,channel,variant,race_id,deadline_at,notify_by,veto_until,state,checks,stop_token_hash,notified_at)
     VALUES($1,$2,'x',$3,$4,$5,$6,$7,'notified',$8,$9,$10)`,
    [
      kind,
      draft.id,
      variant ?? (kind === "finals_image" ? "finals" : "main"),
      kind === "research_image" ? `research:${at(0).slice(0, 10)}:r${seq}` : `R${seq}`,
      at(DEADLINE),
      at(-180),
      at(0),
      { passed: true },
      hash(),
      at(0),
    ],
  );
  return (
    await first("SELECT approve_sns_x_send($1,$2,$3,$4) r", [
      draft.id,
      autoApprover,
      await createXSnapshot(draft, loadMedia),
      at(0),
    ])
  ).r;
}
const claim = (job) => transition(job.id, "claim");
async function post(job) {
  await transition(job.id, "check");
  await transition(job.id, "begin_post");
  seq += 1;
  return transition(job.id, "complete", {
    id: String(9000 + seq),
    posted_at: at(1),
  });
}
const room = async (kind, need, withQueued = true) =>
  (
    await first("SELECT sns_x_slot_room($1,$2,$3,NULL) r", [
      kind,
      need,
      withQueued,
    ])
  ).r;
const attemptsToday = async () =>
  Number(
    (
      await first(
        `SELECT count(*) n FROM sns_x_send_jobs, LATERAL unnest(attempt_dates, attempt_channels) a(day, ch)
         WHERE ch='x' AND day=(test_now() AT TIME ZONE 'Asia/Tokyo')::date`,
      )
    ).n,
  );

/** 優勝戦の本投稿と投票のリプ（子）を承認し、本投稿を claim する */
async function finalsPair() {
  const main = await makeJob("finals_image");
  const poll = await makeJob("finals_image", {
    variant: "finals_poll",
    parentJobId: main.id,
  });
  return { main, poll, claimed: await claim(main) };
}

// ---- 後半の場面（verifyData/sns-x-slots-scenes-1.js・sns-x-slots-scenes-2.js） ----
runSnsXSlotsScenes2({ db, first, all, setClock, makeJob, claim, post, room, attemptsToday, finalsPair });
runSnsXSlotsScenes3();

test("182: マイグレーションの初期の取り置きは 全貌4・/today 1・優勝戦3・数字で見たら1（月水金）", () => {
  assert.deepEqual(
    seeded.map((r) => [r.kind, r.daily_count, r.weekdays]),
    [
      ["digest", 1, null],
      ["finals_image", 3, null],
      ["full_picture", 4, null],
      ["research_image", 1, [1, 3, 5]],
    ],
  );
});

test("182: #1978 と重ねたとき、数字で見たら（research_image）の取り置きは月水金だけ効き、送る口（180 の許可・期限）の照合も残る", async () => {
  await db.exec("UPDATE sns_x_send_control SET daily_limit_x=9");
  await db.exec(
    "INSERT INTO sns_x_kind_reserves(kind, daily_count, weekdays) VALUES ('research_image', 1, '{1,3,5}')",
  );
  // 水曜（2026-10-28 JST 12:00）。全貌4・/today 1・優勝戦3・数字で見たら1＝9＝上限
  base = Date.parse("2026-10-28T03:00:00Z");
  try {
    await setClock(1);
    await db.exec(
      "UPDATE sns_x_send_control SET daily_baseline_date=(test_now() AT TIME ZONE 'Asia/Tokyo')::date",
    );
    const claimOf = async (kind) => claim(await makeJob(kind));
    for (let i = 0; i < 4; i++)
      assert.equal((await claimOf("full_picture")).state, "sending");
    // 全貌の5本目は、数字で見たらの取り置きの残りを使えないので止まる（火曜なら残り1で通る。上の曜日のテスト）
    assert.equal((await claimOf("full_picture")).error_code, "kind_slot_full");
    // 数字で見たらの1本は取り置きで通る（180 の許可が true・期限は締切の60分前）
    assert.equal((await claimOf("research_image")).state, "sending");
    // /today と優勝戦は取り置きのまま通る
    assert.equal((await claimOf("digest")).state, "sending");
    const { claimed } = await finalsPair();
    assert.equal(claimed.state, "sending");
    // 試行は 全貌4・数字で見たら1・/today 1・優勝戦の本投稿1＝7、投票のリプ（claim 済みの親の子）を予定に数えて8
    assert.equal(await attemptsToday(), 7);
    assert.equal((await room("full_picture", 1, false)).ok, false);
    // 180 の許可・期限・鮮度の照合は 182 の置き換えでも残る（research_image_enabled=false の held は verify-sns-research-image.js が見る）
    const src = await first(
      "SELECT prosrc FROM pg_proc WHERE proname='transition_sns_send_139'",
    );
    assert.match(src.prosrc, /research_image_disabled/);
    assert.match(src.prosrc, /kind_slot_full/);
  } finally {
    base = T0;
  }
});
