/**
 * 記事の任意の欄 updated: あれば構造化データの dateModified になり（datePublished は date のまま）、無ければ date になる。
 * sitemap の lastmod 側は verify-sitemap-lastmod.js が同じ updated ?? date で固定する。時計に頼らない。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { blogPosts } from "../../src/data/blogPosts.js";
import { renderPage } from "./verifyData/jsx-page-render.js";
import { quietly } from "./verifyData/jsx-page-stubs.js";

const BASE = {
  id: "verify-post",
  title: "検査用の記事",
  description: "検査用の説明",
  date: "2026-01-01",
  category: "検査",
  tags: ["検査"],
  image: "/ogp-image.png",
  readTime: 1,
};

const WITH_UPDATED = { ...BASE, id: "verify-post-updated", updated: "2026-02-03" };

// 頁と偽の posts は読み込みが1度きりなので、両方の記事を渡して id で開き分ける
async function blogPostingOf(post) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("本文", { status: 200 });
  try {
    const view = await renderPage("pages/BlogPost.jsx", {
      path: `/blog/${post.id}`,
      route: "/blog/:id",
      posts: [WITH_UPDATED, BASE],
    });
    await quietly(() => view.settle());
    const schemas = [
      ...view.container.querySelectorAll('script[type="application/ld+json"]'),
      ...view.document.head.querySelectorAll('script[type="application/ld+json"]'),
    ].map((el) => JSON.parse(el.textContent));
    await view.unmount();
    return schemas.find((s) => s["@type"] === "BlogPosting");
  } finally {
    globalThis.fetch = realFetch;
  }
}


test("dateModified: updated があればそれ、datePublished は date のまま", async () => {
  const ld = await blogPostingOf(WITH_UPDATED);
  assert.equal(ld.datePublished, "2026-01-01");
  assert.equal(ld.dateModified, "2026-02-03");
});

test("dateModified: updated が無ければ date", async () => {
  const ld = await blogPostingOf(BASE);
  assert.equal(ld.datePublished, "2026-01-01");
  assert.equal(ld.dateModified, "2026-01-01");
});

test("全記事: updated は YYYY-MM-DD で date 以降", () => {
  for (const p of blogPosts.filter((x) => "updated" in x)) {
    assert.match(p.updated, /^\d{4}-\d{2}-\d{2}$/, `${p.id}: updated の形`);
    assert.ok(p.updated >= p.date, `${p.id}: updated が date より前`);
  }
});
