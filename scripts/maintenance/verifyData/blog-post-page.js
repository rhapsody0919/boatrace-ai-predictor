/**
 * verify-blog-leading-h1.js・verify-blog-markdown-sanitize.js の道具。verify ではない。
 * 記事の頁（src/pages/BlogPost.jsx）に記事の Markdown を渡して描き、DOM を返す。
 * 本文は fetch で取るので、/blog/<id>.md だけ渡した Markdown を返す偽の fetch に差す（ネットには繋がない）。
 */
import { renderPage } from "./jsx-page-render.js";
import { quietly } from "./jsx-page-stubs.js";

const POST = {
  id: "verify-post",
  title: "検査用の記事",
  description: "検査用の説明",
  date: "2026-01-01",
  category: "検査",
  tags: ["検査"],
  image: "/ogp-image.png",
  readTime: 1,
};

/**
 * @param {string} markdown 記事の Markdown
 * @returns {Promise<{ article: HTMLElement|null, faqQuestions: string[], unmount: () => Promise<void> }>}
 *   article = 本文の要素（.blog-post-content）・faqQuestions = 頁の JSON-LD（FAQPage）の質問
 */
export async function renderBlogPost(markdown) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) =>
    String(url).endsWith(`/blog/${POST.id}.md`)
      ? new Response(markdown, { status: 200 })
      : new Response("", { status: 404 });
  try {
    const view = await renderPage("pages/BlogPost.jsx", { path: `/blog/${POST.id}`, route: "/blog/:id", posts: [POST] });
    await quietly(() => view.settle());
    const schemas = [...view.container.querySelectorAll('script[type="application/ld+json"]'), ...view.document.head.querySelectorAll('script[type="application/ld+json"]')]
      .map((el) => JSON.parse(el.textContent));
    const faq = schemas.find((s) => s["@type"] === "FAQPage");
    return {
      article: view.container.querySelector(".blog-post-content"),
      faqQuestions: (faq?.mainEntity ?? []).map((q) => q.name),
      unmount: view.unmount,
    };
  } finally {
    globalThis.fetch = realFetch;
  }
}
