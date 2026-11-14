/**
 * PredictionPanel の共有文（SNSシェアのタイトル）を組む
 */
import {
  generateInCautionShareText,
  generatePredictionShareText,
  generateResultShareText,
} from "../../utils/share";

function resultShareTitle(base, c) {
  return c.inCautionShare
    ? null
    : generateResultShareText(
        {
          ...base,
          patterns: c.prediction?.turnPrediction?.patterns,
          result: c.prediction?.result,
          winnerEntryCourse: c.winnerCourse?.course ?? null,
        },
        c.t,
      );
}

// BOA-822（機能フラグの側）: 発走前は注意度の文面（AI予想タブに本命・推奨・展開予測が出ないため）
function preRaceShareTitle(base, c) {
  return c.inCautionShare
    ? generateInCautionShareText(
        {
          ...base,
          isCancelled: c.isCancelled,
          inCaution: c.prediction?.inCaution ?? null,
        },
        c.t,
      )
    : generatePredictionShareText(
        {
          ...base,
          isCancelled: c.isCancelled,
          prediction: {
            topPick: c.prediction.topPick?.number,
            top3: c.prediction.top3 || [],
          },
        },
        "unified",
        c.t,
      );
}

/**
 * 共有文（BOA-754）。結果確定後は、発走前の予想の文面（推奨の買い目・「的中率が上がって嬉しい」）を
 * 共有させない。展開予測の候補のどれかが1着なら的中の文面、どれも1着でなければボタンを出さない
 * BOA-822（機能フラグの側、task 26）: 確定後の共有文は展開予測の的中の文面だけなので、展開予測を外す側では出さない
 */
export function buildShareTitle(c) {
  const base = {
    venue: c.venueName || c.t("panel.unknownVenue"),
    raceNo: c.selectedRace?.raceNumber || "?",
    date: c.raceDate,
  };
  return c.isFinished ? resultShareTitle(base, c) : preRaceShareTitle(base, c);
}
