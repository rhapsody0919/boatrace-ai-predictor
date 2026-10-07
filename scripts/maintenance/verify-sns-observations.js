import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import {
  observationPeriod,
  validateObservation,
  compareObservations,
  buildObservationUtm,
} from "../../src/utils/snsObservations.js";
import {
  collectDueObservations,
  mockObservationProvider,
} from "../lib/snsObservationCollector.js";
import { readObservationPages } from "../../api/admin/sns-hub/observations.js";

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
const raceUrl = "https://www.boat-ai.jp/race/202609010101";
assert.throws(() =>
  buildObservationUtm({ raceUrl, draftId: id, variantId: "variant-a" }),
);
const tracking = buildObservationUtm({
  raceUrl,
  draftId: id,
  variantId: "variant-a",
  releaseEvidence: {
    url: raceUrl,
    confirmed_by: "owner",
    reference: "release-record",
    confirmed_at: draft.posted_at,
  },
});
assert.equal(
  new URL(tracking.url).searchParams.get("utm_content"),
  `${id}/variant-a`,
);
assert.equal(
  new URL(tracking.url).searchParams.get("utm_campaign"),
  "sonar-preview",
);

// APIの1000件上限と失敗をモックで再現。ネットワークへ出ない。
const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = async (url) => {
    const offset = Number(
      new URL(url, "https://mock.invalid").searchParams.get("offset"),
    );
    return Response.json(
      Array.from({ length: Math.min(500, 1201 - offset) }, (_, i) => ({
        id: offset + i,
      })),
    );
  };
  assert.equal(
    (await readObservationPages("sns_metric_observations", {})).length,
    1201,
  );
  globalThis.fetch = async () => new Response("", { status: 500 });
  await assert.rejects(readObservationPages("sns_metric_observations", {}));
} finally {
  globalThis.fetch = originalFetch;
}

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
console.log(
  "SNS observations: contract, comparison, collector, UTM, pagination, SQL history/RLS PASS",
);
