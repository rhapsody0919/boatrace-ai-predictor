/**
 * verify-sns-today-plan.js の後半の場面（6/7）。verify ではない。
 * 判定と期待値は分ける前の verify-sns-today-plan.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { DATE, v3RaceDb } from "./sns-today-plan-v3-race-db.js";
import { buildCourseWinNotes } from "../../../src/utils/todayCourseWin.js";
import {
  pickExperimentSide,
  normalizeTodayExperiment,
  loadTodayVariants,
} from "../../lib/snsTodayVariants.js";
import { withCourseWin, sheetShooter, clearDrafts, courseWinOf, CW_BASE } from "./sns-today-plan-scenes-5.js";
import { raceDbOf } from "./sns-today-plan-scenes-1.js";

let db, first, all, at, plan, abVariants;

function scene1() {
  test("型 b: 撮影用のページが撮れないときは 7:30 までやり直し（何も書かない）、過ぎたら型 a で送る", async () => {
    await assert.rejects(
      plan({
        now: at("07:00"),
        digest: withCourseWin(),
        headless: sheetShooter({ sheetFails: true }),
        loadVariants: abVariants,
      }),
      /course_win_sheet_not_ready/,
    );
    assert.equal((await all("SELECT * FROM sns_drafts")).length, 0);
    const headless = sheetShooter({ sheetFails: true });
    await plan({
      now: at("07:35"),
      digest: withCourseWin(),
      headless,
      loadVariants: abVariants,
    });
    const draft = await first("SELECT * FROM sns_drafts");
    assert.equal(draft.source_data.content_type.sent, "a");
    assert.match(
      draft.source_data.content_type.fallback_reason,
      /^course_win:sheet_capture_failed: screenshot_component_missing/,
    );
    assert.ok(headless.calls.some((c) => c.url.includes("tab=sonar")));
  });
  test("型 b: 作り直し（一覧の版が変わった）でも、その日の型（b）を変えない", async () => {
    await plan({
      digest: withCourseWin(),
      headless: sheetShooter(),
      loadVariants: abVariants,
    });
    const d = withCourseWin();
    const again = await plan({
      now: at("06:55"),
      digest: { ...d, day: { ...d.day, generated_at: `${DATE}T06:30:00Z` } },
      headless: sheetShooter(),
      // 設定が a だけになっても、作った下書きの型を引き継ぐ
      loadVariants: () => ({ ...abVariants(), experiment: { start: null } }),
    });
    assert.equal(again.report.items[0].outcome, "rebuilt");
    const draft = await first("SELECT * FROM sns_drafts");
    assert.equal(draft.source_data.content_type.sent, "b");
    assert.match(draft.caption_text, /^47回中42回。/);
  });
  test("リポジトリの config: 比べの開始日が入るまでは型 b を選ばない（全部 a）", async () => {
    await plan({ digest: withCourseWin(), headless: sheetShooter() });
    const draft = await first("SELECT * FROM sns_drafts");
    assert.equal(draft.source_data.content_type.sent, "a");
    assert.equal(
      draft.source_data.content_type.fallback_reason,
      "no_schedule_row",
    );
  });
  test("型 b: 比べの a の日にも、その日に b を出せたか（b_feasible）を残す。比べの外の日は残さない", async () => {
    const v = abVariants();
    // DATE が組の a の日になる開始日を選ぶ
    const aConfig = ["2037-10-16", DATE, "2037-10-15", "2037-10-14"]
      .map((start) => ({ ...v, experiment: { ...v.experiment, start } }))
      .find((c) => {
        const s = pickExperimentSide(
          normalizeTodayExperiment(c.experiment),
          DATE,
        );
        return s.side === "a" && s.pair !== null;
      });
    assert.ok(aConfig);
    await plan({
      digest: withCourseWin(),
      headless: sheetShooter(),
      loadVariants: () => aConfig,
    });
    let draft = await first("SELECT * FROM sns_drafts");
    assert.equal(draft.source_data.content_type.sent, "a");
    assert.equal(draft.source_data.content_type.b_feasible, true);
    await clearDrafts();
    await plan({
      digest: withCourseWin({
        v: 1,
        status: "unavailable",
        reason: "rpc_missing",
      }),
      headless: sheetShooter(),
      loadVariants: () => aConfig,
    });
    draft = await first("SELECT * FROM sns_drafts");
    assert.equal(draft.source_data.content_type.b_feasible, false);
    assert.equal(draft.source_data.content_type.b_reason, "rpc_missing");
    await clearDrafts();
    await plan({ digest: withCourseWin(), headless: sheetShooter() });
    draft = await first("SELECT * FROM sns_drafts");
    assert.equal(draft.source_data.content_type.b_feasible, undefined);
  });
}

function scene2() {
  test("型 b: ページの指紋が計画と違う（別の行・窓で作られた）ときは撮らない。7:30 まではやり直し、過ぎたら型 a", async () => {
    await assert.rejects(
      plan({
        now: at("07:00"),
        digest: withCourseWin(),
        headless: sheetShooter({ pageKey: "deadbeef" }),
        loadVariants: abVariants,
      }),
      /course_win_sheet_not_ready/,
    );
    assert.equal((await all("SELECT * FROM sns_drafts")).length, 0);
    await plan({
      now: at("07:35"),
      digest: withCourseWin(),
      headless: sheetShooter({ pageKey: "deadbeef" }),
      loadVariants: abVariants,
    });
    const draft = await first("SELECT * FROM sns_drafts");
    assert.equal(draft.source_data.content_type.sent, "a");
    assert.match(
      draft.source_data.content_type.fallback_reason,
      /^course_win:sheet_capture_failed/,
    );
  });
  test("型 b: 締切の無い候補が混ざっても落ちない（その行は載せない）", async () => {
    const cw = courseWinOf();
    const broken = {
      ...cw,
      candidates: [
        ...cw.candidates,
        { ...cw.candidates[0], race_id: `${DATE}-03-01`, start_time: null },
      ],
    };
    await plan({
      digest: withCourseWin(broken),
      headless: sheetShooter(),
      loadVariants: abVariants,
    });
    const draft = await first("SELECT * FROM sns_drafts");
    assert.equal(draft.source_data.content_type.sent, "b");
    assert.deepEqual(draft.source_data.course_win.k, { c1: 3, c4: 1 });
  });
  test("型 b: 作り直しで b を作れなくなった（一覧が変わり材料が無い）日は、黙らずに型 a へ倒し、理由を残して知らせる", async () => {
    await plan({
      digest: withCourseWin(),
      headless: sheetShooter(),
      loadVariants: abVariants,
    });
    const d = withCourseWin({
      v: 1,
      status: "unavailable",
      reason: "rpc_error",
    });
    const notes = [];
    const again = await plan({
      now: at("06:55"),
      digest: { ...d, day: { ...d.day, generated_at: `${DATE}T06:30:00Z` } },
      headless: sheetShooter(),
      notes,
      loadVariants: abVariants,
    });
    assert.equal(again.report.items[0].outcome, "rebuilt");
    const draft = await first("SELECT * FROM sns_drafts");
    const ct = draft.source_data.content_type;
    assert.equal(ct.side, "b");
    assert.equal(ct.sent, "a");
    assert.equal(ct.fallback_reason, "course_win:rpc_error");
    // b を割り当てた日に a へ倒れた日には、a の日用の b_feasible を付けない
    assert.equal(ct.b_feasible, undefined);
    assert.equal(draft.source_data.course_win, undefined);
    assert.match(draft.caption_text, /^本日のデータ一覧（/);
    assert.match(notes[0], /型 b の日だったが型 a で送る: rpc_error/);
  });
}

function scene3() {
  test("型 b: 候補が100レースを超える日も、欠場・中止を100レースずつに分けて読み、後ろのレースの欠場も外す（Codex の審査 P1）", async () => {
    const n = 150;
    const races = Array.from({ length: n }, (_, i) => ({
      race_id: `${DATE}-${String(1 + (i % 24)).padStart(2, "0")}-${String(100 + i)}`,
      venue_code: 1 + (i % 24),
      race_number: 1 + (i % 12),
      start_time: "18:00:00",
    }));
    const w = { window_start: "2025-12-02", window_end: "2037-10-15" };
    const notes = buildCourseWinNotes({
      races,
      entries: races.map((r, i) => ({
        race_id: r.race_id,
        boat_number: 1,
        racer_id: 5000 + i,
        grade: "A1",
        player_name: `選手 ${i}`,
      })),
      rpcRows: [
        ...CW_BASE.map(([grade, course, runs, wins]) => ({
          scope: "grade",
          grade,
          course,
          runs,
          wins,
          ...w,
        })),
        // 最後のレースの選手がいちばん上に来る（1着の数が多い）
        ...races.map((r, i) => ({
          scope: "racer",
          racer_id: 5000 + i,
          course: 1,
          runs: 40,
          wins: i === n - 1 ? 39 : 30,
          off_frame_runs: 0,
          ...w,
        })),
      ],
      until: "2037-10-15",
    });
    const last = races[n - 1].race_id;
    const sizes = [];
    const base = raceDbOf({ absent: [`${last}:1`] });
    const raceDb = async (path) => {
      if (path.startsWith("race_entries"))
        sizes.push(
          decodeURIComponent(path)
            .match(/in\.\(([^)]*)\)/)[1]
            .split(",").length,
        );
      return base(path);
    };
    await plan({
      digest: withCourseWin(notes),
      headless: sheetShooter(),
      raceDb,
      loadVariants: abVariants,
    });
    assert.ok(sizes.length >= 2, String(sizes));
    assert.ok(
      sizes.every((s) => s <= 100),
      String(sizes),
    );
    const draft = await first("SELECT * FROM sns_drafts");
    assert.equal(draft.source_data.content_type.sent, "b");
    // 欠場の選手（最後のレース）は載せず、K からも外す
    assert.equal(draft.source_data.course_win.k.c1, n - 1);
    assert.notEqual(draft.source_data.course_win.featured.race_id, last);
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（db・first・all・at・plan・abVariants） */
export function runSnsTodayPlanScenes15(env) {
  ({ db, first, all, at, plan, abVariants } = env);
  scene1();
  scene2();
  scene3();
}

function scene4() {
  test("型 v3: 同じ材料なら何も書かない。欠場で選ぶ人が変われば作り直す。作れない日は送らず、型 a・b へ倒さない", async () => {
    await plan({ raceDb: v3RaceDb(), loadVariants: loadTodayVariants });
    const [before] = await all("SELECT * FROM sns_drafts");
    const again = await plan({
      now: at("06:55"),
      raceDb: v3RaceDb(),
      loadVariants: loadTodayVariants,
    });
    assert.equal(again.report.items[0].outcome, "unchanged");
    const rebuilt = await plan({
      now: at("06:56"),
      raceDb: v3RaceDb({ absent: [`${DATE}-02-04:1`] }),
      loadVariants: loadTodayVariants,
    });
    assert.equal(rebuilt.report.items[0].outcome, "rebuilt");
    const [after] = await all("SELECT * FROM sns_drafts");
    assert.equal(after.id, before.id);
    assert.match(after.caption_text, /▶ 戸田5R 1号艇 13:02締切/);
    assert.notEqual(
      after.source_data.digest_v3.text_sha256,
      before.source_data.digest_v3.text_sha256,
    );
    assert.equal(after.source_data.digest_v3.send_at, "07:00");
    // 載せられるレースが無い日（全部中止）は下書きを作らない。型 a・b の本文を作らない
    await db.exec(`
    DELETE FROM sns_post_tracking; DELETE FROM sns_x_send_jobs; DELETE FROM sns_auto_send_items;
    ALTER TABLE sns_drafts DISABLE TRIGGER USER; DELETE FROM sns_drafts; ALTER TABLE sns_drafts ENABLE TRIGGER USER;`);
    const all12 = (venue) =>
      Array.from(
        { length: 12 },
        (_, i) => `${DATE}-${venue}-${String(i + 1).padStart(2, "0")}`,
      );
    const none = await plan({
      raceDb: v3RaceDb({ cancelled: [...all12("02"), ...all12("15")] }),
      loadVariants: loadTodayVariants,
    });
    assert.deepEqual(
      [none.report.items[0].outcome, none.report.items[0].reason],
      ["skipped", "v3:no_races"],
    );
    assert.equal((await all("SELECT * FROM sns_drafts")).length, 0);
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（db・first・all・at・plan・abVariants） */
export function runSnsTodayPlanScenes16(env) {
  ({ db, first, all, at, plan, abVariants } = env);
  scene4();
}
