/**
 * verify-sns-observations.js の後半の場面（1/3）。verify ではない。
 * 判定と期待値は分ける前の verify-sns-observations.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import assert from "node:assert/strict";
import { buildObservationUtm, buildYoutubeProfileUtm } from "../../../src/utils/snsObservations.js";
import { collectDueObservations } from "../../lib/snsObservationCollector.js";
import { readObservationPages } from "../../../api/admin/sns-hub/observations.js";
import { buildObservationCsvRows } from "../../../src/utils/snsObservationCsv.js";

let id, draft, period, base, row;
let invalidPeriod, tracking, profileEvidence, profile, parsedProfile;
export let originalFetch, exportDraft, options, exports;

export let invalidPeriodAppendCalls = 0;

const validOutput = [];

const raceUrl = "https://www.boat-ai.jp/race/202609010101";

// プロフィールは投稿へ配賦せず、既存クエリ・fragmentを保持する。
const profileUrl = "https://www.boat-ai.jp/?tab=sonar&utm_source=old#top";

async function scene1() {
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
  invalidPeriod = await collectDueObservations({
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
}

/** verify から呼ぶ入口。env は verify 側の束縛（id・draft・period・base・row） */
export async function runSnsObservationsScenes1(env) {
  ({ id, draft, period, base, row } = env);
  await scene1();
}

async function scene2() {
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
  assert.throws(() =>
    buildObservationUtm({ raceUrl, draftId: id, variantId: "variant-a" }),
  );
  tracking = buildObservationUtm({
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
  profileEvidence = {
    url: profileUrl,
    confirmed_by: "owner",
    reference: "profile-release",
    confirmed_at: draft.posted_at,
  };
  profile = buildYoutubeProfileUtm({
    destinationUrl: profileUrl,
    releaseEvidence: profileEvidence,
  });
  parsedProfile = new URL(profile.url);
  for (const [key, value] of Object.entries({
    utm_source: "youtube",
    utm_medium: "social",
    utm_campaign: "profile",
    utm_content: "profile",
  })) {
    assert.equal(parsedProfile.searchParams.get(key), value);
    assert.equal(profile[key], value);
  }
  assert.equal(parsedProfile.searchParams.get("tab"), "sonar");
  assert.equal(parsedProfile.hash, "#top");
  assert.equal(Object.hasOwn(profile, "draft_id"), false);
  assert.throws(() => buildYoutubeProfileUtm({ destinationUrl: profileUrl }));
  assert.throws(() =>
    buildYoutubeProfileUtm({
      destinationUrl: profileUrl,
      releaseEvidence: { ...profileEvidence, url: raceUrl },
    }),
  );
  assert.throws(() =>
    buildYoutubeProfileUtm({
      destinationUrl: profileUrl,
      releaseEvidence: { ...profileEvidence, confirmed_at: "invalid" },
    }),
  );
  for (const bad of [
    "https://example.com/",
    "http://www.boat-ai.jp/",
    "https://user:pass@www.boat-ai.jp/",
  ]) {
    assert.throws(() =>
      buildYoutubeProfileUtm({
        destinationUrl: bad,
        releaseEvidence: { ...profileEvidence, url: bad },
      }),
    );
  }
  // APIの1000件上限と失敗をモックで再現。ネットワークへ出ない。
  originalFetch = globalThis.fetch;
}

async function scene3() {
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
  // CSV: 最新観測日時を指標ごとに採用。ゼロ・欠測・異なる取得元を区別。
  exportDraft = {
    ...draft,
    platform: "x",
    source_data: { race_id: "race-1" },
  };
  options = {
    start: "2026-09-01",
    end: "2026-09-01",
    platform: "all",
    now: Date.parse("2026-09-10T00:00:00Z"),
  };
  exports = buildObservationCsvRows(
    [exportDraft],
    [
      row({
        id: "a",
        metric_name: "url_link_clicks",
        revision: 9,
        metric_value: 99,
      }),
      row({
        id: "b",
        metric_name: "url_link_clicks",
        revision: 1,
        metric_value: 0,
        source: "csv",
        observed_at: "2026-09-04T12:00:00Z",
        definition: 'clicks,"raw"\nline',
      }),
      row({ id: "c", metric_name: "impressions", metric_value: 100 }),
      row({
        id: "d",
        metric_name: "views",
        metric_value: null,
        missing_reason: "遅延",
        data_through: null,
      }),
      row({ id: "e", source: "mock", metric_value: 999 }),
    ],
    options,
  );
}

/** verify から呼ぶ入口。env は verify 側の束縛（id・draft・period・base・row） */
export async function runSnsObservationsScenes2(env) {
  ({ id, draft, period, base, row } = env);
  await scene2();
  await scene3();
}
