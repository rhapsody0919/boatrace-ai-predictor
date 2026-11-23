/**
 * サイト全体のご意見ボックス（site_feedback）の決まり。画面（src/components/siteFeedback/）と
 * 検査（scripts/maintenance/verify-site-feedback.js）が同じ値を使う。
 * 表の CHECK（docs/db-migration/205_site_feedback.sql）と1対1でそろえる。
 */
import { parseLangFromPath } from "./localizePath.js";

/** 内容の種類（任意・1つ）。表の kind の列挙値 */
export const FEEDBACK_KINDS = ["feature", "usability", "data", "other"];
/** 自由記述の上限（表の CHECK と同じ） */
export const FEEDBACK_MAX_COMMENT = 500;
/** 満足度（任意）は 1〜5 */
export const FEEDBACK_MAX_RATING = 5;
export const FEEDBACK_LANGS = ["ja", "en", "zh-TW", "ko"];
/** どの画面から送ったか。URL そのもの（レース・選手の番号）は送らず、種類だけにする */
export const FEEDBACK_PAGE_TYPES = [
  "home",
  "today",
  "race",
  "racer",
  "venue",
  "analysis",
  "blog",
  "guide",
  "other",
];

// 先頭の区切り（言語の接頭辞を外した後）→ ページの種類。無いものは other
const FIRST_SEGMENT_TYPES = {
  "": "home",
  today: "today",
  race: "race",
  races: "race",
  racer: "racer",
  racers: "racer",
  venue: "venue",
  venues: "venue",
  "winning-technique": "analysis",
  "outcome-distribution": "analysis",
  accuracy: "analysis",
  "hit-races": "analysis",
  blog: "blog",
  guide: "guide",
  "how-to-use": "guide",
  faq: "guide",
};

/** 例: "/en/race/2026-11-23-01-03" → "race"、"/" → "home"、"/privacy" → "other" */
export function feedbackPageType(pathname) {
  const { basePath } = parseLangFromPath(pathname || "/");
  const first = basePath.split("/")[1] ?? "";
  return Object.hasOwn(FIRST_SEGMENT_TYPES, first)
    ? FIRST_SEGMENT_TYPES[first]
    : "other";
}

// ボタンを出さない画面: 管理画面・共有用の画像の元になる画面・下に固定の操作がある思考アシスト
const HIDDEN_PATTERNS = [
  /^\/admin(\/|$)/,
  /^\/share(\/|$)/,
  /^\/race\/[^/]+\/assist(\/|$)/,
];

export function isFeedbackHiddenPath(pathname) {
  const { basePath } = parseLangFromPath(pathname || "/");
  return HIDDEN_PATTERNS.some((re) => re.test(basePath));
}

/** 送れる内容か（前後の空白を除いて1文字以上、上限以内） */
export function canSendFeedback(comment) {
  const n = (comment ?? "").trim().length;
  return n >= 1 && n <= FEEDBACK_MAX_COMMENT;
}

/**
 * 表に送る1行を作る。決まりに合わない値は送らずに投げる（表の CHECK で落ちる前に画面で気づく）。
 * @param {{kind: string|null, comment: string, rating: number|null, pathname: string, lang: string, clientKey: string}} input
 */
export function buildSiteFeedbackRow({
  kind,
  comment,
  rating,
  pathname,
  lang,
  clientKey,
}) {
  const text = (comment ?? "").trim();
  if (!canSendFeedback(text)) throw new Error("ご意見の内容は1〜500文字で送る");
  if (kind != null && !FEEDBACK_KINDS.includes(kind))
    throw new Error(`ご意見の種類が決まりに無い: ${kind}`);
  if (
    rating != null &&
    !(Number.isInteger(rating) && rating >= 1 && rating <= FEEDBACK_MAX_RATING)
  )
    throw new Error(`満足度は1〜5の整数で送る: ${rating}`);
  if (!clientKey) throw new Error("ブラウザごとの識別番号が無い");
  return {
    kind: kind ?? null,
    comment: text,
    rating: rating ?? null,
    page_type: feedbackPageType(pathname),
    lang: FEEDBACK_LANGS.includes(lang) ? lang : "ja",
    client_key: clientKey,
  };
}
