/**
 * verify-today-type-b.js の後半の場面。verify ではない。
 * 判定と期待値は分ける前の verify-today-type-b.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCourseWinSheet } from "../../../src/utils/todayCourseWin.js";
import { buildCourseWinPost, checkCourseWinPost } from "../../lib/snsTodayCourseWinPost.js";
import {
  normalizeTodayExperiment,
  pickExperimentSide,
  pickTodayPost,
  loadTodayVariants,
  normalizeTodayVariants,
} from "../../lib/snsTodayVariants.js";
import { typeAOf } from "../../lib/snsTodayPlanner.js";

let notesOf, NOTES, URL_B, dayOf;

const AB = {
  default: "本日のデータ一覧（{date}）",
  experiment: {
    id: "today-v2-course-win",
    start: "2026-10-29",
    pairs: 10,
    seed: "today-v2-course-win-20261027",
  },
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
      type_id: "today-b-course-win",
      body: "course_win",
      heading: "【今日の注目データ】{date}",
    },
  ],
};

/** verify から呼ぶ入口。env は verify 側の束縛（notesOf・NOTES・URL_B） */
export function runTodayTypeBScenes1(env) {
  ({ notesOf, NOTES, URL_B } = env);

}

function scene1() {
  test("比べの組: 連続2日を1組にし、組の中でちょうど1日が b。日付と設定だけで決まる。比べの外は a", () => {
    const exp = normalizeTodayExperiment(AB.experiment);
    const sides = Array.from({ length: 20 }, (_, i) =>
      pickExperimentSide(exp, dayOf("2026-10-29", i)),
    );
    for (let pair = 0; pair < 10; pair += 1) {
      const two = sides.slice(pair * 2, pair * 2 + 2);
      assert.deepEqual(
        two.map((s) => s.pair),
        [pair, pair],
      );
      assert.deepEqual(
        two.map((s) => s.slot),
        [0, 1],
      );
      assert.deepEqual(two.map((s) => s.side).sort(), ["a", "b"]);
    }
    // 組の1日目が b の組と2日目が b の組の両方がある（乱数が片寄っていない）
    assert.ok(
      new Set(sides.filter((s) => s.side === "b").map((s) => s.slot)).size === 2,
    );
    // 同じ日付・同じ設定なら同じ
    assert.deepEqual(pickExperimentSide(exp, "2026-10-30"), sides[1]);
    for (const date of ["2026-10-28", dayOf("2026-10-29", 20)])
      assert.deepEqual(pickExperimentSide(exp, date), {
        side: "a",
        pair: null,
        slot: null,
      });
    assert.deepEqual(
      pickExperimentSide(normalizeTodayExperiment({ start: null }), "2026-10-30")
        .side,
      "a",
    );
    // 壊れた値は既定（10組）・開始なし
    assert.deepEqual(normalizeTodayExperiment({ start: "10/29", pairs: -1 }), {
      id: "today-ab",
      mode: "pairs",
      start: null,
      pairs: 10,
      seed: "today-ab",
    });
    assert.equal(normalizeTodayExperiment(undefined), null);
  });
  test("その日の型: 組の b の日は body=course_win と組の札。組の日は型の列（hq の PD02）を使わない", () => {
    const exp = normalizeTodayExperiment(AB.experiment);
    const bDay = Array.from({ length: 2 }, (_, i) => dayOf("2026-10-29", i)).find(
      (d) => pickExperimentSide(exp, d).side === "b",
    );
    const b = pickTodayPost(AB, bDay);
    assert.equal(b.body, "course_win");
    assert.equal(b.content_type.id, "today-b-course-win");
    assert.equal(b.content_type.side, "b");
    assert.equal(b.content_type.experiment, "today-v2-course-win");
    assert.equal(b.content_type.pair, 0);
    assert.equal(b.content_type.mode, "pairs");
    const row = {
      day: bDay,
      type_id: "t03-x",
      post: { heading: "別の型（{date}）" },
    };
    const withRow = pickTodayPost(AB, bDay, { row });
    assert.equal(withRow.body, "course_win");
    assert.equal(withRow.content_type.fallback_reason, "experiment_pair");
    // 比べの外の日は今までどおり型の列を使う
    const outside = "2026-10-20";
    const rowOut = {
      day: outside,
      type_id: "t03-x",
      post: { heading: "別の型（{date}）" },
    };
    assert.equal(
      pickTodayPost(AB, outside, { row: rowOut }).content_type.id,
      "t03-x",
    );
    assert.equal(pickTodayPost(AB, outside).body, null);
    // body が知らない値の案は使わない（既定の文に戻る）
    const broken = {
      ...AB,
      variants: [AB.variants[0], { ...AB.variants[1], body: "nope" }],
    };
    assert.equal(pickTodayPost(broken, bDay).variant.id, "default");
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（notesOf・NOTES・URL_B・dayOf） */
export function runTodayTypeBScenes2(env) {
  ({ notesOf, NOTES, URL_B, dayOf } = env);
  scene1();
}

function scene2() {
  test("b を出せない日の型 a は config の a（壊れていれば既定の文）", () => {
    assert.deepEqual(typeAOf(AB), {
      type_id: "today-a",
      heading: "本日のデータ一覧（{date}）",
      link_lead: null,
      link_position: "after_heading",
      variant: { id: "a", uuid: null },
    });
    assert.equal(typeAOf(null).variant.id, "default");
  });
  test("リポジトリの config: b は型 b（course_win）、2026-10-29 から all_b（10/28 の本番で notes.courseWin.status='ok' と撮影用のページを確かめた）", () => {
    const config = loadTodayVariants();
    const n = normalizeTodayVariants(config);
    assert.deepEqual(
      n.variants.map((v) => [v.id, v.type_id, v.body]),
      [
        ["a", "today-a", null],
        ["b", "today-b-course-win", "course_win"],
      ],
    );
    assert.equal(n.variants[1].uuid, null);
    assert.equal(n.experiment.mode, "all_b");
    assert.equal(n.experiment.start, "2026-10-29");
    assert.notEqual(config.reply_enabled, true);
    // 日ごとの割り当ては下の all_b のテストで固定する
  });
  test("言い切りの判定は正確な二項の上側確率（正規近似は B 級で甘い）。合計1行の日は型 b を作らない", async () => {
    const { binomialUpperTail, bonferroniAlpha } =
      await import("../../../src/utils/todayCourseWin.js");
    // P(X >= 2 | 2, 0.5) = 0.25、P(X >= 1 | 3, 0.5) = 0.875、wins が 0 なら 1、runs を超えれば 0
    assert.ok(Math.abs(binomialUpperTail(2, 2, 0.5) - 0.25) < 1e-12);
    assert.ok(Math.abs(binomialUpperTail(1, 3, 0.5) - 0.875) < 1e-12);
    assert.equal(binomialUpperTail(0, 10, 0.4), 1);
    assert.equal(binomialUpperTail(11, 10, 0.4), 0);
    assert.throws(() => binomialUpperTail(1, 2, 1), /p0/);
    assert.equal(bonferroniAlpha(100), 0.00025);
    const one = notesOf([NOTES.candidates[0]]);
    assert.deepEqual(buildCourseWinSheet(one, { sendAt: "08:00" }), {
      ok: false,
      reason: "one_row",
    });
    const two = notesOf([NOTES.candidates[0], NOTES.candidates[5]]);
    assert.equal(buildCourseWinSheet(two, { sendAt: "08:00" }).ok, true);
  });
  test("機械の検査: 選手名・会場名に「高」「一番」等が入っても誤って落とさない（定型の文だけを見る）", () => {
    const base = {
      ...buildCourseWinSheet(NOTES, { sendAt: "08:00" }),
      claim: false,
    };
    const f = { ...base.featured, racer_name: "高橋 一番" };
    const sheet = {
      ...base,
      featured: f,
      sections: [{ ...base.sections[0], rows: [f] }],
    };
    const venue = () => "高松";
    const text = buildCourseWinPost(sheet, { venueName: venue, url: URL_B });
    assert.deepEqual(
      checkCourseWinPost(text, sheet, {
        imageKey: sheet.key,
        url: URL_B,
        venueName: venue,
      }),
      [],
    );
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（notesOf・NOTES・URL_B・dayOf） */
export function runTodayTypeBScenes3(env) {
  ({ notesOf, NOTES, URL_B, dayOf } = env);
  scene2();
}
