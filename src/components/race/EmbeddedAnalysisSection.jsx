/**
 * EmbeddedAnalysisSection - 分析ツールコンポーネントの埋め込み用アコーディオン
 * （race-detail-analysis-integration FR-3〜9）
 *
 * デフォルト閉。開くまでchildrenを一切マウントしない（lazy mount）ことで、
 * 折りたたんだままのセクションは追加のデータ取得を発生させない。
 * 7つの埋め込みセクション（モーター/選手調子/ST/展示タイム推移/決まり手内訳/
 * 回収率/超展開データ）で共通利用する。
 */
import { useState } from "react";
import TermHintButton from "./TermHintButton";
import "./EmbeddedAnalysisSection.css";

function EmbeddedAnalysisSection({ title, hintKey, children }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="embedded-analysis-section">
      <div className="eas-header">
        <button
          className="eas-header-toggle"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          <span className="eas-title">{title}</span>
          <span className="eas-chevron">{expanded ? "▼" : "▶"}</span>
        </button>
        {hintKey && <TermHintButton termKey={hintKey} />}
      </div>
      {expanded && <div className="eas-content">{children}</div>}
    </div>
  );
}

export default EmbeddedAnalysisSection;
