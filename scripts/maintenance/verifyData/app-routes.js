/**
 * app-routes.js - src/AppRouter.jsx を描き、各言語の LocalizedRoutes が並べる <Route path> を集める部品
 * （verify-sitemap-coverage.js。verify ではない）。本文の字は読まない。
 *
 * renderJsx（scripts/lib/renderJsx.js）で AppRouter を jsdom に描く。AppRouter.jsx からの react-router-dom・react-i18next・
 * CookieConsent・HreflangTags・SiteFeedback（本物の useLocation を呼ぶ）の import だけを隣の偽へ向け、属性の無い .json の import を JSON として読む
 * （Vite 専用の import.meta.glob・仮想モジュールは jsx-page-stubs.js の写し）（module.register の resolve hook。ページの部品は import されるが描かない）。
 * 偽の Route は path を記録し、子の Routes を持つ入れ物（/{lang}/*・/*）だけを描くので、全言語の LocalizedRoutes の path が並ぶ。
 */
import { register } from "node:module";
import { renderJsx } from "../../lib/renderJsx.js";
import { registerJsxPageStubs, quietly } from "./jsx-page-stubs.js";
// 偽の静的な import。差し替えは下の HOOKS（URL）で行うが、verify→verifyData の辿りが静的な相対 import しか見ないため、ここで名指しする
import { ROUTE_LOG } from "./app-routes-fake-router.js";
import "./app-routes-fake-i18n.js";

const APP_ROUTER = new URL("../../../src/AppRouter.jsx", import.meta.url);
const ROUTER = new URL("./app-routes-fake-router.js", import.meta.url).href;
const OTHERS = new URL("./app-routes-fake-i18n.js", import.meta.url).href;
const SWAPS = {
  "react-router-dom": ROUTER,
  "react-i18next": OTHERS,
  "./components/CookieConsent": OTHERS,
  "./components/HreflangTags": OTHERS,
  "./components/siteFeedback/SiteFeedback": OTHERS,
};
const HOOKS = `
const SWAPS = ${JSON.stringify(SWAPS)};
export async function resolve(specifier, context, next) {
  if (context.parentURL === ${JSON.stringify(APP_ROUTER.href)} && SWAPS[specifier]) return { url: SWAPS[specifier], shortCircuit: true };
  const resolved = await next(specifier, context);
  // vite と同じく、属性の無い .json の import を JSON として読む
  return resolved.url.endsWith(".json") ? { ...resolved, importAttributes: { ...context.importAttributes, type: "json" } } : resolved;
}
`;

/** AppRouter を描いて、記録した <Route path> の並び（入れ物の path・* を含む）を返す */
export async function appRoutePaths() {
  // renderJsx の hooks を先に入れる（後に入れた hook が先に回る。偽の差し替えを .jsx の補いより先にするため）
  const warmup = await renderJsx(new URL("./app-routes-fake-i18n.js", import.meta.url));
  await warmup.unmount();
  registerJsxPageStubs();
  register(`data:text/javascript,${encodeURIComponent(HOOKS)}`);
  globalThis[ROUTE_LOG] = [];
  const view = await quietly(() => renderJsx(APP_ROUTER));
  await view.unmount();
  return [...globalThis[ROUTE_LOG]];
}
