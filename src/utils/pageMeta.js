/**
 * トップ（/）と会場ページ（本日分、/venue/:code）の title・meta description・canonical を作る。
 *
 * 人のページ（VenueGridPage・VenueRaceListPage）と、ボット向け HTML の関数（ADR 0089。ja 固定）が
 * 同じ値を出すよう、1箇所で組む。t は i18next の t（人のページは useTranslation、ボットは ja の
 * インスタンス）。Node からも import するため、ブラウザ専用の依存を持ち込まない。
 * 検証: scripts/maintenance/verify-bot-page-model.js
 */
import { localizePath } from "../config/languages.js";
import { getVenueSeriesTitle } from "./venueSeriesTitle.js";

const SITE_ORIGIN = "https://www.boat-ai.jp";

/**
 * @param {(key: string, params?: object) => string} t
 * @param {string} lang - i18n の言語コード
 * @returns {{title: string, description: string, canonical: string}}
 */
export function getTopPageMeta(t, lang) {
  return {
    title: t("meta.title"),
    description: t("meta.description"),
    canonical: `${SITE_ORIGIN}${localizePath("/", lang)}`,
  };
}

/**
 * 会場ページ（本日分）。SG・G1 開催中は節タイトルを入れる（getVenueSeriesTitle）。
 * 4言語で出すページなので、canonical は表示中の言語の URL（hreflang・sitemap と合わせる。SEO 点検 F1、#1395）。
 * ボット向け HTML（ADR 0089）は ja なので接頭辞なし
 *
 * @param {(key: string, params?: object) => string} t
 * @param {number} venueCode - 1〜24
 * @param {{raceGrade?: string|null, raceTitle?: string|null}[]} races - 会場の本日のレース（レース番号順）
 * @param {string} [lang] - 表示中の言語（既定は ja）
 * @returns {{title: string, description: string, canonical: string}}
 */
export function getTodayVenuePageMeta(t, venueCode, races, lang = "ja") {
  const series = getVenueSeriesTitle(races);
  const params = { venue: t(`venues.${venueCode}`), series };
  return {
    title: t(
      series ? "venueRaceList.metaTitleSeries" : "venueRaceList.metaTitle",
      params,
    ),
    description: t(
      series
        ? "venueRaceList.metaDescriptionSeries"
        : "venueRaceList.metaDescription",
      params,
    ),
    canonical: `${SITE_ORIGIN}${localizePath(`/venue/${venueCode}`, lang)}`,
  };
}
