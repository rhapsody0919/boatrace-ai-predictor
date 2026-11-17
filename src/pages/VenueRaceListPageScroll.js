/**
 * VenueRaceListPage のスクロール（着地点の合わせ・位置の保存と復元）。
 * VenueRaceListPage.jsx から移しただけで、挙動は変えない。
 */
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

// 着いた1画面目に見せる次のレースのカードの高さ（見出し・締切・状態が読める程度）
const NEXT_RACE_PEEK_PX = 160;

// ユーザーが自分でスクロールし始めたことを示すイベント（着地点の合わせ直しをやめる）
const USER_SCROLL_EVENTS = ["wheel", "touchstart", "keydown", "pointerdown"];

// sticky ヘッダーに隠れない位置へスクロールする（ヘッダーはスクロールすると低くなるため、いまの高さで少し余裕を持たせる）
function scrollBelowHeader(el) {
  if (!el) return;
  const headerHeight =
    document.querySelector(".app-header")?.getBoundingClientRect().height ?? 0;
  window.scrollTo({
    top: el.getBoundingClientRect().top + window.scrollY - headerHeight - 8,
  });
}

// 目的の要素がヘッダーのすぐ下に来るようスクロールし、5秒間は高さの変化に合わせて合わせ直す。
// 上にある会場カードは自分でデータを読み込むので、読み込みで高さが変わると目的の要素が押し下げられる
// （ファン評価2周目）。ユーザーが操作（スクロール・タップ・キー）したら、その時点でやめる。
// 着いたときの自動スクロールと、目印の近道（「9Rへ」）の両方で使う。近道は1回だけ合わせていたため、
// CI の負荷で会場カードの読み込みが遅いと、9R が約90px 下にずれていた
export function holdScrollPosition(getTarget, observed) {
  // 自分で合わせた位置。これと違う位置へのスクロールは、ユーザーの操作（スクロールバーのドラッグ等も含む）
  // とみなして合わせ直しをやめる
  // 高さが変わった直後のずれは、ブラウザのスクロール位置の自動調整（scroll anchoring）によるものなので、
  // ユーザーの操作とみなさず合わせ直す
  let expectedY = 0;
  let lastResizeAt = 0;
  const realign = () => {
    scrollBelowHeader(getTarget());
    expectedY = window.scrollY;
  };
  realign();
  if (typeof ResizeObserver === "undefined" || !observed) return;
  const observer = new ResizeObserver(() => {
    lastResizeAt = Date.now();
    realign();
  });
  observer.observe(observed);
  const onScroll = () => {
    if (Math.abs(window.scrollY - expectedY) <= 2) return;
    if (Date.now() - lastResizeAt < 300) realign();
    else stop();
  };
  const stop = () => {
    observer.disconnect();
    clearTimeout(timer);
    window.removeEventListener("scroll", onScroll);
    USER_SCROLL_EVENTS.forEach((type) =>
      window.removeEventListener(type, stop),
    );
  };
  const timer = setTimeout(stop, 5000);
  window.addEventListener("scroll", onScroll, { passive: true });
  USER_SCROLL_EVENTS.forEach((type) =>
    window.addEventListener(type, stop, { passive: true }),
  );
}

// 保存した位置を読む。保存が無い・読めない環境は null
function readSavedScrollY(navigationType, scrollKey) {
  if (navigationType !== "POP") return null;
  try {
    const v = window.sessionStorage.getItem(scrollKey);
    return v == null ? null : Number(v);
  } catch {
    return null;
  }
}

// ブラウザ自身のスクロール位置の復元は、一覧を後から読み込むため効かないうえ、読み込み後にこちらの復元を
// 上書きして最上部へ戻すことがある。このページを開いている間は止め、戻る・進む・リロードの位置はすべて
// 自前で保存・復元する（離れるときに元へ戻す）
function suspendBrowserScrollRestoration() {
  if (!("scrollRestoration" in window.history)) return undefined;
  const previous = window.history.scrollRestoration;
  window.history.scrollRestoration = "manual";
  return () => {
    window.history.scrollRestoration = previous;
  };
}

function trackScrollPosition(scrollKey) {
  const save = () => {
    try {
      window.sessionStorage.setItem(scrollKey, String(window.scrollY));
    } catch {
      // 保存できない環境では、開き直したときに次のレースへ移るだけ
    }
  };
  // 離れるときだけに頼らず、スクロールのたびに保存する（描画が止まるタブでも保存されるよう、
  // requestAnimationFrame を介さず同期的に書く。sessionStorage への書き込みは軽い）
  window.addEventListener("scroll", save, { passive: true });
  window.addEventListener("pagehide", save);
  return () => {
    window.removeEventListener("scroll", save);
    window.removeEventListener("pagehide", save);
    save();
  };
}

// ブラウザの戻る・進む・リロード（どれも react-router では "POP"）で開き直したときは、読んでいた位置に戻す
// （ユーザー判断: リロードで次のレースへ飛ばさない）。一覧を後から読み込むため、ブラウザの位置の復元は効かない。
// そこで、ページを離れるとき（アプリ内の移動・リロード）の位置をこのタブに保存し、一覧を出した後に戻す。
// 保存が無い "POP"（最初に開いたページ等）は、新しく開いたときと同じく次のレースへ移す
export function useScrollPersistence() {
  const navigationType = useNavigationType();
  const location = useLocation();
  const scrollKey = `venueScrollY:${location.pathname}`;
  const [savedScrollY] = useState(() =>
    readSavedScrollY(navigationType, scrollKey),
  );
  useEffect(suspendBrowserScrollRestoration, []);
  useEffect(() => trackScrollPosition(scrollKey), [scrollKey]);
  return savedScrollY;
}

// 一覧（レースのカード）を出してから、読んでいた位置に戻す
function restoreSavedScroll(savedScrollY, grid, scrolledRef) {
  if (!grid) return;
  scrolledRef.current = true;
  window.scrollTo({ top: savedScrollY });
  // 直後に高さの変化などで位置がずれたら、ユーザーが操作していなければ1回だけ戻し直す
  let touched = false;
  const markTouched = () => {
    touched = true;
  };
  USER_SCROLL_EVENTS.forEach((type) =>
    window.addEventListener(type, markTouched, {
      passive: true,
      once: true,
    }),
  );
  setTimeout(() => {
    USER_SCROLL_EVENTS.forEach((type) =>
      window.removeEventListener(type, markTouched),
    );
    if (!touched && Math.abs(window.scrollY - savedScrollY) > 50) {
      window.scrollTo({ top: savedScrollY });
    }
  }, 500);
}

function landAtNextRaceMarker(marker, scrolledRef) {
  if (!marker) return;
  scrolledRef.current = true;
  // 着地点: 会場カード（折りたたみ）＋目印＋次のレースの頭が1画面に入るなら会場カードの先頭。
  // 開いた状態を覚えていて入らないときは、次のレースを優先して目印に着く
  const holder = marker.parentElement;
  holdScrollPosition(() => {
    const header =
      document.querySelector(".app-header")?.getBoundingClientRect().height ??
      0;
    const fits =
      holder.getBoundingClientRect().height + NEXT_RACE_PEEK_PX <=
      window.innerHeight - header;
    return fits ? holder : marker;
  }, holder);
}

// 次のレースの目印（次のレースのカードの直上）まで1回だけスクロールする（BOA-546）。直上の会場カードは
// 自分でデータを読み込むため、読み込みで高さが変わると目印が画面の下へ押し出される（ファン評価2周目）。
// 着いてから5秒間は、ユーザーが操作するまで高さの変化に合わせて位置を合わせ直す
export function useLandingScroll(savedScrollY, gridRef, markerRef) {
  const scrolledRef = useRef(false);
  useEffect(() => {
    if (scrolledRef.current) return undefined;
    if (savedScrollY != null) {
      restoreSavedScroll(savedScrollY, gridRef.current, scrolledRef);
      return undefined;
    }
    landAtNextRaceMarker(markerRef.current, scrolledRef);
    return undefined;
  });
}
