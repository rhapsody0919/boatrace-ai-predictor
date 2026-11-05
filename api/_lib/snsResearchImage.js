/**
 * X の「数字で見たら」（集計ランキングの画像1枚、format=research_image、マイグレーション 179・180）の、
 * 取り込み（scripts/sns/push-research-image.js）と送る直前の読み直し（snsClaimCheck.js の readCurrent）に共通の決まりと検査。
 * レースを持たない投稿なので、race_id の代わりに research:{YYYY-MM-DD}:{slug} を item の race_id に入れる（179 の CHECK と同じ形）。
 * 1日1本（同じ JST の日の research_image は、生きている item か送った item が1つだけ。179 の一意の索引）
 */
import twitterText from "twitter-text";
import { buildPostText } from "../../src/pure/snsPostText.js";
import { xPostValid } from "./snsXLength.js";

export const RESEARCH_IMAGE_KIND = "research_image";
/** slug は hq の題の札（英小文字・数字・ハイフン、40字まで）。179 の CHECK と同じ */
export const RESEARCH_SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;
const RESEARCH_ID = /^research:(\d{4}-\d{2}-\d{2}):([a-z0-9][a-z0-9-]{0,39})$/;

/** research_id の日（JST）と slug。形が違えば null */
export function parseResearchId(id) {
  const m = RESEARCH_ID.exec(id ?? "");
  return m ? { date: m[1], slug: m[2] } : null;
}

/**
 * X の「節の機力」（画像1枚、kind=setsu_kiryoku、21:30、BOA-1209、マイグレーション 194）。形は research_image と同じで、race_id の代わりは setsu:{日}:{slug}。
 * slug は英小文字で始める（193 の YouTube Shorts の setsu:{日}:{会場2桁} と同じ race_id にならないように。194 の CHECK と同じ）
 */
export const SETSU_KIRYOKU_KIND = "setsu_kiryoku";
const SETSU_SLUG = /^[a-z][a-z0-9-]{0,39}$/;
const SETSU_ID = /^setsu:(\d{4}-\d{2}-\d{2}):([a-z][a-z0-9-]{0,39})$/;

/**
 * 1日1本の画像の型（レースを持たない・リンクなし・送る時刻から60分）。取り込み（push-research-image.js）と送る直前の読み直し
 * （snsClaimCheck.js）が型ごとに読む。errors は readCurrent が投げる理由（runner の precheck の理由に残る。193 の Shorts の setsu_* と分けるため
 * 節の機力の X は setsu_x_*）。hasRacers は選手の名前と級（setsuRacerReasons）を取り込みと送る直前の両方で見るか
 */
export const DAILY_IMAGE_TYPES = {
  research_image: {
    kind: RESEARCH_IMAGE_KIND,
    label: "数字で見たら",
    bundleFormat: "research_image",
    idPrefix: "research",
    sourceKey: "research_image",
    idField: "research_id",
    enabledColumn: "research_image_enabled",
    storagePrefix: "research-image",
    slug: RESEARCH_SLUG,
    hasRacers: false,
    parseId: parseResearchId,
    errors: {
      idInvalid: "research_id_invalid",
      itemMismatch: "research_item_mismatch",
      disabled: "research_image_disabled",
      alreadySent: "research_already_sent_today",
      imageCount: "research_image_count",
      textRejected: "research_text_rejected",
    },
  },
  setsu_kiryoku: {
    kind: SETSU_KIRYOKU_KIND,
    label: "節の機力",
    bundleFormat: "setsu_kiryoku_image",
    idPrefix: "setsu",
    sourceKey: "setsu_kiryoku",
    idField: "setsu_id",
    enabledColumn: "setsu_kiryoku_enabled",
    storagePrefix: "setsu-kiryoku",
    slug: SETSU_SLUG,
    hasRacers: true,
    parseId: (id) => {
      const m = SETSU_ID.exec(id ?? "");
      return m ? { date: m[1], slug: m[2] } : null;
    },
    errors: {
      idInvalid: "setsu_x_id_invalid",
      itemMismatch: "setsu_x_item_mismatch",
      disabled: "setsu_kiryoku_disabled",
      alreadySent: "setsu_x_already_sent_today",
      imageCount: "setsu_x_image_count",
      textRejected: "setsu_x_text_rejected",
      racers: "setsu_x_racers_invalid",
    },
  },
};
export const dailyIdOf = (type, date, slug) =>
  `${type.idPrefix}:${date}:${slug}`;

/** 選手の級（race_entries.grade と同じ4つ） */
export const RACER_CLASSES = ["A1", "A2", "B1", "B2"];
/**
 * 節の機力の選手（画像の材料）の検査（純粋関数）。選手は必ず名前と級（オーナー 2026-11-01 の恒久の決まり）。
 * racers（画像に出す選手。hq の setsu_sheet.py は6人）は1人以上で、どの選手も名前（空でない文字列）と級（A1・A2・B1・B2）を持つ。
 * 級が画像にだけ出て本文に出ない選手もいるので、本文からは拾わない（bundle の racers だけを見る）。
 * 6人ちょうどは求めない（欠場などで画像の行が減る節がありうる。目安・根拠なし）
 */
export function setsuRacerReasons(racers) {
  if (!Array.isArray(racers) || racers.length === 0)
    return ["racers（画像の選手の名前と級）が無い"];
  const reasons = [];
  racers.forEach((r, i) => {
    if (typeof r?.name !== "string" || !r.name.trim())
      reasons.push(`racers[${i}] に名前が無い`);
    if (!RACER_CLASSES.includes(r?.class))
      reasons.push(
        `racers[${i}]（${r?.name ?? "?"}）の級が ${RACER_CLASSES.join("・")} でない（${r?.class}）`,
      );
  });
  return reasons;
}

/**
 * 禁止表現（hq と決めた語。NFKC でそろえ空白を除いて含むかを見る）。取り込みは risk-rules.json も当てる。送る直前の読み直し（cron sns-send）は
 * risk-rules.json を関数に同梱していないので、この一覧が送る直前の最後の守り（risk-rules と重なる語はわざと二重に持つ。足すなら両方）。
 * 「競艇」は本文に使わない。ハッシュタグの「#競艇」（そのものだけ）は例外（.claude/rules/code-style.md の例外2・risk-rules の hashtag_exception と同じ）
 */
export const RESEARCH_BANNED_WORDS = [
  "必ず当たる",
  "稼げる",
  "万舟券",
  "儲か",
  "似たレース",
];
const KYOUTEI = "競艇";
const squash = (value) => value.normalize("NFKC").replace(/[\s\u3000]/gu, "");
const KYOUTEI_TAG = "#競艇";
const HASHTAG = /^#[\p{L}\p{N}_]+$/u;
/** ハッシュタグは0〜2個（型は「#ボートレース 1つ」。目安・根拠なし） */
export const RESEARCH_MAX_HASHTAGS = 2;

/** 投稿の文（本文＋ハッシュタグの行）。承認の関数・送り手と同じ組み立て（buildPostText） */
export const researchPostText = ({ caption, hashtags }) =>
  buildPostText({ caption_text: caption, hashtags });

/** 文にリンク（URL・ドメインだけの書き方も）が1つでもあるか */
export const hasLink = (text) => twitterText.extractUrls(text ?? "").length > 0;

/**
 * 文の検査（純粋関数）。不合格の理由の配列を返す。取り込みと送る直前の両方で使う。
 * 禁止表現・X の加重280（本文＋ハッシュタグの行）・リンクなし・置き場所なし・ハッシュタグの形
 */
export function researchTextReasons({ caption, hashtags }) {
  const reasons = [];
  if (typeof caption !== "string" || !caption.trim()) return ["x_text が無い"];
  if (
    !Array.isArray(hashtags) ||
    hashtags.length > RESEARCH_MAX_HASHTAGS ||
    hashtags.some((tag) => typeof tag !== "string" || !HASHTAG.test(tag))
  )
    reasons.push(
      `hashtags が #から始まる語の${RESEARCH_MAX_HASHTAGS}個までの配列でない`,
    );
  const tags = Array.isArray(hashtags)
    ? hashtags.filter((t) => typeof t === "string")
    : [];
  if (twitterText.extractHashtags(caption).length)
    reasons.push("x_text にハッシュタグがある（hashtags に分けて渡す）");
  const text = researchPostText({ caption, hashtags: tags });
  if (!xPostValid(text)) reasons.push("本文が X の加重280を超える");
  if (/[{}]|\$\{/.test(text))
    reasons.push("本文に置き場所（{ } ・${）が残っている");
  if (hasLink(text)) reasons.push("本文にリンクがある（この型はリンクなし）");
  // NFKC でそろえ、空白（半角・全角）を除いてから見る（「競 艇」で抜けない。risk-rules の照合と同じ）
  const body = squash(caption);
  const all = squash(text);
  const banned = RESEARCH_BANNED_WORDS.filter((w) => all.includes(w));
  if (body.includes(KYOUTEI)) banned.push(KYOUTEI);
  // ハッシュタグは「#競艇」そのものだけを許す（#競艇場 等は本文と同じく不可）
  if (
    tags.some(
      (t) => squash(t).includes(KYOUTEI) && t.normalize("NFKC") !== KYOUTEI_TAG,
    )
  )
    banned.push(`${KYOUTEI}（#競艇 以外のタグ）`);
  if (banned.length) reasons.push(`禁止表現: ${banned.join(",")}`);
  return reasons;
}
