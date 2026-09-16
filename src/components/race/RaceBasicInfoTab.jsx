/**
 * RaceBasicInfoTab - レース詳細ページ「基本情報」タブ（BOA-306）
 *
 * 日和の期間別グリッド（勝率×7区分の数値羅列）をそのまま模倣せず、6艇の
 * 横棒グラフで「どの条件で調子が良いか」を直感的に見せる
 * （[[feedback_ui_visualization_over_statistical_rigor]]の方針）。
 *
 * データソースは2系統:
 * 1. 期間=今期 かつ グレード=全レースの場合（勝率/2連対率/3連対率のみ）:
 *    race_entriesの公式集計済み値（win_rate/local_win_rate/global_2rate/
 *    local_2rate/global_3rate/local_3rate）をそのまま使う。boatrace.jp側で
 *    算出済みの正確な値のため、自社で集計し直す必要が無い
 * 2. それ以外（グレード・期間で絞り込む場合、および平均STは常に）:
 *    getRacerScopedRaceStats(racerId)で選手の過去2年分の出走履歴を取得し、
 *    クライアント側でフィルタ・集計する（basicInfoStats.js）。平均STには
 *    公式集計値の相当品が無いため常にこちら（2026-09-16、レビュー指摘#1で
 *    平均STも会場/グレードでフィルタできるよう対応）。対象は表示中の6選手のみ
 *    （1選手×該当レースのみのライブ集計であり、BOA-303が問題視する
 *    全選手×全会場の横断集計とはスコープが異なる）
 *
 * 「得意会場」ドリルダウンは、上記2と同じgetRacerScopedRaceStatsの生データを
 * 会場別に集計し、現在選択中の指標でランキングする（2026-09-16、レビュー
 * 指摘#3で固定指標(勝率)から選択中指標に連動するよう変更。以前使っていた
 * getRacerVenueStatsは廃止）
 */
import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { BOAT_COLORS } from "../../utils/colors";
import { useLocalizedPath } from "../../hooks/useLocalizedPath";
import { supabaseDataService } from "../../services/supabaseDataService";
import {
  filterRecords,
  computeRates,
  getRecentRaces,
  computeVenueRanking,
  SMALL_SAMPLE_THRESHOLD,
} from "./basicInfoStats";
import "./RaceBasicInfoTab.css";

const METRICS = ["winRate", "top2Rate", "top3Rate", "avgSt"];
const GRADES = ["all", "ippan", "sgg1"];
// 「初日」「最終日」は当初検討したが、判定に使うrace_conditions.series_day/
// is_final_dayが実データで常にnull（generate-predictions.jsが未実装のまま
// null固定で書き込む、2026-09-15確認）のため削除した（basicInfoStats.js参照）
const PERIODS = ["current", "last3m", "last1m"];
const PRESETS = [
  { scope: "local", grade: "ippan" },
  { scope: "local", grade: "sgg1" },
  { scope: "national", grade: "sgg1" },
];

function formatRate(value) {
  return value === null || value === undefined ? "—" : `${value.toFixed(1)}%`;
}

// 「勝率」は公式集計値（win_rate/local_win_rate）を使う場合、実際の1着率(%)
// ではなく順位の重み付き平均点（0〜9程度、DataRaceTable等でも%無し表記）。
// グレード・期間で絞り込んだ場合は自社集計の「実際の1着率(%)」に切り替わる
// （公式の点数計算式を自社で再現することはできないため）。この2つは定義が
// 異なる別の指標であるため、表示の出し分け・注記が必須
function formatWinRate(value, isPercentage) {
  if (value === null || value === undefined) return "—";
  return isPercentage ? `${value.toFixed(1)}%` : value.toFixed(2);
}

// 指標に応じた値のフォーマット（得意会場ランキング等、勝率の公式/自社切替が
// 関係しない箇所で使う汎用フォーマッタ）
function formatMetricValue(metric, value) {
  if (value === null || value === undefined) return "—";
  return metric === "avgSt" ? value.toFixed(2) : `${value.toFixed(1)}%`;
}

function RaceBasicInfoTab({ raceId, venueCode, players }) {
  const { t } = useTranslation();
  const localize = useLocalizedPath();
  const [metric, setMetric] = useState("winRate");
  const [scope, setScope] = useState("national");
  const [grade, setGrade] = useState("all");
  const [period, setPeriod] = useState("current");
  const [expandedBoat, setExpandedBoat] = useState(null);
  const [expandedView, setExpandedView] = useState("trend");
  const [officialRates, setOfficialRates] = useState(null);
  const [scopedStatsByRacer, setScopedStatsByRacer] = useState({});

  const sortedPlayers = [...(players ?? [])].sort(
    (a, b) => a.number - b.number,
  );

  useEffect(() => {
    if (!raceId) return undefined;
    let cancelled = false;
    supabaseDataService
      .getRaceEntryOfficialRatesBreakdown(raceId)
      .then((data) => {
        if (!cancelled) setOfficialRates(data);
      });
    return () => {
      cancelled = true;
    };
  }, [raceId]);

  const ensureScopedStats = useCallback((racerId) => {
    if (!racerId) return;
    setScopedStatsByRacer((prev) => {
      if (prev[racerId]) return prev;
      supabaseDataService.getRacerScopedRaceStats(racerId).then((data) => {
        setScopedStatsByRacer((cur) => ({ ...cur, [racerId]: data }));
      });
      // 取得中はundefinedのまま保持し、二重取得を防ぐ
      return { ...prev, [racerId]: undefined };
    });
  }, []);

  // 平均STには公式集計値の相当品が無いため、常に自社集計（getRacerScopedRaceStats）
  // を使う。勝率/2連対率/3連対率はグレード・期間を絞り込んだ場合のみ自社集計に切り替わる
  const needsOwnAggregation =
    metric === "avgSt" || grade !== "all" || period !== "current";

  // 自社集計が必要になった瞬間、6選手分の履歴データをまとめて取得する
  useEffect(() => {
    if (!needsOwnAggregation) return;
    sortedPlayers.forEach((p) => ensureScopedStats(p.racerId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsOwnAggregation, raceId]);

  const officialRowFor = (boatNumber) =>
    (officialRates ?? []).find((r) => r.boat_number === boatNumber) ?? null;

  // 表示用の1艇分の値を計算する（value/n/isSmallSample/loading）
  const valueFor = (p) => {
    if (!needsOwnAggregation) {
      const row = officialRowFor(p.number);
      if (!row)
        return {
          value: null,
          n: null,
          isSmallSample: false,
          loading: officialRates === null,
        };
      const value =
        scope === "local"
          ? metric === "winRate"
            ? row.local_win_rate
            : metric === "top2Rate"
              ? row.local_2rate
              : row.local_3rate
          : metric === "winRate"
            ? row.win_rate
            : metric === "top2Rate"
              ? row.global_2rate
              : row.global_3rate;
      return {
        value: value === null || value === undefined ? null : Number(value),
        n: null,
        isSmallSample: false,
        loading: false,
      };
    }

    const records = scopedStatsByRacer[p.racerId];
    if (records === undefined)
      return { value: null, n: null, isSmallSample: false, loading: true };
    const filtered = filterRecords(records ?? [], {
      venueCode,
      scope,
      grade,
      period,
    });
    const rates = computeRates(filtered);
    if (metric === "avgSt") {
      return {
        value: rates.avgSt,
        n: rates.avgStN,
        isSmallSample:
          rates.avgStN > 0 && rates.avgStN < SMALL_SAMPLE_THRESHOLD,
        loading: false,
      };
    }
    return {
      value: rates[metric],
      n: rates.n,
      isSmallSample: rates.n > 0 && rates.n < SMALL_SAMPLE_THRESHOLD,
      loading: false,
    };
  };

  if (sortedPlayers.length === 0) return null;

  const values = sortedPlayers.map((p) => ({ boat: p.number, ...valueFor(p) }));
  const numericValues = values
    .map((v) => v.value)
    .filter((v) => v !== null && v !== undefined);
  const maxValue = numericValues.length > 0 ? Math.max(...numericValues) : 0;
  const minValue = numericValues.length > 0 ? Math.min(...numericValues) : 0;

  // 勝率(公式値)・平均STは0-100%のスケールではない（勝率は0〜9程度の点数、
  // STは秒数）ため、6艇内の相対最小最大でバーの長さを決める。
  // 2連対率/3連対率、および自社集計に切り替わった勝率(1着率%)は
  // 素直に0-100%スケールで表示する
  const isRelativeScaleMetric =
    metric === "avgSt" || (metric === "winRate" && !needsOwnAggregation);

  const barWidthPercent = (value) => {
    if (value === null || value === undefined) return 0;
    if (isRelativeScaleMetric) {
      if (maxValue === minValue) return 50;
      const ratio = (value - minValue) / (maxValue - minValue);
      // STのみ「小さいほど良い」ため反転する
      return metric === "avgSt" ? (1 - ratio) * 100 : ratio * 100;
    }
    return Math.max(0, Math.min(100, value));
  };

  const isPresetActive = (preset) =>
    preset.scope === scope && preset.grade === grade;

  const toggleExpanded = (boatNumber, racerId) => {
    if (expandedBoat === boatNumber) {
      setExpandedBoat(null);
      return;
    }
    setExpandedBoat(boatNumber);
    setExpandedView("trend");
    ensureScopedStats(racerId);
  };

  return (
    <div className="race-basic-info-tab">
      <p className="rbit-note">{t("basicInfo.note")}</p>

      <div
        className="rbit-chip-row"
        role="group"
        aria-label={t("basicInfo.metricLabel")}
      >
        {METRICS.map((m) => (
          <button
            key={m}
            type="button"
            className={`rbit-chip${metric === m ? " is-active" : ""}`}
            onClick={() => setMetric(m)}
          >
            {t(`basicInfo.metrics.${m}`)}
          </button>
        ))}
      </div>

      {metric === "winRate" && needsOwnAggregation && (
        <p className="rbit-metric-caveat">
          {t("basicInfo.winRateSwitchCaveat")}
        </p>
      )}

      <div
        className="rbit-chip-row"
        role="group"
        aria-label={t("basicInfo.scopeLabel")}
      >
        {["national", "local"].map((s) => (
          <button
            key={s}
            type="button"
            className={`rbit-chip${scope === s ? " is-active" : ""}`}
            onClick={() => setScope(s)}
          >
            {t(`basicInfo.scopes.${s}`)}
          </button>
        ))}
      </div>

      <div
        className="rbit-chip-row"
        role="group"
        aria-label={t("basicInfo.gradeLabel")}
      >
        {GRADES.map((g) => (
          <button
            key={g}
            type="button"
            className={`rbit-chip${grade === g ? " is-active" : ""}`}
            onClick={() => setGrade(g)}
          >
            {t(`basicInfo.grades.${g}`)}
          </button>
        ))}
      </div>

      <div className="rbit-preset-row">
        {PRESETS.map((preset, idx) => (
          <button
            key={idx}
            type="button"
            className={`rbit-preset${isPresetActive(preset) ? " is-active" : ""}`}
            onClick={() => {
              setScope(preset.scope);
              setGrade(preset.grade);
            }}
          >
            {t(`basicInfo.scopes.${preset.scope}`)}
            {t(`basicInfo.grades.${preset.grade}`)}
          </button>
        ))}
      </div>

      <details className="rbit-period-details">
        <summary>{t("basicInfo.periodSummary")}</summary>
        <div className="rbit-chip-row">
          {PERIODS.map((p) => (
            <button
              key={p}
              type="button"
              className={`rbit-chip${period === p ? " is-active" : ""}`}
              onClick={() => setPeriod(p)}
            >
              {t(`basicInfo.periods.${p}`)}
            </button>
          ))}
        </div>
        {grade !== "all" && period === "current" && (
          <p className="rbit-period-caveat">{t("basicInfo.periodCaveat")}</p>
        )}
      </details>

      <div className="rbit-bars">
        {values.map(({ boat, value, n, isSmallSample, loading }) => {
          const player = sortedPlayers.find((p) => p.number === boat);
          const color = BOAT_COLORS[boat] || {};
          return (
            <div key={boat} className="rbit-bar-block">
              <button
                type="button"
                className="rbit-bar-row"
                onClick={() => toggleExpanded(boat, player?.racerId)}
                aria-expanded={expandedBoat === boat}
              >
                <span
                  className="rbit-boat-chip"
                  style={{ background: color.bg, color: color.text }}
                >
                  {boat}
                </span>
                <span className="rbit-name" translate="no">
                  {player?.name}
                </span>
                <span className="rbit-bar-track">
                  {!loading && (
                    <span
                      className={`rbit-bar-fill${isSmallSample ? " is-small-sample" : ""}`}
                      style={{
                        width: `${barWidthPercent(value)}%`,
                        background: color.bg,
                      }}
                    />
                  )}
                </span>
                <span className="rbit-value">
                  {loading ? (
                    <span className="rbit-skeleton" aria-hidden="true" />
                  ) : metric === "avgSt" ? (
                    value !== null ? (
                      value.toFixed(2)
                    ) : (
                      "—"
                    )
                  ) : metric === "winRate" ? (
                    formatWinRate(value, needsOwnAggregation)
                  ) : (
                    formatRate(value)
                  )}
                  {n !== null && n !== undefined && (
                    <span
                      className={`rbit-n${isSmallSample ? " is-small-sample" : ""}`}
                    >
                      {t(
                        n === 0 ? "basicInfo.noData" : "basicInfo.sampleCount",
                        { n },
                      )}
                    </span>
                  )}
                </span>
                <span className="rbit-expand-arrow">
                  {expandedBoat === boat ? "▼" : "▶"}
                </span>
              </button>

              {expandedBoat === boat && (
                <div className="rbit-expanded">
                  <div className="rbit-expanded-tabs">
                    <button
                      type="button"
                      className={`rbit-expanded-tab${expandedView === "trend" ? " is-active" : ""}`}
                      onClick={() => setExpandedView("trend")}
                    >
                      {t("basicInfo.viewTrend")}
                    </button>
                    <button
                      type="button"
                      className={`rbit-expanded-tab${expandedView === "venue" ? " is-active" : ""}`}
                      onClick={() => setExpandedView("venue")}
                    >
                      {t("basicInfo.viewVenue")}
                    </button>
                  </div>

                  {expandedView === "trend" &&
                    (() => {
                      const records = scopedStatsByRacer[player?.racerId];
                      if (records === undefined || records === null) {
                        return (
                          <p className="rbit-expanded-loading">
                            {t("basicInfo.loading")}
                          </p>
                        );
                      }
                      const recent = getRecentRaces(records, 5);
                      if (recent.length === 0) {
                        return (
                          <p className="rbit-expanded-empty">
                            {t("basicInfo.noHistory")}
                          </p>
                        );
                      }
                      return (
                        <div className="rbit-trend">
                          <p className="rbit-trend-note">
                            {t("basicInfo.trendNote")}
                          </p>
                          <div className="rbit-trend-bars">
                            {recent.map((race) => (
                              <Link
                                key={race.raceId}
                                to={localize(`/race/${race.raceId}`)}
                                className="rbit-trend-item"
                              >
                                <span
                                  className={`rbit-trend-finish rbit-trend-finish-${race.finish ?? "unknown"}`}
                                >
                                  {race.finish !== null
                                    ? t("review.finishPosition", {
                                        position: race.finish,
                                      })
                                    : t("basicInfo.finishUnknown")}
                                </span>
                                {race.raceNumber !== null &&
                                  race.course !== null && (
                                    <span className="rbit-trend-race-course">
                                      {t("basicInfo.trendRaceCourse", {
                                        race: race.raceNumber,
                                        course: race.course,
                                      })}
                                    </span>
                                  )}
                                <span className="rbit-trend-date">
                                  {race.date}
                                </span>
                                <span className="rbit-trend-venue">
                                  {t(`venues.${race.venueCode}`)}
                                </span>
                              </Link>
                            ))}
                          </div>
                        </div>
                      );
                    })()}

                  {expandedView === "venue" &&
                    (() => {
                      const records = scopedStatsByRacer[player?.racerId];
                      if (records === undefined || records === null) {
                        return (
                          <p className="rbit-expanded-loading">
                            {t("basicInfo.loading")}
                          </p>
                        );
                      }
                      const ranking = computeVenueRanking(records, metric);
                      if (ranking.length === 0) {
                        return (
                          <p className="rbit-expanded-empty">
                            {t("basicInfo.noVenueData")}
                          </p>
                        );
                      }
                      const currentRank =
                        ranking.findIndex((r) => r.venueCode === venueCode) + 1;
                      return (
                        <div className="rbit-venue-ranking">
                          <p className="rbit-venue-metric-label">
                            {t("basicInfo.venueRankingFor", {
                              metric: t(`basicInfo.metrics.${metric}`),
                            })}
                          </p>
                          {currentRank > 0 && (
                            <p className="rbit-venue-current-rank">
                              {t("basicInfo.currentVenueRank", {
                                venue: t(`venues.${venueCode}`),
                                rank: currentRank,
                                total: ranking.length,
                              })}
                            </p>
                          )}
                          <ol className="rbit-venue-list">
                            {ranking.slice(0, 5).map((row, idx) => {
                              const rowN =
                                metric === "avgSt" ? row.avgStN : row.n;
                              const rowValue =
                                metric === "avgSt" ? row.avgSt : row[metric];
                              return (
                                <li
                                  key={row.venueCode}
                                  className={
                                    row.venueCode === venueCode
                                      ? "rbit-venue-item is-current"
                                      : "rbit-venue-item"
                                  }
                                >
                                  <span className="rbit-venue-rank">
                                    {idx + 1}
                                  </span>
                                  <span className="rbit-venue-name">
                                    {t(`venues.${row.venueCode}`)}
                                  </span>
                                  <span className="rbit-venue-rate">
                                    {formatMetricValue(metric, rowValue)}
                                  </span>
                                  <span className="rbit-venue-n">
                                    {t("basicInfo.sampleCount", { n: rowN })}
                                  </span>
                                </li>
                              );
                            })}
                          </ol>
                        </div>
                      );
                    })()}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default RaceBasicInfoTab;
