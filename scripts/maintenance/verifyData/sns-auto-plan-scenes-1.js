/**
 * verify-sns-auto-plan.js の後半の場面（1/2）。verify ではない。
 * 判定と期待値は分ける前の verify-sns-auto-plan.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { beforeEach, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createMockHeadless } from "../../../api/_lib/snsDeadlineQueue.js";
import { planCandidates, createAutoPlanStore } from "../../lib/snsAutoPlanRunner.js";

let db, all, T0, RACE_URL, addRace, importBundle, sqlStore, run, items, drafts;

export const RACE = "2037-10-16-04-12";

export const PRE_153 = [
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
];

export const hash = () => randomBytes(32).toString("hex");

export const manifest = [
  { name: "draft.mp4", storage_path: "b/draft.mp4" },
  { name: "draft-x.mp4", storage_path: "b/draft-x.mp4" },
  { name: "scene-1.png", storage_path: "b/scene-1.png" },
];

export const CLAIMS = [
  {
    id: "c1",
    text: "1号艇の勝率",
    value: 7.12,
    source: {
      endpoint: `/api/analogy/facts/${RACE}`,
      path: ["facts", 0, "value"],
    },
  },
];

/** verify から呼ぶ入口。env は verify 側の束縛（db・all・T0・addRace・importBundle・run） */
export function runSnsAutoPlanScenes1(env) {
  ({ db, all, T0, addRace, importBundle, run } = env);

}

/** verify から呼ぶ入口。env は verify 側の束縛（db・all・T0・RACE_URL・addRace・importBundle・run） */
export function runSnsAutoPlanScenes2(env) {
  ({ db, all, T0, RACE_URL, addRace, importBundle, run } = env);

}

function scene1() {
  beforeEach(async () => {
    await db.exec(`
    DELETE FROM sns_post_tracking; UPDATE sns_x_send_jobs SET parent_job_id=NULL; DELETE FROM sns_x_send_jobs;
    DELETE FROM sns_auto_send_items;
    ALTER TABLE sns_drafts DISABLE TRIGGER USER; DELETE FROM sns_drafts; ALTER TABLE sns_drafts ENABLE TRIGGER USER;
    DELETE FROM sns_bundle_imports; DELETE FROM races; DELETE FROM race_conditions;
    UPDATE sns_auto_send_control SET mode='manual', dry_run=true;
    UPDATE sns_x_send_control SET schedule_minutes=60, expiry_minutes=30;`);
    await db.query("UPDATE test_clock SET value=$1", [T0.toISOString()]);
    await addRace(RACE, "準優勝戦");
  });
  after(() => db.close());
}

/** verify から呼ぶ入口。env は verify 側の束縛（db・all・T0・RACE_URL・addRace・importBundle・run） */
export function runSnsAutoPlanScenes3(env) {
  ({ db, all, T0, RACE_URL, addRace, importBundle, run } = env);
  scene1();
}

/** verify から呼ぶ入口。env は verify 側の束縛（db・all・T0・RACE_URL・addRace・importBundle・run） */
export function runSnsAutoPlanScenes4(env) {
  ({ db, all, T0, RACE_URL, addRace, importBundle, run } = env);

}

function scene2() {
  test("同じ素材でもう一度走らせても item・下書き・通知は増えない", async () => {
    const group = await importBundle();
    await run();
    const before = await drafts(group, "x");
    const notes = [];
    const result = await run({ notes });
    assert.equal((await items()).length, 2);
    assert.deepEqual(await drafts(group, "x"), before);
    assert.equal(result.rowsWritten, 0);
    assert.equal(notes.length, 0);
  });
  test("優勝戦・準優勝戦以外・中止・送る時刻を過ぎたレースは item を作らない", async () => {
    await addRace("2037-10-16-05-01", "予選");
    await addRace("2037-10-16-06-12", "優勝戦", { cancelled: "confirmed" });
    await addRace("2037-10-16-07-12", "優勝戦", { start: "12:59:00" });
    await addRace("2037-10-16-08-12", "ツッキー優勝戦");
    for (const raceId of [
      "2037-10-16-05-01",
      "2037-10-16-06-12",
      "2037-10-16-07-12",
      "2037-10-16-08-12",
    ])
      await importBundle({ raceId });
    const result = await run();
    assert.equal((await items()).length, 0);
    assert.deepEqual(result.report.items.map((i) => i.reason).sort(), [
      "not_final_stage",
      "not_final_stage",
      "race_cancelled",
      "too_late",
    ]);
  });
  test("数値の照合が合わなければ held_manual にし、下書き・UTM の表は変えない", async () => {
    const group = await importBundle();
    const notes = [];
    await run({
      notes,
      checkClaims: async () => ({
        ok: false,
        revision: null,
        observedAt: T0.toISOString(),
        results: [{ id: "c1", ok: false, reason: "value_mismatch" }],
      }),
    });
    const [x] = await items();
    assert.equal(x.state, "held_manual");
    assert.match(x.held_reason, /数値の照合: c1 value_mismatch/);
    const [parent] = await drafts(group, "x");
    assert.equal(parent.publish_blocked, true);
    assert.equal(parent.caption_text.includes("utm_"), false);
    assert.equal((await all("SELECT * FROM sns_post_tracking")).length, 0);
    assert.equal(notes.length, 2);
    assert.ok(notes[0].includes("止めた"));
  });
  test("UTM を差し込んだ後の本文に禁止表現があれば held_manual", async () => {
    await importBundle({ parent: `競艇の準優勝戦。\n${RACE_URL}` });
    await run();
    const [x, yt] = await items();
    assert.equal(x.state, "held_manual");
    assert.match(x.held_reason, /禁止表現/);
    assert.equal(yt.state, "manual");
  });
}

function scene3() {
  test("取得の失敗だけなら checking のままやり直し、3回目で held_manual。途中で通れば manual", async () => {
    await importBundle();
    const failing = async () => ({
      ok: false,
      revision: null,
      observedAt: T0.toISOString(),
      results: [{ id: "c1", ok: false, reason: "fetch_failed: HTTP 503" }],
    });
    await run({ checkClaims: failing });
    assert.deepEqual(
      (await items()).map((i) => [i.state, i.checks.attempts]),
      [
        ["checking", 1],
        ["checking", 1],
      ],
    );
    await run({ checkClaims: failing });
    await run();
    assert.deepEqual(
      (await items()).map((i) => i.state),
      ["manual", "manual"],
    );

    await db.exec(
      "DELETE FROM sns_post_tracking; UPDATE sns_x_send_jobs SET parent_job_id=NULL; DELETE FROM sns_x_send_jobs; DELETE FROM sns_auto_send_items; ALTER TABLE sns_drafts DISABLE TRIGGER USER; DELETE FROM sns_drafts; ALTER TABLE sns_drafts ENABLE TRIGGER USER; DELETE FROM sns_bundle_imports;",
    );
    await importBundle();
    for (let i = 0; i < 3; i++) await run({ checkClaims: failing });
    assert.deepEqual(
      (await items()).map((i) => [i.state, i.checks.attempts]),
      [
        ["held_manual", 3],
        ["held_manual", 3],
      ],
    );
  });
  test("リンク先の表示の印が見えなければ held_manual（やり直さない）", async () => {
    await importBundle();
    await run({ headless: createMockHeadless({ visibleSelectors: [] }) });
    const [x] = await items();
    assert.equal(x.state, "held_manual");
    assert.match(x.held_reason, /リンク先の表示: public_component_missing/);
  });
  test("shadow は検査だけで、item・下書き・UTM の表・Slack に書かない", async () => {
    const group = await importBundle();
    const notes = [];
    sqlStore.calls.length = 0;
    const result = await run({ mode: "shadow", notes });
    assert.equal((await items()).length, 0);
    assert.equal((await drafts(group, "x"))[0].publish_blocked, true);
    assert.equal((await all("SELECT * FROM sns_post_tracking")).length, 0);
    assert.equal(notes.length, 0);
    assert.deepEqual(
      result.report.items.map((i) => i.outcome),
      ["manual", "manual"],
    );
    assert.equal(sqlStore.calls.length, 0);
  });
  test("manual にした後で公開保留を外せずに落ちたものは、次の実行で外す", async () => {
    const group = await importBundle();
    await run();
    await db.exec(
      "ALTER TABLE sns_drafts DISABLE TRIGGER USER; UPDATE sns_drafts SET publish_blocked=true; ALTER TABLE sns_drafts ENABLE TRIGGER USER;",
    );
    const result = await run();
    assert.deepEqual(
      (await drafts(group, "x")).map((d) => d.publish_blocked),
      [false, true],
    );
    assert.equal((await drafts(group, "youtube"))[0].publish_blocked, false);
    assert.deepEqual(
      result.report.items.filter((i) => i.outcome === "unblocked").length,
      2,
    );
  });
  test("158 が未適用で月の切り替えの関数が無くても、知らせて item の計画は続ける", async () => {
    sqlStore.calls.length = 0;
    await importBundle();
    const result = await run();
    assert.deepEqual(sqlStore.calls, [
      "roll_sns_send_baselines",
      "roll_sns_x_send_period",
    ]);
    assert.deepEqual(
      result.report.alerts.map((a) => a.key),
      ["roll:roll_sns_x_send_period"],
    );
    assert.equal((await items()).length, 2);
  });
}

function scene4() {
  test("同じレースの素材が2つあれば新しい方を使い、別の素材の item が生きていれば作らない", async () => {
    const older = await importBundle({ createdAt: "2037-10-15T00:00:00Z" });
    const newer = await importBundle({ createdAt: "2037-10-16T00:00:00Z" });
    await run();
    assert.ok((await items()).every((i) => i.bundle_import_id === newer));
    const rows = await sqlStore.todaysBundles("2037-10-16");
    const plans = planCandidates(
      { ...rows, bundles: rows.bundles.filter((b) => b.id === older) },
      T0,
    );
    assert.equal(plans.todo.length, 0);
  });
  test("PostgREST の store: URL・条件付きの更新・失敗は投げる", async () => {
    const calls = [];
    const fetchImpl = async (url, options = {}) => {
      calls.push({ url, method: options.method ?? "GET", body: options.body });
      if (url.includes("fail")) return new Response("", { status: 500 });
      if (options.method === "PATCH" && url.includes("none"))
        return new Response("[]");
      if (url.includes("sns_bundle_imports"))
        return new Response(
          JSON.stringify([
            { id: "b1", bundle: { race_id: RACE }, created_at: "x" },
            { id: "b2", bundle: { race_id: "2037-10-15-01-01" } },
          ]),
        );
      return new Response(JSON.stringify([{ id: "1" }]));
    };
    const store = createAutoPlanStore({ url: "https://db", key: "k", fetchImpl });
    const rows = await store.todaysBundles("2037-10-16");
    assert.deepEqual(
      rows.bundles.map((b) => b.id),
      ["b1"],
    );
    const urls = calls.map((c) => decodeURIComponent(c.url));
    assert.ok(
      urls[0].includes(
        "schema_version=eq.ryujin-preview/1&created_at=gte.2037-10-12T15:00:00.000Z",
      ),
    );
    assert.ok(urls.some((u) => u.includes(`races?race_id=in.("${RACE}")`)));
    assert.ok(
      urls.some((u) => u.includes('sns_drafts?bundle_import_id=in.("b1")')),
    );
    await store.updateItem("i1", "checking", { state: "manual" });
    assert.ok(
      calls.at(-1).url.endsWith("sns_auto_send_items?id=eq.i1&state=eq.checking"),
    );
    await store.updateDraft("d1", { publish_blocked: false });
    assert.ok(
      calls.at(-1).url.endsWith("sns_drafts?id=eq.d1&status=eq.pending_review"),
    );
    await assert.rejects(store.updateDraft("none", {}), /更新できない/);
    await assert.rejects(store.rpc("fail"), /HTTP 500/);
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（db・all・T0・RACE_URL・addRace・importBundle・sqlStore・run・items・drafts） */
export function runSnsAutoPlanScenes5(env) {
  ({ db, all, T0, RACE_URL, addRace, importBundle, sqlStore, run, items, drafts } = env);
  scene2();
  scene3();
  scene4();
}
