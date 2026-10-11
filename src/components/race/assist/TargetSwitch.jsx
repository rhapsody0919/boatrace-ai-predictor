import { useId } from "react";
import { ASSIST_COPY } from "../../../data/thinkingAssistCopy";

/**
 * 軸・買い目で共通の着順の切り替え（1着／2着以内／3着以内。BOA-831、spec D-44）。
 * 押した結果が見えるよう、軸では大きい数字の直上、買い目では図の上に置く。状態は親（ページ内だけ）
 */
export default function TargetSwitch({ target, onTarget }) {
  const labelId = useId();
  return (
    <div className="ta-target">
      <span className="ta-target-label" id={labelId}>
        {ASSIST_COPY.targetGroup}
      </span>
      <div
        className="ta-target-seg"
        role="group"
        aria-labelledby={labelId}
        data-ta-control="target"
      >
        {[1, 2, 3].map((n) => (
          <button
            key={n}
            type="button"
            aria-pressed={target === n}
            onClick={() => onTarget(n)}
          >
            {ASSIST_COPY.targets[n]}
          </button>
        ))}
      </div>
    </div>
  );
}
