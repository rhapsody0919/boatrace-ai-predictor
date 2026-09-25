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
import { useTranslation } from "react-i18next";
import { BOAT_COLORS } from "../../utils/colors";
import { useLocalizedPath } from "../../hooks/useLocalizedPath";
import { supabaseDataService } from "../../services/supabaseDataService";
import { parseRaceId } from "../../utils/raceId";
import RaceHistoryTable from "./RaceHistoryTable";
import {
  filterRecords,
  computeRates,
  getRecentRaces,
  computeVenueRanking,
  buildConditionRows,
  buildMeetResults,
  buildMeetTrend,
  MEET_ST_DIFF_THRESHOLD,
  MEET_EXHIBITION_DIFF_THRESHOLD,
  pickPeriodStats,
  SMALL_SAMPLE_THRESHOLD,
} from "./basicInfoStats";
import InlineFetchError from "../InlineFetchError";
import FlyingBadge from "./FlyingBadge";
import {
  computeSeriesScore,
  forecastSeriesScore,
  buildMeetRanking,
  SEMIFINAL_DEFAULT_SLOTS,
  MEET_SMALL_SAMPLE_RUNS,
} from "./seriesPoints";
import "./RaceBasicInfoTab.css";

const METRICS = ["winRate", "top2Rate", "top3Rate", "avgSt"];
// 「直近◯走」の件数。今節タブ（FR-3）と内容が重なりすぎたため5→10にした
// （2026-09-26ユーザーフィードバック。今節は節の区切りで、こちらは節をまたぐ流れを見る）
const RECENT_RACES_COUNT = 10;
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
  // 「前期」（racer_period_stats、phase a FR-4c）。6人分を1クエリで取る。
  // undefined=未取得、配列=取得済み、それ以外（{state:"forbidden"}）＝095未適用
  const [periodStats, setPeriodStats] = useState(undefined);
  const [periodFailed, setPeriodFailed] = useState(false);
  // 再読み込みボタン用。これを増やさないと取得effectの依存
  // （racerIdsKey / raceDate）が変わらず、再取得が起きないまま
  // 枠もエラーも消えて「失敗がデータなしに化ける」状態になる
  const [periodRetryToken, setPeriodRetryToken] = useState(0);
  // 節の全選手の得点率（FR-3 Phase B）。得点率は単独では読めないので、
  // 節の中での順位と準優の枠までの距離を出すために節全体を取る。
  // **今節タブを開いたときだけ**取得する（+3本・約700行。キーはレース単位で
  // キャッシュされ、6艇のどれを開いても使い回される）
  const [meetBoard, setMeetBoard] = useState(undefined);

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
      })
      .catch((err) => {
        // catchしないとofficialRatesがnullのまま残り、loading判定
        // （officialRates === null）が永久にtrueになって勝率・連対率のセルが
        // スケルトンのまま固まる。下のensureScopedStatsと同じ扱いに揃える
        console.error("公式勝率取得エラー:", err?.message ?? String(err));
        if (!cancelled) setOfficialRates([]);
      });
    return () => {
      cancelled = true;
    };
  }, [raceId]);

  // 「前期」は条件別タブを開いたときだけ要る値だが、6人分まとめて1クエリで済み
  // （racer_period_stats を period_year/period_no で絞って .in() する）、
  // タブを開くたびに待たせない方が読み手の体験が良いのでレース単位で先に取る。
  // racerIdsKey は「6人の登録番号の並び」で、同じレース内では変わらない
  const racerIdsKey = sortedPlayers.map((p) => p.racerId ?? "").join(",");
  const raceDate = parseRaceId(raceId)?.date ?? null;
  useEffect(() => {
    const ids = racerIdsKey.split(",").filter(Boolean).map(Number);
    if (ids.length === 0 || !raceDate) return undefined;
    let cancelled = false;
    supabaseDataService
      .getRacerPeriodStats(ids, raceDate)
      .then((data) => {
        if (!cancelled) setPeriodStats(data);
      })
      .catch((err) => {
        // 権限エラー（095未適用）はサービス層が {state:"forbidden"} で返すので
        // ここには来ない。ここに来るのはネットワーク断・タイムアウト等で、
        // 「データが無い」と区別して扱う（.claude/rules/frontend-data-fetch.md §3）
        console.error("前期成績取得エラー:", err?.message ?? String(err));
        if (!cancelled) {
          setPeriodStats(null);
          setPeriodFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [racerIdsKey, raceDate, periodRetryToken]);

  useEffect(() => {
    if (expandedView !== "meet" || !raceId || venueCode === null)
      return undefined;
    let cancelled = false;
    supabaseDataService
      .getMeetScoreboard(raceId, venueCode)
      .then((data) => {
        if (!cancelled) setMeetBoard(data);
      })
      .catch((err) => {
        // 節内順位は補助情報。取れなければ得点率だけを出す（カードは消さない）
        console.error("今節の順位取得エラー:", err?.message ?? String(err));
        if (!cancelled) setMeetBoard(null);
      });
    return () => {
      cancelled = true;
    };
  }, [expandedView, raceId, venueCode]);

  const ensureScopedStats = useCallback((racerId) => {
    if (!racerId) return;
    setScopedStatsByRacer((prev) => {
      if (prev[racerId]) return prev;
      supabaseDataService
        .getRacerScopedRaceStats(racerId)
        .then((data) => {
          setScopedStatsByRacer((cur) => ({ ...cur, [racerId]: data }));
        })
        .catch((err) => {
          // withCache()はfetcher()の例外をそのまま伝播するため、ここで
          // catchしないとscopedStatsByRacer[racerId]がundefinedのまま
          // 永久に残り、「直近5走」が「読み込み中...」表示のまま固まって
          // しまう（レビュー指摘#2の調査で発見した潜在バグ）。取得失敗時は
          // 空配列にフォールバックし、「出走履歴データがありません」表示に
          // 倒す（例外を握りつぶさずログには残す）
          console.error("選手出走履歴取得エラー:", err?.message ?? String(err));
          setScopedStatsByRacer((cur) => ({ ...cur, [racerId]: [] }));
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
            {/* 日本語は「当地一般戦」と続けて書くが、英語・韓国語は語間に
                スペースが要るため区切りをロケール側に持たせる */}
            {t("basicInfo.presetLabel", {
              scope: t(`basicInfo.scopes.${preset.scope}`),
              grade: t(`basicInfo.grades.${preset.grade}`),
            })}
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
                {/* 名前とFバッジでgridの1列。バッジを直の子にすると
                    grid-template-columns（5列）がずれ、バーの上に重なる */}
                <span className="rbit-name-cell">
                  <span className="rbit-name" translate="no">
                    {player?.name}
                  </span>
                  {/* 出走表の今期F数（T5-3）。ST考察カードのバッジと同じ出所
                      （race_entries.f_count）にしてある。この行は <button> なので
                      TermHintButton（入れ子の <button> になる）は置けず、
                      説明は title 属性で出す */}
                  <FlyingBadge count={officialRowFor(boat)?.f_count} />
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
                    <button
                      type="button"
                      className={`rbit-expanded-tab${expandedView === "conditions" ? " is-active" : ""}`}
                      onClick={() => setExpandedView("conditions")}
                    >
                      {t("basicInfo.viewConditions")}
                    </button>
                    <button
                      type="button"
                      className={`rbit-expanded-tab${expandedView === "meet" ? " is-active" : ""}`}
                      onClick={() => setExpandedView("meet")}
                    >
                      {t("basicInfo.viewMeet")}
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
                      const recent = getRecentRaces(records, RECENT_RACES_COUNT);
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
                          <RaceHistoryTable
                            rows={recent}
                            buildRaceHref={(raceId) =>
                              localize(`/race/${raceId}`)
                            }
                          />
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

                  {expandedView === "meet" &&
                    (() => {
                      const records = scopedStatsByRacer[player?.racerId];
                      if (records === undefined || records === null) {
                        return (
                          <p className="rbit-expanded-loading">
                            {t("basicInfo.loading")}
                          </p>
                        );
                      }
                      // 節の切り出しは meetGrouping に委ねる（直前情報タブの
                      // 今節展示情報と同じ判定）。追加クエリは0本
                      const meet = buildMeetResults(records, {
                        raceId,
                        venueCode,
                      });
                      if (meet.length === 0) {
                        return (
                          <p className="rbit-expanded-empty">
                            {t("basicInfo.meetEmpty")}
                          </p>
                        );
                      }
                      // 生データだけでは「で、今日はどうなのか」が読めない。
                      // ST考察（FR-1）と同じ発想で、その選手自身の通常値との
                      // 差を先に出す（2026-09-26ユーザー合意のPhase A）
                      const trend = buildMeetTrend(meet, records);
                      // 今節の得点率（FR-3 Phase B）。公式はSG/G1の4日目以降しか
                      // 出さないので当社で計算する。計算式は公式の得点率一覧と
                      // 全選手（若松G1・49名）で照合して一致を確認済み
                      const score = computeSeriesScore(meet);
                      const st = trend.st;
                      const ex = trend.exhibition;
                      const stVerdict =
                        st.diff === null
                          ? null
                          : st.diff <= -MEET_ST_DIFF_THRESHOLD
                            ? t("basicInfo.meetTrendStPush", {
                                diff: Math.abs(st.diff).toFixed(2),
                              })
                            : st.diff >= MEET_ST_DIFF_THRESHOLD
                              ? t("basicInfo.meetTrendStCareful", {
                                  diff: st.diff.toFixed(2),
                                })
                              : t("basicInfo.meetTrendStFlat");
                      const exVerdict =
                        ex.diff === null
                          ? null
                          : ex.diff <= -MEET_EXHIBITION_DIFF_THRESHOLD
                            ? t("basicInfo.meetTrendExhibitionUp", {
                                diff: Math.abs(ex.diff),
                              })
                            : ex.diff >= MEET_EXHIBITION_DIFF_THRESHOLD
                              ? t("basicInfo.meetTrendExhibitionDown", {
                                  diff: ex.diff,
                                })
                              : t("basicInfo.meetTrendExhibitionFlat");
                      return (
                        <div className="rbit-meet">
                          {score.rate !== null && (
                            <div className="rbit-meet-score">
                              <p className="rbit-meet-score-main">
                                {/* 節の序盤は1走の着順で大きく動く。条件別タブの
                                    小標本⚠と基準を揃える（あちらは n<6、
                                    こちらは節が6走前後なので n<3） */}
                                {score.runs < MEET_SMALL_SAMPLE_RUNS && (
                                  <span
                                    className="rbit-conditions-warn"
                                    title={t("basicInfo.smallSampleTitle")}
                                  >
                                    ⚠
                                  </span>
                                )}
                                {t("basicInfo.meetScore", {
                                  rate: score.rate.toFixed(2),
                                  n: score.runs,
                                })}
                                {/* 得点率は単独では読めない。節の中での位置と
                                    準優の枠までの距離を添えて初めて判断材料になる */}
                                {(() => {
                                  const ranking = buildMeetRanking(meetBoard);
                                  const me = ranking.find(
                                    (r) => r.racerId === player?.racerId,
                                  );
                                  if (!me) return null;
                                  const slots =
                                    meetBoard?.semifinalSlots ??
                                    SEMIFINAL_DEFAULT_SLOTS;
                                  const border = ranking[slots - 1]?.rate;
                                  return (
                                    <>
                                      <span className="rbit-meet-rank">
                                        {t("basicInfo.meetRank", {
                                          rank: me.rank,
                                          total: ranking.length,
                                        })}
                                      </span>
                                      {border !== undefined && (
                                        <span className="rbit-meet-border">
                                          {me.rank <= slots
                                            ? t("basicInfo.meetBorderIn", {
                                                slots,
                                              })
                                            : t("basicInfo.meetBorder", {
                                                slots,
                                                rate: border.toFixed(2),
                                                diff: (
                                                  border - me.rate
                                                ).toFixed(2),
                                              })}
                                        </span>
                                      )}
                                    </>
                                  );
                                })()}
                              </p>
                              {/* 「今日この着順なら得点率はこうなる」。勝負駆けの
                                  判断材料そのもので、公式もレースごとに
                                  「得点率早見表」として出している */}
                              <p className="rbit-meet-score-forecast">
                                {meetBoard?.currentStage &&
                                (meetBoard.currentStage.includes("準優") ||
                                  meetBoard.currentStage.includes("優勝戦"))
                                  ? t("basicInfo.meetScoreNoForecast", {
                                      stage: meetBoard.currentStage,
                                    })
                                  : t("basicInfo.meetScoreForecast", {
                                  list: forecastSeriesScore(score)
                                    .map((f) =>
                                      t("basicInfo.meetScoreForecastItem", {
                                        rank: f.rank,
                                        rate: f.rate.toFixed(2),
                                      }),
                                    )
                                      .join(" / "),
                                    })}
                              </p>
                            </div>
                          )}
                          {(stVerdict || exVerdict) && (
                            <div className="rbit-meet-trend">
                              {stVerdict && (
                                <p className="rbit-meet-trend-line">
                                  <span>
                                    {t("basicInfo.meetTrendSt", {
                                      meet: st.meetAvg.toFixed(2),
                                      n: st.meetN,
                                      base:
                                        st.baseAvg === null
                                          ? "—"
                                          : st.baseAvg.toFixed(2),
                                    })}
                                  </span>
                                  <span
                                    className={`rbit-meet-verdict${
                                      st.diff !== null &&
                                      Math.abs(st.diff) >=
                                        MEET_ST_DIFF_THRESHOLD
                                        ? " is-changed"
                                        : ""
                                    }`}
                                  >
                                    {stVerdict}
                                  </span>
                                </p>
                              )}
                              {exVerdict && (
                                <p className="rbit-meet-trend-line">
                                  <span>
                                    {t("basicInfo.meetTrendExhibition", {
                                      first: ex.first,
                                      last: ex.last,
                                      firstTime:
                                        ex.firstTime === null
                                          ? "—"
                                          : ex.firstTime.toFixed(2),
                                      lastTime:
                                        ex.lastTime === null
                                          ? "—"
                                          : ex.lastTime.toFixed(2),
                                      n: ex.n,
                                    })}
                                  </span>
                                  <span
                                    className={`rbit-meet-verdict${
                                      ex.diff !== null &&
                                      Math.abs(ex.diff) >=
                                        MEET_EXHIBITION_DIFF_THRESHOLD
                                        ? " is-changed"
                                        : ""
                                    }`}
                                  >
                                    {exVerdict}
                                  </span>
                                </p>
                              )}
                            </div>
                          )}
                          <p className="rbit-trend-note">
                            {t("basicInfo.meetNote")}
                          </p>
                          {/* 「直近10走」と同じ表にする（2026-09-26
                              ユーザーフィードバック）。今節は進入コースが要るので
                              `showEntryCourse` で列を1つ足す */}
                          <RaceHistoryTable
                            rows={getRecentRaces(meet, meet.length)}
                            showEntryCourse
                            // 同じ節の走しか並ばないので会場・レース名・
                            // グレード・種別は全行同じ値になる。モバイルで
                            // 進入・ST・着順が画面外へ押し出されるため省く
                            omitColumns={[
                              "venue",
                              "raceTitle",
                              "grade",
                              "stage",
                            ]}
                            buildRaceHref={(id) =>
                              localize(`/race/${id}`)
                            }
                          />
                          {/* 得点率が当社計算であることと、配点・対象レースの
                              前提。毎回読む必要は無いので畳んでおく */}
                          {score.rate !== null && (
                            <details className="rbit-conditions-how">
                              <summary>
                                {t("basicInfo.conditionsHowToRead")}
                              </summary>
                              <p className="rbit-conditions-caveat">
                                {t("basicInfo.meetScoreNote")}
                              </p>
                            </details>
                          )}
                        </div>
                      );
                    })()}

                  {expandedView === "conditions" &&
                    (() => {
                      const records = scopedStatsByRacer[player?.racerId];
                      if (records === undefined || records === null) {
                        return (
                          <p className="rbit-expanded-loading">
                            {t("basicInfo.loading")}
                          </p>
                        );
                      }
                      if (records.length === 0) {
                        return (
                          <p className="rbit-expanded-empty">
                            {t("basicInfo.noHistory")}
                          </p>
                        );
                      }
                      const condRows = buildConditionRows(records, {
                        venueCode,
                        metric,
                      })
                        .filter((r) => !r.unavailable)
                        // n=0 の行は畳む（BOA-432）。B級中心の選手では
                        // 「SG・G1 — (n=0)」が毎回並ぶだけで読む値が無い
                        // （ナイターの行を出さないのと同じ理屈）。
                        // ただし **F持ち/Fなしは対で意味を持つ**（同じ「F数が
                        // 取れている走」を分け合う設計）ので、片方だけ消さず
                        // 両方0のときだけ両方畳む
                        .filter((r, _i, rows) => {
                          if (r.key === "fHolding" || r.key === "fClean") {
                            return rows.some(
                              (x) =>
                                (x.key === "fHolding" || x.key === "fClean") &&
                                x.n > 0,
                            );
                          }
                          return r.n > 0;
                        });
                      const period = pickPeriodStats(
                        periodStats,
                        player?.racerId,
                      );
                      return (
                        <div className="rbit-conditions">
                          {/* 値は全行とも自社集計。既定状態（勝率・全レース・今期）では
                              上のバーが公式値を出すため、同じ「全国」でも数字が違う */}
                          <p className="rbit-conditions-note">
                            {t("basicInfo.conditionsNote", {
                              metric: t(`basicInfo.metrics.${metric}`),
                            })}
                          </p>
                          <table className="rbit-conditions-table">
                            <tbody>
                              {condRows.map((row) => {
                                const small =
                                  row.n > 0 && row.n < SMALL_SAMPLE_THRESHOLD;
                                return (
                                  <tr key={row.key}>
                                    <th scope="row">
                                      {t(`basicInfo.conditions.${row.key}`)}
                                    </th>
                                    <td
                                      className={`rbit-conditions-value${small ? " is-small-sample" : ""}`}
                                    >
                                      {row.value === null
                                        ? "—"
                                        : formatMetricValue(metric, row.value)}
                                    </td>
                                    <td
                                      className={`rbit-conditions-n${small ? " is-small-sample" : ""}`}
                                    >
                                      {small && (
                                        <span
                                          className="rbit-conditions-warn"
                                          title={t(
                                            "basicInfo.smallSampleTitle",
                                          )}
                                        >
                                          ⚠
                                        </span>
                                      )}
                                      {t("basicInfo.sampleCount", { n: row.n })}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                          {/* A: この表は全コース込み。今日の枠と母集団が違う。
                              実例（2026-09-25 桐生1R）: 4号艇の選手は過去2年183走中
                              5・6枠が178走で全国1着率0.5%、6号艇の選手は枠がほぼ均等で
                              13.9%。素直に読むと今日の枠と逆方向に評価してしまう */}
                          <p className="rbit-conditions-caveat">
                            {t("basicInfo.conditionsCourseCaveat", {
                              boat,
                              n: records.filter((r) => r.boatNumber === boat)
                                .length,
                            })}
                          </p>
                          {/* C: Fを持った選手の見どころはスタートの踏み方なので、
                              指標が勝率等でも平均STを併記する。勝率だけだと
                              「F持ち時27.3% vs F無し時11.1%」のように
                              「Fを持っている方が走る」と読めてしまう */}
                          {metric !== "avgSt" &&
                            (() => {
                              const holding = condRows.find(
                                (r) => r.key === "fHolding",
                              );
                              const clean = condRows.find(
                                (r) => r.key === "fClean",
                              );
                              if (!holding?.avgStN && !clean?.avgStN)
                                return null;
                              const fmt = (row) =>
                                row?.avgSt === null || row?.avgSt === undefined
                                  ? "—"
                                  : row.avgSt.toFixed(2);
                              return (
                                <p className="rbit-conditions-caveat">
                                  {t("basicInfo.conditionsFStNote", {
                                    holding: fmt(holding),
                                    holdingN: holding?.avgStN ?? 0,
                                    clean: fmt(clean),
                                    cleanN: clean?.avgStN ?? 0,
                                  })}
                                </p>
                              );
                            })()}
                          {/* D: 外枠中心の選手は勝率だと全行0.0%に潰れて情報がゼロになる。
                              実例（同レース4号艇）: 勝率は全行0.0%だが、3連対率にすると
                              全国41.5%・最終日50.0%・波5cm以上50.0%と差が出る。
                              ただし3連対率も全部0の選手（1着も3着も無い新人）はいるので、
                              **切り替えて実際に差が出る場合だけ**誘導する */}
                          {metric !== "top3Rate" &&
                            metric !== "avgSt" &&
                            condRows.some((r) => r.n > 0) &&
                            // 厳密に0で判定すると「全国0.5%・一般戦0.6%」のような
                            // 実質潰れている選手を拾えない。1%未満＝100走に1回未満で
                            // 行間の差が読めない状態とみなす
                            condRows.every(
                              (r) => r.value === null || r.value < 1,
                            ) &&
                            buildConditionRows(records, {
                              venueCode,
                              metric: "top3Rate",
                            }).some((r) => r.value !== null && r.value >= 1) && (
                              <p className="rbit-conditions-zero">
                                {t("basicInfo.conditionsAllZeroHint")}
                                <button
                                  type="button"
                                  className="rbit-conditions-zero-action"
                                  onClick={() => setMetric("top3Rate")}
                                >
                                  {t("basicInfo.conditionsAllZeroAction")}
                                </button>
                              </p>
                            )}
                          {/* 注記を4本並べるとグレーの壁になって誰も読まないので、
                              毎回は要らない2本（最終日の構造差・母数が違う行）は
                              折りたたむ。常時出すのはコース混在の1本とFのSTだけ */}
                          <details className="rbit-conditions-how">
                            <summary>
                              {t("basicInfo.conditionsHowToRead")}
                            </summary>
                            {/* B: 最終日は優勝戦を含み、勝ち上がった選手が1号艇に入る。
                                全36,221レースの実測で1号艇1着率は初日52.1%・中日54.0%・
                                最終日60.1%と構造的に差がある（選手の力ではなく枠の差） */}
                            {condRows.some((r) => r.key === "finalDay") && (
                              <p className="rbit-conditions-caveat">
                                {t("basicInfo.conditionsFinalDayCaveat")}
                              </p>
                            )}
                            {/* 母数が他行と違う行（波・F持ち時・F無し時）は、
                                条件を判定できた走数を添えて「他行と比べない」と読ませる */}
                            {condRows.some((r) => r.baseN !== null) && (
                              <p className="rbit-conditions-caveat">
                                {t("basicInfo.conditionsBaseNote", {
                                  rows: condRows
                                    .filter((r) => r.baseN !== null)
                                    .map((r) =>
                                      t("basicInfo.conditionsBaseNoteRow", {
                                        label: t(
                                          `basicInfo.conditions.${r.key}`,
                                        ),
                                        n: r.baseN,
                                      }),
                                    )
                                    .join(
                                      t(
                                        "basicInfo.conditionsBaseNoteSeparator",
                                      ),
                                    ),
                                })}
                              </p>
                            )}
                          </details>
                          {/* 取得失敗を「前期のデータが無い」に化けさせない。
                              095未適用（forbidden）のときは枠ごと出さないのが
                              正しいので、ここでは出さない */}
                          {periodFailed && (
                            <InlineFetchError
                              message={t("basicInfo.periodFetchError")}
                              onRetry={() => {
                                setPeriodFailed(false);
                                setPeriodStats(undefined);
                                setPeriodRetryToken((v) => v + 1);
                              }}
                            />
                          )}
                          {/* 「前期」は公式の期別成績で、単位が点。自社集計の
                              1着率%と同じ列に混ぜられないため別枠にする */}
                          {period && (
                            <div className="rbit-period">
                              <div className="rbit-period-heading">
                                {t("basicInfo.periodTitle", {
                                  from: period.calcFrom,
                                  to: period.calcTo,
                                })}
                              </div>
                              <div className="rbit-period-values">
                                <span>
                                  {t("basicInfo.periodWinRate", {
                                    value:
                                      period.winRate === null
                                        ? "—"
                                        : period.winRate.toFixed(2),
                                  })}
                                </span>
                                <span>
                                  {/* 単位は値側に付ける。i18n側に「%」を残すと
                                      出走0の新人（top2_rateがNULL）で
                                      「2連対率 —%」になる */}
                                  {t("basicInfo.periodTop2Rate", {
                                    value:
                                      period.top2Rate === null
                                        ? "—"
                                        : `${period.top2Rate.toFixed(1)}%`,
                                  })}
                                </span>
                                <span>
                                  {t("basicInfo.periodAvgSt", {
                                    value:
                                      period.avgSt === null
                                        ? "—"
                                        : period.avgSt.toFixed(2),
                                  })}
                                </span>
                              </div>
                            </div>
                          )}
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
