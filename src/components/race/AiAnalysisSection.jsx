/**
 * AiAnalysisSection - 「AIデータ分析」折りたたみセクション（BOA-168）
 * 既存のAI予想ブロック群を無変更で内包し、コンパクトな1セクションに降格する。
 * ヘッダにはAI本命のサマリーを常時表示し、展開すると従来のUI一式が表示される。
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import "./AiAnalysisSection.css";

function AiAnalysisSection({ topPick, children }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="ai-analysis-section">
      <button
        type="button"
        className="ai-analysis-header"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
      >
        <span className="ai-analysis-title">🤖 {t("aiSection.title")}</span>
        {topPick?.number && (
          <span className="ai-analysis-summary">
            {t("aiSection.topPickSummary", {
              number: topPick.number,
              name: topPick.name?.replace(/\s+/g, "") ?? "",
            })}
          </span>
        )}
        <span className={`ai-analysis-chevron ${expanded ? "open" : ""}`}>
          ▼
        </span>
      </button>
      {expanded && <div className="ai-analysis-body">{children}</div>}
      {!expanded && (
        <p className="ai-analysis-hint">{t("aiSection.expandHint")}</p>
      )}
    </div>
  );
}

export default AiAnalysisSection;
