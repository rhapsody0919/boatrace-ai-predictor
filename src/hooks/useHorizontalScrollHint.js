import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 横スクロールする箱に「まだ右に続く」ことを知らせる手がかりを付けるフック。
 *
 * 390px幅のレース詳細では、横に長い表が黙って切れて**その先があることに
 * 気づけない**という同じ不具合が繰り返し出ている（2026-09-27のファン視点
 * レビューで実測）:
 *
 * - モータ情報タブ: 9列の表が「2連率 (%」で切れ、3連率・機力指数・優出数・
 *   優勝数が画面外
 * - 直前情報タブ: 展示情報の表が5号艇までで切れ、**6号艇が存在しないように見える**
 * - タブバー: 8タブのうち完全に見えるのは4つだけ（`RaceTabs.jsx` で先に対処済み）
 *
 * 呼び出し側は `ref` をスクロールする要素に、`onScroll` をその要素に付け、
 * `hasMore` が真のときだけ「›」を描く。判定はマウント直後だと
 * レイアウトが確定しておらず `scrollWidth === clientWidth` に見えることが
 * あるため、次のフレームでも測り直す。
 *
 * @param {Array} deps 中身が変わったら測り直す依存（行数など）
 * 左へ戻す手がかり（`hasLess` / `scrollLeft`）も返す。右送りの「›」しか無いと、
 * 指の横スワイプが効かない環境（BOA-609 の iOS）で左へ戻せなくなる。使うかは呼び出し側が決める
 *
 * @returns {{ref: object, hasMore: boolean, hasLess: boolean, update: Function,
 *   scrollRight: Function, scrollLeft: Function}}
 */
export function useHorizontalScrollHint(deps = []) {
  const ref = useRef(null);
  const [hasMore, setHasMore] = useState(false);
  const [hasLess, setHasLess] = useState(false);

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setHasMore(el.scrollWidth - el.clientWidth - el.scrollLeft > 4);
    setHasLess(el.scrollLeft > 4);
  }, []);

  useEffect(() => {
    update();
    const raf = requestAnimationFrame(update);
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", update);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const scrollRight = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    // `scroll-behavior: smooth` は使わない。動きを減らす設定の環境では
    // プログラムからのスクロールが一切効かなくなる（RaceTabs.css に実例）
    el.scrollLeft += Math.round(el.clientWidth * 0.8);
    update();
  }, [update]);

  const scrollLeft = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.scrollLeft -= Math.round(el.clientWidth * 0.8);
    update();
  }, [update]);

  return { ref, hasMore, hasLess, update, scrollRight, scrollLeft };
}
