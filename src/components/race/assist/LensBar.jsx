import { useState } from "react";
import { LENSES } from "../../../utils/assistModel";
import { ASSIST_COPY } from "../../../data/thinkingAssistCopy";

/**
 * レンズ（FR-4、screens S-1 B）。上に固定の4つのタブ・1行の問い・閉じられる使い方の1行。
 * 右端に「ガイド」の切り替え（FR-10。開いている間 aria-pressed）
 */
export default function LensBar({
  lens,
  onLens,
  guideOn,
  onGuide,
  target = 1,
}) {
  const [hint, setHint] = useState(true);
  const cur = ASSIST_COPY.lenses[lens];
  return (
    <nav className="ta-lens">
      <div className="ta-lens-row">
        <div
          className="ta-lens-tabs"
          role="tablist"
          aria-label={ASSIST_COPY.lensList}
        >
          {LENSES.map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={key === lens}
              onClick={() => onLens(key)}
            >
              {ASSIST_COPY.lenses[key].label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="ta-guide-btn"
          aria-pressed={guideOn}
          onClick={onGuide}
        >
          {ASSIST_COPY.guideRegion}
        </button>
      </div>
      <p className="ta-lens-q">
        <b>{cur.q}</b>{" "}
        {/* 軸の問いは着順の切り替えに合わせる（BOA-831、デザイナー役 P2-1） */}
        {lens === "axis" ? ASSIST_COPY.axisSub[target] : cur.sub}
      </p>
      {hint && (
        <div className="ta-hint">
          <span>{ASSIST_COPY.hint}</span>
          <button
            type="button"
            aria-label={ASSIST_COPY.hintClose}
            onClick={() => setHint(false)}
          >
            ×
          </button>
        </div>
      )}
    </nav>
  );
}
