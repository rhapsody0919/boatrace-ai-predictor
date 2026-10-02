import { useCallback, useEffect, useRef, useState } from "react";
import {
  horizontalScrollHintState,
  horizontalScrollStep,
} from "../utils/horizontalScrollHint";

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
/** 固定の左の列（1行目の先頭のセルが position: sticky のとき）の幅を引いた、1回に送る幅 */
function stepOf(el) {
  const first = el.querySelector("tr > :first-child");
  const stickyWidth =
    first && getComputedStyle(first).position === "sticky"
      ? first.getBoundingClientRect().width
      : 0;
  return horizontalScrollStep({ clientWidth: el.clientWidth, stickyWidth });
}

export function useHorizontalScrollHint(deps = []) {
  const ref = useRef(null);
  const [hasMore, setHasMore] = useState(false);
  const [hasLess, setHasLess] = useState(false);

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const state = horizontalScrollHintState({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      scrollLeft: el.scrollLeft,
    });
    setHasMore(state.hasMore);
    setHasLess(state.hasLess);
    // 少しだけ切れているとき（「›」を出すほどではない）は、切れた量に合わせた薄いフェードだけを
    // 出す。呼び出し側の JSX を変えずに済むよう、手がかりの箱（.hscroll-hint）に data 属性で渡す
    // （React が管理する className は再描画で上書きされるため使わない）
    // 指で送るあいだは毎フレーム呼ばれるので、値が変わったときだけ書き換える
    const hint = el.closest(".hscroll-hint");
    const peekWidth = state.peekFadeWidth > 0 ? `${state.peekFadeWidth}px` : "";
    if (
      hint &&
      hint.style.getPropertyValue("--hscroll-peek-width") !== peekWidth
    ) {
      if (peekWidth) {
        hint.dataset.hscrollPeek = "true";
        hint.style.setProperty("--hscroll-peek-width", peekWidth);
      } else {
        delete hint.dataset.hscrollPeek;
        hint.style.removeProperty("--hscroll-peek-width");
      }
    }
  }, []);

  useEffect(() => {
    update();
    const raf = requestAnimationFrame(update);
    window.addEventListener("resize", update);
    // 窓の幅が変わらなくても、文字の読み込みや中身の差し替えで表の幅は後から変わる。
    // 最初の計測だけでは、英語の 320px で表が3px溢れているのに手がかりが出なかった
    // （PR #1192 ファン評価1周目）。箱と中身の大きさの変化でも測り直す
    const el = ref.current;
    const observer =
      el && typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(update)
        : null;
    if (observer) {
      observer.observe(el);
      if (el.firstElementChild) observer.observe(el.firstElementChild);
    }
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", update);
      observer?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const scrollRight = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    // `scroll-behavior: smooth` は使わない。動きを減らす設定の環境では
    // プログラムからのスクロールが一切効かなくなる（RaceTabs.css に実例）
    el.scrollLeft += stepOf(el);
    update();
  }, [update]);

  const scrollLeft = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.scrollLeft -= stepOf(el);
    update();
  }, [update]);

  return { ref, hasMore, hasLess, update, scrollRight, scrollLeft };
}
