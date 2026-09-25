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
 * データソース（phase aのT3-1で差し替え済み。旧記述は下の「廃止した出所」参照）:
 * - コース別成績・直近10走: supabaseDataService.getRacerScopedRaceStats
 *   （選手単位の全走。実進入コースは race_results.actual_course_N）。
 *   集計は courseGridStats.js の純関数に閉じ込め、追加クエリは発行しない
 * - ST考察のベースライン: getStCourseBaseline（st_course_baseline、コース×級別24行）
 * - 逃げシミュレーション: getNigeSimulation（nige_second_by_course、会場別）
 * - 決まり手傾向（全艇）: getWinningTechniqueStatsのデータ
 *   （winning_technique_stats、直近90日）を6艇合算して技法別シェアに変換する。
 *   VenueTendencyPanelは艇別の最頻値1件のみ表示するが、本カードは
 *   技法5種類の全体シェアを見せる別の切り口
 *
 * 廃止した出所: racerStats.courseRaceCounts（racer_aggregated_stats由来、
 * 艇番＝コース前提）と、race_entries.boat_number基準で直近走を引いていた
 * supabaseDataServiceのメソッドは、グリッドを実進入コース基準にした時点で
 * 母集団が合わなくなり使わなくなった（後者は呼び出し元消滅のため削除済み）。
 * 同じサイト内で艇番基準と実進入コース基準が混在する点はBOA-302が横断課題
 * として起票済み（courseGridStats.js のモジュールコメント参照）。
 *
 * 調査結果（チケット項目4）: モーター情報タブのMotorWakuStatsGrid（BOA-283/301）は
 * テーブル形式で、承認済みモックのバーチャート＋インライン展開とは見た目が
 * 合わないため直接流用はしない
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
  TODAY_METRICS,
  buildCourseGrid,
  buildTodayCourseRows,
  computeWakuNariRate,
  getCourseRecentRuns,
} from "./courseGridStats";
import RaceStConsiderationCard from "./RaceStConsiderationCard";
import NigeSimulationCard from "./NigeSimulationCard";
import RecentRunsBar from "./RecentRunsBar";
import "./RaceWakuInfoTab.css";

const METRICS = ["winRate", "top2Rate", "top3Rate"];

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
function RaceWakuInfoTab({ venueCode, players, raceId }) {
  const { t } = useTranslation();
  // このタブで使うのはracerStatsと決まり手統計の2種類だけのため、8+4クエリを
  // まとめて発火するuseRaceAnalysisData/useVenueTendencyStatsは使わず個別に取得する
  // （withCacheで他タブ・他コンポーネントの取得と重複しない）。
  // undefined=取得中、null=取得失敗/データなし
  // 選択中の選手の出走履歴（実進入コース付き）。undefined=取得中、null=取得失敗
  const [scopedByRacer, setScopedByRacer] = useState({});
  const [techniqueStats, setTechniqueStats] = useState(undefined);
  // ST考察のベースライン（コース×級別の24行）と逃げシミュレーション（会場別5行）。
  // どちらも094の事前集計テーブルを単純SELECTで読む（画面では集計しない）
  const [baseline, setBaseline] = useState(undefined);
  const [nigeRows, setNigeRows] = useState(undefined);
  // 出走表の今期F数（艇番→f_count）。基本情報タブが既定タブで同じキーを
  // 先に取るため、実質キャッシュヒットで追加クエリは増えない（T5-3）
  const [fCountByBoat, setFCountByBoat] = useState(null);

  useEffect(() => {
    if (!raceId) return undefined;
    let cancelled = false;
    supabaseDataService
      .getRaceEntryOfficialRatesBreakdown(raceId)
      .then((rows) => {
        if (cancelled) return;
        setFCountByBoat(
          new Map(
            (rows ?? [])
              .filter((r) => r.f_count !== null && r.f_count !== undefined)
              .map((r) => [r.boat_number, r.f_count]),
          ),
        );
      })
      .catch((err) => {
        // バッジは補助表示。取れなければ出さない（カードごと消さない）
        console.error("F数取得エラー:", err?.message ?? String(err));
        if (!cancelled) setFCountByBoat(null);
      });
    return () => {
      cancelled = true;
    };
  }, [raceId]);

  useEffect(() => {
    let cancelled = false;
    supabaseDataService
      .getStCourseBaseline()
      .then((data) => {
        if (!cancelled) setBaseline(data);
      })
      .catch((err) => {
        console.error(
          "ST考察ベースライン取得エラー:",
          err?.message ?? String(err),
        );
        if (!cancelled) setBaseline(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!venueCode) return undefined;
    let cancelled = false;
    supabaseDataService
      .getNigeSimulation(venueCode)
      .then((data) => {
        if (!cancelled) setNigeRows(data);
      })
      .catch((err) => {
        console.error(
          "逃げシミュレーション取得エラー:",
          err?.message ?? String(err),
        );
        if (!cancelled) setNigeRows(null);
      });
    return () => {
      cancelled = true;
    };
  }, [venueCode]);

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
  // グリッドのどのセルを開いているか（行キー × コース × どちらの表か）
  const [openCell, setOpenCell] = useState(null);
  // 全コース比較の折りたたみ。native <details> ではなくReactの状態で持つ。
  // <details> は取得待ちの分岐（scopedRecords === undefined）の中にあるため、
  // 履歴が未取得の選手に切り替えるとサブツリーが差し替わって再マウントされ、
  // 開いていた折りたたみが勝手に閉じる（レビュー指摘、2026-09-24）。
  // ST考察カードの openSection と同じ制御方式に揃える
  const [foldOpen, setFoldOpen] = useState(false);

  const selectedPlayer =
    sortedPlayers.find((p) => p.number === selectedBoat) ?? sortedPlayers[0];
  const selectedRacerId = selectedPlayer?.racerId ?? null;

  // 選手を選ぶたびに、その選手の出走履歴を取得する（withCacheで基本情報タブ・
  // 直前情報タブと共有されるため、同じ選手なら再フェッチは起きない）
  // ST考察は6艇分を並べるため、選択中の1人だけでなく全選手の履歴を取得する。
  // withCacheで基本情報タブ・直前情報タブと共有されるため、同じ選手なら再フェッチは起きない
  const racerIdsKey = sortedPlayers.map((p) => p.racerId ?? "").join(",");

  useEffect(() => {
    const ids = racerIdsKey.split(",").filter(Boolean);
    if (ids.length === 0) return undefined;
    let cancelled = false;
    ids.forEach((id) => {
      const racerId = Number(id);
      supabaseDataService
        .getRacerScopedRaceStats(racerId)
        .then((data) => {
          if (!cancelled)
            setScopedByRacer((prev) => ({ ...prev, [racerId]: data }));
        })
        .catch((err) => {
          // 取得失敗を「データなし」に化けさせない（BOA-359）
          console.error(
            "枠別情報（選手の出走履歴）取得エラー:",
            err?.message ?? String(err),
          );
          if (!cancelled)
            setScopedByRacer((prev) => ({ ...prev, [racerId]: null }));
        });
    });
    return () => {
      cancelled = true;
    };
  }, [racerIdsKey]);

  if (sortedPlayers.length === 0) return null;

  const scopedRecords = selectedRacerId ? scopedByRacer[selectedRacerId] : null;
  // 本日の想定進入コース。レース前に実際の進入は確定しないため枠なり進入を仮定する
  // （ST考察カードの entryCourseOf と同じ前提）。仮定であることは画面に明記し、
  // その選手の枠なり進入率も併記して読み手が確度を自分で判断できるようにする
  const todayCourse = selectedPlayer?.number ?? null;
  const todayRows = Array.isArray(scopedRecords)
    ? buildTodayCourseRows(scopedRecords, { venueCode, course: todayCourse })
    : [];
  const wakuNari = computeWakuNariRate(
    Array.isArray(scopedRecords) ? scopedRecords : [],
  );
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

  // from は展開パネルをどちらの表の下に出すかを決める。既定ビューと折りたたみの
  // 全コース表は同じ (rowKey, course) を指しうるため、これが無いと折りたたみで
  // 開いたのに上の表の下にパネルが出てしまう。
  // **同一判定にも from を含める**: 既定ビューの行は必ず course=todayCourse を指し、
  // 全コース表の「今日」列セルも同じ (rowKey, course) を指すため、from を判定に
  // 入れないと両者が常に衝突し、片方を開いた状態でもう片方を押すと「閉じるだけ」
  // になって無反応に見える（レビュー指摘、2026-09-24）
  const toggleCell = (rowKey, course, from) => {
    setOpenCell((prev) =>
      prev &&
      prev.rowKey === rowKey &&
      prev.course === course &&
      prev.from === from
        ? null
        : { rowKey, course, from },
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

      <div className="rwit-card">
        <h3 className="rwit-card-title">{t("wakuInfo.gridTitle")}</h3>
        {/* 既定ビューは「今日その選手が入る想定コース」1本に絞る（2026-09-24再設計）。
            6コース×1指標の表はモバイル390pxで横スクロールが要るうえ、読み手が
            本当に見たいのは今日のコースだった。列を1本にすると横幅が余るので
            1着率・2連対率・3連対率を同時に出せる＝最も見られる部分の情報は増える */}
        <p className="rwit-today-line">
          <strong className="rwit-today-course">
            {t("wakuInfo.todayCourseHeading", { course: todayCourse })}
          </strong>
          <span className="rwit-today-assumption">
            {t("wakuInfo.wakuNariAssumption")}
          </span>
        </p>
        {wakuNari.rate !== null && (
          <p className="rwit-waku-nari">
            {t("wakuInfo.wakuNariRate", {
              rate: wakuNari.rate.toFixed(0),
              n: wakuNari.n,
            })}
          </p>
        )}

        {scopedRecords === undefined ? (
          <p className="rwit-loading">{t("wakuInfo.loading")}</p>
        ) : scopedRecords === null ? (
          <p className="rwit-empty">{t("wakuInfo.fetchError")}</p>
        ) : scopedRecords.length === 0 ? (
          <p className="rwit-empty">{t("wakuInfo.noData")}</p>
        ) : (
          <>
            <table className="rwit-today-table">
              <thead>
                <tr>
                  <th className="rwit-today-label-th" scope="col">
                    {t("wakuInfo.periodHeader")}
                  </th>
                  {TODAY_METRICS.map((m) => (
                    <th key={m} className="rwit-today-metric-th" scope="col">
                      {t(`wakuInfo.metrics.${m}`)}
                    </th>
                  ))}
                  <th className="rwit-today-n-th" scope="col">
                    {t("wakuInfo.nHeader")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {todayRows.map((row) => {
                  const isSmallSample =
                    row.n > 0 && row.n < SMALL_SAMPLE_THRESHOLD;
                  const open =
                    openCell?.from === "today" && openCell?.rowKey === row.key;
                  return (
                    <tr
                      key={row.key}
                      className={`rwit-today-row${open ? " is-open" : ""}`}
                    >
                      <th className="rwit-today-label-th" scope="row">
                        {row.n === 0 ? (
                          <span className="rwit-today-label-static">
                            {t(`wakuInfo.gridRows.${row.key}`)}
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="rwit-today-label-button"
                            onClick={() =>
                              toggleCell(row.key, todayCourse, "today")
                            }
                            aria-expanded={open}
                          >
                            {t(`wakuInfo.gridRows.${row.key}`)}
                          </button>
                        )}
                      </th>
                      {TODAY_METRICS.map((m) => (
                        <td key={m} className="rwit-today-metric-td">
                          {row.metrics[m] === null ? (
                            <span className="rwit-today-empty">—</span>
                          ) : (
                            <span
                              className={`rwit-today-value${isSmallSample ? " is-small-sample" : ""}`}
                            >
                              {row.metrics[m].toFixed(1)}
                            </span>
                          )}
                        </td>
                      ))}
                      {/* 参考値マークは走数のセルに1つだけ出す。行の3指標は同じ母数を
                          共有するので、セルごとに⚠を繰り返すと記号だけが目立つ */}
                      <td
                        className={`rwit-today-n-td${isSmallSample ? " is-small-sample" : ""}`}
                      >
                        {isSmallSample && (
                          <span
                            className="rwit-grid-warn"
                            title={t("wakuInfo.smallSampleTitle")}
                          >
                            ⚠
                          </span>
                        )}
                        {row.n}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {openCell?.from === "today" && (
              <div className="rwit-expanded">
                <p className="rwit-expanded-note">
                  {t("wakuInfo.recentFinishesNote", {
                    course: openCell.course,
                  })}
                </p>
                {recentRuns.length === 0 ? (
                  <p className="rwit-expanded-empty">
                    {t("wakuInfo.noRecentFinishes")}
                  </p>
                ) : (
                  <RecentRunsBar runs={recentRuns} />
                )}
              </div>
            )}

            {/* 全コースの比較は畳んでおく。見たい人（前づけ・進入変化を気にする層）は
                確実に開くが、既定で見せると今日のコースが埋もれる */}
            <div className="rwit-fold">
              <button
                type="button"
                className={`rwit-fold-summary${foldOpen ? " is-open" : ""}`}
                onClick={() => setFoldOpen((prev) => !prev)}
                aria-expanded={foldOpen}
              >
                {foldOpen ? "▾ " : "▸ "}
                {t("wakuInfo.allCoursesFold")}
              </button>
              <div className="rwit-fold-body" hidden={!foldOpen}>
                {/* 指標チップは全コース表の中だけに効く。カード見出しの外に置くと
                    ST考察・逃げシミュレーションにも効くように見えてしまう */}
                <div
                  className="rwit-chip-row rwit-metric-row"
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
                <p className="rwit-card-sub">
                  {t("wakuInfo.gridTitleWithMetric", {
                    metric: t(`wakuInfo.metrics.${metric}`),
                  })}
                </p>
                {/* 横スクロールはこのラッパの中だけに閉じる（ページ全体は横スクロールさせない） */}
                <div className="rwit-grid-wrapper">
                  <table className="rwit-grid">
                    <thead>
                      <tr>
                        <th className="rwit-grid-label-th" scope="col"></th>
                        {GRID_COURSES.map((course) => {
                          const color = BOAT_COLORS[course] || {};
                          // 今日その選手が入る枠（枠なり進入の想定）を列ヘッダで明示する。
                          // セルの金の縁だけでは「これが今日のコース」と伝わらなかった
                          // （2026-09-24ユーザー指摘）
                          const isToday = course === selectedPlayer.number;
                          return (
                            <th
                              key={course}
                              className={`rwit-grid-course-th${isToday ? " is-today" : ""}`}
                              scope="col"
                              style={{
                                background: color.bg,
                                color: color.text,
                              }}
                            >
                              {course}
                              {isToday && (
                                <span
                                  className="rwit-today-mark"
                                  title={t("wakuInfo.todayBadge")}
                                >
                                  {t("wakuInfo.todayMark")}
                                </span>
                              )}
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
                              openCell?.from === "grid" &&
                              openCell?.rowKey === row.key &&
                              openCell?.course === cell.course;
                            const isOwnCourse =
                              cell.course === selectedPlayer.number;
                            if (cell.n === 0) {
                              return (
                                <td
                                  key={cell.course}
                                  className="rwit-grid-cell"
                                >
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
                                  onClick={() =>
                                    toggleCell(row.key, cell.course, "grid")
                                  }
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

                {openCell?.from === "grid" && (
                  <div className="rwit-expanded">
                    <p className="rwit-expanded-note">
                      {t("wakuInfo.recentFinishesNote", {
                        course: openCell.course,
                      })}
                    </p>
                    {recentRuns.length === 0 ? (
                      <p className="rwit-expanded-empty">
                        {t("wakuInfo.noRecentFinishes")}
                      </p>
                    ) : (
                      <RecentRunsBar runs={recentRuns} />
                    )}
                  </div>
                )}
                <p className="rwit-card-sub">{t("wakuInfo.gridSubtitle")}</p>
              </div>
            </div>
          </>
        )}
        <p className="rwit-caveat">{t("wakuInfo.periodCaveat")}</p>
        <p className="rwit-caveat">{t("wakuInfo.gridCaveat")}</p>
      </div>

      {/* ST考察（FR-1）。6艇分を並べるため選択中の選手に依存しない。
          今日の進入コースはレース前には確定しないため、枠なり進入を想定して
          艇番をそのままコースとして使う（日和のST考察も1号艇の抜出率が「-」で
          あることからコース別＝枠なり進入想定の集計と判断した。spec.md FR-1） */}
      <RaceStConsiderationCard
        players={sortedPlayers}
        scopedByRacer={scopedByRacer}
        baseline={baseline}
        entryCourseOf={(p) => p.number}
        fCountByBoat={fCountByBoat}
      />

      {/* 逃げシミュレーション（FR-6）。会場のコース単位の指標で、選手の選択とは独立 */}
      <NigeSimulationCard rows={nigeRows} />

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
