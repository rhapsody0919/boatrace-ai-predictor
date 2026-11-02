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

  const rows = venue.courses.map((c) => ({
    ...c,
    national: national.courses.find((n) => n.course === c.course)?.rate ?? null,
  }));
  // 1着が30回未満のコースは回数を添える（右の列の2行目）
  const countText = (row) =>
    row.wins < SHOW_COUNT_BELOW
      ? t("venueCharacteristics.winsOfRaces", {
          count: row.wins,
          races: formatCount(venue.courseRaces),
        })
      : null;

  // 水面（淡水・汽水・海水）。公式の場データ（src/data/venueWaterProfiles.js）
  const waterType = venueWaterProfile(venueCode)?.waterType ?? null;
  const venueSummary = waterType
    ? t(`venueCharacteristics.waterType.${waterType}`)
    : null;
  // 折りたたんだ見出しの1行: 水質と、開くと何が出るか。見出しの直下の要約2行と同じ数字を繰り返さない
  // （畳んだカードが完成した部品に見えて開かれない。BOA-1189 ファン評価2周目）
  const collapsedTeaser = t(
    venueSummary
      ? "venueCharacteristics.collapsedTeaser"
      : "venueCharacteristics.collapsedTeaserNoSummary",
    { summary: venueSummary ?? "" },
  );

  return (
    <div
      className={`venue-characteristics-card${collapsible ? " is-collapsible" : ""}`}
    >
      <div className="venue-hud-scanbar" aria-hidden="true" />
      <CollapsibleSection
        collapsible={collapsible}
        storageKey="venueCharacteristics"
        summary={
          <span className="venue-characteristics-collapsed-head">
            <h2>{t("venueCharacteristics.title")}</h2>
            <span
              className="venue-characteristics-teaser"
              data-testid="venue-characteristics-teaser"
            >
              {collapsedTeaser}
            </span>
          </span>
        }
      >
        {!collapsible && <h2>{t("venueCharacteristics.title")}</h2>}
        {venueSummary && (
          <p className="venue-characteristics-summary">{venueSummary}</p>
        )}
        <p className="venue-characteristics-note">
          {t("venueCharacteristics.note")}
        </p>

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
        <div className="venue-hud-rows">
          {rows.map((row, index) => {
            const count = countText(row);
            return (
            <div
              className="venue-hud-row"
              key={row.course}
              data-testid={`venue-hud-course-${row.course}`}
            >
              <span className="venue-hud-lane">
                {t("venueCharacteristics.courseLabel", { course: row.course })}
              </span>
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
              {/* 値は右の列に出す（バーの上下に浮かせると、行どうし・カードの端で重なる） */}
              <span className="venue-hud-values">
                <span className="venue-hud-own-value">
                  {formatRate(row.rate)}%
                </span>
                {count && <span className="venue-hud-count">{count}</span>}
                {row.national != null && (
                  <span className="venue-hud-national-value">
                    {t("venueCharacteristics.nationalAverageTooltip", {
                      value: formatRate(row.national),
                    })}
                  </span>
                )}
              </span>
            </div>
            );
          })}
        </div>

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

        {/* 直近1年の脚注は、1年の表の直後・過去90日の「もっと詳しく」より上に置く（90日の説明に読ませない） */}
        <p className="venue-characteristics-footnote">
          {t("venueCharacteristics.footnote", {
            count: formatCount(venue.races),
            nationalCount: formatCount(national.races),
            from: period.from,
            to: period.to,
          })}
        </p>
        <VenueCharacteristicsDetails venueCode={venueCode} />
      </CollapsibleSection>
    </div>
  );
}
