/**
 * verify-eve-deadlines.js の後半の場面（1/2）。verify ではない。
 * 判定と期待値は分ける前の verify-eve-deadlines.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import assert from "node:assert/strict";
import {
  buildEveRows,
  isFinalRound,
  raceIndexUrl,
  runEveDeadlinesJob,
} from "../../lib/eveDeadlinesJob.js";
import { validateRegistry, SCRAPE_JOBS } from "../../lib/scrapeJobs/registry.js";
import { applyZeroRowGuard } from "../../lib/scrapeJobs/outcomes.js";

let read, DAY2, EMPTY, t, clone, D, NOW1, NOW2, v19, fakeClient, fakeFetch, PAGES, SERIES, ctxOf, deps;

function scene1() {
  t(
    "buildEveRows: 変わらない行は書かない・締切の変更は数える・名前は前の値を残す",
    () => {
      const names = new Map([[`${D}-19-11`, "優勝戦"]]);
      const { rows: first } = buildEveRows({
        date: D,
        existing: [],
        venues: [v19],
        names,
        nowIso: NOW1,
      });
      // DB から読み戻した形（time は HH:MM:SS）
      const existing = first.map((r) => ({
        ...r,
        day_start_time: null,
        day_mismatch: null,
        reconciled_at: null,
      }));
      assert.deepEqual(
        buildEveRows({
          date: D,
          existing,
          venues: [v19],
          names: new Map(),
          nowIso: NOW2,
        }),
        { rows: [], changedIds: [] },
      );
      // 日の札が取れなかった回は前の値（優勝戦の判定を false で上書きしない）
      assert.deepEqual(
        buildEveRows({
          date: D,
          existing,
          venues: [{ ...v19, dayLabel: null }],
          names: new Map(),
          nowIso: NOW2,
        }).rows,
        [],
      );
      const moved = clone(v19);
      moved.races[10].deadline = "22:25";
      const { rows, changedIds } = buildEveRows({
        date: D,
        existing,
        venues: [moved],
        names: new Map(),
        nowIso: NOW2,
      });
      assert.deepEqual(changedIds, [`${D}-19-11`]);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].deadline, "22:25:00");
      assert.equal(rows[0].deadline_changes, 1);
      assert.equal(rows[0].race_name, "優勝戦", "取らなかった回は前の名前を残す");
      assert.equal(rows[0].is_final, true);
      assert.equal(rows[0].first_fetched_at, NOW1);
      assert.equal(rows[0].updated_at, NOW2);
    },
  );
}

/** verify から呼ぶ入口。env は verify 側の束縛（read・DAY2・EMPTY・t・clone・D・NOW1・NOW2・v19・fakeClient・fakeFetch） */
export function runEveDeadlinesScenes1(env) {
  ({ read, DAY2, EMPTY, t, clone, D, NOW1, NOW2, v19, fakeClient, fakeFetch } = env);
  scene1();
}

function scene2() {
  t("isFinalRound: 21:20 JST の起動から最後", () => {
    assert.equal(
      isFinalRound(new Date("2026-11-04T12:19:59Z"), "2026-11-04", "21:20"),
      false,
    );
    assert.equal(
      isFinalRound(new Date("2026-11-04T12:20:00Z"), "2026-11-04", "21:20"),
      true,
    );
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（read・DAY2・EMPTY・t・clone・D・NOW1・NOW2・v19・fakeClient・fakeFetch・PAGES・SERIES・ctxOf・deps） */
export function runEveDeadlinesScenes2(env) {
  ({ read, DAY2, EMPTY, t, clone, D, NOW1, NOW2, v19, fakeClient, fakeFetch, PAGES, SERIES, ctxOf, deps } = env);
  scene2();
}

function scene3() {
  t(
    "race_series の会場の 403・0行は失敗（書かない、incomplete、最後の起動は通知）",
    async () => {
      const client = fakeClient({
        race_series: SERIES,
        eve_race_deadlines: [{ race_id: `${D}-04-01`, race_date: D, venue_code: 4 }],
      });
      const f = fakeFetch(
        { ...PAGES, [raceIndexUrl(D, 4)]: EMPTY },
        { [raceIndexUrl(D, 19)]: 403 },
      );
      const out = await runEveDeadlinesJob(
        ctxOf({
          client,
          politeFetch: f.politeFetch,
          now: "2026-11-04T12:20:03Z",
        }),
        deps,
      );
      assert.deepEqual(
        out.report.venuesFailed.map((v) => v.venueCode).sort(),
        [19, 4].sort(),
      );
      assert.equal(
        out.report.venuesFailed.find((v) => v.venueCode === 19).reason,
        "http_403",
      );
      assert.equal(out.rowsParsed, 0);
      assert.equal(
        applyZeroRowGuard({ outcome: "ok", ...out }).outcome,
        "error",
        "0件は成功にしない",
      );
      assert.equal(out.incomplete, true);
      assert.ok(out.report.alerts.some((a) => a.key === `failed:${D}`));
      assert.equal(client.writes.length, 0);
    },
  );
  t("race_series に無い会場で行が出たら書いて通知する", async () => {
    const client = fakeClient({
      race_series: [SERIES[0]],
      eve_race_deadlines: [],
    });
    const f = fakeFetch(PAGES);
    const out = await runEveDeadlinesJob(
      ctxOf({ client, politeFetch: f.politeFetch, now: NOW1 }),
      deps,
    );
    assert.deepEqual(out.report.unexpectedVenues, [4]);
    assert.ok(out.report.alerts.some((a) => a.key === `unexpected:${D}`));
    assert.equal(out.rowsWritten, 24);
  });
  t(
    "打ち切り: 着手しなかった会場は incomplete、名前の取れない最終日も incomplete",
    async () => {
      const client = fakeClient({
        race_series: SERIES,
        eve_race_deadlines: [{ race_id: `${D}-04-01`, race_date: D, venue_code: 4 }],
      });
      const f = fakeFetch(PAGES);
      const out = await runEveDeadlinesJob(
        ctxOf({
          client,
          politeFetch: f.politeFetch,
          now: "2026-11-04T12:20:03Z",
          stopAfter: 2,
        }),
        deps,
      );
      assert.equal(f.calls.length, 2, "raceindex の2件で止まる");
      assert.equal(out.report.namesMissing.length, 3);
      assert.equal(out.incomplete, true);
    },
  );
  t("shadow は書かない", async () => {
    const client = fakeClient({ race_series: SERIES, eve_race_deadlines: [] });
    const f = fakeFetch(PAGES);
    const out = await runEveDeadlinesJob(
      ctxOf({ client, politeFetch: f.politeFetch, now: NOW1, mode: "shadow" }),
      deps,
    );
    assert.equal(client.writes.length, 0);
    assert.equal(out.rowsWritten, 0);
    assert.equal(out.rowsParsed, 24);
  });
}

function scene4() {
  t("読み取りの失敗は例外（行なしに化けさせない）", async () => {
    for (const failOn of ["select:race_series", "select:eve_race_deadlines"]) {
      const client = fakeClient(
        { race_series: SERIES, eve_race_deadlines: [] },
        { failOn },
      );
      const f = fakeFetch(PAGES);
      await assert.rejects(
        runEveDeadlinesJob(
          ctxOf({ client, politeFetch: f.politeFetch, now: NOW1 }),
          deps,
        ),
        /読み取りに失敗/,
      );
      assert.equal(f.calls.length, 0);
    }
  });
  t("翌日の節が race_series に無く24場も空なら失敗", async () => {
    const client = fakeClient({ race_series: [], eve_race_deadlines: [] });
    const f = fakeFetch({});
    const out = await runEveDeadlinesJob(
      ctxOf({ client, politeFetch: f.politeFetch, now: NOW1 }),
      deps,
    );
    assert.equal(out.outcome, "error");
    assert.equal(f.calls.length, 24);
  });
  t("race_series が空の晩: 2回目以降も行のある会場を取り直し、error にしない", async () => {
    const client = fakeClient({ race_series: [], eve_race_deadlines: [] });
    const f1 = fakeFetch(PAGES);
    const first = await runEveDeadlinesJob(
      ctxOf({ client, politeFetch: f1.politeFetch, now: NOW1 }),
      deps,
    );
    assert.deepEqual(first.report.unexpectedVenues, [4, 19]);
    const f2 = fakeFetch({ ...PAGES, [raceIndexUrl(D, 4)]: DAY2.replace(">20:45<", ">20:50<") });
    const second = await runEveDeadlinesJob(
      ctxOf({ client, politeFetch: f2.politeFetch, now: "2026-11-04T12:20:03Z" }),
      deps,
    );
    assert.deepEqual(f2.calls, [raceIndexUrl(D, 4), raceIndexUrl(D, 19)]);
    assert.notEqual(second.outcome, "error");
    assert.equal(second.incomplete, false);
    assert.equal(second.rowsWritten, 1);
    assert.ok(second.report.alerts.some((a) => a.key === `changed:${D}-04-12`));
  });
  t("race_series に無い会場の並びの異常は失敗に数えず通知だけ", async () => {
    const bad = DAY2.replace(">16:22<", ">15:00<");
    const client = fakeClient({ race_series: [SERIES[0]], eve_race_deadlines: [] });
    const f = fakeFetch({ ...PAGES, [raceIndexUrl(D, 4)]: bad });
    const out = await runEveDeadlinesJob(
      ctxOf({ client, politeFetch: f.politeFetch, now: "2026-11-04T12:20:03Z" }),
      deps,
    );
    assert.deepEqual(out.report.venuesFailed, []);
    assert.equal(out.report.unexpectedAnomalies[0].venueCode, 4);
    assert.equal(out.incomplete, false);
    assert.ok(!client.data.eve_race_deadlines.some((r) => r.venue_code === 4), "書かない");
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（read・DAY2・EMPTY・t・clone・D・NOW1・NOW2・v19・fakeClient・fakeFetch・PAGES・SERIES・ctxOf・deps） */
export function runEveDeadlinesScenes3(env) {
  ({ read, DAY2, EMPTY, t, clone, D, NOW1, NOW2, v19, fakeClient, fakeFetch, PAGES, SERIES, ctxOf, deps } = env);
  scene3();
  scene4();
}

function scene5() {
  // ---------- registry・vercel.json ----------

  t("registry: finalRunAfterJst の検査と2つのジョブ", () => {
    assert.deepEqual(validateRegistry(), []);
    assert.equal(SCRAPE_JOBS.eve_deadlines.finalRunAfterJst, "21:20");
    const bad = {
      x: { ...SCRAPE_JOBS.eve_deadlines, finalRunAfterJst: "20:00" },
    };
    assert.ok(validateRegistry(bad).some((p) => /finalRunAfterJst/.test(p)));
  });
  t(
    "vercel.json の cron（JST 20:40・21:00・21:10・21:20、06:30・08:00）と maxDuration",
    () => {
      const crons = JSON.parse(read("vercel.json")).crons;
      const of = (p) => crons.filter((c) => c.path === p).map((c) => c.schedule);
      assert.deepEqual(of("/api/cron/eve-deadlines"), [
        "40 11 * * *",
        "0,10,20 12 * * *",
      ]);
      assert.deepEqual(of("/api/cron/eve-deadlines-reconcile"), [
        "30 21 * * *",
        "0 23 * * *",
      ]);
      for (const [file, job] of [
        ["api/cron/eve-deadlines.js", "eve_deadlines"],
        ["api/cron/eve-deadlines-reconcile.js", "eve_deadlines_reconcile"],
      ]) {
        const m = /maxDuration:\s*(\d+)/.exec(read(file));
        assert.equal(Number(m[1]), SCRAPE_JOBS[job].maxDurationSec, file);
      }
    },
  );
}

/** verify から呼ぶ入口。env は verify 側の束縛（read・DAY2・EMPTY・t・clone・D・NOW1・NOW2・v19・fakeClient・fakeFetch・PAGES・SERIES・ctxOf・deps） */
export function runEveDeadlinesScenes4(env) {
  ({ read, DAY2, EMPTY, t, clone, D, NOW1, NOW2, v19, fakeClient, fakeFetch, PAGES, SERIES, ctxOf, deps } = env);
  scene5();
}
