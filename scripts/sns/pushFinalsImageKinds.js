// 優勝戦・思考投稿の種類ごとの設定（KINDS）と bundle の format の表。push-finals-image.js から移した（snsClaimCheck・snsXSlots に依るので scripts/sns の隣）。
import {
  FINALS_PART_VARIANTS,
  THINKING_PART_VARIANTS,
  TODAY_THINKING_KIND,
} from "../../api/_lib/snsClaimCheck.js";
import { SLOT_KINDS } from "../lib/snsXSlots.js";
import {
  FINALS_IMAGE_FORMAT,
  FINALS_REPLY_FORMAT,
  FINALS_STAGE,
  TODAY_THINKING_IMAGE_FORMAT,
  TODAY_THINKING_REPLY_FORMAT,
} from "../lib/sns/finalsImageBase.js";

/**
 * item の版（172 の variant）。同じ優勝戦の全貌（full_picture・x・main）と両立させ、種類ごとに1レース1件に限る（176・177 の一意の索引）。
 * 下書きの source_data.finals_image.part との対応は FINALS_PART_VARIANTS（snsClaimCheck.js）
 */
export const FINALS_VARIANT = FINALS_PART_VARIANTS.main;
export const FINALS_POLL_VARIANT = FINALS_PART_VARIANTS.poll;
export const FINALS_REPLY_VARIANT = FINALS_PART_VARIANTS.reply;
const STOP_SQL =
  "UPDATE public.sns_auto_send_control SET finals_image_enabled = false WHERE channel = 'x';";

export { TODAY_THINKING_KIND };

/**
 * 種類（item の kind）ごとの設定。stage は受け取る段（null は段を見ず race_conditions も読まない）、flag は自動送信の許可の列、
 * slot は取り置き（182）の出し物、sourceKey は下書きの source_data のキー（readCurrent はこのキーで振り分ける。他の種類のキーを入れない）、
 * todayTarget は race_id がその日の /today の X 投稿の対象であることを求めるか
 */
export const KINDS = Object.freeze({
  finals_image: Object.freeze({
    kind: FINALS_IMAGE_FORMAT,
    stage: FINALS_STAGE,
    flag: "finals_image_enabled",
    migration: "176",
    slot: SLOT_KINDS.finals,
    variants: FINALS_PART_VARIANTS,
    sourceKey: "finals_image",
    draftFormat: FINALS_IMAGE_FORMAT,
    title: "優勝戦 思考の順",
    label: { main: "優勝戦の画像", reply: "優勝戦の展示後のリプ" },
    storage: "finals-image",
    stopSql: STOP_SQL,
    todayTarget: false,
  }),
  today_thinking: Object.freeze({
    kind: TODAY_THINKING_KIND,
    stage: null,
    flag: "today_thinking_enabled",
    migration: "189",
    slot: SLOT_KINDS.todayThinking,
    variants: THINKING_PART_VARIANTS,
    sourceKey: "today_thinking",
    draftFormat: TODAY_THINKING_IMAGE_FORMAT,
    title: "/today 思考の順",
    label: {
      main: "/today の思考投稿",
      reply: "/today の思考投稿の展示後のリプ",
    },
    storage: "today-thinking",
    stopSql:
      "UPDATE public.sns_auto_send_control SET today_thinking_enabled = false WHERE channel = 'x';",
    todayTarget: true,
  }),
});

/** bundle の format → 種類と部分。表に無い format は優勝戦の本投稿として扱い、checkFinalsImage が format の違いで拒む（今までと同じ） */
export const BUNDLE_FORMATS = Object.freeze({
  [FINALS_IMAGE_FORMAT]: { kind: FINALS_IMAGE_FORMAT, part: "main" },
  [FINALS_REPLY_FORMAT]: { kind: FINALS_IMAGE_FORMAT, part: "reply" },
  [TODAY_THINKING_IMAGE_FORMAT]: { kind: TODAY_THINKING_KIND, part: "main" },
  [TODAY_THINKING_REPLY_FORMAT]: { kind: TODAY_THINKING_KIND, part: "reply" },
});
export const bundleKindOf = (format) =>
  typeof format === "string" && Object.hasOwn(BUNDLE_FORMATS, format)
    ? BUNDLE_FORMATS[format]
    : BUNDLE_FORMATS[FINALS_IMAGE_FORMAT];
