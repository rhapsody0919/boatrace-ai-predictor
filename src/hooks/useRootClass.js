import { useLayoutEffect } from "react";

// 付けている数（同じクラスを2つの部品が付けても、最後の1つが外すまで残す）
const holders = new WeakMap();

/**
 * 要素（html・body）にクラスを付け、外す関数を返す。同じ要素・同じクラスは数えて、0 になったときだけ外す
 * @param {{ classList: { add: (c: string) => void, remove: (c: string) => void } }} el
 * @param {string} className
 * @returns {() => void}
 */
export function holdRootClass(el, className) {
  const counts = holders.get(el) ?? new Map();
  holders.set(el, counts);
  counts.set(className, (counts.get(className) ?? 0) + 1);
  el.classList.add(className);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const left = counts.get(className) - 1;
    if (left > 0) {
      counts.set(className, left);
      return;
    }
    counts.delete(className);
    el.classList.remove(className);
  };
}

/**
 * active の間だけ html か body にクラスを付ける。「この部品が出ている間だけ別の所の見た目を変える」を
 * html:has()・body:has() で書かないための hook（:has() は recharts が文字を測るたびの再計算を重くする、2026-11-26）。
 * 描く前に付ける（useLayoutEffect）ので、:has() と同じく最初の描画から効く
 * @param {"html" | "body"} root
 * @param {string} className
 * @param {boolean} [active]
 */
export function useRootClass(root, className, active = true) {
  useLayoutEffect(() => {
    if (!active) return undefined;
    const el = root === "html" ? document.documentElement : document.body;
    return holdRootClass(el, className);
  }, [root, className, active]);
}
