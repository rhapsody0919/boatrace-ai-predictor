/**
 * X の「数字で見たら」（集計ランキングの画像1枚、format=research_image、マイグレーション 179・180）の、
 * 取り込み（scripts/sns/push-research-image.js）と送る直前の読み直し（snsClaimCheck.js の readCurrent）に共通の決まりと検査。
 * レースを持たない投稿なので、race_id の代わりに research:{YYYY-MM-DD}:{slug} を item の race_id に入れる（179 の CHECK と同じ形）。
 * 1日1本（同じ JST の日の research_image は、生きている item か送った item が1つだけ。179 の一意の索引）
 */
import twitterText from "twitter-text";
import { buildPostText } from "../../src/pages/admin/sns-hub/utils.js";
import { xPostValid } from "./snsXLength.js";

export const RESEARCH_IMAGE_KIND = "research_image";
/** slug は hq の題の札（英小文字・数字・ハイフン、40字まで）。179 の CHECK と同じ */
export const RESEARCH_SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;
const RESEARCH_ID = /^research:(\d{4}-\d{2}-\d{2}):([a-z0-9][a-z0-9-]{0,39})$/;

export const researchIdOf = (date, slug) => `research:${date}:${slug}`;
/** research_id の日（JST）と slug。形が違えば null */
export function parseResearchId(id) {
  const m = RESEARCH_ID.exec(id ?? "");
  return m ? { date: m[1], slug: m[2] } : null;
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
      (t) =>
        squash(t).includes(KYOUTEI) &&
        t.normalize("NFKC") !== KYOUTEI_TAG,
    )
  )
    banned.push(`${KYOUTEI}（#競艇 以外のタグ）`);
  if (banned.length) reasons.push(`禁止表現: ${banned.join(",")}`);
  return reasons;
}
