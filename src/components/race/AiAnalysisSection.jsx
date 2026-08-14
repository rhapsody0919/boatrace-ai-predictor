/**
 * AiAnalysisSection - 「AIデータ分析」セクション（BOA-168）
 * 既存のAI予想ブロック群を無変更で内包し、コンパクトな1セクションに降格する。
 * ヘッダにはAI本命と信頼度のサマリーを常時表示する。
 *
 * 2026-08-14追記: 当初はAI予想を控えめにし分析サイトとしての側面を強調する狙いで
 * デフォルト折りたたみにしていたが、新AIモデル開発を今後行わない方針としたため、
 * 展開予測パネル/イン崩れバッジをデフォルトで表示するよう変更（開閉自体は維持）
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import "./AiAnalysisSection.css";

function AiAnalysisSection({ topPick, confidence, children }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(true);

  // confidenceは通常0-100スケールだが、旧データ構造では0-1の可能性があるため正規化する
  const rawConfidence = Number(confidence);
  const confidenceValue = Number.isFinite(rawConfidence)
    ? Math.round(
        rawConfidence > 0 && rawConfidence <= 1
          ? rawConfidence * 100
          : rawConfidence,
      )
    : null;

  return (
    <div className="ai-analysis-section">
      <button
        type="button"
        className="ai-analysis-header"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
      >
        <span className="ai-analysis-title">🤖 {t("aiSection.title")}</span>
        <span className="ai-analysis-summary-area">
          {topPick?.number && (
            <span className="ai-analysis-summary">
              {t("aiSection.topPickSummary", {
                number: topPick.number,
                name: topPick.name?.replace(/\s+/g, "") ?? "",
              })}
            </span>
          )}
          {confidenceValue !== null && confidenceValue > 0 && (
            <span className="ai-analysis-confidence">
              {t("aiSection.confidence", { value: confidenceValue })}
            </span>
          )}
        </span>
        <span className={`ai-analysis-chevron ${expanded ? "open" : ""}`}>
          ▼
        </span>
      </button>
      {expanded && <div className="ai-analysis-body">{children}</div>}
      {!expanded && (
        <button
          type="button"
          className="ai-analysis-hint"
          onClick={() => setExpanded(true)}
        >
          {t("aiSection.expandHint")}
        </button>
      )}
    </div>
  );
}

export default AiAnalysisSection;
