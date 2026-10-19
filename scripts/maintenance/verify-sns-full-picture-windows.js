// 全貌動画（format=full_picture）の測り時（当日 JST 23:00・投稿の24時間後、2026-10-19 オーナー決定、SQL167）の再現テスト。
// SQL154・167 を PGlite に入れる。外部接続なし。
import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { createXSnapshot } from "../../api/_lib/snsXSend.js";
import {
  compareObservations,
  displayWindowFor,
  observationPeriod,
  validateObservation,
  windowsFor,
} from "../../src/utils/snsObservations.js";
import { buildObservationCsvRows } from "../../src/utils/snsObservationCsv.js";
import { collectDueObservations } from "../lib/snsObservationCollector.js";
import { runSnsMetrics } from "../lib/snsMetricsRunner.js";

const db = new PGlite();
const first = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const all = async (sql, args = []) => (await db.query(sql, args)).rows;
const loadMedia = async () => new Uint8Array([1, 2, 3]);
let me;

before(async () => {
  await db.exec(
    "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;",
  );
  await db.exec(
    "CREATE TABLE scrape_job_state(job TEXT PRIMARY KEY, mode TEXT NOT NULL DEFAULT 'off');",
  );
  for (const file of [
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
    "153_sns_auto_send.sql",
    "154_sns_tokens_metric_jobs.sql",
    "167_sns_full_picture_metric_windows.sql",
  ])
    await db.exec(
      await readFile(
        new URL("../../docs/db-migration/" + file, import.meta.url),
        "utf8",
      ),
    );
  me = (await first("SELECT id FROM sns_approvers WHERE display_name='本人'"))
    .id;
});
beforeEach(() =>
  db.exec(
    "DELETE FROM sns_metric_observations; DELETE FROM sns_metric_jobs; DELETE FROM sns_x_send_jobs; DELETE FROM sns_drafts;",
  ),
);
after(() => db.close());

// 承認して job を作り、投稿の時刻を固定して posted にする（154・164 のトリガーが取り込みの job を作る）
async function posted(format, postedAt, platform = "x") {
  const deadline = new Date(Date.now() + 2 * 3600000).toISOString();
  const draft = await first(
    "INSERT INTO sns_drafts(content_group_id,format,platform,language,title,caption_text,video_storage_path,source_data) VALUES(gen_random_uuid(),$1,$2,'ja','全貌','本文','v.mp4',$3) RETURNING *",
    [
      format,
      platform,
      {
        deadline_queue: {
          deadline_at: deadline,
          expires_at: new Date(Date.parse(deadline) - 1800000).toISOString(),
          source_revision: "r1",
          source_observed_at: new Date().toISOString(),
          youtube_mode: "immediate",
        },
      },
    ],
  );
  const job = (
    await first("SELECT approve_sns_x_send($1,$2,$3,$4) r", [
      draft.id,
      me,
      await createXSnapshot(draft, loadMedia),
      new Date(Date.now() - 60000).toISOString(),
    ])
  ).r;
  await db.query(
    "UPDATE sns_x_send_jobs SET state='posted', posted_at=$2, external_post_id=$3 WHERE id=$1",
    [job.id, postedAt, String(Math.floor(Math.random() * 1e15))],
  );
  return draft.id;
}
const jobsOf = async (draftId) =>
  (
    await all(
      `SELECT "window" w, due_at FROM sns_metric_jobs WHERE draft_id=$1 ORDER BY due_at`,
      [draftId],
    )
  ).map((j) => [j.w, j.due_at.toISOString()]);

test("全貌は day_end（投稿日の JST 23:00）と 24h の job、それ以外は今までどおり 48h・7d", async () => {
  // 2026-10-19 19:30 JST に投稿
  const fp = await posted("full_picture", "2026-10-19T10:30:00Z");
  assert.deepEqual(await jobsOf(fp), [
    ["day_end", "2026-10-19T14:00:00.000Z"],
    ["24h", "2026-10-20T10:30:00.000Z"],
  ]);
  const other = await posted("today_digest", "2026-10-19T10:30:00Z");
  assert.deepEqual(await jobsOf(other), [
    ["48h", "2026-10-21T10:30:00.000Z"],
    ["7d", "2026-10-26T10:30:00.000Z"],
  ]);
});

test("JST 23:00 を過ぎてから投稿された全貌は 24h だけ（day_end を作らない）、日付は JST で数える", async () => {
  // 2026-10-19 23:10 JST（UTC では同じ 10/19）
  const late = await posted("full_picture", "2026-10-19T14:10:00Z");
  assert.deepEqual(await jobsOf(late), [["24h", "2026-10-20T14:10:00.000Z"]]);
  // 2026-10-20 00:30 JST（UTC では 10/19）→ 当日は JST の 10/20、23:00 は 10/20 14:00Z
  const early = await posted("full_picture", "2026-10-19T15:30:00Z");
  assert.deepEqual(await jobsOf(early), [
    ["day_end", "2026-10-20T14:00:00.000Z"],
    ["24h", "2026-10-20T15:30:00.000Z"],
  ]);
});

test("観測の表の CHECK: day_end は投稿日の JST 23:00 だけ、24h は24時間、窓の名前は4つだけ", async () => {
  const id = await posted("full_picture", "2026-10-19T10:30:00Z");
  await db.query(
    "UPDATE sns_drafts SET status='posted', posted_at=$2 WHERE id=$1",
    [id, "2026-10-19T10:30:00Z"],
  );
  const append = (window, periodEnd, observedAt = periodEnd) =>
    db.query("SELECT append_sns_metric_observation($1,$2)", [
      id,
      {
        window,
        observed_at: observedAt,
        period_start: "2026-10-19T10:30:00Z",
        period_end: periodEnd,
        data_through: observedAt,
        source: "x-api",
        metric_name: "impressions",
        metric_value: 10,
        definition: "累積",
        measurement_kind: "snapshot",
      },
    ]);
  await append("day_end", "2026-10-19T14:00:00Z");
  await append("24h", "2026-10-20T10:30:00Z");
  await assert.rejects(append("day_end", "2026-10-20T14:00:00Z"), /check/i);
  await assert.rejects(append("24h", "2026-10-21T10:30:00Z"), /check/i);
  await assert.rejects(append("12h", "2026-10-19T22:30:00Z"), /check/i);
  // 48h・7d の規則は今までどおり
  await append("48h", "2026-10-21T10:30:00Z");
});

const fpDraft = {
  id: "00000000-0000-4000-8000-0000000000f1",
  status: "posted",
  posted_at: "2026-10-19T10:30:00Z",
  platform: "x",
  language: "ja",
  format: "full_picture",
  template_variant_id: null,
};
const otherDraft = {
  ...fpDraft,
  id: "00000000-0000-4000-8000-0000000000a1",
  format: "today_digest",
  template_variant_id: "v1",
};

test("JS の窓: 全貌は day_end・24h、23:00 を過ぎた投稿は 24h だけ、それ以外は 48h・7d", () => {
  assert.deepEqual(windowsFor(fpDraft), ["day_end", "24h"]);
  assert.deepEqual(
    windowsFor({ ...fpDraft, posted_at: "2026-10-19T14:10:00Z" }),
    ["24h"],
  );
  assert.deepEqual(windowsFor(otherDraft), ["48h", "7d"]);
  assert.deepEqual(observationPeriod(fpDraft.posted_at, "day_end"), {
    period_start: "2026-10-19T10:30:00.000Z",
    period_end: "2026-10-19T14:00:00.000Z",
  });
  assert.equal(
    observationPeriod(fpDraft.posted_at, "24h").period_end,
    "2026-10-20T10:30:00.000Z",
  );
  assert.throws(
    () => observationPeriod("2026-10-19T14:10:00Z", "day_end"),
    /23時を過ぎた/,
  );
  // 全貌に 48h の観測は入れられない、全貌以外に day_end も入れられない
  const obs = (window, draft) => {
    const p = observationPeriod(draft.posted_at, window);
    return {
      window,
      ...p,
      observed_at: p.period_end,
      data_through: p.period_end,
      source: "x-api",
      metric_name: "impressions",
      metric_value: 5,
      missing_reason: null,
      definition: "累積",
      measurement_kind: "snapshot",
      duration_seconds: null,
      external_post_id: "1",
      curve: [],
    };
  };
  assert.equal(
    validateObservation(obs("day_end", fpDraft), fpDraft).metric_value,
    5,
  );
  assert.throws(
    () => validateObservation(obs("48h", fpDraft), fpDraft),
    /測らない観測窓/,
  );
  assert.throws(
    () => validateObservation(obs("day_end", otherDraft), otherDraft),
    /測らない観測窓/,
  );
});

test("画面: 既定の 48h で開くと全貌は当日の値、7d には全貌を出さない、day_end・24h は全貌だけ", () => {
  assert.equal(displayWindowFor(fpDraft, "48h"), "day_end");
  assert.equal(displayWindowFor(fpDraft, "7d"), null);
  assert.equal(displayWindowFor(fpDraft, "24h"), "24h");
  assert.equal(displayWindowFor(otherDraft, "48h"), "48h");
  assert.equal(displayWindowFor(otherDraft, "day_end"), null);
  // 23:00 を過ぎて投稿された全貌は day_end を持たないので、既定の 48h では 24h を出す（審査 P3-2）
  assert.equal(
    displayWindowFor({ ...fpDraft, posted_at: "2026-10-19T14:10:00Z" }, "48h"),
    "24h",
  );
  const rows = [
    {
      draft_id: fpDraft.id,
      window: "day_end",
      metric_name: "impressions",
      source: "x-api",
      definition: "累積",
      measurement_kind: "snapshot",
      revision: 1,
      metric_value: 40,
      missing_reason: null,
    },
    {
      draft_id: fpDraft.id,
      window: "48h",
      metric_name: "impressions",
      source: "x-api",
      definition: "累積",
      measurement_kind: "snapshot",
      revision: 1,
      metric_value: 999,
      missing_reason: null,
    },
    {
      draft_id: otherDraft.id,
      window: "48h",
      metric_name: "impressions",
      source: "x-api",
      definition: "累積",
      measurement_kind: "snapshot",
      revision: 1,
      metric_value: 70,
      missing_reason: null,
    },
  ];
  const now = Date.parse("2026-10-30T00:00:00Z");
  const at48 = compareObservations([fpDraft, otherDraft], rows, {
    window: "48h",
    metric: "impressions",
    now,
  });
  assert.deepEqual(at48.map((g) => [g.format, g.window, g.values]).sort(), [
    ["full_picture", "day_end", [40]],
    ["today_digest", "48h", [70]],
  ]);
  const at7d = compareObservations([fpDraft, otherDraft], rows, {
    window: "7d",
    metric: "impressions",
    now,
  });
  assert.ok(at7d.every((g) => g.format !== "full_picture"));
});

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

test("167-runbook.md の1回で貼る SQL: 154 の状態から通り、実行後の確認が全部 true", async () => {
  const fresh = new PGlite();
  try {
    await fresh.exec(
      "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE TABLE scrape_job_state(job TEXT PRIMARY KEY, mode TEXT NOT NULL DEFAULT 'off');",
    );
    for (const file of [
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
      "153_sns_auto_send.sql",
      "154_sns_tokens_metric_jobs.sql",
    ])
      await fresh.exec(
        await readFile(
          new URL("../../docs/db-migration/" + file, import.meta.url),
          "utf8",
        ),
      );
    const md = await readFile(
      new URL("../../docs/db-migration/167-runbook.md", import.meta.url),
      "utf8",
    );
    const sql = md.slice(
      md.indexOf("```sql") + 6,
      md.indexOf("```", md.indexOf("```sql") + 6),
    );
    const result = await fresh.exec(sql);
    assert.deepEqual(result.at(-1).rows[0], {
      trigger_fn_ok: true,
      jobs_window_ok: true,
      obs_window_ok: true,
      period_end_ok: true,
      old_check_dropped: true,
      jobs: 0,
      old_windows_on_full_picture: 0,
    });
    // 2回目は実行前の確認で止まる（関数が置き換わっているので）
    await assert.rejects(fresh.exec(sql), /154 の定義と違う/);
  } finally {
    await fresh.close();
  }
});

test("取り込みの runner: 全貌の day_end の job は当日 23:00 の値を保存し、167 の前に作られた全貌の 48h の job は閉じる", async () => {
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
