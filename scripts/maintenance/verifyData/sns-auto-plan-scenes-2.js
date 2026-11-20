/**
 * verify-sns-auto-plan.js の後半の場面（2/2）。verify ではない。
 * 判定と期待値は分ける前の verify-sns-auto-plan.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createMockHeadless } from "../../../api/_lib/snsDeadlineQueue.js";
import { SCREEN_MARKERS } from "../../lib/snsScreenMarkers.js";
import { runSnsAutoPlan, reviewGate } from "../../lib/snsAutoPlanRunner.js";
import { RACE } from "./sns-auto-plan-scenes-1.js";

let db, first, all, riskRules, T0, addRace, importBundle, sqlStore, trackingStore, okClaims, run, items;

const failingFetch = async () => ({
  ok: false,
  revision: null,
  observedAt: T0.toISOString(),
  results: [{ id: "c1", ok: false, reason: "fetch_failed: HTTP 503" }],
});

const jobsOf = (groupId) =>
  all(
    `SELECT j.*, d.platform, d.thread_index FROM sns_x_send_jobs j JOIN sns_drafts d ON d.id=j.draft_id
     WHERE d.bundle_import_id=$1 ORDER BY d.platform, d.thread_index`,
    [groupId],
  );

const autoApprover = async () =>
  (
    await first(
      "SELECT auto_approver_id a FROM sns_auto_send_control WHERE channel='x'",
    )
  ).a;

function scene1() {
  test("やり直し中（checking）の古い素材の item は、新しい素材が入ったら閉じ、次の実行で新しい素材の item を作る", async () => {
    await importBundle({ createdAt: "2037-10-15T00:00:00Z" });
    await run({ checkClaims: failingFetch });
    assert.deepEqual(
      (await items()).map((i) => i.state),
      ["checking", "checking"],
    );
    const newer = await importBundle({ createdAt: "2037-10-16T00:00:00Z" });
    await run();
    assert.deepEqual((await items()).map((i) => i.state).sort(), [
      "held_manual",
      "held_manual",
    ]);
    await run();
    const live = (await items()).filter((i) => i.state === "manual");
    assert.equal(live.length, 2);
    assert.ok(live.every((i) => i.bundle_import_id === newer));
  });
  test("やり直し中（checking）の item は、送る時刻を過ぎたら held_manual に閉じる", async () => {
    await importBundle();
    await run({ checkClaims: failingFetch });
    const late = new Date("2037-10-16T05:00:00Z");
    await runSnsAutoPlan(
      { mode: "live", now: () => late, shouldStop: () => false },
      {
        store: sqlStore,
        checkClaims: okClaims,
        headless: createMockHeadless({
          visibleSelectors: SCREEN_MARKERS["race-sonar"],
        }),
        markers: SCREEN_MARKERS,
        riskRules,
        trackingStore,
      },
    );
    const rows = await items();
    assert.deepEqual(
      rows.map((i) => i.state),
      ["held_manual", "held_manual"],
    );
    assert.match(rows[0].held_reason, /too_late/);
  });
  test("1つの素材の検査が例外で落ちても、ほかのレースの item は作る", async () => {
    await addRace("2037-10-16-09-11", "優勝戦");
    await importBundle({ raceId: "2037-10-16-09-11" });
    await importBundle();
    const result = await run({
      checkClaims: async ({ raceId }) => {
        if (raceId === RACE) throw new Error("boom");
        return okClaims();
      },
    });
    assert.deepEqual(
      result.report.alerts
        .filter((a) => a.key.startsWith("plan:"))
        .map((a) => a.key),
      [`plan:${RACE}`],
    );
    assert.ok((await items()).every((i) => i.race_id === "2037-10-16-09-11"));
    assert.equal((await items()).length, 2);
  });
}

function scene2() {
  test("mode=auto で評価役の P0 が0件なら、事前通知のあと自動送信の承認者で承認する（X は親から順、送る時刻は締切の60分前）", async () => {
    await db.exec("UPDATE sns_auto_send_control SET mode='auto'");
    const group = await importBundle({
      qa: {
        pass: true,
        numeric_claims_match: true,
        L0_hits: [],
        review: { p0: 0, p1: 1 },
      },
    });
    const notes = [];
    const result = await run({ notes });
    const [x, yt] = await items();
    assert.deepEqual([x.state, yt.state], ["notified", "notified"]);
    assert.ok(x.notified_at && x.stop_token_hash);
    const jobs = await jobsOf(group);
    const auto = await autoApprover();
    assert.deepEqual(
      jobs.map((j) => [j.platform, j.thread_index, j.state]),
      [
        ["x", 0, "queued"],
        ["x", 1, "queued"],
        ["youtube", 0, "queued"],
      ],
    );
    assert.ok(jobs.every((j) => j.approver_id === auto));
    // 子は1つ前の job につなぐ（親が posted になるまで claim されない）
    assert.equal(jobs[1].parent_job_id, jobs[0].id);
    assert.equal(jobs[0].parent_job_id, null);
    for (const j of jobs)
      assert.equal(j.scheduled_at.toISOString(), "2037-10-16T05:00:00.000Z");
    assert.ok(
      result.report.items.filter((i) => i.outcome === "auto_approved").length ===
        2,
    );
    assert.equal(notes.filter((n) => n.includes("JST 14:00 に送る")).length, 2);
    // もう一度走らせても承認・通知は増えない
    const again = [];
    await run({ notes: again });
    assert.equal((await jobsOf(group)).length, 3);
    assert.equal(again.length, 0);
  });
  test("評価役の P0 があれば自動では送らず manual のまま知らせる", async () => {
    await db.exec("UPDATE sns_auto_send_control SET mode='auto'");
    const group = await importBundle({
      qa: {
        pass: true,
        numeric_claims_match: true,
        L0_hits: [],
        review: { p0: 2 },
      },
    });
    const notes = [];
    await run({ notes });
    assert.deepEqual(
      (await items()).map((i) => i.state),
      ["manual", "manual"],
    );
    assert.equal((await jobsOf(group)).length, 0);
    assert.equal(notes.filter((n) => n.includes("P0 が2件")).length, 2);
  });
  test("事前通知に失敗したら notifying のまま承認せず、次の実行で通知してから承認する", async () => {
    await db.exec(
      "UPDATE sns_auto_send_control SET mode='auto' WHERE channel='x'",
    );
    const group = await importBundle();
    const failed = await run({
      notify: async (text) => {
        if (text.includes("自動送信（全貌動画）")) throw new Error("slack down");
      },
    });
    const [x, yt] = await items();
    assert.deepEqual([x.state, yt.state], ["notifying", "manual"]);
    assert.equal((await jobsOf(group)).length, 0);
    assert.ok(failed.report.alerts.some((a) => a.key.startsWith("plan:")));
    const notes = [];
    await run({ notes });
    assert.equal((await items())[0].state, "notified");
    assert.deepEqual(
      (await jobsOf(group)).map((j) => [j.platform, j.thread_index]),
      [
        ["x", 0],
        ["x", 1],
      ],
    );
    assert.equal(notes.length, 1);
  });
}

function scene3() {
  test("mode=manual なら今までどおり個別承認（自動の承認者の job は作らない）", async () => {
    const group = await importBundle({
      qa: {
        pass: true,
        numeric_claims_match: true,
        L0_hits: [],
        review: { p0: 0 },
      },
    });
    await run();
    assert.deepEqual(
      (await items()).map((i) => i.state),
      ["manual", "manual"],
    );
    assert.equal((await jobsOf(group)).length, 0);
  });
  test("評価役の判定: review.p0 があればそれ、無ければ qa.pass", () => {
    assert.equal(reviewGate({ pass: true }).ok, true);
    assert.equal(reviewGate({ pass: false }).ok, false);
    assert.equal(reviewGate(null).ok, false);
    assert.equal(reviewGate({ pass: true, review: { p0: 0 } }).ok, true);
    assert.equal(reviewGate({ pass: true, review: { p0: 1 } }).ok, false);
    assert.equal(reviewGate({ pass: true, review: { p0: "0" } }).ok, false);
    assert.equal(reviewGate({ pass: true, review: {} }).ok, false);
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（db・first・all・riskRules・T0・addRace・importBundle・sqlStore・trackingStore・okClaims・run・items） */
export function runSnsAutoPlanScenes6(env) {
  ({ db, first, all, riskRules, T0, addRace, importBundle, sqlStore, trackingStore, okClaims, run, items } = env);
  scene1();
  scene2();
  scene3();
}
