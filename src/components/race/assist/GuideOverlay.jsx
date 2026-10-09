import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { ASSIST_COPY as C } from "../../../data/thinkingAssistCopy";

/**
 * ガイド（FR-10、screens S-1c）。5段で、各段は光らせる場所（data-guide の名前）・問い・1文。
 * 吹き出しは光らせた場所と重ならない側（上か下）に固定で出し、光らせた場所をその反対側へ送る。
 * レンズの切り替え・フッターを隠すのはページ側（閉じても買い目・レンズは残す）
 * @param {{steps: ReturnType<import("../../../utils/assistTheory").guideSteps>, index: number, onStep: (i: number|null) => void}} props
 */
export default function GuideOverlay({ steps, index, onStep }) {
  const step = steps[index];
  const boxRef = useRef(null);

  useEffect(() => {
    const el = document.querySelector(`[data-guide="${step.target}"]`);
    if (!el) return undefined;
    el.classList.add("ta-guide-lit");
    const reduce = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    )?.matches;
    el.scrollIntoView?.({
      block: step.at === "top" ? "end" : "start",
      behavior: reduce ? "auto" : "smooth",
    });
    return () => el.classList.remove("ta-guide-lit");
  }, [step.target, step.at, index]);

  useEffect(() => {
    boxRef.current?.focus();
    const onKey = (e) => {
      if (e.key === "Escape") onStep(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [index, onStep]);

  const last = index === steps.length - 1;
  return createPortal(
    <div
      ref={boxRef}
      className={`ta-guide${step.at === "top" ? " ta-guide-top" : ""}`}
      role="dialog"
      aria-label={C.guideRegion}
      tabIndex={-1}
    >
      <span className="ta-guide-step">{C.guideStep(index + 1, step.step)}</span>
      <span className="ta-guide-q">{step.q}</span>
      <span className="ta-guide-sub">{step.sub}</span>
      <div className="ta-guide-ops">
        <button type="button" onClick={() => onStep(null)}>
          {C.close}
        </button>
        {index > 0 && (
          <button type="button" onClick={() => onStep(index - 1)}>
            {C.guidePrev}
          </button>
        )}
        <button
          type="button"
          className="ta-guide-next"
          onClick={() => onStep(last ? null : index + 1)}
        >
          {last ? C.guideDone : C.guideNext}
        </button>
      </div>
    </div>,
    document.body,
  );
}
