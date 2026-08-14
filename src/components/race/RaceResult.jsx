/**
 * RaceResult - レース結果表示コンポーネント
 */
import { useTranslation } from "react-i18next";
import TurnPatternList from "./TurnPatternList";

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
  // 複勝2位候補（unified.top2nd）の艇番。DataRaceTableの複勝予想行では
  // ◎(1位)/○(2位)の両方を予想として提示しているため、検証も両方独立して行う
  // （2026-08-14: 1位候補のみ検証していたのをユーザー指摘で修正）
  const top2ndNumber =
    Array.isArray(prediction.top3) && prediction.top3.length > 1
      ? prediction.top3[1]
      : null;

  // 的中判定（BOA-173: unifiedモデルはレース単位で二値判定できる複勝予想・
  // 展開予測の2種類のみを的中対象とする。単勝的中・3連複的中・3連単的中は
  // AIが予想していない賭け方のため廃止した）
  const checkPlaceHit = (boatNumber) => {
    if (boatNumber == null) return null;
    if (boatNumber === result.rank1) return 1;
    if (boatNumber === result.rank2) return 2;
    return null;
  };
  const getPlacePayout = (boatNumber) =>
    result.payouts?.place?.[String(boatNumber)];

  const turnPatterns = prediction.turnPrediction?.patterns;
  const hasTurnPrediction =
    Array.isArray(turnPatterns) && turnPatterns.length > 0;

  // イン崩れ判定（FR3の会場内パーセンタイル、0.7以上をVolatilityDisplayと同じ閾値で「高」とみなす）
  const showInKuzure =
    prediction.volatilityPercentile >= 0.7 && result.winningTechnique;
  const isInKuzure = showInKuzure && result.winningTechnique !== "逃げ";

  // 複勝1位・2位の2予想を配列でまとめてレンダリング
  const placePicks = [
    { rankLabel: 1, number: topPick.number },
    ...(top2ndNumber != null ? [{ rankLabel: 2, number: top2ndNumber }] : []),
  ];

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

      {/* 複勝予想の検証と展開予測の検証は完全に独立したロジックのため、
          1つの注記で済ませず別セクションとして分けて見せる
          （2026-08-14: 「なぜ矛盾するのか」を文章の注記でなく構造で伝える） */}
      <div className="result-verify-section">
        <h5 className="result-verify-title">{t("result.placeSectionTitle")}</h5>
        {placePicks.map((pick) => {
          const position = checkPlaceHit(pick.number);
          const isHit = position !== null;
          const payout = isHit ? getPlacePayout(pick.number) : null;
          return (
            <div className="accuracy-check" key={pick.rankLabel}>
              <div className="check-item">
                <span className="prediction-note">
                  {t("result.placePredicted", {
                    rank: pick.rankLabel,
                    number: pick.number,
                  })}
                </span>
                {isHit ? (
                  <div className="hit">
                    {t("result.placeHit", { position })}
                    {payout && (
                      <span className="payout">
                        {t("result.payout", { amount: payout })}
                      </span>
                    )}
                  </div>
                ) : (
                  <div className="miss">{t("result.placeMiss")}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* 展開予測: 実測的中率（約80%）は「上位予想のいずれかが的中すれば的中」という
          定義のため、単一の断定予想ではなく確率付きランキングとして正直に見せる */}
      {hasTurnPrediction && (
        <div className="result-verify-section">
          <h5 className="result-verify-title">
            {t("result.turnSectionTitle")}
          </h5>
          <TurnPatternList
            patterns={turnPatterns}
            actualWinner={result.rank1}
          />
        </div>
      )}
    </div>
  );
}

export default RaceResult;
