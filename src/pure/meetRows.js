/**
 * 今節タブ（RaceMeetTab）の表の行の組み立て（純関数、副作用なし）。
 *
 * 取得済みの節のデータ（board）と表示中の6艇（sortedPlayers）から、比較表の行（順位の付いた
 * 選手・欠場だけの選手・まだ走っていない艇）と得点率早見の行を作る。
 * `src/components/race/RaceMeetTabModel.jsx` から字のまま移した（RA20）。
 */
import {
  buildMeetRanking,
  listAbsentOnlyRacers,
  groupExcludedRacers,
  forecastSeriesScore,
  pointsNeededForBorder,
} from "./seriesPoints.js";

export function buildRankingModel(board, sortedPlayers) {
  const ranking = buildMeetRanking(board);
  // 今節の走が全て欠場の選手は得点率が出ず ranking に載らない。そのままだと
  // 比較表から黙って消えるので、末尾に「欠場」の行として足す（BOA-504）
  const rankedIds = new Set(ranking.map((r) => r.racerId));
  const absentOnly = listAbsentOnlyRacers(board).filter(
    (r) => !rankedIds.has(r.racerId),
  );
  return {
    ranking,
    absentOnly,
    // ボーダーは**順位の対象になっている選手だけ**から取る。途中で離脱した
    // 選手を混ぜると公式とズレる（若松G1の実測で 5.67 → 除外すると 5.60 で
    // 実ボーダーと完全一致）
    rankedOnly: ranking.filter((r) => !r.withdrawn),
    // 予選の後に今節Fを切った選手（順位は付いたまま。BOA-626）
    postPrelimFlying: new Set(board?.postPrelimFlyingRacerIds ?? []),
    // 順位の対象外の内訳（BOA-697）
    excludedGroups: groupExcludedRacers(ranking, absentOnly),
    // 節内順位の表が公式の得点率一覧の値でできているか（出典の注記の出し分け）。
    // サービス層が「予選終了後の表示」のときだけ公式行を渡す（BOA-475）
    usesOfficialScore: ranking.some((r) => r.fromOfficial),
    // 今節をまだ走っていない艇（このレースが今節の初戦）。行ごと消すと「欠場か」と
    // 読み違えるので、行として出す（BOA-660、津 9/23 6R で6艇中3艇しか出なかった）
    // **データが届く前は判定しない**。届く前は今節の走が0件なので6艇とも「まだ走って
    // いない」になり、「節の出場は0人」と全艇「今節初戦」の表が一瞬出ていた
    // （PR #1102 ファン評価2周目）
    notYetRun: board
      ? sortedPlayers.filter(
          (p) =>
            !ranking.some((r) => r.racerId === p.racerId) &&
            !absentOnly.some((r) => r.racerId === p.racerId),
        )
      : [],
  };
}

// 得点率早見（6艇×1着〜6着）。公式の「得点率早見」は**6艇を1つの表**にして
// 行＝艇・列＝着順で並べ、ボーダーとの関係を色で示す
// （https://www.boatrace.jp/static_extra/pc/guide/guide-7.html）。
// 1艇ぶんだけ出していたときは「他の艇はどうなるのか」が読めなかった。
// 追加クエリ0本（既に持っている得点・走数から純関数で出す）
export function buildForecastRows(f) {
  const { board, sortedPlayers, ranking, stage, border, showBorderBadge } = f;
  const remainingPrelimRuns = board?.remainingPrelimRunsByRacer ?? {};
  // 残り走で取りうる最大得点（ドリーム戦の1着は12点）。無ければ予選配点で代用
  const remainingPrelimMaxPoints = board?.remainingPrelimMaxPointsByRacer ?? {};
  return sortedPlayers
    .map((p) => ({
      player: p,
      row: ranking.find((r) => r.racerId === p.racerId),
    }))
    .filter((x) => x.row)
    .map(({ player, row }) => ({
      player,
      row,
      // 表示中レースの種別で配点を切り替える（ドリーム戦は1着+12）
      cells: forecastSeriesScore(row, stage),
      // 公式の「必要得点」＝準優ボーダーをクリアするのに要る得点。
      // 残り走数は**当日の番組が出ている予選レース**から数える
      // （翌日以降の出走表は未取得のことが多い）
      needed: pointsNeededForBorder(
        row,
        showBorderBadge && border !== undefined ? border : null,
        remainingPrelimRuns[player.racerId] ?? 0,
        remainingPrelimMaxPoints[player.racerId] ?? null,
      ),
      remaining: remainingPrelimRuns[player.racerId] ?? 0,
    }));
}

export function buildForecastModel(f) {
  const { isCancelled, prelimOver, isAfterPrelim } = f;
  const forecastRows =
    !isCancelled && !prelimOver && !isAfterPrelim ? buildForecastRows(f) : [];
  return {
    forecastRows,
    // 必要得点の列を出せるか（誰か1人でも残りの予選走が分かっていれば出す）
    hasNeeded: forecastRows.some((r) => r.needed !== null),
  };
}
