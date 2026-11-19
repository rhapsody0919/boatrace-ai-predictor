/** 人気薄の1着の Shorts の下書き・item の行と状態の形（純粋関数）。push-upset-win-short.js から移した（字は同じ） */
import { randomBytes, randomUUID } from "node:crypto";
import {
  UPSET_SCREEN_KEY,
  UPSET_WIN_SHORT_KIND,
  upsetIdOf,
} from "../../api/_lib/snsUpsetWinShort.js";
import { pickOrNull } from "./shortPushCommon.js";

export const UPSET_FORMAT = UPSET_WIN_SHORT_KIND;

/** 下書きの行（純粋関数）。題・説明欄は bundle の値のまま（ハッシュタグは説明欄に入っているので hashtags は空） */
export function draftRow(
  bundle,
  { revision, videoPath, when, observedAt, publicUrl },
) {
  const upsetId = upsetIdOf(bundle.date, bundle.race_id);
  return {
    content_group_id: randomUUID(),
    language: "ja",
    status: "pending_review",
    format: UPSET_FORMAT,
    platform: "youtube",
    title: bundle.youtube.title,
    caption_text: bundle.youtube.description,
    hashtags: [],
    publish_blocked: false,
    publication_hold_reasons: [],
    send_lane: "A",
    scheduled_at: when.send_at,
    video_storage_path: videoPath,
    source_data: {
      race_id: upsetId,
      upset_win_short: {
        upset_id: upsetId,
        date: bundle.date,
        race_id: bundle.race_id,
        rank1: bundle.rank1,
        venue: bundle.venue,
        primary: bundle.primary,
        weaknesses: bundle.weaknesses,
        odds: bundle.boats[bundle.rank1 - 1].odds,
        year: {
          n: bundle.year.n,
          k: bundle.year.k,
          from: bundle.year.from,
          to: bundle.year.to,
        },
        as_of: bundle.as_of,
        revision,
      },
      deadline_queue: {
        deadline_at: when.deadline_at,
        expires_at: when.expires_at,
        source_revision: revision,
        source_observed_at: observedAt,
        public_url: publicUrl,
        screen_key: UPSET_SCREEN_KEY,
        youtube_mode: "immediate",
      },
      qa: { pass: true, numeric_claims_match: true, L0_hits: [] },
    },
  };
}

export function itemRow({ upsetId, draftId, when, checkedAt }) {
  return {
    kind: UPSET_WIN_SHORT_KIND,
    variant: "main",
    draft_id: draftId,
    channel: "youtube",
    race_id: upsetId,
    deadline_at: when.deadline_at,
    notify_by: when.notify_by,
    veto_until: when.veto_until,
    state: "notified",
    checks: { passed: true, checked_at: checkedAt },
    notified_at: checkedAt,
    // 自動（notified）は止めるリンクを作らない（節の機力と同じ。153 の CHECK が要るので使わない乱数のハッシュ）
    stop_token_hash: randomBytes(32).toString("hex"),
  };
}

export const upsetStatusOf = (item, job) => ({
  ...pickOrNull(item, [
    ["upset_id", "race_id"],
    ["item_state", "state"],
    "held_reason",
  ]),
  ...pickOrNull(job, [
    ["job_id", "id"],
    ["job_state", "state"],
    "error_code",
    "posted_at",
    ["video_id", "external_post_id"],
    ["video_url", "external_post_url"],
  ]),
});
