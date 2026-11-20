/**
 * verify-sns-setsu-kiryoku-x.js の後半の場面（1/2）。verify ではない。
 * 判定と期待値は分ける前の verify-sns-setsu-kiryoku-x.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkResearchBundle,
  SETSU_TYPE,
  pushResearchImage,
  dryRunClock,
  researchStatus,
} from "../../sns/push-research-image.js";
import { setsuRacerReasons } from "../../../api/_lib/snsResearchImage.js";
import { createDeadlinePreflight } from "../../../api/_lib/snsDeadlineQueue.js";
import { SCREEN_MARKERS } from "../../lib/snsScreenMarkers.js";

let db, first, riskRules, DAY, SLUG, ID, at, PUSHED_AT, CAPTION, RACERS, researchBundle, bundle, setClock, store, researchStore, IMAGE, readerOf, push, transition, counts, NOTHING, setsuLine, readCurrent;

function scene1() {
  test("検査: hq の見本の束は通る。選手の名前と級（racers を読む。本文からは拾わない）・形・送る時刻 21:30 だけ・集計の as_of", async () => {
    assert.deepEqual(checkResearchBundle(bundle(), riskRules, SETSU_TYPE), []);
    const reasons = (patch) =>
      checkResearchBundle(bundle(patch), riskRules, SETSU_TYPE).join(" / ");
    assert.match(reasons({ racers: [] }), /racers/);
    assert.match(reasons({ racers: undefined }), /racers/);
    assert.match(
      reasons({ racers: [{ name: "田中 イ" }, ...RACERS.slice(1)] }),
      /racers\[0\]（田中 イ）の級/,
    );
    assert.match(
      reasons({ racers: [{ name: "田中 イ", class: "A3" }] }),
      /の級が A1・A2・B1・B2 でない/,
    );
    assert.match(
      reasons({ racers: [{ name: " ", class: "A1" }] }),
      /racers\[0\] に名前が無い/,
    );
    // 級が画像にだけ出て本文に出ない選手がいても通る（本文から拾わない）
    assert.deepEqual(
      setsuRacerReasons([...RACERS, { name: "本文にいない 選手", class: "B2" }]),
      [],
    );
    assert.match(
      reasons({ format: "research_image" }),
      /format が setsu_kiryoku_image/,
    );
    assert.match(reasons({ kind: "research_image" }), /kind が setsu_kiryoku/);
    assert.match(reasons({ send_time: "21:00" }), /send_time が 21:30 でない/);
    assert.match(reasons({ send_time: "19:00" }), /send_time が 21:30 でない/);
    assert.match(
      reasons({ source_observed_at: "2037-11-02 12R まで" }),
      /as_of）の日 2037-11-02 が date/,
    );
    assert.match(reasons({ source_observed_at: "21時" }), /source_observed_at/);
    assert.match(
      reasons({ source_observed_at: "2037-11-03T21:00:00" }),
      /source_observed_at/,
    );
    assert.deepEqual(
      checkResearchBundle(
        bundle({ source_observed_at: "2037-11-03T21:00:00+09:00" }),
        riskRules,
        SETSU_TYPE,
      ),
      [],
    );
    // review は有れば P0 が0件であること（hq は出さない）
    assert.match(reasons({ review: { p0_count: 1 } }), /P0/);
    assert.deepEqual(
      checkResearchBundle(
        bundle({ review: { p0_count: 0, by: "machine" } }),
        riskRules,
        SETSU_TYPE,
      ),
      [],
    );
    assert.match(reasons({ images: ["other.png"] }), /images/);
    assert.match(reasons({ slug: "V15" }), /slug/);
    // 193 の Shorts の setsu:{日}:{会場2桁} と同じ race_id にならないよう、slug は英小文字で始める
    assert.match(reasons({ slug: "15", images: ["15.png"] }), /slug/);
  });
  test("検査: 禁止表現（本文の「競艇」・risk-rules）・#競艇 のタグは可・本文＋改行2つ＋タグで加重280・リンクなし・本文のハッシュタグ", async () => {
    const reasons = (patch) =>
      checkResearchBundle(bundle(patch), riskRules, SETSU_TYPE).join(" / ");
    for (const word of ["必ず当たる", "稼げる", "万舟券", "儲かる"])
      assert.match(reasons({ x_text: `${CAPTION}\n${word}` }), /禁止表現/);
    assert.match(reasons({ x_text: `${CAPTION}\n競 艇` }), /禁止表現: .*競艇/);
    assert.deepEqual(
      checkResearchBundle(
        bundle({ hashtags: ["#ボートレース", "#競艇"] }),
        riskRules,
        SETSU_TYPE,
      ),
      [],
    );
    assert.match(reasons({ hashtags: ["#競艇場"] }), /禁止表現/);
    assert.match(
      reasons({ x_text: `${CAPTION}\nboatrace.example.jp` }),
      /リンク/,
    );
    assert.match(reasons({ x_text: `${CAPTION} #ボートレース` }), /ハッシュタグ/);
    // 全角は2。本文＋"\n\n"（2）＋"#ボートレース"（1＋12）＝本文の重み＋15 が280まで
    const fit = "あ".repeat((280 - 15) >> 1);
    assert.deepEqual(
      checkResearchBundle(bundle({ x_text: fit }), riskRules, SETSU_TYPE),
      [],
    );
    assert.match(reasons({ x_text: `${fit}あ` }), /加重280/);
  });
}

function scene2() {
  test("許可が off なら検査が通っても何も書かない（disabled・exit 3）。--dry-run も書かない。今日でない束の --dry-run は送る時刻の2分前の時計で通す", async () => {
    await db.exec("UPDATE sns_auto_send_control SET setsu_kiryoku_enabled=false");
    const off = await push();
    assert.equal(off.disabled, true);
    assert.deepEqual(await counts(), NOTHING);
    assert.deepEqual(off.notes, []);
    assert.equal(setsuLine(off).code, 3);
    assert.match(
      setsuLine(off).text,
      /^SETSU_RESULT .*"setsu_id":"setsu:2037-11-03:v15-final".*"outcome":"disabled"/,
    );
    await db.exec(
      "UPDATE sns_auto_send_control SET setsu_kiryoku_enabled=(channel='x')",
    );
    const dry = await push(bundle(), { dryRun: true });
    assert.equal(dry.dryRun, true);
    assert.equal(dry.simulated_now, undefined);
    assert.deepEqual(await counts(), NOTHING);
    assert.equal(setsuLine(dry).code, 0);
    // hq の見本（前日に作った明日の束）: 今日でなくても --dry-run は 21:28 の時計で検査を通す（日の上限は見ない）
    const ahead = await push(bundle(), {
      dryRun: true,
      now: at("15:00:00", "2037-11-02"),
    });
    assert.equal(ahead.dryRun, true);
    assert.equal(ahead.simulated_now, at("21:28:00").toISOString());
    assert.equal(ahead.limit_checked, false);
    assert.deepEqual(await counts(), NOTHING);
    assert.match(
      setsuLine(ahead).text,
      /"simulated_now":"2037-11-03T12:28:00.000Z"/,
    );
    // 数字で見たら（research_image）の --dry-run は今までどおり今日の束だけ
    const researchAhead = await pushResearchImage("/r", {
      store: researchStore,
      readBytes: readerOf({
        "/r/bundle.json": new TextEncoder().encode(
          JSON.stringify(researchBundle()),
        ),
        "/r/not-wakunari.png": IMAGE,
      }),
      riskRules,
      dryRun: true,
      now: at("15:00:00", "2037-11-02"),
    });
    assert.match(researchAhead.reasons.join(), /今日/);
    // 書く道（--dry-run でない）では今日でない束を拒む
    const notToday = await push(bundle(), { now: at("15:00:00", "2037-11-02") });
    assert.match(notToday.reasons.join(), /今日/);
    assert.equal(dryRunClock(bundle(), PUSHED_AT), null);
  });
  test("許可が on・mode=auto: 画像1枚の job を 21:30 の予定に入れる（締切 23:30・期限 22:30）。claim は 21:30 前は不可、21:30 に送れる、22:30 で deadline_expired", async () => {
    const result = await push();
    assert.equal(result.setsu_id, ID);
    assert.ok(result.job_id, JSON.stringify(result));
    assert.equal(result.send_at, at("21:30:00").toISOString());
    assert.equal(result.when.expires_at, at("22:30:00").toISOString());
    assert.match(result.notes.at(-1), /節の機力 setsu:2037-11-03:v15-final/);
    assert.match(result.notes.at(-1), /setsu_kiryoku_enabled = false/);
    assert.equal(setsuLine(result).code, 0);
    const draft = await first("SELECT * FROM sns_drafts");
    assert.equal(draft.format, "setsu_kiryoku");
    assert.equal(
      draft.cover_image_path.startsWith(`setsu-kiryoku/${DAY}/${SLUG}/`),
      true,
    );
    assert.deepEqual(draft.source_data.setsu_kiryoku.racers, RACERS);
    assert.equal(draft.source_data.setsu_kiryoku.as_of, `${DAY} 11R まで`);
    // as_of は時刻を持たないので、その日の 00:00 JST を集計の時刻にする（受け取りの時刻にしない。作り直しで新しく見えないように）
    assert.equal(
      draft.source_data.deadline_queue.source_observed_at,
      at("00:00:00").toISOString(),
    );
    const item = await first("SELECT * FROM sns_auto_send_items");
    assert.deepEqual(
      [item.kind, item.variant, item.race_id, item.state],
      ["setsu_kiryoku", "main", ID, "notified"],
    );
    await setClock(at("21:29:00"));
    await assert.rejects(
      transition(result.job_id, "claim"),
      /claimできません|veto_window_open/,
    );
    await setClock(at("21:30:00"));
    assert.equal((await transition(result.job_id, "claim")).state, "sending");
    // 同じ日の2本目は受け取らない（exit 4）
    const again = await push(
      bundle({ slug: "v04-motor-gap", images: ["v04-motor-gap.png"] }),
      { now: at("21:10:00") },
    );
    assert.equal(again.already, true);
    assert.equal(setsuLine(again).code, 4);
  });
}

function scene3() {
  test("期限と許可: 22:30 で deadline_expired。承認の後に off にすると claim で held（setsu_kiryoku_disabled）", async () => {
    const late = await push();
    await setClock(at("22:30:00"));
    assert.equal(
      (await transition(late.job_id, "claim")).error_code,
      "deadline_expired",
    );
    await db.exec(
      "DELETE FROM sns_x_send_jobs; DELETE FROM sns_auto_send_items;",
    );
    await db.exec(
      "ALTER TABLE sns_drafts DISABLE TRIGGER USER; DELETE FROM sns_drafts; ALTER TABLE sns_drafts ENABLE TRIGGER USER;",
    );
    await setClock(PUSHED_AT);
    const result = await push();
    await db.exec("UPDATE sns_auto_send_control SET setsu_kiryoku_enabled=false");
    await setClock(at("21:31:00"));
    const held = await transition(result.job_id, "claim");
    assert.deepEqual(
      [held.state, held.error_code],
      ["held", "setsu_kiryoku_disabled"],
    );
    const status = await researchStatus(DAY, {
      store,
      now: at("21:32:00"),
      type: SETSU_TYPE,
    });
    assert.deepEqual(
      [status.setsu_id, status.job_state, status.error_code],
      [ID, "held", "setsu_kiryoku_disabled"],
    );
  });
  test("鮮度は24時間（research_image と同じ）: 集計から4時間を越えても止まらない。他の kind の4時間は変わらない（数字で見たらも今までどおり）", async () => {
    const result = await push(
      bundle({ source_observed_at: at("17:00:00").toISOString() }),
    );
    await setClock(at("21:30:00"));
    assert.equal((await transition(result.job_id, "claim")).state, "sending");
    // 数字で見たら（research_image）も 194 の後に今までどおり 19:00 に送れる
    const research = await pushResearchImage("/r", {
      store: researchStore,
      readBytes: readerOf({
        "/r/bundle.json": new TextEncoder().encode(
          JSON.stringify(researchBundle()),
        ),
        "/r/not-wakunari.png": IMAGE,
      }),
      riskRules,
      now: at("15:00:00"),
    });
    assert.ok(research.job_id, JSON.stringify(research));
    await setClock(at("19:00:00"));
    assert.equal((await transition(research.job_id, "claim")).state, "sending");
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（db・first・riskRules・DAY・SLUG・ID・at・PUSHED_AT・CAPTION・RACERS・researchBundle・bundle・setClock・store・researchStore・IMAGE・readerOf・push・transition・counts・NOTHING・setsuLine・readCurrent） */
export function runSnsSetsuKiryokuXScenes1(env) {
  ({ db, first, riskRules, DAY, SLUG, ID, at, PUSHED_AT, CAPTION, RACERS, researchBundle, bundle, setClock, store, researchStore, IMAGE, readerOf, push, transition, counts, NOTHING, setsuLine, readCurrent } = env);
  scene1();
  scene2();
  scene3();
}

function scene4() {
  test("送り手の読み直し（readCurrent）と送る直前の検査: 許可・同じ日に送った setsu_kiryoku・item の kind・本文・画像の数・選手の名前と級。public_check は none でリンクを見る", async () => {
    const result = await push();
    const current = await readCurrent(result.draft_id);
    assert.equal(current.public_check, "none");
    assert.equal(current.withdrawn, false);
    const draft = await first("SELECT * FROM sns_drafts");
    assert.equal(
      current.source_revision,
      draft.source_data.setsu_kiryoku.revision,
    );
    await db.exec("UPDATE sns_auto_send_control SET setsu_kiryoku_enabled=false");
    await assert.rejects(readCurrent(result.draft_id), /setsu_kiryoku_disabled/);
    await db.exec(
      "UPDATE sns_auto_send_control SET setsu_kiryoku_enabled=(channel='x')",
    );
    await db.query(
      "UPDATE sns_drafts SET source_data=jsonb_set(source_data,'{setsu_kiryoku,racers}','[{\"name\":\"田中 イ\"}]') WHERE id=$1",
      [result.draft_id],
    );
    await assert.rejects(readCurrent(result.draft_id), /setsu_x_racers_invalid/);
    await db.query("UPDATE sns_drafts SET source_data=$2 WHERE id=$1", [
      result.draft_id,
      draft.source_data,
    ]);
    await db.query(
      "UPDATE sns_auto_send_items SET state='sent' WHERE draft_id=$1",
      [result.draft_id],
    );
    await assert.rejects(
      readCurrent(result.draft_id),
      /setsu_x_already_sent_today/,
    );
    await db.query(
      "UPDATE sns_auto_send_items SET state='notified' WHERE draft_id=$1",
      [result.draft_id],
    );
    await db.query("UPDATE sns_drafts SET caption_text=$2 WHERE id=$1", [
      result.draft_id,
      `${CAPTION}\n万舟券`,
    ]);
    await assert.rejects(readCurrent(result.draft_id), /setsu_x_text_rejected/);
    await db.query("UPDATE sns_drafts SET caption_text=$2 WHERE id=$1", [
      result.draft_id,
      CAPTION,
    ]);
    // 送る直前の検査: リンク先の表示を開かない（headless なし）。送る文にリンクがあれば止める
    const job = await first("SELECT * FROM sns_x_send_jobs");
    const preflight = createDeadlinePreflight({
      headless: null,
      markers: SCREEN_MARKERS,
      readCurrent,
      now: () => at("21:31:00").getTime(),
    });
    await preflight(job);
    const linked = {
      ...job,
      snapshot_text: JSON.stringify({
        ...JSON.parse(job.snapshot_text),
        text: `${CAPTION} https://www.boat-ai.jp/today`,
      }),
    };
    await assert.rejects(preflight(linked), /link_not_allowed/);
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（db・first・riskRules・DAY・SLUG・ID・at・PUSHED_AT・CAPTION・RACERS・researchBundle・bundle・setClock・store・researchStore・IMAGE・readerOf・push・transition・counts・NOTHING・setsuLine・readCurrent） */
export function runSnsSetsuKiryokuXScenes2(env) {
  ({ db, first, riskRules, DAY, SLUG, ID, at, PUSHED_AT, CAPTION, RACERS, researchBundle, bundle, setClock, store, researchStore, IMAGE, readerOf, push, transition, counts, NOTHING, setsuLine, readCurrent } = env);
  scene4();
}
