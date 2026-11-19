/**
 * ボット向け HTML のレース詳細（botRace.js）の、材料を引く前の門（純関数）: パスの読み取りと 405・404・400。
 * botRace.js から分けた（ファイルの大きさの関所）。botRace.js が同じ名前で export し直す
 */
import {
  CLIENT_ERROR_HEADERS,
  BOT_PAGE_PREFIXED_LANGS,
  originOf,
} from "./botPage.js";
import { DEFAULT_LANGUAGE } from "../../src/config/languages.js";
import { getJSTNow } from "../../src/utils/dateUtils.js";
import { parseRaceId } from "../../src/utils/raceId.js";

const LANG_ALT = BOT_PAGE_PREFIXED_LANGS.join("|");
// 関数を直接呼ぶ形（/api/bot-page/race/{id}・/api/bot-page/{lang}/race/{id}）と、
// middleware の rewrite 経由で元のパスのまま届く形（/race/{id}・/{lang}/race/{id}）
const RACE_PATH = new RegExp(
  `^(?:/api/bot-page)?(?:/(${LANG_ALT}))?/race/([^/]+)$`,
);

export const jstToday = (nowMs) =>
  getJSTNow(new Date(nowMs)).toISOString().slice(0, 10);

/**
 * パスから言語と race id を読む。langMode が "ja" なら接頭辞なしだけ、"prefixed" なら en・zh-TW・ko の接頭辞付きだけを受ける
 *
 * @returns {{lang: string, raceId: string, venueCode: number, raceNo: number, date: string}|null}
 */
export function parseBotRaceUrl(url, langMode = "ja") {
  let pathname;
  try {
    pathname = new URL(url ?? "", "http://localhost").pathname;
  } catch {
    return null;
  }
  const m = RACE_PATH.exec(pathname);
  if (!m) return null;
  const lang = m[1] ?? DEFAULT_LANGUAGE;
  if ((langMode === "prefixed") !== (lang !== DEFAULT_LANGUAGE)) return null;
  const parsed = parseRaceId(m[2]);
  if (!parsed) return null;
  return {
    lang,
    raceId: m[2],
    venueCode: parsed.venueCode,
    raceNo: parsed.raceNo,
    date: parsed.date,
  };
}

export const plain = (status, headers, body) => ({ status, headers, body });

/**
 * 材料を引く前の門（純関数）。通さないときは {response}、通すときは {key, origin}
 *
 * @param {{langMode: "ja"|"prefixed", method?: string, url?: string, headers?: Record<string, string>}} req
 * @param {number} nowMs
 */
export function gateRaceRequest({ langMode, method, url, headers }, nowMs) {
  if (method !== "GET" && method !== "HEAD") {
    return {
      response: plain(
        405,
        { ...CLIENT_ERROR_HEADERS, Allow: "GET, HEAD" },
        "405 Method Not Allowed\n",
      ),
    };
  }
  const key = parseBotRaceUrl(url, langMode);
  // 本日（JST）の id だけ。過去・未来は人と同じ SPA に任せる（CDN のキーも本日分に限る）
  if (!key || key.date !== jstToday(nowMs)) {
    return { response: plain(404, CLIENT_ERROR_HEADERS, "404 Not Found\n") };
  }
  const origin = originOf(headers);
  if (!origin) {
    return { response: plain(400, CLIENT_ERROR_HEADERS, "400 Bad Request\n") };
  }
  return { key, origin };
}
