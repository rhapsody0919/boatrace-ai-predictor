/**
 * PredictionCard - AIデータ分析内の「予想カード」共通フレーム（BOA-179関連、2026-08-14〜）
 *
 * 背景: AiAnalysisSectionの複勝予想パネル・展開予測パネルは、以前は静的な
 * ハードコード文言（またはアニメーション）と予想内容が雑然と並んでいた。
 * ユーザー要望「動的な実測検証結果を提示しつつ、予想を提示する」を受けて、
 * 見出し・動的な実測精度バッジ・予想内容を1枚のカードにまとめる共通フレームを
 * 新設し、2つの予想（複勝予想/展開予測）を明確に独立したセクションとして扱う。
 */
import { useUnifiedModelAccuracy } from "../../hooks/useUnifiedModelAccuracy";
import AccuracyStatBadge from "./AccuracyStatBadge";
import TermHintButton from "./TermHintButton";
import "./PredictionCard.css";

function PredictionCard({ title, statKey, hintKey, children }) {
  const { accuracy, loading } = useUnifiedModelAccuracy();
  const stat = accuracy?.[statKey];

  return (
    <div className="prediction-card">
      <h5 className="prediction-card-title">
        {title}
        {hintKey && <TermHintButton termKey={hintKey} />}
      </h5>
      <AccuracyStatBadge
        loading={loading}
        hitRate={stat?.hitRate}
        recoveryRate={stat?.recoveryRate}
        totalRaces={stat?.totalRaces}
      />
      {children}
    </div>
  );
}

export default PredictionCard;
