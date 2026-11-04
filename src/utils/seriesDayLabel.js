/**
 * 開催の何日目かの表示ラベル（BOA-488・1199）。
 *
 * raceDetailHeading.js から分けた。raceDetailHeading.js は localizePath のため src/config/languages.js を import し、
 * そこからブログの表（src/data/blogPosts*.js の import.meta.glob）に届く。Remotion の束（webpack）は import.meta.glob を
 * 変換しないので、SNS の動画（sns-video-studio/remotion、raceSeriesText.js 経由）がこれを import すると
 * Getting composition で落ちた（#2236 の後）。
 * このファイルは languages.js・blogPosts*.js に届く import を持たない（検証: scripts/maintenance/verify-remotion-src-imports.js）。
 * 画面・ボット・scripts は raceDetailHeading.js の再 export から今までどおり import できる。
 */
import { isRaceCancelled } from "./raceCancellation.js";

// 開催の何日目かの表示ラベル（BOA-488）。値が無ければnull（「—」も出さない）。
// 初日と最終日が同時に立つ1日開催は実在しないため、判定順は仕様の記載順に従う
export function getSeriesDayLabel(seriesDay, isFinalDay, t) {
  if (seriesDay === 1) return t("raceDetailPage.seriesDayFirst");
  if (isFinalDay === true) return t("raceDetailPage.seriesDayFinal");
  if (Number.isInteger(seriesDay) && seriesDay > 1) {
    return t("raceDetailPage.seriesDayNth", { day: seriesDay });
  }
  return null;
}

/**
 * 会場・日付単位の日目の表示（トップの会場カード、BOA-1199）。
 * レース詳細の見出し（getRaceDetailHeading）と同じ値・同じ文言にする:
 * 値の入っているレースから項目ごとに補い、丸一日中止の日は出さない（BOA-509・658）。
 * 最終日の印はレースごとに入る時点がずれる（BOA-509: 浜名湖で 1R は false・12R は true の日があった）。
 * カードは会場の1日を表すので、どれか1レースでも最終日なら「最終日」にする
 * （その日の優勝戦のレース詳細の見出しと同じになる）
 *
 * @param {Array<{seriesDay?: number|null, isFinalDay?: boolean|null, cancellationStatus?: string|null, result?: object|null}>} venueRaces
 * @param {(key: string, params?: object) => string} t
 * @returns {string|null}
 */
export function getVenueSeriesDayLabel(venueRaces, t) {
  if (venueRaces.length === 0 || venueRaces.every((r) => isRaceCancelled(r)))
    return null;
  const venueValue = (key) =>
    venueRaces.find((r) => r[key] != null)?.[key] ?? null;
  const isFinalDay = venueRaces.some((r) => r.isFinalDay === true)
    ? true
    : venueValue("isFinalDay");
  return getSeriesDayLabel(venueValue("seriesDay"), isFinalDay, t);
}
