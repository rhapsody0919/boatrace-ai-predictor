/**
 * app-routes-fake-router.js - react-router-dom の偽（app-routes.js が src/AppRouter.jsx からの import だけをここへ向ける。verify ではない）。
 * <Route path> を描いた順に記録し、子の Routes を持つ入れ物（path が * で終わる）の element だけを描く。ページの本体は描かない。
 */
import { createElement, Fragment } from "react";

export const ROUTE_LOG = Symbol.for("verify-app-routes.route-log");
const log = () => (globalThis[ROUTE_LOG] ??= []);

export function Routes({ children }) {
  return createElement(Fragment, null, children);
}

export function Route({ path, element }) {
  log().push(path);
  return typeof path === "string" && path.endsWith("*") ? element ?? null : null;
}

export const Navigate = () => null;
export const useLocation = () => ({ pathname: "/", search: "", hash: "" });
export const useNavigate = () => () => {};
