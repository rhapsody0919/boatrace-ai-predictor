/**
 * RaceResult - レース結果表示コンポーネント
 */

function RaceResult({ prediction, volatility }) {
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

  // イン崩れ判定
  const showInKuzure = volatility?.level === "high" && result.winningTechnique;
  const isInKuzure = showInKuzure && result.winningTechnique !== "逃げ";

  return (
    <div className="race-result">
      <h4>🏁 レース結果</h4>

      <div className="result-podium">
        <div className="podium-item first">
          <span className="rank">1着</span>
          <span className="boat-number">{result.rank1}</span>
        </div>
        <div className="podium-item second">
          <span className="rank">2着</span>
          <span className="boat-number">{result.rank2}</span>
        </div>
        <div className="podium-item third">
          <span className="rank">3着</span>
          <span className="boat-number">{result.rank3}</span>
        </div>
      </div>

      {/* イン崩れ予測 → 結果の対応表示 */}
      {showInKuzure && (
        <div className="in-kuzure-result">
          <span className="in-kuzure-prediction">イン崩れ確率高</span>
          <span className="in-kuzure-arrow">→</span>
          <span
            className={`in-kuzure-outcome ${isInKuzure ? "outcome-hit" : "outcome-miss"}`}
          >
            {isInKuzure ? "🌊 イン崩れ的中！" : "❌ イン逃げ切り（外れ）"}
          </span>
        </div>
      )}

      <div className="accuracy-check">
        <div className="check-item">
          {isWinHit ? (
            <div className="hit">
              ✅ 単勝的中！
              {getWinPayout() && (
                <span className="payout">配当: {getWinPayout()}円</span>
              )}
            </div>
          ) : (
            <div className="miss">
              ❌ 単勝（{topPick.number}→{result.rank1}）
            </div>
          )}
        </div>

        <div className="check-item">
          {isPlaceHit ? (
            <div className="hit">
              ✅ 複勝的中！
              {getPlacePayout() && (
                <span className="payout">配当: {getPlacePayout()}円</span>
              )}
            </div>
          ) : (
            <div className="miss">❌ 複勝不的中</div>
          )}
        </div>

        <div className="check-item">
          {is3FukuHit ? (
            <div className="hit">
              ✅ 3連複的中！
              {getTrifectaPayout() && (
                <span className="payout">配当: {getTrifectaPayout()}円</span>
              )}
            </div>
          ) : (
            <div className="miss">❌ 3連複不的中</div>
          )}
        </div>

        <div className="check-item">
          {is3TanHit ? (
            <div className="hit">
              ✅ 3連単的中！
              {getTrioPayout() && (
                <span className="payout">配当: {getTrioPayout()}円</span>
              )}
            </div>
          ) : (
            <div className="miss">❌ 3連単不的中</div>
          )}
        </div>
      </div>
    </div>
  );
}

export default RaceResult;
