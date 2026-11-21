/**
 * verify-upset-win.js の後半の場面（4/5）。verify ではない。
 * 判定と期待値は分ける前の verify-upset-win.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { addDays } from "../../../sns-video-studio/remotion/src/upsetWin/model.js";
import {
  resultLine,
  raceReasons,
  dryRunClock,
  descriptionLink,
  checkUpsetBundle,
  upsetStatus,
} from "../../sns/push-upset-win-short.js";
import { createMockYoutubeAdapter, runYoutubeQueueJob } from "../../../api/_lib/snsDeadlineQueue.js";
import { db, first, upwState, setClock, all } from "./upset-win-scenes-2.js";
import { push, counts, NOTHING, theJob, transition, sonarHeadless, preflightAt, store, readCurrent } from "./upset-win-scenes-3.js";

let riskRules, SAMPLE, DAY, at, UPSET_ID, clone, bundle, raceOfSample, mp4, VIDEO;

function upw4Scene1() {
  test("許可が off なら、検査が通っても何も書かない（disabled・exit 3）。--dry-run も書かない（exit 0）", async () => {
    await db.exec(
      "UPDATE sns_auto_send_control SET upset_win_short_enabled=false",
    );
    const off = await push();
    assert.equal(off.disabled, true, JSON.stringify(off.reasons));
    assert.deepEqual(off.notes, []);
    assert.equal(resultLine(off).code, 3);
    await db.exec(
      "UPDATE sns_auto_send_control SET upset_win_short_enabled=(channel='youtube')",
    );
    const dry = await push(bundle(), { dryRun: true });
    assert.equal(dry.dryRun, true, JSON.stringify(dry.reasons));
    assert.equal(resultLine(dry).code, 0);
    assert.deepEqual(await counts(), NOTHING);
  });
  test("許可が on・mode=auto: 動画1本の YouTube の job を送る時刻（07:15）の予定に入れる。題・説明欄は bundle の値のまま、リンク先の確認は龍神ソナーの頁", async () => {
    const r = await push();
    assert.ok(r.job_id, JSON.stringify(r));
    assert.equal(new Date(r.send_at).toISOString(), at("07:15:00").toISOString());
    const d = await first("SELECT * FROM sns_drafts");
    assert.equal(d.title, SAMPLE.youtube.title);
    assert.equal(d.caption_text, SAMPLE.youtube.description);
    assert.equal(d.format, "upset_win_short");
    assert.equal(
      d.source_data.deadline_queue.public_url,
      `https://www.boat-ai.jp/race/${SAMPLE.race_id}?tab=sonar`,
    );
    assert.equal(d.source_data.deadline_queue.screen_key, "race-sonar");
    const item = await first("SELECT * FROM sns_auto_send_items");
    assert.deepEqual(
      [item.kind, item.race_id, item.state],
      ["upset_win_short", UPSET_ID, "notified"],
    );
    const job = await theJob();
    assert.equal(
      new Date(job.expires_at).toISOString(),
      at("08:15:00").toISOString(),
    );
    assert.equal(r.notes.length, 1);
    assert.equal(resultLine(r).code, 0);
  });
  test("画面の数字と DB の照合: そのレースの6艇の値・1着・決まり手・単勝が DB と違えば、また中止・欠場があれば受け取らない", async () => {
    for (const [f, re] of [
      [(r) => (r.boats[3].odds = 34.8), /4号艇の odds/],
      [(r) => (r.boats[0].exhibition_time = 6.83), /1号艇の exhibition_time/],
      [(r) => (r.boats[1].racer = "別人"), /2号艇の racer/],
      [(r) => (r.rank1 = 1), /1着/],
      [(r) => (r.technique = "差し"), /決まり手/],
      [(r) => (r.absent = true), /欠場/],
      [(r) => (r.cancelled = true), /中止/],
    ]) {
      upwState.dbRace = raceOfSample();
      f(upwState.dbRace);
      const r = await push();
      assert.match((r.reasons ?? []).join(), re);
    }
    upwState.dbRace = null;
    assert.match((await push()).reasons.join(), /DB に無い/);
    assert.deepEqual(await counts(), NOTHING);
    assert.deepEqual(raceReasons(SAMPLE, raceOfSample()), []);
  });
}

function upw4Scene2() {
  test("時刻: 送る時刻は 07:00〜07:50、送る時刻の15分前より早い受け取り・今日でない日・送る時刻が8時を過ぎるものは受け取らない", async () => {
    assert.match(
      (await push(bundle({ send_time: "08:00" }))).reasons.join(),
      /send_time/,
    );
    assert.match(
      (await push(bundle({ send_time: "06:59" }))).reasons.join(),
      /send_time/,
    );
    assert.match(
      (
        await push(bundle({ send_time: "07:30" }), { now: at("07:10:00") })
      ).reasons.join(),
      /15分前/,
    );
    assert.match(
      (
        await push(bundle(), { now: at("07:03:00", addDays(DAY, 1)) })
      ).reasons.join(),
      /今日/,
    );
    // 7:59 に受け取ると送る時刻は今＋2分の 8:01（7時台でない）
    assert.match(
      (await push(bundle(), { now: at("07:59:00") })).reasons.join(),
      /7時台/,
    );
    assert.deepEqual(await counts(), NOTHING);
    // 見本の束（date が今日でない）を dry-run で見ると、その日の送る時刻の2分前の時計
    assert.equal(
      dryRunClock(SAMPLE, new Date("2030-01-01T00:00:00Z")).toISOString(),
      at("07:13:00").toISOString(),
    );
  });
  test("この口の検査: 説明欄のリンクはちょうど1つでそのレースの龍神ソナーの頁（tab=sonar・utm_* だけ）。題100字・改行・< >", () => {
    const ok = descriptionLink(SAMPLE.youtube.description, SAMPLE.race_id);
    assert.deepEqual(ok, {
      url: `https://www.boat-ai.jp/race/${SAMPLE.race_id}?tab=sonar`,
      reasons: [],
    });
    assert.match(
      descriptionLink(
        "https://www.boat-ai.jp/race/2026-11-03-17-11?tab=sonar",
        SAMPLE.race_id,
      ).reasons.join(),
      /龍神ソナー/,
    );
    assert.match(
      descriptionLink(
        `https://www.boat-ai.jp/race/${SAMPLE.race_id}?tab=sonar&x=1`,
        SAMPLE.race_id,
      ).reasons.join(),
      /龍神ソナー/,
    );
    assert.match(
      descriptionLink(
        `https://www.boat-ai.jp/race/${SAMPLE.race_id}`,
        SAMPLE.race_id,
      ).reasons.join(),
      /龍神ソナー/,
    );
    assert.match(
      descriptionLink(
        "a https://x.com b https://www.boat-ai.jp/",
        SAMPLE.race_id,
      ).reasons.join(),
      /ちょうど1つ/,
    );
    assert.deepEqual(checkUpsetBundle(SAMPLE, riskRules), []);
    assert.match(
      checkUpsetBundle({ ...clone(SAMPLE), video: "x.mp4" }, riskRules).join(),
      /video/,
    );
  });
}

function upw4Scene3() {
  test("claim: 送る時刻に sending になり、YouTube のクォータ（1 upload・104 units）を予約する。許可を off にすると held（upset_win_short_disabled）。節の機力の許可には当たらない", async () => {
    await push();
    const job = await theJob();
    await assert.rejects(
      transition(job.id, "claim"),
      /veto_window_open|claimできません/,
    );
    await setClock(new Date(Date.parse(job.scheduled_at)));
    // 節の機力の許可が off でも止まらない
    assert.equal(
      (
        await first(
          "SELECT setsu_kiryoku_short_enabled v FROM sns_auto_send_control WHERE channel='youtube'",
        )
      ).v,
      false,
    );
    const claimed = await transition(job.id, "claim");
    assert.equal(claimed.state, "sending");
    const quota = await first(
      "SELECT upload_reserved, general_reserved FROM sns_youtube_quota_attempts WHERE job_id=$1",
      [job.id],
    );
    assert.deepEqual([quota.upload_reserved, quota.general_reserved], [1, 104]);
    await db.exec(
      "DELETE FROM sns_youtube_quota_attempts; UPDATE sns_x_send_jobs SET state='queued', attempts=0, attempt_dates='{}', attempt_channels='{}', lease_until=NULL, locked_at=NULL",
    );
    await db.exec(
      "UPDATE sns_auto_send_control SET upset_win_short_enabled=false",
    );
    const held = await transition(job.id, "claim");
    assert.deepEqual(
      [held.state, held.error_code],
      ["held", "upset_win_short_disabled"],
    );
  });
  test("送る: 送る時刻に動画を YouTube に上げて公開し、item が sent・状態に動画の URL が出る。同じ日の2本目は作らない（exit 4）。送り手の読み直しは許可・同じ日に送ったか・item を見る", async () => {
    await push();
    const job = await theJob();
    const sendAt = new Date(Date.parse(job.scheduled_at));
    await setClock(sendAt);
    const youtube = createMockYoutubeAdapter({
      videoId: "upsetvideo1",
      postedAt: sendAt.toISOString(),
    });
    const headless = sonarHeadless();
    const done = await runYoutubeQueueJob(job.id, {
      store: { transition: (id, action, r = {}) => transition(id, action, r) },
      youtube,
      loadMedia: async () => VIDEO,
      preflight: preflightAt(sendAt, headless),
    });
    assert.equal(done.state, "posted", done.error_code);
    assert.ok(
      headless.calls.length > 0 &&
        headless.calls.every(
          (c) =>
            c.url === `https://www.boat-ai.jp/race/${SAMPLE.race_id}?tab=sonar`,
        ),
    );
    assert.equal(
      (await first("SELECT state FROM sns_auto_send_items")).state,
      "sent",
    );
    const status = await upsetStatus(DAY, { store });
    assert.deepEqual(
      [status.upset_id, status.item_state, status.job_state, status.video_id],
      [UPSET_ID, "sent", "posted", "upsetvideo1"],
    );
    const again = await push(bundle(), { now: at("07:20:00") });
    assert.equal(again.already, true);
    assert.equal(resultLine(again).code, 4);
    // 送った後の読み直しは「同じ日に送った」で止める
    const draft = await first("SELECT id FROM sns_drafts");
    await assert.rejects(readCurrent(draft.id), /upset_already_sent_today/);
  });
}

function upw4Scene4() {
  test("二重送信: 同じ束を2回入れても2本目は作らない。送らずに終わった（held）job は作り直す（前の item を stopped（superseded）にする）", async () => {
    await push();
    const second = await push(bundle(), { now: at("07:04:00") });
    assert.equal(second.already, true);
    assert.equal((await counts()).jobs, 1);
    await db.exec(
      "UPDATE sns_x_send_jobs SET state='held', error_code='deadline_expired'",
    );
    const third = await push(bundle(), { now: at("07:05:00") });
    assert.ok(third.job_id, JSON.stringify(third));
    const items = await all(
      "SELECT state, stopped_via FROM sns_auto_send_items ORDER BY created_at",
    );
    assert.deepEqual(
      items.map((i) => [i.state, i.stopped_via]),
      [
        ["stopped", "superseded"],
        ["notified", null],
      ],
    );
  });
  test("送り手の読み直し（readCurrent）: 許可が off・item の kind が違えば投げる。通れば欠場・中止は false、版は下書きの値", async () => {
    await push();
    const draft = await first("SELECT id, source_data FROM sns_drafts");
    const cur = await readCurrent(draft.id);
    assert.deepEqual(cur, {
      withdrawn: false,
      cancelled: false,
      deadline_at: draft.source_data.deadline_queue.deadline_at,
      source_revision: draft.source_data.upset_win_short.revision,
    });
    // 1着の訂正・中止を読み直す
    upwState.dbRace.rank1 = 1;
    await assert.rejects(readCurrent(draft.id), /upset_result_changed/);
    upwState.dbRace.rank1 = SAMPLE.rank1;
    upwState.dbRace.cancelled = true;
    await assert.rejects(readCurrent(draft.id), /race_not_found/);
    upwState.dbRace.cancelled = false;
    await db.exec(
      "UPDATE sns_auto_send_control SET upset_win_short_enabled=false",
    );
    await assert.rejects(readCurrent(draft.id), /upset_win_short_disabled/);
    await db.exec(
      "UPDATE sns_auto_send_control SET upset_win_short_enabled=(channel='youtube')",
    );
    await db.exec(
      `ALTER TABLE sns_auto_send_items DROP CONSTRAINT sns_auto_send_items_upset_id; UPDATE sns_auto_send_items SET race_id='upset:${DAY}:2026-11-03-01-01'`,
    );
    await assert.rejects(readCurrent(draft.id), /upset_item_mismatch/);
    await db.exec(`DELETE FROM sns_x_send_jobs; DELETE FROM sns_auto_send_items;
    ALTER TABLE sns_auto_send_items ADD CONSTRAINT sns_auto_send_items_upset_id CHECK (
      kind <> 'upset_win_short' OR (race_id ~ '^upset:[0-9]{4}-[0-9]{2}-[0-9]{2}:[0-9]{4}-[0-9]{2}-[0-9]{2}-(0[1-9]|1[0-9]|2[0-4])-(0[1-9]|1[0-2])$' AND variant = 'main'))`);
  });
  test("YouTube の日の上限: ちょうど入る数は通し、1本多ければ受け取らない（節の機力と同じ数え方）", async () => {
    await db.exec(
      "UPDATE sns_x_send_control SET daily_limit_youtube=1, daily_external_count=0",
    );
    assert.ok((await push()).job_id);
    await db.exec(`DELETE FROM sns_x_send_jobs; DELETE FROM sns_auto_send_items;
    ALTER TABLE sns_drafts DISABLE TRIGGER USER; DELETE FROM sns_drafts; ALTER TABLE sns_drafts ENABLE TRIGGER USER;
    UPDATE sns_x_send_control SET daily_limit_youtube=1, daily_external_count=1`);
    assert.match((await push()).reasons.join(), /日の上限/);
  });
  test("動画の検査: 無い・横は受け取らない", async () => {
    assert.match((await push(bundle(), {}, null)).reasons.join(), /無い/);
    assert.match(
      (
        await push(bundle(), {}, mp4({ width: 1920, height: 1080 }))
      ).reasons.join(),
      /縦/,
    );
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（riskRules・SAMPLE・DAY・at・UPSET_ID・clone・bundle・raceOfSample・mp4・VIDEO） */
export function runUpsetWinScenes5(env) {
  ({ riskRules, SAMPLE, DAY, at, UPSET_ID, clone, bundle, raceOfSample, mp4, VIDEO } = env);
  upw4Scene1();
  upw4Scene2();
  upw4Scene3();
  upw4Scene4();
}
