/**
 * RaceResult - レース結果表示コンポーネント
 */
import { useTranslation } from "react-i18next";
import TurnPatternList from "./TurnPatternList";
import { getVolatilityLevel } from "../../utils/volatilityLevel";

function RaceResult({ prediction }) {
  const { t } = useTranslation();

  if (!prediction || !prediction.result) {
    return null;
  }

  const result = prediction.result;

  if (!result.finished) {
    return null;
  }

  // 的中判定（BOA-174/175/178: unifiedモデルの的中は展開予測的中のみを
  // 対象とする。複勝予想の検証は表示しない方針に統一、ADR 0013参照）
  const turnPatterns = prediction.turnPrediction?.patterns;
  const hasTurnPrediction =
    Array.isArray(turnPatterns) && turnPatterns.length > 0;

  // イン崩れ指数は確率的な傾向予測のため二値的中判定は行わない（下記コメント参照）。
  // 予測レベルと実際の結果を判定なしで併記するのみに留める
  const volatilityLevel = prediction.volatilityPercentileIsFallback
    ? null
    : getVolatilityLevel(prediction.volatilityPercentile);
  const showVolatilityOutcome =
    volatilityLevel === "high" || volatilityLevel === "low";
  const isUpset = result.rank1 !== 1;

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

      {/* イン崩れ指数は「このレースは荒れやすい/堅い」という確率的な傾向予測であり、
          複勝予想・展開予測のような単発レースの二値的中判定にはなじまない
          （1レースが堅く決まっても「高リスク」判定が誤りだったとは言えない）。
          2026-08-14: 従来ここに表示していた単発レースの的中/不的中判定を削除。
          精度検証は集計ベース（BOA-177、着手待ち）に委ねる方針で統一した。
          2026-08-29: 判定なしの事実併記（予測レベル→実際の結果）のみ追加 */}
      {showVolatilityOutcome && (
        <div className="result-verify-section">
          <h5 className="result-verify-title">
            {t("result.volatilitySectionTitle")}
          </h5>
          <p className="result-volatility-outcome">
            {t("result.volatilityPredicted", {
              label: t(
                `volatility.level${volatilityLevel === "high" ? "High" : "Low"}`,
              ),
            })}
            {" / "}
            {isUpset
              ? t("result.volatilityOutcomeUpset", { winner: result.rank1 })
              : t("result.volatilityOutcomeFavorite")}
          </p>
        </div>
      )}

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
