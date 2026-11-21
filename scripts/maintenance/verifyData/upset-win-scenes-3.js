/**
 * verify-upset-win.js の後半の場面（3/5）。verify ではない。
 * 判定と期待値は分ける前の verify-upset-win.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { addDays } from "../../../sns-video-studio/remotion/src/upsetWin/model.js";
import { pushUpsetWinShort } from "../../sns/push-upset-win-short.js";
import { parseUpsetId } from "../../../api/_lib/snsUpsetWinShort.js";
import { createReadCurrent } from "../../../api/_lib/snsClaimCheck.js";
import { createMockHeadless, createDeadlinePreflight } from "../../../api/_lib/snsDeadlineQueue.js";
import { SCREEN_MARKERS } from "../../lib/snsScreenMarkers.js";
import { all, first, upwState, saved, db } from "./upset-win-scenes-2.js";

let MIGRATION, MD5_194, sqlOf, md5, bodyOf, riskRules, SAMPLE, DAY, PUSHED_AT, UPSET_ID, bundle, VIDEO;
export let readCurrent;

export const store = {
  controls: async () =>
    Object.fromEntries(
      (
        await all(
          "SELECT channel, mode, dry_run, auto_approver_id, upset_win_short_enabled FROM sns_auto_send_control",
        )
      ).map((r) => [r.channel, r]),
    ),
  sendControl: () =>
    first(
      "SELECT daily_limit, daily_limit_youtube, daily_baseline_date::text, daily_external_count, expiry_minutes, max_source_age_seconds FROM sns_x_send_control",
    ),
  upsetItems: (date) =>
    all(
      "SELECT id, state, draft_id, race_id, held_reason, created_at::text FROM sns_auto_send_items WHERE kind='upset_win_short' AND race_id LIKE $1 ORDER BY created_at DESC",
      [`upset:${date}:%`],
    ),
  raceOf: async () => upwState.dbRace,
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
  saveFile: async (p, bytes) => saved.push([p, bytes.byteLength]),
  insertDraft: (draftRow) =>
    first(
      `INSERT INTO sns_drafts(content_group_id,platform,language,status,format,title,caption_text,hashtags,publish_blocked,
        publication_hold_reasons,send_lane,scheduled_at,video_storage_path,source_data)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [
        draftRow.content_group_id,
        draftRow.platform,
        draftRow.language,
        draftRow.status,
        draftRow.format,
        draftRow.title,
        draftRow.caption_text,
        draftRow.hashtags,
        draftRow.publish_blocked,
        JSON.stringify(draftRow.publication_hold_reasons),
        draftRow.send_lane,
        draftRow.scheduled_at,
        draftRow.video_storage_path,
        draftRow.source_data,
      ],
    ),
  insertItem: (row) =>
    first(
      `INSERT INTO sns_auto_send_items(kind,variant,draft_id,channel,race_id,deadline_at,notify_by,veto_until,state,checks,notified_at,stop_token_hash)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [
        row.kind,
        row.variant,
        row.draft_id,
        row.channel,
        row.race_id,
        row.deadline_at,
        row.notify_by,
        row.veto_until,
        row.state,
        row.checks,
        row.notified_at,
        row.stop_token_hash,
      ],
    ),
  updateItem: async (id, from, itemPatch) => {
    const row = await first(
      "UPDATE sns_auto_send_items SET state=$3, stopped_at=$4, stopped_via=$5, held_reason=$6 WHERE id=$1 AND state=$2 RETURNING *",
      [
        id,
        from,
        itemPatch.state,
        itemPatch.stopped_at ?? null,
        itemPatch.stopped_via ?? null,
        itemPatch.held_reason ?? null,
      ],
    );
    if (!row) throw new Error(`item ${id} を更新できない`);
    return row;
  },
  updateDraft: (id, patch) =>
    first("UPDATE sns_drafts SET publish_blocked=$2 WHERE id=$1 RETURNING *", [
      id,
      patch.publish_blocked,
    ]),
  approve: async (args) =>
    (
      await first("SELECT public.approve_sns_x_send($1,$2,$3,$4) r", [
        args.p_draft_id,
        args.p_approver_id,
        args.p_snapshot,
        args.p_scheduled_at,
      ])
    ).r,
};

export const push = (b = bundle(), opts = {}, video = VIDEO) => {
  const f = {
    "/f/bundle.json": new TextEncoder().encode(JSON.stringify(b)),
    ...(video ? { "/f/upset_win.mp4": video } : {}),
  };
  const notes = [];
  return pushUpsetWinShort("/f", {
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

const likeOf = (p) =>
  decodeURIComponent(p.match(/race_id=like\.([^&]+)/)[1]).replace("*", "%");

export const sonarHeadless = () =>
  createMockHeadless({ visibleSelectors: SCREEN_MARKERS["race-sonar"] });

export const preflightAt = (now, headless = sonarHeadless()) =>
  createDeadlinePreflight({
    headless,
    markers: SCREEN_MARKERS,
    readCurrent,
    now: () => now.getTime(),
  });

function upw3Scene1() {
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
          "SELECT id FROM sns_auto_send_items WHERE kind='upset_win_short' AND channel='youtube' AND race_id LIKE $1 AND state='sent'",
          [likeOf(p)],
        );
      if (table === "sns_auto_send_items")
        return all(
          "SELECT kind, race_id FROM sns_auto_send_items WHERE draft_id=$1",
          [draftId],
        );
      if (table === "sns_auto_send_control")
        return all(
          "SELECT upset_win_short_enabled FROM sns_auto_send_control WHERE channel='youtube'",
        );
      if (table === "races")
        return upwState.dbRace
          ? [{ cancellation_status: upwState.dbRace.cancelled ? "confirmed" : null }]
          : [];
      if (table === "race_results")
        return upwState.dbRace && !upwState.dbRace.cancelled ? [{ rank1: upwState.dbRace.rank1 }] : [];
      throw new Error(`読み直しの path が想定の外: ${p}`);
    },
  });
  test("200 の土台: 194 の transition_sns_send_139 の本文の md5 が本番（2026-11-04 の読み取り）と一致し、200 は1つの ELSIF（と注記）だけを足す", async () => {
    const s194 = bodyOf(
      await sqlOf("194_sns_setsu_kiryoku_x.sql"),
      "transition_sns_send_139",
    );
    const s200 = bodyOf(await sqlOf(MIGRATION), "transition_sns_send_139");
    assert.equal(md5(s194), MD5_194);
    const a = s194.split("\n");
    const b = s200.split("\n");
    assert.deepEqual(
      a.filter((l) => !b.includes(l)),
      [],
      "194 の行は1行も消さない",
    );
    const added = b.filter((l) => !a.includes(l));
    assert.equal(added.length, 2, added.join("\n"));
    assert.match(added[0], /^\s+-- 200:/);
    assert.match(
      added[1],
      /ELSIF v_kind='upset_win_short' AND \(SELECT upset_win_short_enabled FROM public\.sns_auto_send_control WHERE channel='youtube'\) IS NOT TRUE THEN reason:='upset_win_short_disabled';/,
    );
    console.log(`MD5_200（適用後の本番の md5(prosrc) の期待）: ${md5(s200)}`);
  });
}

function upw3Scene2() {
  test("200: upset_win_short の item は YouTube・variant=main・race_id は upset:{日}:{race_id} だけ。1日1本（別のレースも、送った後も入らない）。許可は既定 false・youtube の行だけ", async () => {
    const insert = (channel, raceId, variant = "main") =>
      db.query(
        `WITH draft AS (INSERT INTO sns_drafts(content_group_id,platform,language,format,caption_text)
         VALUES(gen_random_uuid(), $1, 'ja', 'upset_win_short', '200') RETURNING id)
       INSERT INTO sns_auto_send_items(kind,variant,draft_id,channel,race_id,deadline_at,notify_by,veto_until,state)
       SELECT 'upset_win_short', $3, id, $1, $2, test_now()+interval '3h', test_now(), test_now()+interval '1h', 'checking' FROM draft`,
        [channel, raceId, variant],
      );
    await assert.rejects(insert("x", UPSET_ID), /kind_source/);
    await assert.rejects(
      insert("youtube", `upset:${DAY}:2026-11-03-25-10`),
      /upset_id/,
    );
    await assert.rejects(
      insert("youtube", `upset:${DAY}:2026-11-03-17-13`),
      /upset_id/,
    );
    await assert.rejects(
      insert("youtube", UPSET_ID, "shorts"),
      /variant_scope|upset_id/,
    );
    await insert("youtube", UPSET_ID);
    await assert.rejects(
      insert("youtube", `upset:${DAY}:2026-11-03-01-01`),
      /upset_day/,
    );
    await db.exec(
      `UPDATE sns_auto_send_items SET state='sent', checks='{"passed":true}'`,
    );
    await assert.rejects(
      insert("youtube", `upset:${DAY}:2026-11-03-01-01`),
      /upset_day/,
    );
    await db.exec("UPDATE sns_auto_send_items SET state='held_manual'");
    await insert("youtube", `upset:${DAY}:2026-11-03-01-01`);
    await insert("youtube", `upset:${addDays(DAY, 1)}:2026-11-04-01-01`);
    await assert.rejects(
      db.exec(
        "UPDATE sns_auto_send_control SET upset_win_short_enabled=true WHERE channel='x'",
      ),
      /youtube_only/,
    );
    const col = await first(
      "SELECT column_default FROM information_schema.columns WHERE table_name='sns_auto_send_control' AND column_name='upset_win_short_enabled'",
    );
    assert.equal(col.column_default, "false");
    assert.deepEqual(parseUpsetId(UPSET_ID), {
      date: DAY,
      raceId: SAMPLE.race_id,
    });
    assert.equal(parseUpsetId(`upset:${DAY}:2026-11-03-17-13`), null);
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（MIGRATION・MD5_194・sqlOf・md5・bodyOf・riskRules・SAMPLE・DAY・PUSHED_AT・UPSET_ID・bundle・VIDEO） */
export function runUpsetWinScenes4(env) {
  ({ MIGRATION, MD5_194, sqlOf, md5, bodyOf, riskRules, SAMPLE, DAY, PUSHED_AT, UPSET_ID, bundle, VIDEO } = env);
  upw3Scene1();
  upw3Scene2();
}
