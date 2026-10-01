import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import "./TermHintButton.css";

const POPOVER_WIDTH = 220;
const VIEWPORT_MARGIN = 8;
// 下にこれだけの高さが無ければ、上に余裕があるとき上に開く
const MIN_COMFORTABLE_HEIGHT = 320;

export default function TermHintButton({ termKey }) {
  const { t, i18n } = useTranslation();
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

  // 説明文は locales の termHints.* に4言語で置く（BOA-592）。キーが無い用語は ? を出さない
  const hintKey = `termHints.${termKey}`;
  if (!i18n.exists(hintKey)) return null;
  const explanation = t(hintKey);

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
    // 下に十分な余白が無ければ上に開く。長い説明（Fバッジの説明等）が画面下で
    // 120px の枠に押し込められ、肝心の後半が読めなかった（BOA-440 ファン評価2周目）。
    // 開いた側に収まらない分は中でスクロールさせる
    const spaceBelow = window.innerHeight - rect.bottom - 6 - VIEWPORT_MARGIN;
    const spaceAbove = rect.top - 6 - VIEWPORT_MARGIN;
    const openUp = spaceBelow < MIN_COMFORTABLE_HEIGHT && spaceAbove > spaceBelow;
    setPosition(
      openUp
        ? {
            bottom: window.innerHeight - rect.top + 6,
            left,
            maxHeight: spaceAbove,
          }
        : { top: rect.bottom + 6, left, maxHeight: Math.max(spaceBelow, 120) },
    );
  };

  return (
    <span className="term-hint" ref={buttonRef}>
      <button
        type="button"
        className="term-hint__button"
        onClick={handleToggle}
        aria-label={t("termHintLabel")}
        aria-expanded={Boolean(position)}
      >
        ?
      </button>
      {position &&
        createPortal(
          <span
            ref={popoverRef}
            className="term-hint__popover"
            style={{
              top: position.top,
              bottom: position.bottom,
              left: position.left,
              maxHeight: position.maxHeight,
            }}
          >
            {explanation}
          </span>,
          document.body,
        )}
    </span>
  );
}
