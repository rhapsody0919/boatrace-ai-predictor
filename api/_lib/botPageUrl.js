// botPage.js から字のまま移した、bot 向けページの URL の読み（言語版の接頭辞・会場コード）。副作用なし
import {
  DEFAULT_LANGUAGE,
  SUPPORTED_LANGUAGES,
} from "../../src/config/languages.js";

const VENUE_CODE = /^(?:[1-9]|1\d|2[0-4])$/;

/** 言語版を出す言語（ja 以外の対応言語。src/config/languages.js の SUPPORTED_LANGUAGES） */
export const BOT_PAGE_PREFIXED_LANGS = SUPPORTED_LANGUAGES.map(
  ({ code }) => code,
).filter((code) => code !== DEFAULT_LANGUAGE);


const pathnameOf = (url) => {
  try {
    return new URL(url ?? "", "http://localhost").pathname;
  } catch {
    return null;
  }
};

const LANG_ALT = BOT_PAGE_PREFIXED_LANGS.map((l) =>
  l.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
).join("|");
// 言語版の受けるパス。関数を直接呼ぶ形と、middleware の rewrite 経由で元のパスのまま届く形
const LANG_TOP_PATH = new RegExp(
  `^(?:/api/bot-page/(${LANG_ALT})/top|/(${LANG_ALT})/?)$`,
);
const LANG_VENUE_PATH = new RegExp(
  `^(?:/api/bot-page)?/(${LANG_ALT})/venue/([^/]+)$`,
);
const JA_VENUE_PATH = /^(?:\/api\/bot-page)?\/venue\/([^/]+)$/;

/**
 * パスの会場コード（1〜24、0埋めなし）。それ以外は null
 *
 * @param {string} url
 * @param {string} [lang] - ja（既定）は接頭辞なしのパスだけ、それ以外はその言語の接頭辞付きのパスだけを受ける
 */
export function venueCodeFromUrl(url, lang = DEFAULT_LANGUAGE) {
  const pathname = pathnameOf(url);
  if (pathname === null) return null;
  let code;
  if (lang === DEFAULT_LANGUAGE) {
    code = JA_VENUE_PATH.exec(pathname)?.[1];
  } else {
    const m = LANG_VENUE_PATH.exec(pathname);
    code = m && m[1] === lang ? m[2] : undefined;
  }
  if (code === undefined || !VENUE_CODE.test(code)) return null;
  return Number(code);
}

/**
 * 言語版の関数のパスから言語を読む（en・zh-TW・ko）。それ以外は null
 *
 * @param {"top"|"venue"} page
 * @param {string} url
 */
export function prefixedLangFromUrl(page, url) {
  const pathname = pathnameOf(url);
  if (pathname === null) return null;
  if (page === "top") {
    const m = LANG_TOP_PATH.exec(pathname);
    return m ? (m[1] ?? m[2]) : null;
  }
  return LANG_VENUE_PATH.exec(pathname)?.[1] ?? null;
}
