import { useEffect } from "react";

// 描画後の head の title を1つにする（BOA-1693）。
// React 19 はページの部品の <title> を head へ足すが、index.html の静的な <title> は消さないので
// 2つになる（検索エンジンの描画後の HTML・GA の page_title が揺れる）。
// 部品の title がある間は静的な title を head から外し（参照は持っておく）、
// 部品の title が1つも無くなったら同じ要素を head へ戻す。
// head の子の出入りに MutationObserver で追従する（時間では見回らない）。
// MutationObserver の通知は描画の前の microtask で届くので、遷移の途中でも title が0にならない

const HTML_NS = "http://www.w3.org/1999/xhtml";

function headTitles() {
  return Array.from(document.head.children).filter(
    (el) => el.localName === "title" && el.namespaceURI === HTML_NS,
  );
}

// index.html から来た静的な title は、React の描画より前（このモジュールの評価時）に掴む。
// React 19 は部品の title を静的な title の前へ挿入するので、マウント後に先頭を取ると React 管理の title を掴んでしまう
const STATIC_TITLE =
  typeof document !== "undefined" ? (headTitles()[0] ?? null) : null;

export function syncSingleTitle(staticTitle) {
  const others = headTitles().filter((el) => el !== staticTitle);
  if (others.length > 0) {
    if (staticTitle.parentNode === document.head) staticTitle.remove();
  } else if (staticTitle.parentNode !== document.head) {
    document.head.appendChild(staticTitle);
  }
}

export default function useSingleTitle() {
  useEffect(() => {
    const staticTitle = STATIC_TITLE;
    if (!staticTitle) return undefined;

    const observer = new MutationObserver(() => syncSingleTitle(staticTitle));
    observer.observe(document.head, { childList: true });
    syncSingleTitle(staticTitle);

    return () => {
      observer.disconnect();
      if (staticTitle.parentNode !== document.head) {
        document.head.appendChild(staticTitle);
      }
    };
  }, []);
}
