/**
 * BettingValueSection - 配当妙味セクション
 *
 * FirstMarkAnimation の直下に表示する独立セクション。
 * 選択中モデルの3連単・3連複について、オッズ・AI推定確率・期待値を表示する。
 *
 * 期待値の算出:
 *   P(3連単) = pattern.probability × secondPlace[c2] × thirdPlace[c3]
 *   P(3連複) = pattern.probability × (secondPlace[c2]×thirdPlace[c3] + secondPlace[c3]×thirdPlace[c2])
 *   EV = P × odds
 *
 * ボートレース控除率は約25%のため、ランダム期待値は0.75。
 * EV ≥ 1.0 が購入検討ライン。
 */
import { useMemo } from "react";
import { BOAT_COLORS } from "../../utils/colors";
import "./BettingValueSection.css";

// モデルキー（kebab）→ predictionOdds フィールドのサフィックスへのマッピング
const MODEL_SUFFIX = {
  "safe-bet": "SafeBet",
  standard: "Standard",
  "upset-focus": "UpsetFocus",
};

/**
 * ボート番号バッジ（小）
 */
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

/**
 * 買い目を区切り記号付きで表示（BoatBadge + 区切り）
 */
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

/**
 * 期待値の色クラスを返す
 * 1.0以上: green、0.75〜1.0: yellow、0.75未満: gray
 */
function evClass(ev) {
  if (ev == null) return "";
  if (ev >= 1.0) return "bvs-ev--positive";
  if (ev >= 0.75) return "bvs-ev--neutral";
  return "bvs-ev--negative";
}

/**
 * オッズ取得時刻をフォーマット（JST HH:MM）
 */
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

/**
 * EV計算（turnPrediction が存在する場合）
 */
function computeEV(pattern, combo, odds) {
  if (!pattern || !combo || odds == null) return null;
  const boats = combo.split("-").map(Number);
  if (boats.length !== 3) return null;
  const [, c2, c3] = boats;

  const p1 = pattern.probability ?? 0;
  const p2 = pattern.secondPlace?.[c2] ?? 0;
  const p3 = pattern.thirdPlace?.[c3] ?? 0;
  const P = p1 * p2 * p3;
  if (P <= 0) return null;
  return P * odds;
}

/**
 * 3連複のEV計算（c2とc3の両方の順序を合算）
 */
function computeTrioEV(pattern, combo, odds) {
  if (!pattern || !combo || odds == null) return null;
  const boats = combo.split("-").map(Number);
  if (boats.length !== 3) return null;
  const [, c2, c3] = boats;

  const p1 = pattern.probability ?? 0;
  const p_c2c3 =
    (pattern.secondPlace?.[c2] ?? 0) * (pattern.thirdPlace?.[c3] ?? 0);
  const p_c3c2 =
    (pattern.secondPlace?.[c3] ?? 0) * (pattern.thirdPlace?.[c2] ?? 0);
  const P = p1 * (p_c2c3 + p_c3c2);
  if (P <= 0) return null;
  return P * odds;
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

  const evTrifecta = useMemo(
    () => computeEV(pattern, oddsData?.trifectaPred, oddsData?.trifectaOdds),
    [pattern, oddsData],
  );
  const evTrio = useMemo(
    () => computeTrioEV(pattern, oddsData?.trioPred, oddsData?.trioOdds),
    [pattern, oddsData],
  );

  // 確率表示（パーセント）
  const probTrifecta = useMemo(() => {
    if (!pattern || !oddsData?.trifectaPred) return null;
    const boats = oddsData.trifectaPred.split("-").map(Number);
    if (boats.length !== 3) return null;
    const [, c2, c3] = boats;
    const p =
      (pattern.probability ?? 0) *
      (pattern.secondPlace?.[c2] ?? 0) *
      (pattern.thirdPlace?.[c3] ?? 0);
    return p > 0 ? p * 100 : null;
  }, [pattern, oddsData]);

  const probTrio = useMemo(() => {
    if (!pattern || !oddsData?.trioPred) return null;
    const boats = oddsData.trioPred.split("-").map(Number);
    if (boats.length !== 3) return null;
    const [, c2, c3] = boats;
    const p_c2c3 =
      (pattern.secondPlace?.[c2] ?? 0) * (pattern.thirdPlace?.[c3] ?? 0);
    const p_c3c2 =
      (pattern.secondPlace?.[c3] ?? 0) * (pattern.thirdPlace?.[c2] ?? 0);
    const p = (pattern.probability ?? 0) * (p_c2c3 + p_c3c2);
    return p > 0 ? p * 100 : null;
  }, [pattern, oddsData]);

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
        {/* 3連単 */}
        <div className="bvs-card">
          <div className="bvs-card-label">3連単</div>
          <div className="bvs-card-combo">
            <BetCombo combo={oddsData.trifectaPred} separator="→" />
          </div>
          <div className="bvs-card-stats">
            <div className="bvs-stat">
              <span className="bvs-stat-label">オッズ</span>
              <span className="bvs-stat-value">
                {oddsData.trifectaOdds != null ? (
                  <>
                    <strong>{oddsData.trifectaOdds.toFixed(1)}</strong>
                    <span className="bvs-unit">倍</span>
                  </>
                ) : (
                  <span className="bvs-na">発売前</span>
                )}
              </span>
            </div>
            {probTrifecta != null && (
              <div className="bvs-stat">
                <span className="bvs-stat-label">
                  AI確率
                  <span className="bvs-prob-ref">（ランダム0.8%）</span>
                </span>
                <span className="bvs-stat-value">
                  <strong>{probTrifecta.toFixed(1)}</strong>
                  <span className="bvs-unit">%</span>
                </span>
              </div>
            )}
            {evTrifecta != null && (
              <div className="bvs-stat">
                <span className="bvs-stat-label">期待値</span>
                <span
                  className={`bvs-stat-value bvs-ev ${evClass(evTrifecta)}`}
                >
                  <strong>{evTrifecta.toFixed(2)}</strong>
                  {evTrifecta >= 1.0 && <span className="bvs-ev-check">✓</span>}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* 3連複 */}
        <div className="bvs-card">
          <div className="bvs-card-label">3連複</div>
          <div className="bvs-card-combo">
            <BetCombo combo={oddsData.trioPred} separator="=" />
          </div>
          <div className="bvs-card-stats">
            <div className="bvs-stat">
              <span className="bvs-stat-label">オッズ</span>
              <span className="bvs-stat-value">
                {oddsData.trioOdds != null ? (
                  <>
                    <strong>{oddsData.trioOdds.toFixed(1)}</strong>
                    <span className="bvs-unit">倍</span>
                  </>
                ) : (
                  <span className="bvs-na">発売前</span>
                )}
              </span>
            </div>
            {probTrio != null && (
              <div className="bvs-stat">
                <span className="bvs-stat-label">
                  AI確率
                  <span className="bvs-prob-ref">（ランダム5.0%）</span>
                </span>
                <span className="bvs-stat-value">
                  <strong>{probTrio.toFixed(1)}</strong>
                  <span className="bvs-unit">%</span>
                </span>
              </div>
            )}
            {evTrio != null && (
              <div className="bvs-stat">
                <span className="bvs-stat-label">期待値</span>
                <span className={`bvs-stat-value bvs-ev ${evClass(evTrio)}`}>
                  <strong>{evTrio.toFixed(2)}</strong>
                  {evTrio >= 1.0 && <span className="bvs-ev-check">✓</span>}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      <p className="bvs-note">
        期待値1.0以上が購入検討ライン（控除率約25%を考慮）
      </p>
    </div>
  );
}

export default BettingValueSection;
