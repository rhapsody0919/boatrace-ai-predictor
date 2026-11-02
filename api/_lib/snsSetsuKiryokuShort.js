/**
 * YouTube Shorts「節の機力」（format・kind = setsu_kiryoku_short、マイグレーション 193、BOA-1209）の、
 * 取り込み（scripts/sns/push-setsu-kiryoku-short.js）と送る直前の読み直し（snsClaimCheck.js の readCurrent）に共通の決まり。
 * レースを持たない投稿なので、race_id の代わりに setsu:{YYYY-MM-DD}:{会場コード2桁} を item の race_id に入れる（193 の CHECK と同じ形）。
 * 1日1本（同じ JST の日の setsu_kiryoku_short は、生きている item か送った item が1つだけ。193 の一意の索引）
 */
import { VENUE_NAMES } from "../../scripts/lib/venueNames.js";

export const SETSU_KIRYOKU_SHORT_KIND = "setsu_kiryoku_short";
/** 送る直前のリンク先の表示の確認で見る画面（scripts/lib/snsScreenMarkers.js の venue） */
export const SETSU_SCREEN_KEY = "venue";
const SETSU_ID = /^setsu:(\d{4}-\d{2}-\d{2}):(0[1-9]|1[0-9]|2[0-4])$/;

export const venueCodeOf = (name) => {
  const hit = Object.entries(VENUE_NAMES).find(([, v]) => v === name);
  return hit ? hit[0].padStart(2, "0") : null;
};
export const setsuIdOf = (date, venueCode) => `setsu:${date}:${venueCode}`;
/** setsu_id の日（JST）と会場コード（2桁）。形が違えば null */
export function parseSetsuId(id) {
  const m = SETSU_ID.exec(id ?? "");
  return m ? { date: m[1], venue: m[2] } : null;
}
/** 優勝戦の型（final_gap）の、同じ優勝戦を2回出さないための札（優勝戦の日と会場）。他の型は null */
export const finalKeyOf = ({ variant, final_date: finalDate }, venueCode) =>
  variant === "final_gap" ? `final:${finalDate}:${venueCode}` : null;
