/**
 * VenueDaySummaryCard - 「この日の水面傾向」（phase a FR-5 / BOA-222）
 *
 * 設計: docs/design/analysis-visualization-upgrade/screens.md §3.5・§3.6
 * 承認済みモック: https://claude.ai/artifact/N3e6TSHmoPXzLNX1SSSLZK （ResultTab）
 *
 * 元は直前情報タブ（`RaceBeforeInfoTab`）のインライン実装だったが、粒度
 * （レース単位ではなく会場×当日単位）と更新タイミング（発走前に確定していく
 * のではなく、レースが終わるたびに増える事後集計）が同タブの他の項目とずれて
 * いたため、**結果タブ（払戻の下）と会場ページ**へ移した（2026-09-23ユーザー承認）。
 *
 * ## 「本日」と書かない
 *
 * 結果タブは過去日のレースでも開かれ、会場ページも `/races/:date/:venueCode`
 * で過去日を出す。**日付は常に出す**（`isToday` で分岐しない）。会場ページは
 * 当日だと日付をどこにも表示しないため、分岐すると当日は日付が一切出なくなる。
 *
 * ## raceId を渡すと「このレース」の位置づけが1文増える
 *
 * 結果タブは `raceId` を渡し、会場ページは渡さない。判定規則と、当日は
 * 1着艇の実進入コースが出せない事情は `venueDayTrend.js` のコメント参照。
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabaseDataService } from "../../services/supabaseDataService";
import { translateTechnique } from "./raceIndicators";
import { formatDateLocalized } from "../../utils/formatters";
import InlineFetchError from "../InlineFetchError";
import { buildDayTrend } from "./venueDayTrend";
import "./VenueDaySummaryCard.css";

const COURSES = [1, 2, 3, 4, 5, 6];

function VenueDaySummaryCard({ venueCode, date, raceId = null }) {
  const { t, i18n } = useTranslation();
  // 取得結果・失敗を「どの会場のどの日のものか」とセットで持つ（`RacePitReportSection`
  // と同じ形。props だけ変わったときに前の日のデータが混ざらず、effect内で
  // 同期的に setState して連鎖レンダーを起こすこともない）
  const [loaded, setLoaded] = useState(null);
  const [failedKey, setFailedKey] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [expanded, setExpanded] = useState(false);

  const key = venueCode && date ? `${venueCode}-${date}` : null;

  useEffect(() => {
    if (!venueCode || !date) return undefined;
    const thisKey = `${venueCode}-${date}`;
    let cancelled = false;
    supabaseDataService
      .getVenueDaySummary(venueCode, date)
      .then((data) => {
        if (!cancelled) setLoaded({ key: thisKey, data });
      })
      .catch((err) => {
        // 取得失敗を「この日は0レース」に化けさせない（BOA-359）
        console.error(
          "この日の水面傾向の取得エラー:",
          err?.message ?? String(err),
        );
        if (!cancelled) setFailedKey(thisKey);
      });
    return () => {
      cancelled = true;
    };
  }, [venueCode, date, reloadKey]);

  const summary = loaded?.key === key ? loaded.data : undefined;
  const failed = failedKey === key;

  if (failed) {
    return (
      <section className="vds-card">
        <h3 className="vds-heading">{t("venueDaySummary.title")}</h3>
        <InlineFetchError
          onRetry={() => {
            setFailedKey(null);
            setReloadKey((k) => k + 1);
          }}
        />
      </section>
    );
  }

  // 取得中と「その日まだ1レースも確定していない」は、どちらもカードを出さない。
  // 空のカードを置くより、確定したら現れる方が読み手の期待に合う
  if (summary === undefined || summary.raceCount === 0) return null;

  const trend = buildDayTrend(summary, raceId);
  const venueName = t(`venues.${venueCode}`);
  const dateLabel = formatDateLocalized(date, i18n.resolvedLanguage);
  const techniqueList = trend.techniques
    .map(
      (x) =>
        `${translateTechnique(t, x.technique)}${t("venueDaySummary.countUnit", { n: x.count })}`,
    )
    .join(t("venueDaySummary.techniqueSeparator"));

  const hasTechniqueBreakdown =
    Object.keys(summary.techniqueCounts ?? {}).length > 0;
  const hasCourseWinBreakdown = COURSES.some(
    (c) => (summary.entryCourseWinCounts?.[c] ?? 0) > 0,
  );
  const hasBreakdown = hasTechniqueBreakdown || hasCourseWinBreakdown;

  return (
    <section className="vds-card">
      <h3 className="vds-heading">{t("venueDaySummary.title")}</h3>
      <p className="vds-note">
        {t("venueDaySummary.note", {
          date: dateLabel,
          venue: venueName,
          n: summary.raceCount,
        })}
      </p>

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

      <div className="vds-stat-grid">
        <div className="vds-stat-item">
          <span className="vds-stat-value">
            {summary.avgPayout !== null
              ? `¥${Math.round(summary.avgPayout).toLocaleString()}`
              : "—"}
          </span>
          <span className="vds-stat-label">
            {t("venueDaySummary.avgPayoutLabel")}
          </span>
        </div>
        <div className="vds-stat-item">
          <span className="vds-stat-value">
            {summary.manshuRate !== null
              ? `${summary.manshuRate.toFixed(0)}%`
              : "—"}
          </span>
          <span className="vds-stat-label">
            {t("venueDaySummary.manshuRateLabel")}
          </span>
        </div>
        <div className="vds-stat-item">
          <span className="vds-stat-value">
            {summary.nigeRate !== null
              ? `${summary.nigeRate.toFixed(0)}%`
              : "—"}
          </span>
          {/* 実装は艇番基準（rank1===1かつ逃げ）なので「イン逃げ率」ではなく
              「1号艇の逃げ率」と書く。FR-6の「1コース逃げ率」とは定義が違う */}
          <span className="vds-stat-label">
            {t("venueDaySummary.nigeRateLabel")}
          </span>
        </div>
      </div>

      {hasBreakdown && (
        <>
          <button
            type="button"
            className="vds-detail-toggle"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
          >
            {expanded ? "▾ " : "▸ "}
            {t("venueDaySummary.breakdownToggle")}
          </button>
          {expanded && (
            <div className="vds-detail">
              {hasTechniqueBreakdown && (
                <div className="vds-breakdown">
                  <div className="vds-subheading">
                    {t("venueDaySummary.techniqueBreakdownLabel")}
                  </div>
                  <div className="vds-badge-row">
                    {Object.entries(summary.techniqueCounts)
                      .sort((a, b) => b[1] - a[1])
                      .map(([technique, count]) => (
                        <span className="vds-badge" key={technique}>
                          {translateTechnique(t, technique)} {count}
                        </span>
                      ))}
                  </div>
                </div>
              )}
              {hasCourseWinBreakdown && (
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
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

export default VenueDaySummaryCard;
