/**
 * 会場ページ（/venue/N）の見出しの直下に置く常設の要約2行（BOA-1189 GS02-b、2026-10-31 オーナー決定）。
 *
 * - 1行目: 直近1年の1コースの1着率と全国の値。全国と比べる文（高い・低い）は、その会場を除く全国との差が
 *   Bonferroni を通った会場だけ（vsNational.course1）。ほかの会場は「差ははっきりしない」
 * - 2行目: 逃げ以外の決まり手の上位3つ（「上位3つ」と書く。全部の列挙に読ませない）（全レースのうちの割合）。逃げは1コース1着の95.6%で、
 *   1行目と同じことを言い直すので文に入れない（docs/reference/venue-summary-stats.md「1コースの逃げと…」）
 *
 * 人の画面（VenueSummaryLines）とボット向け HTML（botPageModel.js の buildVenueModel）が同じ関数を使う。
 * Node からも import するため、ブラウザ専用の依存を持ち込まない。検証: scripts/maintenance/verify-venue-summary.js
 */
import { VENUE_SUMMARY_STATS } from "../data/venueSummaryStats.js";

/** 2行目に出す決まり手（逃げは除く。恵まれは割合で会場を比べないので出さない） */
const SECOND_LINE_TECHNIQUES = ["sashi", "makuri", "makurizashi", "nuki"];
const SECOND_LINE_COUNT = 3;

const COURSE1_KEY = {
  higher: "venueSummary.course1Higher",
  lower: "venueSummary.course1Lower",
};

/** 件数は全言語で3桁区切り（2,376） */
export const formatCount = (n) => n.toLocaleString("en-US");
/** 割合は小数1桁（53.0 も 53.0 と書く） */
export const formatRate = (r) => r.toFixed(1);

/**
 * @param {(key: string, params?: object) => string} t
 * @param {number} venueCode - 1〜24
 * @param {typeof VENUE_SUMMARY_STATS} [stats]
 * @returns {{course: string, techniques: string} | null} 会場の値が無ければ null
 */
export function venueSummaryLines(t, venueCode, stats = VENUE_SUMMARY_STATS) {
  const venue = stats.venues[venueCode];
  if (!venue) return null;
  const course1 = venue.courses.find((c) => c.course === 1);
  const national1 = stats.national.courses.find((c) => c.course === 1);
  const course = t(
    COURSE1_KEY[venue.vsNational.course1] ?? "venueSummary.course1Unclear",
    {
      venue: t(`venues.${venueCode}`),
      // 窓の終わりの日。月1回の更新が遅れても「直近1年」がいつまでかが文で分かる（wording-editor、BOA-1189）
      to: venueSummaryPeriod(stats).to,
      races: formatCount(venue.races),
      rate: formatRate(course1.rate),
      nationalRaces: formatCount(stats.national.races),
      nationalRate: formatRate(national1.rate),
    },
  );
  const top = [...SECOND_LINE_TECHNIQUES]
    .sort(
      (a, b) =>
        venue.techniques[b].count - venue.techniques[a].count ||
        SECOND_LINE_TECHNIQUES.indexOf(a) - SECOND_LINE_TECHNIQUES.indexOf(b),
    )
    .slice(0, SECOND_LINE_COUNT)
    .map((slug) =>
      t("venueSummary.techniqueItem", {
        // 用語集どおり「ローマ字＋英語」（Nige (Escape)）。カードの表・もっと詳しくと同じ表記にする
        name: t(`techniques.${slug}`),
        rate: formatRate(venue.techniques[slug].rate),
      }),
    );
  const techniques = t("venueSummary.techniques", {
    list: top.join(t("listSeparator")),
  });
  return { course, techniques };
}

/** 要約の期間（2025/10/31〜2026/10/30 の形。カードの脚注と同じ） */
export function venueSummaryPeriod(stats = VENUE_SUMMARY_STATS) {
  const fmt = (d) => d.replaceAll("-", "/");
  return { from: fmt(stats.from), to: fmt(stats.to) };
}
