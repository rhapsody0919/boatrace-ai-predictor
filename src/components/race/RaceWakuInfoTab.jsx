/**
 * RaceWakuInfoTab - レース詳細ページ「枠別情報」タブ（BOA-307）
 * 承認済みモック（Artifact v4、docs/proposal/competitor-kyoteibiyori/
 * race-detail-page-tab-comparison-2026-09-15.md参照）に基づく実装。
 * 選手（艇番）を選び、その選手のコース別（1〜6）成績を棒グラフで見せ、
 * コースをタップするとそのコースで出走した直近10走の着順にドリルダウンできる。
 * 別カードで会場全体の決まり手傾向（全艇合算）を見せる。
 *
 * 役割分担（チケット項目1、同じ会場×枠番データの二重実装を避ける）:
 * - VenueTendencyPanel（会場×枠番の決まり手/トップスタート率/負け決まり手/
 *   展示最速転換率、今節6艇分を横並び）とは主語が異なる。VenueTendencyPanelは
 *   「この会場・この枠番」の傾向を6艇並べて一覧するのに対し、本タブは
 *   「選んだ1選手」がコース別にどんな成績かを掘り下げるドリルダウン型。
 *   このタブがアクティブな間はPredictionPanel側でVenueTendencyPanel・
 *   DataRaceTable・EmbeddedAnalysisSection群を非表示にし二重表示を避ける
 *   （showPreRaceAnalysisTools、他のタブと同じ扱い）
 * - AttackDefenseAnalysis（艇別の攻め手/守り手分布）とも別軸。決まり手傾向
 *   カードは「会場全体でどの決まり手がどのくらいの頻度で発生するか」という
 *   全艇合算の単純集計で、艇別の攻守分布を見せるAttackDefenseAnalysisとは
 *   異なる粒度・目的の情報
 *
 * データソース:
 * - コース別成績: useRaceAnalysisDataが返すracerStats
 *   （predictions.feature_contributions.racerStats、DataRaceTableの
 *   「枠番勝率」行・AttackDefenseTableと同じ出所）のcourseRaceCounts
 *   （racer_aggregated_stats由来、全国合算・全期間、艇番＝コース前提。
 *   実際の進入コース変化はBOA-257の制約により区別できない）
 * - コースドリルダウン直近10走: supabaseDataService.getRacerCourseRecentFinishes
 *   （本チケットで新規追加）。courseRaceCountsと母集団の定義を揃えるため、
 *   実進入コース（actual_course_N）ではなくrace_entries.boat_numberで判定する
 * - 決まり手傾向（全艇）: useVenueTendencyStatsのtechniqueデータ
 *   （winning_technique_stats、直近90日）を6艇合算して技法別シェアに変換する。
 *   VenueTendencyPanelは艇別の最頻値1件のみ表示するが、本カードは
 *   技法5種類の全体シェアを見せる別の切り口
 *
 * 調査結果（チケット項目3、対象外）: 「逃げシミュレーション」「ST考察
 * （安定率/抜出率/出遅率）」に相当する集計・カラムは自社DBに存在しない
 * （grep調査済み、2026-09-16）。無理にダミーで埋めず対象外とする
 *
 * 調査結果（チケット項目4）: モーター情報タブのMotorWakuStatsGrid（BOA-283/301）は
 * テーブル形式で、承認済みモックのバーチャート＋インライン展開とは見た目が
 * 合わないため直接流用はしない。UIパターンとしては基本情報タブ
 * （RaceBasicInfoTab）のバー＋タップ展開パターンを踏襲する
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { BOAT_COLORS } from "../../utils/colors";
import { supabaseDataService } from "../../services/supabaseDataService";
import { useRaceAnalysisData } from "../../hooks/useRaceAnalysisData";
import { useVenueTendencyStats } from "../../hooks/useVenueTendencyStats";
import { translateTechnique } from "./raceIndicators";
import { SMALL_SAMPLE_THRESHOLD } from "./basicInfoStats";
import "./RaceWakuInfoTab.css";

const METRICS = ["winRate", "top2Rate", "top3Rate"];
const COURSES = [1, 2, 3, 4, 5, 6];

function courseValue(courseRaceCounts, course, metric) {
  const counts = courseRaceCounts?.[String(course)];
  if (!counts || !counts.total) return { value: null, n: 0 };
  const numerator =
    metric === "winRate"
      ? counts.wins
      : metric === "top2Rate"
        ? counts.top2
        : counts.top3;
  return {
    value:
      numerator === null || numerator === undefined
        ? null
        : (numerator / counts.total) * 100,
    n: counts.total,
  };
}

function rankDotClass(rank) {
  if (rank <= 2) return "rwit-dot-good";
  if (rank <= 4) return "rwit-dot-mid";
  return "rwit-dot-bad";
}

// 会場全体の決まり手傾向（全艇合算）。venueTendency.technique.dataは
// { [boatNumber]: { total_races, techniques: [{technique, count, percentage}] } }
// という艇別データのため、技法名で集約して全体シェアに変換する
function aggregateTechniqueDistribution(techniqueByBoat) {
  const totals = new Map();
  let grandTotal = 0;
  Object.values(techniqueByBoat ?? {}).forEach((entry) => {
    (entry?.techniques ?? []).forEach(({ technique, count }) => {
      if (!technique || !count) return;
      totals.set(technique, (totals.get(technique) ?? 0) + count);
      grandTotal += count;
    });
  });
  return [...totals.entries()]
    .map(([technique, count]) => ({
      technique,
      count,
      percentage: grandTotal > 0 ? (count / grandTotal) * 100 : 0,
    }))
    .sort((a, b) => b.count - a.count);
}

function RaceWakuInfoTab({ raceId, venueCode, players }) {
  const { t } = useTranslation();
  const analysis = useRaceAnalysisData(raceId, { venueCode });
  const venueStats = useVenueTendencyStats(venueCode);

  const sortedPlayers = [...(players ?? [])].sort(
    (a, b) => a.number - b.number,
  );

  const [selectedBoat, setSelectedBoat] = useState(
    () => sortedPlayers[0]?.number ?? null,
  );
  const [metric, setMetric] = useState("winRate");
  const [openCourse, setOpenCourse] = useState(null);
  const [finishesByKey, setFinishesByKey] = useState({});

  if (sortedPlayers.length === 0) return null;

  const selectedPlayer =
    sortedPlayers.find((p) => p.number === selectedBoat) ?? sortedPlayers[0];
  const statsByBoat = new Map(
    (analysis.racerStats ?? []).map((s) => [s.boatNumber, s]),
  );
  const selectedStats = statsByBoat.get(selectedPlayer.number);
  const selectedColor = BOAT_COLORS[selectedPlayer.number] || {};

  const selectBoat = (boatNumber) => {
    setSelectedBoat(boatNumber);
    setOpenCourse(null);
  };

  const toggleCourse = (course) => {
    if (openCourse === course) {
      setOpenCourse(null);
      return;
    }
    setOpenCourse(course);
    const racerId = selectedPlayer.racerId;
    const key = `${racerId}-${course}`;
    if (racerId && finishesByKey[key] === undefined) {
      setFinishesByKey((prev) => ({ ...prev, [key]: null }));
      supabaseDataService
        .getRacerCourseRecentFinishes(racerId, course)
        .then((data) => {
          setFinishesByKey((prev) => ({ ...prev, [key]: data }));
        })
        .catch((err) => {
          console.error(
            "枠別情報（直近10走）取得エラー:",
            err?.message ?? String(err),
          );
          setFinishesByKey((prev) => ({ ...prev, [key]: "error" }));
        });
    }
  };

  const techniqueDistribution = aggregateTechniqueDistribution(
    venueStats.technique?.data,
  );

  return (
    <div className="race-waku-info-tab">
      <p className="rwit-note">{t("wakuInfo.note")}</p>

      <div
        className="rwit-chip-row"
        role="group"
        aria-label={t("wakuInfo.boatLabel")}
      >
        {sortedPlayers.map((p) => {
          const color = BOAT_COLORS[p.number] || {};
          const active = selectedPlayer.number === p.number;
          return (
            <button
              key={p.number}
              type="button"
              className={`rwit-boat-chip${active ? " is-active" : ""}`}
              style={
                active ? { background: color.bg, color: color.text } : undefined
              }
              onClick={() => selectBoat(p.number)}
              aria-pressed={active}
            >
              <span className="rwit-boat-chip-num">{p.number}</span>
              <span className="rwit-boat-chip-name" translate="no">
                {p.name?.replace(/\s+/g, "")}
              </span>
            </button>
          );
        })}
      </div>

      <div
        className="rwit-chip-row"
        role="group"
        aria-label={t("wakuInfo.metricLabel")}
      >
        {METRICS.map((m) => (
          <button
            key={m}
            type="button"
            className={`rwit-chip${metric === m ? " is-active" : ""}`}
            onClick={() => setMetric(m)}
          >
            {t(`wakuInfo.metrics.${m}`)}
          </button>
        ))}
      </div>

      <div className="rwit-card">
        <h3 className="rwit-card-title">{t("wakuInfo.courseTitle")}</h3>
        <p className="rwit-card-sub">{t("wakuInfo.courseSubtitle")}</p>

        {analysis.pending.racerStats && !selectedStats ? (
          <p className="rwit-loading">{t("basicInfo.loading")}</p>
        ) : !selectedStats?.courseRaceCounts ? (
          <p className="rwit-empty">{t("wakuInfo.noData")}</p>
        ) : (
          <div className="rwit-bars">
            {COURSES.map((course) => {
              const { value, n } = courseValue(
                selectedStats.courseRaceCounts,
                course,
                metric,
              );
              const isSmallSample = n > 0 && n < SMALL_SAMPLE_THRESHOLD;
              const isOwnCourse = course === selectedPlayer.number;
              const open = openCourse === course;
              const key = `${selectedPlayer.racerId}-${course}`;
              const finishes = finishesByKey[key];

              return (
                <div key={course} className="rwit-bar-block">
                  <button
                    type="button"
                    className="rwit-bar-row"
                    onClick={() => toggleCourse(course)}
                    aria-expanded={open}
                  >
                    <span className="rwit-course-badge">{course}</span>
                    <span className="rwit-bar-track">
                      {value !== null && (
                        <span
                          className={`rwit-bar-fill${isSmallSample ? " is-small-sample" : ""}`}
                          style={{
                            width: `${Math.max(2, Math.min(100, value))}%`,
                            background: selectedColor.bg,
                          }}
                        />
                      )}
                    </span>
                    <span className="rwit-value">
                      {isOwnCourse && (
                        <span className="rwit-own-badge">
                          {t("wakuInfo.todayBadge")}
                        </span>
                      )}
                      {value !== null ? `${value.toFixed(1)}%` : "—"}
                      {n > 0 && (
                        <span
                          className={`rwit-n${isSmallSample ? " is-small-sample" : ""}`}
                        >
                          {t("basicInfo.sampleCount", { n })}
                        </span>
                      )}
                    </span>
                    <span className="rwit-expand-arrow">
                      {open ? "▼" : "▶"}
                    </span>
                  </button>

                  {open && (
                    <div className="rwit-expanded">
                      {!selectedPlayer.racerId ? (
                        <p className="rwit-expanded-empty">
                          {t("wakuInfo.noRacerId")}
                        </p>
                      ) : finishes === undefined || finishes === null ? (
                        <p className="rwit-expanded-loading">
                          {t("basicInfo.loading")}
                        </p>
                      ) : finishes === "error" ? (
                        <p className="rwit-expanded-empty">
                          {t("wakuInfo.fetchError")}
                        </p>
                      ) : finishes.length === 0 ? (
                        <p className="rwit-expanded-empty">
                          {t("wakuInfo.noRecentFinishes")}
                        </p>
                      ) : (
                        <>
                          <p className="rwit-expanded-note">
                            {t("wakuInfo.recentFinishesNote", { course })}
                          </p>
                          <div className="rwit-streak">
                            {[...finishes].reverse().map((f) => (
                              <span
                                key={f.race_id}
                                className={`rwit-streak-dot ${rankDotClass(f.rank)}`}
                                title={f.race_id}
                              >
                                {f.rank}
                              </span>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <p className="rwit-caveat">{t("wakuInfo.courseCaveat")}</p>
      </div>

      <div className="rwit-card">
        <h3 className="rwit-card-title">{t("wakuInfo.kimariteTitle")}</h3>
        {techniqueDistribution.length === 0 ? (
          <p className="rwit-empty">
            {venueStats.loading ? t("basicInfo.loading") : t("wakuInfo.noData")}
          </p>
        ) : (
          <div className="rwit-bars">
            {techniqueDistribution.map(({ technique, percentage }) => (
              <div key={technique} className="rwit-tech-row">
                <span className="rwit-tech-label">
                  {translateTechnique(t, technique)}
                </span>
                <span className="rwit-bar-track">
                  <span
                    className="rwit-bar-fill rwit-bar-fill-neutral"
                    style={{
                      width: `${Math.max(2, Math.min(100, percentage))}%`,
                    }}
                  />
                </span>
                <span className="rwit-value">{percentage.toFixed(1)}%</span>
              </div>
            ))}
          </div>
        )}
        <p className="rwit-caveat">{t("wakuInfo.kimariteCaveat")}</p>
      </div>
    </div>
  );
}

export default RaceWakuInfoTab;
