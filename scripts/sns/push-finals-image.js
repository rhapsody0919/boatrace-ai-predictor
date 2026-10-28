/**
 * 優勝戦の「展示を見た直前の思考の順」の画像投稿（format=finals_image、X だけ）のフォルダを受け取り、X の下書きと自動送信の item を作って
 * 今すぐ送る予定に入れる（hq FT02、マイグレーション 176）。hq の作業役が同じ Mac の本リポジトリで実行する。
 * 鍵は本リポジトリの .env.local（SUPABASE_URL・SUPABASE_SERVICE_KEY）だけを使う。
 *
 * 使い方:
 *   node --env-file=.env.local scripts/sns/push-finals-image.js <フォルダ> [--dry-run] [--no-wait]
 *   node --env-file=.env.local scripts/sns/push-finals-image.js --status <race_id>   送った時刻・tweet id を出す
 *
 * フォルダ（hq の finals_run.py の出力）: bundle.json と PNG 4枚（1080×1350）。ほかのファイル（HTML 等）は読まない。bundle.format で2つに分ける
 *   本投稿（展示前の版、締切の約3時間前）: {format:"finals_image", race_id, x_text, deadline:"HH:MM"（JST）, images:[4つの名前],
 *     review:{p0_count, by}, poll:[4つの選択肢（各25字まで）], poll_text}
 *     本投稿と、その直後に本投稿へのリプで出す投票（本文 poll_text、締切で閉じる。177）の2つを作る。投票のリプは本投稿が posted になってから送る
 *   展示後のリプ（締切の25〜13分前）: {format:"finals_reply", race_id, x_text, deadline:"HH:MM", images:[1枚目の名前] か [4つの名前], review:{p0_count, by}}
 *     本投稿（posted）へのリプで画像（1枚目の思考の地図だけ、2026-10-28 オーナー決定。今までの4枚も受ける）と本文。13分前を過ぎたら受け取らない（出さない）
 *   images は <race_id>-1-map.png・-2-q12.png・-3-q3.png・-4-routes.png のこの順（この順で1投稿に付く）
 *
 * 自動送信の許可（sns_auto_send_control の x の行の finals_image_enabled）は既定 off。
 * off の間は --dry-run と同じ（検査だけして DB・Storage に書かない、exit 3）。送り手（cron sns-send）も off の job を送らない
 *
 * 時刻: 全貌の 60分の遅らせ・45分の締め・30分の期限は当てない。送る時刻＝今すぐ、期限＝締切の5分前（3本とも）。
 * 本投稿は締切の15分前を過ぎて届いたら受け取らない。展示後のリプは締切の25分前より前・13分前を過ぎたら受け取らない（exit 1 と理由）。
 * X の日の上限（daily_limit_x）は1本ずつ数える。本投稿は投票のリプと対で2本分の空きが無ければ受け取らない（送り手の claim も対で数える、177）。
 * 優勝戦の取り置き（182、sns_x_kind_reserves の finals_image）に入らないときも受け取らない
 * 送るのは送り手（cron sns-send、2分ごと）。push は job を入れた後、送り終わる（posted・held 等）か期限を過ぎるまで待つ（--no-wait で待たない）。
 * 本投稿は投票のリプが送り終わるまで待つ
 *
 * /today の対象レースの思考投稿（BOA-1169、マイグレーション 189）も同じ型で受け取る。bundle の format は today_thinking_image（本投稿）・
 *   today_thinking_reply（展示後のリプ）で、形・時刻の窓・画像の名前・投票4択は優勝戦と同じ。違うのは次だけ:
 *   item の kind は today_thinking・variant は thinking・thinking_poll・thinking_reply、下書きの format は3本とも today_thinking_image・
 *   source_data のキーは today_thinking、許可は today_thinking_enabled、取り置きは today_thinking、Storage は today-thinking/、
 *   優勝戦の段（race_stage）は見ない。代わりに、race_id がその日の /today の X 投稿の対象（today-picks.js の featured か list）であること
 *   node --env-file=.env.local scripts/sns/push-finals-image.js --status <race_id> --kind today_thinking   思考投稿の状態
 *
 * stdout の最後の1行は `FINALS_RESULT {...}`（race_id・part（main・reply）・kind（finals_image・today_thinking）・outcome・job_id・job_state・
 *   tweet_id・tweet_url・posted_at・error_code・reason・poll_job_id・poll_job_state・poll_tweet_id・poll_error_code）
 * exit: 0 送った（本投稿は投票のリプも。--dry-run は検査が通った・--no-wait は予定に入れた）・1 検査で拒否・2 使い方・鍵の不足
 *   ・3 許可が off なので書かなかった・4 同じレースの同じ種類が既にある（何もしない）・5 予定に入れたが送れなかった（保留・期限切れ・
 *   個別承認・本投稿は出たが投票のリプが出なかった）
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import twitterText from "twitter-text";
import { createXSnapshot, pollOptionsIssue } from "../../api/_lib/snsXSend.js";
import {
  deadlineIso,
  FINALS_PART_VARIANTS,
  THINKING_PART_VARIANTS,
  TODAY_THINKING_KIND,
} from "../../api/_lib/snsClaimCheck.js";
import { xPostValid } from "../../api/_lib/snsXLength.js";
import { matchRiskRules, draftRiskFields } from "../lib/riskRuleMatcher.js";
import { checkXSlot, SLOT_KINDS, xSlotRoomVia } from "../lib/snsXSlots.js";
import { readTodayPicks } from "./today-picks.js";

export const FINALS_IMAGE_FORMAT = "finals_image";
/** 展示後のリプの bundle の format（下書きの format・item の kind は本投稿と同じ finals_image） */
export const FINALS_REPLY_FORMAT = "finals_reply";
/**
 * item の版（172 の variant）。同じ優勝戦の全貌（full_picture・x・main）と両立させ、種類ごとに1レース1件に限る（176・177 の一意の索引）。
 * 下書きの source_data.finals_image.part との対応は FINALS_PART_VARIANTS（snsClaimCheck.js）
 */
export const FINALS_VARIANT = FINALS_PART_VARIANTS.main;
export const FINALS_POLL_VARIANT = FINALS_PART_VARIANTS.poll;
export const FINALS_REPLY_VARIANT = FINALS_PART_VARIANTS.reply;
export const FINALS_STAGE = "優勝戦";
/**
 * 画像の名前の後ろ（hq の finals_run.py の出力は <race_id>-1-map.png の形）。bundle.images がこの順の4つちょうどであること。
 * snsXSend.js は snapshot.media を順に上げて1投稿にまとめる（先頭は cover_image_path）
 */
export const IMAGE_SUFFIXES = [
  "1-map.png",
  "2-q12.png",
  "3-q3.png",
  "4-routes.png",
];
export const imageNamesOf = (raceId) =>
  IMAGE_SUFFIXES.map((suffix) => `${raceId}-${suffix}`);
export const IMAGE_WIDTH = 1080;
export const IMAGE_HEIGHT = 1350;
/** 1枚の上限。承認の関数（160）の X の画像の上限と同じ（X の画像の上限 5MB 以内） */
export const IMAGE_MAX_BYTES = 5000000;
/** 期限（送り手が送れる最後）は締切の5分前。transition_sns_send_139（176）の finals_image の期限と同じ値 */
export const EXPIRES_BEFORE_MIN = 5;
/**
 * 本投稿を受け取る最後は締切の15分前（目安・根拠は送り手の周期）。本投稿の後に投票のリプを期限（5分前）までに送るので、
 * 送る時刻の遅らせ2分＋本投稿と投票のリプの送り手の実行（2分ごと）2回分＋リース5分を残す（/code-review の指摘。これより短いと投票のリプが期限に間に合わない）
 */
export const LATEST_BEFORE_MIN = 15;
/**
 * 送る時刻は受け取りの2分後（送り手の1周期）。本投稿を承認してから投票のリプを承認するまでの間に、送り手が本投稿を
 * claim して（子の枠を数えずに）送るのを防ぐ。投票のリプの承認に落ちたら、送る時刻の前に item を held_manual にして止める
 */
export const SEND_DELAY_SEC = 120;
/** 展示後のリプを受け取る窓は締切の25分前から13分前まで（13分前ちょうどは受け取らない。オーナー 2026-10-26） */
export const REPLY_EARLIEST_BEFORE_MIN = 25;
export const REPLY_LATEST_BEFORE_MIN = 13;
/** hq と決めた禁止表現（risk-rules.json に加えて見る。NFKC でそろえて含むかを見る） */
export const BANNED_WORDS = ["必ず当たる", "稼げる", "万舟券", "儲か", "競艇"];
/** 投票は4択（A〜D の道、hq の finals_sheet.py の poll_options） */
export const POLL_OPTIONS = 4;
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const RACE_URL =
  /^https:\/\/www\.boat-ai\.jp\/race\/([0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{2}-[0-9]{2})(?:[?#]|$)/;
const STOP_SQL =
  "UPDATE public.sns_auto_send_control SET finals_image_enabled = false WHERE channel = 'x';";

/** /today の対象レースの思考投稿（BOA-1169、189）の bundle の format。下書きの format は3本とも TODAY_THINKING_IMAGE_FORMAT */
export const TODAY_THINKING_IMAGE_FORMAT = "today_thinking_image";
export const TODAY_THINKING_REPLY_FORMAT = "today_thinking_reply";
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

const minutesBefore = (iso, min) =>
  new Date(Date.parse(iso) - min * 60000).toISOString();
const jstTime = (iso) =>
  new Date(Date.parse(iso) + 9 * 3600000).toISOString().slice(11, 16);
const jstDate = (date) =>
  new Date(date.getTime() + 9 * 3600000).toISOString().slice(0, 10);

/** today_thinking の本文に URL があるときの理由（オーナー 2026-10-27: 3本とも本文に URL を付けない） */
export const THINKING_URL_REASON = "today_thinking の本文に URL がある";

/**
 * 投稿の文の検査（純粋関数）。label は理由の頭（x_text・poll_text）。
 * noUrl（today_thinking）は URL を1つも許さない。それ以外（優勝戦）は、無いかこのレースのページ1つだけ
 */
function textReasons(text, raceId, riskRules, label, { noUrl = false } = {}) {
  if (typeof text !== "string" || !text.trim()) return [`${label} が無い`];
  const reasons = [];
  // スレッドにしない1投稿なので、送り手の検査（createDeadlinePreflight）と同じく加重の280まで
  if (!xPostValid(text)) reasons.push(`${label} が X の加重280を超える`);
  if (/[{}]|\$\{/.test(text))
    reasons.push(`${label} に置き場所（{ } ・\${）が残っている`);
  const urls = twitterText.extractUrls(text);
  if (noUrl) {
    if (urls.length) reasons.push(`${THINKING_URL_REASON}（${label}）`);
  } else if (
    // リンクは無いか、このレースのページ1つだけ
    urls.length > 1 ||
    (urls.length === 1 && urls[0].match(RACE_URL)?.[1] !== raceId)
  )
    reasons.push(`${label} のリンクがこのレースのページ1つでない`);
  const normalized = text.normalize("NFKC");
  const banned = BANNED_WORDS.filter((w) => normalized.includes(w));
  if (banned.length) reasons.push(`${label} の禁止表現: ${banned.join(",")}`);
  const hits = matchRiskRules(
    draftRiskFields({ platform: "x", caption_text: text, hashtags: [] }),
    "x",
    riskRules,
  );
  if (hits.length)
    reasons.push(
      `${label} の禁止表現（risk-rules）: ${hits.map((h) => h.id).join(",")}`,
    );
  return reasons;
}

/**
 * 展示後のリプは画像1枚（1枚目の思考の地図＝今日の展示 ST・展示の進入入り）か、今までの4枚（2026-10-28 オーナー決定で1枚へ。
 * 2〜4枚目は本投稿とほぼ同じなので外す。hq が切り替えるまで4枚も受ける）。本投稿は4枚のまま
 */
const replyImageSets = (raceId) => [
  imageNamesOf(raceId).slice(0, 1),
  imageNamesOf(raceId),
];

/** 本投稿と展示後のリプに共通の bundle の検査（純粋関数）。text は textReasons の追加の設定、imageSets は受ける画像の並び */
function commonReasons(
  bundle,
  format,
  riskRules,
  text = {},
  imageSets = [imageNamesOf(bundle?.race_id)],
) {
  const reasons = [];
  if (bundle?.format !== format) reasons.push(`format が ${format} でない`);
  if (!/^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}$/.test(bundle?.race_id ?? ""))
    reasons.push("race_id が不正");
  if (!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(bundle?.deadline ?? ""))
    reasons.push("deadline が HH:MM でない");
  if (
    !Array.isArray(bundle?.images) ||
    !imageSets.some(
      (expected) =>
        bundle.images.length === expected.length &&
        bundle.images.every((name, i) => name === expected[i]),
    )
  )
    reasons.push(
      `images が ${imageSets.map((e) => e.join(",")).join(" か ")} の並びでない`,
    );
  if (bundle?.review?.p0_count !== 0)
    reasons.push(`機械の検査の P0 が0件でない（${bundle?.review?.p0_count}）`);
  return [
    ...reasons,
    ...textReasons(bundle?.x_text, bundle?.race_id, riskRules, "x_text", text),
  ];
}

/** 本投稿の bundle.json の検査（純粋関数、format で優勝戦と思考投稿を分ける）。投票（poll 4択・poll_text）は必須 */
function mainReasons(bundle, riskRules, format, text = {}) {
  const reasons = commonReasons(bundle, format, riskRules, text);
  const pollIssue = pollOptionsIssue(bundle?.poll);
  if (pollIssue) reasons.push(pollIssue);
  else if (bundle.poll.length !== POLL_OPTIONS)
    reasons.push(`投票の選択肢が${POLL_OPTIONS}個でない`);
  return [
    ...reasons,
    ...textReasons(
      bundle?.poll_text,
      bundle?.race_id,
      riskRules,
      "poll_text",
      text,
    ),
  ];
}

/** 本投稿の bundle.json の検査（純粋関数）。不合格は理由の配列を返す。投票（poll 4択・poll_text）は必須 */
export function checkFinalsImage(bundle, riskRules = []) {
  return mainReasons(bundle, riskRules, FINALS_IMAGE_FORMAT);
}

/** 展示後のリプの bundle.json の検査（純粋関数） */
export function checkFinalsReply(bundle, riskRules = []) {
  return commonReasons(
    bundle,
    FINALS_REPLY_FORMAT,
    riskRules,
    {},
    replyImageSets(bundle?.race_id),
  );
}

/** 思考投稿の本投稿（format=today_thinking_image）の検査（純粋関数）。優勝戦の本投稿と同じ検査に、本文に URL が無いことを足す */
export function checkTodayThinkingImage(bundle, riskRules = []) {
  return mainReasons(bundle, riskRules, TODAY_THINKING_IMAGE_FORMAT, {
    noUrl: true,
  });
}

/** 思考投稿の展示後のリプ（format=today_thinking_reply）の検査（純粋関数） */
export function checkTodayThinkingReply(bundle, riskRules = []) {
  return commonReasons(
    bundle,
    TODAY_THINKING_REPLY_FORMAT,
    riskRules,
    { noUrl: true },
    replyImageSets(bundle?.race_id),
  );
}

/** 種類と部分ごとの bundle の検査 */
const CHECKS = {
  [FINALS_IMAGE_FORMAT]: { main: checkFinalsImage, reply: checkFinalsReply },
  [TODAY_THINKING_KIND]: {
    main: checkTodayThinkingImage,
    reply: checkTodayThinkingReply,
  },
};

/** PNG の幅と高さ（IHDR）。PNG でなければ null */
export function pngSize(bytes) {
  if (
    !(bytes instanceof Uint8Array) ||
    bytes.byteLength < 24 ||
    PNG_SIGNATURE.some((b, i) => bytes[i] !== b)
  )
    return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** 画像の検査（純粋関数）。names は bundle.images、files は名前→バイト（無いものは undefined） */
export function checkImages(names, files) {
  const reasons = [];
  for (const name of names) {
    const bytes = files[name];
    if (!bytes) {
      reasons.push(`${name} が無い`);
      continue;
    }
    if (bytes.byteLength < 1 || bytes.byteLength > IMAGE_MAX_BYTES)
      reasons.push(`${name} の大きさが不正（${bytes.byteLength} バイト）`);
    const size = pngSize(bytes);
    if (!size) reasons.push(`${name} が PNG でない`);
    else if (size.width !== IMAGE_WIDTH || size.height !== IMAGE_HEIGHT)
      reasons.push(
        `${name} が ${IMAGE_WIDTH}×${IMAGE_HEIGHT} でない（${size.width}×${size.height}）`,
      );
  }
  return reasons;
}

/**
 * 締切まわりの時刻（純粋関数）。止められる期限（veto_until）は今、送る時刻は SEND_DELAY_SEC の後。
 * item の CHECK（notify_by < veto_until < deadline_at、153）のため、notify_by は今の1分前
 */
export function schedule(deadlineAt, now) {
  return {
    deadline_at: deadlineAt,
    expires_at: minutesBefore(deadlineAt, EXPIRES_BEFORE_MIN),
    latest: minutesBefore(deadlineAt, LATEST_BEFORE_MIN),
    notify_by: new Date(now.getTime() - 60000).toISOString(),
    veto_until: now.toISOString(),
    send_at: new Date(now.getTime() + SEND_DELAY_SEC * 1000).toISOString(),
  };
}

/**
 * レース・段の検査（純粋関数）。DB から読んだ行を受ける。
 * 受け取る窓は [締切−earliestMin, 締切−latestMin)。本投稿は earliestMin なし・latestMin=8、展示後のリプは 25・13。
 * requiredStage は求める段（既定は優勝戦）。null なら段を見ない（思考投稿）
 */
export function checkRace({
  bundle,
  race,
  stage,
  now,
  earliestMin = null,
  latestMin = LATEST_BEFORE_MIN,
  requiredStage = FINALS_STAGE,
}) {
  const deadlineAt = race && deadlineIso(race);
  if (!deadlineAt) return { reasons: ["レースが見つからない"] };
  const reasons = [];
  if (race.cancellation_status != null) reasons.push("レースが中止");
  if (race.race_date !== jstDate(now)) reasons.push("今日のレースでない");
  if (requiredStage != null && stage !== requiredStage)
    reasons.push(`${requiredStage}でない（race_stage=${stage ?? "なし"}）`);
  // deadline は race_id の日付の JST の HH:MM（races.start_time の時・分と一致すること）
  if (race.start_time?.slice(0, 5) !== bundle.deadline)
    reasons.push(
      `deadline が races の締切（${race.start_time?.slice(0, 5)}）と違う`,
    );
  if (race.race_date !== bundle.race_id.slice(0, 10))
    reasons.push("race_id の日付が races と違う");
  if (
    earliestMin != null &&
    now.getTime() < Date.parse(minutesBefore(deadlineAt, earliestMin))
  )
    reasons.push(`締切の${earliestMin}分前より前`);
  if (now.getTime() >= Date.parse(minutesBefore(deadlineAt, latestMin)))
    reasons.push(`締切の${latestMin}分前を過ぎた`);
  return { reasons, deadlineAt };
}

/**
 * X の日の上限（sns_x_send_control.daily_limit_x、無ければ daily_limit）に need 本が入るか（純粋関数）。
 * 数え方は transition_sns_send_139 の claim と同じ（今日の JST の X の試行＋他経路の本数＋need）。入らなければ理由を返す。
 * 入らないまま job を作ると、claim が「日次全体上限です」で投げ続け、期限まで2分ごとに Slack が鳴る（2026-10-26 system-architect の P1）。
 * 本投稿は投票のリプと対で need=2（177 の claim も親の claim で子の分を数える）。
 * 本投稿（子でない job）は、177 の claim と同じく、他の親の予約の子（children のうち、親が今日 claim 済みのもの）も数える。
 * 展示後のリプ（子）は他の子を数えない（177 と同じ）
 */
export function dailyLimitReason({
  sendControl,
  jobs,
  now,
  need = 1,
  children = [],
}) {
  const limit = sendControl?.daily_limit_x ?? sendControl?.daily_limit;
  const today = jstDate(now);
  if (!limit || sendControl.daily_baseline_date !== today)
    return "X の日の上限・他経路の本数が今日の分として確かめられていない（daily_baseline_date）";
  const used = jobs.reduce(
    (n, job) =>
      n +
      (job.attempt_dates ?? []).filter(
        (day, i) => day === today && job.attempt_channels?.[i] === "x",
      ).length,
    0,
  );
  const external = sendControl.daily_external_count ?? 0;
  const reserved = reservedChildren({ jobs, children, today, now });
  return used + external + reserved + need > limit
    ? `X の日の上限 ${limit} に${need}本が入らない（今日の試行 ${used}・他経路 ${external}・予約の子 ${reserved}）`
    : null;
}

/**
 * 他の親の予約の子の数（純粋関数）。177 の transition_sns_send_139 の v_children の「他の親の子」と同じ条件:
 * 子は X・queued・attempts=0・期限の前・下書きの bundle_import_id が NULL（children は store.waitingChildren がこの形で読む）、
 * 親は今日の試行があり sending・reconcile・posted（jobs は今日の試行のある job）
 */
export function reservedChildren({ jobs, children, today, now }) {
  const claimed = new Set(
    jobs
      .filter(
        (job) =>
          ["sending", "reconcile", "posted"].includes(job.state) &&
          (job.attempt_dates ?? []).includes(today),
      )
      .map((job) => job.id),
  );
  return children.filter(
    (c) =>
      c.channel === "x" &&
      c.state === "queued" &&
      c.attempts === 0 &&
      Date.parse(c.expires_at) > now.getTime() &&
      c.bundle_import_id == null &&
      claimed.has(c.parent_job_id),
  ).length;
}

const raceUrlOf = (raceId) => `https://www.boat-ai.jp/race/${raceId}?tab=sonar`;

/** 送る直前の読み直しの材料（deadline_queue）。parentJobId はリプの親（本投稿の job） */
const queueOf = (bundle, { revision, when, observedAt, parentJobId }) => ({
  deadline_at: when.deadline_at,
  expires_at: when.expires_at,
  source_revision: revision,
  source_observed_at: observedAt,
  public_url: raceUrlOf(bundle.race_id),
  screen_key: "race-sonar",
  ...(parentJobId ? { parent_job_id: parentJobId } : {}),
});

/**
 * 下書きの行（純粋関数）。part は main（本投稿）・poll（投票のリプ）・reply（展示後のリプ）。
 * public_url は送る直前の表示の確認に使う。poll は媒体なし・source_data.x_poll（createXSnapshot が snapshot.poll に写す）。
 * poll は親の job ができるまで公開保留（子だけ先に承認されて単独の投稿にならない。/today の reply と同じ）。
 * kind は KINDS のキー（既定は優勝戦）。source_data のキーは種類ごとに1つだけ（digest・full_picture・他の種類のキーを入れない。
 * readCurrent がキーで振り分けるため）
 */
export function draftRow(
  bundle,
  {
    revision,
    paths = [],
    when,
    observedAt,
    part = "main",
    parentJobId = null,
    kind = FINALS_IMAGE_FORMAT,
  },
) {
  const cfg = KINDS[kind];
  const raceUrl = raceUrlOf(bundle.race_id);
  const poll = part === "poll";
  return {
    content_group_id: randomUUID(),
    language: "ja",
    status: "pending_review",
    format: cfg.draftFormat,
    platform: "x",
    title: `${cfg.title}${{ main: "", poll: "（投票のリプ）", reply: "（展示後のリプ）" }[part]} ${bundle.race_id}`,
    caption_text: poll ? bundle.poll_text : bundle.x_text,
    hashtags: [],
    publish_blocked: poll,
    publication_hold_reasons: [],
    send_lane: "A",
    scheduled_at: when.send_at,
    cover_image_path: paths[0] ?? null,
    source_data: {
      [cfg.sourceKey]: {
        race_id: bundle.race_id,
        revision,
        review: bundle.review,
        part,
      },
      // 承認の関数（160）が媒体をこの順で照合する（先頭は cover_image_path）
      ...(paths.length ? { image_paths: paths } : {}),
      // 投票は締切で閉じる（分は送る時に runXSendJob が決める）
      ...(poll
        ? { x_poll: { options: bundle.poll, closes_at: when.deadline_at } }
        : {}),
      // thread_length は入れない（送り手の検査が加重280で見る）
      deadline_queue: queueOf(bundle, {
        revision,
        when,
        observedAt,
        parentJobId,
      }),
      release_evidence: {
        status: "released",
        url: raceUrl,
        screen_key: "race-sonar",
        confirmed_by: "push-finals-image",
        reference: cfg.draftFormat,
        checked_at: observedAt,
        confirmed_at: observedAt,
      },
      qa: { pass: true, numeric_claims_match: true, L0_hits: [] },
    },
  };
}

/** item の行（純粋関数）。自動（notified）は止めるリンクを作らない（全貌と同じ。153 の CHECK が要るので使わない乱数のハッシュ） */
function itemRow(
  bundle,
  { draftId, variant, when, state, observedAt, kind = FINALS_IMAGE_FORMAT },
) {
  return {
    kind,
    variant,
    draft_id: draftId,
    channel: "x",
    race_id: bundle.race_id,
    deadline_at: when.deadline_at,
    notify_by: when.notify_by,
    veto_until: when.veto_until,
    state,
    checks: { passed: true, review: bundle.review, checked_at: observedAt },
    ...(state === "notified"
      ? {
          notified_at: observedAt,
          stop_token_hash: randomBytes(32).toString("hex"),
        }
      : {}),
  };
}

/**
 * 同じレース・同じ種類の生きている item を見る。送った・送っている item があれば { already } を返す。
 * 自動の item の job が送らずに終わった（held・failed・cancelled）か、承認の途中で落ちて job が無い item は、作り直す対象として返す
 */
async function liveOf(store, raceId, variant, kind) {
  const live = (await store.finalsItems(raceId, variant, kind)).filter(
    (i) => !["stopped", "held_manual"].includes(i.state),
  );
  const retry = [];
  for (const item of live) {
    const job = await store.jobForDraft(item.draft_id);
    if (
      item.state === "notified" &&
      (!job || RETRYABLE_JOB_STATES.includes(job.state))
    )
      retry.push(item);
    else
      return {
        already: {
          already: true,
          reason: `同じレースの ${variant} が既にある（item ${item.state}・job ${job?.state ?? "なし"}）。作らなかった`,
          status: statusOf(raceId, item, job),
        },
      };
  }
  return { retry };
}

/** フォルダの画像（bundle.images の名前）を読み、検査する。読めない（ENOENT 以外）は原因を残す */
async function readImages(folder, names, readBytes) {
  const files = {};
  const readErrors = [];
  for (const name of names) {
    try {
      files[name] = await readBytes(path.join(folder, name));
    } catch (error) {
      files[name] = undefined;
      // 無い（ENOENT）は checkImages が「無い」と書く。それ以外（権限・I/O）は原因を残す
      if (error?.code && error.code !== "ENOENT")
        readErrors.push(
          `${name} を読めない（${error.code}: ${error.message}）`,
        );
    }
  }
  return { files, reasons: [...readErrors, ...checkImages(names, files)] };
}

/** 下書きを自動送信の承認者で承認する（媒体は手元のバイトで hash を取る） */
async function approveDraft(
  store,
  draft,
  approverId,
  when,
  byPath = new Map(),
) {
  const snapshot = await createXSnapshot(draft, async (p) =>
    byPath.has(p)
      ? byPath.get(p)
      : Promise.reject(new Error("媒体の path が違う")),
  );
  return store.approve({
    p_draft_id: draft.id,
    p_approver_id: approverId,
    p_snapshot: snapshot,
    p_scheduled_at: when.send_at,
  });
}

/**
 * その日の /today の X 投稿の対象（today-picks.js の readTodayPicks の featured か list）に race_id が入っているか（純粋関数）。
 * 入っていなければ理由を返す（思考投稿は /today の対象レースだけに出す。審査の P2）
 */
export function todayTargetReason(picks, raceId) {
  if (!picks?.draft_id)
    return "その日の /today の X 投稿が無い（today_thinking の対象を確かめられない）";
  // 送られた /today の投稿の対象だけ（held・pending_review のまま出ていない投稿の候補には出さない。hq は呼び直すので、8:00 の後に通る）
  if (picks.status !== "posted")
    return `その日の /today の X 投稿がまだ送られていない（status=${picks.status ?? "不明"}）`;
  const ids = [picks.featured, ...(picks.list ?? [])]
    .filter(Boolean)
    .map((r) => r.race_id);
  return ids.includes(raceId)
    ? null
    : `/today の X 投稿の対象でない（${raceId}）`;
}

/**
 * 受け取って送る予定に入れる。deps は DB・Storage・Slack（テストで差し替える）。bundle.format で種類（優勝戦・思考投稿）と
 * 本投稿・展示後のリプを分ける（BUNDLE_FORMATS）。
 * 返り値: { reasons }（不合格）・{ dryRun, disabled }（書かなかった）・{ already }・{ part, draft_id, item_id, job_id, send_at, ... }。
 * どれにも part と kind（item の kind）が付く
 */
export async function pushFinalsImage(
  folder,
  {
    store,
    readBytes,
    notify = async () => {},
    riskRules = [],
    now = new Date(),
    dryRun = false,
  },
) {
  const bundle = JSON.parse(
    new TextDecoder().decode(await readBytes(path.join(folder, "bundle.json"))),
  );
  const { kind, part } = bundleKindOf(bundle?.format);
  const cfg = KINDS[kind];
  const reply = part === "reply";
  const head = { part, kind };
  const label = cfg.label[part];
  // 読むのはこの種類の許可の列だけ（他の種類の列が無い＝マイグレーションの前でも、この種類の許可を外さない）
  const controls = await store.controls(cfg.flag);
  // 列が無い（176・189 が未適用）・行が無いときも off（fail-closed）。許可は本投稿・投票のリプ・展示後のリプに共通
  const enabled = controls.x?.[cfg.flag] === true;
  const writes = enabled && !dryRun;
  const reject = async (reasons) => {
    if (writes)
      await notify(
        `SNS ${label} ${bundle?.race_id ?? "不明"} を検査で拒否した\n${reasons.join("\n")}`,
      ).catch((error) =>
        console.error(`Slack に通知できません: ${error.message}`),
      );
    return { ...head, reasons };
  };
  const reasons = CHECKS[kind][part](bundle, riskRules);
  if (reasons.length) return reject(reasons);
  // 起こす係（hq finals_run.py）は2分ごとに呼ぶ。同じレース・同じ種類の生きている item・送った item があれば
  // 何も作らず、今の状態を返す（DB の一意の索引でも止まる、176・177）。送らずに終わった自動の item は superseded で止めて作り直す
  const variant = cfg.variants[part];
  const live = await liveOf(store, bundle.race_id, variant, kind);
  if (live.already) return { ...head, ...live.already };
  const retry = [...live.retry];
  if (!reply) {
    // 投票のリプは本投稿と対で作り直す（本投稿を作り直すなら、前の投票のリプも止める）
    const poll = (
      await store.finalsItems(bundle.race_id, cfg.variants.poll, kind)
    ).filter((i) => !["stopped", "held_manual", "sent"].includes(i.state));
    retry.push(...poll);
  }
  // 展示後のリプの親は、送った本投稿（job が posted で tweet id がある）。item の状態ではなく job で見る
  // （要照合の後で手で complete した等で item が sent にならない場合も、送った本投稿につなぐ）
  let parentJob = null;
  if (reply) {
    for (const item of await store.finalsItems(
      bundle.race_id,
      cfg.variants.main,
      kind,
    )) {
      const job = await store.jobForDraft(item.draft_id);
      if (job?.state === "posted" && job.external_post_id) {
        parentJob = job;
        break;
      }
    }
    if (!parentJob)
      return reject(["本投稿がまだ送られていない（リプの親が無い）"]);
  }
  const names = bundle.images;
  const { files, reasons: imageReasons } = await readImages(
    folder,
    names,
    readBytes,
  );
  if (imageReasons.length) return reject(imageReasons);
  const [race, stage, sendControl, todayJobs, children, picks] =
    await Promise.all([
      store.race(bundle.race_id),
      // 段を見ない種類（思考投稿）は race_conditions を読まない
      cfg.stage ? store.stage(bundle.race_id) : null,
      store.sendControl(),
      store.jobsAttemptedOn(jstDate(now)),
      reply ? [] : store.waitingChildren(now),
      cfg.todayTarget ? store.todayPicks(jstDate(now)) : null,
    ]);
  const raceCheck = checkRace({
    bundle,
    race,
    stage,
    now,
    requiredStage: cfg.stage,
    ...(reply
      ? {
          earliestMin: REPLY_EARLIEST_BEFORE_MIN,
          latestMin: REPLY_LATEST_BEFORE_MIN,
        }
      : {}),
  });
  // 本投稿が上限で入らなければ投票のリプも作らない（対で2本分）
  const limitReason = dailyLimitReason({
    sendControl,
    jobs: todayJobs,
    now,
    need: reply ? 1 : 2,
    children,
  });
  if (limitReason) raceCheck.reasons.push(limitReason);
  if (cfg.todayTarget) {
    const targetReason = todayTargetReason(picks, bundle.race_id);
    if (targetReason) raceCheck.reasons.push(targetReason);
  }
  // 出し物ごとの取り置き（182、docs/design/x-daily-slots/plan.md）。他の出し物の取り置きの残りを使わないか。
  // 182 の前・読めないときは上の日の上限だけで決める（送り手の claim が正）
  const xSlot = store.xSlotRoom
    ? await checkXSlot(store.xSlotRoom, cfg.slot, reply ? 1 : 2)
    : null;
  if (xSlot?.blocked) raceCheck.reasons.push(xSlot.reason);
  if (xSlot?.note) console.error(xSlot.note);
  if (raceCheck.reasons.length) return reject(raceCheck.reasons);
  const when = schedule(raceCheck.deadlineAt, now);
  const hash = createHash("sha256").update(JSON.stringify(bundle));
  for (const name of names) hash.update(files[name]);
  const revision = hash.digest("hex").slice(0, 32);
  if (!writes)
    return {
      ...head,
      dryRun: true,
      enabled,
      // --dry-run でなく、許可が off なので書かなかった（exit 3）
      disabled: !dryRun,
      revision,
      when,
    };

  // 前の item を止め、下書きを公開保留に戻す（148 のトリガーが承認を外し、queued・held の job を取り消す。
  // 止めた本投稿を親に持つ投票のリプの job が queued のまま残り、送り手が「親を待つ」を知らせ続けないように）
  for (const item of retry) {
    await store.updateItem(item.id, item.state, {
      state: "stopped",
      stopped_at: now.toISOString(),
      stopped_via: "superseded",
    });
    await store.updateDraft(item.draft_id, { publish_blocked: true });
  }
  const paths = names.map(
    (name) =>
      `${cfg.storage}/${bundle.race_id}/${revision}/${reply ? "reply-" : ""}${name}`,
  );
  for (const [i, name] of names.entries())
    await store.saveFile(paths[i], files[name]);
  const observedAt = now.toISOString();
  const auto = controls.x?.mode === "auto" && controls.x?.auto_approver_id;
  const byPath = new Map(paths.map((p, i) => [p, files[names[i]]]));
  const out = reply
    ? await pushReplyRows(store, bundle, {
        revision,
        paths,
        when,
        observedAt,
        auto,
        approverId: controls.x?.auto_approver_id,
        parentJob,
        byPath,
        kind,
      })
    : await pushMainRows(store, bundle, {
        revision,
        paths,
        when,
        observedAt,
        auto,
        approverId: controls.x?.auto_approver_id,
        byPath,
        kind,
      });
  const line = out.send_at
    ? `x: 今すぐ送る（送り手の次の実行、期限 ${jstTime(when.expires_at)}${reply ? "" : "。投票のリプは本投稿の公開の後"}）${controls.x?.dry_run !== false ? "（試運転中: claim の前で止まる）" : ""}`
    : out.error
      ? `x: 自動の承認に失敗（${reply ? "個別承認に回した" : "本投稿・投票のリプとも止めた"}）: ${out.error}`
      : reply
        ? "x: 自動モードでないので個別承認で承認する"
        : "x: 自動モードでないので送らない（投票のリプは自動の道だけでつなぐ。本投稿だけを出さない）";
  await notify(
    `SNS ${label} ${bundle.race_id}（締切 ${jstTime(when.deadline_at)}）\n${line}\n止めるには: ${cfg.stopSql}`,
  ).catch((error) => console.error(`Slack に通知できません: ${error.message}`));
  return { ...head, ...out, revision, when };
}

/**
 * 本投稿と投票のリプの行を作る。自動なら本投稿を承認し、その job を投票のリプの deadline_queue.parent_job_id に入れて公開保留を外してから承認する
 * （/today の reply と同じ順、snsTodayPlanner.js）。どこかで落ちたら親子とも held_manual（投票のリプの無い本投稿だけを出さない）。
 * 自動でないときも親子とも held_manual（子を親につなぐのが自動の道だけのため）
 */
async function pushMainRows(
  store,
  bundle,
  {
    revision,
    paths,
    when,
    observedAt,
    auto,
    approverId,
    byPath,
    kind = FINALS_IMAGE_FORMAT,
  },
) {
  const { variants } = KINDS[kind];
  const state = auto ? "notified" : "held_manual";
  const draft = await store.insertDraft(
    draftRow(bundle, { revision, paths, when, observedAt, kind }),
  );
  let pollDraft = await store.insertDraft(
    draftRow(bundle, { revision, when, observedAt, part: "poll", kind }),
  );
  const heldReason = auto
    ? null
    : "自動モードでない（投票のリプは自動の道だけでつなぐ）";
  const item = await store.insertItem({
    ...itemRow(bundle, {
      draftId: draft.id,
      variant: variants.main,
      when,
      state,
      observedAt,
      kind,
    }),
    ...(heldReason ? { held_reason: heldReason } : {}),
  });
  const pollItem = await store.insertItem({
    ...itemRow(bundle, {
      draftId: pollDraft.id,
      variant: variants.poll,
      when,
      state,
      observedAt,
      kind,
    }),
    ...(heldReason ? { held_reason: heldReason } : {}),
  });
  const out = {
    draft_id: draft.id,
    item_id: item.id,
    poll_draft_id: pollDraft.id,
    poll_item_id: pollItem.id,
    auto: Boolean(auto),
  };
  if (!auto) return out;
  try {
    const job = await approveDraft(store, draft, approverId, when, byPath);
    if (!job?.id) throw new Error("本投稿の job の id を受け取れない");
    pollDraft = await store.updateDraft(pollDraft.id, {
      source_data: {
        ...pollDraft.source_data,
        deadline_queue: {
          ...pollDraft.source_data.deadline_queue,
          parent_job_id: job.id,
        },
      },
      publish_blocked: false,
    });
    const pollJob = await approveDraft(store, pollDraft, approverId, when);
    out.job_id = job.id;
    out.poll_job_id = pollJob?.id ?? null;
    out.send_at = when.send_at;
  } catch (error) {
    out.error = error.message;
    delete out.job_id;
    // 承認した本投稿の job は、item が notified でないと claim で止まる（transition_sns_x_send の auto_stopped）
    for (const row of [item, pollItem])
      await store
        .updateItem(row.id, "notified", {
          state: "held_manual",
          held_reason: `投票のリプの自動の承認に失敗: ${error.message.split("\n")[0]}`,
        })
        .catch((updateError) => {
          // item が notified のまま。次の呼び出しで superseded にして作り直す
          console.error(
            `item ${row.id} を held_manual に戻せない: ${updateError.message}`,
          );
          out.error += `（item ${row.id} を戻せない: ${updateError.message}）`;
        });
  }
  return out;
}

/** 展示後のリプの行を作る。親（本投稿の job）は deadline_queue.parent_job_id。自動でなければ manual（個別承認でも親につながっている） */
async function pushReplyRows(
  store,
  bundle,
  {
    revision,
    paths,
    when,
    observedAt,
    auto,
    approverId,
    parentJob,
    byPath,
    kind = FINALS_IMAGE_FORMAT,
  },
) {
  const draft = await store.insertDraft(
    draftRow(bundle, {
      revision,
      paths,
      when,
      observedAt,
      part: "reply",
      parentJobId: parentJob.id,
      kind,
    }),
  );
  const item = await store.insertItem(
    itemRow(bundle, {
      draftId: draft.id,
      variant: KINDS[kind].variants.reply,
      when,
      state: auto ? "notified" : "manual",
      observedAt,
      kind,
    }),
  );
  const out = { draft_id: draft.id, item_id: item.id, auto: Boolean(auto) };
  if (!auto) return out;
  try {
    const job = await approveDraft(store, draft, approverId, when, byPath);
    out.job_id = job?.id ?? null;
    out.send_at = when.send_at;
  } catch (error) {
    out.error = error.message;
    try {
      await store.updateItem(item.id, "notified", { state: "manual" });
    } catch (updateError) {
      // item が notified のまま job が無い。次の呼び出しで superseded にして作り直す
      console.error(
        `item ${item.id} を manual に戻せない: ${updateError.message}`,
      );
      out.error += `（item を manual に戻せない: ${updateError.message}）`;
    }
  }
  return out;
}

/** 作り直してよい job の状態（送らずに終わった） */
export const RETRYABLE_JOB_STATES = ["held", "failed", "cancelled"];

/** item と job から、hq に返す状態（純粋関数） */
export const statusOf = (raceId, item, job) => ({
  race_id: raceId,
  item_state: item?.state ?? null,
  job_id: job?.id ?? null,
  job_state: job?.state ?? null,
  error_code: job?.error_code ?? null,
  posted_at: job?.posted_at ?? null,
  tweet_id: job?.external_post_id ?? null,
  tweet_url: job?.external_post_url ?? null,
});

/** 1つの種類の状態。新しい順に、生きている item（無ければ最新の item）の job。item が無ければ null */
async function variantStatus(raceId, variant, store, kind) {
  const items = await store.finalsItems(raceId, variant, kind);
  const item =
    items.find((i) => !["stopped", "held_manual"].includes(i.state)) ??
    items[0];
  if (!item) return null;
  return statusOf(raceId, item, await store.jobForDraft(item.draft_id));
}

/**
 * 送った時刻・tweet id（hq の記録用）。本投稿の状態に、投票のリプ（poll）・展示後のリプ（reply）の状態を添える。本投稿が無ければ null。
 * kind は KINDS のキー（既定は優勝戦）
 */
export async function finalsStatus(
  raceId,
  { store, kind = FINALS_IMAGE_FORMAT },
) {
  const { variants } = KINDS[kind];
  const main = await variantStatus(raceId, variants.main, store, kind);
  if (!main) return null;
  return {
    ...main,
    poll: await variantStatus(raceId, variants.poll, store, kind),
    reply: await variantStatus(raceId, variants.reply, store, kind),
  };
}

/** 送り手の結果を待つ間隔と、期限の後に待つ時間（送り手の最後の実行の終わりを待つ） */
export const WAIT_POLL_SEC = 15;
export const WAIT_AFTER_EXPIRES_SEC = 90;
// reconcile は begin_post から complete までの送っている途中でもあるので、終わりに数えない（期限＋90秒まで待つ）
const DONE_STATES = ["posted", ...RETRYABLE_JOB_STATES];

/**
 * この push の job（draft で引く）が送り終わる（posted・held 等）か、期限＋WAIT_AFTER_EXPIRES_SEC を過ぎるまで待つ。
 * pollDraftId（本投稿）があれば、本投稿が posted になった後、投票のリプも送り終わるまで待ち、status.poll に入れる
 */
export async function waitForSend(
  raceId,
  {
    store,
    draftId,
    pollDraftId = null,
    expiresAt,
    now = () => new Date(),
    sleep,
  },
) {
  const until = Date.parse(expiresAt) + WAIT_AFTER_EXPIRES_SEC * 1000;
  for (;;) {
    const status = statusOf(raceId, null, await store.jobForDraft(draftId));
    const timedOut = now().getTime() >= until;
    if (DONE_STATES.includes(status.job_state) || timedOut) {
      if (!pollDraftId) return status;
      const poll = statusOf(raceId, null, await store.jobForDraft(pollDraftId));
      if (
        status.job_state !== "posted" ||
        DONE_STATES.includes(poll.job_state) ||
        timedOut
      )
        return { ...status, poll };
    }
    await sleep(WAIT_POLL_SEC);
  }
}

/** 結果の1行と exit の番号（純粋関数）。status は待った結果（--no-wait なら null） */
export function resultLine(
  raceId,
  result,
  status = null,
  { waited = Boolean(status) } = {},
) {
  const pollPending =
    result.part !== "reply" &&
    status?.job_state === "posted" &&
    status.poll?.job_state !== "posted";
  const outcome = result.reasons?.length
    ? "rejected"
    : result.already
      ? "already_exists"
      : result.disabled
        ? "disabled"
        : result.dryRun
          ? "dry_run_ok"
          : status?.job_state === "posted"
            ? pollPending
              ? "poll_not_posted"
              : "posted"
            : result.job_id && !waited
              ? "queued"
              : "not_posted";
  const code = {
    posted: 0,
    dry_run_ok: 0,
    queued: 0,
    rejected: 1,
    disabled: 3,
    already_exists: 4,
    not_posted: 5,
    poll_not_posted: 5,
    error: 6,
  }[outcome];
  const s = status ?? result.status ?? null;
  const line = {
    race_id: raceId ?? null,
    part: result.part ?? "main",
    // 優勝戦の行は今までと同じバイト列にする（kind は思考投稿の行にだけ足す）
    ...(result.kind && result.kind !== FINALS_IMAGE_FORMAT
      ? { kind: result.kind }
      : {}),
    outcome,
    job_id: s?.job_id ?? result.job_id ?? null,
    job_state: s?.job_state ?? null,
    tweet_id: s?.tweet_id ?? null,
    tweet_url: s?.tweet_url ?? null,
    posted_at: s?.posted_at ?? null,
    error_code: s?.error_code ?? result.error ?? null,
    reason:
      result.reasons?.join(" / ") ??
      result.reason ??
      (result.disabled
        ? `自動送信の許可（${KINDS[result.kind]?.flag ?? KINDS[FINALS_IMAGE_FORMAT].flag}）が off なので送らなかった`
        : pollPending
          ? "本投稿は出たが、投票のリプが出ていない"
          : null),
    poll_job_id: s?.poll?.job_id ?? result.poll_job_id ?? null,
    poll_job_state: s?.poll?.job_state ?? null,
    poll_tweet_id: s?.poll?.tweet_id ?? null,
    poll_error_code: s?.poll?.error_code ?? null,
  };
  return { code, text: `FINALS_RESULT ${JSON.stringify(line)}` };
}
/** PostgREST・Storage の読み書き（service_role）。失敗は投げる */
export function createRestStore({ url, key, fetchImpl = fetch }) {
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  async function call(p, { method = "GET", body } = {}) {
    const response = await fetchImpl(`${url}/rest/v1/${p}`, {
      method,
      headers: {
        ...headers,
        ...(body !== undefined
          ? {
              "Content-Type": "application/json",
              Prefer: "return=representation",
            }
          : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    if (!response.ok)
      throw new Error(
        `DB 操作に失敗: HTTP ${response.status} ${method} ${p.split("?")[0]} ${text.slice(0, 300)}`,
      );
    return text ? JSON.parse(text) : null;
  }
  const one = (rows, what) => {
    if (!Array.isArray(rows) || rows.length !== 1) throw new Error(what);
    return rows[0];
  };
  const id = (raceId) => encodeURIComponent(raceId);
  return {
    race: async (raceId) =>
      (
        await call(
          `races?race_id=eq.${id(raceId)}&select=race_id,race_date,start_time,cancellation_status`,
        )
      )[0] ?? null,
    stage: async (raceId) =>
      (
        await call(`race_conditions?race_id=eq.${id(raceId)}&select=race_stage`)
      )[0]?.race_stage ?? null,
    // kind は KINDS のキー（既定は優勝戦）。variant は種類ごとに違うが、kind でも絞る
    finalsItems: (raceId, variant, kind = FINALS_IMAGE_FORMAT) =>
      call(
        `sns_auto_send_items?kind=eq.${KINDS[kind].kind}&variant=eq.${variant}&race_id=eq.${id(raceId)}&select=id,state,draft_id&order=created_at.desc`,
      ),
    // 許可の列（flag、既定は finals_image_enabled）が無い（176・189 が未適用）と PostgREST が 400 を返すので、その時は列なしで読み直して off とする。
    // 読むのは呼んだ種類の列だけ（他の種類の列を同じ select に並べると、189 の前に finals_image_enabled まで外れて優勝戦が止まる）
    async controls(flag = KINDS[FINALS_IMAGE_FORMAT].flag) {
      if (!Object.values(KINDS).some((k) => k.flag === flag))
        throw new Error(`許可の列 ${flag} を知らない`);
      let rows;
      try {
        rows = await call(
          `sns_auto_send_control?select=channel,mode,dry_run,auto_approver_id,${flag}`,
        );
      } catch (error) {
        if (!/HTTP 400/.test(error.message)) throw error;
        const migration = Object.values(KINDS).find(
          (k) => k.flag === flag,
        ).migration;
        console.error(
          `${flag} の列が無い（マイグレーション ${migration} が未適用）。許可は off として扱う`,
        );
        rows = await call(
          "sns_auto_send_control?select=channel,mode,dry_run,auto_approver_id",
        );
      }
      return Object.fromEntries(rows.map((r) => [r.channel, r]));
    },
    sendControl: async () =>
      (
        await call(
          "sns_x_send_control?id=eq.true&select=daily_limit,daily_limit_x,daily_baseline_date,daily_external_count",
        )
      )[0] ?? null,
    // X の日の枠の取り置きの残り（182）
    xSlotRoom: xSlotRoomVia(call),
    // その日の /today の X 投稿の対象（思考投稿の受け取りの条件、today-picks.js と同じ読み方）
    todayPicks: (date) => readTodayPicks(date, call),
    // 今日（JST）に試行のある job（X・YouTube の両方。数えるのは dailyLimitReason が X だけ）
    jobsAttemptedOn: (day) =>
      call(
        `sns_x_send_jobs?attempt_dates=cs.${encodeURIComponent(`{${day}}`)}&select=id,state,attempt_dates,attempt_channels`,
      ),
    // まだ claim していない X の子（親の予約の枠。reservedChildren が親で絞る）
    waitingChildren: async (now) =>
      (
        await call(
          `sns_x_send_jobs?state=eq.queued&attempts=eq.0&channel=eq.x&parent_job_id=not.is.null&expires_at=gt.${encodeURIComponent(now.toISOString())}&select=id,state,channel,attempts,expires_at,parent_job_id,sns_drafts(bundle_import_id)`,
        )
      ).map(({ sns_drafts: draft, ...job }) => ({
        ...job,
        bundle_import_id: draft?.bundle_import_id ?? null,
      })),
    jobForDraft: async (draftId) =>
      (
        await call(
          `sns_x_send_jobs?draft_id=eq.${draftId}&select=id,state,error_code,posted_at,external_post_id,external_post_url`,
        )
      )[0] ?? null,
    async saveFile(p, bytes) {
      const response = await fetchImpl(
        `${url}/storage/v1/object/sns-hub-media/${p}`,
        {
          method: "POST",
          headers: {
            ...headers,
            "Content-Type": "image/png",
            "x-upsert": "true",
          },
          body: bytes,
        },
      );
      if (!response.ok)
        throw new Error(`画像を保存できない: HTTP ${response.status} ${p}`);
    },
    insertDraft: async (row) =>
      one(
        await call("sns_drafts", { method: "POST", body: row }),
        "下書きを作れない",
      ),
    insertItem: async (row) =>
      one(
        await call("sns_auto_send_items", { method: "POST", body: row }),
        "item を作れない",
      ),
    updateDraft: async (draftId, patch) =>
      one(
        await call(`sns_drafts?id=eq.${draftId}`, {
          method: "PATCH",
          body: patch,
        }),
        `下書き ${draftId} を更新できない`,
      ),
    updateItem: async (itemId, fromState, patch) =>
      one(
        await call(
          `sns_auto_send_items?id=eq.${itemId}&state=eq.${fromState}`,
          {
            method: "PATCH",
            body: { ...patch, updated_at: new Date().toISOString() },
          },
        ),
        `item ${itemId} を更新できない`,
      ),
    approve: (args) =>
      call("rpc/approve_sns_x_send", { method: "POST", body: args }),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const usage =
    "使い方: node --env-file=.env.local scripts/sns/push-finals-image.js <フォルダ> [--dry-run] [--no-wait] | --status <race_id> [--kind today_thinking]";
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.error("SUPABASE_URL・SUPABASE_SERVICE_KEY が無い（.env.local）");
    process.exit(2);
  }
  const store = createRestStore({ url, key });
  if (args[0] === "--status") {
    const kindAt = args.indexOf("--kind");
    const kind = kindAt > 0 ? args[kindAt + 1] : FINALS_IMAGE_FORMAT;
    if (
      !args[1] ||
      args[1].startsWith("--") ||
      !Object.hasOwn(KINDS, kind ?? "")
    ) {
      console.error(usage);
      process.exit(2);
    }
    console.log(
      JSON.stringify(await finalsStatus(args[1], { store, kind }), null, 2),
    );
    return;
  }
  const dryRun = args.includes("--dry-run");
  const folder = args.find((a) => !a.startsWith("--"));
  if (!folder) {
    console.error(usage);
    process.exit(2);
  }
  const webhook =
    process.env.SLACK_WEBHOOK_URL || process.env.SLACK_DIGEST_WEBHOOK_URL;
  const riskRules = JSON.parse(
    await readFile(
      new URL(
        "../../sns-video-studio/remotion/risk-rules.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ).rules;
  let bundleRaceId = null;
  try {
    bundleRaceId = JSON.parse(
      await readFile(path.join(folder, "bundle.json"), "utf8"),
    ).race_id;
  } catch {
    /* 読めない bundle.json は pushFinalsImage が投げ、下で error の1行にする */
  }
  // どこで落ちても、最後の1行は FINALS_RESULT（exit 6）
  const fail = (error) => {
    console.error(error);
    console.log(
      `FINALS_RESULT ${JSON.stringify({ race_id: bundleRaceId ?? null, outcome: "error", reason: String(error?.message ?? error) })}`,
    );
    process.exit(6);
  };
  const result = await pushFinalsImage(folder, {
    store,
    readBytes: async (p) => {
      await stat(p);
      return new Uint8Array(await readFile(p));
    },
    notify: async (text) => {
      console.log(text);
      if (!webhook) return;
      const response = await fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!response.ok)
        throw new Error(`Slack が HTTP ${response.status} を返した`);
    },
    riskRules,
    dryRun,
  }).catch(fail);
  console.log(JSON.stringify(result, null, 2));
  const status =
    result.job_id && !args.includes("--no-wait")
      ? await waitForSend(bundleRaceId, {
          store,
          draftId: result.draft_id,
          pollDraftId: result.poll_draft_id ?? null,
          expiresAt: result.when.expires_at,
          sleep: (sec) => new Promise((r) => setTimeout(r, sec * 1000)),
        }).catch(fail)
      : null;
  const { code, text } = resultLine(bundleRaceId, result, status);
  console.log(text);
  process.exit(code);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
