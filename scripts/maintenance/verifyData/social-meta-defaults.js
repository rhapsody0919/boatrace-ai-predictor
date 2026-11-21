/**
 * social-meta-defaults.js - src/hooks/useSocialMeta.js の既定の文（頁が title・description を渡さないときに meta へ書く文）を、
 * hook を jsdom で回して読む部品（verify-no-accuracy-claims-in-meta.js。verify ではない）。本文の字は読まない。
 *
 * 頁と同じく head に meta を置き（index.html に静的にある物）、何も渡さない useSocialMeta を描いて、書かれた content を返す。
 */
import { useLayoutEffect } from "react";
import { renderJsx } from "../../lib/renderJsx.js";
import { quietly } from "./jsx-page-stubs.js";

// index.html の head にある、useSocialMeta が書く meta（og:image・twitter:image は文でないので見ない）
export const SOCIAL_META_SELECTORS = [
  ['meta[name="keywords"]', "name", "keywords"],
  ['meta[property="og:title"]', "property", "og:title"],
  ['meta[property="og:description"]', "property", "og:description"],
  ['meta[name="twitter:title"]', "name", "twitter:title"],
  ['meta[name="twitter:description"]', "name", "twitter:description"],
];

const HOOK = new URL("../../../src/hooks/useSocialMeta.js", import.meta.url);
const PROBE = new URL(import.meta.url);

/** 描く部品: head に meta を置き（layout effect は hook の effect より先）、何も渡さずに useSocialMeta を呼ぶ */
export function SocialMetaProbe({ useSocialMeta }) {
  useLayoutEffect(() => {
    for (const [selector, attr, value] of SOCIAL_META_SELECTORS) {
      if (document.querySelector(selector)) continue;
      const meta = document.createElement("meta");
      meta.setAttribute(attr, value);
      document.head.appendChild(meta);
    }
  }, []);
  useSocialMeta({});
  return null;
}

/** { selector: content } — 何も渡さない頁で meta に書かれる既定の文 */
export async function socialMetaDefaults() {
  return quietly(async () => {
    const { useSocialMeta } = await import(HOOK.href);
    const view = await renderJsx(PROBE, { useSocialMeta }, { exportName: "SocialMetaProbe" });
    const out = Object.fromEntries(
      SOCIAL_META_SELECTORS.map(([selector]) => [selector, view.document.querySelector(selector)?.getAttribute("content") ?? null]),
    );
    await view.unmount();
    return out;
  });
}
