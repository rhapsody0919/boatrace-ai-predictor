/**
 * AiAnalysisSection - 「AIデータ分析」折りたたみセクション（BOA-168）
 * 既存のAI予想ブロック群を無変更で内包し、コンパクトな1セクションに降格する。
 * ヘッダにはAI本命と信頼度のサマリーを常時表示し、展開すると従来のUI一式が表示される。
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import "./AiAnalysisSection.css";

function AiAnalysisSection({ topPick, confidence, children }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  const confidenceValue = Number.isFinite(Number(confidence))
    ? Math.round(Number(confidence))
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
