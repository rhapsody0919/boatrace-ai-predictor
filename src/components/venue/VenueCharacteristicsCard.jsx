/**
 * VenueCharacteristicsCard - 会場の特徴カード（HUDテレメトリ表示）
 *
 * 直近1年の進入コース別の1着率と、全レースのうちの決まり手の割合を出す（BOA-1189 GS02-b、2026-10-31 オーナー決定）。
 * 数字は見出しの直下の要約2行（VenueSummaryLines）と同じ静的な値（src/data/venueSummaryStats.js、月1回作る）。
 * 同じ画面に期間の違う同じ指標を並べないため、以前の「過去90日・枠番別の1着率」はこのカードから外した
 * （docs/knowledge/fan-reactions.md「会場・レースのページ」）。
 *
 * - 行は進入コース（枠番ではない）。艇の色は枠番を行にするときだけ使うので、ここでは使わない（number-wording.md）
 * - 1着が30回に満たないコースは、値の横に回数を添える
 * - バーは0-100%の絶対スケール。全国の値はバー下のティックとラベル
 * - 下の「もっと詳しく」は過去90日・枠番別の2連率・3連率と、勝ったときの決まり手（VenueCharacteristicsDetails）
 * /venue は TRANSLATED_PATHS 対象のため、文言は i18n キー経由
 */
import { useTranslation } from "react-i18next";
import { VENUE_SUMMARY_STATS } from "../../data/venueSummaryStats";
import { venueWaterProfile } from "../../data/venueWaterProfiles";
import {
  formatCount,
  formatRate,
  venueSummaryPeriod,
} from "../../utils/venueSummary";
import CollapsibleSection from "./CollapsibleSection";
import VenueCharacteristicsDetails from "./VenueCharacteristicsDetails";
import "./VenueCharacteristicsCard.css";

// 1着の回数がこれ未満のコースは、割合の横に回数を添える（docs/knowledge/number-wording.md）
const SHOW_COUNT_BELOW = 30;
const TABLE_TECHNIQUES = ["nige", "sashi", "makuri", "makurizashi", "nuki"];

// コースごとの行に、全国の同コースの値を足す
function buildRows(venue, national) {
  return venue.courses.map((c) => ({
    ...c,
    national: national.courses.find((n) => n.course === c.course)?.rate ?? null,
  }));
}

// 1着が30回未満のコースは回数を添える（右の列の2行目）
function courseCountText(t, venue, row) {
  return row.wins < SHOW_COUNT_BELOW
    ? t("venueCharacteristics.winsOfRaces", {
        count: row.wins,
        races: formatCount(venue.courseRaces),
      })
    : null;
}

// 水面（淡水・汽水・海水）。公式の場データ（src/data/venueWaterProfiles.js）
function waterSummaryText(t, venueCode) {
  const waterType = venueWaterProfile(venueCode)?.waterType ?? null;
  return waterType ? t(`venueCharacteristics.waterType.${waterType}`) : null;
}

// 折りたたんだ見出しの1行: 水質と、開くと何が出るか。見出しの直下の要約2行と同じ数字を繰り返さない
// （畳んだカードが完成した部品に見えて開かれない。BOA-1189 ファン評価2周目）
function collapsedTeaserText(t, venueSummary) {
  return t(
    venueSummary
      ? "venueCharacteristics.collapsedTeaser"
      : "venueCharacteristics.collapsedTeaserNoSummary",
    { summary: venueSummary ?? "" },
  );
}

function CollapsedHead({ t, collapsedTeaser }) {
  return (
    <span className="venue-characteristics-collapsed-head">
      <h2>{t("venueCharacteristics.title")}</h2>
      <span
        className="venue-characteristics-teaser"
        data-testid="venue-characteristics-teaser"
      >
        {collapsedTeaser}
      </span>
    </span>
  );
}

function CourseAxisHeader({ t }) {
  return (
    <>
      <h3 className="venue-characteristics-subtitle">
        {t("venueCharacteristics.courseHeader")}
      </h3>
      <p className="venue-hud-legend">
        <span className="venue-hud-legend-tick" aria-hidden="true" />
        {t("venueCharacteristics.nationalLegend")}
      </p>
      <div className="venue-hud-header-row" aria-hidden="true">
        <span />
        <span className="venue-hud-axis-labels">
          <span>0</span>
          <span>25</span>
          <span>50</span>
          <span>75</span>
          <span>100%</span>
        </span>
        <span />
      </div>
    </>
  );
}

function CourseTrack({ row, index }) {
  return (
    <span className="venue-hud-track">
      <span className="venue-hud-grid-line" style={{ left: "25%" }} />
      <span className="venue-hud-grid-line" style={{ left: "50%" }} />
      <span className="venue-hud-grid-line" style={{ left: "75%" }} />
      <span
        className="venue-hud-fill"
        style={{
          width: `${row.rate}%`,
          animationDelay: `${index * 0.08}s`,
        }}
      />
      {row.national != null && (
        <span
          className="venue-hud-national-tick"
          style={{ left: `${row.national}%` }}
        />
      )}
    </span>
  );
}

// 値は右の列に出す（バーの上下に浮かせると、行どうし・カードの端で重なる）
function CourseValues({ t, row, count }) {
  return (
    <span className="venue-hud-values">
      <span className="venue-hud-own-value">{formatRate(row.rate)}%</span>
      {count && <span className="venue-hud-count">{count}</span>}
      {row.national != null && (
        <span className="venue-hud-national-value">
          {t("venueCharacteristics.nationalAverageTooltip", {
            value: formatRate(row.national),
          })}
        </span>
      )}
    </span>
  );
}

function CourseRow({ t, row, index, count }) {
  return (
    <div
      className="venue-hud-row"
      data-testid={`venue-hud-course-${row.course}`}
    >
      <span className="venue-hud-lane">
        {t("venueCharacteristics.courseLabel", { course: row.course })}
      </span>
      <CourseTrack row={row} index={index} />
      <CourseValues t={t} row={row} count={count} />
    </div>
  );
}

function CourseRows({ t, venue, rows }) {
  return (
    <div className="venue-hud-rows">
      {rows.map((row, index) => (
        <CourseRow
          key={row.course}
          t={t}
          row={row}
          index={index}
          count={courseCountText(t, venue, row)}
        />
      ))}
    </div>
  );
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

// collapsible: 会場ページで次のレースの直上に差し込むとき、見出しと要約1行に折りたたむ（BOA-546）
export default function VenueCharacteristicsCard({
  venueCode,
  collapsible = false,
}) {
  const { t } = useTranslation();
  const venue = VENUE_SUMMARY_STATS.venues[venueCode];
  if (!venue) return null;
  const national = VENUE_SUMMARY_STATS.national;
  const period = venueSummaryPeriod();
  const rows = buildRows(venue, national);
  const venueSummary = waterSummaryText(t, venueCode);
  const collapsedTeaser = collapsedTeaserText(t, venueSummary);

  return (
    <div
      className={`venue-characteristics-card${collapsible ? " is-collapsible" : ""}`}
    >
      <div className="venue-hud-scanbar" aria-hidden="true" />
      <CollapsibleSection
        collapsible={collapsible}
        storageKey="venueCharacteristics"
        summary={<CollapsedHead t={t} collapsedTeaser={collapsedTeaser} />}
      >
        {!collapsible && <h2>{t("venueCharacteristics.title")}</h2>}
        {venueSummary && (
          <p className="venue-characteristics-summary">{venueSummary}</p>
        )}
        <p className="venue-characteristics-note">
          {t("venueCharacteristics.note")}
        </p>

        <CourseAxisHeader t={t} />
        <CourseRows t={t} venue={venue} rows={rows} />

        <TechniqueTable t={t} venue={venue} national={national} />

        <YearFootnote t={t} venue={venue} national={national} period={period} />
        <VenueCharacteristicsDetails venueCode={venueCode} />
      </CollapsibleSection>
    </div>
  );
}
