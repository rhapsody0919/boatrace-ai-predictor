/**
 * RaceCard の表示用の値を作る純関数（RaceCard.jsx から移した。出力は変えない）
 */

import { getRaceStatus, RACE_STATUS } from "../../utils/raceStatus";
import { isRaceCancelled } from "../../utils/raceCancellation";
import {
  RACE_OUTCOME,
  TURN_JUDGEMENT,
  getRaceOutcomeState,
  judgeTurnPrediction,
} from "../../utils/raceOutcome";
import { getDeadlineStatus } from "../../utils/raceDeadlineStatus";
import { isInCautionEnabled } from "../../config/featureFlags";

/** 注意度の札から押したときは AI予想タブ（注意度のカード）を開く（2026-10-18 オーナー決定） */
export const aiTabHref = (href) =>
  `${href}${href.includes("?") ? "&" : "?"}tab=aiPrediction`;

// フォールバック値（percentile=0.5）は「実測ではない」ため、high/lowの
// 断定バッジを出さない（VolatilityDisplay.jsxの「データ収集中」表示と同じ方針）
const volatilityFlags = (volatility) => ({
  isHighVolatility: !volatility?.isFallback && volatility?.level === "high",
  isLowVolatility: !volatility?.isFallback && volatility?.level === "low",
});

const cautionLineColor = (inCaution) => {
  if (inCaution?.level === "high") return "var(--color-warning-dark-text)";
  if (inCaution?.level === "low") return "var(--color-success-text)";
  return null;
};

// 的中判定（unifiedモデル: 展開予測的中のみ。複勝予想は表示しない方針
// に統一、ADR 0013・BOA-174/175/178参照）
// 展開予測の的中判定は集計指標（実測的中率約80%）と同じロジック（上位パターンの winnerCourse の
// いずれかが1着と一致すれば的中）。判定は TurnPatternList・HitRaces と同じ関数を通す（BOA-543）。
// 不成立は的中・外れを出さず「不成立」だけ、一部返還は的中・外れの横に枠線の「返還あり」
const outcomeFlags = (racePrediction, inCautionEnabled) => {
  const unified = racePrediction?.unified;
  const result = racePrediction?.result;
  const isFinished = result?.finished;
  const outcome = isFinished ? getRaceOutcomeState(result) : null;
  const isNoRace = outcome === RACE_OUTCOME.NO_RACE;
  const isPartialRefund = outcome === RACE_OUTCOME.PARTIAL_REFUND;
  const turnJudgement =
    isFinished && unified && !isNoRace
      ? judgeTurnPrediction(unified.turnPrediction?.patterns, result).status
      : null;
  return {
    isNoRace,
    isPartialRefund,
    // 予想パターンが無いレースは従来どおり「外れ」（isTurnHit=false と同じ扱い）
    showHitMissBadge:
      !inCautionEnabled && isFinished && Boolean(unified) && !isNoRace,
    isTurnHit: turnJudgement === TURN_JUDGEMENT.HIT,
  };
};

export function deriveRaceCardState(race, nowHHMM) {
  const racePrediction = race.rawData;
  const result = racePrediction?.result;
  const status = getRaceStatus({ startTime: race.startTime, result }, nowHHMM);
  // 中止・順延の確定検知（BOA-254）。暫定検知（"tentative"）はまだ誤検出の
  // 可能性があるため、既存の受付中/結果反映待ち表示のまま変更しない
  const isCancelled = isRaceCancelled(racePrediction);
  // 締切ステータスのライブ表示（BOA-243）。中止確定レースは既存の中止表示を
  // 優先し、この新バッジ・カウントダウンは出さない（FR3）
  const deadlineStatus = isCancelled
    ? null
    : getDeadlineStatus(race.id, race.startTime, new Date());
  const { isHighVolatility, isLowVolatility } = volatilityFlags(
    racePrediction?.volatility,
  );
  // BOA-822（機能フラグの側）: 旧指数の札と展開予測の的中/外れをやめ、イン崩れ注意度の段の札と割合にする。
  // 左の色線は崩れやすい・堅めだけ（真ん中の段は札の枠線だけ。承認モック mock/2-lists-375.png）
  const inCautionEnabled = isInCautionEnabled();
  // 中止確定のレースは段の札・色線を出さない（ホームの上位と同じく外す。PR #1602 レビュー）
  const inCaution =
    inCautionEnabled && !isCancelled
      ? (racePrediction?.inCaution ?? null)
      : null;
  return {
    result,
    isAwaitingResult: status === RACE_STATUS.AWAITING_RESULT,
    isCancelled,
    deadlineStatus,
    // 締切前(UPCOMING)以外は見た目でも一目で分かるよう、トップバー・見出し・
    // ボタンをグレーアウトする（バッジの発色は維持し、的中/外れ・結果反映待ちの
    // 視認性を落とさない）
    isPastDeadline: status !== RACE_STATUS.UPCOMING,
    isHighVolatility,
    inCaution,
    inCautionLine: cautionLineColor(inCaution),
    showBadge: !inCautionEnabled && (isHighVolatility || isLowVolatility),
    ...outcomeFlags(racePrediction, inCautionEnabled),
  };
}
