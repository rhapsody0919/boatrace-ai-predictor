import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import {
  createXSnapshot,
  createMockXAdapter,
  runXSendJob,
  X_MEDIA_MAX_BYTES,
  YOUTUBE_MEDIA_MAX_BYTES,
} from "../../api/_lib/snsXSend.js";
import {
  deadlineSchedule,
  runYoutubeQueueJob,
  createMockYoutubeAdapter,
} from "../../api/_lib/snsDeadlineQueue.js";
import {
  preflight,
  runSnsDeadlineQueueScenes1,
  runSnsDeadlineQueueScenes2,
  runSnsDeadlineQueueScenes3,
} from "./verifyData/sns-deadline-queue-scenes-1.js";
import {
  runSnsDeadlineQueueScenes4,
  runSnsDeadlineQueueScenes5,
  runSnsDeadlineQueueScenes6,
} from "./verifyData/sns-deadline-queue-scenes-2.js";
const db = new PGlite();
const first = async (sql, args = []) => (await db.query(sql, args)).rows[0];
let approver;
const store = {
  async transition(id, action, result = {}) {
    return (
      await first("SELECT transition_sns_x_send($1,$2,$3) result", [
        id,
        action,
        result,
      ])
    ).result;
  },
  async parent(id) {
    return first("SELECT * FROM sns_x_send_jobs WHERE id=$1", [id]);
  },
};
const loadMedia = async () => new Uint8Array([1, 2, 3]);
before(async () => {
  await db.exec(
    "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;",
  );
  await db.exec(
    "CREATE TABLE test_clock(value timestamptz); INSERT INTO test_clock VALUES(NULL); CREATE FUNCTION test_now() RETURNS timestamptz LANGUAGE sql AS 'SELECT coalesce(value,now()) FROM test_clock';",
  );
  for (const f of [
    "035_sns_marketing_hub_schema.sql",
    "042_content_drafts_columns.sql",
    "135_sns_preview_bundle_import.sql",
    "137_sns_x_send.sql",
    "139_sns_deadline_queue.sql",
    "146_sns_shorts_send.sql",
  ])
    await db.exec(
      (
        await readFile(
          new URL("../../docs/db-migration/" + f, import.meta.url),
          "utf8",
        )
      ).replaceAll("now()", "test_now()"),
    );
  approver = (
    await first("SELECT id FROM sns_approvers WHERE display_name='本人'")
  ).id;
});
after(() => db.close());
const queue = () => {
  const deadline_at = new Date(Date.now() + 7200000).toISOString();
  return {
    deadline_at,
    ...deadlineSchedule(deadline_at),
    source_observed_at: new Date().toISOString(),
    source_revision: "v1",
    public_url: "https://www.boat-ai.jp/race/test",
    screen_key: "sonar",
  };
};
async function job({
  q = queue(),
  platform = "x",
  text = "ボートレースの発見",
} = {}) {
  const d = await first(
    "INSERT INTO sns_drafts(content_group_id,format,platform,language,caption_text,source_data,title,video_storage_path) VALUES(gen_random_uuid(),'short',$1::varchar,'ja',$2,$3,'動画タイトル',CASE WHEN $1::varchar='youtube' THEN 'demo/a.mp4' ELSE NULL END) RETURNING *",
    [platform, text, { deadline_queue: q }],
  );
  const snapshot = await createXSnapshot(d, loadMedia);
  return (
    await first("SELECT approve_sns_x_send($1,$2,$3,now()) result", [
      d.id,
      approver,
      snapshot,
    ])
  ).result;
}
async function enable(limit = 1000) {
  await db.exec(
    "UPDATE sns_youtube_quota_control SET verified=true,baseline_day=(now() AT TIME ZONE 'America/Los_Angeles')::date,upload_limit=100,general_limit=10000",
  );
  await db.exec(
    `UPDATE sns_x_send_control SET paused=false,timing_approved=true,daily_limit=${limit},daily_baseline_date=(now() AT TIME ZONE 'Asia/Tokyo')::date,daily_external_count=0,max_source_age_seconds=3600,period_start=date_trunc('month',now())-interval '1 month',period_end=date_trunc('month',now())+interval '2 months',attempt_ceiling_microusd=1,reserved_microusd=0`,
  );
}

// ---- 後半の場面（verifyData/sns-deadline-queue-scenes-1.js） ----
runSnsDeadlineQueueScenes1({ db, first, store, loadMedia, queue, job, enable });
const run = (j, x, extra = {}) =>
  runXSendJob(j.id, {
    store,
    x,
    loadMedia,
    wait: async () => {},
    preflight: preflight(j),
    ...extra,
  });

// ---- 後半の場面（verifyData/sns-deadline-queue-scenes-1.js） ----
runSnsDeadlineQueueScenes2({ db, first, store, loadMedia, queue, job, enable, run });
test("親が未公開なら子を保留、親成功後も子は個別承認しreply IDを渡す", async () => {
  await enable();
  const parent = await job();
  const q = { ...queue(), parent_job_id: parent.id };
  const child = await job({ q });
  assert.equal(
    (await store.transition(child.id, "claim")).error_code,
    "parent_not_posted",
  );
  await run(parent, createMockXAdapter({ postId: "1234567891" }));
  const d = await first("SELECT * FROM sns_drafts WHERE id=$1", [
    child.draft_id,
  ]);
  const approved = (
    await first("SELECT approve_sns_x_send($1,$2,$3,now()) result", [
      d.id,
      approver,
      await createXSnapshot(d, loadMedia),
    ])
  ).result;
  const x = createMockXAdapter({ postId: "1234567892" });
  await run(approved, x);
  assert.equal(x.calls.at(-1).payload.replyTo, "1234567891");
});

// ---- 後半の場面（verifyData/sns-deadline-queue-scenes-1.js） ----
runSnsDeadlineQueueScenes3({ db, first, store, loadMedia, queue, job, enable, run });

test("非公開残置の候補IDと手動削除の案内を期限一覧で表示", async () => {
  const { transform } = await import("esbuild");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const React = await import("react");
  let source = await readFile(
    new URL(
      "../../src/pages/admin/sns-hub/DeadlineQueuePanel.jsx",
      import.meta.url,
    ),
    "utf8",
  );
  source = source
    .replace(
      /import \{ useEffect, useRef, useState \} from "react";/,
      `import React, {useEffect,useRef,useState} from '${new URL("../../node_modules/react/index.js", import.meta.url).href}';`,
    )
    .replace(
      /import MonthCalendar from ["'][^"'\n]+["'];/,
      "const MonthCalendar=()=>null;",
    )
    .replace(
      /import \{[\s\S]*?\} from ["'][^"'\n]*snsMonthCalendar\.js["'];/,
      "const calendarMonth=()=>[],calendarRowDay=()=>null,calendarObservations=()=>[];",
    )
    .replace(
      /import \{[\s\S]*?\} from ["'][^"'\n]*snsAutoSendStatus\.js["'];/,
      "const attentionRows=()=>[],rowsOfDay=()=>[],todayDay=()=>'';",
    )
    .replace(
      /import \{[\s\S]*?\} from ["'][^"'\n]*snsHubService\.js["'];/,
      "const getDeadlineQueue=async()=>({rows:[],control:null}),stopXSend=async()=>{};",
    );
  const code = (await transform(source, { loader: "jsx", format: "esm" })).code;
  const { DeadlineQueueList } = await import(
    "data:text/javascript," + encodeURIComponent(code)
  );
  const html = renderToStaticMarkup(
    React.createElement(DeadlineQueueList, {
      now: Date.now(),
      rows: [
        {
          id: "j",
          channel: "youtube",
          state: "reconcile",
          youtube_stage: "private_retained",
          external_post_id: "abcdefghijk",
        },
      ],
    }),
  );
  assert.match(html, /abcdefghijk/);
  assert.match(html, /非公開のまま残置/);
  assert.match(html, /削除はオーナー操作/);
  assert.match(html, /要照合/);
});

// ---- 後半の場面（verifyData/sns-deadline-queue-scenes-2.js） ----
runSnsDeadlineQueueScenes4({ db, first, store, queue, job, enable, run });

test("再承認してもheld・failed・cancelledの試行は日次枠から消えない", async () => {
  for (const action of ["hold", "fail", "cancel"]) {
    await enable();
    const a = await job();
    await store.transition(a.id, "claim");
    if (action === "cancel") {
      await store.transition(a.id, "hold");
      await db.query(
        "UPDATE sns_drafts SET source_data=source_data || '{\"changed\":true}'::jsonb WHERE id=$1",
        [a.draft_id],
      );
    } else await store.transition(a.id, action);
    const count = Number(
      (
        await first(
          "SELECT sum(attempts) n FROM sns_x_send_jobs WHERE channel='x'",
        )
      ).n,
    );
    await enable(count);
    const d = await first("SELECT * FROM sns_drafts WHERE id=$1", [a.draft_id]);
    await first("SELECT approve_sns_x_send($1,$2,$3,now()) result", [
      d.id,
      approver,
      await createXSnapshot(d, loadMedia),
    ]);
    await assert.rejects(store.transition(a.id, "claim"), /日次/);
    const b = await job();
    await assert.rejects(store.transition(b.id, "claim"), /日次/);
  }
});

// ---- 後半の場面（verifyData/sns-deadline-queue-scenes-2.js） ----
runSnsDeadlineQueueScenes5({ db, first, store, queue, job, enable, run });

test("媒体変更を伴う再承認でも試行時の媒体の日次枠を保持する", async () => {
  const original = "x",
    changed = "youtube";
  const baseline = {};
  for (const channel of [original, changed])
    baseline[channel] = Number(
      (
        await first(
          "SELECT sum(attempts) n FROM sns_x_send_jobs WHERE channel=$1",
          [channel],
        )
      ).n || 0,
    );
  await enable();
  const a = await job({ platform: original });
  await store.transition(a.id, "claim");
  await store.transition(a.id, "hold");
  const count = Number(
    (
      await first(
        "SELECT sum(attempts) n FROM sns_x_send_jobs WHERE channel=$1",
        [original],
      )
    ).n,
  );
  await enable(count);
  const d = await first(
    "UPDATE sns_drafts SET platform=$2,video_storage_path=CASE WHEN $2::varchar='youtube' THEN 'demo/a.mp4' ELSE NULL END WHERE id=$1 RETURNING *",
    [a.draft_id, changed],
  );
  const approved = (
    await first("SELECT approve_sns_x_send($1,$2,$3,now()) result", [
      d.id,
      approver,
      await createXSnapshot(d, loadMedia),
    ])
  ).result;
  assert.equal(approved.channel, changed);
  const b = await job({ platform: original });
  await assert.rejects(store.transition(b.id, "claim"), /日次/);
  // 変更先での試行も成功させ、両媒体の過去枠が次の再承認後も残ることを確認する。
  await enable();
  await store.transition(a.id, "claim");
  await store.transition(a.id, "hold");
  const back = await first(
    "UPDATE sns_drafts SET platform=$2,video_storage_path=CASE WHEN $2::varchar='youtube' THEN 'demo/a.mp4' ELSE NULL END WHERE id=$1 RETURNING *",
    [a.draft_id, original],
  );
  const restored = (
    await first("SELECT approve_sns_x_send($1,$2,$3,now()) result", [
      back.id,
      approver,
      await createXSnapshot(back, loadMedia),
    ])
  ).result;
  assert.deepEqual(restored.attempt_channels, ["x", "youtube"]);
  assert.equal(restored.attempt_dates.length, 2);
  for (const channel of [original, changed]) {
    const expected = baseline[channel] + 1;
    await enable(expected);
    const other = await job({ platform: channel });
    await assert.rejects(store.transition(other.id, "claim"), /日次/);
  }
});

test("YouTube の動画も X と同じ 32 MiB まで。超えると承認の前に止める（送信の上限とそろえる）", async () => {
  await enable();
  assert.equal(YOUTUBE_MEDIA_MAX_BYTES, X_MEDIA_MAX_BYTES);
  const overCap = async () => new Uint8Array(YOUTUBE_MEDIA_MAX_BYTES + 1);
  const atCap = async () => new Uint8Array(YOUTUBE_MEDIA_MAX_BYTES);
  const insertDraft = (platform) =>
    first(
      "INSERT INTO sns_drafts(content_group_id,format,platform,language,caption_text,source_data,title,video_storage_path) VALUES(gen_random_uuid(),'short',$1,'ja',$2,$3,'動画タイトル','demo/a.mp4') RETURNING *",
      [platform, "ボートレースの発見", { deadline_queue: queue() }],
    );

  await assert.rejects(
    createXSnapshot(await insertDraft("x"), overCap),
    /媒体の容量/,
  );
  await assert.rejects(
    createXSnapshot(await insertDraft("youtube"), overCap),
    /媒体の容量/,
  );

  const ytDraft = await insertDraft("youtube");
  const snapshot = await createXSnapshot(ytDraft, atCap);
  assert.equal(snapshot.media[0].size, YOUTUBE_MEDIA_MAX_BYTES);
  const approved = (
    await first("SELECT approve_sns_x_send($1,$2,$3,now()) result", [
      ytDraft.id,
      approver,
      snapshot,
    ])
  ).result;
  assert.equal(approved.state, "queued");
});

test("全貌の Shorts: 完全版（親）の公開後に、説明文の {full_url} を完全版の URL に置き換えて上げる（BOA-912）", async () => {
  await enable();
  const youtube = { ...queue(), youtube_mode: "immediate" };
  const parent = await job({ platform: "youtube", q: youtube, text: "完全版" });
  const child = await job({
    platform: "youtube",
    q: { ...youtube, parent_job_id: parent.id },
    text: "入口版。続きは {full_url} で",
  });
  // 親が未公開の間は claim で止まる（外部へは何も送らない）
  assert.equal(
    (await store.transition(child.id, "claim")).error_code,
    "parent_not_posted",
  );
  const full = createMockYoutubeAdapter({ videoId: "fullvideo01" });
  assert.equal(
    (
      await runYoutubeQueueJob(parent.id, {
        store,
        youtube: full,
        loadMedia,
        preflight: preflight(parent),
      })
    ).state,
    "posted",
  );
  const d = await first("SELECT * FROM sns_drafts WHERE id=$1", [
    child.draft_id,
  ]);
  const approved = (
    await first("SELECT approve_sns_x_send($1,$2,$3,now()) result", [
      d.id,
      approver,
      await createXSnapshot(d, loadMedia),
    ])
  ).result;
  const shorts = createMockYoutubeAdapter({ videoId: "shortsvid01" });
  assert.equal(
    (
      await runYoutubeQueueJob(approved.id, {
        store,
        youtube: shorts,
        loadMedia,
        preflight: preflight(approved),
      })
    ).state,
    "posted",
  );
  assert.equal(
    shorts.calls[0].payload.snapshot.text,
    "入口版。続きは https://youtu.be/fullvideo01 で",
  );
});

// ---- 後半の場面（verifyData/sns-deadline-queue-scenes-2.js） ----
runSnsDeadlineQueueScenes6({ db, first, store, queue, job, enable, run });
