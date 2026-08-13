/**
 * TrifectaReferenceCard - 3連単参考情報（FR4、AI予想モデル大規模改修）
 * unifiedModel.js（Zスコア合成）とEVがプラスの3連単候補を「参考情報」として
 * 控えめに表示する。複勝予想・展開予測・イン崩れ指数が主役のため、
 * 視覚的に目立たせない（screens.md参照）。
 * データは scripts/daily/generate-unified-trifecta-reference.js（発走前バッチ）が
 * bet_recommendations（model_id='unified'）に書き込む。未実行の時間帯はnullで非表示。
 */
import { useTranslation } from "react-i18next";
import "./TrifectaReferenceCard.css";

function TrifectaReferenceCard({ trifectaReference }) {
  const { t } = useTranslation();

  if (!trifectaReference || !trifectaReference.combo) {
    return null;
  }

  const { recommendation, combo, odds, expectedValue } = trifectaReference;
  const boats = combo.split("-");

  return (
    <div className="trifecta-reference-card">
      <div className="trifecta-reference-header">
        <span className="trifecta-reference-title">
          {t("trifectaReference.title")}
        </span>
        <span
          className={`trifecta-reference-badge trifecta-reference-badge--${recommendation}`}
        >
          {t(`trifectaReference.recommendation.${recommendation}`)}
        </span>
      </div>
      <p className="trifecta-reference-desc">{t("trifectaReference.desc")}</p>
      <div className="trifecta-reference-body">
        <div className="trifecta-reference-combo">
          {boats.map((boat, i) => (
            <span key={i} className="trifecta-reference-combo-boat">
              {boat}
              {i < boats.length - 1 && (
                <span className="trifecta-reference-combo-arrow">→</span>
              )}
            </span>
          ))}
        </div>
        <div className="trifecta-reference-stats">
          {odds != null && <span>{t("trifectaReference.odds", { odds })}</span>}
          {expectedValue != null && (
            <span>
              {t("trifectaReference.ev", { ev: expectedValue.toFixed(2) })}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export default TrifectaReferenceCard;
