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
 * - コース別成績: getRaceRacerStatsが返すracerStats
 *   （predictions.feature_contributions.racerStats、DataRaceTableの
 *   「枠番勝率」行・AttackDefenseTableと同じ出所）のcourseRaceCounts
 *   （racer_aggregated_stats由来、全国合算・全期間、艇番＝コース前提。
 *   実際の進入コース変化はBOA-257の制約により区別できない）
 * - コースドリルダウン直近10走: supabaseDataService.getRacerCourseRecentFinishes
 *   （本チケットで新規追加）。courseRaceCountsと母集団の定義を揃えるため、
 *   実進入コース（actual_course_N）ではなくrace_entries.boat_numberで判定する
 * - 決まり手傾向（全艇）: getWinningTechniqueStatsのデータ
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
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { BOAT_COLORS } from "../../utils/colors";
import { supabaseDataService } from "../../services/supabaseDataService";
import { translateTechnique } from "./raceIndicators";
import { SMALL_SAMPLE_THRESHOLD } from "./basicInfoStats";
import {
  GRID_COURSES,
  GRID_ROWS,
  buildCourseGrid,
  getCourseRecentRuns,
} from "./courseGridStats";
import { finishPositionOf } from "./basicInfoStats";
import "./RaceWakuInfoTab.css";

const METRICS = ["winRate", "top2Rate", "top3Rate"];

function rankDotClass(rank) {
  // 着外（欠場・失格・転覆等でrank1〜6のどこにも入らない）は最下位扱い
  if (rank === null) return "rwit-dot-bad";
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

// raceId は受け取らない: コース別成績を racer_aggregated_stats（レース単位の
// getRaceRacerStats）から getRacerScopedRaceStats（選手単位）に切り替えたため不要になった
function RaceWakuInfoTab({ venueCode, players }) {
  const { t } = useTranslation();
  // このタブで使うのはracerStatsと決まり手統計の2種類だけのため、8+4クエリを
  // まとめて発火するuseRaceAnalysisData/useVenueTendencyStatsは使わず個別に取得する
  // （withCacheで他タブ・他コンポーネントの取得と重複しない）。
  // undefined=取得中、null=取得失敗/データなし
  // 選択中の選手の出走履歴（実進入コース付き）。undefined=取得中、null=取得失敗
  const [scopedByRacer, setScopedByRacer] = useState({});
  const [techniqueStats, setTechniqueStats] = useState(undefined);

  useEffect(() => {
    let cancelled = false;
    supabaseDataService
      .getWinningTechniqueStats(venueCode)
      .then((data) => {
        if (!cancelled) setTechniqueStats(data ?? null);
      })
      .catch((err) => {
        console.error("枠別情報（決まり手）取得エラー:", err?.message);
        if (!cancelled) setTechniqueStats(null);
      });
    return () => {
      cancelled = true;
    };
  }, [venueCode]);

  const sortedPlayers = [...(players ?? [])].sort(
    (a, b) => a.number - b.number,
  );

  const [selectedBoat, setSelectedBoat] = useState(
    () => sortedPlayers[0]?.number ?? null,
  );
  const [metric, setMetric] = useState("winRate");
  // グリッドのどのセルを開いているか（行キー × コース）
  const [openCell, setOpenCell] = useState(null);

  const selectedPlayer =
    sortedPlayers.find((p) => p.number === selectedBoat) ?? sortedPlayers[0];
  const selectedRacerId = selectedPlayer?.racerId ?? null;

  // 選手を選ぶたびに、その選手の出走履歴を取得する（withCacheで基本情報タブ・
  // 直前情報タブと共有されるため、同じ選手なら再フェッチは起きない）
  useEffect(() => {
    if (!selectedRacerId) return undefined;
    let cancelled = false;
    // 未取得の間はキー自体が無い（= undefined）ので、ここで明示的に
    // undefined を入れる必要はない（effect内の同期setStateを避ける）
    supabaseDataService
      .getRacerScopedRaceStats(selectedRacerId)
      .then((data) => {
        if (!cancelled)
          setScopedByRacer((prev) => ({ ...prev, [selectedRacerId]: data }));
      })
      .catch((err) => {
        // 取得失敗を「データなし」に化けさせない（BOA-359）
        console.error(
          "枠別情報（選手の出走履歴）取得エラー:",
          err?.message ?? String(err),
        );
        if (!cancelled)
          setScopedByRacer((prev) => ({ ...prev, [selectedRacerId]: null }));
      });
    return () => {
      cancelled = true;
    };
  }, [selectedRacerId]);

  if (sortedPlayers.length === 0) return null;

  const scopedRecords = selectedRacerId
    ? scopedByRacer[selectedRacerId]
    : null;
  const grid = Array.isArray(scopedRecords)
    ? buildCourseGrid(scopedRecords, { venueCode, metric })
    : [];
  const recentRuns =
    openCell && Array.isArray(scopedRecords)
      ? getCourseRecentRuns(scopedRecords, {
          venueCode,
          rowKey: openCell.rowKey,
          course: openCell.course,
        })
      : [];

  const selectBoat = (boatNumber) => {
    setSelectedBoat(boatNumber);
    setOpenCell(null);
  };

  const toggleCell = (rowKey, course) => {
    setOpenCell((prev) =>
      prev && prev.rowKey === rowKey && prev.course === course
        ? null
        : { rowKey, course },
    );
  };

  const techniqueDistribution = aggregateTechniqueDistribution(
    techniqueStats?.data,
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
  <h3 className="rwit-card-title">{t("wakuInfo.gridTitle")}</h3>
  <p className="rwit-card-sub">{t("wakuInfo.gridSubtitle")}</p>

  {scopedRecords === undefined ? (
    <p className="rwit-loading">{t("wakuInfo.loading")}</p>
  ) : scopedRecords === null ? (
    <p className="rwit-empty">{t("wakuInfo.fetchError")}</p>
  ) : scopedRecords.length === 0 ? (
    <p className="rwit-empty">{t("wakuInfo.noData")}</p>
  ) : (
    <>
      {/* 横スクロールはこのラッパの中だけに閉じる（ページ全体は横スクロールさせない） */}
      <div className="rwit-grid-wrapper">
        <table className="rwit-grid">
          <thead>
            <tr>
              <th className="rwit-grid-label-th" scope="col"></th>
              {GRID_COURSES.map((course) => {
                const color = BOAT_COLORS[course] || {};
                return (
                  <th
                    key={course}
                    className="rwit-grid-course-th"
                    scope="col"
                    style={{ background: color.bg, color: color.text }}
                  >
                    {course}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {grid.map((row) => (
              <tr key={row.key}>
                <th className="rwit-grid-label-th" scope="row">
                  {t(`wakuInfo.gridRows.${row.key}`)}
                </th>
                {row.cells.map((cell) => {
                  const isSmallSample =
                    cell.n > 0 && cell.n < SMALL_SAMPLE_THRESHOLD;
                  const open =
                    openCell?.rowKey === row.key &&
                    openCell?.course === cell.course;
                  const isOwnCourse = cell.course === selectedPlayer.number;
                  if (cell.n === 0) {
                    return (
                      <td key={cell.course} className="rwit-grid-cell">
                        <span className="rwit-grid-empty">—</span>
                      </td>
                    );
                  }
                  return (
                    <td
                      key={cell.course}
                      className={`rwit-grid-cell${open ? " is-open" : ""}${isOwnCourse ? " is-own-course" : ""}`}
                    >
                      <button
                        type="button"
                        className="rwit-grid-cell-button"
                        onClick={() => toggleCell(row.key, cell.course)}
                        aria-expanded={open}
                      >
                        <span
                          className={`rwit-grid-value${isSmallSample ? " is-small-sample" : ""}`}
                        >
                          {isSmallSample && (
                            <span
                              className="rwit-grid-warn"
                              title={t("wakuInfo.smallSampleTitle")}
                            >
                              ⚠
                            </span>
                          )}
                          {cell.value.toFixed(1)}
                        </span>
                        <span
                          className={`rwit-grid-n${isSmallSample ? " is-small-sample" : ""}`}
                        >
                          {t("wakuInfo.sampleCount", { n: cell.n })}
                        </span>
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {openCell && (
        <div className="rwit-expanded">
          <p className="rwit-expanded-note">
            {t("wakuInfo.recentFinishesNote", { course: openCell.course })}
          </p>
          {recentRuns.length === 0 ? (
            <p className="rwit-expanded-empty">
              {t("wakuInfo.noRecentFinishes")}
            </p>
          ) : (
            <div className="rwit-streak">
              {recentRuns.map((r) => {
                const rank = finishPositionOf(r);
                return (
                  <span
                    key={r.raceId}
                    className={`rwit-streak-dot ${rankDotClass(rank)}`}
                    title={r.raceId}
                  >
                    {rank ?? t("wakuInfo.outOfPlace")}
                  </span>
                );
              })}
            </div>
          )}
        </div>
      )}
    </>
  )}
  <p className="rwit-caveat">{t("wakuInfo.gridCaveat")}</p>
</div>;

      <div className="rwit-card">
        <h3 className="rwit-card-title">{t("wakuInfo.kimariteTitle")}</h3>
        {techniqueDistribution.length === 0 ? (
          <p className="rwit-empty">
            {techniqueStats === undefined
              ? t("wakuInfo.loading")
              : t("wakuInfo.noData")}
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
