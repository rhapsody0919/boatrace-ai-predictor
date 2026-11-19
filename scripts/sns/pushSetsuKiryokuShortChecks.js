/**
 * 節の機力の Shorts の bundle・動画・説明欄の検査（純粋関数）。push-setsu-kiryoku-short.js から移した（字は同じ。checkShortBundle の中身だけ段に分けた）
 */
import twitterText from "twitter-text";
import { YOUTUBE_MEDIA_MAX_BYTES } from "../../api/_lib/snsXSend.js";
import { venueCodeOf } from "../../api/_lib/snsSetsuKiryokuShort.js";
import { checkBundle } from "../../sns-video-studio/remotion/src/setsuKiryoku/model.js";
import { matchRiskRules } from "../lib/riskRuleMatcher.js";
import { mp4Info } from "../lib/sns/mp4Info.js";
import {
  isHhmm,
  isIso,
  SEND_TIME_EARLIEST,
  SEND_TIME_LATEST,
} from "../lib/sns/shortSchedule.js";

/** 動画の上限（承認の snapshot・送り手の契約の 32 MiB） */
export const VIDEO_MAX_BYTES = YOUTUBE_MEDIA_MAX_BYTES;
/** Shorts の尺（全貌の入口版と同じ60秒まで。型は約15〜17秒） */
export const MAX_DURATION_SEC = 60;
const SITE = "https://www.boat-ai.jp";

const fileNameOk = (name) =>
  typeof name === "string" &&
  /\.mp4$/.test(name) &&
  name.length <= 255 &&
  !/[/\\\0]/.test(name);
export const videoNameOf = (bundle) =>
  bundle?.video ?? `${bundle?.variant}.mp4`;

/** 動画の検査（純粋関数） */
export function checkVideo(name, bytes) {
  if (!bytes) return [`${name} が無い`];
  if (!bytes.byteLength || bytes.byteLength > VIDEO_MAX_BYTES)
    return [`${name} の大きさが不正（${bytes.byteLength} バイト）`];
  const info = mp4Info(bytes);
  if (!info.ftyp) return [`${name} が MP4 でない（先頭に ftyp が無い）`];
  const reasons = [];
  if (!(info.width > 0 && info.height > info.width))
    reasons.push(`${name} が縦でない（${info.width}×${info.height}）`);
  if (!(info.durationSec > 0 && info.durationSec <= MAX_DURATION_SEC))
    reasons.push(
      `${name} の尺が ${MAX_DURATION_SEC} 秒までの値でない（${info.durationSec}）`,
    );
  return reasons;
}

/** 説明欄のリンク（純粋関数）。ちょうど1つで、その会場のページ。返り値 { url（表示の確認に使う、クエリなし）, reasons } */
export function descriptionLink(description, venueCode) {
  const urls = twitterText.extractUrls(description ?? "");
  if (urls.length !== 1)
    return {
      url: null,
      reasons: [`説明欄のリンクがちょうど1つでない（${urls.length}）`],
    };
  let u;
  try {
    u = new URL(urls[0]);
  } catch {
    return { url: null, reasons: [`説明欄のリンクが URL でない: ${urls[0]}`] };
  }
  const m = /^\/venue\/(\d{1,2})$/.exec(u.pathname);
  if (
    u.origin !== SITE ||
    u.username ||
    u.password ||
    u.hash ||
    !m ||
    Number(m[1]) !== Number(venueCode) ||
    [...u.searchParams.keys()].some((k) => !k.startsWith("utm_"))
  )
    return {
      url: null,
      reasons: [
        `説明欄のリンクがこの会場のページ（${SITE}/venue/${Number(venueCode)}、クエリは utm_* だけ）でない: ${urls[0]}`,
      ],
    };
  return { url: `${SITE}${u.pathname}`, reasons: [] };
}

/** 題の検査（checkShortBundle の一部） */
function titleReasons(title) {
  const reasons = [];
  if (typeof title === "string") {
    if ([...title].length > 100) reasons.push("youtube.title が100字を超える");
    if (/[\r\n<>]/.test(title))
      reasons.push("youtube.title に改行か < > がある（YouTube が受けない）");
  }
  return reasons;
}

/** 説明欄の検査（checkShortBundle の一部） */
function descriptionReasons(description, venueCode) {
  const reasons = [];
  if (typeof description === "string") {
    if (Buffer.byteLength(description, "utf8") > 5000)
      reasons.push("youtube.description が5000バイトを超える");
    if (/[<>]/.test(description))
      reasons.push("youtube.description に < > がある（YouTube が受けない）");
    if (venueCode)
      reasons.push(...descriptionLink(description, venueCode).reasons);
  }
  return reasons;
}

/** 任意の欄（send_time・source_observed_at・video）の検査（checkShortBundle の一部） */
function optionalFieldReasons(bundle) {
  const reasons = [];
  if (bundle.send_time !== undefined) {
    if (
      !isHhmm(bundle.send_time) ||
      bundle.send_time < SEND_TIME_EARLIEST ||
      bundle.send_time > SEND_TIME_LATEST
    )
      reasons.push(
        `send_time が ${SEND_TIME_EARLIEST}〜${SEND_TIME_LATEST} の HH:MM でない`,
      );
  }
  if (
    bundle.source_observed_at !== undefined &&
    !isIso(bundle.source_observed_at)
  )
    reasons.push(
      "source_observed_at が時差（Z か ±HH:MM）つきの ISO の時刻でない",
    );
  if (bundle.video !== undefined && !fileNameOk(bundle.video))
    reasons.push("video がフォルダの中の .mp4 の名前でない");
  return reasons;
}

/** bundle.json の検査（純粋関数）。型の検査（checkBundle）とこの口の検査。時刻の窓は checkTiming が見る */
export function checkShortBundle(bundle, riskRules = []) {
  const reasons = checkBundle(bundle, { rules: riskRules, matchRiskRules });
  if (!bundle || typeof bundle !== "object") return reasons;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(bundle.date ?? ""))
    reasons.push("date が YYYY-MM-DD でない");
  const venueCode = venueCodeOf(bundle.venue);
  if (!venueCode) reasons.push(`venue が24場の名前でない: ${bundle.venue}`);
  reasons.push(
    ...titleReasons(bundle.youtube?.title),
    ...descriptionReasons(bundle.youtube?.description, venueCode),
    ...optionalFieldReasons(bundle),
  );
  return reasons;
}
