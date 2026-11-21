import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import {
  observationPeriod,
  validateObservation,
  compareObservations,
  WINDOW_LABELS,
} from "../../src/utils/snsObservations.js";
import {
  collectDueObservations,
  mockObservationProvider,
} from "../lib/snsObservationCollector.js";





import {
  invalidPeriodAppendCalls,
  runSnsObservationsScenes1,
  runSnsObservationsScenes2,
} from "./verifyData/sns-observations-scenes-1.js";
import { runSnsObservationsScenes3 } from "./verifyData/sns-observations-scenes-2.js";
import { runSnsObservationsScenes4, runSnsObservationsScenes5 } from "./verifyData/sns-observations-scenes-3.js";
import { mustReplace } from "./verifyData/must-replace.js";

const id = "00000000-0000-4000-8000-000000000001";
const draft = {
  id,
  status: "posted",
  posted_at: "2026-09-01T12:00:00Z",
  platform: "youtube",
  language: "ja",
  format: "preview",
  template_variant_id: "variant-a",
};
const period = observationPeriod(draft.posted_at, "48h");
const base = {
  window: "48h",
  ...period,
  observed_at: period.period_end,
  data_through: period.period_end,
  metric_name: "views",
  metric_value: 0,
  missing_reason: null,
  source: "manual",
  definition: "views-v1",
  measurement_kind: "period",
  duration_seconds: 18,
  external_post_id: "video-id",
  curve: [],
};
assert.equal(validateObservation(base, draft).metric_value, 0);
for (const edit of [
  { metric_value: null },
  { metric_value: Infinity },
  { metric_value: "0" },
  { metric_value: -1 },
  { data_through: null },
  { period_start: "2026-09-01T13:00:00Z" },
  { observed_at: draft.posted_at },
  { measurement_kind: "snapshot", observed_at: "2026-09-04T12:00:00Z" },
  { curve: [{ elapsed_ratio: 2, value: 0.5 }] },
])
  assert.throws(() => validateObservation({ ...base, ...edit }, draft));
assert.throws(() =>
  validateObservation(base, { ...draft, status: "pending_review" }),
);
// 累積値は窓の終わりから15分以内なら保存でき、data_through は取得時刻（SQL154、2026-10-13 決定）
const snapshotAt = (minutes) => {
  const observed = new Date(
    Date.parse(period.period_end) + minutes * 60000,
  ).toISOString();
  return {
    ...base,
    measurement_kind: "snapshot",
    observed_at: observed,
    data_through: observed,
  };
};
assert.equal(validateObservation(snapshotAt(15), draft).metric_value, 0);
assert.throws(() => validateObservation(snapshotAt(15.1), draft));
assert.throws(() =>
  validateObservation(
    { ...snapshotAt(5), data_through: period.period_end },
    draft,
  ),
);
assert.equal(
  validateObservation(
    {
      ...base,
      metric_value: null,
      missing_reason: "反映遅れ",
      data_through: draft.posted_at,
    },
    draft,
  ).metric_value,
  null,
);
const row = (edit = {}) => ({ ...base, draft_id: id, revision: 1, ...edit });
const compare = (rows, drafts = [draft]) =>
  compareObservations(drafts, rows, {
    window: "48h",
    metric: "views",
    now: Date.parse("2026-09-10T12:00:00Z"),
  });
assert.equal(
  compare([
    row(),
    row({ revision: 2, metric_value: null, missing_reason: "反映遅れ" }),
  ])[0].median,
  null,
);
assert.equal(
  compare([row({ window: "7d", metric_value: 100 })])[0].median,
  null,
);
assert.equal(compare([row({ source: "mock" })])[0].source, "未収集");
assert.equal(compare([row(), row({ source: "youtube-data" })]).length, 2);
assert.equal(
  compare([row()], [{ ...draft, template_variant_id: null }])[0].median,
  null,
);
const ten = Array.from({ length: 10 }, (_, i) => ({
  ...draft,
  id: `draft-${i}`,
}));
const tenRows = ten.map((d, i) => row({ draft_id: d.id, metric_value: i }));
assert.equal(compare(tenRows, ten)[0].median, 4.5);
assert.equal(compare(tenRows, ten)[0].provisional, false);
assert.equal(compare(tenRows.slice(1), ten)[0].provisional, true);
assert.equal(
  compareObservations([draft], [row()], {
    window: "48h",
    metric: "views",
    now: Date.parse(draft.posted_at),
  }).length,
  0,
);
// 運用していないチャネル（TikTok・blog・note）は「未収集」の組としても出さない（hq判断 2026-10-08）
for (const platform of ["tiktok", "blog", "note"])
  assert.equal(
    compareObservations([{ ...draft, platform }], [], {
      window: "48h",
      metric: "views",
      now: Date.parse(period.period_end) + 1,
    }).length,
    0,
  );
assert.equal(
  compareObservations([{ ...draft, platform: "x" }], [], {
    window: "48h",
    metric: "views",
    now: Date.parse(period.period_end) + 1,
  }).length,
  1,
);
assert.throws(() =>
  validateObservation({ ...base, denominator_value: 10 }, draft),
);
assert.equal(
  validateObservation(
    { ...base, denominator_name: "views", denominator_value: 10 },
    draft,
  ).denominator_value,
  10,
);
assert.equal(
  compare([
    row({ denominator_name: "views" }),
    row({ revision: 2, denominator_name: "engagedViews" }),
  ])[0].count,
  1,
);
// BOA-800: Xのクリック・impressionsは尺なしでも有効。動画の尺判定は維持する。
for (const metric of ["url_link_clicks", "impressions"]) {
  const options = { window: "48h", metric, now: Date.parse(period.period_end) + 1 };
  const input = row({ metric_name: metric, duration_seconds: null, metric_value: 12 });
  const xDraft = { ...draft, platform: "x" };
  const [x] = compareObservations([xDraft], [input], options);
  assert.deepEqual(x.values, [12]);
  assert.equal(x.missing["尺未確認"], undefined);
  assert.equal(x.median, 12);
  const [video] = compareObservations([draft], [input], options);
  assert.deepEqual(video.values, []);
  assert.equal(video.missing["尺未確認"], 1);
  assert.equal(video.median, null);
  // 尺の違いでXの同一系列を分割しない。
  const second = { ...xDraft, id: "x-second" };
  const combined = compareObservations([xDraft, second], [input,
    row({ ...input, draft_id: second.id, duration_seconds: 18, metric_value: 0 }),
  ], options);
  assert.equal(combined.length, 1);
  assert.deepEqual(combined[0].values, [0, 12]);
  assert.equal(combined[0].median, 6);
  assert.equal(compareObservations([{ ...xDraft, template_variant_id: null }],
    [input], options)[0].missing["型の版未確認"], 1);
  assert.equal(compareObservations([xDraft], [row({ ...input, source: "mock" })],
    options)[0].missing["未収集"], 1);
}
assert.equal(compare([row({ duration_seconds: null })],
  [{ ...draft, platform: "x" }])[0].missing["尺未確認"], 1);

// 実際のJSXを描画し、比較の見出しとX側の尺非表示を検査（取得はモック）。
{
  const { transform } = await import("esbuild");
  const React = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const metric = "url_link_clicks";
  const groups = compareObservations([draft, { ...draft, id: "x-ui", platform: "x" }],
    [row({ metric_name: metric }), row({ draft_id: "x-ui", metric_name: metric,
      duration_seconds: null, metric_value: 12 })],
    { window: "48h", metric, now: Date.parse(period.period_end) + 1 });
  let source = await fs.readFile(new URL(
    "../../src/pages/admin/sns-hub/MetricsTab.jsx", import.meta.url), "utf8");
  source = [
    [/import \{ useEffect, useState \} from "react";/,
      `import React from "${new URL("../../node_modules/react/index.js", import.meta.url).href}";
       const useEffect = () => {};
       const useState = (initial) => [typeof initial === "object"
         ? ${JSON.stringify({ loading: false, error: null, groups })}
         : initial === "views" ? "${metric}" : initial, () => {}];`],
    [/import \{ getMetricObservations \} from [^;]+;/,
      "const getMetricObservations = () => { throw new Error('取得禁止'); };"],
    [/import \{[^}]*\} from [^;]*snsObservations\.js";/,
      `const OBSERVATION_METRICS = ["${metric}"]; const FULL_PICTURE_FORMAT = "full_picture";
       const WINDOW_LABELS = ${JSON.stringify(WINDOW_LABELS)};`],
    [/import "\.\/MetricsTab\.css";/, ""],
    [/import ObservationCsvPanel from [^;]+;/,
      "const ObservationCsvPanel = () => null;"],
  ].reduce((s, [re, to]) => mustReplace(s, re, to), source);
  const { code } = await transform(source, { loader: "jsx", format: "esm" });
  const { default: MetricsTab } = await import(
    "data:text/javascript," + encodeURIComponent(code));
  const html = renderToStaticMarkup(React.createElement(MetricsTab));
  const sections = [...html.matchAll(/<section><h3>(.*?)<\/h3>([\s\S]*?)<\/section>/g)];
  assert.equal(sections.length, 2);
  assert.equal(sections[0][1], "X（リンククリック／impressions）");
  assert.doesNotMatch(sections[0][2], /尺:/);
  assert.match(sections[0][2], /中央値: 12/);
  assert.equal(sections[1][1], "YouTube（動画）");
  assert.match(sections[1][2], /尺: 18秒/);
}

let saved = [];
const result = await collectDueObservations({
  drafts: [draft],
  provider: mockObservationProvider,
  store: {
    append: async (draftId, observation) =>
      saved.push({ draftId, observation }),
  },
  now: period.period_end,
});
assert.equal(result.length, 1);
assert.equal(saved[0].observation.metric_value, null);
saved = [];
await collectDueObservations({
  drafts: [draft],
  provider: mockObservationProvider,
  store: { append: async (d, o) => saved.push(o) },
  completed: new Set([`${id}/48h`]),
  now: period.period_end,
});
assert.equal(saved.length, 0);
const failed = await collectDueObservations({
  drafts: [draft],
  provider: {
    collect: async () => {
      throw new Error("API未接続");
    },
  },
  store: { append: async () => assert.fail("保存しない") },
  now: period.period_end,
});
assert.equal(failed[0].status, "failed");
// 起動時刻は窓の終端でも、providerの遅い実測時刻を保持する。
for (const edit of [
  { measurement_kind: "snapshot", observed_at: "2026-09-03T12:00:01Z" },
  { period_start: "2026-09-01T13:00:00Z" },
  { period_end: "2026-09-03T13:00:00Z" },
  { data_through: null },
]) {
  const input = { ...base, metric_value: 123, ...edit };
  const output = [];
  const collected = await collectDueObservations({
    drafts: [draft],
    provider: { collect: async () => [input] },
    store: { append: async (d, o) => output.push(o) },
    now: period.period_end,
  });
  assert.equal(collected[0].status, "saved");
  assert.equal(output[0].metric_value, null);
  assert.equal(
    output[0].observed_at,
    new Date(input.observed_at).toISOString(),
  );
  assert.match(output[0].missing_reason, /provider/);
}

// ---- 後半の場面（verifyData/sns-observations-scenes-1.js） ----
await runSnsObservationsScenes1({ id, draft, period, base, row });
assert.equal(invalidPeriodAppendCalls, 0);

// ---- 後半の場面（verifyData/sns-observations-scenes-1.js・sns-observations-scenes-2.js） ----
await runSnsObservationsScenes2({ id, draft, period, base, row });
await runSnsObservationsScenes3({ draft, row });

// 管理API: importをローカルモックに置換し、認証/入力/全件取得を検証。
let handlerSource = await fs.readFile(
  new URL("../../api/admin/sns-hub/observations.js", import.meta.url),
  "utf8",
);
const mockHelpers =
  "data:text/javascript," +
  encodeURIComponent(`
  export const SUPABASE_URL="https://mock.invalid"; export const SUPABASE_SERVICE_KEY="fixture";
  export const jsonResponse=(b,status=200)=>Response.json(b,{status}); export const isConfigured=()=>true;
  export const isValidDraftId=()=>true; export const getDraftById=async()=>null;
  export const requireAdminAuth=async(req)=>req.headers.has("x-test-admin")?null:new Response("denied",{status:401});
`);
handlerSource = mustReplace(
  handlerSource,
  /"[^"\n]+_lib\/(snsHubHelpers|adminAuth)\.js"/g,
  JSON.stringify(mockHelpers),
);
handlerSource = mustReplace(
  handlerSource,
  /from (["'])(\.[^"'\n]+)\1/g,
  (_m, _q, spec) =>
    `from ${JSON.stringify(new URL(spec, new URL("../../api/admin/sns-hub/observations.js", import.meta.url)).href)}`,
);
const csvApi = (
  await import("data:text/javascript," + encodeURIComponent(handlerSource))
).default;

// ---- 後半の場面（verifyData/sns-observations-scenes-3.js） ----
await runSnsObservationsScenes4({ csvApi });

// ローカルPostgreSQL互換エンジンでSQL・履歴・欠測・RLS・権限を検証する。
const db = new PGlite();
try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE sns_drafts(id UUID PRIMARY KEY, status TEXT, posted_at TIMESTAMPTZ);
    CREATE TABLE sns_template_variants(id UUID PRIMARY KEY);
    INSERT INTO sns_drafts VALUES ('${id}', 'posted', '${draft.posted_at}');`);
  await db.exec(
    await fs.readFile(
      new URL(
        "../../docs/db-migration/136_sns_metric_observations.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const append = async (input) =>
    db.query(
      "SELECT * FROM append_sns_metric_observation($1::UUID, $2::JSONB)",
      [id, JSON.stringify(input)],
    );
  assert.equal((await append(base)).rows[0].revision, 1);
  assert.equal(
    (
      await append({
        ...base,
        metric_value: null,
        missing_reason: "反映遅れ",
        data_through: null,
      })
    ).rows[0].revision,
    2,
  );
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::INTEGER AS count FROM sns_metric_observations",
      )
    ).rows[0].count,
    2,
  );
  await assert.rejects(append({ ...base, metric_value: null }));
  await assert.rejects(
    append({ ...base, metric_value: 1, data_through: null }),
  );
  await assert.rejects(
    append({ ...base, period_start: "2026-09-02T12:00:00Z" }),
  );
  assert.equal(
    (
      await db.query(
        "SELECT relrowsecurity FROM pg_class WHERE relname='sns_metric_observations'",
      )
    ).rows[0].relrowsecurity,
    true,
  );
  assert.equal(
    (
      await db.query(
        "SELECT has_function_privilege('anon', 'append_sns_metric_observation(uuid,jsonb)', 'EXECUTE') AS allowed",
      )
    ).rows[0].allowed,
    false,
  );
  assert.equal(
    (
      await db.query(
        "SELECT has_table_privilege('authenticated', 'sns_metric_observations', 'SELECT') AS allowed",
      )
    ).rows[0].allowed,
    false,
  );
} finally {
  await db.close();
}

// ---- 後半の場面（verifyData/sns-observations-scenes-3.js） ----
await runSnsObservationsScenes5({ csvApi });
