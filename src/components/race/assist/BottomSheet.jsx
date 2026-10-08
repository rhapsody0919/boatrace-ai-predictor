import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { ASSIST_COPY } from "../../../data/thinkingAssistCopy";

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Tab・Shift+Tab がシートの端を越えたら反対の端へ戻す */
function keepFocusInside(e, sheet) {
  // ラジオは選ばれている1つにしか Tab で止まらないので、選ばれていないものは端に数えない
  const items = [...sheet.querySelectorAll(FOCUSABLE)].filter(
    (el) => !(el.type === "radio" && !el.checked),
  );
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  const inside = sheet.contains(document.activeElement);
  if (
    e.shiftKey &&
    (!inside ||
      document.activeElement === first ||
      document.activeElement === sheet)
  ) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (!inside || document.activeElement === last)) {
    e.preventDefault();
    first.focus();
  }
}

/**
 * 思考アシストのシートの枠（plan「コンポーネントと置き場所」）。role="dialog"、Esc・背景・「閉じる」で閉じ、
 * 閉じたら開く前にフォーカスがあった要素へ戻す。開いている間は Tab をシートの中で回す（背後の main は inert だが、
 * 共通のヘッダーは main の外にあるため。Codex 依頼27 U03）。375px では下から、768px 以上は中央に出る
 */
export default function BottomSheet({ title, onClose, children }) {
  const titleId = useId();
  const sheetRef = useRef(null);

  useEffect(() => {
    const opener = document.activeElement;
    sheetRef.current?.focus();
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "Tab" && sheetRef.current)
        keepFocusInside(e, sheetRef.current);
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
