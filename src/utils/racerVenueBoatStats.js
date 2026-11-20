/**
 * 選手ページの会場×枠番×グレード×レース種別の絞り込み集計（純関数、BOA-1244）。
 *
 * supabaseDataService.js の中にあった aggregateRacerVenueBoatStats・toReturnRate と、getRacerRaceHistory の
 * 730日の切り（racerHistoryCutoff）を、手を加えずに移した。選手ページ（RacerPerformanceStats）と
 * 龍神ボート番付（scripts/sns/rank-data.js --dataset=racer_page）の両方がこれを使う。
 *
 * Node から読むため、import は拡張子付き。
 */
import { tallyWinPlaceShow } from "./racerConditionStats.js";
import { finishPositionOf } from "../pure/basicInfoStats.js";

// 100円単位で賭けた場合の回収率(%)を返す（払戻合計 / (件数*100) * 100）。
// getRacerBoatReturnRate/getRaceRacerBoatReturnRate/aggregateRacerVenueBoatStats
// の3箇所で同じ式が使われているための共通化（BOA-159レビューで発見）
export function toReturnRate(payoutSum, sampleCount) {
  return sampleCount > 0 ? (payoutSum / (sampleCount * 100)) * 100 : null;
}

/**
 * getRacerRaceHistory の期間の始まり（race_id と比べる YYYY-MM-DD）。見た時刻から730日前の日を、
 * その環境の時刻で数えて UTC の日付にする（画面のブラウザと同じ式。日本時間の 0〜9 時は1日前になる）
 * @param {Date} [now]
 */
export function racerHistoryCutoff(now = new Date()) {
  const cutoffDate = new Date(now.getTime());
  cutoffDate.setDate(cutoffDate.getDate() - 730);
  return cutoffDate.toISOString().split("T")[0];
}

/**
 * getRacerRaceHistory()が返すフラット履歴を「会場×枠番×グレード×レース種別」
 * で絞り込み集計する純粋関数（I/O無し）。各引数はnullで絞り込みなしを表す。
 * raceGrade/raceStageはBOA-159で追加（完全一致判定のみ、サンプル数閾値は
 * 適用しない方針、docs/design/racer-stats-drilldown/spec.md参照）。
 * 選手個人ページのフィルタが変更されるたびにこれを呼ぶことで、
 * ネットワークI/O無しで即座に再集計できる。
 * 注: 実際の進入コースはBOA-257の制約により取得できないため、発走前に
 * 決まる枠番（艇番）基準で集計する
 * @param {Array} history - getRacerRaceHistory()の戻り値
 * @param {number|null} venueCode
 * @param {number|null} boatNumber
 * @param {string|null} raceGrade - races.race_gradeと完全一致（ippan/G1/G2/G3/SG）
 * @param {string|null} raceStage - race_conditions.race_stageと完全一致（優勝戦/準優勝戦）
 */
export function aggregateRacerVenueBoatStats(
  history,
  venueCode,
  boatNumber,
  raceGrade,
  raceStage,
) {
  const acc = {
    n: 0,
    returnSum: 0,
    placeReturnSum: 0,
    stSum: 0,
    stN: 0,
    exSum: 0,
    exN: 0,
    totals: { win: 0, top2: 0, top3: 0 },
    tech: {},
    series: [],
    matchedRaces: [],
  };

  for (const row of history ?? []) {
    if (!matchesRacerFilter(row, venueCode, boatNumber, raceGrade, raceStage))
      continue;

    acc.n += 1;
    const isWin = tallyWinPlaceShow(acc.totals, row);
    addPayouts(acc, row, isWin);
    addStExhibition(acc, row);
    acc.matchedRaces.push(matchedRaceRow(row));
  }

  // レース一覧（BOA-159）は日付降順（新しい順）で見せる。集計用のhistory自体は
  // 昇順ソート済みのため、この配列だけ表示直前に反転する
  acc.matchedRaces.reverse();

  return summarizeRacerStats(acc);
}

// 会場・枠番・グレード・レース種別の完全一致（null は絞り込みなし）
function matchesRacerFilter(row, venueCode, boatNumber, raceGrade, raceStage) {
  if (venueCode && row.venueCode !== venueCode) return false;
  if (boatNumber && row.boatNumber !== boatNumber) return false;
  if (raceGrade && row.raceGrade !== raceGrade) return false;
  if (raceStage && row.raceStage !== raceStage) return false;
  return true;
}

// 1着なら決まり手と単勝・複勝（1着側）の払戻、2着なら複勝（2着側）の払戻を積む
function addPayouts(acc, row, isWin) {
  if (isWin) {
    if (row.winningTechnique) {
      acc.tech[row.winningTechnique] =
        (acc.tech[row.winningTechnique] ?? 0) + 1;
    }
    acc.returnSum += row.payoutWin ?? 0;
    acc.placeReturnSum += row.payoutPlace1 ?? 0;
  } else if (!row.unranked && row.rank2 === row.boatNumber) {
    acc.placeReturnSum += row.payoutPlace2 ?? 0;
  }
}

// 平均ST・平均展示タイムの和と件数を積み、推移の点（series）を足す
function addStExhibition(acc, row) {
  const hasEx = row.exhibitionTime !== null;
  // フライングは異常値のため平均ST・STの推移から除く（今節タブ・ST考察と同じ扱い。BOA-576）
  const hasSt = row.startTiming != null && !row.isFlying;
  if (hasSt) {
    acc.stSum += Number(row.startTiming);
    acc.stN += 1;
  }
  if (hasEx) {
    acc.exSum += Number(row.exhibitionTime);
    acc.exN += 1;
  }
  if (hasEx || hasSt || row.isFlying) {
    acc.series.push(seriesPoint(row, hasEx, hasSt));
  }
}

// 推移のグラフの1点
function seriesPoint(row, hasEx, hasSt) {
  // historyは既にrace_id（YYYY-MM-DD-会場-レース番号）昇順でソート済みの
  // ため点の並び順は正しいが、対象期間が最大2年に及ぶため月日だけを表示
  // すると異なる年の同じ月日が同一ラベルに見えてしまう。年下2桁を含めて
  // 曖昧さを避ける（例: "25-05-12"）
  return {
    date: row.raceId.slice(2, 10),
    // グラフの横軸は走ごとに一意な値にする。日付だけだと同じ日の2走が1つの目盛りにまとまり、
    // 2走目に乗せても1走目のツールチップが出た（BOA-583 ファン評価2周目）
    raceKey: row.raceId,
    // ツールチップで同じ日の2走を見分けるため（BOA-583）
    venueCode: row.venueCode,
    raceNo: Number(row.raceId.slice(-2)),
    avg_exhibition_time: hasEx ? Number(row.exhibitionTime) : null,
    start_timing: hasSt ? Number(row.startTiming) : null,
    // フライングの走は平均・線からは外すが、どこで切ったかは印で残す（BOA-583）。
    // 0（スタートライン）の位置に置く
    flying: row.isFlying ? 0 : null,
    // ツールチップで F の深さ（F.01 か F.04 か）を出す
    flyingSt: row.isFlying ? (row.startTiming ?? null) : null,
  };
}

// レース一覧（BOA-159）の1行
function matchedRaceRow(row) {
  return {
    raceId: row.raceId,
    date: row.raceId.slice(0, 10),
    venueCode: row.venueCode,
    raceNo: Number(row.raceId.slice(-2)),
    raceTitle: row.raceTitle,
    raceGrade: row.raceGrade,
    raceStage: row.raceStage,
    boatNumber: row.boatNumber,
    startTiming: row.startTiming ?? null,
    isFlying: row.isFlying === true,
    entryCourse: row.entryCourse ?? null,
    startTimingRank: row.stRank ?? null,
    finishRank: row.unranked ? null : finishPositionOf(row),
    finishMark: row.finishMark ?? null,
    absent: row.finishMark === "欠",
    winningTechnique: row.winningTechnique,
    payoutWin: row.payoutWin,
  };
}

// 積んだ和と件数から率・平均を出す（返す object の鍵の順は元のまま）
function summarizeRacerStats(acc) {
  const { n, totals, stN, exN } = acc;
  return {
    n,
    win: totals.win,
    top2: totals.top2,
    top3: totals.top3,
    winRate: n > 0 ? totals.win / n : null,
    top2Rate: n > 0 ? totals.top2 / n : null,
    top3Rate: n > 0 ? totals.top3 / n : null,
    tech: acc.tech,
    avgSt: stN > 0 ? acc.stSum / stN : null,
    stN,
    avgExhibitionTime: exN > 0 ? acc.exSum / exN : null,
    exN,
    returnRate: toReturnRate(acc.returnSum, n),
    placeReturnRate: toReturnRate(acc.placeReturnSum, n),
    series: acc.series,
    matchedRaces: acc.matchedRaces,
  };
}
