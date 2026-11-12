import { useState, useEffect } from "react";
import { useHorizontalScrollHint } from "../../hooks/useHorizontalScrollHint";
import { getDaysAgoJST } from "../../utils/dateUtils";
import { getRacerScopedRaceStats } from "../../services/racerQueries2.js";
import { getWinningTechniqueStats } from "../../services/venueQueries.js";
import { getStCourseBaseline } from "../../services/venueQueries2.js";
import { getNigeSimulation } from "../../services/venueQueries3.js";
import {
  buildCourseGrid,
  buildTodayCourseRows,
  computeWakuNariRate,
  getCourseRecentRuns,
} from "./courseGridStats";

// 会場全体の決まり手傾向（全艇合算）。venueTendency.technique.dataは
// { [boatNumber]: { total_races, techniques: [{technique, count, percentage}] } }
// という艇別データのため、技法名で集約して全体シェアに変換する
export function aggregateTechniqueDistribution(techniqueByBoat) {
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

// 会場単位の取得3種。このタブで使うのはracerStatsと決まり手統計の2種類だけのため、8+4クエリを
// まとめて発火するuseRaceAnalysisData/useVenueTendencyStatsは使わず個別に取得する
// （withCacheで他タブ・他コンポーネントの取得と重複しない）。
// undefined=取得中、null=取得失敗/データなし
export function useWakuInfoVenueData(venueCode) {
  const [techniqueStats, setTechniqueStats] = useState(undefined);
  // ST考察のベースライン（コース×級別の24行）と逃げシミュレーション（会場別5行）。
  // どちらも094の事前集計テーブルを単純SELECTで読む（画面では集計しない）
  const [baseline, setBaseline] = useState(undefined);
  const [nigeRows, setNigeRows] = useState(undefined);

  useEffect(() => {
    let cancelled = false;
    getStCourseBaseline()
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
    getNigeSimulation(venueCode)
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
    getWinningTechniqueStats(venueCode)
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

  return { techniqueStats, baseline, nigeRows };
}

// 選手を選ぶたびに、その選手の出走履歴を取得する（withCacheで基本情報タブ・
// 直前情報タブと共有されるため、同じ選手なら再フェッチは起きない）
// ST考察は6艇分を並べるため、選択中の1人だけでなく全選手の履歴を取得する。
// withCacheで基本情報タブ・直前情報タブと共有されるため、同じ選手なら再フェッチは起きない
export function useScopedRacerFetch(racerIdsKey, setScopedByRacer) {
  useEffect(() => {
    const ids = racerIdsKey.split(",").filter(Boolean);
    if (ids.length === 0) return undefined;
    let cancelled = false;
    ids.forEach((id) => {
      const racerId = Number(id);
      getRacerScopedRaceStats(racerId)
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
  }, [racerIdsKey, setScopedByRacer]);
}

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
export function resolveOpenCell(openCellState, selectedBoat) {
  if (!openCellState) return null;
  if (openCellState.boat === selectedBoat) return openCellState;
  if (openCellState.from === "today" && selectedBoat !== null) {
    return {
      ...openCellState,
      boat: selectedBoat,
      course: selectedBoat,
      carried: true,
    };
  }
  return null;
}

export function useOpenCell(selectedBoat) {
  const [openCellState, setOpenCell] = useState(null);
  const openCell = resolveOpenCell(openCellState, selectedBoat);

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
  return { openCell, toggleCell };
}

// 想定コースが5〜6の選手だと、比べる基準の「想定」の列が初めから画面の外にあった
// 横スクロールの送り先（scrollLeft）。「想定」の列が見える位置を返す。無ければ null
function todayColumnScrollTarget(el) {
  const th = el.querySelector(".rwit-grid-course-th.is-today");
  if (!th) return null;
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
  return target;
}

// 想定コースが5〜6の選手だと、比べる基準の「想定」の列が初めから画面の外にあった
// （375px で5〜6コース、320px で4〜6コース。#1130 ファン評価1周目）。折りたたみを開いた時・
// 選手を替えた時・履歴が届いた時に、その列が見える位置まで送る。列の左側は固定の行見出しに
// 隠れるので、その幅も見込む
export function useAlignTodayColumn({
  foldOpen,
  selectedBoat,
  metric,
  scopedByRacer,
  gridScroll,
}) {
  const { ref: gridScrollRef, update: updateGridScroll } = gridScroll;
  useEffect(() => {
    if (!foldOpen) return undefined;
    const raf = requestAnimationFrame(() => {
      const el = gridScrollRef.current;
      if (!el) return;
      const target = todayColumnScrollTarget(el);
      if (target === null) return;
      const maxScroll = el.scrollWidth - el.clientWidth;
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
}

// 選んだ選手の出走履歴から、今日の表・全コース表・開いた行の直近走・帯の見出しを組む
export function deriveCellView({
  scopedRecords,
  venueCode,
  metric,
  periodAnchor,
  todayCourse,
  openCell,
  t,
}) {
  const records = Array.isArray(scopedRecords) ? scopedRecords : null;
  // 本日の想定進入コース。レース前に実際の進入は確定しないため枠なり進入を仮定する
  // （ST考察カードの entryCourseOf と同じ前提）。仮定であることは画面に明記し、
  // その選手の枠なり進入率も併記して読み手が確度を自分で判断できるようにする
  const todayRows = records
    ? buildTodayCourseRows(records, {
        venueCode,
        course: todayCourse,
        now: periodAnchor,
      })
    : [];
  const wakuNari = computeWakuNariRate(records ?? []);
  const grid = records
    ? buildCourseGrid(records, { venueCode, metric, now: periodAnchor })
    : [];
  const recentRuns =
    openCell && records
      ? getCourseRecentRuns(records, {
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
  return { todayRows, wakuNari, grid, recentRuns, shownCell, recentHeading };
}

// 逃げ・決まり手は会場単位の事前集計で、今日から見た直近の期間しか持たない。
// 過去のレースでは「今日時点の集計」と期間を明記する（BOA-608）
export function computeTechniqueAsOf(raceIsPast, techniqueStats) {
  if (!raceIsPast || !techniqueStats?.last_updated) return null;
  // last_updated は集計ジョブを動かした日（JST）。ジョブは深夜に動き、
  // その日から90日前以降の確定した結果（＝前日まで）を数える
  // （scripts/daily/update-winning-technique-stats.js）
  const ranOn = new Date(`${techniqueStats.last_updated}T12:00:00+09:00`);
  return {
    start: getDaysAgoJST(90, ranOn),
    end: getDaysAgoJST(1, ranOn),
  };
}

// 指標・全コース比較の折りたたみ・横スクロールの手がかりをまとめて持つ
export function useGridFold(selectedBoat, scopedByRacer) {
  const [metric, setMetric] = useState("winRate");
  // 全コース比較の折りたたみ。native <details> ではなくReactの状態で持つ。
  // <details> は取得待ちの分岐（scopedRecords === undefined）の中にあるため、
  // 履歴が未取得の選手に切り替えるとサブツリーが差し替わって再マウントされ、
  // 開いていた折りたたみが勝手に閉じる（レビュー指摘、2026-09-24）。
  // ST考察カードの openSection と同じ制御方式に揃える
  const [foldOpen, setFoldOpen] = useState(false);
  // 全コース比較の表は 375px で 5〜6コースの列が切れるのに、横に続く手がかりが無かった（BOA-607）。
  // 折りたたみを開いた時・指標や選手を替えた時・履歴が届いた時に測り直す
  const gridScroll = useHorizontalScrollHint([
    foldOpen,
    metric,
    selectedBoat,
    scopedByRacer,
  ]);
  useAlignTodayColumn({
    foldOpen,
    selectedBoat,
    metric,
    scopedByRacer,
    gridScroll,
  });
  return { metric, setMetric, foldOpen, setFoldOpen, gridScroll };
}

// 「直近3ヶ月・直近1ヶ月」の起点もレースの日にそろえる。今日を起点にすると、
// 過去のレースでは期間がずれる（BOA-603）。当日のレースは今日と同じ日付になる
export function periodAnchorOf(raceId) {
  return raceId
    ? new Date(`${raceId.slice(0, 10)}T12:00:00+09:00`)
    : new Date();
}
