/**
 * BettingValueSection - 配当妙味セクション
 *
 * AI推定確率 vs 市場確率（= 0.75 ÷ オッズ）を比較し、
 * AIが市場より高く評価していれば「割安（妙味あり）」と表示する。
 *
 * AI確率の算出:
 *   3連単: pattern.probability × secondPlace[c2] × thirdPlace[c3]
 *   3連複: pattern.probability × (secondPlace[c2]×thirdPlace[c3] + secondPlace[c3]×thirdPlace[c2])
 *
 * 市場確率の算出:
 *   市場確率 = 0.75 ÷ オッズ（控除率25%を考慮した逆算）
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

/** 3連単のAI推定確率 */
function calcTrifectaProb(pattern, combo) {
  if (!pattern || !combo) return null;
  const boats = combo.split("-").map(Number);
  if (boats.length !== 3) return null;
  const [, c2, c3] = boats;
  const p =
    (pattern.probability ?? 0) *
    (pattern.secondPlace?.[c2] ?? 0) *
    (pattern.thirdPlace?.[c3] ?? 0);
  return p > 0 ? p : null;
}

/** 3連複のAI推定確率（c2・c3の両順序を合算） */
function calcTrioProb(pattern, combo) {
  if (!pattern || !combo) return null;
  const boats = combo.split("-").map(Number);
  if (boats.length !== 3) return null;
  const [, c2, c3] = boats;
  const p_c2c3 =
    (pattern.secondPlace?.[c2] ?? 0) * (pattern.thirdPlace?.[c3] ?? 0);
  const p_c3c2 =
    (pattern.secondPlace?.[c3] ?? 0) * (pattern.thirdPlace?.[c2] ?? 0);
  const p = (pattern.probability ?? 0) * (p_c2c3 + p_c3c2);
  return p > 0 ? p : null;
}

/** 市場確率 = 0.75 ÷ オッズ（控除率25%考慮） */
function marketProb(odds) {
  if (odds == null || odds <= 0) return null;
  return 0.75 / odds;
}

/**
 * 1枚のカード（3連単 or 3連複）
 */
function BetCard({ label, separator, combo, odds, aiProb }) {
  const mProb = marketProb(odds);
  const isValue = aiProb != null && mProb != null && aiProb > mProb;
  const hasOdds = odds != null;

  return (
    <div className={`bvs-card ${isValue ? "bvs-card--value" : ""}`}>
      <div className="bvs-card-label">{label}</div>
      <div className="bvs-card-combo">
        <BetCombo combo={combo} separator={separator} />
      </div>

      <div className="bvs-card-stats">
        {/* オッズ */}
        <div className="bvs-stat">
          <span className="bvs-stat-label">オッズ</span>
          <span className="bvs-stat-value">
            {hasOdds ? (
              <>
                <strong>{odds.toFixed(1)}</strong>
                <span className="bvs-unit">倍</span>
              </>
            ) : (
              <span className="bvs-na">発売前</span>
            )}
          </span>
        </div>

        {/* AI確率 */}
        {aiProb != null && (
          <div className="bvs-stat">
            <span className="bvs-stat-label">AI確率</span>
            <span className="bvs-stat-value">
              <strong>{(aiProb * 100).toFixed(1)}</strong>
              <span className="bvs-unit">%</span>
            </span>
          </div>
        )}

        {/* 市場確率（計算式つき） */}
        {mProb != null && (
          <div className="bvs-stat bvs-stat--market">
            <span className="bvs-stat-label">
              市場確率
              <span className="bvs-formula">0.75 ÷ {odds.toFixed(1)}倍</span>
            </span>
            <span className="bvs-stat-value">
              <strong>{(mProb * 100).toFixed(1)}</strong>
              <span className="bvs-unit">%</span>
            </span>
          </div>
        )}
      </div>

      {/* 割安/割高バッジ */}
      {aiProb != null && mProb != null && (
        <div
          className={`bvs-badge ${isValue ? "bvs-badge--value" : "bvs-badge--overpriced"}`}
        >
          {isValue ? "◎ 割安（妙味あり）" : "割高"}
        </div>
      )}
    </div>
  );
}

function BettingValueSection({
  prediction,
  selectedModel,
  selectedPatternIndex,
}) {
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

  const pattern = useMemo(() => {
    const tp = prediction?.turnPrediction;
    if (!tp?.patterns?.length) return null;
    return tp.patterns[selectedPatternIndex] ?? tp.patterns[0];
  }, [prediction, selectedPatternIndex]);

  const aiTrifecta = useMemo(
    () => calcTrifectaProb(pattern, oddsData?.trifectaPred),
    [pattern, oddsData],
  );
  const aiTrio = useMemo(
    () => calcTrioProb(pattern, oddsData?.trioPred),
    [pattern, oddsData],
  );

  if (!oddsData) return null;

  const updatedAtStr = formatUpdatedAt(oddsData.updatedAt);

  return (
    <div className="bvs-section">
      <div className="bvs-header">
        <h4>配当妙味</h4>
        {updatedAtStr && (
          <span className="bvs-updated">オッズ取得: {updatedAtStr}</span>
        )}
      </div>

      <div className="bvs-cards">
        <BetCard
          label="3連単"
          separator="→"
          combo={oddsData.trifectaPred}
          odds={oddsData.trifectaOdds}
          aiProb={aiTrifecta}
        />
        <BetCard
          label="3連複"
          separator="="
          combo={oddsData.trioPred}
          odds={oddsData.trioOdds}
          aiProb={aiTrio}
        />
      </div>

      <p className="bvs-note">
        市場確率 = 0.75 ÷
        オッズ（ボートレース控除率25%を考慮）。AI確率が市場確率を上回れば「割安」。
      </p>
    </div>
  );
}

export default BettingValueSection;
