/**
 * verify-sns-setsu-kiryoku-short.js の後半の場面（1/5）。verify ではない。
 * 判定と期待値は分ける前の verify-sns-setsu-kiryoku-short.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { pushSetsuKiryokuShort } from "../../sns/push-setsu-kiryoku-short.js";
import { createReadCurrent } from "../../../api/_lib/snsClaimCheck.js";
import { createMockHeadless, createDeadlinePreflight } from "../../../api/_lib/snsDeadlineQueue.js";
import { SCREEN_MARKERS } from "../../lib/snsScreenMarkers.js";

let BASE_FILES, MIGRATION, MIGRATION_201, MD5_182, MD5_188, MD5_189, MD5_153_X, sqlOf, md5, bodyOf, forTest, guardedForTest, db, first, all, riskRules, PUSHED_AT, VIDEO, bundle, storeSql;
export let store, readCurrent;

export const saved = [];

const storeHead = {
  controls: async () =>
    Object.fromEntries(
      (
        await all(
          "SELECT channel, mode, dry_run, auto_approver_id, setsu_kiryoku_short_enabled FROM sns_auto_send_control",
        )
      ).map((r) => [r.channel, r]),
    ),
  sendControl: () =>
    first(
      "SELECT daily_limit, daily_limit_youtube, daily_baseline_date::text, daily_external_count, expiry_minutes, max_source_age_seconds FROM sns_x_send_control",
    ),
  setsuItems: (date) =>
    all(
      "SELECT id, state, draft_id, race_id, variant, held_reason FROM sns_auto_send_items WHERE kind='setsu_kiryoku_short' AND race_id LIKE $1 ORDER BY created_at DESC",
      [`setsu:${date}:%`],
    ),
  finalItems: (key) =>
    all(
      "SELECT i.id, i.state, i.draft_id, i.race_id FROM sns_auto_send_items i JOIN sns_drafts d ON d.id=i.draft_id WHERE d.format='setsu_kiryoku_short' AND d.source_data->'setsu_kiryoku_short'->>'final_key'=$1",
      [key],
    ),
  jobForDraft: (draftId) =>
    first(
      "SELECT id, draft_id, state, error_code, scheduled_at::text, expires_at::text, posted_at, external_post_id, external_post_url FROM sns_x_send_jobs WHERE draft_id=$1",
      [draftId],
    ),
  jobsAttemptedOn: (day) =>
    all(
      "SELECT id, state, attempt_dates::text[] attempt_dates, attempt_channels FROM sns_x_send_jobs WHERE $1::date = ANY(attempt_dates)",
      [day],
    ),
  queuedYoutubeJobs: (now) =>
    all(
      "SELECT id, draft_id, scheduled_at::text FROM sns_x_send_jobs WHERE channel='youtube' AND state='queued' AND attempts=0 AND expires_at > $1",
      [now.toISOString()],
    ),
  quotaControl: () =>
    first(
      "SELECT verified, baseline_day::text, upload_limit, general_limit, external_uploads, external_general FROM sns_youtube_quota_control",
    ),
  quotaUsed: async (day) => {
    const a = await first(
      "SELECT coalesce(sum(upload_reserved),0)::int u, coalesce(sum(general_reserved),0)::int g FROM sns_youtube_quota_attempts WHERE quota_day=$1",
      [day],
    );
    const r = await first(
      "SELECT coalesce(sum(units),0)::int n FROM sns_youtube_quota_reads WHERE quota_day=$1",
      [day],
    );
    return { uploads: a.u, general: a.g + r.n };
  },
  raceStartTimes: async (date, venue, numbers) => numbers.map((n) => ({
    race_id: `${date}-${venue}-${String(n).padStart(2, "0")}`,
    start_time: ({ 11: "15:50:00", 10: "15:15:00", 6: "12:59:00" })[n],
  })),
  // 本番の createRestStore.finalRace と同じ形: R があればそのレースが優勝戦のときだけ、無ければ「優勝戦」の1件
  finalRace: async (date, venue, raceNumber = null) => {
    const final =
      raceNumber != null
        ? await first(
            "SELECT race_id FROM race_conditions WHERE race_id=$1 AND race_stage LIKE '%優勝戦%' AND race_stage NOT LIKE '%準優勝戦%'",
            [`${date}-${venue}-${String(raceNumber).padStart(2, "0")}`],
          )
        : await first(
            "SELECT race_id FROM race_conditions WHERE race_id LIKE $1 AND race_stage='優勝戦'",
            [`${date}-${venue}-%`],
          );
    if (!final) return null;
    const race = await first(
      "SELECT cancellation_status, start_time::text AS start_time FROM races WHERE race_id=$1",
      [final.race_id],
    );
    const absent = await first(
      "SELECT (SELECT count(*) FROM race_entries WHERE race_id=$1 AND is_absent) + (SELECT count(*) FROM exhibition_data WHERE race_id=$1 AND is_absent) n",
      [final.race_id],
    );
    return race
      ? {
          race_id: final.race_id,
          start_time: race.start_time,
          cancelled: race.cancellation_status != null,
          withdrawn: Number(absent.n) > 0,
        }
      : null;
  },
  saveFile: async (p, bytes) => saved.push([p, bytes.byteLength]),
};

export const push = (b = bundle(), opts = {}, video = VIDEO) => {
  const f = {
    "/f/bundle.json": new TextEncoder().encode(JSON.stringify(b)),
    ...(video ? { [`/f/${b.video ?? `${b.variant}.mp4`}`]: video } : {}),
  };
  const notes = [];
  return pushSetsuKiryokuShort("/f", {
    store,
    readBytes: async (p) => {
      if (!f[p]) throw Object.assign(new Error("no file"), { code: "ENOENT" });
      return f[p];
    },
    notify: async (text) => notes.push(text),
    riskRules,
    now: PUSHED_AT,
    ...opts,
  }).then((r) => ({ ...r, notes }));
};

export const transition = (jobId, action, result = {}) =>
  first("SELECT public.transition_sns_x_send($1,$2,$3::jsonb) r", [
    jobId,
    action,
    JSON.stringify(result),
  ]).then((row) => row.r);

export const counts = async () => ({
  drafts: Number((await first("SELECT count(*) n FROM sns_drafts")).n),
  items: Number((await first("SELECT count(*) n FROM sns_auto_send_items")).n),
  jobs: Number((await first("SELECT count(*) n FROM sns_x_send_jobs")).n),
  saved: saved.length,
});

export const NOTHING = { drafts: 0, items: 0, jobs: 0, saved: 0 };

export const theJob = () => first("SELECT * FROM sns_x_send_jobs");

/** 送り手の読み直し（readCurrent）に PGlite の行を渡す（PostgREST の path を読み分ける） */
const likeOf = (p) =>
  decodeURIComponent(p.match(/race_id=like\.([^&]+)/)[1]).replace("*", "%");

const idOf = (p) => decodeURIComponent(p.match(/race_id=eq\.([^&]+)/)[1]);

export const venueHeadless = () =>
  createMockHeadless({ visibleSelectors: SCREEN_MARKERS.venue });

export const preflightAt = (now, headless = venueHeadless()) =>
  createDeadlinePreflight({
    headless,
    markers: SCREEN_MARKERS,
    readCurrent,
    now: () => now.getTime(),
  });

function skst1Scene1() {
  before(async () => {
    await db.exec(
      "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;",
    );
    await db.exec(
      "CREATE TABLE test_clock(value timestamptz); INSERT INTO test_clock VALUES(NULL); CREATE FUNCTION test_now() RETURNS timestamptz LANGUAGE sql AS 'SELECT coalesce(value,now()) FROM test_clock';",
    );
    await db.exec(
      "CREATE TABLE scrape_job_state(job TEXT PRIMARY KEY, mode TEXT NOT NULL DEFAULT 'off' CHECK (mode IN ('off','shadow','live')));",
    );
    await db.exec(`
    CREATE TABLE races(race_id VARCHAR PRIMARY KEY, race_date DATE, start_time TIME, cancellation_status TEXT, race_grade VARCHAR, race_number SMALLINT);
    CREATE TABLE race_conditions(race_id VARCHAR PRIMARY KEY, race_stage VARCHAR);
    CREATE TABLE race_entries(race_id VARCHAR, is_absent BOOLEAN);
    CREATE TABLE exhibition_data(race_id VARCHAR, is_absent BOOLEAN);`);
    for (const [i, file] of BASE_FILES.entries()) {
      const before = BASE_FILES.slice(0, i);
      const text =
        file === "186_sns_youtube_close_private.sql"
          ? await guardedForTest(file, before, "transition_sns_x_send", MD5_153_X)
          : file === "188_sns_x_cost_by_url.sql"
            ? await guardedForTest(
                file,
                before,
                "transition_sns_send_139",
                MD5_182,
              )
            : file === "189_sns_today_thinking.sql"
              ? await guardedForTest(
                  file,
                  before,
                  "transition_sns_send_139",
                  MD5_188,
                )
              : forTest(await sqlOf(file));
      await db.exec(text);
    }
    await db.exec(
      await guardedForTest(
        MIGRATION,
        BASE_FILES,
        "transition_sns_send_139",
        MD5_189,
      ),
    );
    await db.exec(forTest(await sqlOf(MIGRATION_201)));
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（BASE_FILES・MIGRATION・MIGRATION_201・MD5_182・MD5_188・MD5_189・MD5_153_X・sqlOf・md5・bodyOf・forTest・guardedForTest・db・first・all・riskRules・PUSHED_AT・VIDEO・bundle） */
export function runSnsSetsuKiryokuShortScenes1(env) {
  ({ BASE_FILES, MIGRATION, MIGRATION_201, MD5_182, MD5_188, MD5_189, MD5_153_X, sqlOf, md5, bodyOf, forTest, guardedForTest, db, first, all, riskRules, PUSHED_AT, VIDEO, bundle } = env);
  skst1Scene1();
}

function skst1Scene2() {
  after(() => db.close());
}

/** verify から呼ぶ入口。env は verify 側の束縛（BASE_FILES・MIGRATION・MIGRATION_201・MD5_182・MD5_188・MD5_189・MD5_153_X・sqlOf・md5・bodyOf・forTest・guardedForTest・db・first・all・riskRules・PUSHED_AT・VIDEO・bundle） */
export function runSnsSetsuKiryokuShortScenes2(env) {
  ({ BASE_FILES, MIGRATION, MIGRATION_201, MD5_182, MD5_188, MD5_189, MD5_153_X, sqlOf, md5, bodyOf, forTest, guardedForTest, db, first, all, riskRules, PUSHED_AT, VIDEO, bundle } = env);
  skst1Scene2();
}

/** verify から呼ぶ入口。env は verify 側の束縛（BASE_FILES・MIGRATION・MIGRATION_201・MD5_182・MD5_188・MD5_189・MD5_153_X・sqlOf・md5・bodyOf・forTest・guardedForTest・db・first・all・riskRules・PUSHED_AT・VIDEO・bundle） */
export function runSnsSetsuKiryokuShortScenes3(env) {
  ({ BASE_FILES, MIGRATION, MIGRATION_201, MD5_182, MD5_188, MD5_189, MD5_153_X, sqlOf, md5, bodyOf, forTest, guardedForTest, db, first, all, riskRules, PUSHED_AT, VIDEO, bundle } = env);

}

function skst1Scene3() {
  store = { ...storeHead, ...storeSql };
  readCurrent = createReadCurrent({
    db: async (p) => {
      const table = p.split("?")[0];
      const draftId = p.match(/(?:^|[?&])(?:id|draft_id)=eq\.([0-9a-f-]+)/)?.[1];
      if (table === "sns_drafts")
        return all(
          "SELECT bundle_import_id, source_data FROM sns_drafts WHERE id=$1",
          [draftId],
        );
      if (table === "sns_auto_send_items" && p.includes("state=eq.sent"))
        return all(
          "SELECT id FROM sns_auto_send_items WHERE kind='setsu_kiryoku_short' AND channel='youtube' AND race_id LIKE $1 AND variant=$2 AND state='sent'",
          [likeOf(p), p.match(/variant=eq\.([a-z_]+)/)[1]],
        );
      if (table === "sns_auto_send_items")
        return all(
          "SELECT kind, race_id, variant FROM sns_auto_send_items WHERE draft_id=$1",
          [draftId],
        );
      if (table === "sns_auto_send_control")
        return all(
          "SELECT setsu_kiryoku_short_enabled FROM sns_auto_send_control WHERE channel='youtube'",
        );
      if (table === "race_conditions")
        return all(
          "SELECT race_id FROM race_conditions WHERE race_id LIKE $1 AND race_stage='優勝戦'",
          [likeOf(p)],
        );
      if (table === "races")
        return all("SELECT cancellation_status FROM races WHERE race_id=$1", [
          idOf(p),
        ]);
      if (table === "race_entries" || table === "exhibition_data")
        return all(`SELECT is_absent FROM ${table} WHERE race_id=$1`, [idOf(p)]);
      throw new Error(`読み直しの path が想定の外: ${p}`);
    },
  });
  test("193 の土台: 189 の transition_sns_send_139 の本文の md5 が本番（2026-11-02 の読み取り）と一致し、193 は1つの ELSIF（と注記）だけを足す", async () => {
    const s189 = bodyOf(
      await sqlOf("189_sns_today_thinking.sql"),
      "transition_sns_send_139",
    );
    const s193 = bodyOf(await sqlOf(MIGRATION), "transition_sns_send_139");
    assert.equal(md5(s189), MD5_189);
    const a = s189.split("\n");
    const b = s193.split("\n");
    assert.deepEqual(
      a.filter((l) => !b.includes(l)),
      [],
      "189 の行は1行も消さない",
    );
    const added = b.filter((l) => !a.includes(l));
    assert.equal(added.length, 2, added.join("\n"));
    assert.match(added[0], /^\s+-- 193:/);
    assert.match(
      added[1],
      /ELSIF v_kind='setsu_kiryoku_short' AND \(SELECT setsu_kiryoku_short_enabled FROM public\.sns_auto_send_control WHERE channel='youtube'\) IS NOT TRUE THEN reason:='setsu_kiryoku_short_disabled';/,
    );
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（BASE_FILES・MIGRATION・MIGRATION_201・MD5_182・MD5_188・MD5_189・MD5_153_X・sqlOf・md5・bodyOf・forTest・guardedForTest・db・first・all・riskRules・PUSHED_AT・VIDEO・bundle・storeSql） */
export function runSnsSetsuKiryokuShortScenes4(env) {
  ({ BASE_FILES, MIGRATION, MIGRATION_201, MD5_182, MD5_188, MD5_189, MD5_153_X, sqlOf, md5, bodyOf, forTest, guardedForTest, db, first, all, riskRules, PUSHED_AT, VIDEO, bundle, storeSql } = env);
  skst1Scene3();
}
