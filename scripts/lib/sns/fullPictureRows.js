/**
 * 全貌動画の取り込み（scripts/sns/push-full-picture.js）から移した、下書きの文と行の組み立て（純粋関数）。
 */
import { randomUUID } from "node:crypto";
import {
  FULL_PICTURE_FORMAT,
  sendAtOf,
  withShorts,
  wantsX,
} from "./fullPictureShape.js";

/** 完全版の YouTube のタグ（bundle の youtube_full.tags。hq 契約 10/24 C1） */
export const fullTagsOf = (bundle) =>
  Array.isArray(bundle?.youtube_full?.tags)
    ? [
        ...new Set(
          bundle.youtube_full.tags
            .filter((t) => typeof t === "string" && t.trim())
            .map((t) => t.trim().replace(/^#+/, "")),
        ),
      ]
    : [];

/**
 * 完全版の下書きの本文とハッシュタグ。送る文は buildPostText（本文＋空行＋hashtags の行）で作られ、YouTube の snippet.tags は
 * hashtags の頭の # を外したもの（youtubeTagsOf）。説明文の末尾のハッシュタグ行を hashtags に移し、送る文を bundle の説明文と同じにする
 * （本文に残したまま hashtags を足すと、末尾に「#」なしのタグの行が重なっていた。代わりの審査 2026-10-24 P2-1）
 */
export function fullYoutubeText(bundle) {
  const description = bundle?.youtube_full?.description ?? "";
  const tags = fullTagsOf(bundle);
  if (!tags.length) return { caption_text: description, hashtags: [] };
  const line = tags.map((t) => `#${t}`).join(" ");
  const lines = description.split("\n");
  if (lines.at(-1) !== line)
    return { caption_text: description, hashtags: tags.map((t) => `#${t}`) };
  return {
    caption_text: lines.slice(0, -1).join("\n").replace(/\n+$/, ""),
    hashtags: tags.map((t) => `#${t}`),
  };
}

export const draftTexts = (bundle) => ({
  ...(wantsX(bundle)
    ? { x: { platform: "x", caption_text: bundle?.x_text ?? "", hashtags: [] } }
    : {}),
  youtube: {
    platform: "youtube",
    title: bundle?.youtube_full?.title ?? "",
    ...fullYoutubeText(bundle),
  },
  ...(withShorts(bundle)
    ? {
        youtube_shorts: {
          platform: "youtube",
          title: bundle.youtube_shorts?.title ?? "",
          caption_text: bundle.youtube_shorts?.description ?? "",
          hashtags: [],
        },
      }
    : {}),
});

/** 下書きの行（純粋関数）。public_url は送る直前の表示の確認に使う（UTM・タブ以外の query を付けない） */
export function draftRows(bundle, { revision, paths, when, observedAt }) {
  const raceUrl = `https://www.boat-ai.jp/race/${bundle.race_id}?tab=sonar`;
  const groupId = randomUUID();
  const common = {
    content_group_id: groupId,
    language: "ja",
    status: "pending_review",
    format: FULL_PICTURE_FORMAT,
    hashtags: [],
    publish_blocked: false,
    publication_hold_reasons: [],
    send_lane: "A",
  };
  const queue = (channel) => ({
    deadline_at: when.deadline_at,
    expires_at: when.expires_at,
    source_revision: revision,
    source_observed_at: observedAt,
    public_url: raceUrl,
    screen_key: "race-sonar",
    ...(channel === "x" ? { thread_length: 1 } : { youtube_mode: "immediate" }),
  });
  const sourceData = (channel) => ({
    full_picture: {
      race_id: bundle.race_id,
      revision,
      review: bundle.review,
      qa: bundle.qa,
    },
    // YouTube の型を比べる札（daily.mjs --variant、hq SQ08 v5）。hq が source_data.full_picture_variant.id で数える
    ...(bundle.full_picture_variant
      ? { full_picture_variant: { id: bundle.full_picture_variant.id } }
      : {}),
    // 投稿の型の id（daily.mjs --type-spec、hq PD02）。hq が source_data.content_type.id で数える
    ...(bundle.content_type
      ? { content_type: { id: bundle.content_type.id } }
      : {}),
    deadline_queue: queue(channel),
    release_evidence: {
      status: "released",
      url: raceUrl,
      screen_key: "race-sonar",
      confirmed_by: "push-full-picture",
      reference: "full_picture",
      checked_at: observedAt,
      confirmed_at: observedAt,
    },
    qa: { pass: true, numeric_claims_match: true, L0_hits: [] },
  });
  return {
    ...(paths.x
      ? {
          x: {
            ...common,
            scheduled_at: sendAtOf(when, "x"),
            platform: "x",
            title: bundle.youtube_full.title,
            caption_text: bundle.x_text,
            video_storage_path: paths.x,
            source_data: sourceData("x"),
          },
        }
      : {}),
    youtube: {
      ...common,
      scheduled_at: sendAtOf(when, "youtube"),
      platform: "youtube",
      title: bundle.youtube_full.title,
      ...fullYoutubeText(bundle),
      video_storage_path: paths.youtube,
      // 完全版のサムネイル（BOA-1172）。X・Shorts には付けない
      ...(paths.thumbnail ? { cover_image_path: paths.thumbnail } : {}),
      source_data: sourceData("youtube"),
    },
    ...(paths.shorts
      ? {
          // 親（完全版の job）の id は、完全版を承認した後に deadline_queue.parent_job_id へ入れる（承認は queue の一致を照合する）
          shorts: {
            ...common,
            scheduled_at: sendAtOf(when, "shorts"),
            platform: "youtube",
            title: bundle.youtube_shorts.title,
            caption_text: bundle.youtube_shorts.description,
            video_storage_path: paths.shorts,
            source_data: sourceData("shorts"),
          },
        }
      : {}),
  };
}
