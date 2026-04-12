/**
 * OddsDisplay - 予測買い目の3連単・3連複オッズ表示
 *
 * PredictionFlash 内で選択中モデルの配当妙味を表示する。
 */
import "./OddsDisplay.css";

// モデルキー（kebab）→ predictionOdds フィールドのサフィックスへのマッピング
const MODEL_SUFFIX = {
  "safe-bet": "SafeBet",
  standard: "Standard",
  "upset-focus": "UpsetFocus",
};

/**
 * 配当妙味バッジのラベルとクラスを返す
 * 目安: 3連単 20倍以上 = 高配当、10〜20倍 = 中配当、10倍未満 = 低配当
 */
function getTrifectaValueLevel(odds) {
  if (odds == null) return null;
  if (odds >= 50) return { label: "高", className: "odds-value--high" };
  if (odds >= 20) return { label: "中高", className: "odds-value--mid-high" };
  if (odds >= 10) return { label: "中", className: "odds-value--mid" };
  return { label: "低", className: "odds-value--low" };
}

function OddsDisplay({ predictionOdds, selectedModel }) {
  const suffix = MODEL_SUFFIX[selectedModel];
  if (!suffix || !predictionOdds) return null;

  const trifectaPred = predictionOdds[`trifectaPred${suffix}`];
  const trifectaOdds = predictionOdds[`trifectaOdds${suffix}`];
  const trioPred = predictionOdds[`trioPred${suffix}`];
  const trioOdds = predictionOdds[`trioOdds${suffix}`];

  // どちらもデータなければ表示しない
  if (!trifectaPred && !trioPred) return null;

  const valueLevel = getTrifectaValueLevel(trifectaOdds);

  return (
    <div className="odds-display">
      <div className="odds-display__title">配当妙味</div>
      <div className="odds-display__grid">
        {/* 3連単 */}
        <div className="odds-display__item">
          <span className="odds-display__label">3連単</span>
          <span className="odds-display__combo">
            {trifectaPred ? trifectaPred.split("-").join(" → ") : "—"}
          </span>
          <span className="odds-display__value">
            {trifectaOdds != null ? (
              <>
                <strong>{trifectaOdds.toFixed(1)}</strong>
                <span className="odds-display__unit">倍</span>
                {valueLevel && (
                  <span
                    className={`odds-display__badge ${valueLevel.className}`}
                  >
                    {valueLevel.label}
                  </span>
                )}
              </>
            ) : (
              <span className="odds-display__unavailable">発売前</span>
            )}
          </span>
        </div>

        {/* 3連複 */}
        <div className="odds-display__item">
          <span className="odds-display__label">3連複</span>
          <span className="odds-display__combo">
            {trioPred ? trioPred.split("-").join(" = ") : "—"}
          </span>
          <span className="odds-display__value">
            {trioOdds != null ? (
              <>
                <strong>{trioOdds.toFixed(1)}</strong>
                <span className="odds-display__unit">倍</span>
              </>
            ) : (
              <span className="odds-display__unavailable">発売前</span>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}

export default OddsDisplay;
