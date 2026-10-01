/**
 * 的中判定ユーティリティ
 * ボートレースの各種買い方の的中判定と配当計算を一元管理
 *
 * ⚠️ 命名注意: DB列名と英語名が逆転している（歴史的経緯）
 *   trifecta / is_hit_trifecta / payout_trifecta → 実態: 3連複（順不同）
 *   trio / is_hit_trio / payout_trio             → 実態: 3連単（順序一致）
 */
import { isBetJudgeable, isJudgeable } from "../../src/utils/raceOutcome.js";

/**
 * 1件の予想（predictions の行）について、的中フラグと配当の列を作る（BOA-544）。
 * 結果取得時の判定（scrape-results.js judgeAndUpdateHits）・欠落の補完（fixMissingHitFlags）・
 * 既存行のバックフィル（backfill-refund-hit-flags.js）が共有する。DBトリガー
 * update_prediction_results()（マイグレーション110）も同じ規則で判定する。
 *
 * - 不成立（race_status='no_race'）: 全勝式と展開予測を判定対象外（NULL）にする
 * - 返還艇（refund_boats）を含む勝式: その勝式だけ判定対象外（NULL）。単勝・複勝は top_pick、
 *   3連複・3連単は top_pick〜top_3rd の3艇で見る。展開予測は1着が決まっているので判定する
 * - race_status が NULL（078以前・値が無い）: 今までどおり通常のレースとして判定する
 * - top_3rd を予想しないモデル（unified）: 3連複・3連単は NULL（BOA-191）
 * - 外れの配当は 0、判定対象外の配当は NULL
 *
 * @param {{top_pick: number, top_2nd?: number|null, top_3rd?: number|null, feature_contributions?: object|null}} pred
 * @param {{rank1: number, rank2: number, rank3: number, payout_win?: number|null, payout_place_1?: number|null,
 *   payout_place_2?: number|null, payout_trifecta?: number|null, payout_trio?: number|null,
 *   race_status?: string|null, refund_boats?: number[]|null}} result
 * @returns {{is_hit_win: boolean|null, is_hit_place: boolean|null, is_hit_trifecta: boolean|null,
 *   is_hit_trio: boolean|null, is_hit_turn: boolean|null, payout_win: number|null, payout_place: number|null,
 *   payout_trifecta: number|null, payout_trio: number|null}}
 */
export function buildPredictionHitUpdate(pred, result) {
  const top3 = [pred.top_pick, pred.top_2nd, pred.top_3rd];
  const judgeWin = isBetJudgeable(result, [pred.top_pick]);
  const judgeTrio = pred.top_3rd != null && isBetJudgeable(result, top3);

  const isHitWin = judgeWin ? isWinHit(pred.top_pick, result.rank1) : null;
  const isHitPlace = judgeWin
    ? isPlaceHit(pred.top_pick, result.rank1, result.rank2)
    : null;
  // ⚠️ trifecta=実態3連複・trio=実態3連単（ファイル冒頭の命名注意）
  const isHitTrifecta = judgeTrio
    ? isTrifectaHit(top3, result.rank1, result.rank2, result.rank3)
    : null;
  const isHitTrio = judgeTrio
    ? isTrioHit(top3, result.rank1, result.rank2, result.rank3)
    : null;

  // 展開予測（unified のみ。feature_contributions.turnPrediction が無い旧モデルは NULL。ADR 0013）
  const turnPatterns = pred.feature_contributions?.turnPrediction?.patterns;
  const isHitTurn =
    Array.isArray(turnPatterns) && turnPatterns.length > 0 && isJudgeable(result)
      ? isTurnHit(turnPatterns, result.rank1)
      : null;

  const payout = (judged, hit, amount) =>
    judged ? (hit ? (amount ?? 0) : 0) : null;
  return {
    is_hit_win: isHitWin,
    is_hit_place: isHitPlace,
    is_hit_trifecta: isHitTrifecta,
    is_hit_trio: isHitTrio,
    is_hit_turn: isHitTurn,
    payout_win: payout(judgeWin, isHitWin, result.payout_win),
    payout_place: judgeWin
      ? getPlacePayout(
          pred.top_pick,
          result.rank1,
          result.rank2,
          result.payout_place_1,
          result.payout_place_2,
        )
      : null,
    payout_trifecta: payout(judgeTrio, isHitTrifecta, result.payout_trifecta),
    payout_trio: payout(judgeTrio, isHitTrio, result.payout_trio),
  };
}

/**
 * 全買い方の的中判定と配当計算
 * @param {Object} prediction - { top_pick, top_2nd, top_3rd }
 * @param {Object} result - { rank1, rank2, rank3, payout_win, payout_place_1, payout_place_2, payout_trifecta, payout_trio }
 * @returns {Object} 的中フラグと配当
 */
export function calculateHits(prediction, result) {
  // 単勝: top_pickが1着と一致
  const isHitWin = prediction.top_pick === result.rank1;

  // 複勝: top_pickが2着以内（ボートレースのルール）
  const isHitPlace =
    prediction.top_pick === result.rank1 ||
    prediction.top_pick === result.rank2;

  // isHitTrifecta → 実態: 3連複的中（順不同で3艇一致）
  const predTop3 = [
    prediction.top_pick,
    prediction.top_2nd,
    prediction.top_3rd,
  ].sort((a, b) => a - b);
  const resultTop3 = [result.rank1, result.rank2, result.rank3].sort(
    (a, b) => a - b,
  );
  const isHitTrifecta =
    predTop3[0] === resultTop3[0] &&
    predTop3[1] === resultTop3[1] &&
    predTop3[2] === resultTop3[2];

  // isHitTrio → 実態: 3連単的中（完全順序一致）
  const isHitTrio =
    prediction.top_pick === result.rank1 &&
    prediction.top_2nd === result.rank2 &&
    prediction.top_3rd === result.rank3;

  // 配当計算
  const payoutWin = isHitWin ? result.payout_win || 0 : 0;

  let payoutPlace = 0;
  if (isHitPlace) {
    if (prediction.top_pick === result.rank1) {
      payoutPlace = result.payout_place_1 || 0;
    } else if (prediction.top_pick === result.rank2) {
      payoutPlace = result.payout_place_2 || 0;
    }
  }

  const payoutTrifecta = isHitTrifecta ? result.payout_trifecta || 0 : 0;
  const payoutTrio = isHitTrio ? result.payout_trio || 0 : 0;

  return {
    isHitWin,
    isHitPlace,
    isHitTrifecta,
    isHitTrio,
    payoutWin,
    payoutPlace,
    payoutTrifecta,
    payoutTrio,
  };
}

/**
 * 単勝的中判定
 * @param {number} topPick - 予想1着
 * @param {number} rank1 - 実際の1着
 * @returns {boolean}
 */
export function isWinHit(topPick, rank1) {
  return topPick === rank1;
}

/**
 * 複勝的中判定（2着以内）
 * @param {number} topPick - 予想1着
 * @param {number} rank1 - 実際の1着
 * @param {number} rank2 - 実際の2着
 * @returns {boolean}
 */
export function isPlaceHit(topPick, rank1, rank2) {
  return topPick === rank1 || topPick === rank2;
}

/**
 * 3着以内判定（複勝の的中判定ではなく、2連率・3連率集計での「3着以内か」の
 * 判定に使う。isWinHit/isPlaceHitと同じ艇番比較パターンの3着版）
 * @param {number} boatNumber - 対象の艇番
 * @param {number} rank1 - 実際の1着
 * @param {number} rank2 - 実際の2着
 * @param {number} rank3 - 実際の3着
 * @returns {boolean}
 */
export function isShowHit(boatNumber, rank1, rank2, rank3) {
  return isPlaceHit(boatNumber, rank1, rank2) || boatNumber === rank3;
}

/**
 * 実態: 3連複的中判定（順不同で3艇一致）
 * ⚠️ 関数名は trifecta だが、実態は3連複（DB列名に合わせた歴史的命名）
 * @param {number[]} predTop3 - 予想上位3艇 [1着予想, 2着予想, 3着予想]
 * @param {number} rank1 - 実際の1着
 * @param {number} rank2 - 実際の2着
 * @param {number} rank3 - 実際の3着
 * @returns {boolean}
 */
export function isTrifectaHit(predTop3, rank1, rank2, rank3) {
  if (!predTop3 || predTop3.length !== 3) return false;
  const sortedPred = [...predTop3].sort((a, b) => a - b);
  const sortedResult = [rank1, rank2, rank3].sort((a, b) => a - b);
  return (
    sortedPred[0] === sortedResult[0] &&
    sortedPred[1] === sortedResult[1] &&
    sortedPred[2] === sortedResult[2]
  );
}

/**
 * 実態: 3連単的中判定（順序一致で3艇一致）
 * ⚠️ 関数名は trio だが、実態は3連単（DB列名に合わせた歴史的命名）
 * @param {number[]} predTop3 - 予想上位3艇 [1着予想, 2着予想, 3着予想]
 * @param {number} rank1 - 実際の1着
 * @param {number} rank2 - 実際の2着
 * @param {number} rank3 - 実際の3着
 * @returns {boolean}
 */
export function isTrioHit(predTop3, rank1, rank2, rank3) {
  if (!predTop3 || predTop3.length !== 3) return false;
  return (
    predTop3[0] === rank1 && predTop3[1] === rank2 && predTop3[2] === rank3
  );
}

/**
 * 展開予測的中判定（unifiedモデル専用）
 * turnPrediction.patternsのいずれかのwinnerCourseが実際の1着コースと
 * 一致すれば的中（scripts/analysis/verify-turn-prediction-accuracy-v6.js、
 * scripts/daily/calculate-unified-model-accuracy.js、
 * src/components/race/RaceCard.jsxのisTurnHitと同じ定義。ADR 0013）
 * @param {Array<{winnerCourse: number}>} patterns - turnPrediction.patterns
 * @param {number} rank1 - 実際の1着コース
 * @returns {boolean}
 */
export function isTurnHit(patterns, rank1) {
  if (!Array.isArray(patterns) || patterns.length === 0) return false;
  return patterns.some((p) => p.winnerCourse === rank1);
}

/**
 * 複勝配当を取得
 * @param {number} topPick - 予想1着
 * @param {number} rank1 - 実際の1着
 * @param {number} rank2 - 実際の2着
 * @param {number} payoutPlace1 - 1着複勝配当
 * @param {number} payoutPlace2 - 2着複勝配当
 * @returns {number} 配当金額
 */
export function getPlacePayout(
  topPick,
  rank1,
  rank2,
  payoutPlace1,
  payoutPlace2,
) {
  if (topPick === rank1) {
    return payoutPlace1 || 0;
  } else if (topPick === rank2) {
    return payoutPlace2 || 0;
  }
  return 0;
}
