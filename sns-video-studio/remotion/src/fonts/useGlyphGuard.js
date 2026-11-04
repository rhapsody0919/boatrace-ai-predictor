import { useLayoutEffect } from "react";
import { cancelRender, getRemotionEnvironment } from "remotion";
import { missingGlyphs } from "./glyphCoverage.js";

const SKIP = /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/i;

/** node の中の描く文字（script・style の中は除く。SVG の text は含む） */
function drawnText(node) {
  if (node.nodeType === Node.TEXT_NODE)
    return SKIP.test(node.parentNode?.nodeName ?? "") ? "" : node.nodeValue;
  if (node.nodeType !== Node.ELEMENT_NODE || SKIP.test(node.nodeName))
    return "";
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) =>
      SKIP.test(n.parentNode?.nodeName ?? "")
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  });
  let s = "";
  for (let n = walker.nextNode(); n; n = walker.nextNode()) s += n.nodeValue;
  return s;
}

/**
 * 描いた字に、同梱の Noto Sans JP に無い字があれば描画（render・still）を止める（豆腐を出さない）。
 * 頁の文字を最初に1回見て、その後は足された・書き換わった所だけを見る（描画の頁には1つの型しか載らないので、頁全体を見ればその型の字を見たことになる）。
 * 止めるのは描画のときだけ（Studio では止めない）。全貌・f01・Shorts の型だけで呼ぶ（古い CM は絵文字を別のフォントで描くので呼ばない）
 */
export function useGlyphGuard() {
  useLayoutEffect(() => {
    if (!getRemotionEnvironment().isRendering) return undefined;
    const stop = (text) => {
      const missing = missingGlyphs(text);
      if (missing.length)
        cancelRender(
          new Error(
            `同梱の Noto Sans JP に無い字がある（豆腐になる）: ${missing.map((c) => `${c}(U+${c.codePointAt(0).toString(16).toUpperCase()})`).join(" ")}`,
          ),
        );
    };
    stop(drawnText(document.body));
    const observer = new MutationObserver((records) => {
      let text = "";
      for (const r of records) {
        if (r.type === "characterData") text += drawnText(r.target);
        else for (const n of r.addedNodes) text += drawnText(n);
      }
      stop(text);
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    return () => observer.disconnect();
  }, []);
}
