/**
 * 推移の図（選手の推移の線・勝率の段・モーターの推移）の座標の幅を、図の枠の幅から決める。
 * 枠が狭い（スマホ）間は CHART_BASE_W の座標を枠いっぱいに拡大して描く（今までどおり）。
 * 枠が広い（PC）ときは、今までの最大の拡大（枠 480px ＝ 480/343 倍）で文字・札・縦の大きさを止め、
 * 座標の幅を枠に合わせて増やして横だけ伸ばす（オーナー 2026-11-25「PC 表示なのに小さいグラフ」）。
 * 描く前（useLayoutEffect）に測る。測る前の 343 のまま広い枠で描くと高さが一時的に2倍以上になるため（visual-designer 11/25）
 */
import { useLayoutEffect, useRef, useState } from "react";

export const CHART_BASE_W = 343;
const MAX_SCALE = 480 / CHART_BASE_W;
const widthOf = (frame) =>
  Math.max(CHART_BASE_W, Math.floor(frame / MAX_SCALE));

/** @returns {[import("react").RefObject<SVGSVGElement>, number]} 図に付ける ref と座標の幅 */
export function useChartWidth() {
  const ref = useRef(null);
  const [w, setW] = useState(CHART_BASE_W);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    setW(widthOf(el.getBoundingClientRect().width));
    if (typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(([entry]) =>
      setW(widthOf(entry.contentRect.width)),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}
