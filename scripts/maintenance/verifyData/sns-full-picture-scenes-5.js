/**
 * verify-sns-full-picture.js の後半の場面（5/5）。verify ではない。
 * 判定と期待値は分ける前の verify-sns-full-picture.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { bakedDeadlineReasons } from "../../sns/push-full-picture.js";
import { itemsAndJobs, remade } from "./sns-full-picture-scenes-4.js";

let db, RACE, bundle, bundleV2, push;

function scene1() {
  test("BOA-1201: 締切の文は x_text・完全版・Shorts の題と説明文を全部見て、時の0埋めの違いは同じと扱う", () => {
    const at = (hm) => `2037-10-18T${hm}:00+09:00`;
    const all5 = bundleV2({
      x_text: `9/1 締切9:05\nhttps://www.boat-ai.jp/race/${RACE}`,
      youtube_full: { title: "締切09:05", description: "締切9:05" },
      youtube_shorts: { title: "締切9:05", description: "締切09:05 {full_url}" },
    });
    assert.deepEqual(bakedDeadlineReasons(all5, at("09:05")), []);
    assert.deepEqual(bakedDeadlineReasons(all5, at("09:06")), [
      "束の締切 09:05 が今の締切 09:06 と違う（作り直す。x_text・youtube_full.title・youtube_full.description・youtube_shorts.title・youtube_shorts.description）",
    ]);
    // 違う時刻が2つあれば、時刻ごとに理由を出す
    assert.deepEqual(
      bakedDeadlineReasons(
        bundleV2({
          youtube_shorts: {
            title: "締切20:30",
            description: "締切20:36 {full_url}",
          },
        }),
        at("20:44"),
      ),
      [
        "束の締切 20:30 が今の締切 20:44 と違う（作り直す。youtube_shorts.title）",
        "束の締切 20:36 が今の締切 20:44 と違う（作り直す。youtube_shorts.description）",
      ],
    );
    // 版1では youtube_shorts を、X を外した束では x_text を見ない（送らない文）
    assert.deepEqual(
      bakedDeadlineReasons(
        bundle({
          youtube_shorts: { title: "締切20:30", description: "締切20:30" },
        }),
        at("20:44"),
      ),
      [],
    );
    assert.deepEqual(
      bakedDeadlineReasons(
        bundleV2({ channels: ["youtube", "shorts"], x_text: "締切20:30" }),
        at("20:44"),
      ),
      [],
    );
    // 締切の文が無い束は見ない
    assert.deepEqual(bakedDeadlineReasons(bundleV2(), at("20:44")), []);
  });
  test("BOA-1201: 試行1以上でも held・failed の job（外へ出ていない）は差し替えを止めない。hold は queued の job だけにかける", async () => {
    await push(bundleV2());
    const old = await itemsAndJobs();
    await db.query("UPDATE races SET start_time='20:44:00'");
    const jobOf = (channel, variant) =>
      old.find((r) => r.channel === channel && r.variant === variant).job_id;
    // 締切が延びて、送る直前の検査の deadline_changed で held になった X（claim 済みで試行1）と、POST の前に落ちた完全版
    await db.query(
      "UPDATE sns_x_send_jobs SET state='held', attempts=1, error_code='deadline_changed' WHERE id=$1",
      [jobOf("x", "main")],
    );
    await db.query(
      "UPDATE sns_x_send_jobs SET state='failed', attempts=1, error_code='pre_post_failed' WHERE id=$1",
      [jobOf("youtube", "main")],
    );
    const result = await push(remade());
    assert.equal(result.reasons, undefined);
    assert.equal(result.replacing.held_jobs, 1);
    const rows = await itemsAndJobs();
    assert.deepEqual(
      rows
        .filter((r) => old.some((o) => o.id === r.id))
        .map((r) => [r.channel, r.variant, r.state, r.job_state, r.error_code]),
      [
        ["x", "main", "stopped", "held", "deadline_changed"],
        ["youtube", "main", "stopped", "failed", "pre_post_failed"],
        ["youtube", "shorts", "stopped", "held", "superseded"],
      ],
    );
    assert.equal(rows.filter((r) => r.state === "notified").length, 3);
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（db・RACE・bundle・bundleV2・push） */
export function runSnsFullPictureScenes5(env) {
  ({ db, RACE, bundle, bundleV2, push } = env);
  scene1();
}
