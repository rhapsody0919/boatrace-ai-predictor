// X の親の投稿の UTM（sns-pdca-loop tasks 23）の再現テスト。SQL154 までを PGlite に入れ、保存は fetch を PGlite へつなぐ。外部接続なし。
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { buildObservationUtm } from "../../src/utils/snsObservations.js";
import {
  createPostTrackingStore,
  insertTrackingUrl,
  prepareRaceTracking,
} from "../lib/snsPostTracking.js";

const db = new PGlite();
const first = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const raceUrl = "https://www.boat-ai.jp/race/202610130101";
const evidence = {
  url: raceUrl,
  confirmed_by: "auto-plan",
  reference: "headless:race-detail",
  confirmed_at: "2026-10-13T00:00:00Z",
};

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
  ])
    await db.exec(
      await readFile(
        new URL("../../docs/db-migration/" + file, import.meta.url),
        "utf8",
      ),
    );
});
after(() => db.close());

const newDraft = () =>
  first(
    "INSERT INTO sns_drafts(content_group_id,format,platform,language,title,caption_text) VALUES(gen_random_uuid(),'short','x','ja','全貌','本文') RETURNING id",
  );

// PostgREST の POST（ignore-duplicates）と GET を、PGlite の SQL で受ける
const pgFetch = async (url, init = {}) => {
  const u = new URL(url);
  if (init.method === "POST") {
    assert.equal(u.searchParams.get("on_conflict"), "draft_id");
    assert.equal(init.headers.Prefer, "resolution=ignore-duplicates");
    const row = JSON.parse(init.body);
    const columns = Object.keys(row);
    await db.query(
      `INSERT INTO sns_post_tracking(${columns.join(",")}) VALUES(${columns.map((_, i) => `$${i + 1}`).join(",")}) ON CONFLICT (draft_id) DO NOTHING`,
      columns.map((c) => row[c]),
    );
    return new Response(null, { status: 201 });
  }
  const id = u.searchParams.get("draft_id").replace(/^eq\./, "");
  return Response.json(
    (
      await db.query(
        "SELECT tracking_url FROM sns_post_tracking WHERE draft_id=$1",
        [id],
      )
    ).rows,
  );
};

test("race-full: 型の版が無くても作れ、utm_content は下書きの ID", () => {
  const t = buildObservationUtm({
    raceUrl,
    draftId: "d1",
    releaseEvidence: evidence,
    campaign: "race-full",
  });
  const u = new URL(t.tracking_url);
  assert.equal(u.origin + u.pathname, raceUrl);
  assert.equal(u.searchParams.get("utm_campaign"), "race-full");
  assert.equal(u.searchParams.get("utm_content"), "d1");
  assert.equal(t.template_variant_id, null);
  // sonar-preview は今までどおり型の版が必須、許可の無い campaign・クエリつきの URL は作らない
  assert.throws(() =>
    buildObservationUtm({ raceUrl, draftId: "d1", releaseEvidence: evidence }),
  );
  assert.throws(() =>
    buildObservationUtm({
      raceUrl,
      draftId: "d1",
      releaseEvidence: evidence,
      campaign: "today_digest",
    }),
  );
  const withQuery = `${raceUrl}?tab=sonar`;
  assert.throws(() =>
    buildObservationUtm({
      raceUrl: withQuery,
      draftId: "d1",
      releaseEvidence: { ...evidence, url: withQuery },
      campaign: "race-full",
    }),
  );
});

test("本文の URL をちょうど1か所差し替える（句点・改行の直前も URL の終わり）", () => {
  const tracking = `${raceUrl}?utm_source=x`;
  assert.equal(
    insertTrackingUrl(`見どころ ${raceUrl}。`, raceUrl, tracking),
    `見どころ ${tracking}。`,
  );
  assert.equal(
    insertTrackingUrl(`${raceUrl}\n#ボートレース`, raceUrl, tracking),
    `${tracking}\n#ボートレース`,
  );
  // 差し替え済みならそのまま（auto-plan のやり直し）
  assert.equal(
    insertTrackingUrl(`見どころ ${tracking}`, raceUrl, tracking),
    `見どころ ${tracking}`,
  );
  assert.throws(
    () => insertTrackingUrl(`${tracking} と ${raceUrl}`, raceUrl, tracking),
    /race_url_ambiguous/,
  );
  assert.throws(
    () => insertTrackingUrl("URL なし", raceUrl, tracking),
    /race_url_missing/,
  );
  assert.throws(
    () => insertTrackingUrl(`${raceUrl} と ${raceUrl}`, raceUrl, tracking),
    /race_url_ambiguous/,
  );
  // 別のレース（番号が続く）・別のクエリつきの URL は差し替えない
  assert.throws(
    () => insertTrackingUrl(`${raceUrl}2 です`, raceUrl, tracking),
    /race_url_missing/,
  );
  assert.throws(
    () =>
      insertTrackingUrl(`${raceUrl}?tab=x と ${raceUrl}`, raceUrl, tracking),
    /race_url_ambiguous/,
  );
});

test("X のスレッドの親だけが対象で、子・YouTube は null", () => {
  const draft = {
    id: "d1",
    platform: "x",
    thread_index: 0,
    caption_text: `見どころ ${raceUrl}`,
  };
  const prepared = prepareRaceTracking({
    draft,
    raceUrl,
    releaseEvidence: evidence,
  });
  assert.equal(prepared.text, `見どころ ${prepared.tracking.tracking_url}`);
  assert.equal(
    prepareRaceTracking({
      draft: { ...draft, thread_index: 1 },
      raceUrl,
      releaseEvidence: evidence,
    }),
    null,
  );
  assert.equal(
    prepareRaceTracking({
      draft: { ...draft, platform: "youtube" },
      raceUrl,
      releaseEvidence: evidence,
    }),
    null,
  );
});

test("sns_post_tracking に race-full・型の版なしで保存でき（SQL154）、やり直しは同じ URL なら成功・違えば投げる", async () => {
  const { id } = await newDraft();
  const { tracking } = prepareRaceTracking({
    draft: {
      id,
      platform: "x",
      thread_index: 0,
      caption_text: `見どころ ${raceUrl}`,
    },
    raceUrl,
    releaseEvidence: evidence,
  });
  const store = createPostTrackingStore({
    url: "https://db",
    key: "k",
    fetchImpl: pgFetch,
  });
  await store.save(tracking);
  await store.save(tracking);
  const row = await first("SELECT * FROM sns_post_tracking WHERE draft_id=$1", [
    id,
  ]);
  assert.equal(row.utm_campaign, "race-full");
  assert.equal(row.template_variant_id, null);
  assert.equal(row.utm_content, id);
  assert.equal(row.tracking_url, tracking.tracking_url);
  const other = buildObservationUtm({
    raceUrl: "https://www.boat-ai.jp/race/202610130102",
    draftId: id,
    releaseEvidence: {
      ...evidence,
      url: "https://www.boat-ai.jp/race/202610130102",
    },
    campaign: "race-full",
  });
  await assert.rejects(store.save(other), /tracking_url_conflict/);
});
