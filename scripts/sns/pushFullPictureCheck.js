/**
 * 全貌動画の取り込み（push-full-picture.js）から移した bundle.json の検査（純粋関数）。checkFullPicture を欄ごとの小さな検査に割った。
 * 理由の並びは元と同じ（format → race_id → 札・型 → channels → x_text → 置き場所 → 完全版 → Shorts → P0・機械 → 禁止語 → 禁止表現）。
 */
import twitterText from "twitter-text";
import {
  FULL_URL_PLACEHOLDER,
  fillFullUrl,
} from "../../api/_lib/snsDeadlineQueue.js";
import { xPostValid } from "../../api/_lib/snsXLength.js";
import { matchRiskRules, draftRiskFields } from "../lib/riskRuleMatcher.js";
import {
  FULL_PICTURE_FORMAT,
  SHORTS_MACHINE_CHECKS,
  nonEmpty,
  thumbnailNameOk,
  versionChannels,
  wantsX,
  withShorts,
} from "../lib/sns/fullPictureShape.js";
import { draftTexts } from "../lib/sns/fullPictureRows.js";

const RACE_URL =
  /https:\/\/www\.boat-ai\.jp\/race\/([0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{2}-[0-9]{2})/;
// 置き換えで増える字数（送る時の fillFullUrl と同じ書式から求める）
const FILLED_URL_EXTRA =
  fillFullUrl(FULL_URL_PLACEHOLDER, "x".repeat(11)).length -
  FULL_URL_PLACEHOLDER.length;

/** format・race_id・札（full_picture_variant）・型（content_type） */
function identityReasons(bundle) {
  const reasons = [];
  if (bundle?.format !== FULL_PICTURE_FORMAT)
    reasons.push(`format が ${FULL_PICTURE_FORMAT} でない`);
  if (!/^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}$/.test(bundle?.race_id ?? ""))
    reasons.push("race_id が不正");
  // 札は無いか、{id: "a"|"b"} だけ（hq SQ08 v5）
  if (
    bundle?.full_picture_variant !== undefined &&
    !["a", "b"].includes(bundle.full_picture_variant?.id)
  )
    reasons.push("full_picture_variant.id が a・b でない");
  // 型は無いか、{id: 空でない文字列} だけ
  if (
    bundle?.content_type !== undefined &&
    !(
      typeof bundle.content_type?.id === "string" &&
      bundle.content_type.id.trim()
    )
  )
    reasons.push("content_type.id が無い");
  return reasons;
}

/** channels は x を外すことだけができる（完全版は必須、Shorts は版2と一致。Shorts の親は完全版の job） */
function channelsReasons(bundle) {
  const reasons = [];
  if (bundle?.channels !== undefined) {
    const c = bundle.channels;
    const all = versionChannels(bundle);
    if (
      !Array.isArray(c) ||
      new Set(c).size !== c.length ||
      c.some((v) => !all.includes(v)) ||
      all.some((v) => v !== "x" && !c.includes(v))
    )
      reasons.push(
        `channels が不正（x を外すことだけができる。必須は ${all.filter((v) => v !== "x").join("・")}）`,
      );
  }
  return reasons;
}

/** X を作らない bundle では x_text を見ない */
function xTextReasons(bundle) {
  const reasons = [];
  if (wantsX(bundle)) {
    if (!nonEmpty(bundle?.x_text, 25000))
      reasons.push("x_text が無い・長すぎる");
    else {
      if (!xPostValid(bundle.x_text, { long: true }))
        reasons.push("x_text が X の長文の上限を超える");
      const urls = twitterText.extractUrls(bundle.x_text);
      if (urls.length !== 1 || urls[0].match(RACE_URL)?.[1] !== bundle.race_id)
        reasons.push("x_text にこのレースの URL がちょうど1つ無い");
    }
  }
  return reasons;
}

/** 完全版の URL の置き場所は Shorts の説明文だけ（ほかに入っていると、送る前の検査で初めて止まる） */
function placeholderReasons(bundle) {
  const reasons = [];
  for (const [field, text] of [
    ["x_text", wantsX(bundle) ? bundle?.x_text : undefined],
    ["youtube_full.title", bundle?.youtube_full?.title],
    ["youtube_full.description", bundle?.youtube_full?.description],
    ["youtube_shorts.title", bundle?.youtube_shorts?.title],
  ])
    if (typeof text === "string" && text.includes(FULL_URL_PLACEHOLDER))
      reasons.push(
        `${field} に ${FULL_URL_PLACEHOLDER} がある（Shorts の説明文だけに置く）`,
      );
  return reasons;
}

/** 完全版の題・説明文・サムネイルの名前と、bundle_version */
function fullYoutubeReasons(bundle) {
  const reasons = [];
  if (!nonEmpty(bundle?.youtube_full?.title, 100))
    reasons.push("youtube_full.title が無い・100字を超える");
  if (!nonEmpty(bundle?.youtube_full?.description, 5000))
    reasons.push("youtube_full.description が無い・5000字を超える");
  if (
    bundle?.youtube_full?.thumbnail !== undefined &&
    !thumbnailNameOk(bundle.youtube_full.thumbnail)
  )
    reasons.push(
      "youtube_full.thumbnail がファイル名でない（区切り・空は受けない）",
    );
  if (bundle?.bundle_version != null && !withShorts(bundle))
    reasons.push(`bundle_version が不正（${bundle.bundle_version}）`);
  return reasons;
}

/** Shorts の題（100字まで・改行なし・完全版の題と別） */
function shortsTitleReasons(bundle) {
  const reasons = [];
  const shorts = bundle.youtube_shorts;
  if (!nonEmpty(shorts?.title, 100) || /[\r\n]/.test(shorts.title))
    reasons.push("youtube_shorts.title が無い・100字を超える・改行がある");
  else if (shorts.title === bundle?.youtube_full?.title)
    reasons.push("youtube_shorts.title が youtube_full.title と同じ");
  return reasons;
}

/** Shorts の説明文（完全版の URL の置き場所がちょうど1つ）と機械の検査 */
function shortsBodyReasons(bundle) {
  const reasons = [];
  const shorts = bundle.youtube_shorts;
  if (!nonEmpty(shorts?.description, 5000 - FILLED_URL_EXTRA))
    reasons.push(
      "youtube_shorts.description が無い・完全版の URL を入れると5000字を超える",
    );
  else if (shorts.description.split(FULL_URL_PLACEHOLDER).length !== 2)
    reasons.push(
      `youtube_shorts.description に ${FULL_URL_PLACEHOLDER} がちょうど1つ無い`,
    );
  for (const key of SHORTS_MACHINE_CHECKS)
    if (bundle?.qa?.machine?.[key] !== true)
      reasons.push(`Shorts の機械の検査 ${key} が通っていない`);
  return reasons;
}

/** Shorts（版2）の題・説明文・機械の検査 */
function shortsReasons(bundle) {
  return withShorts(bundle)
    ? [...shortsTitleReasons(bundle), ...shortsBodyReasons(bundle)]
    : [];
}

/** 評価役の P0・機械の検査・禁止語 */
function qaReasons(bundle) {
  const reasons = [];
  // review.p0_count の検査は、2026-10-20 オーナー決定（全貌は機械の検査だけで送る）に合わせて、別の PR（全貌の自動送信を
  // 機械の検査だけにする、#1714 の後）が外して review を任意にする。この PR では元の検査のまま残す
  if (bundle?.review?.p0_count !== 0)
    reasons.push(`評価役の P0 が0件でない（${bundle?.review?.p0_count}）`);
  const machine = bundle?.qa?.machine;
  if (
    !machine ||
    !Object.keys(machine).length ||
    !Object.values(machine).every((v) => v === true)
  )
    reasons.push("機械の検査が全部通っていない");
  if (Array.isArray(bundle?.qa?.bannedWords) && bundle.qa.bannedWords.length)
    reasons.push(`禁止語: ${bundle.qa.bannedWords.join(",")}`);
  return reasons;
}

/** チャネルごとの下書きの文が禁止表現に当たるか */
function riskReasons(bundle, riskRules) {
  const reasons = [];
  for (const [channel, draft] of Object.entries(draftTexts(bundle))) {
    const hits = matchRiskRules(
      draftRiskFields(draft),
      draft.platform,
      riskRules,
    );
    if (hits.length)
      reasons.push(
        `禁止表現（${channel}）: ${hits.map((h) => h.id).join(",")}`,
      );
  }
  return reasons;
}

/** bundle.json の検査（純粋関数）。不合格は理由の配列を返す */
export function checkFullPicture(bundle, riskRules = []) {
  return [
    ...identityReasons(bundle),
    ...channelsReasons(bundle),
    ...xTextReasons(bundle),
    ...placeholderReasons(bundle),
    ...fullYoutubeReasons(bundle),
    ...shortsReasons(bundle),
    ...qaReasons(bundle),
    ...riskReasons(bundle, riskRules),
  ];
}
