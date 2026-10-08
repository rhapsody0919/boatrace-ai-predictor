import { useState } from "react";
import { LENSES } from "../../../utils/assistModel";
import { ASSIST_COPY } from "../../../data/thinkingAssistCopy";

/**
 * レンズ（FR-4、screens S-1 B）。上に固定の4つのタブ・1行の問い・閉じられる使い方の1行。
 * ガイドの切り替えは後の PR（tasks PR5）
 */
export default function LensBar({ lens, onLens }) {
  const [hint, setHint] = useState(true);
  const cur = ASSIST_COPY.lenses[lens];
  return (
    <nav className="ta-lens">
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
      <p className="ta-lens-q">
        <b>{cur.q}</b> {cur.sub}
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
