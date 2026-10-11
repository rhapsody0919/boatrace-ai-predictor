import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import "./TermHintButton.css";

// 広い画面では枠を広げる。220px 固定だと 1440px でも長い説明が縦に細長くなった（BOA-589）
const popoverWidth = () => (window.innerWidth >= 1024 ? 320 : 220);
const VIEWPORT_MARGIN = 8;
// 下にこれだけの高さが無ければ、上に余裕があるとき上に開く
const MIN_COMFORTABLE_HEIGHT = 320;

// values: 説明文の差し込み（例: 平均ST（公式）の期間 {{from}}〜{{to}}、BOA-815）
export default function TermHintButton({ termKey, values = undefined }) {
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
  const explanation = t(hintKey, values);

  const handleToggle = (event) => {
    event.stopPropagation();
    if (position) {
      setPosition(null);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const left = Math.min(
      Math.max(rect.left, VIEWPORT_MARGIN),
      window.innerWidth - popoverWidth() - VIEWPORT_MARGIN,
    );
    // 下に十分な余白が無ければ上に開く。長い説明（Fバッジの説明等）が画面下で
    // 120px の枠に押し込められ、肝心の後半が読めなかった（BOA-440 ファン評価2周目）。
    // 開いた側に収まらない分は中でスクロールさせる
    // 画面下に固定のナビ（レース詳細の会場・R移動）があれば、その高さも空ける。ナビの裏に枠の下端が
    // 重なり、本文の末尾が見えなかった（BOA-589 ファン評価2周目）
    const bottomNav =
      document.querySelector(".race-bottom-nav")?.getBoundingClientRect()
        .height ?? 0;
    const spaceBelow =
      window.innerHeight - rect.bottom - 6 - VIEWPORT_MARGIN - bottomNav;
    const spaceAbove = rect.top - 6 - VIEWPORT_MARGIN;
    const openUp = spaceBelow < MIN_COMFORTABLE_HEIGHT && spaceAbove > spaceBelow;
    setPosition(
      openUp
        ? {
            bottom: window.innerHeight - rect.top + 6,
            left,
            width: popoverWidth(),
            maxHeight: spaceAbove,
          }
        : {
            top: rect.bottom + 6,
            left,
            width: popoverWidth(),
            maxHeight: Math.max(spaceBelow, 120),
          },
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
              width: position.width,
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
