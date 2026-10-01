/**
 * フォーマット関数
 * 日付、パーセント、金額等のフォーマット処理を一元管理
 */

import { WEEKDAYS } from "../constants";

/**
 * パーセント表示
 * @param {number} rate - 0-1の割合
 * @returns {string} パーセント文字列 (例: "75.5%")
 */
export const formatPercent = (rate) => (rate * 100).toFixed(1) + "%";

/**
 * 日付フォーマット（フル形式）
 * @param {string} dateStr - YYYY-MM-DD形式の日付
 * @returns {string} YYYY年M月D日(曜日) 形式
 */
export const formatDate = (dateStr) => {
  const date = new Date(dateStr + "T00:00:00+09:00");
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const weekday = WEEKDAYS[date.getDay()];
  return `${year}年${month}月${day}日(${weekday})`;
};

// i18n言語コード → Intl.DateTimeFormat用ロケール
const INTL_LOCALE_BY_LANG = {
  ja: "ja-JP",
  en: "en-US",
  "zh-TW": "zh-TW",
  ko: "ko-KR",
};

/**
 * 日付フォーマット（言語対応版、フル形式）
 * formatDate()は常に日本語（年月日+曜日）を返すため、翻訳対象ページ（/race/:raceId等）で
 * 日本語以外のUI言語のときに文言が混在しないよう使う
 * @param {string} dateStr - YYYY-MM-DD形式の日付
 * @param {string} lang - i18nの言語コード（"ja"/"en"/"zh-TW"/"ko"）
 * @returns {string} ロケールに応じた日付文字列
 */
export const formatDateLocalized = (dateStr, lang) => {
  const date = new Date(dateStr + "T00:00:00+09:00");
  const locale = INTL_LOCALE_BY_LANG[lang] || INTL_LOCALE_BY_LANG.ja;
  return new Intl.DateTimeFormat(locale, {
    // timeZoneを渡さないとIntlは閲覧者のローカルTZで整形するため、負のオフセットの
    // 地域（America/Los_Angeles等）で開催日が1日前にずれる。渡すのは常にJSTの
    // 開催日（YYYY-MM-DD）なので、整形もJST固定にする（2026-09-24、FR-5の
    // 実装前レビューで発覚。既存の正しい先例はRacePitReportSection.jsx）
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(date);
};

/**
 * 日付フォーマット（短縮形式）
 * @param {string} dateStr - YYYY-MM-DD形式の日付
 * @returns {string} M/D(曜日) 形式
 */
export const formatDateShort = (dateStr) => {
  const date = new Date(dateStr + "T00:00:00+09:00");
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const weekday = WEEKDAYS[date.getDay()];
  return `${month}/${day}(${weekday})`;
};

/**
 * 日付フォーマット（短縮形式、言語対応版）。ja は formatDateShort と同じ M/D(曜日)、
 * それ以外は Intl（例 en "Thu, 10/1"）。翻訳対象ページの見出しに使う（BOA-653）
 * @param {string} dateStr - YYYY-MM-DD形式の日付（JSTの日付）
 * @param {string} lang - i18nの言語コード
 */
export const formatDateShortLocalized = (dateStr, lang) => {
  if (!INTL_LOCALE_BY_LANG[lang] || lang === "ja")
    return formatDateShort(dateStr);
  return new Intl.DateTimeFormat(INTL_LOCALE_BY_LANG[lang], {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    weekday: "short",
  }).format(new Date(dateStr + "T00:00:00+09:00"));
};

/**
 * 日付フォーマット（年月日、曜日なし、言語対応版）。ja は「YYYY年M月D日」、
 * それ以外は Intl（例 en "September 28, 2026"）。フッターの更新日に使う（BOA-653）
 * @param {string} dateStr - YYYY-MM-DD形式の日付（JSTの日付）
 * @param {string} lang - i18nの言語コード
 */
export const formatDateLongLocalized = (dateStr, lang) => {
  const locale = INTL_LOCALE_BY_LANG[lang] || INTL_LOCALE_BY_LANG.ja;
  return new Intl.DateTimeFormat(locale, {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(dateStr + "T00:00:00+09:00"));
};

/**
 * 日付フォーマット（複数形式を返す）
 * @param {string} dateStr - YYYY-MM-DD形式の日付
 * @returns {Object} full, short, yearMonth の各形式
 */
export const formatDateObject = (dateStr) => {
  const date = new Date(dateStr + "T00:00:00+09:00");
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const weekday = WEEKDAYS[date.getDay()];
  return {
    full: `${year}年${month}月${day}日(${weekday})`,
    short: `${month}/${day}(${weekday})`,
    yearMonth: `${year}年${month}月`,
  };
};

/**
 * 最終更新日時フォーマット
 * @param {string} isoString - ISO 8601形式の日時
 * @returns {string} YYYY/M/D HH:MM 形式
 */
/**
 * 回収率フォーマット
 * @param {number} rate - 回収率 (1.0 = 100%)
 * @returns {string} パーセント文字列 (例: "125.5%")
 */
export const formatRecoveryRate = (rate) => (rate * 100).toFixed(1) + "%";

// ロケールによる並び順・桁揃えの差を受けないよう、部品で取り出してから組み立てる
// （month/dayに"numeric"を指定しても、hourと組み合わせると2桁に揃うロケールがある）
const JST_CAPTURED_AT_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Tokyo",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/**
 * 外部サイトからの取得時刻（ISO文字列）を「9/18 15:42」（JST）にする。
 * 読めなければ null（時刻の行ごと出さない）。
 *
 * ADR-0067 が求める「取得時刻の表記」に使う共通部品。ピットレポート
 * （RacePitReportSection）とオリジナル展示（RaceBeforeInfoTab）の2箇所が使う。
 * 日付まで出すのは、過去のレースを開いたときに「いつ取った値か」が時刻だけでは
 * 分からないため（気象の観測時刻 `formatObservedTime` は当日のレース中しか
 * 意味を持たないので時刻のみ、と使い分けている）
 */
export function formatCapturedAtJst(capturedAt) {
  if (!capturedAt) return null;
  const date = new Date(capturedAt);
  if (Number.isNaN(date.getTime())) return null;
  const parts = JST_CAPTURED_AT_FORMAT.formatToParts(date);
  const pick = (type) => parts.find((p) => p.type === type)?.value ?? "";
  const month = Number(pick("month"));
  const day = Number(pick("day"));
  if (!month || !day) return null;
  return `${month}/${day} ${pick("hour")}:${pick("minute")}`;
}
