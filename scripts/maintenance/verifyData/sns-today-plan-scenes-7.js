/**
 * verify-sns-today-plan.js の後半の場面（7/7）。verify ではない。
 * 判定と期待値は分ける前の verify-sns-today-plan.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { v3RaceDb, DATE } from "./sns-today-plan-v3-race-db.js";
import { loadTodayVariants } from "../../lib/snsTodayVariants.js";
import { digestOf } from "./sns-today-plan-scenes-1.js";

let LEGACY_VARIANTS, first, all, at, sqlStore, plan, putType, withAuto;

function scene1() {
  test("型 v3: mode=auto なら自動送信の承認者で 7:00 の job（本文だけ）を作る", async () => {
    await withAuto(async () => {
      const notes = [];
      const result = await plan({
        notes,
        raceDb: v3RaceDb(),
        loadVariants: loadTodayVariants,
      });
      assert.equal(result.report.items[0].outcome, "notified");
      const job = await first("SELECT * FROM sns_x_send_jobs");
      assert.equal(job.state, "queued");
      assert.equal(job.scheduled_at.toISOString(), at("07:00").toISOString());
      assert.equal(job.snapshot.media.length, 0);
      assert.ok(notes.some((n) => /07:00 に自動で送る/.test(n)));
    });
  });
  test("型 v3: 型の列の行があっても読まずに v3。下書きができた後に config から current を外しても、その日の作り直しは v3 のまま（/code-review の指摘）", async () => {
    await putType(DATE, "t03-conclusion-heading", {
      heading: "別の型（{date}）",
    });
    const typeSchedule = sqlStore.typeSchedule;
    let reads = 0;
    sqlStore.typeSchedule = async (date) => {
      reads += 1;
      return typeSchedule(date);
    };
    try {
      await plan({ raceDb: v3RaceDb(), loadVariants: loadTodayVariants });
      assert.equal(reads, 0);
      const [draft] = await all("SELECT * FROM sns_drafts");
      assert.equal(draft.source_data.content_type.body, "digest_v3");
      // 一覧の版が変わって作り直す日に、config は current の無い物（a・b）になっている
      const rebuilt = await plan({
        now: at("06:50"),
        digest: digestOf(24),
        raceDb: v3RaceDb(),
        loadVariants: () => LEGACY_VARIANTS,
      });
      assert.equal(rebuilt.report.items[0].outcome, "rebuilt");
      const [after] = await all("SELECT * FROM sns_drafts");
      assert.equal(after.source_data.content_type.sent, "c");
      assert.match(after.caption_text, /^10月17日（土）今日のボートレース 2場/);
      assert.equal(after.cover_image_path, null);
    } finally {
      sqlStore.typeSchedule = typeSchedule;
    }
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（LEGACY_VARIANTS・first・all・at・sqlStore・plan・putType・withAuto） */
export function runSnsTodayPlanScenes17(env) {
  ({ LEGACY_VARIANTS, first, all, at, sqlStore, plan, putType, withAuto } = env);
  scene1();
}
