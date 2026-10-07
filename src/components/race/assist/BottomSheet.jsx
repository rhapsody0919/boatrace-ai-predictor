import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { ASSIST_COPY } from "../../../data/thinkingAssistCopy";

/**
 * 思考アシストのシートの枠（plan「コンポーネントと置き場所」）。role="dialog"、Esc・背景・「閉じる」で閉じ、
 * 閉じたら開く前にフォーカスがあった要素へ戻す。375px では下から、768px 以上は中央に出る
 */
export default function BottomSheet({ title, onClose, children }) {
  const titleId = useId();
  const sheetRef = useRef(null);

  useEffect(() => {
    const opener = document.activeElement;
    sheetRef.current?.focus();
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (opener instanceof HTMLElement && document.contains(opener))
        opener.focus();
    };
  }, [onClose]);

  return createPortal(
    <div
      className="ta-sheet-bg"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="ta-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        ref={sheetRef}
      >
        <div className="ta-sheet-head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="ta-close" onClick={onClose}>
            {ASSIST_COPY.close}
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
