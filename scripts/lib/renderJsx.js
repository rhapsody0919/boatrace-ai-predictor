/**
 * verify から React の部品（.jsx）を jsdom に描き、DOM を返す（hq のオーナー決定 2026-11-09）。
 *
 * 本文の文字を正規表現で見る verify を、描いた結果の振る舞いで見る試験へ置き換えるための部品。
 * vitest は入れない方針なので、既にある vite（transformWithEsbuild）と jsdom だけで描く。
 *
 * 仕組み: このファイル自身を Node の module hooks（module.register）として登録し、
 * - .jsx と src/ の下の .js は transformWithEsbuild で変換して読む（相対の import はそのまま Node が解く）。
 *   import.meta.env は MODE=test の空の値に定める（.env は読まない。本番の鍵で動かさないため）
 * - 拡張子の無い相対の import は .jsx → .js → /index.jsx → /index.js の順で探す（vite と同じ書き方を許す）
 * - CSS・画像等の import は読まずに空の物へ差し替える（CSS は空、画像は名前の文字列）
 * hooks は process 全体に効くので、verify の1プロセスの中だけで使う。
 */
import { register } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const STYLE_EXT = /\.(css|scss|sass|less)(\?.*)?$/;
const ASSET_EXT = /\.(svg|png|jpe?g|gif|webp|avif|ico|mp4|webm|woff2?)(\?.*)?$/;
const TRY_EXT = [".jsx", ".js", "/index.jsx", "/index.js"];
const SRC_URL = new URL("../../src/", import.meta.url).href;
const IMPORT_META_ENV = JSON.stringify({ MODE: "test", DEV: false, PROD: false, SSR: false, BASE_URL: "/" });

/** module hooks の resolve。CSS・画像は在るかを見ずに差し替え、拡張子の無い相対は補う。 */
export async function resolve(specifier, context, nextResolve) {
  const isRelative = specifier.startsWith(".") || specifier.startsWith("/");
  if (isRelative && context.parentURL && (STYLE_EXT.test(specifier) || ASSET_EXT.test(specifier))) {
    return { url: new URL(specifier, context.parentURL).href, shortCircuit: true };
  }
  if (isRelative && context.parentURL && !/\.[cm]?jsx?$|\.json$/.test(specifier)) {
    const base = fileURLToPath(new URL(specifier, context.parentURL));
    const found = TRY_EXT.map((ext) => base + ext).find((p) => existsSync(p));
    if (found) return { url: pathToFileURL(found).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}

/** module hooks の load。.jsx と src/ の .js は変換し、CSS・画像は中身を読まない。 */
export async function load(url, context, nextLoad) {
  if (STYLE_EXT.test(url)) return { format: "module", source: "export default {};", shortCircuit: true };
  if (ASSET_EXT.test(url)) {
    return { format: "module", source: `export default ${JSON.stringify(new URL(url).pathname)};`, shortCircuit: true };
  }
  if (url.startsWith("file:") && (url.endsWith(".jsx") || (url.startsWith(SRC_URL) && url.endsWith(".js")))) {
    const { readFile } = await import("node:fs/promises");
    const { transformWithEsbuild } = await import("vite");
    const path = fileURLToPath(url);
    const { code } = await transformWithEsbuild(await readFile(path, "utf8"), path, {
      loader: "jsx",
      jsx: "automatic",
      format: "esm",
      sourcemap: "inline",
      define: { "import.meta.env": IMPORT_META_ENV },
    });
    return { format: "module", source: code, shortCircuit: true };
  }
  return nextLoad(url, context);
}

let dom = null;

/** jsdom の window を1つ作り、React が見る global（window・document 等）に置く。2回目からは同じ物。 */
function installDom() {
  if (dom) return dom;
  return import("jsdom").then(({ JSDOM }) => {
    if (dom) return dom;
    dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
    const { window } = dom;
    for (const key of ["window", "document", "navigator", "HTMLElement", "Node", "Event", "MouseEvent", "getComputedStyle", "localStorage", "sessionStorage", "requestAnimationFrame", "cancelAnimationFrame"]) {
      const value = key === "window" ? window : window[key];
      if (value === undefined) continue;
      Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
    }
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    return dom;
  });
}

let hooksRegistered = false;

/**
 * .jsx の部品を描いて、描いた先の要素を返す。
 *
 * @param {string|URL} componentPath 部品のファイル（絶対パスか file: の URL）
 * @param {object} [props] 部品に渡す props
 * @param {{ exportName?: string }} [options] default 以外の export を描くときの名前
 * @returns {Promise<{ container: HTMLElement, document: Document, window: Window, rerender: (props: object) => Promise<void>, act: (fn: () => unknown) => Promise<void>, unmount: () => Promise<void> }>}
 */
export async function renderJsx(componentPath, props = {}, { exportName = "default" } = {}) {
  if (!hooksRegistered) {
    register(import.meta.url);
    hooksRegistered = true;
  }
  const { window } = await installDom();
  const url = componentPath instanceof URL ? componentPath.href : pathToFileURL(String(componentPath)).href;
  const [mod, React, { createRoot }] = await Promise.all([
    import(url),
    import("react"),
    import("react-dom/client"),
  ]);
  const Component = mod[exportName];
  if (typeof Component !== "function" && typeof Component !== "object") {
    throw new Error(`renderJsx: ${url} に export "${exportName}" の部品が無い`);
  }
  const container = window.document.createElement("div");
  window.document.body.appendChild(container);
  const root = createRoot(container);
  const act = async (fn) => {
    await React.act(async () => {
      await fn();
    });
  };
  await act(() => root.render(React.createElement(Component, props)));
  return {
    container,
    document: window.document,
    window,
    act,
    rerender: (next) => act(() => root.render(React.createElement(Component, next))),
    unmount: async () => {
      await act(() => root.unmount());
      container.remove();
    },
  };
}
