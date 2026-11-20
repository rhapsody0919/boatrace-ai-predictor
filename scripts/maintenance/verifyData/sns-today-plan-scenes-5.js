/**
 * verify-sns-today-plan.js の後半の場面（5/7）。verify ではない。
 * 判定と期待値は分ける前の verify-sns-today-plan.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { DATE } from "./sns-today-plan-v3-race-db.js";
import { TODAY_URL } from "../../lib/snsTodayPlanner.js";
import { buildCourseWinNotes } from "../../../src/utils/todayCourseWin.js";
import { TYPE_VARIANTS } from "./sns-today-plan-scenes-3.js";
import { digestOf, raceDbOf } from "./sns-today-plan-scenes-1.js";

let db, first, PNG, at, sqlStore, shooter, plan, putType, withAuto, abVariants;

// ---------- 型 b（v2「今日走る選手のコース別1着率」、hq 2026-10-27 オーナー決定） ----------
export const CW_BASE = [
  ["A1", 1, 16129, 11456],
  ["A2", 1, 13822, 8353],
  ["B1", 1, 19169, 7685],
  ["A1", 4, 11658, 1867],
  ["A2", 4, 11845, 1474],
];

/** 朝の一覧の notes.courseWin（buildCourseWinNotes で作る。生成と同じ関数） */
export function courseWinOf() {
  const races = [
    [`${DATE}-04-12`, 4, 12, "16:14:00"],
    [`${DATE}-24-10`, 24, 10, "19:36:00"],
    [`${DATE}-22-12`, 22, 12, "16:40:00"],
    [`${DATE}-06-12`, 6, 12, "16:23:00"],
    // 締切が送る時刻より前のレースは載せない
    [`${DATE}-01-01`, 1, 1, "06:50:00"],
  ].map(([race_id, venue_code, race_number, start_time]) => ({
    race_id,
    venue_code,
    race_number,
    start_time,
  }));
  const entries = [
    [`${DATE}-04-12`, 1, 1001, "A1", "高橋\u3000竜矢"],
    [`${DATE}-24-10`, 1, 1002, "A1", "西村\u3000\u3000拓也"],
    [`${DATE}-22-12`, 1, 1003, "A2", "上田\u3000龍星"],
    [`${DATE}-06-12`, 4, 1004, "A2", "山下\u3000大輝"],
    [`${DATE}-01-01`, 1, 1005, "A1", "早朝\u3000一郎"],
  ].map(([race_id, boat_number, racer_id, grade, player_name]) => ({
    race_id,
    boat_number,
    racer_id,
    grade,
    player_name,
  }));
  const w = { window_start: "2025-12-02", window_end: "2037-10-15" };
  const rows = [
    ...CW_BASE.map(([grade, course, runs, wins]) => ({
      scope: "grade",
      grade,
      course,
      runs,
      wins,
      ...w,
    })),
    ...[
      [1001, 1, 47, 42],
      [1002, 1, 56, 47],
      [1003, 1, 42, 33],
      [1004, 4, 45, 14],
      [1005, 1, 60, 58],
    ].map(([racer_id, course, runs, wins]) => ({
      scope: "racer",
      racer_id,
      course,
      runs,
      wins,
      off_frame_runs: 0,
      ...w,
    })),
  ];
  return buildCourseWinNotes({
    races,
    entries,
    rpcRows: rows,
    until: "2037-10-15",
  });
}

export const withCourseWin = (courseWin = courseWinOf()) => {
  const d = digestOf();
  return { ...d, day: { ...d.day, notes: { ...d.day.notes, courseWin } } };
};

/** 撮影用のページ（指紋の印が出る）と /today・ソナーの図 */
/**
 * 撮影用のページ（指紋の印が出る）と /today・ソナーの図。pageKey を渡すと、ページはその指紋を出す（計画の指紋と違えば、
 * 本物の snsHeadless と同じく待つ印が見えず screenshot_component_missing）
 */
export function sheetShooter({ sheetFails = false, pageKey = null } = {}) {
  const inner = shooter();
  return {
    ...inner,
    async screenshot(request) {
      if (request.url.includes("/share/today-sheet")) {
        inner.calls.push(request);
        if (sheetFails) throw new Error("screenshot_component_missing");
        if (
          pageKey &&
          !request.requiredSelectors.includes(
            `[data-today-sheet-key="${pageKey}"]`,
          )
        )
          throw new Error("screenshot_component_missing");
        return { finalUrl: request.url, png: new Uint8Array([...PNG, 9]) };
      }
      return inner.screenshot(request);
    },
  };
}

export const clearDrafts = () =>
  db.exec(
    "DELETE FROM sns_post_tracking; DELETE FROM sns_x_send_jobs; DELETE FROM sns_auto_send_items; ALTER TABLE sns_drafts DISABLE TRIGGER USER; DELETE FROM sns_drafts; ALTER TABLE sns_drafts ENABLE TRIGGER USER;",
  );

function scene1() {
  test("返信: 子を親につないだ後、子の承認の前に関数が落ちた（子は pending_review・job なし）ら、同じ版でも作り直して子を承認する（Codex の審査 P1）", async () => {
    await putType(DATE, "t01-link-in-reply", {
      heading: "本日のデータ一覧（{date}）",
      link_position: "reply",
    });
    await withAuto(async () => {
      await plan({ loadVariants: () => TYPE_VARIANTS });
      const { reply } = await sqlStore.todayState(DATE);
      // 落ちた状態を作る: 子の job が無く、子の下書きは承認前（parent_job_id は入っている）
      await db.query("DELETE FROM sns_x_send_jobs WHERE draft_id=$1", [
        reply.draft.id,
      ]);
      await db.query(
        "UPDATE sns_drafts SET status='pending_review', approver_id=NULL, approved_at=NULL, x_approved_hash=NULL WHERE id=$1",
        [reply.draft.id],
      );
      const again = await plan({
        now: at("06:45"),
        loadVariants: () => TYPE_VARIANTS,
      });
      assert.notEqual(again.report.items[0].outcome, "unchanged");
      const job = await first(
        "SELECT state, parent_job_id FROM sns_x_send_jobs WHERE draft_id=$1",
        [reply.draft.id],
      );
      assert.equal(job.state, "queued");
      assert.ok(job.parent_job_id);
    });
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（db・first・PNG・at・sqlStore・shooter・plan・putType・withAuto・abVariants） */
export function runSnsTodayPlanScenes13(env) {
  ({ db, first, PNG, at, sqlStore, shooter, plan, putType, withAuto, abVariants } = env);
  scene1();
}

function scene2() {
  test("型 b: b の日は本文が「N回中M回。」の型、画像は撮影用のページ1枚（指紋の一致が条件）、札は b、K・線を記録し、自動の承認で job ができる", async () => {
    const headless = sheetShooter();
    const saved = [];
    const notes = [];
    await withAuto(async () => {
      const result = await plan({
        digest: withCourseWin(),
        headless,
        saved,
        notes,
        loadVariants: abVariants,
      });
      assert.equal(result.report.items[0].outcome, "notified");
    });
    const draft = await first("SELECT * FROM sns_drafts");
    const url = `${TODAY_URL}?utm_source=x&utm_medium=social&utm_campaign=today_digest&utm_content=${DATE}-b`;
    // 並べは縮めた値−級の平均。1コースの1行目（本文の人）は高橋（A1 42/47）。名前の全角の空白は半角1つにそろう
    assert.equal(
      draft.caption_text,
      [
        "47回中42回。",
        "",
        "今日の平和島12R、1号艇 高橋 竜矢が",
        "1コースに入ったときに1着になった数。",
        // 正確な二項の上側確率 0.0025 がその日の1コースの候補3人の Bonferroni の水準 0.025/3 を下回った日だけ、差を書く
        "A1級の全国平均 71% を上回る。",
        "",
        "今日走る選手のコース別1着率を1枚に。",
        "締切前に見返すなら保存を。",
        "",
        `全レースの一覧 → https://www.boat-ai.jp/x/today?d=${DATE}-b`,
        "※過去の数字です #ボートレース",
      ].join("\n"),
    );
    const sd = draft.source_data;
    assert.equal(sd.content_type.sent, "b");
    assert.equal(sd.content_type.body, "course_win");
    assert.equal(sd.content_type.id, "today-b-course-win");
    assert.equal(sd.content_type.experiment, "t-ab");
    assert.deepEqual(sd.image_paths, [
      `today/${DATE}/${sd.digest.revision}-sheet.png`,
    ]);
    assert.equal(draft.cover_image_path, sd.image_paths[0]);
    // 締切が 7:00 より前の 早朝 一郎 は K に入らない。1コース 3人・4コース 1人
    assert.deepEqual(sd.course_win.k, { c1: 3, c4: 1 });
    assert.equal(sd.course_win.claim, true);
    assert.ok(sd.course_win.tail < 0.025 / 3);
    assert.ok(Math.abs(sd.course_win.line - 2.394) < 1e-3);
    assert.equal(sd.course_win.featured.racer_id, 1001);
    assert.deepEqual(
      sd.digest.picks.map((p) => p.race_id).sort(),
      [`${DATE}-04-12`, `${DATE}-06-12`, `${DATE}-22-12`, `${DATE}-24-10`].sort(),
    );
    // 撮影用のページ: 渡すのは日付・送る時刻だけ。指紋が計画と同じときだけ撮れる。ソナーの図は撮らない
    const sheetCall = headless.calls.find((c) => c.url.includes("today-sheet"));
    assert.equal(
      sheetCall.url,
      `https://www.boat-ai.jp/share/today-sheet?date=${DATE}&from=07%3A00`,
    );
    assert.deepEqual(sheetCall.requiredSelectors, [
      `[data-today-sheet-key="${sd.course_win.key}"]`,
    ]);
    assert.deepEqual(sheetCall.viewport, { width: 1080, height: 1350 });
    // 撮るのは画像の要素だけ。label は渡さない（snsHeadless が要素の先頭に焼き込み、下余白が減る。コードレビューの P1）
    assert.equal(sheetCall.element, "[data-today-sheet]");
    assert.equal(sheetCall.label, undefined);
    assert.equal(
      headless.calls.filter((c) => c.url.includes("tab=sonar")).length,
      0,
    );
    assert.equal(saved.length, 1);
    const tracking = await first("SELECT * FROM sns_post_tracking");
    assert.equal(tracking.utm_content, `${DATE}-b`);
    assert.equal(tracking.tracking_url, url);
    const job = await first("SELECT * FROM sns_x_send_jobs WHERE draft_id=$1", [
      draft.id,
    ]);
    assert.equal(job.state, "queued");
    assert.doesNotMatch(notes[0], /型 b の日だったが/);
  });
}

function scene3() {
  test("型 b: 欠場・中止の行は外して後ろから補い、撮影用のページに skip で渡す", async () => {
    const headless = sheetShooter();
    await plan({
      digest: withCourseWin(),
      headless,
      raceDb: raceDbOf({ absent: [`${DATE}-04-12:1`] }),
      loadVariants: abVariants,
    });
    const draft = await first("SELECT * FROM sns_drafts");
    // 高橋が欠場 → 1コースの1行目は上田（A2 33/42。縮めた値−A2 の平均が、西村（A1 47/56）より大きい）
    assert.match(
      draft.caption_text,
      /^42回中33回。\n\n今日の福岡12R、1号艇 上田 龍星が/,
    );
    assert.deepEqual(draft.source_data.course_win.k, { c1: 2, c4: 1 });
    const sheetCall = headless.calls.find((c) => c.url.includes("today-sheet"));
    assert.match(sheetCall.url, new RegExp(`skip=${DATE}-04-12%3A1$`));
  });
  test("型 b: 材料が無い日（RPC 未適用など）は型 a で送り、理由を content_type と Slack に残す（b を送らない）", async () => {
    const notes = [];
    const headless = sheetShooter();
    await plan({
      digest: withCourseWin({
        v: 1,
        status: "unavailable",
        reason: "rpc_missing",
      }),
      headless,
      notes,
      loadVariants: abVariants,
    });
    const draft = await first("SELECT * FROM sns_drafts");
    assert.match(draft.caption_text, /^本日のデータ一覧（/);
    const ct = draft.source_data.content_type;
    assert.equal(ct.side, "b");
    assert.equal(ct.sent, "a");
    assert.equal(ct.id, "today-a");
    assert.equal(ct.fallback_reason, "course_win:rpc_missing");
    assert.equal(draft.source_data.course_win, undefined);
    assert.match(
      draft.caption_text,
      /https:\/\/www\.boat-ai\.jp\/x\/today\?d=2037-10-17-a/,
    );
    assert.match(notes[0], /型 b の日だったが型 a で送る: rpc_missing/);
    assert.equal(
      headless.calls.filter((c) => c.url.includes("today-sheet")).length,
      0,
    );
  });
  test("型 b: 1コースの候補が0人の日・形の版が違う日も型 a", async () => {
    for (const [courseWin, reason] of [
      [
        {
          ...courseWinOf(),
          candidates: courseWinOf().candidates.filter((c) => c.section === "c4"),
        },
        "no_c1_rows",
      ],
      [{ ...courseWinOf(), v: 2 }, "version_2"],
    ]) {
      await clearDrafts();
      await plan({
        digest: withCourseWin(courseWin),
        headless: sheetShooter(),
        loadVariants: abVariants,
      });
      const draft = await first("SELECT * FROM sns_drafts");
      assert.equal(
        draft.source_data.content_type.fallback_reason,
        `course_win:${reason}`,
      );
    }
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（db・first・PNG・at・sqlStore・shooter・plan・putType・withAuto・abVariants） */
export function runSnsTodayPlanScenes14(env) {
  ({ db, first, PNG, at, sqlStore, shooter, plan, putType, withAuto, abVariants } = env);
  scene2();
  scene3();
}
