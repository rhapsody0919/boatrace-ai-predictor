/**
 * RaceMeetTab の表示に要る値を、取得済みの節のデータ（board・records）から
 * 組み立てる純関数（副作用なし）。画面の節ごとの部品へは `buildMeetModel` の結果を渡す。
 */
import { bestOf } from "../../utils/bestOf";
import {
  mdOf,
  buildTrendModel,
  buildSelectedModel,
  makeSparkLabel,
} from "./RaceMeetTabTrendModel";
import {
  buildMeetRanking,
  listAbsentOnlyRacers,
  groupExcludedRacers,
  forecastSeriesScore,
  pointsNeededForBorder,
  countsForSeriesScore,
  isExcludedStage,
  SEMIFINAL_DEFAULT_SLOTS,
  SEMIFINAL_SPLIT_DEFAULT_SLOTS,
  MEET_SMALL_SAMPLE_RUNS,
  meetRateBestCandidates,
} from "./seriesPoints";

// 順位の対象外の理由 → 画面の文言キー（meetTab.<key> と meetTab.<key>Title）。BOA-587
export const EXCLUDED_LABEL_KEY = {
  withdrawn: "withdrawn",
  // 公式の備考による途中帰郷（説明の文だけ当社の推定と分ける）
  officialWithdrawn: "withdrawnOfficial",
  awardExcluded: "awardExcluded",
  flying: "flyingExcluded",
};

// 準優の目安（上から slots 位）の中か。順位の対象外は rank が null で、
// `null <= 18` は true になるため、比べる前に外す（BOA-587 ファン評価1周目）
export const rankInBorder = (row, slots) =>
  row.rank !== null && row.rank !== undefined && row.rank <= slots;

const bestCls = (set, boat) => (set.has(boat) ? " ind-best" : "");

// Ｗ開催の節は母集団が半分（24人前後）になるので、既定値も分ける。
// 通常の18を当てると「24人中18位まで」という緩すぎる線になる（BOA-511）
function buildStageModel(board, raceId) {
  const slots =
    board?.semifinalSlots ??
    (board?.seriesRacerIds
      ? SEMIFINAL_SPLIT_DEFAULT_SLOTS
      : SEMIFINAL_DEFAULT_SLOTS);
  const stage = board?.currentStage ?? "";
  // **表示中のレースが得点率を動かすか**。予選が締まった後の一般戦・特別選抜戦・
  // 準優・優勝戦では動かない（公式の得点率一覧も予選終了時点で止まる）。
  // 表示中レースの種別だけを見ていると、最終日の「特別選抜戦」で
  // 「今日の着順で得点率はこう動く」「準優の目安」を出してしまう。
  // 判定は得点率の集計と同じ `countsForSeriesScore` を使う（BOA-457）
  const prelimEndRaceId = board?.prelimEndRaceId ?? null;
  return {
    slots,
    stage,
    prelimEndRaceId,
    isAfterPrelim: isExcludedStage(stage),
    prelimOver: !countsForSeriesScore(stage, raceId, prelimEndRaceId),
  };
}

function buildPrelimEndModel(board, prelimEndRaceId) {
  // 丸一日レースが無かった日（中止・順延、BOA-636）。「9/22」の形で持つ
  const noRaceDays = board?.noRaceDays ?? [];
  return {
    prelimEndDate: prelimEndRaceId ? mdOf(prelimEndRaceId) : null,
    prelimEndDay: board?.prelimEndDay ?? null,
    noRaceDays,
    // 予選終了の日より前の、レースが無かった日。日目と日付の数が合わない理由になる
    noRaceDaysBeforePrelimEnd: prelimEndRaceId
      ? noRaceDays.filter((d) => d < prelimEndRaceId.slice(0, 10))
      : [],
  };
}

function buildRankingModel(board, sortedPlayers) {
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

// 目安を出している時点の走数（順位の対象の選手の中央値）。「◯走時点の目安」と断る
function medianRunsOf(rankedOnly) {
  const runs = rankedOnly.map((r) => r.runs).sort((a, b) => a - b);
  return runs.length > 0 ? runs[Math.floor(runs.length / 2)] : 0;
}

// 男女Ｗ優勝戦の節の人数。節全体では何人いるかで、分けたときに
// 「なぜ半分になったのか」を数で示す
function buildEntrantModel(board, ranking, seriesSplit, seriesIdSet) {
  // `buildMeetRanking` を分けずにもう一度通すだけ（追加クエリ0本・48人ぶんの計算）
  // 出場者は出走表から数える（得点率の母集団ではなく。BOA-660）。取れなければ従来どおり
  const entrantIds = board?.meetEntrantIds ?? null;
  const entrantCount = Math.max(
    entrantIds
      ? entrantIds.filter((id) => !seriesIdSet || seriesIdSet.has(id)).length
      : 0,
    ranking.length,
  );
  const meetTotal = entrantIds
    ? entrantIds.length
    : seriesSplit
      ? buildMeetRanking({ ...board, seriesRacerIds: null }).length
      : ranking.length;
  return { entrantCount, meetTotal };
}

function buildSeriesModel(board, ranking, rankedOnly, slots) {
  // 男女Ｗ優勝戦の節か（サービス層が同じシリーズの選手だけを渡してくる）
  const seriesSplit = Boolean(board?.seriesRacerIds);
  const seriesIdSet = seriesSplit ? new Set(board.seriesRacerIds) : null;
  // **この節をまだ1走もしていない選手**の数（BOA-690）。この選手がいる間（ふつうは
  // 初日の途中）は順位の対象がそろっておらず、目安が意味を持たない（下関の初日に
  // 「準優の目安は18位（2.00）」と出た）。2日目以降は出したまま、走数で断る
  const notYetStarted = (board?.notYetStartedRacerIds ?? []).filter(
    (id) => !seriesIdSet || seriesIdSet.has(id),
  ).length;
  return {
    seriesSplit,
    ...buildEntrantModel(board, ranking, seriesSplit, seriesIdSet),
    border: rankedOnly[slots - 1]?.rate,
    notYetStarted,
    bordersReady: notYetStarted === 0,
    medianRuns: medianRunsOf(rankedOnly),
  };
}

function buildBorderFlags(f) {
  const { isCancelled, isAfterPrelim, prelimOver, bordersReady, border, mine } =
    f;
  return {
    // 表のボーダー表示は「節全体の順位」なので、選んだ選手の走数に依存しない
    showBorderBadge:
      !isCancelled &&
      !isAfterPrelim &&
      !prelimOver &&
      bordersReady &&
      border !== undefined,
    // まだ全員が1走していないので目安を伏せている間（BOA-690）
    borderPendingShown:
      !bordersReady && !isCancelled && !isAfterPrelim && !prelimOver,
    showBorder:
      !isCancelled &&
      bordersReady &&
      !isAfterPrelim &&
      !prelimOver &&
      mine &&
      mine.runs >= MEET_SMALL_SAMPLE_RUNS,
  };
}

// 得点率早見（6艇×1着〜6着）。公式の「得点率早見」は**6艇を1つの表**にして
// 行＝艇・列＝着順で並べ、ボーダーとの関係を色で示す
// （https://www.boatrace.jp/static_extra/pc/guide/guide-7.html）。
// 1艇ぶんだけ出していたときは「他の艇はどうなるのか」が読めなかった。
// 追加クエリ0本（既に持っている得点・走数から純関数で出す）
function buildForecastRows(f) {
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

function buildForecastModel(f) {
  const { isCancelled, prelimOver, isAfterPrelim } = f;
  const forecastRows =
    !isCancelled && !prelimOver && !isAfterPrelim ? buildForecastRows(f) : [];
  return {
    forecastRows,
    // 必要得点の列を出せるか（誰か1人でも残りの予選走が分かっていれば出す）
    hasNeeded: forecastRows.some((r) => r.needed !== null),
  };
}

// 6艇の今節の最良（同値は全部）に金枠を付ける（race-detail-ui-unify R1、モック承認済み）。
// 得点率は高いほど、節内順位・前検タイムは低いほど良い。表示と同じ桁で比べる。
// 欠場・未出走の行は得点率・順位が出ないので候補に入らない。
// 走数が少ない（⚠）艇の得点率・順位は比べるが、最良でも金枠を付けない（繰り下げもしない）。
// 初日に1走だけの「⚠10.00」が最良に光っていた（PR #1187 ファン評価1周目。
// 基本情報の横棒と同じく、当てにならない値を最良として光らせない）
function buildBestModel({ sortedPlayers, ranking, slots, pretestOf }) {
  const compareRows = sortedPlayers
    .map((p) => ({
      boat: p.number,
      row: ranking.find((r) => r.racerId === p.racerId),
    }))
    .filter((x) => x.row);
  return {
    // 表の6艇に準優の目安内の艇がいるか（いなければ点線が引かれない。BOA-756）
    tableHasInBorder: compareRows.some(({ row }) => rankInBorder(row, slots)),
    // 公式の途中帰郷は得点率を「—」で出すので候補から外す（BOA-872）
    bestRate: bestOf(meetRateBestCandidates(compareRows), "max", {
      digits: 2,
    }),
    bestRank: bestOf(
      compareRows.map(({ boat, row }) => ({
        boat,
        value: row.rank,
        hidden: row.runs < MEET_SMALL_SAMPLE_RUNS,
      })),
      "min",
    ),
    bestPretest: bestOf(
      sortedPlayers.map((p) => {
        const time = pretestOf(p.racerId)?.pretest_time;
        return {
          boat: p.number,
          value: time === null || time === undefined ? null : Number(time),
        };
      }),
      "min",
      { digits: 2 },
    ),
  };
}

// 表の印の説明に要る真偽。印が表の6艇に出ているときだけ断る
function buildLegendFlags(f) {
  const { sortedPlayers, ranking, absentOnly, postPrelimFlying } = f;
  // 表の6艇のうちの選手か（凡例の出し分け。節の誰かに該当者が居るだけで出すと、
  // 表に無い印の説明を読ませることになる。BOA-660）
  const inTable = (r) => sortedPlayers.some((p) => p.racerId === r.racerId);
  return {
    inTable,
    // 表の印の説明（人数の行の後ろの段落に出す。BOA-714）
    showPostPrelimFlyingNote: sortedPlayers.some((p) =>
      ranking.some(
        (r) =>
          r.racerId === p.racerId &&
          r.rank !== null &&
          postPrelimFlying.has(r.racerId),
      ),
    ),
    showAbsentNote: absentOnly.some(inTable),
    showBestLegend: f.bestRate.size + f.bestRank.size + f.bestPretest.size > 0,
    showSmallSampleLegend: ranking
      .filter(inTable)
      .some((r) => r.runs < MEET_SMALL_SAMPLE_RUNS),
  };
}

// 節の取得結果（board）と選んだ選手の履歴（records）から、画面の各部品が使う値を作る
export function buildMeetModel(args) {
  const { board, sortedPlayers, selectedPlayer, raceId, t } = args;
  const pretestOf = (racerId) => board?.pretestByRacer?.[racerId] ?? null;
  const stageModel = buildStageModel(board, raceId);
  const prelimEnd = buildPrelimEndModel(board, stageModel.prelimEndRaceId);
  const rk = buildRankingModel(board, sortedPlayers);
  const series = buildSeriesModel(board, rk.ranking, rk.rankedOnly, stageModel.slots);
  const mine = rk.ranking.find((r) => r.racerId === selectedPlayer?.racerId);
  const flags = buildBorderFlags({ ...args, ...stageModel, ...series, mine });
  const pick = { ...args, ...stageModel, ...series, ...rk, ...prelimEnd, ...flags, pretestOf };
  const best = buildBestModel({ ...pick });
  return {
    ...stageModel,
    ...prelimEnd,
    ...rk,
    ...series,
    ...flags,
    ...best,
    ...buildLegendFlags({ ...pick, ...best }),
    ...buildForecastModel(pick),
    ...buildTrendModel({ ...pick }),
    ...buildSelectedModel(pick),
    mine,
    pretestOf,
    bestCls,
    // 同率が何人いるか。節の序盤は得点率の刻みが粗く（3走なら0.33刻み）
    // 「11位」が3人並ぶ。順位だけ見せると分解能を過信させる
    tiedCount: (rank) =>
      rk.ranking.filter((r) => r.rank !== null && r.rank === rank).length,
    mdList: (days) => days.map(mdOf).join(t("meetTab.listSeparator")),
    sparkLabel: makeSparkLabel(t),
  };
}
