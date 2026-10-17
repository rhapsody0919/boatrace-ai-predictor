import { useEffect, useRef, useState } from "react";

/** 送った鍵（ページを移っても、同じ鍵では2回送らない。タブの切り替え・再描画で数えすぎない） */
const sent = new Set();

/**
 * 要素が画面に入ったら、鍵ごとに1回だけ onVisible を呼ぶ（GA4 の「見た」イベント用、BOA-822 task 27）。
 * 返す ref（コールバックの ref）を見張る要素に付ける。読み込みの後に出る要素や、別の要素に入れ替わったときも見張り直す。
 * 鍵が null の間は見張らない
 * @param {string|null} key 例: `race_detail|2026-10-11-02-04`、`home_highlight`
 * @param {() => void} onVisible
 * @returns {(el: Element|null) => void}
 */
export function useVisibleOnce(key, onVisible) {
  const [el, setEl] = useState(null);
  const callback = useRef(onVisible);
  useEffect(() => {
    callback.current = onVisible;
  });
  useEffect(() => {
    if (!el || !key || sent.has(key)) return undefined;
    if (typeof IntersectionObserver === "undefined") return undefined;
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting) || sent.has(key)) return;
      io.disconnect();
      sent.add(key);
      callback.current();
    });
    io.observe(el);
    return () => io.disconnect();
  }, [key, el]);
  return setEl;
}
