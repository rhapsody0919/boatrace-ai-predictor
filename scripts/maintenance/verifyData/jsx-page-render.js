/**
 * 頁（src/pages/*.jsx）を MemoryRouter の中に描いて DOM を返す道具。verify ではない。
 * Vite 専用の import は jsx-page-stubs.js の写しに差し替える。DB・公式・ネットには繋がない。
 */
import { createElement } from "react";
import { renderJsx } from "../../lib/renderJsx.js";
import { quietly, registerJsxPageStubs } from "./jsx-page-stubs.js";

const ROUTER = new URL(import.meta.resolve("react-router-dom"));
const SRC = new URL("../../../src/", import.meta.url);

/**
 * @param {string} page src/ からの頁の相対（例 "pages/About.jsx"）
 * @param {{ path?: string, route?: string, posts?: object[], stubs?: object, head?: string }} [options] path = 開く URL・route = Route の path（:id 等）
 * @returns {Promise<{ container: HTMLElement, document: Document, unmount: () => Promise<void>, settle: () => Promise<void> }>}
 */
export async function renderPage(page, { path = "/", route = null, posts = [], stubs = {}, head = "" } = {}) {
  return quietly(async () => {
    const boot = await renderJsx(ROUTER, { children: null }, { exportName: "MemoryRouter" });
    // jsdom に無い物（頁が scroll・アニメーションの枠で呼ぶ）。何もしない物で足す
    boot.window.scrollTo = () => {};
    globalThis.requestAnimationFrame ??= (callback) => setTimeout(() => callback(Date.now()), 0);
    globalThis.cancelAnimationFrame ??= (id) => clearTimeout(id);
    await boot.unmount();
    // index.html に静的にある head の要素（robots 等。頁の hook が書き換える物）を、描く前に置く
    if (head) boot.document.head.insertAdjacentHTML("beforeend", head);
    registerJsxPageStubs({ posts, stubs });
    const Page = (await import(new URL(page, SRC).href)).default;
    const { Routes, Route } = await import(ROUTER.href);
    const element = route ? createElement(Routes, null, createElement(Route, { path: route, element: createElement(Page) })) : createElement(Page);
    const view = await renderJsx(ROUTER, { children: element, initialEntries: [path] }, { exportName: "MemoryRouter" });
    return {
      container: view.container,
      document: view.document,
      unmount: view.unmount,
      /** 取得（fetch）の後に描き直されるのを待つ */
      settle: () => view.act(() => new Promise((resolve) => setTimeout(resolve, 50))),
    };
  });
}
