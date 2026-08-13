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
  const top3 = prediction.top3;

  // 的中判定
  const isWinHit = topPick.number === result.rank1;
  const isPlaceHit =
    topPick.number === result.rank1 || topPick.number === result.rank2;
  const is3FukuHit =
    top3 &&
    top3.includes(result.rank1) &&
    top3.includes(result.rank2) &&
    top3.includes(result.rank3);
  const is3TanHit =
    top3 &&
    top3[0] === result.rank1 &&
    top3[1] === result.rank2 &&
    top3[2] === result.rank3;

  // 配当取得ヘルパー
  const getWinPayout = () => result.payouts?.win?.[String(topPick.number)];
  const getPlacePayout = () => result.payouts?.place?.[String(topPick.number)];
  const getTrifectaPayout = () => {
    const sorted = [result.rank1, result.rank2, result.rank3].sort(
      (a, b) => a - b,
    );
    return result.payouts?.trifecta?.[sorted.join("-")];
  };
  const getTrioPayout = () =>
    result.payouts?.trio?.[`${result.rank1}-${result.rank2}-${result.rank3}`];

  // イン崩れ判定（FR3の会場内パーセンタイル、0.7以上をVolatilityDisplayと同じ閾値で「高」とみなす）
  const showInKuzure =
    prediction.volatilityPercentile >= 0.7 && result.winningTechnique;
  const isInKuzure = showInKuzure && result.winningTechnique !== "逃げ";
  // unifiedモデルはtopPick/top2ndの2艇のみ（3連複・3連単の的中判定には使えない、旧モデル互換のみ対象）
  const hasFullTop3 = top3?.length === 3;

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
          {isWinHit ? (
            <div className="hit">
              {t("result.winHit")}
              {getWinPayout() && (
                <span className="payout">
                  {t("result.payout", { amount: getWinPayout() })}
                </span>
              )}
            </div>
          ) : (
            <div className="miss">
              {t("result.winMiss", {
                picked: topPick.number,
                actual: result.rank1,
              })}
            </div>
          )}
        </div>

        <div className="check-item">
          {isPlaceHit ? (
            <div className="hit">
              {t("result.placeHit")}
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

        {hasFullTop3 && (
          <div className="check-item">
            {is3FukuHit ? (
              <div className="hit">
                {t("result.trifectaHit")}
                {getTrifectaPayout() && (
                  <span className="payout">
                    {t("result.payout", { amount: getTrifectaPayout() })}
                  </span>
                )}
              </div>
            ) : (
              <div className="miss">{t("result.trifectaMiss")}</div>
            )}
          </div>
        )}

        {hasFullTop3 && (
          <div className="check-item">
            {is3TanHit ? (
              <div className="hit">
                {t("result.trioHit")}
                {getTrioPayout() && (
                  <span className="payout">
                    {t("result.payout", { amount: getTrioPayout() })}
                  </span>
                )}
              </div>
            ) : (
              <div className="miss">{t("result.trioMiss")}</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default RaceResult;
