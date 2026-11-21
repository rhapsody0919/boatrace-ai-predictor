/**
 * verify-sns-today-plan.js の後半の場面（3/3）。verify ではない。
 * 判定と期待値は分ける前の verify-sns-today-plan.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createDeadlinePreflight, createMockHeadless } from "../../../api/_lib/snsDeadlineQueue.js";
import { createReadCurrent } from "../../../api/_lib/snsClaimCheck.js";
import { SCREEN_MARKERS } from "../../lib/snsScreenMarkers.js";
import { DATE, v3RaceDb } from "./sns-today-plan-v3-race-db.js";
import {
  pickExperimentSide,
  normalizeTodayExperiment,
  loadTodayVariants,
} from "../../lib/snsTodayVariants.js";
import { digestOf } from "./sns-today-plan-scenes-1.js";
import { TYPE_VARIANTS } from "./sns-today-plan-scenes-3.js";
import { runSnsTodayPlanScenes12 } from "./sns-today-plan-scenes-4.js";
import { runSnsTodayPlanScenes13, runSnsTodayPlanScenes14 } from "./sns-today-plan-scenes-5.js";
import { runSnsTodayPlanScenes15, runSnsTodayPlanScenes16 } from "./sns-today-plan-scenes-6.js";
import { runSnsTodayPlanScenes17 } from "./sns-today-plan-scenes-7.js";
import { putType, withAuto } from "./sns-today-plan-scenes-b-2.js";

let LEGACY_VARIANTS, db, first, all, PNG, at, sqlStore, shooter, plan, approve, stpRb21;

/** test("返信: 送信の側（158・153 の transition）で、親の claim → 公開 → 子の claim が通る。子の予 の中身を割った 2/2 */
async function stpRb22({ runbook }) {
  const sql = runbook
    .split("<!-- l2-today-sql:start -->")[1]
    .split("<!-- l2-today-sql:end -->")[0]
    .replace(/```sql|```/g, "");
  await db.exec(
    "UPDATE sns_x_send_control SET period_start=NULL, period_end=NULL, reserved_microusd=0, paused=true",
  );
  await db.query("UPDATE test_clock SET value=$1", [at("06:40")]);
  await db.exec(sql.replaceAll("now()", "test_now()"));
  await db.exec(
    "UPDATE sns_x_send_control SET period_start = test_now() - interval '1 day', period_end = test_now() + interval '30 days', daily_limit_x = 2",
  );
  await putType(DATE, "t01-link-in-reply", {
    heading: "本日のデータ一覧（{date}）",
    link_position: "reply",
  });
  await withAuto(async () => {
    await db.exec(
      "UPDATE sns_auto_send_control SET dry_run=false WHERE channel='x'",
    );
    try {
      await plan({ loadVariants: () => TYPE_VARIANTS });
      const state = await sqlStore.todayState(DATE);
      const parentJob = await first(
        "SELECT * FROM sns_x_send_jobs WHERE draft_id=$1",
        [state.draft.id],
      );
      const childJob = await first(
        "SELECT * FROM sns_x_send_jobs WHERE draft_id=$1",
        [state.reply.draft.id],
      );
      await db.query("UPDATE test_clock SET value=$1", [at("07:01")]);
      const claim = async (id) =>
        (await first("SELECT transition_sns_x_send($1,'claim','{}') r", [id]))
          .r;
      const parent = await claim(parentJob.id);
      assert.equal(parent.state, "sending", JSON.stringify(parent));
      await first("SELECT transition_sns_x_send($1,'begin_post','{}') r", [
        parentJob.id,
      ]);
      const done = (
        await first("SELECT transition_sns_x_send($1,'complete',$2) r", [
          parentJob.id,
          { id: "1234567890", posted_at: at("07:01").toISOString() },
        ])
      ).r;
      assert.equal(done.state, "posted", JSON.stringify(done));
      const child = await claim(childJob.id);
      assert.equal(child.state, "sending", JSON.stringify(child));
      // 子の予約も URL つきの額（thread_index=0）。親子で2本分
      const control = await first(
        "SELECT reserved_microusd::bigint r FROM sns_x_send_control",
      );
      assert.equal(Number(control.r), 500000);
    } finally {
      await db.exec(
        "UPDATE sns_auto_send_control SET dry_run=true WHERE channel='x'",
      );
    }
  });
}

/** DATE が型 b の日になる比べの設定（組の1日目か2日目かは乱数で決まるので、b になる方を選ぶ） */
function abVariants() {
  const base = {
    default: "本日のデータ一覧（{date}）",
    variants: [
      {
        id: "a",
        type_id: "today-a",
        heading: "本日のデータ一覧（{date}）",
        uuid: null,
      },
      {
        id: "b",
        type_id: "today-b-course-win",
        body: "course_win",
        heading: "【今日の注目データ】{date}",
        uuid: null,
      },
    ],
  };
  for (const start of [DATE, "2037-10-16"]) {
    const experiment = { id: "t-ab", start, pairs: 10, seed: "verify" };
    if (
      pickExperimentSide(normalizeTodayExperiment(experiment), DATE).side ===
      "b"
    )
      return { ...base, experiment };
  }
  throw new Error("b の日を作れない");
}

// ---------- 型 v3「今日はこれだけ」（BOA-1314、オーナー 2026-11-04 承認） ----------
// 読み取りの模型 v3RaceDb は verifyData/sns-today-plan-v3-race-db.js

/** test("型 v3: リポジトリの config で 6:40 に文だけの下書きを作る（画像なし・撮影なし）。札は c、UTM は日付-c の中身を割った 1/2 */
async function stpV31() {
  const notes = [];
  const headless = shooter();
  const saved = [];
  const result = await plan({
    notes,
    headless,
    saved,
    raceDb: v3RaceDb(),
    loadVariants: loadTodayVariants,
  });
  assert.equal(result.report.items[0].outcome, "manual");
  assert.equal(result.report.items[0].content_type, "today-c-digest");
  const draft = await first("SELECT * FROM sns_drafts");
  const lines = draft.caption_text.split("\n");
  assert.deepEqual(lines.slice(0, 3), [
    "10月17日（土）今日のボートレース 2場",
    "🏆 優勝戦 丸亀12R 20:15締切",
    `全レースの一覧 → https://www.boat-ai.jp/x/today?d=${DATE}-c`,
  ]);
  assert.match(
    draft.caption_text,
    /【逃げ率が高い選手】\n選手 241 A1\u300083%（50走）\n▶ 戸田4R 1号艇 12:02締切/,
  );
  assert.match(
    draft.caption_text,
    /【逃し率が高い選手】\n選手 262 A1\u300070%（40走）\n▶ 戸田6R 2号艇 14:02締切/,
  );
  assert.match(draft.caption_text, /▶ 戸田7R 4号艇 15:02締切/);
  assert.ok(draft.caption_text.endsWith("#ボートレース"));
  // 画像は無い（撮らない・保存しない・image_paths を持たない）。/today の表示の確認だけはする
  assert.equal(headless.calls.length, 0);
  assert.equal(headless.inspects.length, 1);
  assert.equal(saved.length, 0);
  assert.equal(draft.cover_image_path, null);
  assert.equal("image_paths" in draft.source_data, false);
  assert.deepEqual(
    [
      draft.source_data.content_type.id,
      draft.source_data.content_type.sent,
      draft.source_data.content_type.body,
      draft.source_data.today_variant.id,
    ],
    ["today-c-digest", "c", "digest_v3", "c"],
  );
  assert.equal(draft.source_data.digest_v3.send_at, "07:00");
  assert.deepEqual(draft.source_data.digest_v3.featured, {
    race_id: `${DATE}-15-12`,
    boat_number: null,
  });
  assert.equal(draft.source_data.deadline_queue.thread_length, 1);
  assert.equal(draft.scheduled_at.toISOString(), at("07:00").toISOString());
  const tracking = await first(
    "SELECT * FROM sns_post_tracking WHERE draft_id=$1",
    [draft.id],
  );
  assert.equal(tracking.utm_content, `${DATE}-c`);
  assert.equal(tracking.template_variant_id, null);
  assert.doesNotMatch(notes[0], /画像1:/);
  // 本人の承認（本文だけ）→ 7:00 の job。送る直前の検査は一覧の版と欠場・中止の読み直しで通る
  const job = await approve(draft);
  assert.equal(job.state, "queued");
  assert.equal(job.snapshot.media.length, 0);
  assert.equal(
    new Date(job.scheduled_at).toISOString(),
    at("07:00").toISOString(),
  );
  const preflight = (races) =>
    createDeadlinePreflight({
      headless: createMockHeadless({ visibleSelectors: SCREEN_MARKERS.today }),
      markers: SCREEN_MARKERS,
      readCurrent: createReadCurrent({
        db: async (path) =>
          path.startsWith("sns_drafts")
            ? [{ bundle_import_id: null, source_data: draft.source_data }]
            : races(path),
        getDigest: async () => digestOf(),
      }),
      now: () => at("07:01").getTime(),
    });
  const sent = { ...job, snapshot_text: JSON.stringify(job.snapshot) };
  await preflight(v3RaceDb())(sent);
  return { preflight, sent };
}

/** test("型 v3: リポジトリの config で 6:40 に文だけの下書きを作る（画像なし・撮影なし）。札は c、UTM は日付-c の中身を割った 2/2 */
async function stpV32({ preflight, sent }) {
  // 載せた優勝戦が中止・率の塊の艇が欠場になったら送らない
  for (const races of [
    v3RaceDb({ cancelled: [`${DATE}-15-12`] }),
    v3RaceDb({ absent: [`${DATE}-02-04:1`] }),
  ])
    await assert.rejects(
      preflight(races)(sent),
      /race_unconfirmed_or_withdrawn/,
    );
}

function stpb3Scene1() {
  // ---- 後半の場面（verifyData/sns-today-plan-scenes-4.js） ----
  runSnsTodayPlanScenes12({ db, first, all, at, sqlStore, plan, putType, withAuto });
}

/** verify から呼ぶ入口。env は verify 側の束縛（LEGACY_VARIANTS・db・first・all・PNG・at・sqlStore・shooter・plan・approve・stpRb21） */
export function runSnsTodayPlanScenesB6(env) {
  ({ LEGACY_VARIANTS, db, first, all, PNG, at, sqlStore, shooter, plan, approve, stpRb21 } = env);
  stpb3Scene1();
}

function stpb3Scene2() {
  test("返信: 送信の側（158・153 の transition）で、親の claim → 公開 → 子の claim が通る。子の予約も URL つきの額（system-architect の審査 P2-4）", async () => {
    const { runbook } = await stpRb21();
    await stpRb22({ runbook });
  });
  // ---- 後半の場面（verifyData/sns-today-plan-scenes-5.js） ----
  runSnsTodayPlanScenes13({ db, first, PNG, at, sqlStore, shooter, plan, putType, withAuto, abVariants });
  // ---- 後半の場面（verifyData/sns-today-plan-scenes-5.js・sns-today-plan-scenes-6.js） ----
  runSnsTodayPlanScenes14({ db, first, PNG, at, sqlStore, shooter, plan, putType, withAuto, abVariants });
  runSnsTodayPlanScenes15({ db, first, all, at, plan, abVariants });
  test("型 v3: リポジトリの config で 6:40 に文だけの下書きを作る（画像なし・撮影なし）。札は c、UTM は日付-c、承認すると 7:00 の job、送る直前の検査も通る", async () => {
    const { preflight, sent } = await stpV31();
    await stpV32({ preflight, sent });
  });
  // ---- 後半の場面（verifyData/sns-today-plan-scenes-6.js・sns-today-plan-scenes-7.js） ----
  runSnsTodayPlanScenes16({ db, first, all, at, plan, abVariants });
  runSnsTodayPlanScenes17({ LEGACY_VARIANTS, first, all, at, sqlStore, plan, putType, withAuto });
}

/** verify から呼ぶ入口。env は verify 側の束縛（LEGACY_VARIANTS・db・first・all・PNG・at・sqlStore・shooter・plan・approve・stpRb21） */
export function runSnsTodayPlanScenesB7(env) {
  ({ LEGACY_VARIANTS, db, first, all, PNG, at, sqlStore, shooter, plan, approve, stpRb21 } = env);
  stpb3Scene2();
}
