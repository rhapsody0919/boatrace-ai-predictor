import { useId } from "react";
import { ASSIST_COPY } from "../../../data/thinkingAssistCopy";

/**
 * 買い目レンズの着順の切り替え（1着／2着以内／3着以内。BOA-831、spec D-44・D-46）。
 * 買い目の図の「過去の{着順}」だけに効く（軸は1着だけ、2着以内・3着以内の6艇は相手レンズ）。状態は親
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
