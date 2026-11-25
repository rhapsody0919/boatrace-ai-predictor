/**
 * 推移の図の点を拾う（選手の推移の線・モーターの推移で共通。オーナー 2026-11-25 承認、ファン4人の最終案）。
 * 点に重ねる（マウス）／押す（指・クリック）と、一番近い点を選ぶ。マウスはクリックで留め、指は動きの少ない
 * 押し離しで留める（縦のスクロールで出さない）。指で押したまま横に動かすと点が移る。同じ点をもう一度押すと閉じる。
 * 留めている間は、図の外を押し離す（click）か Esc で閉じる。押した瞬間（pointerdown）に閉じると、吹き出しの帯が
 * 消えて下の部品が動き、押した艇の丸が選ばれない（ファン評価 11/25）。
 *
 * @param {{ xs: number[], key: unknown, W: number, boxRef: import("react").RefObject<HTMLElement> }} args
 *   xs は選んだ線の点の横の座標（viewBox の単位）、key が替わると選びを捨てる（選んだ艇など）
 * @returns {{ pick: {i: number, pinned: boolean}|null, close: () => void, handlers: object }}
 *   handlers は点を拾う当たりの面（SVG の rect）に渡す
 */
import { useEffect, useRef, useState } from "react";

export function useChartPick({ xs, key, W, boxRef }) {
  const [pick, setPick] = useState(null);
  const start = useRef(null);
  const indexAt = (e) => {
    const r = e.currentTarget.ownerSVGElement.getBoundingClientRect();
    const sx = ((e.clientX - r.left) * W) / r.width;
    let best = 0;
    for (let i = 1; i < xs.length; i += 1)
      if (Math.abs(xs[i] - sx) < Math.abs(xs[best] - sx)) best = i;
    return best;
  };
  const cur = pick && pick.key === key && pick.i < xs.length ? pick : null;
  const pinned = cur?.pinned === true;
  useEffect(() => {
    if (!pinned) return undefined;
    const close = (e) => {
      const outside =
        e.type === "keydown"
          ? e.key === "Escape"
          : !boxRef.current?.contains(e.target);
      if (outside) setPick(null);
    };
    document.addEventListener("click", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", close);
    };
  }, [pinned, boxRef]);
  const toggle = (i) =>
    setPick(pinned && cur.i === i ? null : { key, i, pinned: true });
  const handlers = {
    onPointerMove: (e) => {
      if (e.pointerType === "mouse") {
        if (!pinned) setPick({ key, i: indexAt(e), pinned: false });
        return;
      }
      const s = start.current;
      const dx = s ? Math.abs(e.clientX - s.x) : 0;
      if (e.buttons && s && dx > 10 && dx > Math.abs(e.clientY - s.y))
        setPick({ key, i: indexAt(e), pinned: true });
    },
    onPointerLeave: () => {
      if (!pinned) setPick(null);
    },
    onPointerDown: (e) => {
      if (e.pointerType === "mouse") toggle(indexAt(e));
      else start.current = { x: e.clientX, y: e.clientY };
    },
    onPointerUp: (e) => {
      const s = start.current;
      start.current = null;
      if (e.pointerType === "mouse" || !s) return;
      if (Math.hypot(e.clientX - s.x, e.clientY - s.y) < 10) toggle(indexAt(e));
    },
  };
  return { pick: cur, close: () => setPick(null), handlers };
}
