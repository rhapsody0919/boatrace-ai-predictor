import { useEffect, useState } from "react";

/**
 * 画面の下に固定で出るサイト共通の Cookie の同意バナーの高さ。下に固定で出す部品（思考アシストのガイドの吹き出し・固定フッター）をその上に置く
 * （バナーは z-index 9999 で覆い、ガイド①の「次へ」・フッターの「マークシートを開く」が押せなかった。BOA-430 の本番確認で発覚）。
 * 同意するとバナーは消え、ResizeObserver が 0 を返す
 */
export function useCookieBannerHeight() {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const el = document.querySelector(".cookie-consent");
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(() =>
      setHeight(el.isConnected ? el.offsetHeight : 0),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return height;
}
