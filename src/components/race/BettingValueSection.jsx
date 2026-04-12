/**
 * BettingValueSection - 配当妙味セクション
 * 選択中モデルの3連単・3連複の買い目とオッズを表示する。
 */
import { useMemo } from "react";
import { BOAT_COLORS } from "../../utils/colors";
import "./BettingValueSection.css";

const MODEL_SUFFIX = {
  "safe-bet": "SafeBet",
  standard: "Standard",
  "upset-focus": "UpsetFocus",
};

function BoatBadge({ number }) {
  const colors = BOAT_COLORS[number] || BOAT_COLORS[1];
  return (
    <span
      className="bvs-boat-badge"
      style={{ backgroundColor: colors.bg, color: colors.text }}
    >
      {number}
    </span>
  );
}

function BetCombo({ combo, separator }) {
  if (!combo) return <span className="bvs-combo-na">—</span>;
  const boats = combo.split("-").map(Number);
  return (
    <span className="bvs-combo">
      {boats.map((b, i) => (
        <span key={i} style={{ display: "contents" }}>
          {i > 0 && <span className="bvs-combo-sep">{separator}</span>}
          <BoatBadge number={b} />
        </span>
      ))}
    </span>
  );
}

function formatUpdatedAt(iso) {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleTimeString("ja-JP", {
      timeZone: "Asia/Tokyo",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return null;
  }
}

function BettingValueSection({ prediction, selectedModel }) {
  const suffix = MODEL_SUFFIX[selectedModel];

  const oddsData = useMemo(() => {
    const po = prediction?.predictionOdds;
    if (!po || !suffix) return null;

    const trifectaPred = po[`trifectaPred${suffix}`];
    const trifectaOdds = po[`trifectaOdds${suffix}`];
    const trioPred = po[`trioPred${suffix}`];
    const trioOdds = po[`trioOdds${suffix}`];

    if (!trifectaPred && !trioPred) return null;

    return {
      trifectaPred,
      trifectaOdds,
      trioPred,
      trioOdds,
      updatedAt: po.updatedAt,
    };
  }, [prediction, suffix]);

  if (!oddsData) return null;

  const updatedAtStr = formatUpdatedAt(oddsData.updatedAt);

  return (
    <div className="bvs-section">
      <div className="bvs-header">
        <h4>買い目・オッズ</h4>
        {updatedAtStr && (
          <span className="bvs-updated">取得: {updatedAtStr}</span>
        )}
      </div>

      <div className="bvs-cards">
        {/* 3連単 */}
        <div className="bvs-card">
          <div className="bvs-card-label">3連単</div>
          <div className="bvs-card-combo">
            <BetCombo combo={oddsData.trifectaPred} separator="→" />
          </div>
          <div className="bvs-odds">
            {oddsData.trifectaOdds != null ? (
              <>
                <strong>{oddsData.trifectaOdds.toFixed(1)}</strong>
                <span className="bvs-unit">倍</span>
              </>
            ) : (
              <span className="bvs-na">発売前</span>
            )}
          </div>
        </div>

        {/* 3連複 */}
        <div className="bvs-card">
          <div className="bvs-card-label">3連複</div>
          <div className="bvs-card-combo">
            <BetCombo combo={oddsData.trioPred} separator="=" />
          </div>
          <div className="bvs-odds">
            {oddsData.trioOdds != null ? (
              <>
                <strong>{oddsData.trioOdds.toFixed(1)}</strong>
                <span className="bvs-unit">倍</span>
              </>
            ) : (
              <span className="bvs-na">発売前</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default BettingValueSection;
