/**
 * RaceResult - レース結果表示コンポーネント
 */

function RaceResult({ prediction, volatility }) {
  const result = prediction.result

  if (!result || !result.finished) {
    return null
  }

  const topPick = prediction.topPick
  const top3 = prediction.top3

  // 的中判定
  const isWinHit = topPick.number === result.rank1
  const isPlaceHit = topPick.number === result.rank1 || topPick.number === result.rank2
  const is3FukuHit = top3 && top3.includes(result.rank1) && top3.includes(result.rank2) && top3.includes(result.rank3)
  const is3TanHit = top3 && top3[0] === result.rank1 && top3[1] === result.rank2 && top3[2] === result.rank3

  // 配当取得ヘルパー
  const getWinPayout = () => result.payouts?.win?.[String(topPick.number)]
  const getPlacePayout = () => result.payouts?.place?.[String(topPick.number)]
  const getTrifectaPayout = () => {
    const sorted = [result.rank1, result.rank2, result.rank3].sort((a, b) => a - b)
    const key = sorted.join('-')
    return result.payouts?.trifecta?.[key]
  }
  const getTrioPayout = () => {
    const key = `${result.rank1}-${result.rank2}-${result.rank3}`
    return result.payouts?.trio?.[key]
  }

  return (
    <div className="race-result">
      <h4>🏁 レース結果</h4>

      <div className="result-podium">
        <div className="podium-item first">
          <div className="rank">1着</div>
          <div className="boat-number">{result.rank1}</div>
        </div>
        <div className="podium-item second">
          <div className="rank">2着</div>
          <div className="boat-number">{result.rank2}</div>
        </div>
        <div className="podium-item third">
          <div className="rank">3着</div>
          <div className="boat-number">{result.rank3}</div>
        </div>
      </div>

      <div className="accuracy-check">
        {/* 単勝 */}
        <div className="check-item">
          {isWinHit ? (
            <div className="hit">
              ✅ 単勝的中！
              {getWinPayout() && (
                <span style={{ marginLeft: '0.5rem', color: '#2196f3', fontWeight: 'bold' }}>
                  配当: {getWinPayout()}円
                </span>
              )}
            </div>
          ) : (
            <div className="miss">❌ 単勝不的中（予測: {topPick.number}号艇 → 実際: {result.rank1}号艇）</div>
          )}
        </div>

        {/* 複勝 */}
        <div className="check-item">
          {isPlaceHit ? (
            <div className="hit">
              ✅ 複勝的中！
              {getPlacePayout() && (
                <span style={{ marginLeft: '0.5rem', color: '#2196f3', fontWeight: 'bold' }}>
                  配当: {getPlacePayout()}円
                </span>
              )}
            </div>
          ) : (
            <div className="miss">❌ 複勝不的中</div>
          )}
        </div>

        {/* 3連複 */}
        <div className="check-item">
          {is3FukuHit ? (
            <div className="hit">
              ✅ 3連複的中！
              {getTrifectaPayout() && (
                <span style={{ marginLeft: '0.5rem', color: '#2196f3', fontWeight: 'bold' }}>
                  配当: {getTrifectaPayout()}円
                </span>
              )}
            </div>
          ) : (
            <div className="miss">❌ 3連複不的中</div>
          )}
        </div>

        {/* 3連単 */}
        <div className="check-item">
          {is3TanHit ? (
            <div className="hit">
              ✅ 3連単的中！
              {getTrioPayout() && (
                <span style={{ marginLeft: '0.5rem', color: '#2196f3', fontWeight: 'bold' }}>
                  配当: {getTrioPayout()}円
                </span>
              )}
            </div>
          ) : (
            <div className="miss">❌ 3連単不的中</div>
          )}
        </div>

        {/* イン崩れ確率高レースの結果 */}
        {volatility?.level === 'high' && result.winningTechnique && (
          <div className="check-item">
            {result.winningTechnique !== 'nige' ? (
              <div className="hit">🌊 イン崩れ</div>
            ) : (
              <div className="miss">🛡️ イン逃げ切り</div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default RaceResult
