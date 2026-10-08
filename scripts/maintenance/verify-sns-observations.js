import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import {
  observationPeriod,
  validateObservation,
  compareObservations,
  buildObservationUtm,
  buildYoutubeProfileUtm,
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
// 窓不一致・遅延があっても不正入力を成功欠測へ変えない。
for (const timing of [
  { period_start: "2026-09-01T13:00:00Z" },
  { period_end: "2026-09-03T13:00:00Z" },
  { measurement_kind: "snapshot", observed_at: "2026-09-03T12:00:01Z" },
  { data_through: null },
]) {
  for (const invalid of [
    { metric_value: -1 },
    { metric_value: Infinity },
    { metric_value: "123" },
    {
      metric_name: "audienceWatchRatio",
      curve: [{ elapsed_ratio: 2, value: 0.5 }],
    },
    {
      metric_name: "audienceWatchRatio",
      curve: [{ elapsed_ratio: 0.5, value: -1 }],
    },
    { curve: [{ elapsed_ratio: 0.5, value: 0.5 }] },
    { missing_reason: "値ありには理由を付けない" },
    { metric_value: null, missing_reason: null },
  ]) {
    let appendCalls = 0;
    const rejected = await collectDueObservations({
      drafts: [draft],
      provider: {
        collect: async () => [base, { ...base, ...timing, ...invalid }],
      },
      store: {
        append: async () => {
          appendCalls++;
        },
      },
      now: period.period_end,
    });
    assert.equal(rejected[0].status, "failed");
    assert.equal(appendCalls, 0);
  }
}
let invalidPeriodAppendCalls = 0;
const invalidPeriod = await collectDueObservations({
  drafts: [draft],
  provider: { collect: async () => [{ ...base, period_start: "invalid" }] },
  store: {
    append: async () => {
      invalidPeriodAppendCalls++;
    },
  },
  now: period.period_end,
});
assert.equal(invalidPeriod[0].status, "failed");
assert.equal(invalidPeriodAppendCalls, 0);
const validOutput = [];
await collectDueObservations({
  drafts: [draft],
  provider: {
    collect: async () => [{ ...base, observed_at: "2026-09-03T12:00:01Z" }],
  },
  store: { append: async (d, o) => validOutput.push(o) },
  now: period.period_end,
});
assert.equal(validOutput[0].metric_value, 0);
assert.equal(validOutput[0].observed_at, "2026-09-03T12:00:01.000Z");
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

// プロフィールは投稿へ配賦せず、既存クエリ・fragmentを保持する。
const profileUrl = "https://www.boat-ai.jp/?tab=sonar&utm_source=old#top";
const profileEvidence = {
  url: profileUrl, confirmed_by: "owner", reference: "profile-release",
  confirmed_at: draft.posted_at,
};
const profile = buildYoutubeProfileUtm({ destinationUrl: profileUrl, releaseEvidence: profileEvidence });
const parsedProfile = new URL(profile.url);
for (const [key, value] of Object.entries({ utm_source: "youtube", utm_medium: "social", utm_campaign: "profile", utm_content: "profile" })) {
  assert.equal(parsedProfile.searchParams.get(key), value);
  assert.equal(profile[key], value);
}
assert.equal(parsedProfile.searchParams.get("tab"), "sonar");
assert.equal(parsedProfile.hash, "#top");
assert.equal(Object.hasOwn(profile, "draft_id"), false);
assert.throws(() => buildYoutubeProfileUtm({ destinationUrl: profileUrl }));
assert.throws(() => buildYoutubeProfileUtm({ destinationUrl: profileUrl, releaseEvidence: { ...profileEvidence, url: raceUrl } }));
assert.throws(() => buildYoutubeProfileUtm({ destinationUrl: profileUrl, releaseEvidence: { ...profileEvidence, confirmed_at: "invalid" } }));
for (const bad of ["https://example.com/", "http://www.boat-ai.jp/", "https://user:pass@www.boat-ai.jp/"]) {
  assert.throws(() => buildYoutubeProfileUtm({ destinationUrl: bad, releaseEvidence: { ...profileEvidence, url: bad } }));
}

// APIの1000件上限と失敗をモックで再現。ネットワークへ出ない。
const originalFetch = globalThis.fetch;
try {
  const cutoff = "2026-10-07T00:00:00Z";
  const data = Array.from({ length: 1201 }, (_, i) => ({
    id: String(i + 1).padStart(6, "0"),
    created_at: "2026-10-06T00:00:00Z",
  }));
  let calls = 0;
  globalThis.fetch = async (url) => {
    const query = new URL(url, "https://mock.invalid").searchParams;
    assert.equal(query.has("offset"), false);
    assert.equal(query.get("created_at"), `lte.${cutoff}`);
    if (++calls === 2) {
      // 既読範囲・未読範囲の両方へ追記。今回の集合には含めない。
      data.push({ id: "000000", created_at: "2026-10-08T00:00:00Z" });
      data.push({ id: "999999", created_at: "2026-10-08T00:00:00Z" });
    }
    const cursor = query.get("id")?.slice(3) ?? "";
    return Response.json(
      data
        .filter((row) => row.created_at <= cutoff && row.id > cursor)
        .sort((a, b) => a.id.localeCompare(b.id))
        .slice(0, 500),
    );
  };
  const pages = await readObservationPages(
    "sns_metric_observations",
    {},
    cutoff,
  );
  assert.equal(pages.length, 1201);
  assert.equal(new Set(pages.map((row) => row.id)).size, 1201);
  assert.equal(pages.at(-1).id, "001201");
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
