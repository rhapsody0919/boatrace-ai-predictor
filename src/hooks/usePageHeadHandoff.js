import { useEffect, useLayoutEffect, useState } from "react";
import { PAGE_HEAD_ATTR } from "../pure/pageHead.js";

// 生の HTML に差し込んだ head（middleware、src/pure/pageHead.js の injectPageHead）を、React の head へ受け渡す。
// 描画の前に消すと、lazy のチャンクと取得の待ちの間に canonical が0本になり、生の head の利点を捨てる。
// そこで React が同じ種類の要素を足した時点で差し込みの物を外す（MutationObserver。時間では見回らない。
// 通知は描画の前の microtask で届くので、2本のまま描かれない）。
// title の要素は外さず残す（useSingleTitle がモジュールの評価の時に掴むため）。値の既定の文は
// title の data-page-head が持ち、SPA の中で別のパスへ移った時に戻す。差し込みが無いページでは何もしない

const LD_SELECTOR = 'script[type="application/ld+json"]';

// 差し込みの title の要素は、React の描画より前（このモジュールの評価の時）に掴む。React の title が出ている間は
// useSingleTitle が head から外すので、後から querySelector で探しても見つからない
const INJECTED_TITLE =
  typeof document !== "undefined"
    ? document.querySelector(`title[${PAGE_HEAD_ATTR}]`)
    : null;
const KINDS = [
  'meta[name="description"]',
  'link[rel="canonical"]',
];

const injectedOf = (doc, selector) =>
  Array.from(doc.querySelectorAll(`${selector}[${PAGE_HEAD_ATTR}]`));
const ownOf = (doc, selector) =>
  Array.from(doc.querySelectorAll(`${selector}:not([${PAGE_HEAD_ATTR}])`));

function ldType(el) {
  try {
    return JSON.parse(el.textContent ?? "")?.["@type"] ?? null;
  } catch {
    return null; // 読めない JSON-LD は種類が無い物として比べない（差し込みの側は常に読める）
  }
}

/**
 * React の同じ種類の要素が現れた差し込みを外す。外していない差し込みが残るか（title を除く）を返す
 * @param {Document} doc
 */
export function syncPageHead(doc) {
  for (const selector of KINDS) {
    if (ownOf(doc, selector).length > 0) {
      injectedOf(doc, selector).forEach((el) => el.remove());
    }
  }
  const injectedLd = injectedOf(doc, LD_SELECTOR);
  if (injectedLd.length > 0) {
    const ownTypes = new Set(ownOf(doc, LD_SELECTOR).map(ldType));
    injectedLd.filter((el) => ownTypes.has(ldType(el))).forEach((el) => el.remove());
  }
  return doc.querySelector(`[${PAGE_HEAD_ATTR}]:not(title)`) !== null;
}

/**
 * 差し込みを全て外し、title の文を既定に戻す（別のパスへ移った時。生の値を別のページに持ち越さない）
 * @param {Document} doc
 * @param {Element|null} title - 差し込みの title の要素（head から外れていても戻す）
 */
export function releasePageHead(doc, title) {
  if (title?.hasAttribute(PAGE_HEAD_ATTR)) {
    title.textContent = title.getAttribute(PAGE_HEAD_ATTR);
    title.removeAttribute(PAGE_HEAD_ATTR);
  }
  doc.querySelectorAll(`[${PAGE_HEAD_ATTR}]:not(title)`).forEach((el) => el.remove());
}

/**
 * @param {string} pathname - 今のパス（呼び手が Router の useLocation から渡す）。最初のパスから変わったら差し込みを全て外す
 */
export default function usePageHeadHandoff(pathname) {
  const [firstPathname] = useState(pathname);

  // 描画の前（layout effect）に1回合わせる。layout effect は同じ描画の DOM の書き換えが全て済んだ後に走るので、
  // 最初の描画で React が head へ足した要素はここより前に DOM に入っている。後の lazy のチャンクの描画は MutationObserver が拾う
  useLayoutEffect(() => {
    if (!document.querySelector(`[${PAGE_HEAD_ATTR}]`)) return undefined;
    if (!syncPageHead(document)) return undefined;
    // React の JSON-LD は本文（#root の中）に描かれるので、文書の全体を見る。外し終えたら止める
    const observer = new MutationObserver(() => {
      if (!syncPageHead(document)) observer.disconnect();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (pathname !== firstPathname) releasePageHead(document, INJECTED_TITLE);
  }, [pathname, firstPathname]);
}
