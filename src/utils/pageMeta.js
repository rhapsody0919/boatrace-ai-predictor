/**
 * トップ（/）と会場ページ（本日分 /venue/:code・過去日付 /races/:date/:code）の title・meta description・canonical を作る。
 *
 * 人のページ（VenueGridPage・VenueRaceListPage）と、ボット向け HTML の関数（ADR 0089。ja 固定）が
 * 同じ値を出すよう、1箇所で組む。t は i18next の t（人のページは useTranslation、ボットは ja の
 * インスタンス）。Node からも import するため、ブラウザ専用の依存を持ち込まない。
 * 検証: scripts/maintenance/verify-bot-page-model.js
 */
import { localizePath } from "../pure/localizePath.js";
import { getVenueSeriesTitle } from "../shared/venueSeriesTitle.js";
import { formatDate } from "./formatters.js";

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

/**
 * 会場ページ（過去日付、/races/:date/:code。ja 専用）。画面には終わったレースの結果の行（着順・決まり手・3連単の配当）が出るので、
 * 「{会場}＋結果」の検索の語で拾われるよう title の頭に「結果・配当」を置く（BOA-1723）。尾は e2e/venue-seo-meta.spec.js が固定
 *
 * @param {string} venueName - 会場名
 * @param {string} date - YYYY-MM-DD
 * @param {number|string} venueCode - 1〜24
 * @returns {{title: string, description: string, canonical: string}}
 */
export function getPastVenuePageMeta(venueName, date, venueCode) {
  const day = formatDate(date);
  return {
    title: `${venueName}競艇の結果・配当 ${day}のレース一覧・AIデータ分析 - 龍神レーダー`,
    description: `${venueName}競艇（ボートレース${venueName}）の${day}の全レースの結果。着順・決まり手・3連単の配当と、各レースの出走表・AIデータ分析を無料で確認できます。`,
    canonical: `${SITE_ORIGIN}/races/${date}/${venueCode}`,
  };
}

/**
 * 会場ページ（本日分）のパンくず（ホーム › 会場名）。画面の Breadcrumb と、ボット向け HTML の BreadcrumbList が同じ値を使う
 *
 * @param {(key: string, params?: object) => string} t
 * @param {number} venueCode - 1〜24
 * @param {string} [lang] - 表示中の言語（既定は ja）
 * @returns {{name: string, url: string}[]}
 */
export function getTodayVenueBreadcrumbItems(t, venueCode, lang = "ja") {
  return [
    { name: t("analysisPage.breadcrumbHome"), url: localizePath("/", lang) },
    {
      name: t(`venues.${venueCode}`),
      url: localizePath(`/venue/${venueCode}`, lang),
    },
  ];
}
