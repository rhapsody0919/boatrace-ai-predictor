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
import { getDaysAgoJST, isRaceBeforeTodayJST } from "../../utils/dateUtils";
import { useTranslation } from "react-i18next";
import { BOAT_COLORS } from "../../utils/colors";
import { supabaseDataService } from "../../services/supabaseDataService";
import { useCurrentMeetFlyingBoats } from "../../hooks/useCurrentMeetFlyingBoats";
import { useRaceEntryFlyingRows } from "../../hooks/useRaceEntryFlyingRows";
import { useHorizontalScrollHint } from "../../hooks/useHorizontalScrollHint";
import { translateTechnique } from "./raceIndicators";
import { SMALL_SAMPLE_THRESHOLD, recordsBeforeRace } from "./basicInfoStats";
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
import "../common/HorizontalScrollHint.css";
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
function RaceWakuInfoTab({
  venueCode,
  players,
  raceId,
  focusedBoat,
  onFocusBoat,
}) {
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
  // 出走表の今期F・L数（艇番→{f_count, l_count}）。データ出走表と同じフック（BOA-638）
  const flyingRowByBoat = useRaceEntryFlyingRows(raceId);
  // Fバッジの「今節」の印（BOA-440）
  const currentMeetFlyingBoats = useCurrentMeetFlyingBoats(raceId);

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

  // 選んでいる艇はタブをまたいで共有する（BOA-492）。共有値が null（＝まだ
  // どの艇も選んでいない）のときは従来どおり1号艇を見せる
  const selectedBoat = focusedBoat ?? sortedPlayers[0]?.number ?? null;
  const [metric, setMetric] = useState("winRate");
  // グリッドのどのセルを開いているか（行キー × コース × どちらの表か）。
  // どの艇のセルかも一緒に持ち、艇が変わったら開いていない扱いにする（前の選手の
  // 行を指したままになるため）。艇の選択はタブ間共有（BOA-492）でこのタブの操作
  // 以外でも変わるので、selectBoatの中で閉じるのではなくここで判定する。
  // 副作用として、1→4→1と艇を戻すと1で開いていたセルが再び開く（従来は閉じた
  // まま）。同じ選手の同じセルに戻るだけなのでそのままにしている
  //
  // ただし既定ビュー（今日の想定コースの表）で開いた行は、艇を替えても同じ行（当地・
  // 直近1ヶ月など）のまま開いておく。コースは新しい艇の想定コース（枠なり＝艇番）に
  // 替える。6艇を同じ条件で見比べるのに、艇ごとに行を押し直していた（BOA-604
  // ファン評価2周目）。全コース表のセルはコースを指定して開くので、従来どおり閉じる
  const [openCellState, setOpenCell] = useState(null);
  const openCell = !openCellState
    ? null
    : openCellState.boat === selectedBoat
      ? openCellState
      : openCellState.from === "today" && selectedBoat !== null
        ? {
            ...openCellState,
            boat: selectedBoat,
            course: selectedBoat,
            carried: true,
          }
        : null;
  // 全コース比較の折りたたみ。native <details> ではなくReactの状態で持つ。
  // <details> は取得待ちの分岐（scopedRecords === undefined）の中にあるため、
  // 履歴が未取得の選手に切り替えるとサブツリーが差し替わって再マウントされ、
  // 開いていた折りたたみが勝手に閉じる（レビュー指摘、2026-09-24）。
  // ST考察カードの openSection と同じ制御方式に揃える
  const [foldOpen, setFoldOpen] = useState(false);

  const selectedPlayer =
    sortedPlayers.find((p) => p.number === selectedBoat) ?? sortedPlayers[0];
  const selectedRacerId = selectedPlayer?.racerId ?? null;

  // 全コース比較の表は 375px で 5〜6コースの列が切れるのに、横に続く手がかりが無かった（BOA-607）。
  // 折りたたみを開いた時・指標や選手を替えた時・履歴が届いた時に測り直す
  const {
    ref: gridScrollRef,
    hasMore: gridHasMore,
    hasLess: gridHasLess,
    update: updateGridScroll,
    scrollRight: scrollGridRight,
    scrollLeft: scrollGridLeft,
  } = useHorizontalScrollHint([foldOpen, metric, selectedBoat, scopedByRacer]);

  // 想定コースが5〜6の選手だと、比べる基準の「想定」の列が初めから画面の外にあった
  // （375px で5〜6コース、320px で4〜6コース。#1130 ファン評価1周目）。折りたたみを開いた時・
  // 選手を替えた時・履歴が届いた時に、その列が見える位置まで送る。列の左側は固定の行見出しに
  // 隠れるので、その幅も見込む
  useEffect(() => {
    if (!foldOpen) return undefined;
    const raf = requestAnimationFrame(() => {
      const el = gridScrollRef.current;
      if (!el) return;
      const th = el.querySelector(".rwit-grid-course-th.is-today");
      if (!th) return;
      const label = el.querySelector(".rwit-grid-label-th");
      const labelWidth = label ? label.getBoundingClientRect().width : 0;
      const box = el.getBoundingClientRect();
      const col = th.getBoundingClientRect();
      const left = col.left - box.left + el.scrollLeft;
      const right = left + col.width;
      // 右にまだ続きがあるあいだは、右端に幅40pxのフェードと「›」が重なる
      // （HorizontalScrollHint.css）。列の右端がフェードに掛からない位置まで送る。
      // 箱の右端ちょうどに収めるだけだと、4〜5号艇の「想定」の列がフェードの下で薄れて
      // 読めなかった（#1130 ファン評価2周目）
      const FADE_WIDTH = 40;
      const maxScroll = el.scrollWidth - el.clientWidth;
      let target = el.scrollLeft;
      if (right > target + el.clientWidth - FADE_WIDTH) {
        target = right - (el.clientWidth - FADE_WIDTH);
      }
      if (left - labelWidth < target) target = left - labelWidth;
      // 送り先は列の境目にそろえる。列の途中で止まると、固定の行見出しのすぐ右に、隠れかけた
      // 列の切れ端（見出しの白い帯や数字の欠片）が残った（#1130 ファン評価3周目）。
      // 行見出しの右端に掛かる列があれば、その列を丸ごと隠す位置まで送る
      for (const head of el.querySelectorAll(".rwit-grid-course-th")) {
        const r = head.getBoundingClientRect();
        const colLeft = r.left - box.left + el.scrollLeft;
        const colRight = colLeft + r.width;
        if (colLeft < target + labelWidth && colRight > target + labelWidth) {
          target = colRight - labelWidth;
          break;
        }
      }
      el.scrollLeft = Math.min(maxScroll, Math.max(0, target));
      updateGridScroll();
    });
    return () => cancelAnimationFrame(raf);
    // 指標を替えると列の幅が変わるので、そのときも測り直す（#1130 ファン評価2周目）
  }, [
    foldOpen,
    selectedBoat,
    metric,
    scopedByRacer,
    gridScrollRef,
    updateGridScroll,
  ]);

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

  // 表示中のレースより前の走だけを使う（BOA-603）。過去のレースを開いたとき、
  // そのレース自身と後日の走がコース別成績・直近走の帯・ST考察に入り、結果を
  // 知った状態の数字になっていた
  const scopedBefore = Object.fromEntries(
    Object.entries(scopedByRacer).map(([id, records]) => [
      id,
      recordsBeforeRace(records, raceId),
    ]),
  );
  const scopedRecords = selectedRacerId ? scopedBefore[selectedRacerId] : null;
  // 「直近3ヶ月・直近1ヶ月」の起点もレースの日にそろえる。今日を起点にすると、
  // 過去のレースでは期間がずれる（BOA-603）。当日のレースは今日と同じ日付になる
  const periodAnchor = raceId
    ? new Date(`${raceId.slice(0, 10)}T12:00:00+09:00`)
    : new Date();
  // 本日の想定進入コース。レース前に実際の進入は確定しないため枠なり進入を仮定する
  // （ST考察カードの entryCourseOf と同じ前提）。仮定であることは画面に明記し、
  // その選手の枠なり進入率も併記して読み手が確度を自分で判断できるようにする
  const todayCourse = selectedPlayer?.number ?? null;
  const todayRows = Array.isArray(scopedRecords)
    ? buildTodayCourseRows(scopedRecords, {
        venueCode,
        course: todayCourse,
        now: periodAnchor,
      })
    : [];
  const wakuNari = computeWakuNariRate(
    Array.isArray(scopedRecords) ? scopedRecords : [],
  );
  const grid = Array.isArray(scopedRecords)
    ? buildCourseGrid(scopedRecords, { venueCode, metric, now: periodAnchor })
    : [];
  const recentRuns =
    openCell && Array.isArray(scopedRecords)
      ? getCourseRecentRuns(scopedRecords, {
          venueCode,
          rowKey: openCell.rowKey,
          course: openCell.course,
          now: periodAnchor,
        })
      : [];

  // 艇を替えて引き継いだ行が、新しい艇では走数0なら閉じる。その行はボタンにならず
  // （押して閉じられない）、「直近0走」の空の帯だけが表の下に残った（BOA-604 ファン評価3周目）
  const shownCell =
    openCell?.carried && recentRuns.length === 0 ? null : openCell;

  // 帯の見出し。押した行の条件と、実際に並んだ走数を入れる（BOA-604）。以前は行によらず
  // 「◯コースから出走した直近10走」のままで、「当地」で1走しか無くても10走と書いていた。
  // 「今期」の行は公式の期区分ではない（当社データの全期間）ので、期間をそのまま書く
  // （基本情報タブの periodCaveat・#973 と同じ「2025年12月以降」）
  const recentHeading = shownCell
    ? t("wakuInfo.recentFinishesNoteScoped", {
        scope: t(`wakuInfo.recentScope.${shownCell.rowKey}`),
        course: shownCell.course,
        n: recentRuns.length,
      })
    : null;

  const selectBoat = (boatNumber) => {
    onFocusBoat(boatNumber);
  };

  // from は展開パネルをどちらの表の下に出すかを決める。既定ビューと折りたたみの
  // 全コース表は同じ (rowKey, course) を指しうるため、これが無いと折りたたみで
  // 開いたのに上の表の下にパネルが出てしまう。
  // **同一判定にも from を含める**: 既定ビューの行は必ず course=todayCourse を指し、
  // 全コース表の「今日」列セルも同じ (rowKey, course) を指すため、from を判定に
  // 入れないと両者が常に衝突し、片方を開いた状態でもう片方を押すと「閉じるだけ」
  // になって無反応に見える（レビュー指摘、2026-09-24）
  // 開いているか（閉じるか）の判定は、画面に出ている openCell（艇を替えて引き継いだ
  // 行を含む）と比べる。元の状態（前の艇）と比べると、引き継いだ行を押しても閉じない
  const toggleCell = (rowKey, course, from) => {
    const isOpen =
      openCell &&
      openCell.rowKey === rowKey &&
      openCell.course === course &&
      openCell.from === from;
    setOpenCell(isOpen ? null : { boat: selectedBoat, rowKey, course, from });
  };

  const techniqueDistribution = aggregateTechniqueDistribution(
    techniqueStats?.data,
  );
  // 逃げ・決まり手は会場単位の事前集計で、今日から見た直近の期間しか持たない。
  // 過去のレースでは「今日時点の集計」と期間を明記する（BOA-608）
  const raceIsPast = isRaceBeforeTodayJST(raceId);
  const techniqueAsOf =
    raceIsPast && techniqueStats?.last_updated
      ? (() => {
          // last_updated は集計ジョブを動かした日（JST）。ジョブは深夜に動き、
          // その日から90日前以降の確定した結果（＝前日まで）を数える
          // （scripts/daily/update-winning-technique-stats.js）
          const ranOn = new Date(
            `${techniqueStats.last_updated}T12:00:00+09:00`,
          );
          return {
            start: getDaysAgoJST(90, ranOn),
            end: getDaysAgoJST(1, ranOn),
          };
        })()
      : null;

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
              // 艇番の丸は、選んだときだけ艇の文字色で塗り、数字はその反対の白黒にする。
              // ページの地の色のままだと、1・5号艇（黒字）はダークで、2・3・4・6号艇（白字）は
              // ライトで、丸の地と数字が同化した。数字を艇の色にすると、赤・青では白との
              // コントラストが約4:1で足りない（BOA-693）
              style={
                active
                  ? {
                      background: color.bg,
                      color: color.text,
                      "--rwit-chip-num-bg": color.text,
                      "--rwit-chip-num-fg":
                        color.text === "#ffffff" ? "#000000" : "#ffffff",
                    }
                  : undefined
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
                    shownCell?.from === "today" &&
                    shownCell?.rowKey === row.key;
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

            {shownCell?.from === "today" && (
              <div className="rwit-expanded">
                <p className="rwit-expanded-note">{recentHeading}</p>
                {recentRuns.length === 0 ? (
                  <p className="rwit-expanded-empty">
                    {t("wakuInfo.noRecentFinishes")}
                  </p>
                ) : (
                  <RecentRunsBar
                    // 押した行・コースが変わったら作り直す。作り直さないと、
                    // 件数と最新の走が同じ期間に切り替えたとき、右端（最新）へ
                    // 送り直されない（BOA-601 ファン評価2周目）
                    key={
                      openCell
                        ? `${openCell.rowKey}-${openCell.course}`
                        : "none"
                    }
                    runs={recentRuns}
                  />
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
                {/* 横スクロールはこのラッパの中だけに閉じる（ページ全体は横スクロールさせない）。
                    切れていることが分かるよう「›」「‹」を重ねる（BOA-607） */}
                <div
                  className={`rwit-grid-hscroll hscroll-hint${gridHasMore ? " has-more" : ""}`}
                >
                  {gridHasLess && (
                    <button
                      type="button"
                      className="hscroll-less"
                      onClick={scrollGridLeft}
                      aria-hidden="true"
                      tabIndex={-1}
                    >
                      ‹
                    </button>
                  )}
                  {gridHasMore && (
                    <button
                      type="button"
                      className="hscroll-more"
                      onClick={scrollGridRight}
                      aria-hidden="true"
                      tabIndex={-1}
                    >
                      ›
                    </button>
                  )}
                  <div
                    className="rwit-grid-wrapper"
                    ref={gridScrollRef}
                    onScroll={updateGridScroll}
                  >
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
                </div>

                {openCell?.from === "grid" && (
                  <div className="rwit-expanded">
                    <p className="rwit-expanded-note">{recentHeading}</p>
                    {recentRuns.length === 0 ? (
                      <p className="rwit-expanded-empty">
                        {t("wakuInfo.noRecentFinishes")}
                      </p>
                    ) : (
                      <RecentRunsBar
                        // 押した行・コースが変わったら作り直す。作り直さないと、
                        // 件数と最新の走が同じ期間に切り替えたとき、右端（最新）へ
                        // 送り直されない（BOA-601 ファン評価2周目）
                        key={
                          openCell
                            ? `${openCell.rowKey}-${openCell.course}`
                            : "none"
                        }
                        runs={recentRuns}
                      />
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
        scopedByRacer={scopedBefore}
        baseline={baseline}
        entryCourseOf={(p) => p.number}
        flyingRowByBoat={flyingRowByBoat}
        currentMeetFlyingBoats={currentMeetFlyingBoats}
      />

      {/* 逃げシミュレーション（FR-6）。会場のコース単位の指標で、選手の選択とは独立 */}
      <NigeSimulationCard rows={nigeRows} asOfToday={raceIsPast} />

      <div className="rwit-card">
        <h3 className="rwit-card-title">{t("wakuInfo.kimariteTitle")}</h3>
        {techniqueAsOf && (
          <p className="rwit-as-of">
            {t("wakuInfo.venueStatsAsOfToday", techniqueAsOf)}
          </p>
        )}
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
