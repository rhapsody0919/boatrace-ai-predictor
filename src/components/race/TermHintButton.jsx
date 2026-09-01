import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { TERM_HINTS } from "./termHints";
import "./TermHintButton.css";

const POPOVER_WIDTH = 220;
const VIEWPORT_MARGIN = 8;

export default function TermHintButton({ termKey }) {
  const { i18n } = useTranslation();
  const [position, setPosition] = useState(null);
  const buttonRef = useRef(null);
  const popoverRef = useRef(null);

  useEffect(() => {
    if (!position) return undefined;
    const handlePointerDown = (event) => {
      if (
        buttonRef.current?.contains(event.target) ||
        popoverRef.current?.contains(event.target)
      ) {
        return;
      }
      setPosition(null);
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [position]);

  if (i18n.language !== "ja") return null;
  const explanation = TERM_HINTS[termKey];
  if (!explanation) return null;

  const handleToggle = (event) => {
    event.stopPropagation();
    if (position) {
      setPosition(null);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const left = Math.min(
      Math.max(rect.left, VIEWPORT_MARGIN),
      window.innerWidth - POPOVER_WIDTH - VIEWPORT_MARGIN,
    );
    setPosition({ top: rect.bottom + 6, left });
  };

  return (
    <span className="term-hint" ref={buttonRef}>
      <button
        type="button"
        className="term-hint__button"
        onClick={handleToggle}
        aria-label="用語の説明を見る"
        aria-expanded={Boolean(position)}
      >
        ?
      </button>
      {position &&
        createPortal(
          <span
            ref={popoverRef}
            className="term-hint__popover"
            style={{ top: position.top, left: position.left }}
          >
            {explanation}
          </span>,
          document.body,
        )}
    </span>
  );
}
