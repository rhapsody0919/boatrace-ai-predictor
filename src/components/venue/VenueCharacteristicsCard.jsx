/**
 * VenueCharacteristicsCard - 会場ページの「<会場>のコース別成績と特徴（直近1年）」の節
 *
 * 出走表の後に開いた状態で出す（BOA-1687 GS02 V1。以前は次の発走の直上で畳んでいた。BOA-1189・BOA-546）。
 * 直近1年の進入コース別の1着率の表、全レースのうちの決まり手の割合、水面（公式の場データ）を出す。
 * 数字は見出しの直下の要約2行（VenueSummaryLines）と同じ静的な値（src/data/venueSummaryStats.js、月1回作る）で、
 * 期間の文字列も要約と同じ venueSummaryPeriod で組む（同じ指標を違う期間で並べない）。
 * 下の「もっと詳しく」は過去90日・枠番別の2連率・3連率と、勝ったときの決まり手（VenueCharacteristicsDetails）。
 * /venue は TRANSLATED_PATHS 対象のため、文言は i18n キー経由
 */
import { useTranslation } from "react-i18next";
import { VENUE_SUMMARY_STATS } from "../../data/venueSummaryStats";
import { venueWaterProfile } from "../../data/venueWaterProfiles";
import {
  VENUE_COURSE_SECTION_ID,
  venueCourseTableRows,
} from "../../pure/venueCourseTableRows";
import {
  formatCount,
  formatRate,
  venueSummaryPeriod,
} from "../../utils/venueSummary";
import VenueCharacteristicsDetails from "./VenueCharacteristicsDetails";
import VenueCourseTable from "./VenueCourseTable";
import "./VenueCharacteristicsCard.css";

const TABLE_TECHNIQUES = ["nige", "sashi", "makuri", "makurizashi", "nuki"];

// 水面（水質と干満差）。公式の場データ（src/data/venueWaterProfiles.js）
function waterText(t, venueCode) {
  const profile = venueWaterProfile(venueCode);
  if (!profile) return null;
  return t("venueCharacteristics.waterText", {
    water: t(`venueCharacteristics.waterType.${profile.waterType}`),
    tidal: t(
      profile.tidal
        ? "venueCharacteristics.tidalYes"
        : "venueCharacteristics.tidalNo",
    ),
  });
}

function TechniqueTable({ t, venue, national }) {
  return (
    <>
      <h3 className="venue-characteristics-subtitle">
        {t("venueCharacteristics.techniqueTitle")}
      </h3>
      <table
        className="venue-technique-table"
        data-testid="venue-technique-table"
      >
        <thead>
          <tr>
            <th scope="col">{t("venueCharacteristics.techniqueName")}</th>
            <th scope="col">{t("venueCharacteristics.techniqueVenue")}</th>
            <th scope="col">{t("venueCharacteristics.techniqueNational")}</th>
          </tr>
        </thead>
        <tbody>
          {TABLE_TECHNIQUES.map((slug) => (
            <tr key={slug}>
              <th scope="row">{t(`techniques.${slug}`)}</th>
              <td>{formatRate(venue.techniques[slug].rate)}%</td>
              <td>{formatRate(national.techniques[slug].rate)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="venue-characteristics-note">
        {t("venueCharacteristics.megumareNote", {
          races: formatCount(venue.races),
          count: venue.techniques.megumare.count,
          nationalRaces: formatCount(national.races),
          nationalCount: formatCount(national.techniques.megumare.count),
        })}
      </p>
    </>
  );
}

// 直近1年の脚注は、1年の表の直後・過去90日の「もっと詳しく」より上に置く（90日の説明に読ませない）
function YearFootnote({ t, venue, national, period }) {
  return (
    <p className="venue-characteristics-footnote">
      {t("venueCharacteristics.footnote", {
        count: formatCount(venue.races),
        nationalCount: formatCount(national.races),
        from: period.from,
        to: period.to,
      })}
    </p>
  );
}

export default function VenueCharacteristicsCard({ venueCode }) {
  const { t } = useTranslation();
  const venue = VENUE_SUMMARY_STATS.venues[venueCode];
  const national = VENUE_SUMMARY_STATS.national;
  const rows = venueCourseTableRows(venue, national);
  if (!rows) return null;
  const period = venueSummaryPeriod();
  const water = waterText(t, venueCode);

  return (
    <section
      id={VENUE_COURSE_SECTION_ID}
      className="venue-characteristics-card"
      data-testid="venue-course-section"
      aria-labelledby={`${VENUE_COURSE_SECTION_ID}-title`}
    >
      <div className="venue-hud-scanbar" aria-hidden="true" />
      <h2 id={`${VENUE_COURSE_SECTION_ID}-title`}>
        {t("venueCharacteristics.sectionTitle", {
          venue: t(`venues.${venueCode}`),
        })}
      </h2>
      <p
        className="venue-characteristics-period"
        data-testid="venue-course-period"
      >
        {t("venueCharacteristics.period", {
          from: period.from,
          to: period.to,
          races: formatCount(venue.courseRaces),
          nationalRaces: formatCount(national.courseRaces),
        })}
      </p>
      <p className="venue-characteristics-note">
        {t("venueCharacteristics.note")}
      </p>
      <VenueCourseTable t={t} rows={rows} />

      <TechniqueTable t={t} venue={venue} national={national} />

      {water && (
        <>
          <h3 className="venue-characteristics-subtitle">
            {t("venueCharacteristics.waterTitle")}
          </h3>
          <p className="venue-characteristics-water">{water}</p>
        </>
      )}

      <YearFootnote t={t} venue={venue} national={national} period={period} />
      <VenueCharacteristicsDetails venueCode={venueCode} />
    </section>
  );
}
