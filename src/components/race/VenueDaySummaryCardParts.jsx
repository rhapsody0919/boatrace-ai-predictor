import { useTranslation } from "react-i18next";
import { translateTechnique } from "./raceIndicators";
import { formatDateLocalized } from "../../utils/formatters";
import CollapsibleSection from "../venue/CollapsibleSection";
import { buildDayTrend, sortTechniqueCounts } from "./venueDayTrend";
import "./VenueDaySummaryCard.css";

const COURSES = [1, 2, 3, 4, 5, 6];

function StatItem({ value, label }) {
  return (
    <div className="vds-stat-item">
      <span className="vds-stat-value">{value}</span>
      <span className="vds-stat-label">{label}</span>
    </div>
  );
}

function formatRate(rate) {
  return rate !== null ? `${rate.toFixed(0)}%` : "—";
}

function StatGrid({ summary }) {
  const { t } = useTranslation();
  return (
    <div className="vds-stat-grid">
      <StatItem
        value={
          summary.avgPayout !== null
            ? `¥${Math.round(summary.avgPayout).toLocaleString()}`
            : "—"
        }
        label={t("venueDaySummary.avgPayoutLabel")}
      />
      <StatItem
        value={formatRate(summary.manshuRate)}
        label={t("venueDaySummary.manshuRateLabel")}
      />
      {/* 実装は艇番基準（rank1===1かつ逃げ）なので「イン逃げ率」ではなく
        「1号艇の逃げ率」と書く。FR-6の「1コース逃げ率」とは定義が違う */}
      <StatItem
        value={formatRate(summary.nigeRate)}
        label={t("venueDaySummary.nigeRateLabel")}
      />
    </div>
  );
}

function TechniqueBreakdown({ summary }) {
  const { t } = useTranslation();
  return (
    <div className="vds-breakdown">
      <div className="vds-subheading">
        {t("venueDaySummary.techniqueBreakdownLabel")}
      </div>
      <div className="vds-badge-row">
        {/* 1行要約と同じ並びにする（素の sort だと同数のときの
          順序が挿入順に依存し、上の文と食い違って見える） */}
        {sortTechniqueCounts(summary.techniqueCounts).map(
          ({ technique, count }) => (
            <span className="vds-badge" key={technique}>
              {translateTechnique(t, technique)} {count}
            </span>
          ),
        )}
      </div>
    </div>
  );
}

function CourseWinBreakdown({ summary }) {
  const { t } = useTranslation();
  return (
    <div className="vds-breakdown">
      <div className="vds-subheading">
        {t("venueDaySummary.entryCourseWinLabel")}
      </div>
      <div className="vds-badge-row">
        {COURSES.map((course) => (
          <span className="vds-badge" key={course}>
            {t("venueDaySummary.courseN", { n: course })}{" "}
            {summary.entryCourseWinCounts?.[course] ?? 0}
          </span>
        ))}
      </div>
    </div>
  );
}

function BreakdownSection({ summary, expanded, onToggle }) {
  const { t } = useTranslation();
  const hasTechniqueBreakdown =
    Object.keys(summary.techniqueCounts ?? {}).length > 0;
  const hasCourseWinBreakdown = COURSES.some(
    (c) => (summary.entryCourseWinCounts?.[c] ?? 0) > 0,
  );
  if (!hasTechniqueBreakdown && !hasCourseWinBreakdown) return null;
  return (
    <>
      <button
        type="button"
        className="vds-detail-toggle"
        onClick={onToggle}
        aria-expanded={expanded}
      >
        {expanded ? "▾ " : "▸ "}
        {t("venueDaySummary.breakdownToggle")}
      </button>
      {expanded && (
        <div className="vds-detail">
          {hasTechniqueBreakdown && <TechniqueBreakdown summary={summary} />}
          {hasCourseWinBreakdown && <CourseWinBreakdown summary={summary} />}
        </div>
      )}
    </>
  );
}

function Lede({ summary, trend }) {
  const { t } = useTranslation();
  const techniqueList = trend.techniques
    .map(
      (x) =>
        `${translateTechnique(t, x.technique)}${t("venueDaySummary.countUnit", { n: x.count })}`,
    )
    .join(t("venueDaySummary.techniqueSeparator"));
  return (
    <p className="vds-lede">
      {/* 決まり手が全レース分そろっていない（当日によく起きる）ときは、
          並べた回数の合計が確定レース数と合わないため、判明レース数を明示する */}
      {t(
        trend.techniqueTotal === summary.raceCount
          ? "venueDaySummary.ledeDay"
          : "venueDaySummary.ledeDayPartial",
        {
          n: summary.raceCount,
          m: trend.techniqueTotal,
          techniques: techniqueList,
        },
      )}
      {trend.nigeRate !== null && (
        <>
          {" "}
          <span className="vds-lede-accent">
            {t("venueDaySummary.ledeNige", {
              rate: trend.nigeRate.toFixed(0),
            })}
          </span>
        </>
      )}
      {/* 当日は1着艇の実進入コースが取れないため、コース付き／コース無しの
            2つの文を用意して出し分ける（venueDayTrend.js参照） */}
      {trend.thisRace &&
        ` ${t(
          trend.thisRace.course !== null
            ? "venueDaySummary.ledeThisRaceWithCourse"
            : "venueDaySummary.ledeThisRace",
          {
            course: trend.thisRace.course,
            technique: translateTechnique(t, trend.thisRace.technique),
            ordinal: trend.thisRace.ordinal,
          },
        )}`}
    </p>
  );
}

export function VenueDaySummaryContent({
  summary,
  venueCode,
  date,
  raceId,
  collapsible,
  expanded,
  onToggleExpanded,
}) {
  const { t, i18n } = useTranslation();
  const trend = buildDayTrend(summary, raceId);
  const venueName = t(`venues.${venueCode}`);
  const dateLabel = formatDateLocalized(date, i18n.resolvedLanguage);
  // 折りたたんだ見出しの要約1行: 確定レース数と1号艇の逃げ率（中身の代表値）
  const collapsedTeaser =
    trend.nigeRate !== null
      ? t("venueDaySummary.collapsedTeaser", {
          n: summary.raceCount,
          rate: trend.nigeRate.toFixed(0),
        })
      : t("venueDaySummary.collapsedTeaserNoNige", { n: summary.raceCount });

  return (
    <section className={`vds-card${collapsible ? " is-collapsible" : ""}`}>
      <CollapsibleSection
        collapsible={collapsible}
        storageKey="venueDaySummary"
        summary={
          <span className="vds-collapsed-head">
            <h3 className="vds-heading">{t("venueDaySummary.title")}</h3>
            <span className="vds-teaser" data-testid="venue-day-summary-teaser">
              {collapsedTeaser}
            </span>
          </span>
        }
      >
        {!collapsible && (
          <h3 className="vds-heading">{t("venueDaySummary.title")}</h3>
        )}
        <p className="vds-note">
          {t("venueDaySummary.note", {
            date: dateLabel,
            venue: venueName,
            n: summary.raceCount,
          })}
        </p>

        <Lede summary={summary} trend={trend} />

        <StatGrid summary={summary} />

        <BreakdownSection
          summary={summary}
          expanded={expanded}
          onToggle={onToggleExpanded}
        />
      </CollapsibleSection>
    </section>
  );
}
