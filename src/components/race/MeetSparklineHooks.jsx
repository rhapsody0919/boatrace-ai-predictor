import { useEffect, useState } from "react";

// タップで出した吹き出しは、外側をタップするまで消さない（読ませるため）。
// マウスは onPointerLeave で消えるので、この後始末は主にタッチ向け
export function useDismissOnOutsidePointer(
  wrapRef,
  activeIndex,
  setActiveIndex,
) {
  useEffect(() => {
    if (activeIndex === null) return undefined;
    const onDocDown = (event) => {
      if (!wrapRef.current?.contains(event.target)) setActiveIndex(null);
    };
    document.addEventListener("pointerdown", onDocDown);
    return () => document.removeEventListener("pointerdown", onDocDown);
  }, [wrapRef, setActiveIndex, activeIndex]);
}

// 箱の実際の幅（px）。点の下の着順の間隔を実寸で測り、詰まる行だけ字を小さくする
// （BOA-537 ファン評価2周目。走数で一律に字を小さくすると、PCでも小さくなった）
export function useBoxWidth(wrapRef, canDraw, hasLabels) {
  const [boxWidth, setBoxWidth] = useState(0);
  useEffect(() => {
    const el = wrapRef.current;
    if (!canDraw || !hasLabels || !el) return undefined;
    setBoxWidth(el.getBoundingClientRect().width);
    if (typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver((entries) => {
      setBoxWidth(entries[0]?.contentRect.width ?? 0);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [wrapRef, canDraw, hasLabels]);
  return boxWidth;
}
