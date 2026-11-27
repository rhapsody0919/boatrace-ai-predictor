/**
 * ブログ記事の `**強調**` が、日本語の約物（、。「」％ 等）の隣でも太字になり、記号のまま画面に出ないことを守る。
 *
 * 1. 記事の頁（src/pages/BlogPost.jsx）に、約物の隣の ** を含む Markdown を渡して描くと、<strong> になり本文に ** が残らない
 *    （CommonMark の規則だけでは「%**ま」の ** は閉じと見なされず生で残る。2026-11-27 に 41 ファイル・91 か所で出ていた）
 * 2. 今ある全ての記事（public/blog/*.md）を頁と同じ remark の組（src/utils/blogMarkdownSanitize.js の blogRemarkPlugins）で読むと、
 *    コードの外の文に ** が残らない（新しい記事が別の形で壊れたら落ちる）
 *
 * 使い方: node scripts/maintenance/verify-blog-cjk-emphasis.js
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { unified } from "unified";
import remarkParse from "remark-parse";
import { visit } from "unist-util-visit";
import { renderBlogPost } from "./verifyData/blog-post-page.js";
import { blogRemarkPlugins } from "../../src/utils/blogMarkdownSanitize.js";

const SAMPLE =
  "全24会場を並べると、**1コース逃げ率は最小40.3%〜最大59.0%**まで開きます。\n\n" +
  "これは予想ではなく、**その会場で実際に1コースが逃げたレースの集計**です。\n";

test("頁は約物の隣の ** を太字にし、記号を本文に残さない", async () => {
  const view = await renderBlogPost(SAMPLE);
  assert.ok(view.article, "本文の要素が描かれていない");
  const strongs = [...view.article.querySelectorAll("strong")].map((el) => el.textContent);
  assert.deepEqual(strongs, [
    "1コース逃げ率は最小40.3%〜最大59.0%",
    "その会場で実際に1コースが逃げたレースの集計",
  ]);
  assert.doesNotMatch(view.article.textContent, /\*\*/);
  await view.unmount();
});

test("今ある全ての記事で、コードの外の文に ** が残らない", async () => {
  const dir = new URL("../../public/blog/", import.meta.url);
  const files = (await readdir(dir)).filter((f) => f.endsWith(".md"));
  assert.ok(files.length > 100, `記事が少なすぎる（${files.length}）。置き場が変わったか`);
  const parser = unified().use(remarkParse).use(blogRemarkPlugins);
  const leftovers = [];
  for (const file of files) {
    const tree = parser.parse(await readFile(new URL(file, dir), "utf8"));
    visit(tree, "text", (node) => {
      if (node.value.includes("**")) leftovers.push(`${file}: ${node.value.slice(0, 60)}`);
    });
  }
  assert.deepEqual(leftovers, [], `太字にならない ** が残る:\n${leftovers.join("\n")}`);
});
