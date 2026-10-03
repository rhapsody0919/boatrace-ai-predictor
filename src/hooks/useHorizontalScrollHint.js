import { useCallback, useEffect, useRef, useState } from "react";
import {
  HSCROLL_PEEK_MAX,
  horizontalScrollHintState,
  horizontalScrollStep,
  snapScrollTarget,
  tailPaddingFor,
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
/**
 * 表の1行目から、横に固定した左の列の幅と、各列の左端が固定した列の右端にそろうときの
 * scrollLeft を測る。見出し行は縦にも固定（top: 0）していて position は sticky になるので、
 * 横に固定した列（left が auto でないもの）だけを数える
 */
function columnsOf(el) {
  const row = el.querySelector("tr");
  const box = el.getBoundingClientRect();
  const cells = row ? [...row.children] : [];
  let stickyWidth = 0;
  for (const cell of cells) {
    const style = getComputedStyle(cell);
    if (style.position !== "sticky" || style.left === "auto") break;
    stickyWidth += cell.getBoundingClientRect().width;
  }
  const columnStarts = cells.map(
    (cell) =>
      cell.getBoundingClientRect().left -
      box.left +
      el.scrollLeft -
      stickyWidth,
  );
  return { stickyWidth, columnStarts };
}

/**
 * 「›」「‹」で送る先の scrollLeft。固定の左の列（今節の日別表は日付と R の2列）の幅を引いた
 * 見える幅の8割を目安に、列の境目にそろえる
 */
function scrollTargetOf(el, direction) {
  const { stickyWidth, columnStarts } = columnsOf(el);
  return snapScrollTarget({
    current: el.scrollLeft,
    step: horizontalScrollStep({ clientWidth: el.clientWidth, stickyWidth }),
    direction,
    max: el.scrollWidth - el.clientWidth,
    columnStarts,
  });
}

/**
 * 右端の位置も列の境目にそろうよう、表の右に余白（margin-right）を足す（PR #1202 ファン評価3周目）。
 * 測り直すときは足す前の幅で計算する（足した分で次の量が変わらないように）。足した量は表自身の
 * style から読む（箱の側に持つと、表だけが作り直されたときに実際の余白と食い違う）
 */
function applyTailPadding(el, columnStarts) {
  const table = el.firstElementChild;
  if (!table) return;
  const prev = parseFloat(table.style.marginRight) || 0;
  const naturalMax = el.scrollWidth - prev - el.clientWidth;
  const extra = tailPaddingFor({ naturalMax, columnStarts });
  if (extra === prev) return;
  table.style.marginRight = extra ? `${extra}px` : "";
}

/**
 * 列を固定した表は、指で送ったときも列の境目に止める（BOA-741）。止まる位置が自由だと、固定した
 * 選手名のすぐ右に頭の欠けた値が並び、「51位/60」が「1位/60」に読めた（PR #1223 ファン評価1周目）。
 * 止める位置は固定した列の右端（scroll-padding-left）。表の右に余白を足した後で呼び、右端も列の境目に
 * なっていることを前提にする。少しだけ溢れる表（HSCROLL_PEEK_MAX 以下）は余白を足さず右端が境目に
 * ならないので止めない（止めると、溢れた数 px に指で届かなくなる）
 */
function applyColumnSnap(el, stickyWidth) {
  const table = el.firstElementChild;
  const padding = parseFloat(table?.style.marginRight) || 0;
  const naturalMax = el.scrollWidth - padding - el.clientWidth;
  // 固定した列が見える幅より広いと、止める位置が箱の外になる。そのときは止めない
  const snap =
    stickyWidth > 0 &&
    stickyWidth < el.clientWidth &&
    naturalMax > HSCROLL_PEEK_MAX;
  if (snap) {
    el.dataset.hscrollSnap = "true";
    el.style.scrollPaddingLeft = `${stickyWidth}px`;
  } else if (el.dataset.hscrollSnap) {
    delete el.dataset.hscrollSnap;
    el.style.scrollPaddingLeft = "";
  }
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
    // 大きさが変わったときは、右端の余白を測り直してから手がかりを決める（スクロールのたびには測らない）
    const remeasure = () => {
      const el = ref.current;
      if (el) {
        const { stickyWidth, columnStarts } = columnsOf(el);
        applyTailPadding(el, columnStarts);
        applyColumnSnap(el, stickyWidth);
      }
      update();
    };
    remeasure();
    const raf = requestAnimationFrame(remeasure);
    window.addEventListener("resize", remeasure);
    // 窓の幅が変わらなくても、文字の読み込みや中身の差し替えで表の幅は後から変わる。
    // 最初の計測だけでは、英語の 320px で表が3px溢れているのに手がかりが出なかった
    // （PR #1192 ファン評価1周目）。箱と中身の大きさの変化でも測り直す
    const el = ref.current;
    const observer =
      el && typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(remeasure)
        : null;
    if (observer) {
      observer.observe(el);
      if (el.firstElementChild) observer.observe(el.firstElementChild);
    }
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", remeasure);
      observer?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const scrollRight = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    // `scroll-behavior: smooth` は使わない。動きを減らす設定の環境では
    // プログラムからのスクロールが一切効かなくなる（RaceTabs.css に実例）
    el.scrollLeft = scrollTargetOf(el, 1);
    update();
  }, [update]);

  const scrollLeft = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.scrollLeft = scrollTargetOf(el, -1);
    update();
  }, [update]);

  return { ref, hasMore, hasLess, update, scrollRight, scrollLeft };
}
