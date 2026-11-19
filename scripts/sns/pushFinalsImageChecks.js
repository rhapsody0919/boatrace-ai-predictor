// bundle.json・レース・段の検査（純粋関数）。push-finals-image.js から移した（snsXSend・snsXLength・snsClaimCheck に依るので scripts/sns の隣）。
import twitterText from "twitter-text";
import { pollOptionsIssue } from "../../api/_lib/snsXSend.js";
import { deadlineIso } from "../../api/_lib/snsClaimCheck.js";
import { xPostValid } from "../../api/_lib/snsXLength.js";
import { matchRiskRules, draftRiskFields } from "../lib/riskRuleMatcher.js";
import {
  BANNED_WORDS,
  FINALS_IMAGE_FORMAT,
  FINALS_REPLY_FORMAT,
  FINALS_STAGE,
  LATEST_BEFORE_MIN,
  POLL_OPTIONS,
  TODAY_THINKING_IMAGE_FORMAT,
  TODAY_THINKING_REPLY_FORMAT,
  hasPoll,
  imageNamesOf,
  jstDate,
  minutesBefore,
} from "../lib/sns/finalsImageBase.js";
import { TODAY_THINKING_KIND } from "./pushFinalsImageKinds.js";

const RACE_URL =
  /^https:\/\/www\.boat-ai\.jp\/race\/([0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{2}-[0-9]{2})(?:[?#]|$)/;

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

const formatReasons = (bundle, format) =>
  bundle?.format !== format ? [`format が ${format} でない`] : [];

const raceIdReasons = (bundle) =>
  /^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}$/.test(bundle?.race_id ?? "")
    ? []
    : ["race_id が不正"];

const deadlineFormatReasons = (bundle) =>
  /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(bundle?.deadline ?? "")
    ? []
    : ["deadline が HH:MM でない"];

function imageNameReasons(bundle) {
  const expected = imageNamesOf(bundle?.race_id);
  if (
    !Array.isArray(bundle?.images) ||
    bundle.images.length !== expected.length ||
    bundle.images.some((name, i) => name !== expected[i])
  )
    return [`images が ${expected.join(",")} の4つ・この順でない`];
  return [];
}

const p0Reasons = (bundle) =>
  bundle?.review?.p0_count !== 0
    ? [`機械の検査の P0 が0件でない（${bundle?.review?.p0_count}）`]
    : [];

/** 本投稿と展示後のリプに共通の bundle の検査（純粋関数）。text は textReasons の追加の設定 */
function commonReasons(bundle, format, riskRules, text = {}) {
  return [
    ...formatReasons(bundle, format),
    ...raceIdReasons(bundle),
    ...deadlineFormatReasons(bundle),
    ...imageNameReasons(bundle),
    ...p0Reasons(bundle),
    ...textReasons(bundle?.x_text, bundle?.race_id, riskRules, "x_text", text),
  ];
}

/**
 * 本投稿の bundle.json の検査（純粋関数、format で優勝戦と思考投稿を分ける）。投票は任意（BOA-1208）。
 * poll・poll_text のどちらかがあれば、両方そろって 4択・poll_text の検査が通ること
 */
function mainReasons(bundle, riskRules, format, text = {}) {
  const reasons = commonReasons(bundle, format, riskRules, text);
  if (!hasPoll(bundle)) return reasons;
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

/** 本投稿の bundle.json の検査（純粋関数）。不合格は理由の配列を返す。投票（poll 4択・poll_text）は任意 */
export function checkFinalsImage(bundle, riskRules = []) {
  return mainReasons(bundle, riskRules, FINALS_IMAGE_FORMAT);
}

/** 展示後のリプの bundle.json の検査（純粋関数） */
export function checkFinalsReply(bundle, riskRules = []) {
  return commonReasons(bundle, FINALS_REPLY_FORMAT, riskRules);
}

/** 思考投稿の本投稿（format=today_thinking_image）の検査（純粋関数）。優勝戦の本投稿と同じ検査に、本文に URL が無いことを足す */
export function checkTodayThinkingImage(bundle, riskRules = []) {
  return mainReasons(bundle, riskRules, TODAY_THINKING_IMAGE_FORMAT, {
    noUrl: true,
  });
}

/** 思考投稿の展示後のリプ（format=today_thinking_reply）の検査（純粋関数） */
export function checkTodayThinkingReply(bundle, riskRules = []) {
  return commonReasons(bundle, TODAY_THINKING_REPLY_FORMAT, riskRules, {
    noUrl: true,
  });
}

/** 種類と部分ごとの bundle の検査 */
export const CHECKS = {
  [FINALS_IMAGE_FORMAT]: { main: checkFinalsImage, reply: checkFinalsReply },
  [TODAY_THINKING_KIND]: {
    main: checkTodayThinkingImage,
    reply: checkTodayThinkingReply,
  },
};

/** races の行の状態の検査（中止・今日・段）。requiredStage が null なら段を見ない */
function raceStateReasons(race, stage, now, requiredStage) {
  const reasons = [];
  if (race.cancellation_status != null) reasons.push("レースが中止");
  if (race.race_date !== jstDate(now)) reasons.push("今日のレースでない");
  if (requiredStage != null && stage !== requiredStage)
    reasons.push(`${requiredStage}でない（race_stage=${stage ?? "なし"}）`);
  return reasons;
}

/** 締切・日付の bundle と races の突き合わせ */
function raceMatchReasons(bundle, race) {
  const reasons = [];
  // deadline は race_id の日付の JST の HH:MM（races.start_time の時・分と一致すること）
  if (race.start_time?.slice(0, 5) !== bundle.deadline)
    reasons.push(
      `deadline が races の締切（${race.start_time?.slice(0, 5)}）と違う`,
    );
  if (race.race_date !== bundle.race_id.slice(0, 10))
    reasons.push("race_id の日付が races と違う");
  return reasons;
}

/** 受け取る窓 [締切−earliestMin, 締切−latestMin) の検査 */
function windowReasons(deadlineAt, now, earliestMin, latestMin) {
  const reasons = [];
  if (
    earliestMin != null &&
    now.getTime() < Date.parse(minutesBefore(deadlineAt, earliestMin))
  )
    reasons.push(`締切の${earliestMin}分前より前`);
  if (now.getTime() >= Date.parse(minutesBefore(deadlineAt, latestMin)))
    reasons.push(`締切の${latestMin}分前を過ぎた`);
  return reasons;
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
  const reasons = [
    ...raceStateReasons(race, stage, now, requiredStage),
    ...raceMatchReasons(bundle, race),
    ...windowReasons(deadlineAt, now, earliestMin, latestMin),
  ];
  return { reasons, deadlineAt };
}
