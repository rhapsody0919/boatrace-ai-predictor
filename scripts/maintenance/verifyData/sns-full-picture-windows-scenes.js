/**
 * verify-sns-full-picture-windows.js の後半の場面。verify ではない。
 * 判定と期待値は分ける前の verify-sns-full-picture-windows.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildObservationCsvRows } from "../../../src/utils/snsObservationCsv.js";
import { collectDueObservations } from "../../lib/snsObservationCollector.js";
import { runSnsMetrics } from "../../lib/snsMetricsRunner.js";

let fpDraft, otherDraft;

function scene1() {
  test("CSV と collector: 全貌は day_end・24h の行、それ以外は 48h・7d の行（全貌を 48h・7d の未収集にしない）", async () => {
    const csvRows = buildObservationCsvRows([fpDraft, otherDraft], [], {
      start: "2026-10-19",
      end: "2026-10-19",
      platform: "all",
      now: Date.parse("2026-10-30T00:00:00Z"),
    });
    const windowsOf = (id) =>
      csvRows.filter((r) => r.draft_id === id).map((r) => r.window);
    assert.deepEqual(windowsOf(fpDraft.id), ["day_end", "24h"]);
    assert.deepEqual(windowsOf(otherDraft.id), ["48h", "7d"]);
    // provider が窓どおりの累積値を返せば、day_end も 24h も保存できる（審査 P2-1: day_end が必ず failed になっていた）
    const saved = [];
    const results = await collectDueObservations({
      drafts: [fpDraft],
      provider: {
        collect: async ({ period }) => [
          {
            ...period,
            observed_at: period.period_end,
            data_through: period.period_end,
            source: "x-api",
            metric_name: "impressions",
            metric_value: 12,
            missing_reason: null,
            definition: "累積",
            measurement_kind: "snapshot",
            duration_seconds: null,
            external_post_id: "1",
            curve: [],
          },
        ],
      },
      store: { append: async (id, row) => saved.push(row) },
      now: "2026-10-30T00:00:00Z",
    });
    assert.deepEqual(
      results.map((r) => [r.window, r.status]),
      [
        ["day_end", "saved"],
        ["24h", "saved"],
      ],
    );
    assert.deepEqual(
      saved.map((r) => [r.window, r.metric_value]),
      [
        ["day_end", 12],
        ["24h", 12],
      ],
    );
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（fpDraft・otherDraft） */
export function runSnsFullPictureWindowsScenes1(env) {
  ({ fpDraft, otherDraft } = env);
  scene1();
}

function scene2() {
  test("取り込みの runner: 全貌の day_end の job は当日 23:00 の値を保存し、169 の前に作られた全貌の 48h の job は閉じる", async () => {
    const draft = { ...fpDraft, status: "posted" };
    const jobs = [
      {
        id: "j1",
        draft_id: draft.id,
        window: "day_end",
        source: "x-api",
        attempts: 0,
        channel: "x",
        draft,
        external_post_id: "100",
      },
      {
        id: "j2",
        draft_id: draft.id,
        window: "48h",
        source: "x-api",
        attempts: 0,
        channel: "x",
        draft,
        external_post_id: "100",
      },
    ];
    const appended = [];
    const finished = [];
    const notices = [];
    const now = new Date("2026-10-19T14:05:00Z");
    await runSnsMetrics(
      { mode: "live", now: () => now, shouldStop: () => false },
      {
        store: {
          dueJobs: async () => jobs,
          append: async (id, row) => appended.push(row),
          finish: async (id, state, reason) => finished.push([id, state, reason]),
          retry: async () => assert.fail("やり直さない"),
          reserveXRead: async () => true,
          hasValues: async () => false,
          recentOutcomes: async () => ({ done: 0, missing: 0, failed: 0 }),
        },
        readers: {
          x: async () => ({
            read: async () =>
              new Map([
                [
                  "100",
                  {
                    observedAt: now.toISOString(),
                    values: {
                      impressions: 50,
                      url_link_clicks: 1,
                      likes: 2,
                      shares: 0,
                      saves: 0,
                    },
                  },
                ],
              ]),
          }),
        },
        notify: async (t) => notices.push(t),
      },
    );
    assert.deepEqual(finished, [
      ["j2", "failed", "window_not_measured"],
      ["j1", "done", null],
    ]);
    assert.ok(
      appended.every(
        (r) =>
          r.window === "day_end" && r.period_end === "2026-10-19T14:00:00.000Z",
      ),
    );
    assert.equal(
      appended.find((r) => r.metric_name === "impressions").metric_value,
      50,
    );
    assert.equal(notices.length, 1);
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（fpDraft・otherDraft） */
export function runSnsFullPictureWindowsScenes2(env) {
  ({ fpDraft, otherDraft } = env);
  scene2();
}
