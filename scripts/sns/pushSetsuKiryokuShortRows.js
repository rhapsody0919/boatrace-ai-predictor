/** 節の機力の Shorts の下書き・item の行と状態の形（純粋関数）。push-setsu-kiryoku-short.js から移した（字は同じ） */
import { randomBytes, randomUUID } from "node:crypto";
import {
  finalKeyOf,
  SETSU_KIRYOKU_SHORT_KIND,
  SETSU_SCREEN_KEY,
  setsuIdOf,
} from "../../api/_lib/snsSetsuKiryokuShort.js";
import { mp4Info } from "../lib/sns/mp4Info.js";
import { pickOrNull } from "./shortPushCommon.js";

export const SETSU_FORMAT = SETSU_KIRYOKU_SHORT_KIND;

/** 下書きの行（純粋関数）。題・説明欄は bundle の値のまま（ハッシュタグは説明欄に入っているので hashtags は空） */
export function draftRow(
  bundle,
  { revision, videoPath, when, observedAt, venueCode, publicUrl },
) {
  const setsuId = setsuIdOf(bundle.date, venueCode);
  return {
    content_group_id: randomUUID(),
    language: "ja",
    status: "pending_review",
    format: SETSU_FORMAT,
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
      // 管理画面の一覧・記録（snsXSendStore の race_id）が読む
      race_id: setsuId,
      setsu_kiryoku_short: {
        setsu_id: setsuId,
        date: bundle.date,
        venue: bundle.venue,
        venue_code: venueCode,
        variant: bundle.variant,
        when: bundle.when ?? null,
        final_date: bundle.final_date ?? null,
        final_key: finalKeyOf(bundle, venueCode),
        as_of: bundle.as_of,
        revision,
      },
      deadline_queue: {
        deadline_at: when.deadline_at,
        expires_at: when.expires_at,
        source_revision: revision,
        source_observed_at: observedAt,
        public_url: publicUrl,
        screen_key: SETSU_SCREEN_KEY,
        youtube_mode: "immediate",
      },
      qa: { pass: true, numeric_claims_match: true, L0_hits: [] },
    },
  };
}

/** item の行（純粋関数）。自動（notified）は止めるリンクを作らない（全貌・優勝戦・数字で見たらと同じ。153 の CHECK が要るので使わない乱数のハッシュ） */
export function itemRow({
  setsuId,
  variant,
  draftId,
  when,
  state,
  checkedAt,
  heldReason,
}) {
  return {
    kind: SETSU_KIRYOKU_SHORT_KIND,
    variant,
    draft_id: draftId,
    channel: "youtube",
    race_id: setsuId,
    deadline_at: when.deadline_at,
    notify_by: when.notify_by,
    veto_until: when.veto_until,
    state,
    checks: { passed: true, checked_at: checkedAt },
    ...(heldReason ? { held_reason: heldReason } : {}),
    ...(state === "notified"
      ? {
          notified_at: checkedAt,
          stop_token_hash: randomBytes(32).toString("hex"),
        }
      : {}),
  };
}

/** item と job から、hq に返す状態（純粋関数） */
export const setsuStatusOf = (item, job) => ({
  ...pickOrNull(item, [
    ["setsu_id", "race_id"],
    "variant",
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

/** 書かない結果（自動モードでない・許可が off・dry-run）。書くなら null */
export function unwrittenResult({
  setsuId,
  writes,
  auto,
  dryRun,
  enabled,
  revision,
  when,
  publicUrl,
  name,
  bytes,
  extra,
}) {
  // この型は自動の道だけで送る。自動モードでなければ何も書かない（held_manual の下書きを毎回積まない。個別承認で1日1本の守りを外さない）
  if (writes && !auto)
    return {
      setsu_id: setsuId,
      manual: true,
      reason:
        "youtube の mode が auto でない（この型は自動の道だけで送る）ので何も書かなかった",
      ...extra,
    };
  if (!writes)
    return {
      setsu_id: setsuId,
      dryRun: true,
      enabled,
      // --dry-run でなく、許可が off なので書かなかった（exit 3）
      disabled: !dryRun,
      auto,
      revision,
      when,
      public_url: publicUrl,
      video: { name, bytes: bytes.byteLength, ...mp4Info(bytes) },
      ...extra,
    };
  return null;
}
