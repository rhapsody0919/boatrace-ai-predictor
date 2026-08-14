/**
 * RaceResult - レース結果表示コンポーネント
 */
import { useTranslation } from "react-i18next";

function RaceResult({ prediction }) {
  const { t } = useTranslation();

  if (!prediction || !prediction.result || !prediction.topPick) {
    return null;
  }

  const result = prediction.result;

  if (!result.finished) {
    return null;
  }

  const topPick = prediction.topPick;

  // 的中判定（BOA-173: unifiedモデルはレース単位で二値判定できる複勝予想・
  // 展開予測の2種類のみを的中対象とする。単勝的中・3連複的中・3連単的中は
  // AIが予想していない賭け方のため廃止した）
  const placeFinishPosition =
    topPick.number === result.rank1
      ? 1
      : topPick.number === result.rank2
        ? 2
        : null;
  const isPlaceHit = placeFinishPosition !== null;

  const turnPatterns = prediction.turnPrediction?.patterns;
  const hasTurnPrediction =
    Array.isArray(turnPatterns) && turnPatterns.length > 0;
  const isTurnHit =
    hasTurnPrediction &&
    turnPatterns.some((p) => p.winnerCourse === result.rank1);
  // 事前予想が何だったのかを結果と一緒に示す（2026-08-14: 予想を伏せたまま
  // 「的中！」とだけ言われても検証できないというユーザー指摘への対応）
  const predictedTurnCourses = hasTurnPrediction
    ? [...new Set(turnPatterns.map((p) => p.winnerCourse))]
    : [];

  // 配当取得ヘルパー
  const getPlacePayout = () => result.payouts?.place?.[String(topPick.number)];

  // イン崩れ判定（FR3の会場内パーセンタイル、0.7以上をVolatilityDisplayと同じ閾値で「高」とみなす）
  const showInKuzure =
    prediction.volatilityPercentile >= 0.7 && result.winningTechnique;
  const isInKuzure = showInKuzure && result.winningTechnique !== "逃げ";

  return (
    <div className="race-result">
      <h4>🏁 {t("result.title")}</h4>

      <div className="result-podium">
        <div className="podium-item first">
          <span className="rank">{t("result.rank1")}</span>
          <span className="boat-number">{result.rank1}</span>
        </div>
        <div className="podium-item second">
          <span className="rank">{t("result.rank2")}</span>
          <span className="boat-number">{result.rank2}</span>
        </div>
        <div className="podium-item third">
          <span className="rank">{t("result.rank3")}</span>
          <span className="boat-number">{result.rank3}</span>
        </div>
      </div>

      {/* イン崩れ予測 → 結果の対応表示 */}
      {showInKuzure && (
        <div className="in-kuzure-result">
          <span className="in-kuzure-prediction">
            {t("result.inKuzureHigh")}
          </span>
          <span className="in-kuzure-arrow">→</span>
          <span
            className={`in-kuzure-outcome ${isInKuzure ? "outcome-hit" : "outcome-miss"}`}
          >
            {isInKuzure ? t("result.inKuzureHit") : t("result.inKuzureMiss")}
          </span>
        </div>
      )}

      <div className="accuracy-check">
        <div className="check-item">
          <span className="prediction-note">
            {t("result.placePredicted", { number: topPick.number })}
          </span>
          {isPlaceHit ? (
            <div className="hit">
              {t("result.placeHit", { position: placeFinishPosition })}
              {getPlacePayout() && (
                <span className="payout">
                  {t("result.payout", { amount: getPlacePayout() })}
                </span>
              )}
            </div>
          ) : (
            <div className="miss">{t("result.placeMiss")}</div>
          )}
        </div>

        {hasTurnPrediction && (
          <div className="check-item">
            <span className="prediction-note">
              {t("result.turnPredicted", {
                numbers: predictedTurnCourses.join(
                  t("review.courseListSeparator"),
                ),
              })}
            </span>
            {isTurnHit ? (
              <div className="hit">{t("result.turnHit")}</div>
            ) : (
              <div className="miss">
                {t("result.turnMiss", { winnerNumber: result.rank1 })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default RaceResult;
